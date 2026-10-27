import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { before, beforeEach, after, test } from "node:test";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { createModuleHandler } from "./shared/handler.js";
import { requireCustomer, object, type ApiRequest, type ModuleDefinition } from "./shared/core.js";

const project = "demo-dute-api-platform";
const id = "a".repeat(32); const token = `dute_${id}.${"b".repeat(43)}`;
let app: ReturnType<typeof initializeApp>; let db: Firestore;
let executions = 0;
const definition: ModuleDefinition = { module: "rh", released: (name) => name === "dute-homolog", routes: [
  { method: "GET", path: "/api/v1/rh/registros", scope: "rh:ler", role: "rh", summary: "Fixture global", run: async (ctx) => ({ data: { actor: ctx.actor.uid, role: ctx.actor.role } }) },
  { method: "POST", path: "/api/v1/rh/registros", scope: "rh:registros:gravar", role: "rh", summary: "Fixture de escrita", run: async (ctx, _, request) => {
    executions++; const input = object(request.body);
    if (input.customer) requireCustomer(ctx, input.customer);
    await ctx.db.doc(`api_fixture/${ctx.idempotencyKey}`).create({ value: input.value ?? "ok", actor: ctx.actor.uid });
    if (input.fail) throw new Error("private upstream token=DO_NOT_LEAK");
    return { id: ctx.idempotencyKey };
  } },
  { method: "PATCH", path: "/api/v1/rh/registros/{id}", scope: "rh:registros:gravar", role: "rh", summary: "Fixture PATCH global", run: async (ctx, params, request) => {
    executions++; return { id: params.id, changed: object(request.body).value, actor: ctx.actor.uid };
  } },
] };
const handle = (request: ApiRequest) => createModuleHandler(db, "dute-homolog", async (human) => { if (human !== "human") throw new Error("bad"); return { uid: "owner" }; }, definition)(request);
const req = (method = "POST", path = "/api/v1/rh/registros", body: unknown = { value: "ok" }, key = "one"): ApiRequest => ({ method, path, body, query: {}, headers: { authorization: `Bearer ${token}`, "idempotency-key": key } });
before(() => { assert.ok(process.env.FIRESTORE_EMULATOR_HOST); app = initializeApp({ projectId: project }, "api-platform-kernel"); db = getFirestore(app); });
beforeEach(async () => {
  executions = 0;
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${project}/databases/(default)/documents`, { method: "DELETE" });
  await db.doc("users/owner").set({ role: "admin" });
  await db.doc(`api_integrations/${id}`).set({ token_hash: createHash("sha256").update(token).digest("hex"), delegated_by: "owner", scopes: ["rh:ler", "rh:registros:gravar"], customers: [], write_policy: "scoped", expires_at_ms: Date.now() + 600000 });
});
after(async () => { await db.terminate(); await deleteApp(app); });

test("scoped permite GET/POST/PATCH global sem perfil api nem aprovação, com auditoria", async () => {
  const result = await handle(req()); assert.equal(result.status, 201);
  const read = await handle(req("GET", "/api/v1/rh/registros", undefined));
  assert.deepEqual(read.body.data, { actor: `api:${id}`, role: "rh" });
  assert.equal((await handle(req("PATCH", "/api/v1/rh/registros/reg_one", { value: "changed" }))).status, 200);
  assert.equal((await db.doc(`users/api:${id}`).get()).exists, false);
  const audit = (await db.doc(`api_audit/${result.body.request_id}`).get()).data()!;
  assert.equal(audit.authorized_by, "owner"); assert.equal(audit.write_policy, "scoped");
  assert.doesNotMatch(JSON.stringify(audit), /DO_NOT_LEAK|token_hash|Bearer|value/);
});
test("idempotência e concorrência têm um executor e não aceitam outro conteúdo", async () => {
  const responses = await Promise.all([handle(req()), handle(req())]);
  assert.equal(responses.filter((r) => r.status === 201).length, 1);
  assert.ok(responses.every((r) => [200, 201, 409].includes(r.status)));
  const replay = await handle(req()); assert.equal(replay.status, 200); assert.equal(replay.body.replayed, true);
  assert.equal(executions, 1); assert.equal((await db.collection("api_fixture").get()).size, 1);
  assert.equal((await handle(req("POST", undefined, { value: "other" }))).status, 409);
});
test("política omitida exige aprovação; aprovação PATCH global vincula corpo/caminho/chave", async () => {
  await db.doc(`api_integrations/${id}`).update({ write_policy: "approval_required" });
  const patch = req("PATCH", "/api/v1/rh/registros/reg_one", { value: "ok" });
  assert.equal((await handle(patch)).status, 403);
  const approval = await handle({ ...req("POST", `/api/v1/integrations/${id}/approvals`, { method: "PATCH", path: patch.path, body: patch.body, idempotency_key: "one" }), headers: { authorization: "Bearer human" } });
  assert.equal(approval.status, 201);
  const approved = { ...patch, headers: { ...patch.headers, "x-approval-id": (approval.body.data as { id: string }).id } };
  assert.equal((await handle({ ...approved, body: { value: "altered" } })).status, 403);
  assert.equal((await handle(approved)).status, 200);
  await db.doc("users/owner").update({ access_disabled: true });
  assert.equal((await handle(approved)).status, 403);
});
test("nega política desconhecida, chave revogada/expirada, escopo e cliente indevidos", async () => {
  assert.equal((await handle({ ...req(), headers: {} })).status, 401);
  assert.equal((await handle(req("POST", undefined, { customer: "OUTRO" }))).status, 403);
  for (const change of [{ write_policy: "invalid" }, { write_policy: "scoped", scopes: ["rh:ler"] }, { scopes: ["rh:ler", "rh:registros:gravar"], revoked: true }, { revoked: false, expires_at_ms: 1 }]) {
    await db.doc(`api_integrations/${id}`).update(change);
    assert.ok([401, 403].includes((await handle(req())).status));
  }
});
test("falha após possível efeito deixa recibo incerto e nunca reexecuta cegamente", async () => {
  const first = await handle(req("POST", undefined, { fail: true }));
  assert.equal(first.status, 500); assert.doesNotMatch(JSON.stringify(first), /DO_NOT_LEAK|upstream/);
  assert.equal((await handle(req("POST", undefined, { fail: true }))).status, 409);
  assert.equal(executions, 1); assert.equal((await db.collection("api_fixture").get()).size, 1);
});
