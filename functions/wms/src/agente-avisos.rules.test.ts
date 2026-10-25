import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, beforeEach, describe, it } from "node:test";

import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";

/**
 * Os avisos do Agent Dute do WMS (`operational_notifications`): a equipe lê
 * todos; o cliente lê só o aviso para o cliente, aprovado ou enviado, do
 * próprio contrato. O aviso interno (exceção, divergência, atenção) leva a
 * nota interna e os e-mails de quem aprovou e enviou, e fica com a equipe
 * mesmo depois de aprovado.
 */

const PROJECT_ID = "demo-dute-operations";
const PAPEIS = {
  "owner-a": "owner",
  "ops-a": "interno",
  "wms-a": "wms",
  "support-a": "suporte",
  "client-a": "cliente",
  "client-b": "cliente",
} as const;

let testEnvironment: RulesTestEnvironment;

function emulatorAddress() {
  const address = process.env.FIRESTORE_EMULATOR_HOST;
  assert.ok(address, "Execute este teste pelo Firebase Emulator.");
  const [host, rawPort] = address.split(":");
  return { host, port: Number(rawPort) };
}

function rulesSource() {
  const currentDirectory = dirname(fileURLToPath(import.meta.url));
  return readFileSync(resolve(currentDirectory, "../../../firestore.rules"), "utf8");
}

function signedAs(uid: string) {
  return testEnvironment.authenticatedContext(uid, { email: `${uid}@example.com` }).firestore();
}

before(async () => {
  const { host, port } = emulatorAddress();
  testEnvironment = await initializeTestEnvironment({ projectId: PROJECT_ID, firestore: { host, port, rules: rulesSource() } });
});

beforeEach(async () => {
  await testEnvironment.clearFirestore();
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    const database = context.firestore();
    for (const [uid, role] of Object.entries(PAPEIS)) {
      const customer = uid === "client-a" ? "ITAU" : uid === "client-b" ? "SAFRA" : null;
      await setDoc(doc(database, "users", uid), { nome: uid, email: `${uid}@example.com`, role, ...(customer ? { customer_code: customer } : {}) });
    }
    await setDoc(doc(database, "client_access", "ITAU"), { customer_code: "ITAU", modules: ["wms"] });
    await setDoc(doc(database, "client_access", "SAFRA"), { customer_code: "SAFRA", modules: ["wms"] });
    await setDoc(doc(database, "operational_notifications", "aviso-cliente"), { customer_code: "ITAU", audience: "client", status: "sent", topic: "order", title: "Pedido separado" });
    await setDoc(doc(database, "operational_notifications", "aviso-interno"), { customer_code: "ITAU", audience: "internal", status: "sent", topic: "exception", title: "Atenção operacional", note: "revisar antes de comunicar", sent_by_email: "equipe@dutelog.com.br" });
    await setDoc(doc(database, "operational_notifications", "rascunho-cliente"), { customer_code: "ITAU", audience: "client", status: "draft", topic: "order", title: "Rascunho" });
  });
});

after(async () => {
  await testEnvironment.cleanup();
});

describe("os avisos do Agent Dute", () => {
  it("o cliente lê o aviso para ele, aprovado ou enviado, e não o interno nem o rascunho", async () => {
    const cliente = signedAs("client-a");
    await assertSucceeds(getDoc(doc(cliente, "operational_notifications", "aviso-cliente")));
    await assertFails(getDoc(doc(cliente, "operational_notifications", "aviso-interno")));
    await assertFails(getDoc(doc(cliente, "operational_notifications", "rascunho-cliente")));
  });

  it("o outro cliente não lê nenhum", async () => {
    const outro = signedAs("client-b");
    await assertFails(getDoc(doc(outro, "operational_notifications", "aviso-cliente")));
    await assertFails(getDoc(doc(outro, "operational_notifications", "aviso-interno")));
  });

  it("a equipe lê todos", async () => {
    for (const uid of ["owner-a", "ops-a", "wms-a", "support-a"]) {
      for (const id of ["aviso-cliente", "aviso-interno", "rascunho-cliente"]) {
        await assertSucceeds(getDoc(doc(signedAs(uid), "operational_notifications", id)));
      }
    }
  });
});
