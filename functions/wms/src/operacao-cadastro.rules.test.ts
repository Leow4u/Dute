import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from "firebase/firestore";

/**
 * Regras do cadastro da Operação (docs/plataforma/fase-3-operacao.md, parte 1):
 * owner, admin e interno leem collaborators e vehicles. O CPF fica nesses
 * documentos, então campo, suporte, comercial e cliente não leem. Ninguém
 * grava pelo navegador.
 */

const PROJECT_ID = "demo-dute-operations";

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

const PAPEIS = {
  "owner-a": "owner",
  "admin-a": "admin",
  "ops-a": "interno",
  "wms-a": "wms",
  "support-a": "suporte",
  "finance-a": "financeiro",
  "campo-a": "campo",
  "comercial-a": "comercial",
  "rh-a": "rh",
  "painel-a": "painel",
  "client-a": "cliente",
} as const;

const LEEM = ["owner-a", "admin-a", "ops-a"] as const;
const NAO_LEEM = ["wms-a", "support-a", "finance-a", "campo-a", "comercial-a", "rh-a", "painel-a", "client-a"] as const;

async function seed() {
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    const database = context.firestore();
    for (const [uid, role] of Object.entries(PAPEIS)) {
      await setDoc(doc(database, "users", uid), {
        nome: uid,
        email: `${uid}@example.com`,
        role,
        ...(role === "cliente" ? { customer_code: "BTG Pactual" } : {}),
      });
    }
    await setDoc(doc(database, "users", "ops-off"), {
      nome: "ops-off",
      email: "ops-off@example.com",
      role: "interno",
      access_disabled: true,
    });
    await setDoc(doc(database, "collaborators", "col_aaaaaaaaaaaaaaaa"), {
      id: "col_aaaaaaaaaaaaaaaa",
      nome: "Ana Souza",
      cpf: "52998224725",
      funcao: "Motorista",
      telefone: "11987654321",
      cnh: { categoria: "C", validade: "2028-04-01" },
      ativo: true,
      edicao: 1,
    });
    await setDoc(doc(database, "vehicles", "vei_aaaaaaaaaaaaaaaa"), {
      id: "vei_aaaaaaaaaaaaaaaa",
      placa: "ABC1D23",
      tipo: "VUC",
      capacidade_kg: 3500,
      capacidade_m3: 12.5,
      ativo: true,
      edicao: 1,
    });
  });
}

function signedAs(uid: string) {
  return testEnvironment.authenticatedContext(uid, { email: `${uid}@example.com` }).firestore();
}

before(async () => {
  const { host, port } = emulatorAddress();
  testEnvironment = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { host, port, rules: rulesSource() },
  });
});

beforeEach(async () => {
  await testEnvironment.clearFirestore();
  await seed();
});

after(async () => {
  await testEnvironment.cleanup();
});

describe("cadastro da Operação: leitura", () => {
  it("owner, admin e interno leem colaborador e veículo", async () => {
    for (const uid of LEEM) {
      const database = signedAs(uid);
      const colaborador = await assertSucceeds(getDoc(doc(database, "collaborators", "col_aaaaaaaaaaaaaaaa")));
      assert.equal(colaborador.data()?.cpf, "52998224725", uid);
      await assertSucceeds(getDoc(doc(database, "vehicles", "vei_aaaaaaaaaaaaaaaa")));
    }
  });

  it("wms, suporte, campo, comercial, financeiro, rh, painel e cliente não leem", async () => {
    for (const uid of NAO_LEEM) {
      const database = signedAs(uid);
      await assertFails(getDoc(doc(database, "collaborators", "col_aaaaaaaaaaaaaaaa")));
      await assertFails(getDoc(doc(database, "vehicles", "vei_aaaaaaaaaaaaaaaa")));
    }
  });

  it("interno com acesso removido não lê", async () => {
    const database = signedAs("ops-off");
    await assertFails(getDoc(doc(database, "collaborators", "col_aaaaaaaaaaaaaaaa")));
  });
});

describe("cadastro da Operação: escrita", () => {
  it("nem o owner grava, altera ou apaga pelo navegador", async () => {
    const database = signedAs("owner-a");
    await assertFails(setDoc(doc(database, "collaborators", "col_bbbbbbbbbbbbbbbb"), { nome: "Outra" }));
    await assertFails(updateDoc(doc(database, "collaborators", "col_aaaaaaaaaaaaaaaa"), { funcao: "Ajudante" }));
    await assertFails(deleteDoc(doc(database, "vehicles", "vei_aaaaaaaaaaaaaaaa")));
    await assertFails(setDoc(doc(database, "operacao_operations", "op1"), { ok: true }));
  });
});
