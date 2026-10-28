import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import {
  enableReinvitedLoginFor,
  readReinvitedUser,
  userDirectoryArchivePayload,
} from "./user-directory.js";

const PROJECT = "demo-dute-operations";
const TOKEN = "a".repeat(36);
const owner = { uid: "owner", role: "owner" };
const admin = { uid: "admin", role: "admin" };
let app: ReturnType<typeof initializeApp>;
let db: Firestore;

before(() => {
  app = initializeApp({ projectId: PROJECT }, "user-directory-test");
  db = getFirestore(app);
});
beforeEach(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error("FIRESTORE_EMULATOR_HOST não definido.");
  await fetch(
    `http://${host}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`,
    { method: "DELETE" },
  );
});
after(() => deleteApp(app));

describe("remover da lista preservando o perfil", () => {
  it("só oculta perfis sem acesso e registra quem removeu", () => {
    assert.throws(
      () => userDirectoryArchivePayload("ana", { role: "wms" }, owner),
      /Revogue/,
    );
    const payload = userDirectoryArchivePayload(
      "ana",
      { role: "wms", access_disabled: true },
      admin,
    );
    assert.equal(payload.directory_hidden, true);
    assert.equal(payload.directory_hidden_by, "admin");
    assert.equal("role" in payload, false);
    assert.equal("email" in payload, false);
  });
  it("protege o próprio perfil, administradores e papéis sem permissão", () => {
    const target = { role: "admin", access_disabled: true };
    assert.throws(
      () => userDirectoryArchivePayload("owner", target, owner),
      /próprio/,
    );
    assert.throws(
      () => userDirectoryArchivePayload("outro-admin", target, admin),
      /Somente o owner/,
    );
    assert.throws(
      () =>
        userDirectoryArchivePayload("ana", target, { uid: "wms", role: "wms" }),
      /administradores/,
    );
  });
});

describe("reconvite do mesmo e-mail", () => {
  it("encontra o perfil oculto sem apagá-lo; recusa quem já tem acesso", async () => {
    const ref = db.collection("users").doc("ana");
    await ref.set({
      role: "wms",
      email: "ana@dutelog.com.br",
      access_disabled: true,
      directory_hidden: true,
    });
    const result = await db.runTransaction((tx) =>
      readReinvitedUser(tx, db, "ana@dutelog.com.br", owner),
    );
    assert.equal(result?.id, "ana");
    await ref.update({ access_disabled: false });
    await assert.rejects(
      db.runTransaction((tx) =>
        readReinvitedUser(tx, db, "ana@dutelog.com.br", owner),
      ),
      /já tem acesso/,
    );
  });
  it("um admin não reconvida um owner/admin, mesmo mudando para um papel menor", async () => {
    await db
      .collection("users")
      .doc("outro")
      .set({
        role: "owner",
        email: "outro@dutelog.com.br",
        access_disabled: true,
      });
    await assert.rejects(
      db.runTransaction((tx) =>
        readReinvitedUser(tx, db, "outro@dutelog.com.br", admin),
      ),
      /Somente o owner/,
    );
  });
  it("só habilita o login do convite atual; falha no Auth pode ser tentada novamente e o perfil segue bloqueado", async () => {
    await db
      .collection("users")
      .doc("ana")
      .set({ access_disabled: true, pending_invite_id: TOKEN });
    await db
      .collection("invites")
      .doc(TOKEN)
      .set({ status: "pending", reinvite_user_id: "ana" });
    const calls: string[] = [];
    let fail = true;
    const auth = {
      async updateUser(uid: string, input: { disabled: boolean }) {
        assert.equal(input.disabled, false);
        calls.push(uid);
        if (fail) throw new Error("Auth indisponível");
      },
    };
    await assert.rejects(enableReinvitedLoginFor(db, auth, TOKEN), /reenviar/i);
    fail = false;
    await enableReinvitedLoginFor(db, auth, TOKEN);
    assert.deepEqual(calls, ["ana", "ana"]);
    assert.equal(
      (await db.collection("users").doc("ana").get()).get("access_disabled"),
      true,
    );
    await db.collection("invites").doc(TOKEN).update({ status: "revoked" });
    await enableReinvitedLoginFor(db, auth, TOKEN);
    await db.collection("invites").doc(TOKEN).update({ status: "pending" });
    await db
      .collection("users")
      .doc("ana")
      .update({ pending_invite_id: "outro" });
    await enableReinvitedLoginFor(db, auth, TOKEN);
    assert.equal(calls.length, 2);
  });
});
