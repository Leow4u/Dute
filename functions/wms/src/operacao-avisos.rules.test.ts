import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from "firebase/firestore";

/**
 * Regras dos avisos (docs/plataforma/fase-4-financeiro.md, parte 4.6a): o
 * cliente lê só os próprios avisos do sino; o aviso da NF leva o valor, então
 * a equipe interna não lê, só owner e admin. A fila de e-mail, com os
 * endereços dos contatos, é só de owner e admin, e o cursor da rotina não
 * abre pelo navegador. Ninguém grava pelo navegador.
 */

const PROJECT_ID = "demo-dute-operations";
const AVISO_ITAU = "ntf_evt_itau";
const AVISO_SAFRA = "ntf_evt_safra";
const EMAIL_ITAU = "mail_evt_itau";

let testEnvironment: RulesTestEnvironment;

function endereco(variavel: string) {
  const address = process.env[variavel];
  assert.ok(address, `Execute este teste pelo Firebase Emulator (${variavel}).`);
  const [host, rawPort] = address.split(":");
  return { host, port: Number(rawPort) };
}

function regras(arquivo: string) {
  const currentDirectory = dirname(fileURLToPath(import.meta.url));
  return readFileSync(resolve(currentDirectory, "../../../", arquivo), "utf8");
}

const PAPEIS: Record<string, { role: string; customer_code?: string }> = {
  "owner-a": { role: "owner" },
  "admin-a": { role: "admin" },
  "ops-a": { role: "interno" },
  "support-a": { role: "suporte" },
  "wms-a": { role: "wms" },
  "campo-a": { role: "campo" },
  "comercial-a": { role: "comercial" },
  "financeiro-a": { role: "financeiro" },
  "client-itau": { role: "cliente", customer_code: "ITAU" },
  "client-safra": { role: "cliente", customer_code: "SAFRA" },
};

const EQUIPE_SEM_LEITURA = ["ops-a", "support-a", "wms-a", "campo-a", "comercial-a", "financeiro-a"];

beforeEach(async () => {
  await testEnvironment.clearFirestore();
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    const database = context.firestore();
    for (const [uid, perfil] of Object.entries(PAPEIS)) await setDoc(doc(database, "users", uid), { nome: uid, ...perfil });
    await setDoc(doc(database, "client_notifications", AVISO_ITAU), { id: AVISO_ITAU, customer_code: "ITAU", modelo: "nf_emitida", titulo: "NF 1234 emitida", texto: "R$ 1.000,00", lida_por: [] });
    await setDoc(doc(database, "client_notifications", AVISO_SAFRA), { id: AVISO_SAFRA, customer_code: "SAFRA", modelo: "os_agendada", titulo: "OS 10050-01 agendada", texto: "Transporte", lida_por: [] });
    await setDoc(doc(database, "email_outbox", EMAIL_ITAU), { id: EMAIL_ITAU, customer_code: "ITAU", to: ["gestor@itau.com"], status: "pending" });
    await setDoc(doc(database, "notification_cursors", "avisos"), { evento_id: "evt_x" });
  });
});

before(async () => {
  testEnvironment = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { ...endereco("FIRESTORE_EMULATOR_HOST"), rules: regras("firestore.rules") },
  });
});

after(async () => {
  await testEnvironment?.cleanup();
});

function firestore(uid: string) {
  return testEnvironment.authenticatedContext(uid).firestore();
}

describe("client_notifications", () => {
  it("o cliente lê só os próprios avisos, pela consulta do próprio código", async () => {
    await assertSucceeds(getDoc(doc(firestore("client-itau"), "client_notifications", AVISO_ITAU)));
    await assertSucceeds(getDocs(query(collection(firestore("client-itau"), "client_notifications"), where("customer_code", "==", "ITAU"))));
    await assertFails(getDoc(doc(firestore("client-itau"), "client_notifications", AVISO_SAFRA)));
    await assertFails(getDocs(collection(firestore("client-itau"), "client_notifications")));
    await assertFails(getDoc(doc(testEnvironment.unauthenticatedContext().firestore(), "client_notifications", AVISO_ITAU)));
  });

  it("owner e admin leem; a equipe interna, não (o aviso da NF leva o valor)", async () => {
    for (const uid of ["owner-a", "admin-a"]) await assertSucceeds(getDocs(collection(firestore(uid), "client_notifications")));
    for (const uid of EQUIPE_SEM_LEITURA) await assertFails(getDoc(doc(firestore(uid), "client_notifications", AVISO_ITAU)));
  });

  it("ninguém grava pelo navegador, nem o cliente marca como lido", async () => {
    for (const uid of ["owner-a", "client-itau"]) {
      await assertFails(setDoc(doc(firestore(uid), "client_notifications", "ntf_novo"), { customer_code: "ITAU", titulo: "x" }));
      await assertFails(updateDoc(doc(firestore(uid), "client_notifications", AVISO_ITAU), { lida_por: [uid] }));
      await assertFails(deleteDoc(doc(firestore(uid), "client_notifications", AVISO_ITAU)));
    }
  });
});

describe("email_outbox e notification_cursors", () => {
  it("a fila de e-mail é só de owner e admin, e ninguém grava", async () => {
    for (const uid of ["owner-a", "admin-a"]) await assertSucceeds(getDoc(doc(firestore(uid), "email_outbox", EMAIL_ITAU)));
    for (const uid of [...EQUIPE_SEM_LEITURA, "client-itau"]) await assertFails(getDoc(doc(firestore(uid), "email_outbox", EMAIL_ITAU)));
    await assertFails(updateDoc(doc(firestore("owner-a"), "email_outbox", EMAIL_ITAU), { status: "sent" }));
  });

  it("o cursor da rotina não abre pelo navegador", async () => {
    for (const uid of ["owner-a", "admin-a", "client-itau"]) {
      await assertFails(getDoc(doc(firestore(uid), "notification_cursors", "avisos")));
      await assertFails(setDoc(doc(firestore(uid), "notification_cursors", "avisos"), { evento_id: "" }));
    }
  });
});
