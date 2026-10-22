import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";

import { EVENTS_COLLECTION } from "./events.js";
import { saveServiceOrderFor } from "./os-gravacao.js";
import { SERVICE_ORDERS_COLLECTION, SERVICE_ORDER_COUNTERS_COLLECTION } from "./os.js";
import type { OperacaoProfile } from "./profile.js";

const PROJECT_ID = "demo-dute-operacao";
const NUMERO = "10045";

let db: Firestore;
let app: ReturnType<typeof initializeApp>;

const interno: OperacaoProfile = { uid: "interno-1", role: "interno", name: "Marina" };
const campo: OperacaoProfile = { uid: "campo-1", role: "campo", name: "Paulo" };

const LINHA = {
  id: "ln_1",
  lpu_item_id: "lpu_mesa",
  codigo: "DTL-10",
  item: "Estação",
  descricao: "Montagem de estação",
  servico: "Montagem",
  unidade: "UN",
  quantidade: "2",
  preco: "88.50",
  preco_tabela: "80.00",
  origem: "alterado",
  motivo: "negociado",
  total_cents: 17700,
};

before(() => {
  app = initializeApp({ projectId: PROJECT_ID }, "operacao-os-test");
  db = getFirestore(app);
});

beforeEach(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error("FIRESTORE_EMULATOR_HOST não definido.");
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
  await db.collection("demands").doc(NUMERO).set({
    customer_code: "ITAU",
    customer_name: "Itaú Unibanco",
    escopo_rv: 0,
    executado_de: null,
    perda: null,
    cancelamento: null,
    validacao: null,
    origem: { local_id: "loc_ceic", complemento: "portaria" },
    destino: { local_id: "loc_faria", complemento: null },
  });
  await db.collection("quotes").doc(NUMERO).set({ status: "enviado", rv: 0, customer_code: "ITAU", tipo_rv: "proposta" });
  await db.collection("quotes").doc(NUMERO).collection("revisoes").doc("0").set({
    linhas: [LINHA, { id: "ln_aj", origem: "ajuste", item: "Ajuste comercial", descricao: "Ajuste comercial", quantidade: "1", preco: "-10.00", total_cents: -1000 }],
  });
});

after(async () => {
  await deleteApp(app);
});

async function rejection(promise: Promise<unknown>): Promise<HttpsError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof HttpsError, `esperava HttpsError, veio ${String(error)}`);
    return error;
  }
  assert.fail("deveria recusar");
}

describe("OS a partir da demanda", () => {
  it("abre 10045-01 sem preço e sem o nome do cliente, e repetir devolve a mesma", async () => {
    const criada = await saveServiceOrderFor(db, interno, { action: "create", idempotency_key: "abre", demanda: NUMERO });
    assert.equal(criada.numero, "10045-01");
    assert.equal(criada.edicao, 1);
    const deNovo = await saveServiceOrderFor(db, interno, { action: "create", idempotency_key: "abre", demanda: NUMERO });
    assert.equal(deNovo.numero, "10045-01");
    assert.equal(deNovo.replayed, true);

    const os = (await db.collection(SERVICE_ORDERS_COLLECTION).doc("10045-01").get()).data() ?? {};
    const texto = JSON.stringify(os);
    assert.equal(os.status, "aberta");
    assert.equal(os.customer_code, "ITAU");
    assert.equal(os.origem_local_id, "loc_ceic");
    assert.equal(os.itens.length, 1);
    assert.equal(os.itens[0].quantidade, "2");
    assert.equal(os.itens[0].lpu_item_id, "lpu_mesa");
    assert.equal(texto.includes("88.50"), false);
    assert.equal(texto.includes("17700"), false);
    assert.equal(texto.includes("negociado"), false);
    assert.equal(texto.includes("Ajuste"), false);
    assert.equal(texto.includes("Itaú"), false);
    assert.equal(texto.includes("preco"), false);

    const evento = (await db.collection(EVENTS_COLLECTION).get()).docs[0].data();
    assert.equal(evento.type, "os.created");
    assert.equal(evento.customer_code, "ITAU");
    assert.equal(JSON.stringify(evento).includes("88.50"), false);
    assert.equal(JSON.stringify(evento).includes("Itaú"), false);
    const demanda = (await db.collection("demands").doc(NUMERO).get()).data() ?? {};
    assert.deepEqual(demanda.os_numeros, ["10045-01"]);
    assert.equal((await db.collection(SERVICE_ORDER_COUNTERS_COLLECTION).doc(NUMERO).get()).data()?.ultimo, 1);
  });

  it("a segunda OS é 10045-02, e campo não abre", async () => {
    await saveServiceOrderFor(db, interno, { action: "create", idempotency_key: "um", demanda: NUMERO });
    const segunda = await saveServiceOrderFor(db, interno, { action: "create", idempotency_key: "dois", demanda: NUMERO });
    assert.equal(segunda.numero, "10045-02");
    const negado = await rejection(saveServiceOrderFor(db, campo, { action: "create", idempotency_key: "campo", demanda: NUMERO }));
    assert.equal(negado.code, "permission-denied");
  });

  it("demanda que saiu de Para planejar não vira OS", async () => {
    await db.collection("demands").doc(NUMERO).update({ executado_de: "2026-10-16" });
    const error = await rejection(saveServiceOrderFor(db, interno, { action: "create", idempotency_key: "tarde", demanda: NUMERO }));
    assert.equal(error.code, "failed-precondition");
    assert.match(error.message, /Para planejar/);
  });

  it("cancela a aberta com a edição vista e não leva o motivo no evento", async () => {
    await saveServiceOrderFor(db, interno, { action: "create", idempotency_key: "abre", demanda: NUMERO });
    const cancelada = await saveServiceOrderFor(db, interno, {
      action: "cancel",
      idempotency_key: "cancela",
      numero: "10045-01",
      expected_edicao: 1,
      motivo: "Cliente adiou",
    });
    assert.equal(cancelada.edicao, 2);
    const os = (await db.collection(SERVICE_ORDERS_COLLECTION).doc("10045-01").get()).data() ?? {};
    assert.equal(os.status, "cancelada");
    assert.equal(os.cancelamento.motivo, "Cliente adiou");
    const tipos = (await db.collection(EVENTS_COLLECTION).get()).docs.map((item) => item.data());
    const cancelamento = tipos.find((evento) => evento.type === "os.cancelled");
    assert.ok(cancelamento);
    assert.equal(JSON.stringify(cancelamento).includes("adiou"), false);
    const deNovo = await rejection(saveServiceOrderFor(db, interno, {
      action: "cancel",
      idempotency_key: "de-novo",
      numero: "10045-01",
      expected_edicao: 2,
      motivo: "Outra vez",
    }));
    assert.match(deNovo.message, /cancelada/);
  });
});
