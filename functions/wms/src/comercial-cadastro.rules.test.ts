import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from "firebase/firestore";

/**
 * Regras do cadastro comercial (docs/plataforma/fase-6-comercial.md, parte 6):
 * o comercial lê `customers`; `customer_locations` e `customer_contacts`
 * só owner, admin e comercial; ninguém grava pelo navegador. Os contatos têm
 * nome, e-mail e telefone: a operação, o suporte, o financeiro e o cliente
 * não leem.
 */

const PROJECT_ID = "demo-dute-operations";
const CUSTOMER = "BTG Pactual";

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
  "owner-a": ["owner", undefined],
  "admin-a": ["admin", undefined],
  "comercial-a": ["comercial", undefined],
  "ops-a": ["interno", undefined],
  "wms-a": ["wms", undefined],
  "support-a": ["suporte", undefined],
  "finance-a": ["financeiro", undefined],
  "campo-a": ["campo", undefined],
  "rh-a": ["rh", undefined],
  "painel-a": ["painel", undefined],
  "client-a": ["cliente", CUSTOMER],
} as const;

const LEEM_CADASTRO_COMERCIAL = ["owner-a", "admin-a", "comercial-a"] as const;
const NAO_LEEM_CADASTRO_COMERCIAL = ["ops-a", "wms-a", "support-a", "finance-a", "campo-a", "rh-a", "painel-a", "client-a"] as const;

async function seed() {
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    const database = context.firestore();
    for (const [uid, [role, customerCode]] of Object.entries(PAPEIS)) {
      await setDoc(doc(database, "users", uid), {
        nome: uid,
        email: `${uid}@example.com`,
        role,
        ...(customerCode ? { customer_code: customerCode } : {}),
      });
    }
    await setDoc(doc(database, "users", "comercial-off"), {
      nome: "comercial-off",
      email: "comercial-off@example.com",
      role: "comercial",
      access_disabled: true,
    });
    await setDoc(doc(database, "customers", "BTG_Pactual"), {
      code: CUSTOMER,
      customer_code: CUSTOMER,
      name: "BTG Pactual",
      sku_prefix: "BTG",
      status: "active",
    });
    await setDoc(doc(database, "customers", "CONSTRUTORA-OMEGA"), {
      code: "CONSTRUTORA-OMEGA",
      customer_code: "CONSTRUTORA-OMEGA",
      name: "Construtora Ômega",
      stage: "prospect",
      status: "active",
      portal_status: "inactive",
    });
    await setDoc(doc(database, "customer_locations", "loc_a"), {
      id: "loc_a",
      customer_code: CUSTOMER,
      nome: "Sede",
      sigla: "SEDE",
      endereco: { cidade: "São Paulo", uf: "SP" },
      ativo: true,
    });
    await setDoc(doc(database, "customer_contacts", "ct_a"), {
      id: "ct_a",
      customer_code: CUSTOMER,
      nome: "Fulano de Tal",
      email: "fulano@gerenciadora.com.br",
      telefone: "11987654321",
      empresa: "Gerenciadora X",
      papel: "gerenciadora",
      ativo: true,
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

describe("cadastro comercial: leitura", () => {
  it("o comercial lê o cadastro de clientes, inclusive o prospect, e lista a coleção", async () => {
    const database = signedAs("comercial-a");
    await assertSucceeds(getDoc(doc(database, "customers", "BTG_Pactual")));
    await assertSucceeds(getDoc(doc(database, "customers", "CONSTRUTORA-OMEGA")));
    const lista = await assertSucceeds(getDocs(collection(database, "customers")));
    assert.equal(lista.size, 2);
  });

  it("owner, admin e comercial leem locais e contatos, também em consulta por cliente", async () => {
    for (const uid of LEEM_CADASTRO_COMERCIAL) {
      const database = signedAs(uid);
      await assertSucceeds(getDoc(doc(database, "customer_locations", "loc_a")));
      await assertSucceeds(getDoc(doc(database, "customer_contacts", "ct_a")));
      const contatos = await assertSucceeds(
        getDocs(query(collection(database, "customer_contacts"), where("customer_code", "==", CUSTOMER))),
      );
      assert.equal(contatos.size, 1, uid);
      await assertSucceeds(getDocs(query(collection(database, "customer_locations"), where("customer_code", "==", CUSTOMER))));
    }
  });

  it("interno, wms, suporte, financeiro, campo, rh, painel e cliente não leem os contatos", async () => {
    for (const uid of NAO_LEEM_CADASTRO_COMERCIAL) {
      const database = signedAs(uid);
      await assertFails(getDoc(doc(database, "customer_contacts", "ct_a")));
      await assertFails(getDocs(query(collection(database, "customer_contacts"), where("customer_code", "==", CUSTOMER))));
    }
  });

  it("o cliente não lê os locais, nem os do próprio contrato; a operação também não, até a Fase 3", async () => {
    for (const uid of NAO_LEEM_CADASTRO_COMERCIAL) {
      const database = signedAs(uid);
      await assertFails(getDoc(doc(database, "customer_locations", "loc_a")));
      await assertFails(getDocs(query(collection(database, "customer_locations"), where("customer_code", "==", CUSTOMER))));
    }
  });

  it("financeiro, campo e cliente continuam sem ler o cadastro de clientes; a operação lê como antes", async () => {
    for (const uid of ["finance-a", "campo-a", "rh-a", "painel-a", "client-a"]) {
      await assertFails(getDoc(doc(signedAs(uid), "customers", "CONSTRUTORA-OMEGA")));
    }
    for (const uid of ["ops-a", "wms-a", "support-a"]) {
      await assertSucceeds(getDoc(doc(signedAs(uid), "customers", "BTG_Pactual")));
    }
  });

  it("comercial com o acesso removido não lê nada do cadastro", async () => {
    const database = signedAs("comercial-off");
    await assertFails(getDoc(doc(database, "customers", "BTG_Pactual")));
    await assertFails(getDoc(doc(database, "customer_locations", "loc_a")));
    await assertFails(getDoc(doc(database, "customer_contacts", "ct_a")));
  });
});

describe("cadastro comercial: escrita só pelas Functions", () => {
  it("ninguém grava cadastro, local ou contato pelo navegador, nem o owner", async () => {
    for (const uid of [...LEEM_CADASTRO_COMERCIAL, "client-a"]) {
      const database = signedAs(uid);
      await assertFails(setDoc(doc(database, "customers", "NOVO"), { code: "NOVO", name: "Novo", stage: "prospect" }));
      await assertFails(updateDoc(doc(database, "customers", "CONSTRUTORA-OMEGA"), { stage: "cliente" }));
      await assertFails(deleteDoc(doc(database, "customers", "CONSTRUTORA-OMEGA")));
      await assertFails(setDoc(doc(database, "customer_locations", "loc_novo"), { customer_code: CUSTOMER, nome: "Outro" }));
      await assertFails(updateDoc(doc(database, "customer_locations", "loc_a"), { ativo: false }));
      await assertFails(deleteDoc(doc(database, "customer_locations", "loc_a")));
      await assertFails(setDoc(doc(database, "customer_contacts", "ct_novo"), { customer_code: CUSTOMER, nome: "Outro" }));
      await assertFails(updateDoc(doc(database, "customer_contacts", "ct_a"), { email: "outro@example.com" }));
      await assertFails(deleteDoc(doc(database, "customer_contacts", "ct_a")));
    }
  });

  it("o recibo de idempotência do Comercial continua fechado", async () => {
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "comercial_operations", "op_a"), { kind: "customer_contact_save" });
    });
    for (const uid of LEEM_CADASTRO_COMERCIAL) {
      await assertFails(getDoc(doc(signedAs(uid), "comercial_operations", "op_a")));
    }
  });
});
