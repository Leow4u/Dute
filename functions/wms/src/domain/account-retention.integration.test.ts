import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

import { setUserAccessTransaction } from "./access.js";
import { anonymizeRemovedAccounts, type AccountAuth } from "./account-retention.js";

/**
 * A conta removida há mais de 12 meses no emulador (LGPD, decisão 8, parte
 * 8c): o login sai do Auth, o perfil e o convite usado ficam sem nome e
 * e-mail, as rotinas do Agent Dute da pessoa saem e o evento não leva nada
 * dela; o acesso removido há menos tempo, o devolvido e o ativo ficam; a
 * conta anonimizada não volta pelo "devolver acesso". Dados sintéticos.
 */

const PROJECT_ID = "demo-dute-operations";
const NOW = new Date("2026-10-26T06:50:00.000Z");
const admin = { uid: "admin-1", role: "admin", email: "admin@dutelog.com.br" };

let db: Firestore;
let app: ReturnType<typeof initializeApp>;

/** O Auth falso: guarda quem saiu e, para cada uid, o erro que devolve. */
function fakeAuth(errors: Record<string, string> = {}) {
  const deleted: string[] = [];
  const auth: AccountAuth = {
    async deleteUser(uid) {
      if (errors[uid]) throw Object.assign(new Error(errors[uid]), { code: errors[uid] });
      deleted.push(uid);
    },
  };
  return { auth, deleted };
}

async function removedUser(uid: string, removedAtIso: string | null, extra: Record<string, unknown> = {}) {
  await db
    .collection("users")
    .doc(uid)
    .set({
      nome: "Rafael Souza",
      email: `${uid}@dutelog.com.br`,
      role: "wms",
      customer_code: "Dutelog",
      invite_id: `inv_${uid}`,
      access_disabled: true,
      ...(removedAtIso ? { access_changed_at: removedAtIso } : {}),
      access_changed_by: "admin-1",
      access_change_reason: "Saiu da empresa",
      ...extra,
    });
  await db.collection("invites").doc(`inv_${uid}`).set({ nome: "Rafael Souza", email: `${uid}@dutelog.com.br`, role: "wms", status: "used", used_by: uid });
}

async function data(collection: string, id: string) {
  return (await db.collection(collection).doc(id).get()).data();
}

async function anonymizedEvents() {
  return (await db.collection("events").where("type", "==", "user.account_anonymized").get()).docs.map((doc) => doc.data());
}

before(() => {
  app = initializeApp({ projectId: PROJECT_ID }, "account-retention-test");
  db = getFirestore(app);
});

beforeEach(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error("FIRESTORE_EMULATOR_HOST não definido.");
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
  await db.collection("users").doc("admin-1").set({ nome: "Admin", email: "admin@dutelog.com.br", role: "admin" });
});

after(async () => {
  await deleteApp(app);
});

describe("a conta removida há mais de 12 meses", () => {
  it("apaga o login, tira o nome e o e-mail do perfil e do convite, apaga as rotinas e grava o evento sem dado da pessoa", async () => {
    await removedUser("gone", "2025-09-20T15:00:00.000Z");
    await db.collection("agent_routines").doc("rot_gone").set({ id: "rot_gone", user_id: "gone", user_name: "Rafael Souza", prompt: "Resumo do dia" });
    await db.collection("agent_routines").doc("rot_ana").set({ id: "rot_ana", user_id: "ana", user_name: "Ana", prompt: "Resumo do dia" });
    await db.collection("events").doc("ev_revoked").set({ type: "user.access_revoked", entity_type: "user", entity_id: "gone", description: "Rafael Souza — Saiu da empresa" });
    await removedUser("recent", "2025-12-01T12:00:00.000Z");
    await removedUser("restored", "2024-05-01T12:00:00.000Z", { access_disabled: false });
    await removedUser("no-date", null);
    const { auth, deleted } = fakeAuth();

    const result = await anonymizeRemovedAccounts(db, auth, { now: NOW });

    assert.deepEqual(result, { antes_de: "2025-10-26", contas: 1, convites: 1, rotinas: 1, sem_data: 1, falhas: 0, completo: true });
    assert.deepEqual(deleted, ["gone"]);
    const profile = await data("users", "gone");
    assert.deepEqual(["nome", "email", "access_change_reason"].filter((field) => field in profile!), []);
    assert.deepEqual(
      [profile!.role, profile!.customer_code, profile!.invite_id, profile!.access_disabled, profile!.access_changed_at, profile!.access_changed_by, profile!.anonymized_at],
      ["wms", "Dutelog", "inv_gone", true, "2025-09-20T15:00:00.000Z", "admin-1", NOW.toISOString()],
    );
    const invite = await data("invites", "inv_gone");
    assert.deepEqual([("nome" in invite!), ("email" in invite!), invite!.status, invite!.used_by, invite!.anonymized_at], [false, false, "used", "gone", NOW.toISOString()]);
    assert.deepEqual((await db.collection("agent_routines").get()).docs.map((doc) => doc.id), ["rot_ana"]);

    const [event, ...others] = await anonymizedEvents();
    assert.equal(others.length, 0);
    assert.deepEqual([event!.entity_type, event!.entity_id, event!.source, event!.actor.role], ["user", "gone", "functions_access", "sistema"]);
    assert.deepEqual(event!.payload, { role: "wms", removido_em: "2025-09-20", convite: true, rotinas: 1 });
    assert.equal(/Rafael|gone@dutelog|Saiu da empresa/.test(JSON.stringify(event)), false);
    // O evento da remoção fica como foi gravado.
    assert.equal((await data("events", "ev_revoked"))!.description, "Rafael Souza — Saiu da empresa");

    for (const uid of ["recent", "restored", "no-date"]) {
      const kept = await data("users", uid);
      assert.deepEqual([kept!.nome, kept!.email, "anonymized_at" in kept!], ["Rafael Souza", `${uid}@dutelog.com.br`, false], uid);
    }
  });

  it("a conta que já não está no Auth também fica anônima; a falha no Auth deixa o perfil para o dia seguinte", async () => {
    await removedUser("sem-login", "2025-09-20T15:00:00.000Z");
    await removedUser("auth-fora", "2025-09-20T15:00:00.000Z");
    const first = await anonymizeRemovedAccounts(db, fakeAuth({ "sem-login": "auth/user-not-found", "auth-fora": "auth/internal-error" }).auth, { now: NOW });

    assert.deepEqual([first.contas, first.falhas], [1, 1]);
    assert.equal("nome" in (await data("users", "sem-login"))!, false);
    assert.equal((await data("users", "auth-fora"))!.nome, "Rafael Souza");

    const { auth, deleted } = fakeAuth();
    const second = await anonymizeRemovedAccounts(db, auth, { now: new Date(NOW.getTime() + 86_400_000) });
    assert.deepEqual([second.contas, second.falhas, deleted], [1, 0, ["auth-fora"]]);
    assert.equal("nome" in (await data("users", "auth-fora"))!, false);
  });

  it("rodar de novo não apaga mais nada nem grava outro evento", async () => {
    await removedUser("gone", "2025-09-20T15:00:00.000Z");
    await anonymizeRemovedAccounts(db, fakeAuth().auth, { now: NOW });
    const { auth, deleted } = fakeAuth();
    const again = await anonymizeRemovedAccounts(db, auth, { now: new Date(NOW.getTime() + 60_000) });
    assert.deepEqual(again, { antes_de: "2025-10-26", contas: 0, convites: 0, rotinas: 0, sem_data: 0, falhas: 0, completo: true });
    assert.deepEqual(deleted, []);
    assert.equal((await anonymizedEvents()).length, 1);
  });

  it("o convite usado por outra conta fica, e o que não coube na rodada fica para a próxima", async () => {
    await removedUser("a", "2025-09-20T15:00:00.000Z");
    await removedUser("b", "2025-09-21T15:00:00.000Z");
    await removedUser("c", "2025-09-22T15:00:00.000Z", { invite_id: "inv_outro" });
    await db.collection("invites").doc("inv_outro").set({ nome: "Outra pessoa", email: "outra@dutelog.com.br", status: "used", used_by: "outra" });

    const first = await anonymizeRemovedAccounts(db, fakeAuth().auth, { now: NOW, perRun: 2 });
    assert.deepEqual([first.contas, first.completo], [2, false]);
    const second = await anonymizeRemovedAccounts(db, fakeAuth().auth, { now: NOW, perRun: 2 });
    assert.deepEqual([second.contas, second.convites, second.completo], [1, 0, true]);
    assert.equal((await data("invites", "inv_outro"))!.email, "outra@dutelog.com.br");
  });

  it("a conta anonimizada não volta pelo devolver acesso: só por convite novo", async () => {
    await removedUser("gone", "2025-09-20T15:00:00.000Z");
    await anonymizeRemovedAccounts(db, fakeAuth().auth, { now: NOW });

    await assert.rejects(setUserAccessTransaction(db, { user_id: "gone", active: true }, admin), (error: { code?: string; message?: string }) => {
      assert.equal(error.code, "failed-precondition");
      assert.match(String(error.message), /Convide a pessoa de novo/);
      return true;
    });
    assert.equal((await data("users", "gone"))!.access_disabled, true);
  });
});
