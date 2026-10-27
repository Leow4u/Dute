import { createModuleHandler } from "./shared/handler.js";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { comercialApi } from "./module.js";
import type { ApiContext } from "./shared/core.js";

const project = "demo-dute-api-comercial";
let db: Firestore;
let app: ReturnType<typeof initializeApp>;
let counter = 0;
before(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("FIRESTORE_EMULATOR_HOST obrigatório; nunca usar Firestore real.");
  app = initializeApp({ projectId: project }, project);
  db = getFirestore(app);
});
beforeEach(async () => {
  const response = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${project}/databases/(default)/documents`, { method: "DELETE" });
  assert.equal(response.ok, true);
  await db.doc("users/delegante").set({ role: "comercial", name: "Responsável humano" });
  await db.doc("customers/ACME").set({ code: "ACME", customer_code: "ACME", name: "Acme", stage: "cliente", status: "active", secret: "never-return", comercial: { cidade: "São Paulo", omie_ids: ["private"], secret: "private" } });
  await db.doc("customers/OTHER").set({ code: "OTHER", customer_code: "OTHER", name: "Outro", stage: "cliente", status: "active" });
});
after(async () => { if (app) await deleteApp(app); });
function context(key?: string): ApiContext {
  return { db, project: "dute-homolog", actor: { uid: "api:commercial-test", role: "comercial", name: "Integração teste" }, integration: { id: "commercial-test", delegated_by: "delegante", scopes: ["comercial:ler", "comercial:clientes:gravar", "comercial:contratos:gravar", "comercial:orcamentos:gravar", "comercial:medicoes:gravar"], customers: ["ACME", "NOVO"], write_policy: "scoped" }, idempotencyKey: key ?? `api-test-${++counter}` };
}
async function call(method: "GET" | "POST" | "PATCH", template: string, payload?: unknown, params: Record<string, string> = {}, key?: string, query: Record<string, unknown> = {}) {
  const path = `/api/v1/comercial/${template}`;
  const route = comercialApi.routes.find(r => r.method === method && r.path === path);
  assert.ok(route, `${method} ${path}`);
  return await route.run(context(key), params, { method, path, body: payload, query, headers: {} }) as Record<string, any>;
}
async function fail(promise: Promise<unknown>, code: string) { await assert.rejects(promise, (e: any) => e.code === code); }
function contract(customer_code = "ACME") {
  return { customer_code, nome: "Contrato mensal", vigente_de: "2026-01-01", vigente_ate: "2027-12-31", renovacao: { tipo: "aditivo" }, reajuste: { tipo: "negociado" }, regime_padrao: "medicao_mensal", autorizacao: { tipo: "medicao_aprovada" }, pagamento: { tipo: "dias_apos_nf", dias: 30 }, status: "vigente" };
}

test("Comercial REST clientes cria consulta altera e repete sem duplicar eventos", async () => {
  const created = await call("POST", "clientes", { code: "NOVO", name: "Novo cliente" }, {}, "customer-create");
  const replay = await call("POST", "clientes", { code: "NOVO", name: "Novo cliente" }, {}, "customer-create");
  assert.equal(replay.replayed, true);
  assert.equal(replay.customer_id, created.customer_id);
  await fail(call("POST", "clientes", { code: "NOVO", name: "Nome diferente" }, {}, "customer-create"), "already-exists");
  const got = await call("GET", "clientes/{id}", undefined, { id: created.customer_id });
  assert.equal(got.data.name, "Novo cliente");
  assert.equal(got.data.comercial.responsavel_uid, "delegante");
  assert.equal((await db.doc("users/api:commercial-test").get()).exists, false);
  await call("PATCH", "clientes/{id}", { name: "Nome alterado" }, { id: created.customer_id });
  assert.equal((await call("GET", "clientes/{id}", undefined, { id: created.customer_id })).data.name, "Nome alterado");
  await call("POST", "clientes/{id}/marcar-cliente", {}, { id: created.customer_id });
  assert.equal((await call("GET", "clientes/{id}", undefined, { id: created.customer_id })).data.stage, "cliente");
  const events = await db.collection("events").get();
  assert.equal(events.size, 3);
  for (const event of events.docs) assert.equal(event.get("actor.uid"), "api:commercial-test");
});

test("Comercial REST locais e contatos preservam tenant na criação e alteração", async () => {
  for (const [resource, key] of [["locais", "local_id"], ["contatos", "contato_id"]]) {
    const created = await call("POST", resource, { customer_code: "ACME", nome: "Registro novo" });
    const target = { id: created[key] };
    assert.equal((await call("GET", `${resource}/{id}`, undefined, target)).data.nome, "Registro novo");
    await call("PATCH", `${resource}/{id}`, { customer_code: "ACME", nome: "Alterado" }, target);
    assert.equal((await call("GET", `${resource}/{id}`, undefined, target)).data.nome, "Alterado");
    await db.doc(`${resource === "locais" ? "customer_locations" : "customer_contacts"}/other-child`).set({ customer_code: "OTHER", nome: "Outro cliente" });
    await fail(call("PATCH", `${resource}/{id}`, { customer_code: "ACME", nome: "Ataque" }, { id: "other-child" }), "permission-denied");
    await fail(call("PATCH", `${resource}/{id}`, { customer_code: "OTHER", nome: "Ataque" }, target), "permission-denied");
  }
});

test("Comercial REST contratos mantém edição idempotência e histórico do aditivo", async () => {
  const created = await call("POST", "contratos", { contrato: contract() }, {}, "contract-create");
  const params = { id: created.contrato_id };
  assert.equal((await call("POST", "contratos", { contrato: contract() }, {}, "contract-create")).replayed, true);
  assert.equal((await call("GET", "contratos/{id}", undefined, params)).data.edicao, 1);
  const updated = await call("PATCH", "contratos/{id}", { contrato: { ...contract(), nome: "Alterado" }, edicao: 1 }, params, "contract-patch");
  assert.equal(updated.edicao, 2);
  assert.equal((await call("PATCH", "contratos/{id}", { contrato: { ...contract(), nome: "Alterado" }, edicao: 1 }, params, "contract-patch")).replayed, true);
  await fail(call("PATCH", "contratos/{id}", { contrato: contract(), edicao: 1 }, params), "failed-precondition");
  const other = context(); other.integration.customers.push("OTHER");
  const r = comercialApi.routes.find(r => r.method === "PATCH" && r.path.endsWith("contratos/{id}"))!;
  await fail(r.run(other, params, { method: "PATCH", path: r.path, headers: {}, query: {}, body: { contrato: contract("OTHER"), edicao: 2 } }), "permission-denied");
  await call("POST", "contratos/{id}/aditivos", { aditivo: { numero: 1, tipo: "prorrogacao", vigente_de: "2028-01-01", vigente_ate: "2028-12-31" } }, params);
  assert.equal((await call("GET", "contratos/{id}/aditivos", undefined, params)).data.length, 1);
});

test("Comercial REST orçamento cria consulta altera com conflito de edição e relações negadas", async () => {
  const created = await call("POST", "orcamentos", { customer_code: "ACME", titulo: "Proposta" }, {}, "quote-create");
  const params = { id: created.numero };
  assert.equal((await call("POST", "orcamentos", { customer_code: "ACME", titulo: "Proposta" }, {}, "quote-create")).replayed, true);
  assert.equal((await call("GET", "orcamentos/{id}", undefined, params)).data.edicao, 1);
  const updated = await call("PATCH", "orcamentos/{id}", { expected_edicao: 1, condicoes: "Condições alteradas" }, params, "quote-patch");
  assert.equal(updated.edicao, 2);
  assert.equal((await call("PATCH", "orcamentos/{id}", { expected_edicao: 1, condicoes: "Condições alteradas" }, params, "quote-patch")).replayed, true);
  await fail(call("PATCH", "orcamentos/{id}", { expected_edicao: 1 }, params), "failed-precondition");
  await db.doc("customer_contacts/private").set({ customer_code: "OTHER", nome: "Outro" });
  await fail(call("PATCH", "orcamentos/{id}", { expected_edicao: 2, contato_id: "private" }, params), "permission-denied");
  await fail(call("PATCH", "orcamentos/{id}", { expected_edicao: 2, customer_code: "OTHER" }, params), "invalid-argument");
});

test("Comercial REST medição cria consulta altera linha e impede edição vencida", async () => {
  const created = await call("POST", "contratos", { contrato: contract() });
  const medicao = await call("POST", "medicoes", { contrato_id: created.contrato_id, competencia: "2026-10" }, {}, "measurement-create");
  const params = { id: medicao.medicao_id };
  assert.equal((await call("POST", "medicoes", { contrato_id: created.contrato_id, competencia: "2026-10" }, {}, "measurement-create")).replayed, true);
  assert.equal((await call("GET", "medicoes/{id}", undefined, params)).data.edicao, 1);
  const linha = { os: "OS-1", solicitada_em: "2026-10-01", executada_em: "2026-10-02", area_solicitante: "Facilities", origem: "Sede", destino: "Filial", mercadoria: "Móveis", itens: [{ origem: "avulso", quantidade: "1", preco: "100.00", descricao: "Mudança", motivo: "Serviço fora da tabela" }] };
  const patch = { expected_edicao: 1, linha };
  const updated = await call("PATCH", "medicoes/{id}/linhas", patch, params, "measurement-patch");
  assert.equal(updated.edicao, 2);
  assert.equal((await call("PATCH", "medicoes/{id}/linhas", patch, params, "measurement-patch")).replayed, true);
  await fail(call("PATCH", "medicoes/{id}/linhas", patch, params), "failed-precondition");
  const saved = await call("GET", "medicoes/{id}", undefined, params);
  assert.equal(saved.data.linhas.length, 1);
  assert.equal(saved.data.total_cents, 10000);
});

test("Comercial REST paginação projeção escopos e ações injetadas falham fechados", async () => {
  const list = await call("GET", "clientes", undefined, {}, undefined, { customer_code: "ACME", limit: 1 });
  assert.equal(list.data.length, 1);
  assert.equal(list.data[0].secret, undefined);
  assert.equal(list.data[0].comercial.omie_ids, undefined);
  await fail(call("GET", "clientes", undefined), "permission-denied");
  await fail(call("GET", "clientes/{id}", undefined, { id: "OTHER" }), "permission-denied");
  await fail(call("POST", "clientes", { code: "NOVO", name: "Novo", action: "archive" }), "invalid-argument");
  await fail(call("POST", "orcamentos", { customer_code: "ACME", action: "approve" }), "invalid-argument");
  const ctx = context(); ctx.integration.scopes = ["comercial:ler"];
  const route = comercialApi.routes.find(r => r.method === "POST" && r.path.endsWith("clientes"))!;
  await fail(route.run(ctx, {}, { method: "POST", path: route.path, headers: {}, query: {}, body: { code: "NOVO", name: "Novo" } }), "permission-denied");
  assert.equal((await db.collection("comercial_operations").get()).size, 0);
});

test("Comercial REST corrida entre preflight e transação recusa troca de tenant em aditivo e medição", async () => {
  for (const kind of ["aditivo", "medicao", "vinculo-medicao"] as const) {
    const created = await call("POST", "contratos", { contrato: contract() });
    const contractId = created.contrato_id as string;
    let template: string, method: "POST" | "PATCH", payload: Record<string, unknown>, params: Record<string, string>;
    if (kind === "aditivo") {
      method = "POST"; template = "contratos/{id}/aditivos"; params = { id: contractId };
      payload = { aditivo: { numero: 9, tipo: "prorrogacao", vigente_de: "2028-01-01", vigente_ate: "2028-12-31" } };
    } else if (kind === "medicao") {
      method = "POST"; template = "medicoes"; params = {};
      payload = { contrato_id: contractId, competencia: "2026-10" };
    } else {
      method = "PATCH"; template = "medicoes/{id}/linhas";
      const measurement = await call("POST", "medicoes", { contrato_id: contractId, competencia: "2026-10" });
      params = { id: measurement.medicao_id };
      const linha = { id: "existing-line", demanda_numero: "10001", os: "OS-1", solicitada_em: "2026-10-01", executada_em: "2026-10-02", area_solicitante: "Facilities", origem: "Sede", destino: "Filial", mercadoria: "Móveis", itens: [{ origem: "avulso", quantidade: "1", preco: "100.00", descricao: "Mudança", motivo: "Serviço fora da tabela" }] };
      await db.doc("demands/10001").set({ customer_code: "ACME", contrato_id: contractId, medicao_id: measurement.medicao_id });
      await db.doc(`medicoes/${measurement.medicao_id}`).update({ linhas: [linha] });
      payload = { expected_edicao: 1, linha: { ...linha, demanda_numero: null } };
    }
    const beforeEvents = (await db.collection("events").get()).size;
    const beforeOperations = (await db.collection("comercial_operations").get()).size;
    let raced = false;
    const ctx = context();
    ctx.db = new Proxy(db, {
      get(target, property) {
        if (property === "runTransaction") return async (work: any) => {
          if (!raced) {
            raced = true;
            // Deterministic concurrent writer after the adapter's preflight A,
            // before its transaction observes B. No API or human permissions involved.
            await db.doc(kind === "vinculo-medicao" ? "demands/10001" : `contracts/${contractId}`).update({ customer_code: "OTHER" });
          }
          return target.runTransaction(work);
        };
        const member = Reflect.get(target, property, target);
        return typeof member === "function" ? member.bind(target) : member;
      },
    });
    const route = comercialApi.routes.find(r => r.method === method && r.path === `/api/v1/comercial/${template}`)!;
    await fail(route.run(ctx, params, { method, path: route.path, headers: {}, query: {}, body: payload }), "permission-denied");
    assert.equal(raced, true);
    assert.equal((await db.collection("events").get()).size, beforeEvents);
    assert.equal((await db.collection("comercial_operations").get()).size, beforeOperations);
    assert.equal((await db.doc(`contracts/${contractId}`).get()).get("vigente_ate"), "2027-12-31");
    assert.equal((await db.doc(`contracts/${contractId}/aditivos/9`).get()).exists, false);
    if (kind === "medicao") assert.equal((await db.doc(`medicoes/${contractId}_2026-10`).get()).exists, false);
  }
});

test("handler pessoal comercial: projeção, papel atual, cliente atual e bloqueio", async () => {
  const keyId = "a".repeat(32), token = `dute_${keyId}.${"s".repeat(43)}`;
  await db.doc("users/personal-human").set({ role: "owner", customer_code: "PERSONAL", nome: "Pessoa" });
  await db.doc("client_access/PERSONAL").set({ modules: ["wms", "financeiro"] });
  await db.doc(`api_integrations/${keyId}`).set({ kind: "personal", permission: "full", delegated_by: "personal-human", scopes: [], customers: [], write_policy: "scoped", expires_at_ms: Date.now() + 600000, token_hash: createHash("sha256").update(token).digest("hex") });
  await db.doc("contracts/personal-row").set({ customer_code: "PERSONAL", name: "Pessoal", status: "open", secret: "never", created_by: { uid: `api:${keyId}` } });
  const handler = createModuleHandler(db, "dute-homolog", async () => ({ uid: "unused" }), comercialApi);
  const request = { method: "GET", path: "/api/v1/comercial/contratos", headers: { authorization: `Bearer ${token}` }, query: {} };
  const first = await handler(request);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.ok((first.body.data as any[]).some(row => row.id === "personal-row"));
  assert.ok((first.body.data as any[]).every(row => row.secret === undefined));

  await db.doc("users/personal-human").update({ role: "painel" });
  assert.equal((await handler(request)).status, 403);
  await db.doc("users/personal-human").update({ role: "owner", access_disabled: true });
  assert.equal((await handler(request)).status, 403);
});

test("handler pessoal comercial: grava com papel real e recibo de replay sem duplicar", async () => {
  const keyId = "b".repeat(32), token = `dute_${keyId}.${"s".repeat(43)}`;
  await db.doc("users/personal-writer").set({ role: "owner", nome: "Pessoa" });
  await db.doc(`api_integrations/${keyId}`).set({ kind: "personal", permission: "full", delegated_by: "personal-writer", scopes: [], customers: [], write_policy: "scoped", expires_at_ms: Date.now() + 600000, token_hash: createHash("sha256").update(token).digest("hex") });
  const handler = createModuleHandler(db, "dute-homolog", async () => ({ uid: "unused" }), comercialApi);
  const request = { method: "POST", path: "/api/v1/comercial/clientes", headers: { authorization: `Bearer ${token}`, "idempotency-key": "personal-write" }, query: {}, body: { code: "PESSOAL", name: "Cliente pessoal" } };
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
