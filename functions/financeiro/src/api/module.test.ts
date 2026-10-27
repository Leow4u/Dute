import assert from "node:assert/strict";
import { describe, it, test } from "node:test";
import type { Firestore } from "firebase-admin/firestore";
import { financeiroApi } from "./module.js";
import type { ApiContext, ApiRequest } from "./shared/core.js";

const context = (scopes: string[]): ApiContext => ({ db: {} as Firestore, project: "dute-homolog", integration: { id: "fin", delegated_by: "human", customers: ["ITAU"], scopes, write_policy: "scoped" }, actor: { uid: "api:fin", role: "financeiro", name: "Integração" }, idempotencyKey: "isolated" });
const run = async (method: string, suffix: string, body?: unknown, scopes: string[] = [], query = {}) => {
  const route = financeiroApi.routes.find(route => route.method === method && route.path === `/api/v1/financeiro${suffix}`)!;
  const request: ApiRequest = { method, path: route.path, headers: {}, query, body };
  return route.run(context(scopes), { id: `fat_${"a".repeat(24)}` }, request);
};
const error = (code: string) => (e: unknown) => (e as { code: string }).code === code;

describe("Financeiro REST: contrato e fronteiras antes de acesso ao banco", () => {
  it("expõe apenas consultas, registro externo, envio e recebimento", () => {
    assert.equal(financeiroApi.routes.length, 8);
    assert.ok(financeiroApi.routes.every(route => route.role === "financeiro"));
    assert.ok(financeiroApi.routes.every(route => !/omie|estorno|cancel|reverse/.test(route.path)));
    assert.equal(financeiroApi.released("dute-btg"), false);
    assert.equal(financeiroApi.released("dute-homolog"), true);
  });
  it("nega leitura e todas as mutações sem seus escopos", async () => {
    for (const route of financeiroApi.routes) await assert.rejects(run(route.method, route.path.replace("/api/v1/financeiro", ""), {}), error("permission-denied"));
  });
  it("exige tenant explícito em todas as listagens", async () => {
    for (const route of financeiroApi.routes.filter(route => route.method === "GET")) await assert.rejects(run("GET", route.path.replace("/api/v1/financeiro", ""), undefined, ["financeiro:ler"]), error("permission-denied"));
  });
  it("recusa tenant não autorizado, paginação ilimitada e filtros arbitrários", async () => {
    await assert.rejects(run("GET", "/a-faturar", undefined, ["financeiro:ler"], { customer_code: "SAFRA" }), error("permission-denied"));
    await assert.rejects(run("GET", "/a-faturar", undefined, ["financeiro:ler"], { customer_code: "ITAU", limit: 101 }), error("invalid-argument"));
    await assert.rejects(run("GET", "/a-faturar", undefined, ["financeiro:ler"], { customer_code: "ITAU", status: "paga" }), error("invalid-argument"));
  });
  it("recusa customer_code/status injetados no registro", async () => {
    const body = { demandas: ["10045"], nf: { numero: "1", emitida_em: "2026-10-01" }, vencimento: "2026-10-31", forma: "pix" };
    for (const extra of [{ customer_code: "ITAU" }, { status: "paga" }, { idempotency_key: "injected" }]) await assert.rejects(run("POST", "/faturas", { ...body, ...extra }, ["financeiro:faturas:gravar"]), error("invalid-argument"));
  });
  it("rotas fixam ação e fatura e não admitem estorno, cancelamento ou edição de saldo", async () => {
    for (const [method, path, scope] of [["PATCH", "/faturas/{id}/cobranca", "financeiro:cobrancas:gravar"], ["POST", "/faturas/{id}/pagamentos", "financeiro:pagamentos:registrar"]]) {
      for (const body of [{ acao: "cancel" }, { acao: "reverse_payment" }, { fatura_id: "other" }, { status: "paga" }, { recebido_cents: 1 }]) await assert.rejects(run(method, path, body, [scope]), error("invalid-argument"));
    }
  });
});

// Personal API adapters: the domain actor and the portal collection are observable boundaries.

test("pessoal cliente lê sem papel sintético e usa projeção autorizada", async () => {
  const collections: string[] = [];
  const query = { orderBy() { return this; }, where() { return this; }, limit() { return this; }, async get() { return { docs: [], size: 0 }; } };
  const personal = { db: { collection(name: string) { collections.push(name); return query; } }, integration: { id: "personal", delegated_by: "human", kind: "personal", permission: "full", customers: [], scopes: ["financeiro:ler"], write_policy: "scoped", principal: { uid: "human", role: "cliente", customer_code: "A", modules: ["wms", "financeiro"], portal_active: true } }, actor: { uid: "api:personal", role: "cliente", name: "Pessoa" } } as unknown as ApiContext;
  const route = financeiroApi.routes.find(r => r.method === "GET" && r.path.endsWith("/faturas"))!;
  await route.run(personal, {}, { method: "GET", path: route.path, headers: {}, query: {} });
  assert.deepEqual(collections, ["client_faturas"]);
});
test("pessoal cliente não lê recurso interno mesmo com escopo agregado", async () => {
  const route = financeiroApi.routes.find(r => r.method === "GET" && r.path.endsWith("/pagamentos"))!;
  const personal = { db: {}, integration: { id: "p", kind: "personal", scopes: [route.scope], principal: { uid: "human", role: "cliente", customer_code: "A", modules: ["wms", "financeiro"], portal_active: true } }, actor: { uid: "api:p", role: "cliente" } } as unknown as ApiContext;
  await assert.rejects(route.run(personal, {}, { method: "GET", path: route.path, headers: {}, query: { customer_code: "A" } }), { code: "permission-denied" });
});

test("matriz pessoal dos onze papéis aplica guardas do adaptador", async () => {
  const allowed: Record<string, string[]> = {"faturas": ["owner", "admin", "comercial", "financeiro", "cliente"], "pagamentos": ["owner", "admin", "comercial", "financeiro"], "a-faturar": ["owner", "admin", "comercial", "financeiro"], "a-faturar/armazenagem": ["owner", "admin", "financeiro", "suporte"]};
  for (const role of ["owner", "admin", "interno", "wms", "campo", "comercial", "financeiro", "rh", "suporte", "painel", "cliente"]) {
    for (const [path, roles] of Object.entries(allowed)) {
      const route = financeiroApi.routes.find(r => r.method === "GET" && r.path.endsWith("/" + path))!;
      const query = { orderBy() { return this; }, where() { return this; }, limit() { return this; }, async get() { return { docs: [], size: 0 }; } };
      const ctx = { db: { collection() { return query; } }, integration: { id: "matrix", kind: "personal", scopes: [route.scope], principal: { uid: "human", role, customer_code: "A", modules: ["wms", "financeiro", "operacao"], portal_active: true } }, actor: { uid: "api:matrix", role } } as unknown as ApiContext;
      const execute = () => route.run(ctx, {}, { method: "GET", path: route.path, headers: {}, query: {} });
      if (roles.includes(role)) assert.deepEqual(await execute(), { data: [], next_cursor: null }, `${role} ${path}`);
      else await assert.rejects(execute(), { code: "permission-denied" }, `${role} ${path}`);
    }
  }
});
test("fatura do portal usa whitelist própria inclusive NF aninhada", async () => {
  const doc = { id: "f", data: () => ({ customer_code: "A", status: "emitida", periodo_ids: ["internal"], medicao_ids: ["internal"], registrada_em: "internal", nf: { numero: "9", serie: "1", emitida_em: "2026-10-01", private_note: "secret" } }) };
  const query = { orderBy() { return this; }, where() { return this; }, limit() { return this; }, async get() { return { docs: [doc], size: 1 }; } };
  const ctx = { db: { collection() { return query; } }, integration: { id: "p", kind: "personal", scopes: ["financeiro:ler"], principal: { uid: "h", role: "cliente", customer_code: "A", modules: ["financeiro"], portal_active: true } }, actor: { uid: "api:p", role: "cliente" } } as unknown as ApiContext;
  const route = financeiroApi.routes.find(r => r.method === "GET" && r.path.endsWith("/faturas"))!;
  const result = await route.run(ctx, {}, { method: "GET", path: route.path, headers: {}, query: {} }) as any;
  assert.deepEqual(result.data, [{ id: "f", customer_code: "A", status: "emitida", nf: { numero: "9", serie: "1", emitida_em: "2026-10-01" } }]);
});
