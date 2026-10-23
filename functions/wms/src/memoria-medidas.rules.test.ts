import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from "firebase/firestore";

/**
 * Regras das medidas da memória (docs/plataforma/fase-5-memoria.md, parte
 * 5.1): abrem à equipe interna que planeja e orça (owner, admin, interno e
 * comercial), a do cliente e a geral; o cliente, o campo, o painel e o resto
 * da equipe não leem, nem a do próprio cliente. O cursor da rotina não abre
 * pelo navegador. As sugestões (parte 5.2a) abrem a quem pediu e a owner e
 * admin. As lembranças (parte 5.3a) têm preço e não abrem a ninguém pelo
 * navegador: só a callable do núcleo lê. Os dias parado (parte 5.4a) abrem a
 * quem lê o estoque, não ao cliente. Ninguém grava pelo navegador.
 */

const PROJECT_ID = "demo-dute-operations";
const DO_ITAU = "med_itau";
const GERAL = "med_geral";

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

const PAPEIS: Record<string, { role: string; customer_code?: string }> = {
  "owner-a": { role: "owner" },
  "admin-a": { role: "admin" },
  "ops-a": { role: "interno" },
  "comercial-a": { role: "comercial" },
  "support-a": { role: "suporte" },
  "wms-a": { role: "wms" },
  "financeiro-a": { role: "financeiro" },
  "campo-a": { role: "campo" },
  "painel-a": { role: "painel" },
  "client-itau": { role: "cliente", customer_code: "ITAU" },
};

const LEEM = ["owner-a", "admin-a", "ops-a", "comercial-a"];
const NAO_LEEM = ["support-a", "wms-a", "financeiro-a", "campo-a", "painel-a", "client-itau"];

before(async () => {
  testEnvironment = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { ...endereco("FIRESTORE_EMULATOR_HOST"), rules: regras("firestore.rules") },
  });
});

beforeEach(async () => {
  await testEnvironment.clearFirestore();
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    const database = context.firestore();
    for (const [uid, perfil] of Object.entries(PAPEIS)) await setDoc(doc(database, "users", uid), { nome: uid, ...perfil });
    await setDoc(doc(database, "ai_measures", DO_ITAU), { id: DO_ITAU, tipo: "duracao_item", escopo: "cliente", customer_code: "ITAU", lpu_item_id: "lpu_a", homem_minuto_por_unidade: 20, execucoes: 2 });
    await setDoc(doc(database, "ai_measures", GERAL), { id: GERAL, tipo: "duracao_item", escopo: "geral", customer_code: null, lpu_item_id: "lpu_a", homem_minuto_por_unidade: 25, execucoes: 3 });
    await setDoc(doc(database, "ai_cursors", "medidas"), { evento_id: "evt_x" });
    await setDoc(doc(database, "ai_case_memory", "10045"), { demanda: "10045", customer_code: "ITAU", orcado_cents: 120000, realizado_cents: 140000 });
    await setDoc(doc(database, "ai_suggestions", "sug_ops"), { id: "sug_ops", tipo: "duracao_os", customer_code: "ITAU", pedida_por: { uid: "ops-a", role: "interno" } });
    await setDoc(doc(database, "ai_suggestions", "sug_outro"), { id: "sug_outro", tipo: "duracao_os", customer_code: "ITAU", pedida_por: { uid: "outro-interno", role: "interno" } });
    await setDoc(doc(database, "ai_stock_age", "item_itau"), { tipo: "item", customer_code: "ITAU", sku_code: "ITAU-000001", saldo: 30, relogio: { primeira_entrada: null, ultima_entrada: null, ultima_saida: null } });
  });
});

after(async () => {
  await testEnvironment?.cleanup();
});

function firestore(uid: string) {
  return testEnvironment.authenticatedContext(uid).firestore();
}

describe("as medidas da memória", () => {
  it("a equipe que planeja e orça lê a do cliente e a geral, e consulta por item", async () => {
    for (const uid of LEEM) {
      await assertSucceeds(getDoc(doc(firestore(uid), "ai_measures", DO_ITAU)));
      await assertSucceeds(getDoc(doc(firestore(uid), "ai_measures", GERAL)));
      await assertSucceeds(getDocs(query(collection(firestore(uid), "ai_measures"), where("lpu_item_id", "==", "lpu_a"))));
    }
  });

  it("o cliente, o campo, o painel e o resto da equipe não leem, nem a do próprio cliente", async () => {
    for (const uid of NAO_LEEM) {
      await assertFails(getDoc(doc(firestore(uid), "ai_measures", DO_ITAU)));
      await assertFails(getDocs(query(collection(firestore(uid), "ai_measures"), where("customer_code", "==", "ITAU"))));
    }
    await assertFails(getDoc(doc(testEnvironment.unauthenticatedContext().firestore(), "ai_measures", GERAL)));
  });

  it("ninguém grava pelo navegador, e o cursor da rotina não abre", async () => {
    for (const uid of ["owner-a", "ops-a", "client-itau"]) {
      const database = firestore(uid);
      await assertFails(setDoc(doc(database, "ai_measures", "med_novo"), { tipo: "duracao_item" }));
      await assertFails(updateDoc(doc(database, "ai_measures", DO_ITAU), { homem_minuto_por_unidade: 1 }));
      await assertFails(deleteDoc(doc(database, "ai_measures", GERAL)));
      await assertFails(getDoc(doc(database, "ai_cursors", "medidas")));
      await assertFails(setDoc(doc(database, "ai_cursors", "medidas"), { evento_id: "evt_y" }));
    }
  });
});

describe("as sugestões da memória (parte 5.2a)", () => {
  it("quem pediu lê as próprias; owner e admin leem todas; o resto, não", async () => {
    await assertSucceeds(getDoc(doc(firestore("ops-a"), "ai_suggestions", "sug_ops")));
    await assertFails(getDoc(doc(firestore("ops-a"), "ai_suggestions", "sug_outro")));
    for (const uid of ["owner-a", "admin-a"]) {
      await assertSucceeds(getDoc(doc(firestore(uid), "ai_suggestions", "sug_outro")));
      await assertSucceeds(getDocs(query(collection(firestore(uid), "ai_suggestions"), where("customer_code", "==", "ITAU"))));
    }
    for (const uid of ["comercial-a", "support-a", "campo-a", "painel-a", "client-itau"]) await assertFails(getDoc(doc(firestore(uid), "ai_suggestions", "sug_ops")));
  });

  it("ninguém grava pelo navegador, nem quem pediu", async () => {
    for (const uid of ["owner-a", "ops-a"]) {
      await assertFails(setDoc(doc(firestore(uid), "ai_suggestions", "sug_novo"), { pedida_por: { uid } }));
      await assertFails(updateDoc(doc(firestore(uid), "ai_suggestions", "sug_ops"), { decisao: "aceitou" }));
    }
  });
});

describe("as lembranças da memória (parte 5.3a)", () => {
  it("ninguém lê nem grava pelo navegador, nem owner, nem o cliente da demanda", async () => {
    for (const uid of [...LEEM, ...NAO_LEEM]) {
      const database = firestore(uid);
      await assertFails(getDoc(doc(database, "ai_case_memory", "10045")));
      await assertFails(getDocs(query(collection(database, "ai_case_memory"), where("customer_code", "==", "ITAU"))));
      await assertFails(setDoc(doc(database, "ai_case_memory", "10046"), { customer_code: "ITAU" }));
      await assertFails(updateDoc(doc(database, "ai_case_memory", "10045"), { orcado_cents: 1 }));
      await assertFails(deleteDoc(doc(database, "ai_case_memory", "10045")));
    }
  });
});

describe("os dias parado do estoque (parte 5.4a)", () => {
  it("quem lê o estoque lê e consulta pelo cliente; o cliente, o comercial, o campo e o painel não, nem o item do próprio cliente", async () => {
    for (const uid of ["owner-a", "admin-a", "ops-a", "wms-a", "support-a"]) {
      await assertSucceeds(getDoc(doc(firestore(uid), "ai_stock_age", "item_itau")));
      await assertSucceeds(getDocs(query(collection(firestore(uid), "ai_stock_age"), where("customer_code", "==", "ITAU"))));
    }
    for (const uid of ["comercial-a", "financeiro-a", "campo-a", "painel-a", "client-itau"]) {
      await assertFails(getDoc(doc(firestore(uid), "ai_stock_age", "item_itau")));
      await assertFails(getDocs(query(collection(firestore(uid), "ai_stock_age"), where("customer_code", "==", "ITAU"))));
    }
  });

  it("ninguém grava pelo navegador", async () => {
    for (const uid of ["owner-a", "wms-a", "client-itau"]) {
      const database = firestore(uid);
      await assertFails(setDoc(doc(database, "ai_stock_age", "item_novo"), { tipo: "item", customer_code: "ITAU" }));
      await assertFails(updateDoc(doc(database, "ai_stock_age", "item_itau"), { saldo: 1 }));
      await assertFails(deleteDoc(doc(database, "ai_stock_age", "item_itau")));
    }
  });
});
