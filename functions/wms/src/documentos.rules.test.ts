import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, beforeEach, describe, it } from "node:test";

import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";

/**
 * O documento e o vínculo (`documents` e `document_links`) se gravam só pelas
 * Functions (mutateManagedEntity), que decidem a publicação no portal. Pelo
 * navegador, o wms e o financeiro gravavam um documento já publicado para
 * qualquer cliente, e a callable seguinte o projetava no portal dele.
 * Nenhuma tela grava essas coleções pelo navegador. A leitura não muda.
 */

const PROJECT_ID = "demo-dute-operations";
const PAPEIS = {
  "owner-a": "owner",
  "admin-a": "admin",
  "ops-a": "interno",
  "wms-a": "wms",
  "finance-a": "financeiro",
  "support-a": "suporte",
  "client-a": "cliente",
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

const PUBLICADO = { customer_code: "ITAU", title: "NF", file_name: "nf.pdf", entity_type: "fatura", customer_visible: true, visibility: "customer" };

before(async () => {
  const { host, port } = emulatorAddress();
  testEnvironment = await initializeTestEnvironment({ projectId: PROJECT_ID, firestore: { host, port, rules: rulesSource() } });
});

beforeEach(async () => {
  await testEnvironment.clearFirestore();
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    const database = context.firestore();
    for (const [uid, role] of Object.entries(PAPEIS)) {
      await setDoc(doc(database, "users", uid), { nome: uid, email: `${uid}@example.com`, role, ...(role === "cliente" ? { customer_code: "ITAU" } : {}) });
    }
    await setDoc(doc(database, "client_access", "ITAU"), { customer_code: "ITAU", modules: ["wms", "financeiro"] });
    await setDoc(doc(database, "documents", "doc-1"), { customer_code: "ITAU", title: "Contrato", file_name: "contrato.pdf", entity_type: "fatura", customer_visible: false });
    await setDoc(doc(database, "document_links", "link-1"), { document_id: "doc-1", entity_type: "fatura", entity_id: "2026-09" });
  });
});

after(async () => {
  await testEnvironment.cleanup();
});

describe("documentos e vínculos só pelas Functions", () => {
  it("nenhum papel cria ou altera um documento pelo navegador, nem publicado no portal", async () => {
    for (const uid of Object.keys(PAPEIS)) {
      const database = signedAs(uid);
      await assertFails(setDoc(doc(database, "documents", `novo-${uid}`), PUBLICADO));
      await assertFails(updateDoc(doc(database, "documents", "doc-1"), { customer_visible: true }));
      await assertFails(updateDoc(doc(database, "documents", "doc-1"), { title: "Contrato assinado" }));
    }
  });

  it("nenhum papel cria ou altera um vínculo pelo navegador", async () => {
    for (const uid of Object.keys(PAPEIS)) {
      const database = signedAs(uid);
      await assertFails(setDoc(doc(database, "document_links", `novo-${uid}`), { document_id: "doc-1", entity_type: "fatura", entity_id: "2026-10" }));
      await assertFails(updateDoc(doc(database, "document_links", "link-1"), { entity_id: "2026-10" }));
    }
  });

  it("a leitura continua como era: a operação lê, o financeiro lê o de faturamento", async () => {
    for (const uid of ["owner-a", "admin-a", "ops-a", "wms-a", "support-a", "finance-a"]) {
      await assertSucceeds(getDoc(doc(signedAs(uid), "documents", "doc-1")));
      await assertSucceeds(getDoc(doc(signedAs(uid), "document_links", "link-1")));
    }
    await assertFails(getDoc(doc(signedAs("client-a"), "documents", "doc-1")));
  });
});
