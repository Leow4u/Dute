import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { HttpsError, type CallableRequest } from "firebase-functions/https";

import { getProfile, loadProfile, requireComercialCaller } from "./profile.js";

const PROJECT_ID = "demo-dute-comercial";

let db: Firestore;
let app: ReturnType<typeof initializeApp>;

before(() => {
  app = initializeApp({ projectId: PROJECT_ID }, "comercial-profile-test");
  db = getFirestore(app);
});

beforeEach(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error("FIRESTORE_EMULATOR_HOST não definido.");
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
  const users = db.collection("users");
  await Promise.all([
    users.doc("owner-1").set({ role: "owner", nome: "Leonardo", email: "leonardo@dutelog.com.br" }),
    users.doc("com-1").set({ role: "comercial", nome: "Guilherme", email: "comercial@dutelog.com.br" }),
    users.doc("wms-1").set({ role: "wms", nome: "Operador" }),
    users.doc("fin-1").set({ role: "financeiro", nome: "Financeiro" }),
    users.doc("cli-1").set({ role: "cliente", nome: "Cristiane", customer_code: "BTG Pactual" }),
    users.doc("off-1").set({ role: "comercial", nome: "Desligado", access_disabled: true }),
    users.doc("bad-1").set({ role: "viewer", nome: "Papel antigo" }),
  ]);
});

after(async () => {
  await deleteApp(app);
});

function request(uid: string): CallableRequest<unknown> {
  return {
    data: {},
    rawRequest: {} as CallableRequest<unknown>["rawRequest"],
    acceptsStreaming: false,
    auth: { uid, token: { email: `${uid}@token`, name: `Token ${uid}` } } as unknown as CallableRequest<unknown>["auth"],
  } as CallableRequest<unknown>;
}

async function rejection(promise: Promise<unknown>): Promise<HttpsError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof HttpsError, `esperava HttpsError, veio ${String(error)}`);
    return error;
  }
  assert.fail("deveria recusar");
}

describe("perfil de quem chama o Comercial", () => {
  it("comercial e owner entram, com o nome do cadastro", async () => {
    const comercial = await getProfile(db, request("com-1"));
    assert.equal(comercial.role, "comercial");
    assert.equal(comercial.name, "Guilherme");
    assert.equal(comercial.email, "com-1@token");
    assert.equal((await getProfile(db, request("owner-1"))).role, "owner");
  });

  it("sem perfil, acesso removido ou papel inválido: permission-denied", async () => {
    for (const [uid, message] of [
      ["ninguem", /sem perfil ativo/],
      ["off-1", /Acesso removido/],
      ["bad-1", /sem papel válido/],
    ] as const) {
      const error = await rejection(getProfile(db, request(uid)));
      assert.equal(error.code, "permission-denied", uid);
      assert.match(error.message, message, uid);
    }
  });

  it("wms, financeiro e cliente: permission-denied no Comercial", async () => {
    for (const uid of ["wms-1", "fin-1", "cli-1"]) {
      const error = await rejection(getProfile(db, request(uid)));
      assert.equal(error.code, "permission-denied", uid);
      assert.match(error.message, /não tem acesso ao Comercial/, uid);
    }
  });

  it("loadProfile devolve o papel mesmo sem acesso ao Comercial (o comercialStatus usa)", async () => {
    const cliente = await loadProfile(db, "cli-1");
    assert.equal(cliente.role, "cliente");
    assert.equal(cliente.customer_code, "BTG Pactual");
  });

  it("requireComercialCaller: liberado na homologação, recusado na produção", async () => {
    assert.equal((await requireComercialCaller(db, request("com-1"), "dute-homolog")).role, "comercial");
    const error = await rejection(requireComercialCaller(db, request("com-1"), "dute-prod"));
    assert.equal(error.code, "failed-precondition");
    const denied = await rejection(requireComercialCaller(db, request("cli-1"), "dute-homolog"));
    assert.equal(denied.code, "permission-denied");
  });

  it("requireComercialCaller com { financeiro: true }: o financeiro entra; sem a opção, não; os outros papéis continuam fora", async () => {
    const semOpcao = await rejection(requireComercialCaller(db, request("fin-1"), "dute-homolog"));
    assert.equal(semOpcao.code, "permission-denied");
    const financeiro = await requireComercialCaller(db, request("fin-1"), "dute-homolog", { financeiro: true });
    assert.equal(financeiro.role, "financeiro");
    assert.equal((await requireComercialCaller(db, request("com-1"), "dute-homolog", { financeiro: true })).role, "comercial");
    for (const uid of ["wms-1", "cli-1", "off-1"]) {
      const error = await rejection(requireComercialCaller(db, request(uid), "dute-homolog", { financeiro: true }));
      assert.equal(error.code, "permission-denied", uid);
    }
    // A liberação vem antes: na produção, nem o financeiro passa.
    const producao = await rejection(requireComercialCaller(db, request("fin-1"), "dute-prod", { financeiro: true }));
    assert.equal(producao.code, "failed-precondition");
  });
});
