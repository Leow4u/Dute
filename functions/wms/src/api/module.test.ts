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
