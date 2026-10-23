import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, beforeEach, describe, it } from "node:test";

import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from "firebase/firestore";

/**
 * A fatura da demanda (docs/plataforma/fase-4-financeiro.md, parte 4.1a):
 * `faturas` tem o valor de cada demanda, então só quem lê preço lê (owner,
 * admin, financeiro e comercial). A operação, o campo, o suporte, o painel e
 * o cliente não leem, e ninguém grava pelo navegador: só as callables
 * registerNf e advanceFatura. Os `pagamentos` (parte 4.2a) seguem a mesma
 * regra. O financeiro lê os eventos nf.* e cobranca.* (sem valor), como lê os
 * billing.* do WMS.
 */

const PROJECT_ID = "demo-dute-operations";
const PAPEIS = {
  "owner-a": "owner",
  "admin-a": "admin",
  "finance-a": "financeiro",
  "comercial-a": "comercial",
  "ops-a": "interno",
  "wms-a": "wms",
  "campo-a": "campo",
  "support-a": "suporte",
  "rh-a": "rh",
  "painel-a": "painel",
  "client-a": "cliente",
} as const;
const LEEM = ["owner-a", "admin-a", "finance-a", "comercial-a"] as const;
const NAO_LEEM = ["ops-a", "wms-a", "campo-a", "support-a", "rh-a", "painel-a", "client-a"] as const;

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
      await setDoc(doc(database, "users", uid), { nome: uid, email: `${uid}@example.com`, role, ...(role === "cliente" ? { customer_code: "ITAU" } : {}) });
    }
    await setDoc(doc(database, "client_access", "ITAU"), { customer_code: "ITAU", modules: ["wms", "operacao", "financeiro"] });
    await setDoc(doc(database, "faturas", "fat_000000000000000000000001"), { id: "fat_000000000000000000000001", customer_code: "ITAU", status: "emitida", valor_cents: 1_484_500, demanda_numeros: ["10045"] });
    await setDoc(doc(database, "events", "evt_nf"), { type: "nf.registered", customer_code: "ITAU", source: "functions_financeiro", payload: { id: "fat_000000000000000000000001" } });
    await setDoc(doc(database, "events", "evt_cobranca"), { type: "cobranca.payment_registered", customer_code: "ITAU", source: "functions_financeiro", payload: { id: "fat_000000000000000000000001" } });
    await setDoc(doc(database, "pagamentos", "pag_000000000000000000000001"), { id: "pag_000000000000000000000001", fatura_id: "fat_000000000000000000000001", customer_code: "ITAU", status: "registrado", valor_cents: 500_000 });
    await setDoc(doc(database, "financeiro_operations", "op_1"), { kind: "nf_register" });
  });
});

after(async () => {
  await testEnvironment.cleanup();
});

describe("faturas: leitura", () => {
  it("owner, admin, financeiro e comercial leem a fatura", async () => {
    for (const uid of LEEM) {
      const fatura = await assertSucceeds(getDoc(doc(signedAs(uid), "faturas", "fat_000000000000000000000001")));
      assert.equal(fatura.data()?.valor_cents, 1_484_500, uid);
    }
  });

  it("a operação, o campo, o suporte, o painel, o rh e o cliente não leem (nem o cliente dono, até a Fase 4.3)", async () => {
    for (const uid of NAO_LEEM) await assertFails(getDoc(doc(signedAs(uid), "faturas", "fat_000000000000000000000001")));
  });

  it("owner, admin, financeiro e comercial leem o pagamento; os outros, nem o cliente dono, não", async () => {
    for (const uid of LEEM) {
      const pagamento = await assertSucceeds(getDoc(doc(signedAs(uid), "pagamentos", "pag_000000000000000000000001")));
      assert.equal(pagamento.data()?.valor_cents, 500_000, uid);
    }
    for (const uid of NAO_LEEM) await assertFails(getDoc(doc(signedAs(uid), "pagamentos", "pag_000000000000000000000001")));
  });

  it("o financeiro lê os eventos nf.* e cobranca.*; ninguém lê o recibo", async () => {
    await assertSucceeds(getDoc(doc(signedAs("finance-a"), "events", "evt_nf")));
    await assertSucceeds(getDoc(doc(signedAs("finance-a"), "events", "evt_cobranca")));
    await assertFails(getDoc(doc(signedAs("owner-a"), "financeiro_operations", "op_1")));
  });
});

describe("faturas: escrita", () => {
  it("nem o owner nem o financeiro gravam, alteram ou apagam pelo navegador", async () => {
    for (const uid of ["owner-a", "finance-a"]) {
      const database = signedAs(uid);
      await assertFails(setDoc(doc(database, "faturas", "fat_000000000000000000000002"), { customer_code: "ITAU", valor_cents: 1 }));
      await assertFails(updateDoc(doc(database, "faturas", "fat_000000000000000000000001"), { status: "paga" }));
      await assertFails(deleteDoc(doc(database, "faturas", "fat_000000000000000000000001")));
      await assertFails(setDoc(doc(database, "pagamentos", "pag_000000000000000000000002"), { fatura_id: "fat_000000000000000000000001", valor_cents: 1 }));
      await assertFails(updateDoc(doc(database, "pagamentos", "pag_000000000000000000000001"), { status: "estornado" }));
    }
  });
});
