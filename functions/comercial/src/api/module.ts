import type { ComercialProfile } from "../domain/profile.js";
import { authorizePersonalRoute } from "./shared/principal.js";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";
import { saveCommercialCustomerFor, saveCustomerLocationFor, saveCustomerContactFor, parseEntrada } from "../domain/cadastro.js";
import { codigoDoNovoCadastro } from "../domain/customer-identity.js";
import { salvarContrato, registrarAditivo, SAVE_CONTRACT_INPUT, RECORD_ADITIVO_INPUT } from "../domain/contratos.js";
import { saveQuoteFor, SaveQuoteInput } from "../domain/quotes.js";
import { saveMedicaoFor, SaveMedicaoInput } from "../domain/medicoes.js";
import { comercialLiberado } from "../domain/liberacao.js";
import { object, invalid, denied, requireCustomer, requireScope, readPage, type ApiContext, type ApiRequest, type ModuleDefinition, type ModuleRoute } from "./shared/core.js";

function caller(ctx: ApiContext): ComercialProfile { return ctx.integration.kind === "personal" ? ctx.actor : { ...ctx.actor, role: "comercial" }; }

type Shape = { [key: string]: true | Shape };
const address: Shape = { logradouro: true, numero: true, complemento: true, bairro: true, cidade: true, uf: true, cep: true };
const line: Shape = { id: true, origem: true, lpu_item_id: true, quantidade: true, preco: true, preco_tabela: true, codigo: true, origem_local: true, destino_local: true, total_cents: true, descricao: true, item: true, servico: true, unidade: true, motivo: true };
const contract: Shape = { customer_code: true, nome: true, objeto: true, status: true, edicao: true, vigente_de: true, vigente_ate: true, numeros: { tipo: true, numero: true }, renovacao: { tipo: true, aviso_dias: true, oposicao_ate_dias: true }, reajuste: { tipo: true, indice: true, data_base: true }, regimes: { servico: true, regime: true }, regime_padrao: true, autorizacao: { tipo: true, prazo_perda_dias: true }, pagamento: { tipo: true, dias: true, texto: true, faixas: { de: true, ate: true, dia: true, mes: true } }, impostos: { inclusos: true, texto: true }, codigo_servico: true };
const quote: Shape = { numero: true, customer_code: true, contrato_id: true, status: true, edicao: true, rv: true, tipo_rv: true, data_base: true, tabela_id: true, variante: true, linhas: line, total_cents: true, condicoes: true, validade_dias: true };
const shapes: Record<string, Shape> = {
  clientes: { code: true, customer_code: true, name: true, legal_name: true, document: true, stage: true, status: true, archived: true, comercial: { responsavel_uid: true, cidade: true, uf: true } },
  locais: { customer_code: true, nome: true, sigla: true, endereco: address, ativo: true },
  contatos: { customer_code: true, nome: true, email: true, telefone: true, empresa: true, papel: true, avisos: true, ativo: true },
  contratos: contract,
  aditivos: { numero: true, tipo: true, assinado_em: true, vigente_de: true, vigente_ate: true, tabela_ids: true, observacao: true },
  tabelas: { customer_code: true, contract_id: true, nome: true, name: true, status: true, vigente_de: true, vigente_ate: true, variante: true, precos: { "*": { codigo: true, descricao_cliente: true, preco: true } } },
  demandas: { numero: true, customer_code: true, contrato_id: true, titulo: true, etapa: true, tipo: true, canal: true, ref_cliente: true, contato_id: true, solicitante: { contato_id: true, empresa: true }, origem: { local_id: true, complemento: true }, destino: { local_id: true, complemento: true }, execucao: { datas: true, de: true, ate: true, a_definir: true, visita_tecnica: true } },
  orcamentos: quote, revisoes: quote,
  medicoes: { customer_code: true, contrato_id: true, competencia: true, variante: true, status: true, edicao: true, total_cents: true, linhas: { id: true, demanda_numero: true, os: true, solicitada_em: true, area_solicitante: true, executada_em: true, dia_tipo: true, janela: true, origem: true, destino: true, mercadoria: true, itens: line, total_cents: true } },
};
export function projectComercial(data: Record<string, unknown>, shape: Shape): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(shape)) {
    if (key === "*" && child !== true) {
      for (const [entry, item] of Object.entries(data)) if (/^[A-Za-z0-9_-]{1,120}$/.test(entry) && item && typeof item === "object" && !Array.isArray(item)) result[entry] = projectComercial(item as Record<string, unknown>, child);
      continue;
    }
    const value = data[key];
    if (value === undefined) continue;
    if (child === true) {
      // Scalar arrays (dates, codes, notification models) may not carry objects.
      if (value === null || ["string", "number", "boolean"].includes(typeof value)) result[key] = value;
      else if (Array.isArray(value)) result[key] = value.filter(v => v === null || ["string", "number", "boolean"].includes(typeof v));
    } else if (value === null) result[key] = null;
    else if (Array.isArray(value)) result[key] = value.filter(v => v && typeof v === "object" && !Array.isArray(v)).map(v => projectComercial(v, child));
    else if (typeof value === "object") result[key] = projectComercial(value as Record<string, unknown>, child);
  }
  return result;
}
const collections: Record<string, string> = { clientes: "customers", locais: "customer_locations", contatos: "customer_contacts", contratos: "contracts", tabelas: "price_tables", demandas: "demands", orcamentos: "quotes", medicoes: "medicoes" };
function id(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(value)) invalid("Id inválido.");
  return value;
}
/** As leituras de autorização participam da mesma transação das escritas de domínio. */
function guardedDb(ctx: ApiContext, guard: (tx: Transaction) => Promise<void>): Firestore {
  return new Proxy(ctx.db, {
    get(db, property) {
      if (property === "runTransaction") return (work: (tx: Transaction) => Promise<unknown>) => db.runTransaction(async tx => { await guard(tx); return work(tx); });
      const member = Reflect.get(db, property, db);
      return typeof member === "function" ? member.bind(db) : member;
    },
  });
}
async function target(ctx: ApiContext, collection: string, key: unknown, code?: string, tx?: Transaction) {
  const ref = ctx.db.collection(collection).doc(id(key));
  const snapshot = tx ? await tx.get(ref) : await ref.get();
  if (!snapshot.exists) throw new HttpsError("not-found", "Registro não encontrado.");
  const data = snapshot.data()!;
  const customer = data.customer_code ?? (collection === "customers" ? data.code : undefined);
  requireCustomer(ctx, customer);
  if (code !== undefined && customer !== code) denied("O vínculo pertence a outro cliente.");
  return { id: snapshot.id, data, code: customer as string };
}
function body(request: ApiRequest, keys: readonly string[]) {
  const value = object(request.body);
  const extra = Object.keys(value).filter(k => !keys.includes(k));
  if (extra.length) invalid(`Campo não aceito: ${extra.join(", ")}.`);
  return value;
}
function route(method: ModuleRoute["method"], path: string, scope: ModuleRoute["scope"], summary: string, run: ModuleRoute["run"]): ModuleRoute {
  return { method, path: `/api/v1/comercial/${path}`, scope, role: "comercial", summary, run: async (ctx, params, request) => { requireScope(ctx, scope); if (ctx.integration.kind === "personal") { if (!ctx.integration.principal) denied(); authorizePersonalRoute(ctx.integration.principal, method, `/api/v1/comercial/${path}`, scope, request.body); } return run(ctx, params, request); } };
}
const routes: ModuleRoute[] = [];
for (const [resource, collection] of Object.entries(collections)) {
  const shape = shapes[resource];
  routes.push(route("GET", resource, "comercial:ler", `Listar ${resource}`, async (ctx, _, request) => {
    // customers stores both code and customer_code; readPage deliberately requires the real tenant code.
    const page = await readPage(ctx, collection, Object.keys(shape), request, { customerField: resource === "clientes" ? "code" : "customer_code" });
    return { ...page, data: page.data.map(row => ({ id: row.id, ...projectComercial(row, shape) })) };
  }));
  routes.push(route("GET", `${resource}/{id}`, "comercial:ler", `Consultar ${resource}`, async (ctx, params) => {
    const row = await target(ctx, collection, params.id);
    return { data: { id: row.id, ...projectComercial(row.data, shape) } };
  }));
}
for (const [resource, collection, child, subcollection] of [["contratos", "contracts", "aditivos", "aditivos"], ["orcamentos", "quotes", "revisoes", "revisoes"]]) {
  routes.push(route("GET", `${resource}/{id}/${child}`, "comercial:ler", `Listar ${child}`, async (ctx, params, request) => {
    await target(ctx, collection, params.id);
    const shape = shapes[child];
    const page = await readPage(ctx, `${collection}/${id(params.id)}/${subcollection}`, Object.keys(shape), request);
    return { ...page, data: page.data.map(row => ({ id: row.id, ...projectComercial(row, shape) })) };
  }));
}
const customerFields = ["name", "legal_name", "document", "comercial"];
routes.push(route("POST", "clientes", "comercial:clientes:gravar", "Criar prospect", async (ctx, _, request) => {
  const input = body(request, ["code", ...customerFields]);
  // Explicit code prevents a generated code from escaping the authorized tenant list.
  requireCustomer(ctx, input.code);
  const code = codigoDoNovoCadastro(input.code, input.name);
  requireCustomer(ctx, code);
  const commercial = input.comercial === undefined ? {} : object(input.comercial);
  return saveCommercialCustomerFor(ctx.db, caller(ctx), { ...input, comercial: { ...commercial, responsavel_uid: commercial.responsavel_uid === undefined ? ctx.integration.delegated_by : commercial.responsavel_uid }, code, action: "create", idempotency_key: ctx.idempotencyKey });
}));
routes.push(route("PATCH", "clientes/{id}", "comercial:clientes:gravar", "Alterar cadastro comercial", async (ctx, params, request) => {
  const input = body(request, customerFields);
  const row = await target(ctx, "customers", params.id);
  return saveCommercialCustomerFor(guardedDb(ctx, async tx => { await target(ctx, "customers", params.id, row.code, tx); }), caller(ctx), { ...input, customer_code: row.code, action: "update", idempotency_key: ctx.idempotencyKey });
}));
routes.push(route("POST", "clientes/{id}/marcar-cliente", "comercial:clientes:gravar", "Marcar prospect como cliente", async (ctx, params, request) => {
  body(request, []);
  const row = await target(ctx, "customers", params.id);
  return saveCommercialCustomerFor(guardedDb(ctx, async tx => { await target(ctx, "customers", params.id, row.code, tx); }), caller(ctx), { action: "mark_client", customer_code: row.code, idempotency_key: ctx.idempotencyKey });
}));
for (const [resource, collection, key, fields, save] of [
  ["locais", "customer_locations", "local_id", ["nome", "sigla", "endereco", "ativo"], saveCustomerLocationFor],
  ["contatos", "customer_contacts", "contato_id", ["nome", "email", "telefone", "empresa", "papel", "avisos", "ativo"], saveCustomerContactFor],
] as const) {
  for (const method of ["POST", "PATCH"] as const) routes.push(route(method, resource + (method === "PATCH" ? "/{id}" : ""), "comercial:clientes:gravar", `${method === "POST" ? "Criar" : "Alterar"} ${resource}`, async (ctx, params, request) => {
    const input = body(request, ["customer_code", ...fields]);
    requireCustomer(ctx, input.customer_code);
    if (method === "PATCH") await target(ctx, collection, params.id, input.customer_code);
    return save(guardedDb(ctx, async tx => { if (method === "PATCH") await target(ctx, collection, params.id, input.customer_code as string, tx); }), caller(ctx), { ...input, ...(method === "PATCH" ? { [key]: id(params.id) } : {}), idempotency_key: ctx.idempotencyKey });
  }));
}
for (const method of ["POST", "PATCH"] as const) routes.push(route(method, "contratos" + (method === "PATCH" ? "/{id}" : ""), "comercial:contratos:gravar", `${method === "POST" ? "Criar" : "Alterar"} contrato`, async (ctx, params, request) => {
  const input = body(request, method === "POST" ? ["contrato"] : ["contrato", "edicao"]);
  const data = parseEntrada(SAVE_CONTRACT_INPUT, { ...input, acao: method === "POST" ? "criar" : "atualizar", ...(method === "PATCH" ? { contrato_id: id(params.id) } : {}), idempotency_key: ctx.idempotencyKey });
  requireCustomer(ctx, data.contrato.customer_code);
  if (method === "PATCH") await target(ctx, "contracts", params.id, data.contrato.customer_code);
  // Ending contracts is deliberately outside the integration's create/update contract.
  if (data.contrato.status !== "vigente") denied("A API grava somente contratos vigentes.");
  return salvarContrato(guardedDb(ctx, async tx => { if (method === "PATCH") await target(ctx, "contracts", params.id, data.contrato.customer_code, tx); }), caller(ctx), data);
}));
routes.push(route("POST", "contratos/{id}/aditivos", "comercial:contratos:gravar", "Registrar aditivo", async (ctx, params, request) => {
  const input = body(request, ["aditivo"]);
  const data = parseEntrada(RECORD_ADITIVO_INPUT, { ...input, contrato_id: id(params.id), idempotency_key: ctx.idempotencyKey });
  const row = await target(ctx, "contracts", params.id);
  for (const table of data.aditivo.tabela_ids) {
    const linked = await target(ctx, "price_tables", table, row.code);
    if (linked.data.contract_id !== params.id) denied("Tabela de outro contrato.");
  }
  return registrarAditivo(guardedDb(ctx, async tx => {
    await target(ctx, "contracts", params.id, row.code, tx);
    for (const table of data.aditivo.tabela_ids) {
      const linked = await target(ctx, "price_tables", table, row.code, tx);
      if (linked.data.contract_id !== params.id) denied("Tabela de outro contrato.");
    }
  }), caller(ctx), data);
}));
const demandFields = ["contrato_id", "canal", "tipo", "titulo", "ref_cliente", "contato_id", "recebida_em", "email_assunto", "email_link", "origem", "destino", "execucao", "numero_legado"];
const quoteFields = ["variante", "linhas", "condicoes", "validade_dias", "observacoes_internas"];
async function quoteLinks(ctx: ApiContext, data: Record<string, unknown>, code: string, tx?: Transaction) {
  if (data.contrato_id) await target(ctx, "contracts", data.contrato_id, code, tx);
  if (data.contato_id) await target(ctx, "customer_contacts", data.contato_id, code, tx);
  for (const key of ["origem", "destino"]) if (data[key] && object(data[key]).local_id) await target(ctx, "customer_locations", object(data[key]).local_id, code, tx);
  for (const raw of (data.linhas ?? []) as Record<string, unknown>[]) {
    for (const field of ["origem_local", "destino_local"]) if (raw[field]) await target(ctx, "customer_locations", raw[field], code, tx);
  }
}
for (const method of ["POST", "PATCH"] as const) routes.push(route(method, "orcamentos" + (method === "PATCH" ? "/{id}" : ""), "comercial:orcamentos:gravar", `${method === "POST" ? "Criar" : "Alterar"} orçamento em rascunho`, async (ctx, params, request) => {
  const input = body(request, [...demandFields, ...quoteFields, ...(method === "POST" ? ["customer_code", "entrada"] : ["expected_edicao", "vistoria_os"])]);
  const data = parseEntrada(SaveQuoteInput, { ...input, action: method === "POST" ? "create" : "update", ...(method === "PATCH" ? { numero: id(params.id) } : {}), request_id: ctx.idempotencyKey });
  let code: string;
  if (data.action === "create") { requireCustomer(ctx, data.customer_code); code = data.customer_code; }
  else {
    const row = await target(ctx, "quotes", params.id);
    code = row.code;
    const demand = await target(ctx, "demands", params.id, code);
    await quoteLinks(ctx, demand.data, code);
  }
  await quoteLinks(ctx, data, code);
  if (data.action === "update" && data.vistoria_os) await target(ctx, "service_orders", data.vistoria_os, code);
  return saveQuoteFor(guardedDb(ctx, async tx => {
    if (data.action === "update") {
      const quote = await target(ctx, "quotes", params.id, code, tx);
      const demand = await target(ctx, "demands", params.id, code, tx);
      await quoteLinks(ctx, { ...demand.data, linhas: quote.data.linhas }, code, tx);
      const tableId = quote.data.tabela && object(quote.data.tabela).id;
      if (tableId) {
        const table = await tx.get(ctx.db.collection("price_tables").doc(id(tableId)));
        if (!table.exists) throw new HttpsError("not-found", "Tabela não encontrada.");
        if (table.get("customer_code") != null) {
          requireCustomer(ctx, table.get("customer_code"));
          if (table.get("customer_code") !== code) denied("Tabela de outro cliente.");
        }
      }
      if (data.vistoria_os) await target(ctx, "service_orders", data.vistoria_os, code, tx);
    }
    await quoteLinks(ctx, data, code, tx);
  }), caller(ctx), data);
}));
routes.push(route("POST", "medicoes", "comercial:medicoes:gravar", "Abrir medição mensal", async (ctx, _, request) => {
  const input = body(request, ["contrato_id", "competencia", "variante"]);
  const data = parseEntrada(SaveMedicaoInput, { ...input, action: "create", request_id: ctx.idempotencyKey });
  if (data.action !== "create") invalid("Ação inválida.");
  const contract = await target(ctx, "contracts", data.contrato_id);
  return saveMedicaoFor(guardedDb(ctx, async tx => { await target(ctx, "contracts", data.contrato_id, contract.code, tx); }), caller(ctx), data);
}));
routes.push(route("PATCH", "medicoes/{id}/linhas", "comercial:medicoes:gravar", "Incluir ou alterar linha de medição em rascunho", async (ctx, params, request) => {
  const input = body(request, ["expected_edicao", "linha"]);
  const data = parseEntrada(SaveMedicaoInput, { ...input, medicao_id: id(params.id), action: "upsert_line", request_id: ctx.idempotencyKey });
  if (data.action !== "upsert_line") invalid("Ação inválida.");
  const row = await target(ctx, "medicoes", params.id);
  await target(ctx, "contracts", row.data.contrato_id, row.code);
  for (const existing of (row.data.linhas ?? []) as Record<string, unknown>[]) {
    if (!existing.demanda_numero) continue;
    const demand = await target(ctx, "demands", existing.demanda_numero, row.code);
    if (demand.data.contrato_id !== row.data.contrato_id) denied("Demanda de outro contrato.");
  }
  if (data.linha.demanda_numero) {
    const linked = await target(ctx, "demands", data.linha.demanda_numero, row.code);
    if (linked.data.contrato_id !== row.data.contrato_id) denied("Demanda de outro contrato.");
  }
  return saveMedicaoFor(guardedDb(ctx, async tx => {
    const current = await target(ctx, "medicoes", params.id, row.code, tx);
    await target(ctx, "contracts", current.data.contrato_id, row.code, tx);
    const numbers = new Set(((current.data.linhas ?? []) as Record<string, unknown>[]).map(line => line.demanda_numero).filter(Boolean));
    if (data.linha.demanda_numero) numbers.add(data.linha.demanda_numero);
    for (const number of numbers) {
      const demand = await target(ctx, "demands", number, row.code, tx);
      if (demand.data.contrato_id !== current.data.contrato_id) denied("Demanda de outro contrato.");
    }
  }), caller(ctx), data);
}));

export const comercialApi: ModuleDefinition = { module: "comercial", released: comercialLiberado, routes };
