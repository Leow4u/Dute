import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { createModuleHandler } from "./shared/handler.js";
import { agenteApi } from "./module.js";
import type { ApiContext, ApiRequest } from "./shared/core.js";

const project = "demo-dute-api-agente";
let db: Firestore;
let app: ReturnType<typeof initializeApp>;
before(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("FIRESTORE_EMULATOR_HOST obrigatório; testes somente no demo-dute-api-agente.");
  app = initializeApp({ projectId: project }, project); db = getFirestore(app);
});
after(async () => { if (app) await deleteApp(app); });
beforeEach(async () => {
  const result = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${project}/databases/(default)/documents`, { method: "DELETE" });
  assert.equal(result.ok, true);
  await db.collection("customers").doc("a").set({ customer_code: "A" });
  await db.collection("customers").doc("b").set({ customer_code: "B" });
  await db.collection("client_access").doc("A").set({ modules: ["wms", "operacao"] });
});
function context(id = "one"): ApiContext { return { db, project: "dute-homolog", actor: { uid: `api:${id}`, role: "interno", name: "Integração sintética" }, integration: { id, delegated_by: "human", customers: ["A"], scopes: ["agente:ler", "agente:playbooks:gravar", "agente:rotinas:gravar", "armazenagem:ler", "operacao:ler"], write_policy: "scoped" }, idempotencyKey: "synthetic-key-0001" }; }
async function call(resource: string, method: "GET" | "POST" | "PATCH", body?: unknown, id?: string, ctx = context()): Promise<any> {
  const route = agenteApi.routes.find((r) => r.method === method && r.path === `/api/v1/agente/${resource}${id ? "/{id}" : ""}`)!;
  return route.run(ctx, id ? { id } : {}, { method, path: route.path, headers: {}, query: { customer_code: "A" }, body: method === "PATCH" && id ? { ...body as Record<string, unknown>, expected_version: (body as Record<string, unknown>).expected_version ?? (await call(resource, "GET", undefined, id, ctx)).data.version } : body } as ApiRequest) as Promise<any>;
}
const playbook = { customer_code: "A", title: "Procedimento", when: "Ao receber", steps: ["Conferir embalagem"], audience: "equipe" };
const routine = { customer_code: "A", modulo: "wms", name: "Saldo diário", prompt: "Consultar saldo do estoque", frequency: "daily", time: "08:00", active: false };
test("playbook cria → consulta → altera pelo domínio com autoria da integração e evento", async () => {
  const created = await call("playbooks", "POST", playbook);
  assert.equal((await call("playbooks", "GET", undefined, created.id)).data.title, "Procedimento");
  const ctx = context(); ctx.idempotencyKey = "synthetic-key-0002";
  await call("playbooks", "PATCH", { ...playbook, title: "Procedimento atualizado" }, created.id, ctx);
  assert.equal((await call("playbooks", "GET", undefined, created.id)).data.title, "Procedimento atualizado");
  const stored = (await db.collection("ai_agent_playbooks").doc(created.id).get()).data()!;
  assert.equal(stored.created_by.uid, "api:one"); assert.equal(stored.updated_by.role, "interno");
  assert.equal((await db.collection("events").get()).size, 2);
  assert.equal((await db.collection("users").doc("api:one").get()).exists, false);
});
test("playbook repetido concorrentemente não duplica documento nem evento", async () => {
  const results = await Promise.all([call("playbooks", "POST", playbook), call("playbooks", "POST", playbook)]);
  assert.equal(results[0].id, results[1].id);
  assert.equal((await db.collection("ai_agent_playbooks").get()).size, 1);
  assert.equal((await db.collection("events").get()).size, 1);
});
test("rotina cria → consulta → altera pausada sem perfil, agendamento ou modelo", async () => {
  const created = await call("rotinas", "POST", routine);
  assert.equal((await call("rotinas", "GET", undefined, created.id)).data.name, routine.name);
  await call("rotinas", "PATCH", { ...routine, name: "Saldo semanal" }, created.id);
  const stored = (await db.collection("agent_routines").doc(created.id).get()).data()!;
  assert.equal(stored.user_id, "api:one"); assert.equal(stored.name, "Saldo semanal");
  assert.equal(stored.active, false); assert.equal(stored.next_run_at, null);
  assert.equal((await db.collection("agent_messages").get()).size, 0);
  assert.equal((await db.collection("users").get()).size, 0);
});
test("isola integração, clientes e registros humanos nas listas, detalhes e alterações", async () => {
  for (const [resource, body] of [["playbooks", playbook], ["rotinas", routine]] as const) {
    const created = await call(resource, "POST", body);
    assert.equal((await call(resource, "GET", undefined, undefined, context("two"))).data.length, 0);
    await assert.rejects(call(resource, "GET", undefined, created.id, context("two")), { code: "not-found" });
    await assert.rejects(call(resource, "PATCH", body, created.id, context("two")), { code: "not-found" });
    await assert.rejects(call(resource, "PATCH", { ...body, customer_code: "B" }, created.id), { code: "permission-denied" });
  }
  await db.collection("agent_routines").doc("rot_11111111111111111111").set({ ...routine, user_id: "human" });
  assert.equal((await call("rotinas", "GET")).data.length, 1);
});
test("projeção remove dados nested e financeiros/RH, incluindo campos malformados", async () => {
  const { id } = await call("playbooks", "POST", playbook);
  await db.collection("ai_agent_playbooks").doc(id).update({ salary: 100, title: { salary: 200 }, steps: ["Seguro", { cpf: "sigiloso" }], updated_by: { uid: "api:one", secret: "sigiloso" } });
  const detail = await call("playbooks", "GET", undefined, id);
  assert.deepEqual(detail.data.steps, ["Seguro"]);
  assert.equal("title" in detail.data, false);
  assert.equal(JSON.stringify(detail).includes("sigiloso"), false);
  assert.equal(JSON.stringify(await call("playbooks", "GET")).includes("sigiloso"), false);
});

test("PATCH concorrente com a mesma versão permite uma alteração e recusa a edição perdida", async () => {
  for (const [resource, body] of [["playbooks", playbook], ["rotinas", routine]] as const) {
    const created = await call(resource, "POST", body);
    const expected_version = (await call(resource, "GET", undefined, created.id)).data.version;
    const results = await Promise.allSettled([1, 2].map((index) => {
      const ctx = context(); ctx.idempotencyKey = `edit-concurrent-${index}`;
      return call(resource, "PATCH", { ...body, expected_version, ...(resource === "playbooks" ? { title: `Editado ${index}` } : { name: `Editada ${index}` }) }, created.id, ctx);
    }));
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    const rejected = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
    assert.equal(rejected.reason.code, "aborted");
  }
});

test("handler repete rotina sem duplicar, conflita corpo diferente e controla concorrência", async () => {
  const integration = "a".repeat(32);
  const token = `dute_${integration}.${"b".repeat(43)}`;
  await db.collection("users").doc("responsible").set({ role: "admin" });
  await db.collection("api_integrations").doc(integration).set({ token_hash: createHash("sha256").update(token).digest("hex"), delegated_by: "responsible", scopes: context().integration.scopes, customers: ["A"], write_policy: "scoped", expires_at_ms: Date.now() + 600000 });
  const handle = createModuleHandler(db, "dute-homolog", async () => { throw new Error("Integração não usa login humano"); }, agenteApi);
  const request: ApiRequest = { method: "POST", path: "/api/v1/agente/rotinas", query: {}, headers: { authorization: `Bearer ${token}`, "idempotency-key": "routine-replay" }, body: routine };
  const concurrent = await Promise.all([handle(request), handle(request)]);
  assert.equal(concurrent.filter((r) => r.status === 201).length, 1);
  assert.ok(concurrent.every((r) => [200, 201, 409].includes(r.status)));
  const created = concurrent.find((r) => r.status === 201)!;
  const replay = await handle(request);
  assert.equal(replay.status, 200); assert.equal(replay.body.replayed, true);
  assert.deepEqual(replay.body.data, created.body.data);
  assert.equal((await db.collection("agent_routines").get()).size, 1);
  assert.equal((await handle({ ...request, body: { ...routine, name: "Outra rotina" } })).status, 409);
  const id = (created.body.data as { id: string }).id;
  const read = await handle({ ...request, method: "GET", path: `/api/v1/agente/rotinas/${id}`, body: undefined, query: { customer_code: "A" } });
  assert.equal(read.status, 200);
  assert.equal((read.body.data as { name: string }).name, routine.name);
  assert.equal((await db.collection("users").doc(`api:${integration}`).get()).exists, false);
});
test("lista paginada mantém projeção, versão e isolamento em cada página", async () => {
  await call("playbooks", "POST", playbook);
  const ctx = context(); ctx.idempotencyKey = "synthetic-another-playbook";
  await call("playbooks", "POST", { ...playbook, title: "Outro procedimento" }, undefined, ctx);
  const route = agenteApi.routes.find((r) => r.method === "GET" && r.path === "/api/v1/agente/playbooks")!;
  const first = await route.run(context(), {}, { method: "GET", path: route.path, headers: {}, query: { customer_code: "A", limit: 1 } }) as any;
  assert.equal(first.data.length, 1); assert.match(first.data[0].version, /^\d+:\d+$/);
  assert.equal(typeof first.next_cursor, "string");
  const second = await route.run(context(), {}, { method: "GET", path: route.path, headers: {}, query: { customer_code: "A", limit: 1, cursor: first.next_cursor } }) as any;
  assert.equal(second.data.length, 1); assert.equal(second.next_cursor, null);
  assert.notEqual(first.data[0].id, second.data[0].id);
});
