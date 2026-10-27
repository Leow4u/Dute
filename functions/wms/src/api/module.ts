import { type Firestore, type Transaction } from "firebase-admin/firestore";
import { z } from "genkit";
import { HttpsError } from "firebase-functions/https";
import { advanceWarehouseTaskTransaction, createCustomerRequestTransaction, decideCustomerRequestTransaction, createInboundReceiptTransaction, updateInboundReceiptConferenceTransaction, createInventoryMovementTransaction } from "../domain/operations.js";
import { authorizePersonalRoute } from "./shared/principal.js";
import { denied, digest, invalid, object, projectFields, readPage, requireCustomer, requireScope, type ApiContext, type ModuleDefinition, type ModuleRoute } from "./shared/core.js";

const base = "/api/v1/armazenagem";
const text = z.string().trim().min(1).max(2000);
const id = z.string().trim().min(1).max(200).regex(/^[A-Za-z0-9_.-]+$/);
const item = z.object({
  sku_code: id.optional(), client_item_code: text.optional(), product_name: text.optional(),
  product_registration: z.enum(["existing", "new"]).optional(), location_id: id.optional(),
  quantity: z.number().positive(), notes: text.optional(), category: text.optional(), barcode: text.optional(),
  brand: text.optional(), size: text.optional(), color: text.optional(), condition: text.optional(),
}).strict();
const requestSchema = z.object({ customer_code: text, type: z.enum(["recebimento", "retirada", "solicitacao"]), priority: z.enum(["normal", "high", "urgent"]).default("normal"), title: text.optional(), description: text.optional(), destination: text.optional(), due_at: text.optional(), supplier: text.optional(), invoice_number: text.optional(), items: z.array(item).min(1).max(100) }).strict();
const receiptSchema = z.object({ customer_code: text, supplier: text.optional(), invoice_number: text.optional(), reference: text.optional(), notes: text.optional(), priority: text.default("normal"), received_at: text.optional(), items: z.array(item).min(1).max(100) }).strict();
const decisionSchema = z.object({ action: z.enum(["approve", "close"]), expected_status: text, reason: text.optional() }).strict();
const conferenceSchema = z.object({ expected_version: z.string().regex(/^\d+:\d{1,9}$/), expected_status: text, lines: z.array(z.object({ inbound_item_id: id, received_qty: z.number().nonnegative(), location_id: id.optional(), notes: text.optional(), client_item_code: text.optional() }).strict()).min(1).max(100) }).strict();
const movementSchema = z.object({ customer_code: text, type: z.enum(["ENTRADA", "SAIDA"]), quantity: z.number().positive(), sku_code: id, location_id: id, reason: text, reference: text.optional(), occurred_at: text.optional() }).strict();
const advanceSchema = z.object({ expected_status: z.enum(["created", "checking"]), note: text.optional() }).strict();
function parse<S extends z.ZodTypeAny>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) invalid("Corpo inválido: " + result.error.issues.map((issue) => issue.path.join(".") + ": " + issue.message).join("; "));
  return result.data as z.output<S>;
}
const fields = {
  catalogo: ["customer_code", "sku_code", "cod_btg", "cod_cliente", "produto", "status", "category", "brand", "size", "color", "barcode"],
  posicoes: ["customer_code", "code", "aisle", "shelf", "status", "length_m", "depth_m", "height_m", "sequence"],
  estoque: ["customer_code", "sku_code", "client_item_code", "product_name", "location_id", "qty_on_hand", "qty_reserved", "qty_available", "status"],
  pedidos: ["customer_code", "request_number", "type", "status", "priority", "title", "description", "destination", "due_at", "quantity_total", "created_at", "updated_at"],
  recebimentos: ["customer_code", "receipt_number", "supplier", "invoice_number", "reference", "status", "priority", "qty_expected", "qty_received", "item_count", "created_at", "updated_at"],
  movimentacoes: ["customer_code", "sku_code", "client_item_code", "product_name", "location_id", "tipo_mov", "qtde", "type", "quantity", "saldo_delta", "estoque_resultante", "occurred_at", "created_at"],
  itens: ["customer_code", "receipt_id", "line_number", "sku_code", "client_item_code", "product_name", "expected_qty", "received_qty", "location_id", "status"],
};
type ReadContext = ApiContext & { transaction?: Transaction };
function guardedDb(ctx: ApiContext, guard: (read: ReadContext) => Promise<void>): Firestore {
  return new Proxy(ctx.db, {
    get(database, property) {
      if (property === "runTransaction") return (work: (tx: Transaction) => Promise<unknown>) => database.runTransaction(async tx => {
        await guard({ ...ctx, transaction: tx });
        return work(tx);
      });
      const member = Reflect.get(database, property, database);
      return typeof member === "function" ? member.bind(database) : member;
    },
  });
}
async function target(ctx: ReadContext, collection: string, targetId: string): Promise<Record<string, unknown> & { expected_version: string }> {
  parse(id, targetId);
  const ref = ctx.db.collection(collection).doc(targetId);
  const snapshot = ctx.transaction ? await ctx.transaction.get(ref) : await ref.get();
  if (!snapshot.exists) throw new HttpsError("not-found", "Registro não encontrado.");
  const data = snapshot.data()!;
  requireCustomer(ctx, data.customer_code);
  return { ...data, expected_version: `${snapshot.updateTime!.seconds}:${snapshot.updateTime!.nanoseconds}` };
}
async function location(ctx: ReadContext, code: string, customer: string) {
  const data = await target(ctx, "warehouse_positions", code);
  if (data.customer_code !== customer || (data.status && data.status !== "active")) denied("Posição fora da zona ativa do cliente.");
}
async function sku(ctx: ReadContext, code: string, customer: string) {
  const data = await target(ctx, "skus", code);
  if (data.customer_code !== customer) denied("SKU de outro cliente.");
}
async function related(ctx: ReadContext, data: Record<string, unknown>, customer: string) {
  for (const [field, collection] of [["customer_request_id", "customer_requests"], ["order_id", "orders"]] as const) {
    if (typeof data[field] === "string" && data[field]) {
      const parent = await target(ctx, collection, String(data[field]));
      if (parent.customer_code !== customer) denied("Vínculo de outro cliente.");
    }
  }
}
async function stockLocations(ctx: ReadContext, customer: string, code: string, selected?: string) {
  const query = ctx.db.collection("stock_balances").where("customer_code", "==", customer).where("sku_code", "==", code);
  const rows = ctx.transaction ? await ctx.transaction.get(query) : await query.get();
  for (const row of rows.docs) {
    const balance = row.data();
    if (!selected || balance.location_id === selected) await location(ctx, String(balance.location_id), customer);
  }
}
async function validateItems(ctx: ReadContext, customer: string, items: z.infer<typeof item>[]) {
  for (const line of items) {
    if (line.sku_code) await sku(ctx, line.sku_code, customer);
    // Novos produtos podem nascer apenas pelo recebimento. Códigos existentes
    // devem vir com SKU explícito; não permitir resolução ambígua por código.
    if (!line.sku_code && line.product_registration !== "new") invalid("Informe sku_code ou product_registration=new.");
    if (line.product_registration === "new" && line.sku_code) invalid("Produto novo não recebe SKU informado.");
    if (line.location_id) await location(ctx, line.location_id, customer);
  }
}
function route(method: ModuleRoute["method"], path: string, scope: ModuleRoute["scope"], summary: string, run: ModuleRoute["run"]): ModuleRoute {
  return { method, path: base + path, scope, role: "wms", summary, run: async (ctx, params, request) => { requireScope(ctx, scope); if (ctx.integration.kind === "personal") { if (!ctx.integration.principal) denied(); authorizePersonalRoute(ctx.integration.principal, method, base + path, scope, request.body); if (request.query.customer_code !== undefined) requireCustomer(ctx, request.query.customer_code); } return run(ctx, params, request); } };
}
const reads = [
  ["catalogo", "skus"], ["posicoes", "warehouse_positions"], ["estoque", "stock_balances"],
  ["pedidos", "customer_requests"], ["recebimentos", "inbound_receipts"], ["movimentacoes", "movements"],
] as const;
export const armazenagemApi: ModuleDefinition = {
  module: "armazenagem",
  released: (project) => ["dute-prod", "dute-homolog", "demo-dute-api-wms"].includes(project),
  routes: [
    ...reads.map(([name, collection]) => route("GET", `/${name}`, "armazenagem:ler", `Consultar ${name}`, (ctx, _params, request) => readPage(ctx, ctx.integration.kind === "personal" && (ctx.actor.role === "cliente" || ctx.actor.role === "financeiro") && name === "estoque" ? "client_inventory" : ctx.integration.kind === "personal" && ctx.actor.role === "cliente" && name === "pedidos" ? "client_request_status" : collection, fields[name], request, { customerField: "customer_code" }))),
    route("GET", "/pedidos/{id}", "armazenagem:ler", "Consultar pedido", async (ctx, params) => ({ data: projectFields(params.id!, await target(ctx, ctx.integration.kind === "personal" && ctx.actor.role === "cliente" ? "client_request_status" : "customer_requests", params.id!), fields.pedidos) })),
    route("GET", "/recebimentos/{id}", "armazenagem:ler", "Consultar recebimento", async (ctx, params) => ({ data: projectFields(params.id!, await target(ctx, "inbound_receipts", params.id!), [...fields.recebimentos, "expected_version"]) })),
    route("GET", "/recebimentos/{id}/itens", "armazenagem:ler", "Consultar linhas do recebimento", async (ctx, params, request) => {
      const receipt = await target(ctx, "inbound_receipts", params.id!);
      const page = await readPage(ctx, "inbound_items", fields.itens, request, { customerField: "customer_code" });
      // Filtro por relação sem expor linhas de outro recebimento. A paginação
      // permanece pelo cliente; páginas vazias podem ter next_cursor.
      if (request.query.customer_code !== undefined && request.query.customer_code !== receipt.customer_code) denied();
      if (ctx.integration.kind !== "personal" && request.query.customer_code === undefined) denied();
      return { ...page, data: page.data.filter((line) => object(line).receipt_id === params.id) };
    }),
    route("POST", "/pedidos", "armazenagem:pedidos:gravar", "Criar pedido", async (ctx, _params, request) => {
      const input = parse(requestSchema, request.body); requireCustomer(ctx, input.customer_code);
      const database = guardedDb(ctx, async ctx => {
      await validateItems(ctx, input.customer_code, input.items);
      if (input.type === "retirada") {
        if (input.items.some((line) => !line.sku_code)) invalid("Retirada exige SKUs existentes.");
        for (const line of input.items) await stockLocations(ctx, input.customer_code, line.sku_code!, line.location_id);
      }
      });
      return createCustomerRequestTransaction(database, { ...input, idempotency_key: ctx.idempotencyKey }, ctx.actor);
    }),
    route("PATCH", "/pedidos/{id}", "armazenagem:pedidos:gravar", "Aprovar ou encerrar pedido", async (ctx, params, request) => {
      const input = parse(decisionSchema, request.body);
      const database = guardedDb(ctx, async ctx => { const pedido = await target(ctx, "customer_requests", params.id!);
      await related(ctx, pedido, String(pedido.customer_code));
      const items = Array.isArray(pedido.items) ? pedido.items : [];
      for (const entry of items) { const line = object(entry); if (typeof line.sku_code === "string" && line.sku_code) {
        await sku(ctx, line.sku_code, String(pedido.customer_code));
        if (pedido.type === "retirada") await stockLocations(ctx, String(pedido.customer_code), line.sku_code, typeof line.location_id === "string" ? line.location_id : undefined);
      } }
      });
      return decideCustomerRequestTransaction(database, { ...input, request_id: params.id!, idempotency_key: ctx.idempotencyKey }, ctx.actor);
    }),
    route("POST", "/recebimentos", "armazenagem:recebimentos:gravar", "Criar recebimento", async (ctx, _params, request) => {
      const input = parse(receiptSchema, request.body); requireCustomer(ctx, input.customer_code);
      const database = guardedDb(ctx, ctx => validateItems(ctx, input.customer_code, input.items));
      return createInboundReceiptTransaction(database, { ...input, idempotency_key: ctx.idempotencyKey }, ctx.actor);
    }),
    route("PATCH", "/recebimentos/{id}", "armazenagem:recebimentos:gravar", "Conferir recebimento", async (ctx, params, request) => {
      const input = parse(conferenceSchema, request.body);
      const database = guardedDb(ctx, async ctx => { const receipt = await target(ctx, "inbound_receipts", params.id!);
      await related(ctx, receipt, String(receipt.customer_code));
      for (const line of input.lines) {
        const stored = await target(ctx, "inbound_items", line.inbound_item_id);
        if (stored.receipt_id !== params.id || stored.customer_code !== receipt.customer_code) denied("Linha de outro recebimento.");
        if (stored.sku_code) await sku(ctx, String(stored.sku_code), String(receipt.customer_code));
        if (line.location_id) await location(ctx, line.location_id, String(receipt.customer_code));
      }
      const operationId = "op_inbound_conference_" + digest({ receiptId: params.id!, nonce: ctx.idempotencyKey }).slice(0, 32);
      const previous = await ctx.transaction!.get(ctx.db.collection("operational_operations").doc(operationId));
      // O domínio verifica o hash em replays. CAS vale para a primeira execução.
      if (!previous.exists && receipt.expected_version !== input.expected_version) throw new HttpsError("aborted", "Recebimento alterado. Consulte novamente e use expected_version atual.");
      });
      return updateInboundReceiptConferenceTransaction(database, { ...input, receipt_id: params.id!, idempotency_key: ctx.idempotencyKey }, ctx.actor);
    }),
    route("POST", "/recebimentos/{id}/avancar", "armazenagem:recebimentos:gravar", "Iniciar ou concluir conferência", async (ctx, params, request) => {
      const input = parse(advanceSchema, request.body);
      const database = guardedDb(ctx, async ctx => { const receipt = await target(ctx, "inbound_receipts", params.id!);
      await related(ctx, receipt, String(receipt.customer_code));
      const rows = await ctx.transaction!.get(ctx.db.collection("inbound_items").where("receipt_id", "==", params.id!));
      for (const row of rows.docs) { const line = row.data(); if (line.customer_code !== receipt.customer_code) denied(); if (line.sku_code) await sku(ctx, String(line.sku_code), String(receipt.customer_code)); if (line.location_id && line.location_id !== "RECEBIMENTO") await location(ctx, String(line.location_id), String(receipt.customer_code)); }
      });
      return advanceWarehouseTaskTransaction(database, { ...input, task_uid: `receiving:${params.id}`, idempotency_key: ctx.idempotencyKey }, ctx.actor);
    }),
    route("POST", "/movimentacoes", "armazenagem:estoque:movimentar", "Registrar movimento no razão", async (ctx, _params, request) => {
      const input = parse(movementSchema, request.body); requireCustomer(ctx, input.customer_code);
      const database = guardedDb(ctx, async ctx => { await sku(ctx, input.sku_code, input.customer_code); await location(ctx, input.location_id, input.customer_code); });
      return createInventoryMovementTransaction(database, { ...input, idempotency_key: ctx.idempotencyKey }, ctx.actor);
    }),
  ],
};
