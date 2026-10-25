import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

import { setUserAccessFor, setUserAccessTransaction, type AccessAuth } from "./access.js";

const PROJECT_ID = "demo-dute-operations";
let db: Firestore;
let app: ReturnType<typeof initializeApp>;

const owner = { uid: "owner-1", role: "owner", email: "owner@dutelog.com.br" };
const admin = { uid: "admin-1", role: "admin", email: "admin@dutelog.com.br" };

async function seed() {
  await db.collection("users").doc("wms-1").set({ nome: "Rafael", email: "r@x", role: "wms" });
  await db.collection("users").doc("admin-2").set({ nome: "Outro admin", email: "a@x", role: "admin" });
  await db.collection("users").doc("admin-1").set({ nome: "Admin", email: "admin@x", role: "admin" });
  await db.collection("users").doc("owner-1").set({ nome: "Owner", email: "owner@x", role: "owner" });
  await db.collection("users").doc("owner-2").set({ nome: "Outro owner", email: "o2@x", role: "owner" });
}

async function eventsFor(userId: string) {
  const snapshot = await db.collection("events").where("entity_id", "==", userId).get();
  return snapshot.docs.map((document) => document.data());
}

before(() => {
  app = initializeApp({ projectId: PROJECT_ID }, "access-test");
  db = getFirestore(app);
});

beforeEach(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error("FIRESTORE_EMULATOR_HOST não definido.");
  await fetch(
    `http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: "DELETE" },
  );
  await seed();
});

after(async () => {
  await deleteApp(app);
});

describe("remover e devolver acesso", () => {
  it("remove o acesso, grava quem e por quê, e registra o evento", async () => {
    const result = await setUserAccessTransaction(
      db,
      { user_id: "wms-1", active: false, reason: "Saiu da empresa" },
      admin,
    );
    assert.deepEqual(result, { ok: true, user_id: "wms-1", active: false, changed: true });

    const user = (await db.collection("users").doc("wms-1").get()).data() ?? {};
    assert.equal(user.access_disabled, true);
    assert.equal(user.access_changed_by, "admin-1");
    assert.equal(user.access_change_reason, "Saiu da empresa");
    assert.equal(user.role, "wms");

    const events = await eventsFor("wms-1");
    assert.equal(events.length, 1);
    assert.equal(events[0].type, "user.access_revoked");
  });

  it("repetir não duplica o evento; devolver registra outro", async () => {
    await setUserAccessTransaction(db, { user_id: "wms-1", active: false }, admin);
    const again = await setUserAccessTransaction(db, { user_id: "wms-1", active: false }, admin);
    assert.equal(again.changed, false);
    await setUserAccessTransaction(db, { user_id: "wms-1", active: true }, admin);

    const user = (await db.collection("users").doc("wms-1").get()).data() ?? {};
    assert.equal(user.access_disabled, false);
    const types = (await eventsFor("wms-1")).map((event) => event.type).sort();
    assert.deepEqual(types, ["user.access_restored", "user.access_revoked"]);
  });

  it("ninguém remove o próprio acesso", async () => {
    await assert.rejects(
      setUserAccessTransaction(db, { user_id: "admin-1", active: false }, admin),
      /próprio acesso/,
    );
  });

  it("admin não remove outro admin; owner pode", async () => {
    await assert.rejects(
      setUserAccessTransaction(db, { user_id: "admin-2", active: false }, admin),
      /Somente o owner/,
    );
    const result = await setUserAccessTransaction(db, { user_id: "admin-2", active: false }, owner);
    assert.equal(result.changed, true);
  });

  it("perfis sem administração de acesso são recusados", async () => {
    await assert.rejects(
      setUserAccessTransaction(db, { user_id: "wms-1", active: false }, { uid: "ops-1", role: "interno" }),
      /administradores de acesso/,
    );
  });
});

// Quem age chega com o perfil lido antes da transação. Dois owners que se
// tiram ao mesmo tempo deixariam o sistema sem nenhum: a transação relê quem
// age, e a segunda para com o perfil de agora.
describe("quem administra o acesso, relido na transação", () => {
  it("o owner que perdeu o acesso no meio do caminho não tira o de ninguém", async () => {
    await db.collection("users").doc("owner-1").set({ access_disabled: true }, { merge: true });
    await assert.rejects(
      setUserAccessTransaction(db, { user_id: "owner-2", active: false }, owner),
      /Seu acesso mudou/,
    );
    assert.notEqual((await db.collection("users").doc("owner-2").get()).get("access_disabled"), true);
  });

  it("o owner rebaixado no meio do caminho não tira o acesso de outro owner", async () => {
    await db.collection("users").doc("owner-1").set({ role: "admin" }, { merge: true });
    await assert.rejects(
      setUserAccessTransaction(db, { user_id: "owner-2", active: false }, owner),
      /Seu acesso mudou/,
    );
    assert.equal((await eventsFor("owner-2")).length, 0);
  });
});

/** O Auth de mentira: grava cada chamada e falha nas que o teste pede. */
function authDeMentira(falhas: Array<Error & { code?: string }> = []) {
  const chamadas: string[] = [];
  const auth: AccessAuth = {
    async updateUser(uid, properties) {
      chamadas.push(`updateUser ${uid} ${properties.disabled ? "bloqueia" : "libera"}`);
      const falha = falhas.shift();
      if (falha) throw falha;
      return {};
    },
    async revokeRefreshTokens(uid) {
      chamadas.push(`revokeRefreshTokens ${uid}`);
    },
  };
  return { auth, chamadas };
}

describe("o login no Firebase Auth acompanha o acesso", () => {
  it("o login que não foi liberado volta como erro, e a nova tentativa o libera", async () => {
    await db.collection("users").doc("wms-1").set({ access_disabled: true }, { merge: true });
    const quebrado = authDeMentira([new Error("Auth fora do ar")]);
    await assert.rejects(
      setUserAccessFor(db, quebrado.auth, { user_id: "wms-1", active: true }, owner),
      /login da pessoa não foi liberado/,
    );
    // O perfil já voltou; o que faltou foi o login.
    assert.equal((await db.collection("users").doc("wms-1").get()).get("access_disabled"), false);

    const deNovo = authDeMentira();
    const result = await setUserAccessFor(db, deNovo.auth, { user_id: "wms-1", active: true }, owner);
    assert.equal(result.changed, false);
    assert.deepEqual(deNovo.chamadas, ["updateUser wms-1 libera"]);
  });

  it("remover bloqueia o login e derruba as sessões", async () => {
    const { auth, chamadas } = authDeMentira();
    await setUserAccessFor(db, auth, { user_id: "wms-1", active: false }, owner);
    assert.deepEqual(chamadas, ["updateUser wms-1 bloqueia", "revokeRefreshTokens wms-1"]);
  });

  it("sem a conta no Auth, remover vale: não há login para bloquear", async () => {
    const semConta = Object.assign(new Error("There is no user record"), { code: "auth/user-not-found" });
    const { auth } = authDeMentira([semConta]);
    const result = await setUserAccessFor(db, auth, { user_id: "wms-1", active: false }, owner);
    assert.equal(result.changed, true);
  });

  it("sem a conta no Auth, devolver diz que a pessoa não tem login, em vez de pedir outra tentativa", async () => {
    await db.collection("users").doc("wms-1").set({ access_disabled: true }, { merge: true });
    const semConta = Object.assign(new Error("There is no user record"), { code: "auth/user-not-found" });
    const { auth } = authDeMentira([semConta]);
    await assert.rejects(
      setUserAccessFor(db, auth, { user_id: "wms-1", active: true }, owner),
      (error: { code?: string; message?: string }) =>
        error.code === "failed-precondition" && /não tem login\. Convide-a de novo/.test(error.message ?? ""),
    );
  });
});
