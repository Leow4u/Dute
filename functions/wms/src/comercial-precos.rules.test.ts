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
 * Catálogo, tabelas de preço e autorizações de faturamento do Comercial
 * (docs/plataforma/fase-6-comercial.md, "Leitura"): `lpu_items`,
 * `price_tables` e `client_authorizations` só para canReadPrices() (owner,
 * admin, comercial e, desde a parte 15, o financeiro: preço é de owner,
 * admin, financeiro e comercial). A operação, o suporte e o cliente não leem
 * preço, e ninguém grava pelo navegador: a escrita é da carga
 * (functions/comercial/src/cargas/tabela.ts) e da callable recordAuthorization,
 * com o Admin SDK.
 */

const PROJECT_ID = "demo-dute-operations";
const COLECOES = ["lpu_items", "price_tables", "client_authorizations"] as const;
const LEEM = ["owner-a", "admin-a", "comercial-a", "finance-a"] as const;
const NAO_LEEM = [
  "ops-a",
  "wms-a",
  "support-a",
  "campo-a",
  "rh-a",
  "painel-a",
  "client-a",
  "comercial-off",
] as const;

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
      ["comercial-a", "comercial", "Dutelog"],
      ["comercial-off", "comercial", "Dutelog", true],
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
    await setDoc(doc(database, "lpu_items", "lpu_mesa"), {
      id: "lpu_mesa",
      categoria: "Mobiliário",
      item: "Mesa de escritório",
      servico: "Transporte",
      unidade: "UN",
      descricao: "Transporte de mesa",
      orcavel: true,
      ativo: true,
    });
    await setDoc(doc(database, "price_tables", "pt_itau"), {
      id: "pt_itau",
      nome: "LPU de teste",
      customer_code: "ITAU",
      contract_id: "itau-2026",
      variante: "Comercial",
      vigente_de: "2026-06-30",
      vigente_ate: null,
      status: "ativa",
      moeda: "BRL",
      precos: { lpu_mesa: { codigo: "DTL-0001-T", descricao_cliente: "Transporte de mesa", preco: "45.50" } },
    });
    await setDoc(doc(database, "client_authorizations", "aut_teste"), {
      id: "aut_teste",
      customer_code: "ITAU",
      contrato_id: "itau-2026",
      tipo: "pedido_aceite",
      pedido: "4500000001",
      aceite: "1000000001",
      valor_cents: 9100,
      demandas: [{ numero: "10045", rv: 1, rotulo: "10045 – RV01", valor_cents: 9100 }],
      status: "registrada",
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

const ALVO: Record<(typeof COLECOES)[number], string> = { lpu_items: "lpu_mesa", price_tables: "pt_itau", client_authorizations: "aut_teste" };

describe("preços do Comercial: leitura", () => {
  for (const uid of LEEM) {
    it(`${uid} lê o catálogo, as tabelas e as autorizações, pelo id e em lista`, async () => {
      const database = signedAs(uid);
      for (const name of COLECOES) {
        await assertSucceeds(getDoc(doc(database, name, ALVO[name])));
        await assertSucceeds(getDocs(collection(database, name)));
      }
    });
  }

  for (const uid of NAO_LEEM) {
    it(`${uid} não lê o catálogo, as tabelas nem as autorizações`, async () => {
      const database = signedAs(uid);
      for (const name of COLECOES) {
        await assertFails(getDoc(doc(database, name, ALVO[name])));
        await assertFails(getDocs(collection(database, name)));
      }
    });
  }

  it("sem login, nada", async () => {
    const database = testEnvironment.unauthenticatedContext().firestore();
    for (const name of COLECOES) await assertFails(getDoc(doc(database, name, ALVO[name])));
  });
});

describe("preços do Comercial: escrita", () => {
  for (const uid of [...LEEM, "client-a", "ops-a"]) {
    it(`${uid} não grava pelo navegador`, async () => {
      const database = signedAs(uid);
      for (const name of COLECOES) {
        await assertFails(setDoc(doc(database, name, "novo"), { id: "novo", status: "ativa" }));
        await assertFails(updateDoc(doc(database, name, ALVO[name]), { ativo: false, status: "encerrada" }));
        await assertFails(deleteDoc(doc(database, name, ALVO[name])));
      }
    });
  }
});

describe("preços do Comercial: as funções das regras", () => {
  const rules = rulesSource();

  function roles(name: string): string[] {
    const match = rules.match(new RegExp(`function ${name}\\(\\) \\{\\s*return hasAnyRole\\(\\[([^\\]]*)\\]\\);`));
    assert.ok(match, `${name}() não encontrada no firestore.rules`);
    return [...match[1].matchAll(/'([^']+)'/g)].map((item) => item[1]);
  }

  it("canReadPrices() é owner, admin, comercial e financeiro (preço: CLAUDE.md; o financeiro desde a parte 15)", () => {
    assert.deepEqual(roles("canReadPrices"), ["owner", "admin", "comercial", "financeiro"]);
  });

  it("canReadBilling() não muda com o Comercial", () => {
    assert.deepEqual(roles("canReadBilling"), ["owner", "admin", "financeiro", "suporte"]);
  });

  it("lpu_items, price_tables e client_authorizations leem por canReadPrices() e não aceitam escrita", () => {
    for (const name of COLECOES) {
      const block = rules.match(new RegExp(`match /${name}/\\{[^}]+\\} \\{([^}]*)\\}`));
      assert.ok(block, `match /${name} não encontrado`);
      assert.match(block[1], /allow read: if canReadPrices\(\);/);
      assert.match(block[1], /allow create, update, delete: if false;/);
      assert.doesNotMatch(block[1], /canReadBilling|canReadOperations|isFinance/);
    }
  });
});
