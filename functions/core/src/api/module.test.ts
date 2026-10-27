import assert from "node:assert/strict";
import { test } from "node:test";
import type { Firestore } from "firebase-admin/firestore";
import { agenteApi } from "./module.js";
import type { ApiContext, ApiRequest } from "./shared/core.js";

const context: ApiContext = { db: {} as Firestore, project: "dute-homolog", actor: { uid: "api:one", role: "interno", name: "Integração" }, integration: { id: "one", delegated_by: "human", scopes: ["agente:ler", "agente:rotinas:gravar", "agente:playbooks:gravar"], customers: ["A"], write_policy: "scoped" }, idempotencyKey: "test-key-0001" };
const call = (resource: string, body: unknown, ctx = context) => {
  const route = agenteApi.routes.find((r) => r.method === "POST" && r.path.endsWith(resource))!;
  return route.run(ctx, {}, { method: "POST", path: route.path, headers: {}, query: {}, body } as ApiRequest);
};
test("agente não registra execução, conversas, notas nem ferramentas arbitrárias", () => {
  assert.equal(agenteApi.routes.length, 8);
  assert.ok(agenteApi.routes.every((r) => r.role === "interno" && /\/(playbooks|rotinas)(\/\{id\})?$/.test(r.path)));
});
test("rotina recusa ativação, papel injetado e módulo sem escopo antes de consultar banco", async () => {
  const body = { customer_code: "A", modulo: "wms", name: "Saldo", prompt: "Consultar saldo", frequency: "daily", time: "08:00", active: false };
  await assert.rejects(call("rotinas", { ...body, active: true }), { code: "invalid-argument" });
  await assert.rejects(call("rotinas", { ...body, role: "admin" }), { code: "invalid-argument" });
  await assert.rejects(call("rotinas", body), { code: "permission-denied" });
  await assert.rejects(call("rotinas", { ...body, modulo: "financeiro" }), { code: "permission-denied" });
});
test("playbook recusa cliente externo e campos de autoridade injetados", async () => {
  await assert.rejects(call("playbooks", { customer_code: "B" }), { code: "permission-denied" });
  await assert.rejects(call("playbooks", { customer_code: "A", created_by: { uid: "human" } }), { code: "invalid-argument" });
});
test("identidade API nunca pode injetar admin nem se passar por usuário humano", async () => {
  await assert.rejects(call("playbooks", { customer_code: "A" }, { ...context, actor: { ...context.actor, role: "financeiro" } }), { code: "permission-denied" });
  await assert.rejects(call("playbooks", { customer_code: "A" }, { ...context, actor: { ...context.actor, uid: "human" } }), { code: "permission-denied" });
});
test("PATCH exige versão da consulta antes de qualquer efeito", async () => {
  const route = agenteApi.routes.find((r) => r.method === "PATCH" && r.path.includes("playbooks"))!;
  await assert.rejects(route.run(context, { id: "pb_synthetic" }, { method: "PATCH", path: route.path, headers: {}, query: {}, body: { customer_code: "A" } }), { code: "invalid-argument" });
});
