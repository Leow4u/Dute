import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

import {
  advanceWarehouseTaskTransaction,
  createCustomerRequestTransaction,
  decideCustomerRequestTransaction,
  type OperationalActor,
} from "./operations.js";

const PROJECT_ID = "demo-dute-operations";
const actor: OperationalActor = {
  uid: "operator-1",
  email: "operacao@dutelog.com.br",
  name: "Operação Dutelog",
  role: "wms",
  customer_code: "BTG Pactual",
};

let db: Firestore;
let app: ReturnType<typeof initializeApp>;

async function clearFirestore() {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error("FIRESTORE_EMULATOR_HOST não definido.");
  const response = await fetch(
    `http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: "DELETE" },
  );
  assert.equal(response.ok, true, await response.text());
}

async function advance(taskUid: string, expectedStatus: string) {
  return advanceWarehouseTaskTransaction(
    db,
    {
      task_uid: taskUid,
      expected_status: expectedStatus,
      idempotency_key: `${taskUid}:${expectedStatus}`,
    },
    actor,
  );
}

before(async () => {
  assert.ok(
    process.env.FIRESTORE_EMULATOR_HOST,
    "Execute este teste pelo Firebase Emulator.",
  );
  app = initializeApp({ projectId: PROJECT_ID }, `operations-${Date.now()}`);
  db = getFirestore(app);
  await clearFirestore();
});

after(async () => {
  await deleteApp(app);
});

describe("fluxo WMS transacional", () => {
  it("aloca endereços internamente, impede sobre-reserva e conclui a entrega", async () => {
    await Promise.all([
      db.collection("stock_balances").doc("balance-a").set({
        id: "balance-a",
        customer_code: "BTG Pactual",
        sku_code: "BTG-TEST-1",
        client_item_code: "ITEM-1",
        product_name: "Produto real de teste transacional",
        category: "TESTE",
        location_id: "LOC-A",
        qty_on_hand: 3,
        qty_reserved: 0,
        qty_available: 3,
        unit_cost: 12.5,
      }),
      db.collection("stock_balances").doc("balance-b").set({
        id: "balance-b",
        customer_code: "BTG Pactual",
        sku_code: "BTG-TEST-1",
        client_item_code: "ITEM-1",
        product_name: "Produto real de teste transacional",
        category: "TESTE",
        location_id: "LOC-B",
        qty_on_hand: 4,
        qty_reserved: 0,
        qty_available: 4,
        unit_cost: 12.5,
      }),
    ]);

    const created = await createCustomerRequestTransaction(
      db,
      {
        type: "retirada",
        priority: "normal",
        title: "Abastecimento da loja",
        destination: "Loja BTG",
        customer_code: "BTG Pactual",
        idempotency_key: "request-outbound-1",
        items: [
          {
            sku_code: "BTG-TEST-1",
            client_item_code: "ITEM-1",
            product_name: "Produto real de teste transacional",
            unit_cost: 12.5,
            quantity: 6,
          },
        ],
      },
      { ...actor, role: "cliente", uid: "client-1" },
    );
    const requestId = String(created.id);
    const approved = (await decideCustomerRequestTransaction(
      db,
      {
        request_id: requestId,
        action: "approve",
        expected_status: "open",
        idempotency_key: "approve-outbound-1",
      },
      actor,
    )) as Record<string, unknown>;
    const repeated = await decideCustomerRequestTransaction(
      db,
      {
        request_id: requestId,
        action: "approve",
        expected_status: "open",
        idempotency_key: "approve-outbound-1",
      },
      actor,
    );
    assert.deepEqual(repeated, approved);
    assert.equal(approved.allocation_count, 2);

    const reservations = await db
      .collection("stock_reservations")
      .where("order_id", "==", approved.order_id)
      .get();
    assert.deepEqual(
      reservations.docs
        .map((document) => Number(document.data().reserved_qty))
        .sort((left, right) => left - right),
      [3, 3],
    );

    const competingRequest = await createCustomerRequestTransaction(
      db,
      {
        type: "retirada",
        priority: "normal",
        title: "Pedido concorrente",
        customer_code: "BTG Pactual",
        idempotency_key: "request-outbound-2",
        items: [{ sku_code: "BTG-TEST-1", quantity: 2 }],
      },
      { ...actor, role: "cliente", uid: "client-1" },
    );
    await assert.rejects(
      decideCustomerRequestTransaction(
        db,
        {
          request_id: String(competingRequest.id),
          action: "approve",
          expected_status: "open",
          idempotency_key: "approve-outbound-2",
        },
        actor,
      ),
      /Saldo insuficiente/,
    );

    const pickTaskId = String(approved.pick_task_id);
    const orderId = String(approved.order_id);
    await advance(`picking:${pickTaskId}`, "planned");
    const picking = (await advance(
      `picking:${pickTaskId}`,
      "in_progress",
    )) as Record<string, unknown>;
    const packTaskId = String(picking.pack_task_id);
    await advance(`packing:${packTaskId}`, "ready");
    const packing = (await advance(
      `packing:${packTaskId}`,
      "in_progress",
    )) as Record<string, unknown>;
    const shipmentId = String(packing.shipment_id);
    await advance(`shipping:${shipmentId}`, "ready_to_dispatch");
    await advance(`shipping:${shipmentId}`, "dispatched");

    const balances = await db
      .collection("stock_balances")
      .where("sku_code", "==", "BTG-TEST-1")
      .get();
    assert.equal(
      balances.docs.reduce(
        (sum, document) => sum + Number(document.data().qty_on_hand),
        0,
      ),
      1,
    );
    assert.equal(
      balances.docs.reduce(
        (sum, document) => sum + Number(document.data().qty_reserved),
        0,
      ),
      0,
    );

    const tracking = await db
      .collection("client_order_tracking")
      .doc(orderId)
      .get();
    assert.equal(tracking.data()?.status, "delivered");
    assert.equal(Array.isArray(tracking.data()?.timeline), true);
    assert.equal((tracking.data()?.timeline as unknown[]).length, 7);

    const projection = await db
      .collection("client_inventory")
      .doc("cinv_BTG_Pactual__BTG-TEST-1")
      .get();
    assert.equal(projection.data()?.qty_on_hand, 1);
    assert.equal(projection.data()?.qty_reserved, 0);
    assert.equal(projection.data()?.qty_available, 1);
  });

  it("somente confirma entrada no estoque ao concluir o recebimento", async () => {
    const created = await createCustomerRequestTransaction(
      db,
      {
        type: "recebimento",
        priority: "normal",
        title: "Aviso de fornecedor",
        customer_code: "BTG Pactual",
        idempotency_key: "request-inbound-1",
        items: [
          {
            sku_code: "BTG-TEST-1",
            client_item_code: "ITEM-1",
            product_name: "Produto real de teste transacional",
            unit_cost: 12.5,
            quantity: 2,
          },
        ],
      },
      { ...actor, role: "cliente", uid: "client-1" },
    );
    const approved = (await decideCustomerRequestTransaction(
      db,
      {
        request_id: String(created.id),
        action: "approve",
        expected_status: "open",
        idempotency_key: "approve-inbound-1",
      },
      actor,
    )) as Record<string, unknown>;
    const inboundId = String(approved.inbound_id);

    const before = await db
      .collection("client_inventory")
      .doc("cinv_BTG_Pactual__BTG-TEST-1")
      .get();
    assert.equal(before.data()?.qty_on_hand, 1);

    await advance(`receiving:${inboundId}`, "created");
    await advance(`receiving:${inboundId}`, "checking");

    const after = await db
      .collection("client_inventory")
      .doc("cinv_BTG_Pactual__BTG-TEST-1")
      .get();
    assert.equal(after.data()?.qty_on_hand, 3);
    assert.equal(after.data()?.qty_available, 3);
    const movements = await db
      .collection("movements")
      .where("receipt_id", "==", inboundId)
      .get();
    assert.equal(movements.size, 1);
    assert.equal(movements.docs[0]?.data().tipo_mov, "ENTRADA");
  });
});
