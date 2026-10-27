import { createModuleHandler } from "./shared/handler.js";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it, test } from "node:test";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { rhApi } from "./module.js";
import type { ApiContext, ApiRequest } from "./shared/core.js";

const project = "demo-dute-api-rh";
const collaborator = "col_aaaaaaaaaaaaaaaa";
let app: ReturnType<typeof initializeApp>;
let db: Firestore;
let rh: Firestore;
const scopes = ["rh:ler", "rh:pessoais:ler", "rh:documentos:ler", "rh:registros:gravar", "rh:vinculos:gravar"];

before(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("FIRESTORE_EMULATOR_HOST obrigatório; nenhum banco real pode ser acessado.");
  app = initializeApp({ projectId: project, storageBucket: `${project}.appspot.com` }, "api-rh-integration");
  db = getFirestore(app);
  rh = getFirestore(app, "dute-rh");
});
after(async () => { if (app) await deleteApp(app); });
beforeEach(async () => {
  for (const database of ["(default)", "dute-rh"]) {
    const response = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${project}/databases/${database}/documents`, { method: "DELETE" });
    assert.ok(response.ok);
  }
  await db.doc(`collaborators/${collaborator}`).set({ nome: "Ana", funcao: "Montadora", vinculo: "proprio", ativo: true, cpf: "52998224725", telefone: "11999999999", segredo: "invisivel" });
});

function context(key: string, granted = scopes, integration = "test"): ApiContext {
  return { db, project: "dute-homolog", integration: { id: integration, delegated_by: "owner", customers: [], scopes: granted, write_policy: "scoped" }, actor: { uid: `api:${integration}`, role: "rh", name: "Integração RH" }, idempotencyKey: `${integration}:${key}` };
}
async function call(method: "GET" | "POST" | "PATCH", path: string, key: string, body?: unknown, granted = scopes, integration = "test", query = {}) {
  let params: Record<string, string> = {};
  const route = rhApi.routes.find((route) => {
    if (route.method !== method) return false;
    const pattern = new RegExp(`^${route.path.replace("{id}", "([^/]+)")}$`);
    const match = pattern.exec(`/api/v1/rh/${path}`);
    if (match?.[1]) params = { id: match[1] };
    return !!match;
  });
  assert.ok(route);
  const request: ApiRequest = { method, path: `/api/v1/rh/${path}`, headers: {}, query, body };
  return await route.run(context(key, granted, integration), params, request) as Record<string, any>;
}
const record = { colaborador_id: collaborator, categoria: "exame", tipo: "periodico", emitido_em: "2025-10-01", vence_em: "2026-11-01", resultado: "apto" };

describe("REST RH no banco separado e serviços reais", () => {
  it("cria, consulta e altera registro com edição, recibos e ator API", async () => {
    const created = await call("POST", "registros", "create", record);
    const read = await call("GET", `registros/${created.id}`, "read");
    assert.equal(read.data.edicao, 1);
    assert.equal(read.data.resultado, undefined);
    assert.equal(read.data.arquivo, undefined);
    const updated = await call("PATCH", `registros/${created.id}`, "update", { ...record, expected_edicao: 1, vence_em: "2026-12-01" });
    assert.equal(updated.edicao, 2);
    await assert.rejects(call("PATCH", `registros/${created.id}`, "stale", { ...record, expected_edicao: 1 }), { code: "failed-precondition" });
    assert.equal((await rh.doc(`registros/${created.id}`).get()).data()?.updated_by.uid, "api:test");
    assert.equal((await rh.collection("rh_operations").get()).size, 2);
    assert.equal((await rh.collection("events").get()).size, 2);
    for (const collection of ["registros", "events", "rh_operations", "vinculos"]) assert.equal((await db.collection(collection).get()).size, 0);
  });

  it("cria, consulta e altera vínculo, preservando cadastro operacional", async () => {
    await call("POST", "vinculos", "create", { colaborador_id: collaborator, admissao: "2025-01-01" });
    assert.equal((await call("GET", `vinculos/${collaborator}`, "read")).data.edicao, 1);
    const updated = await call("PATCH", `vinculos/${collaborator}`, "update", { expected_edicao: 1, admissao: "2025-01-01", desligamento: "2026-10-01" });
    assert.equal(updated.edicao, 2);
    await assert.rejects(call("PATCH", `vinculos/${collaborator}`, "stale", { expected_edicao: 1, admissao: "2025-01-01" }), { code: "failed-precondition" });
    assert.equal((await db.doc(`collaborators/${collaborator}`).get()).data()?.ativo, true);
    assert.equal((await rh.collection("events").get()).size, 2);
  });

  it("replay e concorrência não duplicam registros, eventos ou vínculos; conteúdo diferente conflita", async () => {
    const [a, b] = await Promise.all([call("POST", "registros", "same", record), call("POST", "registros", "same", record)]);
    assert.equal(a.id, b.id);
    assert.ok(a.replayed || b.replayed);
    await assert.rejects(call("POST", "registros", "same", { ...record, vence_em: "2026-12-01" }), { code: "already-exists" });
    const link = { colaborador_id: collaborator, admissao: "2025-01-01" };
    const links = await Promise.all([call("POST", "vinculos", "link", link), call("POST", "vinculos", "link", link)]);
    assert.ok(links.some((result) => result.replayed));
    assert.equal((await rh.collection("registros").get()).size, 1);
    assert.equal((await rh.collection("vinculos").get()).size, 1);
    assert.equal((await rh.collection("events").get()).size, 2);
    const other = await call("POST", "registros", "same", record, scopes, "other");
    assert.notEqual(other.id, a.id);
    assert.equal((await rh.doc(`registros/${other.id}`).get()).data()?.created_by.uid, "api:other");
  });

  it("recursos globais dispensam cliente; pessoais e documentos exigem escopo específico", async () => {
    const listed = await call("GET", "colaboradores", "list", undefined, ["rh:ler"]);
    assert.equal(listed.data.length, 1);
    assert.equal(listed.data[0].cpf, undefined);
    assert.equal(listed.data[0].telefone, undefined);
    assert.equal(listed.data[0].segredo, undefined);
    await assert.rejects(call("GET", `colaboradores/${collaborator}/pessoais`, "personal", undefined, ["rh:ler"]), { code: "permission-denied" });
    const personal = await call("GET", `colaboradores/${collaborator}/pessoais`, "personal", undefined, ["rh:pessoais:ler"]);
    assert.equal(personal.data.cpf, "52998224725");
    await assert.rejects(call("GET", "registros/reg_aaaaaaaaaaaaaaaa/arquivo", "file", undefined, ["rh:ler"]), { code: "permission-denied" });
    await assert.rejects(call("POST", "registros", "denied", record, ["rh:ler"]), { code: "permission-denied" });
    await assert.rejects(call("GET", "registros/reg_aaaaaaaaaaaaaaaa/arquivo", "file", undefined, ["rh:documentos:ler"]), { code: "not-found" });
    await assert.rejects(call("GET", "colaboradores", "customer", undefined, ["rh:ler"], "test", { customer_code: "FAKE" }), { code: "invalid-argument" });
    assert.equal((await rh.collection("events").get()).size, 0);
  });

  it("paginação limitada e sem vazamento de campos livres, CPF ou caminho de arquivo", async () => {
    for (const suffix of ["aaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbb"]) await rh.doc(`registros/reg_${suffix}`).set({ ...record, descricao: "segredo", arquivo: { caminho: "rh/privado" }, edicao: 1 });
    const first = await call("GET", "registros", "list", undefined, ["rh:ler"], "test", { limit: 1 });
    assert.equal(first.data.length, 1);
    assert.ok(first.next_cursor);
    assert.equal(first.data[0].descricao, undefined);
    assert.equal(first.data[0].resultado, undefined);
    assert.equal(first.data[0].arquivo, undefined);
    const next = await call("GET", "registros", "list", undefined, ["rh:ler"], "test", { limit: 1, cursor: first.next_cursor });
    assert.equal(next.data.length, 1);
    assert.notEqual(next.data[0].id, first.data[0].id);
    assert.equal(next.next_cursor, null);
  });
});

test("handler pessoal rh: projeção, papel atual, cliente atual e bloqueio", async () => {
  const keyId = "a".repeat(32), token = `dute_${keyId}.${"s".repeat(43)}`;
  await db.doc("users/personal-human").set({ role: "owner", customer_code: "PERSONAL", nome: "Pessoa" });
  await db.doc("client_access/PERSONAL").set({ modules: ["wms", "financeiro"] });
  await db.doc(`api_integrations/${keyId}`).set({ kind: "personal", permission: "full", delegated_by: "personal-human", scopes: [], customers: [], write_policy: "scoped", expires_at_ms: Date.now() + 600000, token_hash: createHash("sha256").update(token).digest("hex") });
  await db.doc("collaborators/personal-row").set({ customer_code: "PERSONAL", name: "Pessoal", status: "open", secret: "never", created_by: { uid: `api:${keyId}` } });
  const handler = createModuleHandler(db, "dute-homolog", async () => ({ uid: "unused" }), rhApi);
  const request = { method: "GET", path: "/api/v1/rh/colaboradores", headers: { authorization: `Bearer ${token}` }, query: {} };
  const first = await handler(request);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.ok((first.body.data as any[]).some(row => row.id === "personal-row"));
  assert.ok((first.body.data as any[]).every(row => row.secret === undefined));

  await db.doc("users/personal-human").update({ role: "painel" });
  assert.equal((await handler(request)).status, 403);
  await db.doc("users/personal-human").update({ role: "owner", access_disabled: true });
  assert.equal((await handler(request)).status, 403);
});

test("handler pessoal rh: grava com papel real e recibo de replay sem duplicar", async () => {
  const keyId = "b".repeat(32), token = `dute_${keyId}.${"s".repeat(43)}`;
  await db.doc("users/personal-writer").set({ role: "rh", nome: "Pessoa" });
  await db.doc(`api_integrations/${keyId}`).set({ kind: "personal", permission: "full", delegated_by: "personal-writer", scopes: [], customers: [], write_policy: "scoped", expires_at_ms: Date.now() + 600000, token_hash: createHash("sha256").update(token).digest("hex") });
  const handler = createModuleHandler(db, "dute-homolog", async () => ({ uid: "unused" }), rhApi);
  const request = { method: "POST", path: "/api/v1/rh/registros", headers: { authorization: `Bearer ${token}`, "idempotency-key": "personal-write" }, query: {}, body: record };
  const first = await handler(request);
  assert.equal(first.status, 201, JSON.stringify(first.body));
  const replay = await handler(request);
  assert.equal(replay.status, 200, JSON.stringify(replay.body));
  assert.equal(replay.body.replayed, true);
  const events = await rh.collection("events").get();
  const event = events.docs.find(doc => doc.get("actor.uid") === `api:${keyId}`);
  assert.ok(event, "evento com identidade da chave");
  assert.equal(event.get("actor.role"), "rh");
  const count = events.size;
  await db.doc("users/personal-writer").update({ role: "painel" });
  assert.equal((await handler(request)).status, 403);
  assert.equal((await rh.collection("events").get()).size, count);
});
