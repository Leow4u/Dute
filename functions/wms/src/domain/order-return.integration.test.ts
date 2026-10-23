import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";

import type { OperationalActor } from "./operations.js";
import { receiveOrderReturnFlow } from "./order-return.js";

/** Parte 4.5d: o retorno do pedido de saída vira uma devolução para a disposição física, uma vez. */

const PROJECT_ID = "demo-dute-operations";
const AGORA = () => new Date("2026-10-30T22:00:00.000Z");
const wms: OperationalActor = { uid: "wms-1", role: "wms", name: "Sandra Melo" };
let db: Firestore;
let app: ReturnType<typeof initializeApp>;

const ITEM = { sku_code: "BTG-EST-1", client_item_code: "EST-1", product_name: "Estande modular", quantity: 12 };

before(() => {
  app = initializeApp({ projectId: PROJECT_ID }, "order-return-test");
  db = getFirestore(app);
});

beforeEach(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error("FIRESTORE_EMULATOR_HOST não definido.");
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
  await db.doc("products/EST-1").set({ id: "EST-1", customer_code: "BTG Pactual", cod_cliente: "EST-1", produto: "Estande modular", status: "active" });
  await db.doc("skus/BTG-EST-1").set({ id: "BTG-EST-1", customer_code: "BTG Pactual", cod_cliente: "EST-1", cod_btg: "BTG-EST-1", sku_code: "BTG-EST-1", produto: "Estande modular", status: "active" });
  await db.doc("orders/ord_118").set({
    id: "ord_118",
    customer_code: "BTG Pactual",
    order_number: "PED-0118",
    status: "ENTREGUE",
    retorno: { status: "a_receber", os: "10050-02", demanda: "10050", chegou_em: "2026-10-30T21:40:00.000Z", return_id: null },
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

describe("receber o retorno do pedido", () => {
  it("vira a devolução do pedido, com a referência da OS, e o pedido guarda o retorno recebido; uma vez", async () => {
    const recebido = await receiveOrderReturnFlow(db, { order_id: "ord_118", items: [ITEM] }, wms, AGORA);
    assert.equal(recebido.order_id, "ord_118");
    const returnId = String(recebido.return_id);
    const devolucao = (await db.doc(`returns/${returnId}`).get()).data() ?? {};
    assert.equal(devolucao.source, "retorno_do_pedido");
    assert.equal(devolucao.reference, "PED-0118 · OS 10050-02");
    assert.equal(devolucao.qty_total, 12);
    assert.equal((await db.collection("return_items").where("return_id", "==", returnId).get()).size, 1);

    const retorno = (await db.doc("orders/ord_118").get()).get("retorno");
    assert.equal(retorno.status, "recebido");
    assert.equal(retorno.return_id, returnId);
    assert.equal(retorno.recebido_por_uid, "wms-1");
    const eventos = (await db.collection("events").where("type", "==", "expedicao.return_linked").get()).docs.map((doc) => doc.data());
    assert.deepEqual(eventos.map((evento) => evento.payload), [{ order_id: "ord_118", return_id: returnId, os: "10050-02", linhas: 1 }]);

    const deNovo = await rejection(receiveOrderReturnFlow(db, { order_id: "ord_118", items: [ITEM] }, wms, AGORA));
    assert.equal(deNovo.message, "O retorno do pedido já foi recebido.");
    assert.equal((await db.collection("returns").get()).size, 1);
  });

  it("o pedido sem retorno a receber não vira devolução", async () => {
    await db.doc("orders/ord_118").update({ retorno: null });
    const sem = await rejection(receiveOrderReturnFlow(db, { order_id: "ord_118", items: [ITEM] }, wms, AGORA));
    assert.equal(sem.message, "O pedido não tem retorno da Operação a receber.");
    assert.equal((await db.collection("returns").get()).size, 0);
  });
});
