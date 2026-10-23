import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { HttpsError, type CallableRequest } from "firebase-functions/https";

import { getProfile, requireOperacaoCaller } from "./profile.js";

const PROJECT_ID = "demo-dute-operacao";

let db: Firestore;
let app: ReturnType<typeof initializeApp>;

before(() => {
  app = initializeApp({ projectId: PROJECT_ID }, "operacao-profile-test");
  db = getFirestore(app);
});

beforeEach(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error("FIRESTORE_EMULATOR_HOST não definido.");
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
  const users = db.collection("users");
  await Promise.all([
    users.doc("owner-1").set({ role: "owner", nome: "Leonardo", email: "leonardo@dutelog.com.br" }),
    users.doc("interno-1").set({ role: "interno", nome: "Marina", email: "marina@dutelog.com.br" }),
    users.doc("campo-1").set({ role: "campo", nome: "Paulo" }),
    users.doc("suporte-1").set({ role: "suporte", nome: "Suporte" }),
    users.doc("comercial-1").set({ role: "comercial", nome: "Guilherme" }),
    users.doc("off-1").set({ role: "interno", nome: "Desligado", access_disabled: true }),
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

describe("perfil de quem grava o cadastro da Operação", () => {
  it("interno e owner entram, com o nome do cadastro", async () => {
    const interno = await getProfile(db, request("interno-1"));
    assert.equal(interno.role, "interno");
    assert.equal(interno.name, "Marina");
    assert.equal((await getProfile(db, request("owner-1"))).role, "owner");
  });

  it("campo, suporte e comercial não gravam; acesso removido também não", async () => {
    for (const uid of ["campo-1", "suporte-1", "comercial-1"]) {
      const error = await rejection(getProfile(db, request(uid)));
      assert.equal(error.code, "permission-denied", uid);
      assert.match(error.message, /não grava/, uid);
    }
    const removido = await rejection(getProfile(db, request("off-1")));
    assert.match(removido.message, /Acesso removido/);
  });

  it("requireOperacaoCaller passa na homologação e na produção, recusa no dute-btg", async () => {
    assert.equal((await requireOperacaoCaller(db, request("interno-1"), "dute-homolog")).role, "interno");
    assert.equal((await requireOperacaoCaller(db, request("interno-1"), "dute-prod")).role, "interno");
    const antiga = await rejection(requireOperacaoCaller(db, request("owner-1"), "dute-btg"));
    assert.equal(antiga.code, "failed-precondition");
  });
});
