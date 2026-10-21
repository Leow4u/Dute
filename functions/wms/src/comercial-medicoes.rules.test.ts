import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, beforeEach, describe, it } from "node:test";

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc } from "firebase/firestore";

/**
 * Medição mensal do Comercial (docs/plataforma/fase-6-comercial.md, parte
 * 16a): `medicoes` tem preço e é lida só por canReadPrices() (owner, admin,
 * comercial e, desde a parte 15, o financeiro). A operação, o suporte e o cliente não leem, e
 * ninguém grava pelo navegador: a escrita é das callables saveMedicao e
 * advanceMedicao.
 */

const PROJECT_ID = "demo-dute-operations";
const LEEM = ["owner-a", "admin-a", "comercial-a", "finance-a"] as const;
const NAO_LEEM = [
  "ops-a",
  "wms-a",
  "support-a",
  "campo-a",
  "rh-a",
  "painel-a",
  "client-a",
  "client-safra",
  "comercial-off",
] as const;
const MEDICAO = "safra-2026_2026-10";

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

async function seed() {
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    const database = context.firestore();
    const users: Array<[string, string, string | undefined, boolean?]> = [
      ["owner-a", "owner", undefined],
      ["admin-a", "admin", undefined],
      ["comercial-a", "comercial", undefined],
      ["comercial-off", "comercial", undefined, true],
      ["ops-a", "interno", undefined],
      ["wms-a", "wms", undefined],
      ["support-a", "suporte", undefined],
      ["finance-a", "financeiro", undefined],
      ["campo-a", "campo", undefined],
      ["rh-a", "rh", undefined],
      ["painel-a", "painel", undefined],
      ["client-a", "cliente", "ITAU"],
      // O cliente da própria medição também não lê: o portal não mostra a medição no v1.
      ["client-safra", "cliente", "SAFRA"],
    ];
    for (const [uid, role, customerCode, disabled] of users) {
      await setDoc(doc(database, "users", uid), {
        nome: uid,
        email: `${uid}@example.com`,
        role,
        ...(customerCode ? { customer_code: customerCode } : {}),
        ...(disabled ? { access_disabled: true } : {}),
      });
    }
    await setDoc(doc(database, "medicoes", MEDICAO), {
      id: MEDICAO,
      customer_code: "SAFRA",
      contrato_id: "safra-2026",
      competencia: "2026-10",
      status: "rascunho",
      edicao: 2,
      linhas: [{ id: "ml_1", os: "OS 77", itens: [{ preco: "280.00", quantidade: "2", total_cents: 56000 }], total_cents: 56000 }],
      total_cents: 56000,
    });
  });
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

describe("medição mensal: leitura", () => {
  for (const uid of LEEM) {
    it(`${uid} lê a medição, pelo id e em lista`, async () => {
      const database = signedAs(uid);
      await assertSucceeds(getDoc(doc(database, "medicoes", MEDICAO)));
      await assertSucceeds(getDocs(collection(database, "medicoes")));
    });
  }

  for (const uid of NAO_LEEM) {
    it(`${uid} não lê a medição`, async () => {
      const database = signedAs(uid);
      await assertFails(getDoc(doc(database, "medicoes", MEDICAO)));
      await assertFails(getDocs(collection(database, "medicoes")));
    });
  }

  it("sem login, nada", async () => {
    const database = testEnvironment.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(database, "medicoes", MEDICAO)));
  });
});

describe("medição mensal: escrita", () => {
  for (const uid of [...LEEM, "client-safra"]) {
    it(`${uid} não grava pelo navegador`, async () => {
      const database = signedAs(uid);
      await assertFails(setDoc(doc(database, "medicoes", "safra-2026_2026-11"), { id: "safra-2026_2026-11", status: "rascunho" }));
      await assertFails(updateDoc(doc(database, "medicoes", MEDICAO), { status: "aprovada" }));
      await assertFails(deleteDoc(doc(database, "medicoes", MEDICAO)));
    });
  }
});

describe("medição mensal: o bloco das regras", () => {
  it("medicoes lê por canReadPrices() e não aceita escrita", () => {
    const block = rulesSource().match(/match \/medicoes\/\{[^}]+\} \{([^}]*)\}/);
    assert.ok(block, "match /medicoes não encontrado");
    assert.match(block[1], /allow read: if canReadPrices\(\);/);
    assert.match(block[1], /allow create, update, delete: if false;/);
    assert.doesNotMatch(block[1], /canReadBilling|canReadOperations|canReadDemands|isFinance|isCustomer/);
  });
});
