import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";

import type { OperationalActor } from "./operations.js";
import { setOrderDeliveryTransaction } from "./order-delivery.js";

/** Parte 4.5a: a entrega do pedido de saída fica no pedido, com o evento sem texto livre. */

const PROJECT_ID = "demo-dute-operations";
const AGORA = () => new Date("2026-10-23T13:00:00.000Z");
const wms: OperationalActor = { uid: "wms-1", role: "wms", name: "Sandra Melo" };
let db: Firestore;
let app: ReturnType<typeof initializeApp>;

const DUTELOG = {
  order_id: "ord_118",
  entrega: { modo: "dutelog", destino: "Transamerica Expo · Pavilhão B", data: "2026-10-28", hora: "13:00", contato: { nome: "Lucas Prado" }, montagem: true, retorno: { data: "2026-10-30", hora: "18:00" } },
};

before(() => {
  app = initializeApp({ projectId: PROJECT_ID }, "order-delivery-test");
  db = getFirestore(app);
});

beforeEach(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error("FIRESTORE_EMULATOR_HOST não definido.");
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
  await db.doc("orders/ord_118").set({ id: "ord_118", customer_code: "BTG Pactual", order_number: "PED-0118", status: "EM_EXPEDICAO" });
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

async function eventos() {
  return (await db.collection("events").where("type", "==", "expedicao.delivery_set").get()).docs.map((doc) => doc.data());
}

describe("a entrega do pedido", () => {
  it("grava a entrega pela Dutelog no pedido, sem demanda ainda; repetir não grava de novo", async () => {
    assert.deepEqual(await setOrderDeliveryTransaction(db, DUTELOG, wms, AGORA), { ok: true, order_id: "ord_118", modo: "dutelog", changed: true });
    const entrega = (await db.doc("orders/ord_118").get()).get("entrega");
    assert.equal(entrega.modo, "dutelog");
    assert.equal(entrega.destino, "Transamerica Expo · Pavilhão B");
    assert.equal(entrega.demanda, null);
    assert.deepEqual(entrega.os_numeros, []);
    assert.equal(entrega.definida_por_uid, "wms-1");
    assert.deepEqual(await setOrderDeliveryTransaction(db, DUTELOG, wms, AGORA), { ok: true, order_id: "ord_118", modo: "dutelog", changed: false });
    const lista = await eventos();
    assert.equal(lista.length, 1);
    assert.deepEqual(lista[0].payload, { order_id: "ord_118", modo: "dutelog", data: "2026-10-28", montagem: true, retorno: true });
    for (const proibido of ["Transamerica", "Lucas"]) assert.equal(JSON.stringify(lista[0]).includes(proibido), false, proibido);
  });

  it("troca para retirada enquanto a Operação não abriu a demanda; depois, recusa", async () => {
    await setOrderDeliveryTransaction(db, DUTELOG, wms, AGORA);
    // O app antigo ainda manda o documento de quem retira: não se grava (decisão 3 da LGPD).
    await setOrderDeliveryTransaction(db, { order_id: "ord_118", entrega: { modo: "retirada", data: "2026-10-24", hora: "09:00", quem_retira: "Carlos Lima", documento: "RG 12.345.678-9", placa: "ABC1D23" } }, wms, AGORA);
    assert.equal((await db.doc("orders/ord_118").get()).get("entrega.modo"), "retirada");
    assert.equal((await db.doc("orders/ord_118").get()).get("entrega.documento"), undefined);
    await db.doc("orders/ord_118").update({ "entrega.demanda": "10050" });
    const depois = await rejection(setOrderDeliveryTransaction(db, DUTELOG, wms, AGORA));
    assert.equal(depois.message, "A entrega já virou a demanda 10050 na Operação: mude por lá.");
  });

  it("o pedido que saiu ou não existe não recebe entrega", async () => {
    await db.doc("orders/ord_118").update({ status: "EXPEDIDO" });
    assert.match((await rejection(setOrderDeliveryTransaction(db, DUTELOG, wms, AGORA))).message, /já saiu/);
    assert.equal((await rejection(setOrderDeliveryTransaction(db, { ...DUTELOG, order_id: "ord_x" }, wms, AGORA))).code, "not-found");
    assert.equal((await eventos()).length, 0);
  });
});
