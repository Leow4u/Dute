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
 * Demanda e orçamento do Comercial (docs/plataforma/fase-6-comercial.md,
 * "Coleções"; parte 9): `demands` não tem preço e é lida por owner, admin e
 * comercial (a operação entra na Fase 3); `quotes` e `quotes/{n}/revisoes`
 * têm preço e são lidas por canReadPrices(). Ninguém grava pelo navegador, e
 * o contador `demand_counters` não tem match: ninguém lê.
 */

const PROJECT_ID = "demo-dute-operations";
const LEEM = ["owner-a", "admin-a", "comercial-a"] as const;
const NAO_LEEM = [
  "ops-a",
  "wms-a",
  "support-a",
  "finance-a",
  "campo-a",
  "rh-a",
  "painel-a",
  "client-a",
  "comercial-off",
] as const;

/** Coleção → documento semeado. */
const ALVOS: Record<string, string> = {
  demands: "demands/10045",
  quotes: "quotes/10045",
  revisoes: "quotes/10045/revisoes/0",
};
const LISTAS: Record<string, string> = {
  demands: "demands",
  quotes: "quotes",
  revisoes: "quotes/10045/revisoes",
};

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
    await setDoc(doc(database, "demands", "10045"), {
      numero: "10045",
      customer_code: "ITAU",
      customer_name: "Itaú Unibanco",
      titulo: "Mudança de layout",
      etapa: "para_aprovar",
    });
    const quote = {
      numero: "10045",
      customer_code: "ITAU",
      rv: 0,
      status: "aprovado",
      edicao: 2,
      linhas: [{ id: "ln_1", preco: "45.50", quantidade: "2", total_cents: 9100 }],
      total_cents: 9100,
    };
    await setDoc(doc(database, "quotes", "10045"), quote);
    await setDoc(doc(database, "quotes", "10045", "revisoes", "0"), quote);
    await setDoc(doc(database, "demand_counters", "geral"), { ultimo: 10045 });
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

describe("demanda e orçamento: leitura", () => {
  for (const uid of LEEM) {
    it(`${uid} lê a demanda, o orçamento e a RV congelada, pelo id e em lista`, async () => {
      const database = signedAs(uid);
      for (const name of Object.keys(ALVOS)) {
        await assertSucceeds(getDoc(doc(database, ALVOS[name])));
        await assertSucceeds(getDocs(collection(database, LISTAS[name])));
      }
    });
  }

  for (const uid of NAO_LEEM) {
    it(`${uid} não lê demanda, orçamento nem RV congelada`, async () => {
      const database = signedAs(uid);
      for (const name of Object.keys(ALVOS)) {
        await assertFails(getDoc(doc(database, ALVOS[name])));
        await assertFails(getDocs(collection(database, LISTAS[name])));
      }
    });
  }

  it("ninguém lê o contador, nem o owner", async () => {
    for (const uid of [...LEEM, ...NAO_LEEM]) {
      await assertFails(getDoc(doc(signedAs(uid), "demand_counters", "geral")));
    }
  });

  it("sem login, nada", async () => {
    const database = testEnvironment.unauthenticatedContext().firestore();
    for (const name of Object.keys(ALVOS)) await assertFails(getDoc(doc(database, ALVOS[name])));
  });
});

describe("demanda e orçamento: escrita", () => {
  for (const uid of [...LEEM, "finance-a", "client-a", "ops-a"]) {
    it(`${uid} não grava pelo navegador`, async () => {
      const database = signedAs(uid);
      for (const name of Object.keys(ALVOS)) {
        const path = ALVOS[name];
        await assertFails(setDoc(doc(database, `${LISTAS[name]}/novo`), { numero: "10046" }));
        await assertFails(updateDoc(doc(database, path), { status: "aprovado", etapa: "para_enviar" }));
        await assertFails(deleteDoc(doc(database, path)));
      }
      await assertFails(setDoc(doc(database, "demand_counters", "geral"), { ultimo: 1 }));
    });
  }
});

describe("demanda e orçamento: as regras escritas", () => {
  const rules = rulesSource();

  function roles(name: string): string[] {
    const match = rules.match(new RegExp(`function ${name}\\(\\) \\{\\s*return hasAnyRole\\(\\[([^\\]]*)\\]\\);`));
    assert.ok(match, `${name}() não encontrada no firestore.rules`);
    return [...match[1].matchAll(/'([^']+)'/g)].map((item) => item[1]);
  }

  it("canReadDemands() é owner, admin e comercial (a operação entra na Fase 3)", () => {
    assert.deepEqual(roles("canReadDemands"), ["owner", "admin", "comercial"]);
  });

  it("demands lê por canReadDemands(); quotes e revisoes, por canReadPrices(); nada aceita escrita", () => {
    const demands = rules.match(/match \/demands\/\{[^}]+\} \{([^}]*)\}/);
    assert.ok(demands, "match /demands não encontrado");
    assert.match(demands[1], /allow read: if canReadDemands\(\);/);
    assert.match(demands[1], /allow create, update, delete: if false;/);

    const quotes = rules.match(/match \/quotes\/\{[^}]+\} \{([\s\S]*?)\n    \}/);
    assert.ok(quotes, "match /quotes não encontrado");
    assert.match(quotes[1], /^\s*allow read: if canReadPrices\(\);/m);
    const revisoes = quotes[1].match(/match \/revisoes\/\{[^}]+\} \{([^}]*)\}/);
    assert.ok(revisoes, "match /revisoes dentro de /quotes não encontrado");
    assert.match(revisoes[1], /allow read: if canReadPrices\(\);/);
    assert.match(revisoes[1], /allow create, update, delete: if false;/);
    for (const block of [demands[1], quotes[1]]) assert.doesNotMatch(block, /canReadBilling|canReadOperations|isFinance/);
  });

  it("demand_counters não tem match", () => {
    assert.doesNotMatch(rules, /match \/demand_counters/);
  });
});
