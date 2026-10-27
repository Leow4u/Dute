import assert from "node:assert/strict";
import { test } from "node:test";
import type { Firestore } from "firebase-admin/firestore";
import { armazenagemApi } from "./module.js";
import type { ApiContext } from "./shared/core.js";
const ctx: ApiContext = { db: {} as Firestore, project: "demo-dute-api-wms", actor: { uid: "api:test", role: "wms", name: "Teste" }, integration: { id: "test", delegated_by: "human", write_policy: "scoped", customers: ["A"], scopes: [] }, idempotencyKey: "key" };
test("rotas exigem escopo antes de ler ou gravar", async () => {
  for (const route of armazenagemApi.routes) {
    await assert.rejects(route.run(ctx, { id: "other" }, { method: route.method, path: route.path, headers: {}, query: {}, body: {} }), { code: "permission-denied" });
    assert.equal(route.role, "wms");
  }
});
test("não oferece saldo livre, catálogo mutável, exclusões ou cancelamentos", () => {
  assert.equal(armazenagemApi.routes.some((route) => route.method !== "GET" && /catalogo|estoque|posicoes/.test(route.path)), false);
  assert.equal(armazenagemApi.released("dute-btg"), false);
  assert.equal(armazenagemApi.released("demo-dute-api-wms"), true);
});
test("corpos recusam troca de cliente e ações fora da rota antes de I/O", async () => {
  const route = armazenagemApi.routes.find((entry) => entry.method === "PATCH" && entry.path.endsWith("pedidos/{id}"))!;
  const context = { ...ctx, integration: { ...ctx.integration, scopes: [route.scope] } };
  for (const body of [{ action: "cancel", expected_status: "open" }, { action: "approve", expected_status: "open", customer_code: "B" }, { action: "reject", expected_status: "open" }]) {
    await assert.rejects(route.run(context, { id: "request" }, { method: "PATCH", path: route.path, headers: {}, query: {}, body }), { code: "invalid-argument" });
  }
});
test("cliente fora da chave é recusado antes de consultar SKU", async () => {
  const route = armazenagemApi.routes.find((entry) => entry.method === "POST" && entry.path.endsWith("movimentacoes"))!;
  await assert.rejects(route.run({ ...ctx, integration: { ...ctx.integration, scopes: [route.scope] } }, {}, { method: "POST", path: route.path, headers: {}, query: {}, body: { customer_code: "B", type: "ENTRADA", quantity: 1, sku_code: "SKU", location_id: "A1", reason: "teste" } }), { code: "permission-denied" });
});

// Personal API adapters: the domain actor and the portal collection are observable boundaries.

test("pessoal cliente lê sem papel sintético e usa projeção autorizada", async () => {
  const collections: string[] = [];
  const query = { orderBy() { return this; }, where() { return this; }, limit() { return this; }, async get() { return { docs: [], size: 0 }; } };
  const personal = { db: { collection(name: string) { collections.push(name); return query; } }, integration: { id: "personal", delegated_by: "human", kind: "personal", permission: "full", customers: [], scopes: ["armazenagem:ler"], write_policy: "scoped", principal: { uid: "human", role: "cliente", customer_code: "A", modules: ["wms", "financeiro"], portal_active: true } }, actor: { uid: "api:personal", role: "cliente", name: "Pessoa" } } as unknown as ApiContext;
  const route = armazenagemApi.routes.find(r => r.method === "GET" && r.path.endsWith("/estoque"))!;
  await route.run(personal, {}, { method: "GET", path: route.path, headers: {}, query: {} });
  assert.deepEqual(collections, ["client_inventory"]);
});
test("pessoal cliente não lê recurso interno mesmo com escopo agregado", async () => {
  const route = armazenagemApi.routes.find(r => r.method === "GET" && r.path.endsWith("/catalogo"))!;
  const personal = { db: {}, integration: { id: "p", kind: "personal", scopes: [route.scope], principal: { uid: "human", role: "cliente", customer_code: "A", modules: ["wms", "financeiro"], portal_active: true } }, actor: { uid: "api:p", role: "cliente" } } as unknown as ApiContext;
  await assert.rejects(route.run(personal, {}, { method: "GET", path: route.path, headers: {}, query: { customer_code: "A" } }), { code: "permission-denied" });
});

test("matriz pessoal dos onze papéis aplica guardas do adaptador", async () => {
  const allowed: Record<string, string[]> = {"catalogo": ["owner", "admin", "interno", "wms", "suporte"], "estoque": ["owner", "admin", "interno", "wms", "suporte", "financeiro", "cliente"], "pedidos": ["owner", "admin", "interno", "wms", "suporte", "cliente"], "movimentacoes": ["owner", "admin", "interno", "wms", "suporte", "financeiro"]};
  for (const role of ["owner", "admin", "interno", "wms", "campo", "comercial", "financeiro", "rh", "suporte", "painel", "cliente"]) {
    for (const [path, roles] of Object.entries(allowed)) {
      const route = armazenagemApi.routes.find(r => r.method === "GET" && r.path.endsWith("/" + path))!;
      const query = { orderBy() { return this; }, where() { return this; }, limit() { return this; }, async get() { return { docs: [], size: 0 }; } };
      const ctx = { db: { collection() { return query; } }, integration: { id: "matrix", kind: "personal", scopes: [route.scope], principal: { uid: "human", role, customer_code: "A", modules: ["wms", "financeiro", "operacao"], portal_active: true } }, actor: { uid: "api:matrix", role } } as unknown as ApiContext;
      const execute = () => route.run(ctx, {}, { method: "GET", path: route.path, headers: {}, query: {} });
      if (roles.includes(role)) assert.deepEqual(await execute(), { data: [], next_cursor: null }, `${role} ${path}`);
      else await assert.rejects(execute(), { code: "permission-denied" }, `${role} ${path}`);
    }
  }
});
test("papéis pessoais com gravação de pedido não ganham decisão de coordenação", async () => {
  const route = armazenagemApi.routes.find(r => r.method === "PATCH" && r.path.endsWith("/pedidos/{id}"))!;
  for (const role of ["wms", "financeiro", "suporte", "cliente"]) {
    const personal = { db: {}, integration: { id: "p", kind: "personal", scopes: [route.scope], principal: { uid: "human", role, customer_code: "A", modules: ["wms"], portal_active: true } }, actor: { uid: "api:p", role } } as unknown as ApiContext;
    await assert.rejects(route.run(personal, { id: "request" }, { method: "PATCH", path: route.path, headers: {}, query: {}, body: { action: "approve", expected_status: "open" } }), { code: "permission-denied" });
  }
});
test("detalhe pessoal de pedido recusa filtro de outro cliente antes de consultar documento", async () => {
  const route = armazenagemApi.routes.find(r => r.method === "GET" && r.path.endsWith("/pedidos/{id}"))!;
  const personal = { db: {}, integration: { id: "p", kind: "personal", scopes: [route.scope], principal: { uid: "human", role: "cliente", customer_code: "A", modules: ["wms"], portal_active: true } }, actor: { uid: "api:p", role: "cliente" } } as unknown as ApiContext;
  await assert.rejects(route.run(personal, { id: "request" }, { method: "GET", path: route.path, headers: {}, query: { customer_code: "B" } }), { code: "permission-denied" });
});
