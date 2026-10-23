import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";

import { openStorageDemandFor } from "./demanda-do-armazem-gravacao.js";
import { EVENTS_COLLECTION } from "./events.js";
import { saveServiceOrderFor } from "./os-gravacao.js";
import type { OperacaoProfile } from "./profile.js";

/**
 * Parte 4.5b: a entrega pela Dutelog do pedido de saída do WMS vira demanda
 * direta (canal wms) e as OS de ida e de volta; a retirada pelo cliente não
 * gera OS.
 */

const PROJECT_ID = "demo-dute-operacao";
const AGORA = () => new Date("2026-10-23T14:00:00.000Z");

let db: Firestore;
let app: ReturnType<typeof initializeApp>;

const wms: OperacaoProfile = { uid: "wms-1", role: "wms", name: "Sandra Melo" };
const interno: OperacaoProfile = { uid: "interno-1", role: "interno", name: "Paula" };
const campo: OperacaoProfile = { uid: "campo-1", role: "campo", name: "Carlos" };

const ENTREGA = {
  modo: "dutelog",
  destino: "Transamerica Expo · Pavilhão B",
  data: "2026-10-28",
  hora: "13:00",
  contato: { nome: "Lucas Prado", telefone: "11987654321" },
  montagem: true,
  retorno: { data: "2026-10-30", hora: "18:00" },
  demanda: null,
  os_numeros: [],
  definida_em: "2026-10-23T13:00:00.000Z",
  definida_por_uid: "wms-1",
  schema_version: 1,
};

before(() => {
  app = initializeApp({ projectId: PROJECT_ID }, "operacao-armazem-test");
  db = getFirestore(app);
});

beforeEach(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error("FIRESTORE_EMULATOR_HOST não definido.");
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
  await db.doc("customers/BTG").set({ code: "BTG Pactual", customer_code: "BTG Pactual", name: "BTG Pactual", status: "active" });
  await db.doc("demand_counters/geral").set({ ultimo: 10049 });
  await db.doc("orders/ord_118").set({ id: "ord_118", customer_code: "BTG Pactual", order_number: "PED-0118", status: "EM_EXPEDICAO", entrega: ENTREGA });
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

async function tamanho(colecao: string): Promise<number> {
  return (await db.collection(colecao).get()).size;
}

describe("a entrega pela Dutelog vira demanda e OS", () => {
  it("a demanda direta do canal wms, a ida agendada para a entrega e a volta para o retorno; o número volta ao pedido; repetir devolve o mesmo", async () => {
    const aberta = await openStorageDemandFor(db, wms, { idempotency_key: "e1", order_id: "ord_118" }, AGORA);
    assert.deepEqual(aberta, { numero: "10050", tipo: "planejada", os_numeros: ["10050-01", "10050-02"] });
    assert.deepEqual(await openStorageDemandFor(db, wms, { idempotency_key: "e1", order_id: "ord_118" }, AGORA), { ...aberta, replayed: true });

    const demanda = (await db.doc("demands/10050").get()).data() ?? {};
    assert.equal(demanda.entrada, "direta");
    assert.equal(demanda.canal, "wms");
    assert.equal(demanda.etapa, "para_planejar");
    assert.deepEqual(demanda.pedido_wms, { order_id: "ord_118", order_number: "PED-0118" });
    assert.equal(demanda.titulo, "Entrega do pedido PED-0118");
    assert.deepEqual(demanda.pedido_por, { nome: "Lucas Prado", telefone: "11987654321" });
    assert.equal(demanda.recebida_em, "2026-10-23T13:00:00.000Z");
    assert.equal(demanda.executar_ate, "2026-10-28T16:00:00.000Z");
    assert.deepEqual(demanda.os_numeros, ["10050-01", "10050-02"]);
    assert.equal(demanda.itens_pedidos.length, 3);

    const ida = (await db.doc("service_orders/10050-01").get()).data() ?? {};
    assert.equal(ida.status, "agendada");
    assert.deepEqual(ida.janela, { data: "2026-10-28", inicio: "13:00", fim: null });
    assert.deepEqual(ida.itens.map((item: { item: string; planejado: string }) => [item.item, item.planejado]), [
      ["Transporte do pedido PED-0118", "1"],
      ["Montagem no destino", "1"],
    ]);
    assert.deepEqual(ida.servicos, ["transporte", "montagem"]);
    assert.equal(ida.locais.origem.complemento, "Armazém Dutelog");
    assert.deepEqual(ida.locais.destino.contato, { nome: "Lucas Prado", telefone: "11987654321" });
    assert.equal(ida.retorno_ao_armazem, undefined);
    const volta = (await db.doc("service_orders/10050-02").get()).data() ?? {};
    assert.deepEqual(volta.janela, { data: "2026-10-30", inicio: "18:00", fim: null });
    assert.deepEqual(volta.retorno_ao_armazem, { order_id: "ord_118", order_number: "PED-0118" });
    assert.equal(volta.locais.destino.complemento, "Armazém Dutelog");
    assert.ok(volta.servicos.includes("desmontagem"));

    const entrega = (await db.doc("orders/ord_118").get()).get("entrega");
    assert.equal(entrega.demanda, "10050");
    assert.deepEqual(entrega.os_numeros, ["10050-01", "10050-02"]);

    const eventos = (await db.collection(EVENTS_COLLECTION).get()).docs.map((doc) => doc.data());
    assert.deepEqual(eventos.map((evento) => evento.type).sort(), ["demand.storage_opened", "os.planned", "os.planned"]);
    for (const proibido of ["Transamerica", "Lucas", "987654321"]) assert.equal(JSON.stringify(eventos).includes(proibido), false, proibido);

    // Todo o saldo está nas duas OS; outra chave não abre outra demanda.
    const resto = await rejection(saveServiceOrderFor(db, interno, { action: "create", idempotency_key: "resto", demanda: "10050" }));
    assert.equal(resto.message, "Todo o saldo da demanda já está em OS.");
    const outra = await rejection(openStorageDemandFor(db, interno, { idempotency_key: "e2", order_id: "ord_118" }, AGORA));
    assert.equal(outra.message, "A entrega já virou a demanda 10050.");
  });

  it("sem retorno nem montagem: uma OS, só com o transporte", async () => {
    await db.doc("orders/ord_118").update({ "entrega.retorno": null, "entrega.montagem": false });
    const aberta = await openStorageDemandFor(db, interno, { idempotency_key: "e1", order_id: "ord_118" }, AGORA);
    assert.deepEqual(aberta.os_numeros, ["10050-01"]);
    assert.deepEqual((await db.doc("service_orders/10050-01").get()).get("servicos"), ["transporte"]);
  });

  it("retirada pelo cliente não gera OS (nem demanda, nem número do contador); o campo não abre", async () => {
    await db.doc("orders/ord_118").update({ entrega: { modo: "retirada", data: "2026-10-24", hora: "09:00", quem_retira: "Carlos Lima" } });
    const retirada = await rejection(openStorageDemandFor(db, wms, { idempotency_key: "e1", order_id: "ord_118" }, AGORA));
    assert.equal(retirada.message, "A retirada pelo cliente não gera OS.");
    assert.equal(await tamanho("service_orders"), 0);
    assert.equal(await tamanho("demands"), 0);
    assert.equal((await db.doc("demand_counters/geral").get()).get("ultimo"), 10049);
    const doCampo = await rejection(openStorageDemandFor(db, campo, { idempotency_key: "e2", order_id: "ord_118" }, AGORA));
    assert.equal(doCampo.code, "permission-denied");
    assert.equal((await rejection(openStorageDemandFor(db, wms, { idempotency_key: "e3", order_id: "ord_x" }, AGORA))).code, "not-found");
  });
});
