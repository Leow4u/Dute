import type { FinanceiroProfile } from "../domain/profile.js";
import { authorizePersonalRoute } from "./shared/principal.js";
import { FieldPath, type Firestore, type Transaction } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";
import { registerNfFor } from "../domain/fatura-gravacao.js";
import { advanceFaturaFor } from "../domain/cobranca-gravacao.js";
import { interpretarRegistro, faturaIdDaNf, demandaLida, medicaoLida, problemaParaFaturar, problemaDaMedicao } from "../domain/fatura.js";
import { interpretarAvanco } from "../domain/cobranca.js";
import { periodoLido, problemaDaArmazenagem } from "../domain/armazenagem.js";
import { financeiroLiberado } from "../domain/liberacao.js";
import { type ApiContext, type ApiRequest, type ModuleDefinition, type ModuleRoute, customerFilter, denied, invalid, object, projectFields, readPage, requireCustomer, requireScope } from "./shared/core.js";

const FATURA = ["customer_code", "status", "valor_cents", "recebido_cents", "vencimento", "forma", "demanda_numeros", "periodo_ids", "medicao_ids", "registrada_em"] as const;
const PORTAL_FATURA = ["customer_code", "customer_name", "status", "valor_cents", "recebido_cents", "saldo_cents", "vencimento", "forma", "enviada_em", "paga_em", "atualizada_em", "demanda_numeros", "nf"] as const;
const PAGAMENTO = ["customer_code", "fatura_id", "status", "valor_cents", "recebido_em", "forma"] as const;
const DEMANDA = ["customer_code", "numero", "etapa", "customer_name", "cobranca", "medicao_id"] as const;
const PERIODO = ["customer_code", "competencia", "status", "total_cents"] as const;
const MEDICAO = ["customer_code", "contrato_id", "competencia", "status", "total_cents"] as const;
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
const profile = (ctx: ApiContext): FinanceiroProfile => ctx.integration.kind === "personal" ? ctx.actor : ({ uid: ctx.actor.uid, role: "financeiro", name: ctx.actor.name });

/** Guardas e escritas compartilham a transação: troca de tenant força retry. */
function guardedDb(ctx: ApiContext, guard: (tx: Transaction) => Promise<void>): Firestore {
  return new Proxy(ctx.db, {
    get(target, property) {
      if (property === "runTransaction") return (work: (tx: Transaction) => Promise<unknown>) => target.runTransaction(async tx => { await guard(tx); return work(tx); });
      const member = Reflect.get(target, property, target);
      return typeof member === "function" ? member.bind(target) : member;
    },
  });
}

async function tenantDocument(ctx: ApiContext, tx: Transaction, collection: string, id: string, customer?: string) {
  if (!id || id.includes("/")) invalid("Identificador inválido.");
  const snap = await tx.get(ctx.db.collection(collection).doc(id));
  if (!snap.exists) throw new HttpsError("not-found", "Registro não encontrado.");
  const data = snap.data()!;
  requireCustomer(ctx, data.customer_code);
  if (customer !== undefined && data.customer_code !== customer) denied("Vínculo entre clientes diferentes.");
  return data;
}

async function checkLinks(ctx: ApiContext, tx: Transaction, data: Record<string, unknown>, customer: string, invoice?: string) {
  for (const [collection, key] of [["demands", "demanda_numeros"], ["billing_periods", "periodo_ids"], ["medicoes", "medicao_ids"], ["client_authorizations", "autorizacao_ids"]]) {
    const ids = strings(data[key]);
    if (ids.length > 250) denied("Registro com vínculos acima do limite.");
    for (const id of ids) {
      const linked = await tenantDocument(ctx, tx, collection, id, customer);
      if (invoice && collection !== "client_authorizations" && object(linked.faturamento).fatura_id !== invoice) denied("Vínculo fora desta fatura.");
    }
  }
}

async function register(ctx: ApiContext, request: ApiRequest) {
  requireScope(ctx, "financeiro:faturas:gravar");
  const body = object(request.body);
  // Parser strict do domínio também recusa customer_code, status e idempotency_key injetados.
  if ("idempotency_key" in body) invalid("Use o cabeçalho Idempotency-Key.");
  const pedido = interpretarRegistro({ ...body, idempotency_key: ctx.idempotencyKey });
  const id = faturaIdDaNf(pedido.nf.serie ?? "1", pedido.nf.numero);
  const db = guardedDb(ctx, async tx => {
    let customer: string | undefined;
    for (const [collection, ids] of [["demands", pedido.demandas], ["billing_periods", pedido.armazenagem], ["medicoes", pedido.medicoes ?? []]] as const) {
      for (const ref of ids) {
        const data = await tenantDocument(ctx, tx, collection, ref, customer);
        customer = data.customer_code as string;
        // Conferir todos os vínculos que o domínio poderá alterar.
        if (collection === "demands") await checkLinks(ctx, tx, { autorizacao_ids: demandaLida(ref, data).autorizacao_ids }, customer);
        if (collection === "medicoes") {
          const medicao = medicaoLida(ref, data);
          await tenantDocument(ctx, tx, "client_authorizations", medicao.autorizacao_id, customer);
          for (const numero of medicao.demandas) {
            const demanda = await tenantDocument(ctx, tx, "demands", numero, customer);
            await checkLinks(ctx, tx, { autorizacao_ids: demandaLida(numero, demanda).autorizacao_ids }, customer);
          }
        }
      }
    }
    const existing = await tx.get(ctx.db.collection("faturas").doc(id));
    if (existing.exists) {
      requireCustomer(ctx, existing.data()!.customer_code);
      if (existing.data()!.customer_code !== customer) denied("NF pertence a outro cliente.");
    }
  });
  return registerNfFor(db, profile(ctx), pedido);
}

async function advance(ctx: ApiContext, id: string, request: ApiRequest, action: "send" | "pay") {
  requireScope(ctx, action === "send" ? "financeiro:cobrancas:gravar" : "financeiro:pagamentos:registrar");
  const body = object(request.body);
  if (["acao", "fatura_id", "idempotency_key"].some(key => key in body)) invalid("A ação e a fatura são definidas pela rota; use Idempotency-Key no cabeçalho.");
  const pedido = interpretarAvanco({ ...body, acao: action, fatura_id: id, idempotency_key: ctx.idempotencyKey });
  const db = guardedDb(ctx, async tx => {
    const data = await tenantDocument(ctx, tx, "faturas", id);
    if (action === "pay" && data.origem_nf === "omie") denied("Esta API não executa nem agenda baixas na Omie.");
    await checkLinks(ctx, tx, data, data.customer_code as string, id);
    // Pagamentos existentes também precisam pertencer à fatura e ao tenant.
    const payments = await tx.get(ctx.db.collection("pagamentos").where("fatura_id", "==", id).limit(251));
    if (payments.size > 250) denied("Fatura com pagamentos acima do limite.");
    for (const payment of payments.docs) {
      requireCustomer(ctx, payment.data().customer_code);
      if (payment.data().customer_code !== data.customer_code) denied("Pagamento de outro cliente.");
    }
  });
  return advanceFaturaFor(db, profile(ctx), pedido);
}

async function toInvoice(ctx: ApiContext, request: ApiRequest, collection: string, fields: readonly string[], statusField: string, status: string) {
  requireScope(ctx, "financeiro:ler");
  const query = request.query;
  if (Object.keys(query).some(key => !["customer_code", "limit", "cursor"].includes(key))) invalid("Filtros disponíveis: customer_code, limit e cursor.");
  const customer = customerFilter(ctx, query.customer_code);
  const limit = query.limit === undefined ? 50 : Number(query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) invalid("limit deve ser de 1 a 100.");
  if (query.cursor !== undefined && (typeof query.cursor !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(query.cursor))) invalid("Cursor inválido.");
  let selection = ctx.db.collection(collection).where(statusField, "==", status).orderBy(FieldPath.documentId());
  if (customer !== undefined) selection = selection.where("customer_code", "==", customer);
  if (typeof query.cursor === "string") selection = selection.startAfter(query.cursor);
  const found = await selection.limit(limit + 1).get();
  const page = found.docs.slice(0, limit);
  const eligible = page.filter(doc => {
    const data = doc.data();
    if (collection === "demands") {
      const demand = demandaLida(doc.id, data);
      return !demand.medicao_id && !problemaParaFaturar(demand);
    }
    if (collection === "billing_periods") return !problemaDaArmazenagem(periodoLido(doc.id, data));
    return !problemaDaMedicao(medicaoLida(doc.id, data));
  });
  return { data: eligible.map(doc => projectFields(doc.id, collection === "billing_periods" ? { ...doc.data(), total_cents: periodoLido(doc.id, doc.data()).valor_cents } : doc.data(), fields)), next_cursor: found.size > limit ? page.at(-1)!.id : null };
}

async function invoices(ctx: ApiContext, request: ApiRequest) {
  if (ctx.integration.kind !== "personal" || ctx.actor.role !== "cliente") return readPage(ctx, "faturas", FATURA, request, { customerField: "customer_code" });
  const page = await readPage(ctx, "client_faturas", PORTAL_FATURA, request, { customerField: "customer_code" });
  return { ...page, data: page.data.map(row => {
    const data = row as Record<string, unknown>;
    const result: Record<string, unknown> = { id: row.id };
    for (const field of PORTAL_FATURA) {
      const value = data[field];
      if (field === "demanda_numeros" && Array.isArray(value)) result[field] = strings(value);
      else if (field === "nf" && value && typeof value === "object" && !Array.isArray(value)) {
        result.nf = Object.fromEntries(["numero", "serie", "emitida_em"].filter(key => typeof (value as Record<string, unknown>)[key] === "string" || (value as Record<string, unknown>)[key] === null).map(key => [key, (value as Record<string, unknown>)[key]]));
      } else if (value === null || ["string", "number", "boolean"].includes(typeof value)) result[field] = value;
    }
    return result;
  }) };
}

const route = (method: ModuleRoute["method"], path: string, scope: ModuleRoute["scope"], summary: string, run: ModuleRoute["run"]): ModuleRoute => ({ method, path: `/api/v1/financeiro${path}`, scope, role: "financeiro", summary, async run(ctx, params, request) { requireScope(ctx, scope); if (ctx.integration.kind === "personal") { if (!ctx.integration.principal) denied(); authorizePersonalRoute(ctx.integration.principal, method, `/api/v1/financeiro${path}`, scope, request.body); } return run(ctx, params, request); } });
export const financeiroApi: ModuleDefinition = {
  module: "financeiro", released: financeiroLiberado,
  routes: [
    route("GET", "/a-faturar", "financeiro:ler", "Consultar demandas A faturar", (ctx, _, req) => toInvoice(ctx, req, "demands", DEMANDA, "etapa", "a_faturar")),
    route("GET", "/a-faturar/armazenagem", "financeiro:ler", "Consultar competências de armazenagem A faturar", (ctx, _, req) => toInvoice(ctx, req, "billing_periods", PERIODO, "status", "emitido")),
    route("GET", "/a-faturar/medicoes", "financeiro:ler", "Consultar medições aprovadas A faturar", (ctx, _, req) => toInvoice(ctx, req, "medicoes", MEDICAO, "status", "aprovada")),
    route("GET", "/faturas", "financeiro:ler", "Consultar faturas", (ctx, _, req) => { requireScope(ctx, "financeiro:ler"); customerFilter(ctx, req.query.customer_code); return invoices(ctx, req); }),
    route("GET", "/pagamentos", "financeiro:ler", "Consultar pagamentos registrados", (ctx, _, req) => { requireScope(ctx, "financeiro:ler"); customerFilter(ctx, req.query.customer_code); return readPage(ctx, "pagamentos", PAGAMENTO, req, { customerField: "customer_code" }); }),
    route("POST", "/faturas", "financeiro:faturas:gravar", "Registrar NF emitida fora do sistema", (ctx, _, req) => register(ctx, req)),
    route("PATCH", "/faturas/{id}/cobranca", "financeiro:cobrancas:gravar", "Documentar envio da cobrança", (ctx, params, req) => advance(ctx, params.id, req, "send")),
    route("POST", "/faturas/{id}/pagamentos", "financeiro:pagamentos:registrar", "Registrar pagamento recebido", (ctx, params, req) => advance(ctx, params.id, req, "pay")),
  ],
};
