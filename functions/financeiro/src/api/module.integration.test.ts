import { createModuleHandler } from "./shared/handler.js";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it, test } from "node:test";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { financeiroApi } from "./module.js";
import type { ApiContext } from "./shared/core.js";
import { faturaIdDaNf } from "../domain/fatura.js";

const PROJECT = "demo-dute-api-financeiro";
let app: ReturnType<typeof initializeApp>;
let db: Firestore;
const scopes = ["financeiro:ler", "financeiro:faturas:gravar", "financeiro:cobrancas:gravar", "financeiro:pagamentos:registrar"];
const id = faturaIdDaNf("1", "9001");
const payload = { demandas: ["10045"], nf: { numero: "9001", emitida_em: "2026-10-01" }, vencimento: "2026-10-31", forma: "pix" };
const ctx = (key: string, customers = ["ITAU"], allowed = scopes): ApiContext => ({ db, project: "dute-homolog", integration: { id: "integration", delegated_by: "owner", customers, scopes: allowed, write_policy: "scoped" }, actor: { uid: "api:integration", role: "financeiro", name: "Contabilidade" }, idempotencyKey: key });
async function run(method: string, path: string, body?: unknown, key = "request-1", customers = ["ITAU"], query: Record<string, unknown> = {}, allowed = scopes) {
  const route = financeiroApi.routes.find(route => route.method === method && route.path === `/api/v1/financeiro${path}`)!;
  return route.run(ctx(`${method}:${path}:${key}`, customers, allowed), { id }, { method, path: route.path, headers: {}, query, body }) as Promise<Record<string, unknown>>;
}
const code = (expected: string) => (error: unknown) => (error as { code: string }).code === expected;
before(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("FIRESTORE_EMULATOR_HOST obrigatório; não acessar banco real.");
  app = initializeApp({ projectId: PROJECT }, "api-financeiro-integration"); db = getFirestore(app);
});
after(async () => { if (app) await deleteApp(app); });
beforeEach(async () => {
  const response = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: "DELETE" });
  assert.equal(response.ok, true);
  await db.doc("demands/10045").set({ numero: "10045", customer_code: "ITAU", etapa: "a_faturar", marcos: [], validacao: { rv: 1, autorizacao: "pedido_aceite" }, autorizacao_ids: ["auth-itau"], private_note: "não expor" });
  await db.doc("quotes/10045/revisoes/1").set({ total_cents: 10000 });
  await db.doc("client_authorizations/auth-itau").set({ customer_code: "ITAU", tipo: "pedido_aceite", status: "registrada", demandas: [{ numero: "10045", rv: 1 }], demanda_numeros: ["10045"], nf_ids: [] });
});

describe("Financeiro REST no emulador: domínio real", () => {
  it("consulta A faturar, registra NF, documenta envio e registra recebido sem efeitos externos", async () => {
    const pending = await run("GET", "/a-faturar", undefined, "read", ["ITAU"], { customer_code: "ITAU" });
    assert.equal((pending.data as Record<string, unknown>[]).length, 1);
    assert.equal((pending.data as Record<string, unknown>[])[0].private_note, undefined);
    const created = await run("POST", "/faturas", payload);
    assert.equal(created.id, id); assert.equal(created.valor_cents, 10000);
    const sent = await run("PATCH", "/faturas/{id}/cobranca", { enviada_em: "2026-10-02", meio: "email" });
    assert.equal(sent.status, "enviada");
    const paid = await run("POST", "/faturas/{id}/pagamentos", { valor: "100.00", recebido_em: "2026-10-03", forma: "pix" });
    assert.equal(paid.status, "paga");
    assert.equal((await db.doc("demands/10045").get()).data()!.etapa, "paga");
    const invoices = await run("GET", "/faturas", undefined, "read", ["ITAU"], { customer_code: "ITAU", limit: 1 });
    assert.equal((invoices.data as unknown[]).length, 1);
    const payments = await run("GET", "/pagamentos", undefined, "read", ["ITAU"], { customer_code: "ITAU" });
    assert.equal((payments.data as Record<string, unknown>[])[0].valor_cents, 10000);
    for (const name of ["nf_emissoes", "nf_baixas", "notifications"]) assert.equal((await db.collection(name).get()).size, 0);
    const events = await db.collection("events").get();
    assert.equal(events.size, 3);
    assert.ok(events.docs.every(doc => doc.data().actor.uid === "api:integration"));
  });
  it("pagina faturas sem expor outro tenant e usa o total congelado da armazenagem", async () => {
    await run("POST", "/faturas", payload);
    await db.doc("faturas/fat_000000000000000000000000").set({ customer_code: "SAFRA", status: "emitida", valor_cents: 999999, private_note: "segredo" });
    await db.doc("faturas/fat_ffffffffffffffffffffffff").set({ customer_code: "ITAU", status: "emitida", valor_cents: 20000, private_note: "segredo" });
    const first = await run("GET", "/faturas", undefined, "first", ["ITAU"], { customer_code: "ITAU", limit: 1 });
    assert.equal((first.data as Record<string, unknown>[])[0].id, id);
    assert.equal(first.next_cursor, id);
    const next = await run("GET", "/faturas", undefined, "next", ["ITAU"], { customer_code: "ITAU", limit: 1, cursor: first.next_cursor });
    assert.equal((next.data as Record<string, unknown>[])[0].id, "fat_ffffffffffffffffffffffff");
    assert.equal((next.data as Record<string, unknown>[])[0].private_note, undefined);
    assert.equal(next.next_cursor, null);
    await db.doc("billing_periods/ITAU__2026-09").set({ customer_code: "ITAU", competencia: "2026-09", status: "emitido", total_cents: 999, invoice_snapshot: { total_cents: 7508 } });
    const periods = await run("GET", "/a-faturar/armazenagem", undefined, "period", ["ITAU"], { customer_code: "ITAU" });
    assert.equal((periods.data as Record<string, unknown>[])[0].total_cents, 7508);
  });
  it("replay e concorrência preservam uma fatura, um pagamento e um evento por ação", async () => {
    const [a, b] = await Promise.all([run("POST", "/faturas", payload), run("POST", "/faturas", payload)]);
    assert.equal(a.id, b.id); assert.ok(a.replayed || b.replayed);
    const pay = { valor: "40.00", recebido_em: "2026-10-03", forma: "pix" };
    const results = await Promise.all([run("POST", "/faturas/{id}/pagamentos", pay), run("POST", "/faturas/{id}/pagamentos", pay)]);
    assert.ok(results.some(result => result.replayed));
    assert.equal((await db.collection("pagamentos").get()).size, 1);
    assert.equal((await db.doc(`faturas/${id}`).get()).data()!.recebido_cents, 4000);
    await assert.rejects(run("POST", "/faturas/{id}/pagamentos", { ...pay, valor: "50.00" }), code("already-exists"));
    assert.equal((await db.collection("events").get()).size, 2);
  });
  it("nega cliente/escopo e autorização cruzada antes de qualquer efeito", async () => {
    await assert.rejects(run("POST", "/faturas", payload, "no", ["SAFRA"]), code("permission-denied"));
    await assert.rejects(run("POST", "/faturas", payload, "no", ["ITAU"], {}, ["financeiro:ler"]), code("permission-denied"));
    await db.doc("client_authorizations/auth-itau").update({ customer_code: "SAFRA" });
    await assert.rejects(run("POST", "/faturas", payload, "cross", ["ITAU", "SAFRA"]), code("permission-denied"));
    assert.equal((await db.collection("faturas").get()).size, 0);
    assert.equal((await db.collection("financeiro_operations").get()).size, 0);
  });
  it("nega NF de outro tenant e vínculo adulterado mesmo com ambos clientes autorizados", async () => {
    await run("POST", "/faturas", payload);
    await assert.rejects(run("PATCH", "/faturas/{id}/cobranca", { enviada_em: "2026-10-02", meio: "email" }, "wrong", ["SAFRA"]), code("permission-denied"));
    await db.doc("demands/10045").update({ customer_code: "SAFRA" });
    await assert.rejects(run("POST", "/faturas/{id}/pagamentos", { valor: "100.00", recebido_em: "2026-10-03", forma: "pix" }, "cross", ["ITAU", "SAFRA"]), code("permission-denied"));
    assert.equal((await db.collection("pagamentos").get()).size, 0);
    assert.equal((await db.doc(`faturas/${id}`).get()).data()!.status, "emitida");
  });
  it("nega baixa Omie e ação injetada sem criar fila nem movimentar saldo", async () => {
    await run("POST", "/faturas", payload);
    await db.doc(`faturas/${id}`).update({ origem_nf: "omie" });
    await assert.rejects(run("POST", "/faturas/{id}/pagamentos", { valor: "1.00", recebido_em: "2026-10-03", forma: "pix" }), code("permission-denied"));
    await assert.rejects(run("PATCH", "/faturas/{id}/cobranca", { acao: "cancel", enviada_em: "2026-10-02", meio: "email" }), code("invalid-argument"));
    assert.equal((await db.collection("nf_baixas").get()).size, 0);
    assert.equal((await db.collection("pagamentos").get()).size, 0);
    assert.equal((await db.collection("events").get()).size, 1);
  });
});

test("handler pessoal financeiro: projeção, papel atual, cliente atual e bloqueio", async () => {
  const keyId = "a".repeat(32), token = `dute_${keyId}.${"s".repeat(43)}`;
  await db.doc("users/personal-human").set({ role: "cliente", customer_code: "PERSONAL", nome: "Pessoa" });
  await db.doc("client_access/PERSONAL").set({ modules: ["wms", "financeiro"] });
  await db.doc(`api_integrations/${keyId}`).set({ kind: "personal", permission: "full", delegated_by: "personal-human", scopes: [], customers: [], write_policy: "scoped", expires_at_ms: Date.now() + 600000, token_hash: createHash("sha256").update(token).digest("hex") });
  await db.doc("client_faturas/personal-row").set({ customer_code: "PERSONAL", name: "Pessoal", status: "open", secret: "never", created_by: { uid: `api:${keyId}` } });
  const handler = createModuleHandler(db, "dute-homolog", async () => ({ uid: "unused" }), financeiroApi);
  const request = { method: "GET", path: "/api/v1/financeiro/faturas", headers: { authorization: `Bearer ${token}` }, query: {} };
  const first = await handler(request);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.ok((first.body.data as any[]).some(row => row.id === "personal-row"));
  assert.ok((first.body.data as any[]).every(row => row.secret === undefined));
  assert.equal((await handler({ ...request, query: { customer_code: "OTHER" } })).status, 403);
  await db.doc("users/personal-human").update({ customer_code: "OTHER" });
  assert.equal(((await handler(request)).body.data as any[]).some(row => row.id === "personal-row"), false);
  await db.doc("users/personal-human").update({ customer_code: "PERSONAL" });
  await db.doc("client_access/PERSONAL").update({ modules: [] });
  assert.equal((await handler(request)).status, 403);
  await db.doc("client_access/PERSONAL").update({ modules: ["wms", "financeiro"] });
  await db.doc("users/personal-human").update({ role: "painel" });
  assert.equal((await handler(request)).status, 403);
  await db.doc("users/personal-human").update({ role: "cliente", access_disabled: true });
  assert.equal((await handler(request)).status, 403);
});

test("handler pessoal financeiro: grava com papel real e recibo de replay sem duplicar", async () => {
  const keyId = "b".repeat(32), token = `dute_${keyId}.${"s".repeat(43)}`;
  await db.doc("users/personal-writer").set({ role: "owner", nome: "Pessoa" });
  await db.doc(`api_integrations/${keyId}`).set({ kind: "personal", permission: "full", delegated_by: "personal-writer", scopes: [], customers: [], write_policy: "scoped", expires_at_ms: Date.now() + 600000, token_hash: createHash("sha256").update(token).digest("hex") });
  const handler = createModuleHandler(db, "dute-homolog", async () => ({ uid: "unused" }), financeiroApi);
  const request = { method: "POST", path: "/api/v1/financeiro/faturas", headers: { authorization: `Bearer ${token}`, "idempotency-key": "personal-write" }, query: {}, body: payload };
  const first = await handler(request);
  assert.equal(first.status, 201, JSON.stringify(first.body));
  const replay = await handler(request);
  assert.equal(replay.status, 200, JSON.stringify(replay.body));
  assert.equal(replay.body.replayed, true);
  const events = await db.collection("events").get();
  const event = events.docs.find(doc => doc.get("actor.uid") === `api:${keyId}`);
  assert.ok(event, "evento com identidade da chave");
  assert.equal(event.get("actor.role"), "owner");
  const count = events.size;
  await db.doc("users/personal-writer").update({ role: "painel" });
  assert.equal((await handler(request)).status, 403);
  assert.equal((await db.collection("events").get()).size, count);
});
