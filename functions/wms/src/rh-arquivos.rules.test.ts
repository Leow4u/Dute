import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { assertFails, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, setDoc } from "firebase/firestore";

/**
 * Os arquivos do RH no Storage (docs/plataforma/fase-8-rh.md, parte 8.2b):
 * `rh/**` fica fechado ao navegador para todo papel, inclusive o rh, o owner
 * e o admin. O arquivo sobe e abre só por URL assinada das callables do RH,
 * que conferem o papel e registram cada abertura.
 */

const PROJECT_ID = "demo-dute-operations";
const PAPEIS = ["owner", "admin", "rh", "interno", "wms", "campo", "comercial", "financeiro", "suporte", "painel", "cliente"] as const;
const CAMINHO = "rh/col_aaaaaaaaaaaaaaaa/reg_aaaaaaaaaaaaaaaa/arq_0123456789abcdef.pdf";
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

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

before(async () => {
  testEnvironment = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { ...endereco("FIRESTORE_EMULATOR_HOST"), rules: regras("firestore.rules") },
    storage: { ...endereco("FIREBASE_STORAGE_EMULATOR_HOST"), rules: regras("storage.rules") },
  });
});

beforeEach(async () => {
  await testEnvironment.clearFirestore();
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    for (const role of PAPEIS) await setDoc(doc(context.firestore(), "users", `${role}-a`), { role, nome: role, customer_code: role === "cliente" ? "ITAU" : null });
    await context.storage().ref(CAMINHO).put(PDF, { contentType: "application/pdf" }).then((snapshot) => snapshot);
  });
});

after(async () => {
  await testEnvironment?.cleanup();
});

describe("os arquivos do RH no Storage", () => {
  it("nenhum papel lê, sobe, troca nem apaga, nem o rh, o owner e o admin", async () => {
    for (const role of PAPEIS) {
      const storage = testEnvironment.authenticatedContext(`${role}-a`).storage();
      await assertFails(storage.ref(CAMINHO).getMetadata());
      await assertFails(storage.ref(CAMINHO).getDownloadURL());
      await assertFails(storage.ref(CAMINHO).put(PDF, { contentType: "application/pdf" }).then((snapshot) => snapshot));
      await assertFails(storage.ref(CAMINHO.replace("arq_0123456789abcdef", "arq_fedcba9876543210")).put(PDF, { contentType: "application/pdf" }).then((snapshot) => snapshot));
      await assertFails(storage.ref(CAMINHO).delete());
      await assertFails(storage.ref("rh").listAll());
    }
  });

  it("quem não entrou também não", async () => {
    const storage = testEnvironment.unauthenticatedContext().storage();
    await assertFails(storage.ref(CAMINHO).getMetadata());
    await assertFails(storage.ref(CAMINHO).put(PDF, { contentType: "application/pdf" }).then((snapshot) => snapshot));
  });
});
