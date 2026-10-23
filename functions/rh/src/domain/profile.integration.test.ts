import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { HttpsError, type CallableRequest } from "firebase-functions/https";

import { requireRhCaller } from "./profile.js";

/**
 * O perfil de quem abre o RH no emulador: owner, admin e rh entram, com o
 * nome do cadastro; os outros papéis, o acesso removido, o perfil sem papel e
 * quem não entrou recusam; fora da homologação, recusa antes do perfil.
 */

const PROJECT_ID = "demo-dute-rh";

let db: Firestore;
let app: ReturnType<typeof initializeApp>;

before(() => {
  app = initializeApp({ projectId: PROJECT_ID }, "rh-profile-test");
  db = getFirestore(app);
});

after(async () => {
  await deleteApp(app);
});

const PAPEIS = ["owner", "admin", "rh", "interno", "wms", "campo", "comercial", "financeiro", "suporte", "painel", "cliente"] as const;

beforeEach(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error("FIRESTORE_EMULATOR_HOST não definido.");
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
  const batch = db.batch();
  for (const role of PAPEIS) batch.set(db.doc(`users/${role}-1`), { role, nome: `Pessoa ${role}`, email: `${role}@dutelog.com.br` });
  batch.set(db.doc("users/removido"), { role: "rh", access_disabled: true });
  batch.set(db.doc("users/sem-papel"), { role: "gerente" });
  await batch.commit();
});

const pedido = (uid: string | null) => ({ auth: uid ? { uid, token: { email: `${uid}@dutelog.com.br` } } : undefined, data: {} }) as unknown as CallableRequest<unknown>;

async function recusa(promessa: Promise<unknown>, codigo: string, mensagem: RegExp) {
  await assert.rejects(promessa, (error: unknown) => {
    assert.ok(error instanceof HttpsError, String(error));
    assert.equal(error.code, codigo);
    assert.match(error.message, mensagem);
    return true;
  });
}

describe("perfil de quem abre o RH", () => {
  it("owner, admin e rh entram, com o nome do cadastro", async () => {
    for (const role of ["owner", "admin", "rh"] as const) {
      const perfil = await requireRhCaller(db, pedido(`${role}-1`), "dute-homolog");
      assert.deepEqual([perfil.role, perfil.name], [role, `Pessoa ${role}`]);
    }
  });

  it("os outros papéis, o acesso removido, o perfil sem papel e quem não entrou não abrem", async () => {
    for (const role of PAPEIS.filter((papel) => !["owner", "admin", "rh"].includes(papel))) {
      await recusa(requireRhCaller(db, pedido(`${role}-1`), "dute-homolog"), "permission-denied", /não abre o RH/);
    }
    await recusa(requireRhCaller(db, pedido("removido"), "dute-homolog"), "permission-denied", /Acesso removido/);
    await recusa(requireRhCaller(db, pedido("sem-papel"), "dute-homolog"), "permission-denied", /sem papel válido/);
    await recusa(requireRhCaller(db, pedido("ninguem"), "dute-homolog"), "permission-denied", /sem perfil ativo/);
    await recusa(requireRhCaller(db, pedido(null), "dute-homolog"), "unauthenticated", /Faça login/);
  });

  it("fora da homologação, recusa antes de ler o perfil", async () => {
    await recusa(requireRhCaller(db, pedido("rh-1"), "dute-prod"), "failed-precondition", /não está liberado neste ambiente \(dute-prod\)/);
  });
});
