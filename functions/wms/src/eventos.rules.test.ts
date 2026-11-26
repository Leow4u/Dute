import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, beforeEach, describe, it } from "node:test";

import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from "firebase/firestore";

/**
 * As três coleções dos Eventos (eventos, parte 1; spec, "Regras do Firestore,
 * índices e zeragem"). O evento e a edição, sem dinheiro: a equipe do WMS lê
 * e o próprio cliente lê, com a armazenagem no contrato e o portal ligado. O
 * preço da edição: quem lê valores e o próprio cliente; o wms, o interno e o
 * suporte não. Só as callables do WMS gravam: o navegador não escreve em
 * nenhuma das três.
 */

const PROJECT_ID = "demo-dute-operations";
const CUSTOMER_A = "BTG Pactual";
const CUSTOMER_B = "CLIENTE ISOLADO";
const SEM_ARMAZENAGEM = "SO OPERACAO";
const PORTAL_DESLIGADO = "ARQUIVADO";

const PAPEIS = {
  "owner-a": ["owner", null],
  "admin-a": ["admin", null],
  "ops-a": ["interno", null],
  "wms-a": ["wms", null],
  "campo-a": ["campo", null],
  "comercial-a": ["comercial", null],
  "finance-a": ["financeiro", null],
  "rh-a": ["rh", null],
  "support-a": ["suporte", null],
  "painel-a": ["painel", null],
  "client-a": ["cliente", CUSTOMER_A],
  "client-b": ["cliente", CUSTOMER_B],
  "client-c": ["cliente", SEM_ARMAZENAGEM],
  "client-off": ["cliente", PORTAL_DESLIGADO],
} as const;

const COLECOES = ["client_events", "client_event_editions", "client_event_prices"] as const;

/** O id de cada documento semeado: o evento `cve-<sufixo>`, a edição e o preço `ced-<sufixo>`. */
const DOCUMENTOS = { [CUSTOMER_A]: "a", [CUSTOMER_B]: "b", [SEM_ARMAZENAGEM]: "c", [PORTAL_DESLIGADO]: "off" } as const;

function idDe(colecao: (typeof COLECOES)[number], sufixo: string) {
  return colecao === "client_events" ? `cve-${sufixo}` : `ced-${sufixo}`;
}

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
    for (const [uid, [role, customerCode]] of Object.entries(PAPEIS)) {
      await setDoc(doc(database, "users", uid), { nome: uid, email: `${uid}@example.com`, role, ...(customerCode ? { customer_code: customerCode } : {}) });
    }
    await setDoc(doc(database, "client_access", SEM_ARMAZENAGEM), { customer_code: SEM_ARMAZENAGEM, modules: ["operacao"] });
    await setDoc(doc(database, "client_access", PORTAL_DESLIGADO), { customer_code: PORTAL_DESLIGADO, modules: ["wms", "financeiro"], portal_ativo: false });
    for (const [customerCode, sufixo] of Object.entries(DOCUMENTOS)) {
      await setDoc(doc(database, "client_events", `cve-${sufixo}`), { id: `cve-${sufixo}`, customer_code: customerCode, name: "B2B Conference", status: "active" });
      await setDoc(doc(database, "client_event_editions", `ced-${sufixo}`), {
        id: `ced-${sufixo}`,
        customer_code: customerCode,
        event_id: `cve-${sufixo}`,
        event_name: "B2B Conference",
        label: "2027",
        status: "enviado",
        updated_at: new Date("2026-11-26T12:00:00.000Z"),
      });
      await setDoc(doc(database, "client_event_prices", `ced-${sufixo}`), { customer_code: customerCode, fechado_cents: 1_250_000, valor_declarado_cents: 10_000_000 });
    }
  });
});

after(async () => {
  await testEnvironment.cleanup();
});

describe("os Eventos nas regras do Firestore", () => {
  it("o evento e a edição: a equipe do WMS e o próprio cliente leem; o outro cliente, o comercial e o campo não", async () => {
    for (const uid of ["owner-a", "admin-a", "ops-a", "wms-a", "support-a", "client-a"]) {
      await assertSucceeds(getDoc(doc(signedAs(uid), "client_event_editions", "ced-a")));
      await assertSucceeds(getDoc(doc(signedAs(uid), "client_events", "cve-a")));
    }
    for (const uid of ["client-b", "comercial-a", "campo-a", "rh-a", "finance-a", "painel-a"]) {
      await assertFails(getDoc(doc(signedAs(uid), "client_event_editions", "ced-a")));
      await assertFails(getDoc(doc(signedAs(uid), "client_events", "cve-a")));
    }
    await assertFails(getDoc(doc(signedAs("client-a"), "client_event_editions", "ced-b")));
    await assertFails(getDoc(doc(signedAs("client-a"), "client_events", "cve-b")));
  });

  it("o cliente lista só com o filtro do próprio código", async () => {
    const cliente = signedAs("client-a");
    for (const colecao of COLECOES) {
      const proprios = await assertSucceeds(getDocs(query(collection(cliente, colecao), where("customer_code", "==", CUSTOMER_A))));
      assert.deepEqual(proprios.docs.map((item) => item.id), [idDe(colecao, "a")], colecao);
      await assertFails(getDocs(collection(cliente, colecao)));
      await assertFails(getDocs(query(collection(cliente, colecao), where("customer_code", "==", CUSTOMER_B))));
    }
    // A agenda da Armazenagem mostra todos os clientes: a equipe lista sem o filtro.
    const equipe = await assertSucceeds(getDocs(collection(signedAs("wms-a"), "client_event_editions")));
    assert.equal(equipe.size, Object.keys(DOCUMENTOS).length);
  });

  it("o preço: owner, admin, financeiro, comercial e o próprio cliente leem; wms, interno, suporte e o outro cliente não", async () => {
    for (const uid of ["owner-a", "admin-a", "finance-a", "comercial-a", "client-a"]) {
      await assertSucceeds(getDoc(doc(signedAs(uid), "client_event_prices", "ced-a")));
    }
    for (const uid of ["wms-a", "ops-a", "support-a", "client-b", "campo-a", "rh-a", "painel-a"]) {
      await assertFails(getDoc(doc(signedAs(uid), "client_event_prices", "ced-a")));
    }
    await assertFails(getDocs(collection(signedAs("wms-a"), "client_event_prices")));
  });

  it("o cliente sem a armazenagem no contrato e o de portal desligado não leem nem os próprios", async () => {
    for (const [uid, sufixo] of [["client-c", "c"], ["client-off", "off"]] as const) {
      for (const colecao of COLECOES) {
        await assertFails(getDoc(doc(signedAs(uid), colecao, idDe(colecao, sufixo))));
      }
    }
  });

  it("ninguém escreve pelo navegador", async () => {
    for (const uid of Object.keys(PAPEIS)) {
      const database = signedAs(uid);
      for (const colecao of COLECOES) {
        await assertFails(setDoc(doc(database, colecao, `novo-${uid}`), { customer_code: CUSTOMER_A, status: "rascunho" }));
        await assertFails(updateDoc(doc(database, colecao, idDe(colecao, "a")), { status: "fechado" }));
        await assertFails(deleteDoc(doc(database, colecao, idDe(colecao, "a"))));
      }
    }
  });
});
