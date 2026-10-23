import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, beforeEach, describe, it } from "node:test";

import { assertFails, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc } from "firebase/firestore";

/**
 * O banco `rh` (docs/plataforma/fase-8-rh.md, parte 8.1a): fechado ao
 * navegador para todo papel, inclusive o rh, o owner e o admin. As regras de
 * um banco nomeado não leem o `users` do banco padrão; quem lê e grava é a
 * codebase functions/rh, pelas callables. As regras de firestore-rh.rules
 * valem para o banco em que forem publicadas; aqui, no banco do emulador.
 */

const PROJECT_ID = "demo-dute-operations";
const PAPEIS = ["owner", "admin", "rh", "interno", "wms", "campo", "comercial", "financeiro", "suporte", "painel", "cliente"] as const;
const COLECOES = ["fichas", "exames", "treinamentos", "documentos", "alertas", "events", "rh_operations"] as const;

let testEnvironment: RulesTestEnvironment;

function emulatorAddress() {
  const address = process.env.FIRESTORE_EMULATOR_HOST;
  assert.ok(address, "Execute este teste pelo Firebase Emulator.");
  const [host, rawPort] = address.split(":");
  return { host, port: Number(rawPort) };
}

function rulesSource() {
  const currentDirectory = dirname(fileURLToPath(import.meta.url));
  return readFileSync(resolve(currentDirectory, "../../../firestore-rh.rules"), "utf8");
}

before(async () => {
  const { host, port } = emulatorAddress();
  testEnvironment = await initializeTestEnvironment({ projectId: PROJECT_ID, firestore: { host, port, rules: rulesSource() } });
});

beforeEach(async () => {
  await testEnvironment.clearFirestore();
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    const database = context.firestore();
    // O papel no `users` não abre nada: as regras do banco `rh` nem o leem.
    for (const role of PAPEIS) await setDoc(doc(database, "users", `${role}-a`), { role, nome: role });
    for (const colecao of COLECOES) await setDoc(doc(database, colecao, "item-1"), { colaborador_id: "col-1" });
  });
});

after(async () => {
  await testEnvironment.cleanup();
});

describe("o banco rh no navegador", () => {
  it("nenhum papel lê, lista, cria, muda nem apaga, nem o rh, o owner e o admin", async () => {
    for (const role of PAPEIS) {
      const database = testEnvironment.authenticatedContext(`${role}-a`, { email: `${role}@example.com` }).firestore();
      for (const colecao of COLECOES) {
        await assertFails(getDoc(doc(database, colecao, "item-1")));
        await assertFails(getDocs(collection(database, colecao)));
        await assertFails(setDoc(doc(database, colecao, "item-2"), { colaborador_id: "col-1" }));
        await assertFails(updateDoc(doc(database, colecao, "item-1"), { colaborador_id: "col-2" }));
        await assertFails(deleteDoc(doc(database, colecao, "item-1")));
      }
    }
  });

  it("quem não entrou também não", async () => {
    const database = testEnvironment.unauthenticatedContext().firestore();
    for (const colecao of COLECOES) {
      await assertFails(getDoc(doc(database, colecao, "item-1")));
      await assertFails(setDoc(doc(database, colecao, "item-2"), {}));
    }
  });
});
