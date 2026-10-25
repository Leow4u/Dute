import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

import {
  addCatalogPhotosTransaction,
  advanceWarehouseTaskTransaction,
  completeOpeningInventorySessionTransaction,
  createInboundReceiptTransaction,
  createOpeningInventorySessionTransaction,
  createReturnReceiptTransaction,
  createInventoryMovementTransaction,
  createCustomerRequestTransaction,
  decideCustomerRequestTransaction,
  openingInventorySessionDocumentId,
  recordCycleCountTransaction,
  removeOpeningInventoryLineTransaction,
  setReturnDispositionTransaction,
  updateInboundReceiptConferenceTransaction,
  type OperationalActor,
} from "./operations.js";
import { assignMissingRequestNumbers } from "./request-numbers.js";
import { catalogPriceId } from "./catalog-prices.js";

const PROJECT_ID = "demo-dute-operations";
const actor: OperationalActor = {
  uid: "operator-1",
  email: "operacao@dutelog.com.br",
  name: "Operação Dutelog",
  role: "wms",
  customer_code: "BTG Pactual",
};

async function storedUnitPrice(database: Firestore, customer: string, sku: string) {
  const snap = await database.collection("catalog_prices").doc(catalogPriceId(customer, sku)).get();
  return snap.data()?.preco_unit;
}

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
  // Produto novo ganha SKU na sigla do cliente (domain/catalog-codes.ts).
  await db.collection("customers").doc("BTG_Pactual").set({
    code: "BTG Pactual",
    customer_code: "BTG Pactual",
    name: "BTG Pactual",
    sku_prefix: "BTG",
    status: "active",
  });
}

async function advance(
  taskUid: string,
  expectedStatus: string,
  operation?: Record<string, unknown>,
) {
  return advanceWarehouseTaskTransaction(
    db,
    {
      task_uid: taskUid,
      expected_status: expectedStatus,
      operation,
      idempotency_key: `${taskUid}:${expectedStatus}:${JSON.stringify(operation ?? {})}`,
    },
    actor,
  );
}

/** Cartões apagados que o único evento do tipo registrou, ordenados. */
async function deletedCatalogDocs(type: string) {
  const events = await db.collection("events").where("type", "==", type).get();
  assert.equal(events.size, 1);
  const docs = events.docs[0]!.data().payload?.deleted_catalog_docs;
  return docs === undefined ? undefined : [...(docs as string[])].sort();
}

type OpeningCountInput = Parameters<typeof recordCycleCountTransaction>[1];

function openingCountInput(
  sessionId: string,
  overrides: Partial<OpeningCountInput> = {},
): OpeningCountInput {
  return {
    mode: "opening",
    session_id: sessionId,
    customer_code: "BTG Pactual",
    // Produto novo ganha o SKU gerado na sigla da BTG (o primeiro depois da
    // limpeza é BTG-000001); o código aqui serve às recontagens do mesmo
    // produto como existente.
    sku_code: "BTG-000001",
    client_item_code: "CLIENTE-OPEN-001",
    product_name: "Camiseta institucional de teste",
    product_registration: "new",
    category: "VESTUARIO",
    genero: "Masculino",
    grupo: "VESTUÁRIO",
    barcode: "7890000000001",
    brand: "Dutelog Teste",
    size: "M",
    color: "Azul",
    photo_urls: [
      "https://storage.googleapis.com/demo-dute-operations/product-photos/camiseta-institucional.jpg",
    ],
    photo_storage_paths: [
      "customers/BTG_Pactual/product-photos/camiseta-institucional.jpg",
    ],
    location_id: "RUA-A/PRAT-01/CX-001",
    counted_qty: 12,
    unit_cost: 34.9,
    reason: "Inventário físico de abertura",
    reference: "ABERTURA-001",
    occurred_at: "2026-07-22T12:00:00.000Z",
    idempotency_key: "opening-count-1",
    ...overrides,
  };
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

    await assert.rejects(
      createCustomerRequestTransaction(
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
      ),
      /Saldo insuficiente/,
    );

    const pickTaskId = String(approved.pick_task_id);
    const orderId = String(approved.order_id);
    await advance(`picking:${pickTaskId}`, "planned");
    await assert.rejects(
      advance(`picking:${pickTaskId}`, "in_progress"),
      /conferência física/,
    );
    const pickLines = await db
      .collection("pick_lines")
      .where("pick_task_id", "==", pickTaskId)
      .get();
    const picking = (await advance(
      `picking:${pickTaskId}`,
      "in_progress",
      {
        picking_lines: pickLines.docs.map((document) => ({
          pick_line_id: document.id,
          qty_picked: Number(document.data().qty_to_pick),
          status: "confirmed",
        })),
      },
    )) as Record<string, unknown>;
    const packTaskId = String(picking.pack_task_id);
    await advance(`packing:${packTaskId}`, "ready");
    await assert.rejects(
      advance(`packing:${packTaskId}`, "in_progress"),
      /lacre/,
    );
    await assert.rejects(
      advance(`packing:${packTaskId}`, "in_progress", {
        volume_label: "Volume 1",
        seal_code: "LACRE-001",
        package_count: 1,
      }),
      /conferência física/,
    );
    const orderItemsForPacking = await db
      .collection("order_items")
      .where("order_id", "==", orderId)
      .get();
    const packing = (await advance(
      `packing:${packTaskId}`,
      "in_progress",
      {
        volume_label: "Volume 1",
        seal_code: "LACRE-001",
        package_count: 1,
        packing_lines: orderItemsForPacking.docs.map((document) => ({
          order_item_id: document.id,
          qty_packed: Number(
            document.data().picked_qty || document.data().allocated_qty,
          ),
          status: "confirmed",
        })),
      },
    )) as Record<string, unknown>;
    const shipmentId = String(packing.shipment_id);
    await assert.rejects(
      advance(`shipping:${shipmentId}`, "ready_to_dispatch"),
      /responsável pela coleta/,
    );
    await assert.rejects(
      advance(`shipping:${shipmentId}`, "ready_to_dispatch", {
        carrier: "Dutelog",
      }),
      /motorista/,
    );
    await assert.rejects(
      advance(`shipping:${shipmentId}`, "ready_to_dispatch", {
        carrier: "Dutelog",
        driver_name: "Rafael",
      }),
      /placa/,
    );
    await advance(`shipping:${shipmentId}`, "ready_to_dispatch", {
      carrier: "Dutelog",
      driver_name: "Rafael",
      vehicle_plate: "DUTE-001",
    });
    await assert.rejects(
      advance(`shipping:${shipmentId}`, "dispatched"),
      /comprovante de entrega/,
    );
    await assert.rejects(
      advance(`shipping:${shipmentId}`, "dispatched", {
        proof_reference: "PROTOCOLO-ENTREGA-001",
      }),
      /observação de entrega/,
    );
    await advance(`shipping:${shipmentId}`, "dispatched", {
      proof_reference: "PROTOCOLO-ENTREGA-001",
      delivery_notes: "Entregue na loja BTG",
    });

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
    assert.equal(tracking.data()?.seal_code, "LACRE-001");
    assert.equal(tracking.data()?.carrier, "Dutelog");
    assert.equal(tracking.data()?.proof_reference, "PROTOCOLO-ENTREGA-001");
    assert.equal(tracking.data()?.delivery_notes, "Entregue na loja BTG");
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

  it("permite somente uma reserva quando duas aprovações concorrem pelo mesmo saldo", async () => {
    await clearFirestore();
    await db.collection("stock_balances").doc("concurrent-balance").set({
      id: "concurrent-balance",
      customer_code: "BTG Pactual",
      sku_code: "BTG-CONCURRENT-1",
      client_item_code: "ITEM-CONCURRENT-1",
      product_name: "Produto concorrente de teste",
      location_id: "LOC-CONCURRENT",
      qty_on_hand: 5,
      qty_reserved: 0,
      qty_available: 5,
      unit_cost: 10,
    });

    const requestInput = (nonce: string) => ({
      type: "retirada",
      priority: "normal",
      title: `Pedido concorrente ${nonce}`,
      customer_code: "BTG Pactual",
      idempotency_key: nonce,
      items: [{ sku_code: "BTG-CONCURRENT-1", quantity: 5 }],
    });
    const creations = await Promise.allSettled([
      createCustomerRequestTransaction(
        db,
        requestInput("concurrent-request-1"),
        { ...actor, role: "cliente", uid: "client-1" },
      ),
      createCustomerRequestTransaction(
        db,
        requestInput("concurrent-request-2"),
        { ...actor, role: "cliente", uid: "client-1" },
      ),
    ]);
    assert.equal(
      creations.filter((item) => item.status === "fulfilled").length,
      1,
    );
    assert.equal(
      creations.filter((item) => item.status === "rejected").length,
      1,
    );
    const rejected = creations.find((item) => item.status === "rejected");
    assert.match(String(rejected?.reason), /Saldo insuficiente/);
    const successful = creations.find(
      (item): item is PromiseFulfilledResult<Record<string, unknown>> =>
        item.status === "fulfilled",
    );
    assert.ok(successful);
    await decideCustomerRequestTransaction(
      db,
      {
        request_id: String(successful.value.id),
        action: "approve",
        expected_status: "open",
        idempotency_key: "concurrent-approve-winner",
      },
      actor,
    );

    const balance = await db
      .collection("stock_balances")
      .doc("concurrent-balance")
      .get();
    assert.equal(balance.data()?.qty_reserved, 5);
    assert.equal(balance.data()?.qty_available, 0);
    assert.equal((await db.collection("orders").get()).size, 1);
    assert.equal((await db.collection("stock_reservations").get()).size, 1);
  });

  it("somente confirma entrada no estoque ao concluir o recebimento", async () => {
    await clearFirestore();
    await Promise.all([
      db.collection("products").doc("ITEM-1").set({
        id: "ITEM-1",
        customer_code: "BTG Pactual",
        cod_cliente: "ITEM-1",
        produto: "Produto real de teste transacional",
        preco_unit: 12.5,
        status: "active",
      }),
      db.collection("skus").doc("BTG-TEST-1").set({
        id: "BTG-TEST-1",
        customer_code: "BTG Pactual",
        cod_cliente: "ITEM-1",
        cod_btg: "BTG-TEST-1",
        sku_code: "BTG-TEST-1",
        produto: "Produto real de teste transacional",
        preco_unit: 12.5,
        status: "active",
      }),
      db.collection("stock_balances").doc("receiving-balance").set({
        id: "receiving-balance",
        customer_code: "BTG Pactual",
        sku_code: "BTG-TEST-1",
        client_item_code: "ITEM-1",
        product_name: "Produto real de teste transacional",
        location_id: "LOC-A",
        qty_on_hand: 1,
        qty_reserved: 0,
        qty_available: 1,
        unit_cost: 12.5,
      }),
      db.collection("client_inventory").doc("cinv_BTG_Pactual__BTG-TEST-1").set({
        id: "cinv_BTG_Pactual__BTG-TEST-1",
        customer_code: "BTG Pactual",
        sku_code: "BTG-TEST-1",
        client_item_code: "ITEM-1",
        product_name: "Produto real de teste transacional",
        qty_on_hand: 1,
        qty_reserved: 0,
        qty_available: 1,
        unit_cost: 12.5,
        total_cost: 12.5,
      }),
    ]);
    const created = await createCustomerRequestTransaction(
      db,
      {
        type: "recebimento",
        priority: "normal",
        title: "Aviso de fornecedor",
        customer_code: "BTG Pactual",
        supplier: "Fornecedor homologado",
        invoice_number: "NF-CLIENTE-001",
        attachments: [
          {
            file_name: "nota-fiscal.pdf",
            file_url:
              "https://storage.googleapis.com/demo-dute-operations/recebimentos/nota-fiscal.pdf",
            storage_path:
              "customers/BTG_Pactual/recebimentos/nota-fiscal.pdf",
            content_type: "application/pdf",
            size_bytes: 2048,
          },
        ],
        idempotency_key: "request-inbound-1",
        items: [
          {
            sku_code: "BTG-TEST-1",
            client_item_code: "ITEM-1",
            product_name: "Produto real de teste transacional",
            product_registration: "existing",
            category: "VESTUARIO",
            brand: "Marca contratada",
            size: "M",
            color: "Azul",
            unit_cost: 12.5,
            quantity: 2,
          },
        ],
      },
      { ...actor, role: "cliente", uid: "client-1" },
    );
    const requestSnapshot = await db
      .collection("customer_requests")
      .doc(String(created.id))
      .get();
    assert.equal(requestSnapshot.data()?.supplier, "Fornecedor homologado");
    assert.equal(requestSnapshot.data()?.invoice_number, "NF-CLIENTE-001");
    assert.equal(requestSnapshot.data()?.attachment_count, 1);
    assert.equal(requestSnapshot.data()?.attachments?.[0]?.file_name, "nota-fiscal.pdf");

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

    const inboundReceipt = await db
      .collection("inbound_receipts")
      .doc(inboundId)
      .get();
    assert.equal(inboundReceipt.data()?.supplier, "Fornecedor homologado");
    assert.equal(inboundReceipt.data()?.invoice_number, "NF-CLIENTE-001");
    assert.equal(inboundReceipt.data()?.attachment_count, 1);

    const before = await db
      .collection("client_inventory")
      .doc("cinv_BTG_Pactual__BTG-TEST-1")
      .get();
    assert.equal(before.data()?.qty_on_hand, 1);

    await advance(`receiving:${inboundId}`, "created");
    const inboundItems = await db
      .collection("inbound_items")
      .where("receipt_id", "==", inboundId)
      .get();
    assert.equal(inboundItems.size, 1);
    assert.equal(inboundItems.docs[0]?.data().product_registration, "existing");
    assert.equal(inboundItems.docs[0]?.data().category, "VESTUARIO");
    assert.equal(inboundItems.docs[0]?.data().brand, "Marca contratada");
    await updateInboundReceiptConferenceTransaction(
      db,
      {
        receipt_id: inboundId,
        expected_status: "checking",
        idempotency_key: "conference-inbound-1",
        lines: inboundItems.docs.map((document) => ({
          inbound_item_id: document.id,
          received_qty: Number(document.data().expected_qty),
          location_id: "LOC-A",
          unit_cost: 12.5,
        })),
      },
      actor,
    );
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

    // O portal recebe quanto chegou de verdade.
    const portal = await db
      .collection("client_request_status")
      .doc(String(created.id))
      .get();
    assert.equal(portal.data()?.operational_status, "received");
    assert.equal(portal.data()?.qty_expected, 2);
    assert.equal(portal.data()?.qty_received, 2);
    assert.deepEqual(portal.data()?.received_differences, []);
  });

  it("aviso sem código: conferente define o código da etiqueta e só então o estoque entra", async () => {
    await clearFirestore();
    await db.collection("skus").doc("BTG-9").set({
      cod_btg: "BTG-9",
      cod_cliente: "ITEM-9",
      cod_cliente_key: "ITEM-9",
      produto: "CAMISETA ITEM 9",
    });

    const created = await createCustomerRequestTransaction(
      db,
      {
        type: "recebimento",
        priority: "normal",
        title: "Envio de Uniformes Elegância",
        customer_code: "BTG Pactual",
        supplier: "Uniformes Elegância",
        invoice_number: "2471",
        idempotency_key: "request-sem-codigo-1",
        items: [
          { product_name: "BLUSA MOLETOM", product_registration: "unknown", notes: "Código do fornecedor: BAT101", quantity: 8 },
          { product_name: "CALÇA BRIM", product_registration: "unknown", quantity: 20 },
        ],
      },
      { ...actor, role: "cliente", uid: "client-1" },
    );
    const approved = (await decideCustomerRequestTransaction(
      db,
      { request_id: String(created.id), action: "approve", expected_status: "open", idempotency_key: "approve-sem-codigo-1" },
      actor,
    )) as Record<string, unknown>;
    const inboundId = String(approved.inbound_id);
    await advance(`receiving:${inboundId}`, "created");
    const rows = (await db.collection("inbound_items").where("receipt_id", "==", inboundId).get()).docs.sort(
      (a, b) => Number(a.data().line_number) - Number(b.data().line_number),
    );
    assert.equal(rows.length, 2);
    assert.equal(rows[0]?.data().sku_code, undefined);
    assert.equal(rows[0]?.data().notes, "Código do fornecedor: BAT101");

    // Sem código, não conclui nem confere.
    await assert.rejects(advance(`receiving:${inboundId}`, "checking"), /código a definir/);
    await assert.rejects(
      updateInboundReceiptConferenceTransaction(
        db,
        {
          receipt_id: inboundId,
          expected_status: "checking",
          idempotency_key: "conference-sem-codigo-0",
          lines: rows.map((row) => ({ inbound_item_id: row.id, received_qty: Number(row.data().expected_qty) })),
        },
        actor,
      ),
      /código a definir/,
    );

    const conference = await updateInboundReceiptConferenceTransaction(
      db,
      {
        receipt_id: inboundId,
        expected_status: "checking",
        idempotency_key: "conference-sem-codigo-1",
        lines: [
          { inbound_item_id: rows[0]!.id, received_qty: 8, client_item_code: "item-9" },
          { inbound_item_id: rows[1]!.id, received_qty: 20, client_item_code: "novo-77" },
        ],
      },
      actor,
    );
    assert.equal(conference.codes_assigned, 2);
    const [existing, created77] = await Promise.all(rows.map((row) => row.ref.get()));
    assert.equal(existing.data()?.sku_code, "BTG-9");
    assert.equal(existing.data()?.client_item_code, "ITEM-9");
    assert.equal(existing.data()?.product_name, "CAMISETA ITEM 9");
    assert.equal(existing.data()?.product_registration, "existing");
    // Produto novo achado na conferência: SKU gerado na sigla da BTG.
    assert.equal(created77.data()?.sku_code, "BTG-000001");
    assert.equal(created77.data()?.product_registration, "new");
    assert.equal(created77.data()?.code_assigned_by?.uid, "operator-1");
    const assignedEvents = await db.collection("events").where("type", "==", "inbound.item_codes_assigned").get();
    assert.equal(assignedEvents.size, 1);
    assert.equal(assignedEvents.docs[0]?.data().payload?.lines?.length, 2);

    await advance(`receiving:${inboundId}`, "checking");
    const [stock9, stock77] = await Promise.all([
      db.collection("client_inventory").doc("cinv_BTG_Pactual__BTG-9").get(),
      db.collection("client_inventory").doc("cinv_BTG_Pactual__BTG-000001").get(),
    ]);
    assert.equal(stock9.data()?.qty_on_hand, 8);
    assert.equal(stock77.data()?.qty_on_hand, 20);
  });

  it("aviso sem código: o mesmo código novo em duas linhas da conferência ganha um SKU só", async () => {
    await clearFirestore();
    const created = await createCustomerRequestTransaction(
      db,
      {
        type: "recebimento",
        priority: "normal",
        title: "Envio de Uniformes Elegância",
        customer_code: "BTG Pactual",
        supplier: "Uniformes Elegância",
        invoice_number: "2472",
        idempotency_key: "request-sem-codigo-dup",
        items: [
          { product_name: "BLUSA MOLETOM P", product_registration: "unknown", quantity: 8 },
          { product_name: "BLUSA MOLETOM M", product_registration: "unknown", quantity: 6 },
        ],
      },
      { ...actor, role: "cliente", uid: "client-1" },
    );
    const approved = (await decideCustomerRequestTransaction(
      db,
      { request_id: String(created.id), action: "approve", expected_status: "open", idempotency_key: "approve-sem-codigo-dup" },
      actor,
    )) as Record<string, unknown>;
    const inboundId = String(approved.inbound_id);
    await advance(`receiving:${inboundId}`, "created");
    const rows = (await db.collection("inbound_items").where("receipt_id", "==", inboundId).get()).docs;
    // As duas etiquetas trazem o mesmo código.
    await updateInboundReceiptConferenceTransaction(
      db,
      {
        receipt_id: inboundId,
        expected_status: "checking",
        idempotency_key: "conference-sem-codigo-dup",
        lines: rows.map((row) => ({ inbound_item_id: row.id, received_qty: Number(row.data().expected_qty), client_item_code: "moletom-1" })),
      },
      actor,
    );
    const assigned = await Promise.all(rows.map((row) => row.ref.get()));
    assert.deepEqual(assigned.map((row) => row.data()?.sku_code), ["BTG-000001", "BTG-000001"]);
    await advance(`receiving:${inboundId}`, "checking");
    const skus = await db.collection("skus").where("cod_cliente_key", "==", "MOLETOM-1").get();
    assert.deepEqual(skus.docs.map((doc) => [doc.id, doc.data().estoque_atual]), [["BTG-000001", 14]]);
  });

  it("cadastra produto e SKU novos no recebimento avulso sem antecipar o saldo", async () => {
    await clearFirestore();

    const input = {
      customer_code: "BTG Pactual",
      supplier: "Fornecedor de teste",
      invoice_number: "NF-AVULSA-001",
      notes: "Mercadoria entregue sem aviso prévio do cliente.",
      received_at: "2026-07-22T13:00:00.000Z",
      idempotency_key: "unplanned-receipt-new-product-1",
      items: [
        {
          sku_code: " sku-receb-001 ",
          client_item_code: " rec-éxterno-001 ",
          product_name: "Jaqueta institucional recebida",
          product_registration: "new" as const,
          category: "VESTUARIO",
          brand: "Marca de teste",
          size: "G",
          color: "Preto",
          photo_urls: [
            "https://storage.googleapis.com/demo-dute-operations/product-photos/jaqueta-recebida.jpg",
          ],
          photo_storage_paths: [
            "customers/BTG_Pactual/product-photos/jaqueta-recebida.jpg",
          ],
          unit_cost: 89.9,
          quantity: 7,
        },
      ],
    };

    const created = await createInboundReceiptTransaction(db, input, actor);
    const repeated = await createInboundReceiptTransaction(db, input, actor);
    assert.deepEqual(repeated, created);
    assert.equal(created.status, "created");
    assert.equal(created.item_count, 1);
    assert.equal(created.quantity_total, 7);

    const productBeforeConference = await db
      .collection("products")
      .doc("REC-EXTERNO-001")
      .get();
    const skuBeforeConference = await db
      .collection("skus")
      .doc("BTG-000001")
      .get();
    assert.equal(productBeforeConference.exists, true);
    assert.equal(productBeforeConference.data()?.cod_cliente, "REC-EXTERNO-001");
    assert.equal(productBeforeConference.data()?.cod_cliente_key, "REC-EXTERNO-001");
    assert.equal(productBeforeConference.data()?.estoque_btg, 0);
    assert.equal(skuBeforeConference.exists, true);
    assert.equal(skuBeforeConference.data()?.sku_code, "BTG-000001");
    assert.equal(skuBeforeConference.data()?.estoque_atual, 0);
    assert.equal(skuBeforeConference.data()?.estoque_disponivel, 0);
    assert.equal((await db.collection("stock_balances").get()).size, 0);
    assert.equal((await db.collection("client_inventory").get()).size, 0);
    assert.equal((await db.collection("movements").get()).size, 0);

    const receiptId = String(created.receipt_id);
    await advance(`receiving:${receiptId}`, "created");
    const inboundItems = await db
      .collection("inbound_items")
      .where("receipt_id", "==", receiptId)
      .get();
    assert.equal(inboundItems.size, 1);
    assert.equal(inboundItems.docs[0]?.data().sku_code, "BTG-000001");
    assert.equal(
      inboundItems.docs[0]?.data().client_item_code,
      "REC-EXTERNO-001",
    );

    await updateInboundReceiptConferenceTransaction(
      db,
      {
        receipt_id: receiptId,
        expected_status: "checking",
        idempotency_key: "unplanned-receipt-new-product-conference-1",
        lines: [
          {
            inbound_item_id: inboundItems.docs[0]!.id,
            received_qty: 7,
            location_id: "RECEBIMENTO",
            unit_cost: 89.9,
          },
        ],
      },
      actor,
    );

    assert.equal((await db.collection("stock_balances").get()).size, 0);
    assert.equal((await db.collection("client_inventory").get()).size, 0);
    assert.equal((await db.collection("movements").get()).size, 0);
    assert.equal(
      (await db.collection("products").doc("REC-EXTERNO-001").get()).data()
        ?.estoque_btg,
      0,
    );

    await advance(`receiving:${receiptId}`, "checking");

    const balances = await db
      .collection("stock_balances")
      .where("sku_code", "==", "BTG-000001")
      .get();
    const projections = await db
      .collection("client_inventory")
      .where("sku_code", "==", "BTG-000001")
      .get();
    const movements = await db
      .collection("movements")
      .where("receipt_id", "==", receiptId)
      .get();
    const productAfterReceipt = await db
      .collection("products")
      .doc("REC-EXTERNO-001")
      .get();
    const skuAfterReceipt = await db
      .collection("skus")
      .doc("BTG-000001")
      .get();

    assert.equal(balances.size, 1);
    assert.equal(balances.docs[0]?.data().qty_on_hand, 7);
    assert.equal(balances.docs[0]?.data().qty_available, 7);
    assert.equal(balances.docs[0]?.data().unit_cost, undefined);
    assert.equal(await storedUnitPrice(db, "BTG Pactual", "BTG-000001"), 89.9);
    assert.equal(projections.size, 1);
    assert.equal(projections.docs[0]?.data().qty_on_hand, 7);
    assert.equal(projections.docs[0]?.data().qty_available, 7);
    assert.equal(projections.docs[0]?.data().total_cost, undefined);
    assert.equal(movements.size, 1);
    assert.equal(movements.docs[0]?.data().tipo_mov, "ENTRADA");
    assert.equal(movements.docs[0]?.data().source, "wms_receiving");
    assert.equal(productAfterReceipt.data()?.estoque_btg, 7);
    assert.equal(skuAfterReceipt.data()?.estoque_atual, 7);
    assert.equal(skuAfterReceipt.data()?.estoque_disponivel, 7);
    assert.equal((await db.collection("products").get()).size, 1);
    assert.equal((await db.collection("skus").get()).size, 1);
  });
});

describe("inventário de abertura transacional", () => {
  it("cria e retoma uma única sessão a partir do Firestore vazio", async () => {
    await clearFirestore();

    const input = {
      customer_code: "BTG Pactual",
      reference: "INVENTARIO-ABERTURA-2026",
      notes: "Contagem física inicial do galpão.",
      idempotency_key: "opening-session-start-1",
    };
    const created = await createOpeningInventorySessionTransaction(
      db,
      input,
      actor,
    );
    const repeated = await createOpeningInventorySessionTransaction(
      db,
      input,
      actor,
    );
    const resumed = await createOpeningInventorySessionTransaction(
      db,
      {
        ...input,
        idempotency_key: "opening-session-resume-1",
      },
      actor,
    );

    assert.deepEqual(repeated, created);
    assert.equal(created.session_id, openingInventorySessionDocumentId("BTG Pactual"));
    assert.equal(created.status, "open");
    assert.equal(created.resumed, false);
    assert.equal(resumed.session_id, created.session_id);
    assert.equal(resumed.status, "open");
    assert.equal(resumed.resumed, true);
    assert.equal(resumed.line_count, 0);
    assert.equal(resumed.unit_count, 0);

    const sessions = await db.collection("opening_inventory_sessions").get();
    assert.equal(sessions.size, 1);
    assert.equal(sessions.docs[0]?.data().customer_code, "BTG Pactual");
    assert.equal(sessions.docs[0]?.data().reference, "INVENTARIO-ABERTURA-2026");
    assert.equal(sessions.docs[0]?.data().status, "open");

    const startedEvents = await db
      .collection("events")
      .where("type", "==", "inventory.opening_started")
      .get();
    assert.equal(startedEvents.size, 1);

    await assert.rejects(
      completeOpeningInventorySessionTransaction(
        db,
        {
          customer_code: "BTG Pactual",
          session_id: String(created.session_id),
          idempotency_key: "opening-session-empty-complete",
        },
        actor,
      ),
      /ao menos um produto/,
    );
  });

  it("cadastra produto, SKU, saldo e projeções sem duplicar o ledger na reexecução", async () => {
    await clearFirestore();

    const session = await createOpeningInventorySessionTransaction(
      db,
      {
        customer_code: "BTG Pactual",
        reference: "INVENTARIO-ABERTURA-2026",
        idempotency_key: "opening-session-product-test",
      },
      actor,
    );
    const input = openingCountInput(String(session.session_id));
    const created = await recordCycleCountTransaction(db, input, actor);

    const movementBefore = await db
      .collection("movements")
      .doc(String(created.movement_id))
      .get();
    const linesBefore = await db
      .collection("opening_inventory_lines")
      .where("session_id", "==", session.session_id)
      .get();
    const projectionBefore = await db
      .collection("client_inventory")
      .where("sku_code", "==", input.sku_code)
      .get();
    assert.equal(linesBefore.size, 1);
    assert.equal(projectionBefore.size, 1);

    const repeated = await recordCycleCountTransaction(db, input, actor);
    assert.deepEqual(repeated, created);
    assert.equal(created.mode, "opening");
    assert.equal(created.qty_before, 0);
    assert.equal(created.qty_counted, 12);
    assert.equal(created.qty_available, 12);
    assert.equal(created.adjustment_delta, 12);
    assert.equal(created.adjustment_type, "ENTRADA");

    const products = await db
      .collection("products")
      .where("cod_cliente", "==", input.client_item_code)
      .get();
    const skus = await db
      .collection("skus")
      .where("sku_code", "==", input.sku_code)
      .get();
    const balances = await db
      .collection("stock_balances")
      .where("sku_code", "==", input.sku_code)
      .get();
    const movements = await db
      .collection("movements")
      .where("sku_code", "==", input.sku_code)
      .get();
    const lines = await db
      .collection("opening_inventory_lines")
      .where("session_id", "==", session.session_id)
      .get();
    const cycleCounts = await db
      .collection("cycle_counts")
      .where("opening_inventory_session_id", "==", session.session_id)
      .get();
    const projections = await db
      .collection("client_inventory")
      .where("sku_code", "==", input.sku_code)
      .get();

    assert.equal(products.size, 1);
    assert.equal(products.docs[0]?.data().produto, input.product_name);
    assert.equal(products.docs[0]?.data().category, input.category);
    assert.equal(products.docs[0]?.data().genero, input.genero);
    assert.equal(products.docs[0]?.data().grupo, input.grupo);
    assert.equal(products.docs[0]?.data().preco_unit, undefined);
    assert.equal(
      await storedUnitPrice(db, input.customer_code, String(input.sku_code)),
      input.unit_cost,
    );
    assert.deepEqual(products.docs[0]?.data().photo_urls, input.photo_urls);
    assert.equal(products.docs[0]?.data().estoque_btg, input.counted_qty);

    assert.equal(skus.size, 1);
    assert.equal(skus.docs[0]?.data().cod_cliente, input.client_item_code);
    assert.equal(skus.docs[0]?.data().cod_btg, input.sku_code);
    assert.equal(skus.docs[0]?.data().estoque_atual, input.counted_qty);
    assert.equal(skus.docs[0]?.data().estoque_disponivel, input.counted_qty);

    assert.equal(balances.size, 1);
    assert.equal(balances.docs[0]?.data().qty_on_hand, input.counted_qty);
    assert.equal(balances.docs[0]?.data().qty_reserved, 0);
    assert.equal(balances.docs[0]?.data().qty_available, input.counted_qty);
    assert.equal(balances.docs[0]?.data().unit_cost, undefined);
    assert.deepEqual(balances.docs[0]?.data().photo_urls, input.photo_urls);

    assert.equal(movements.size, 1);
    assert.equal(movements.docs[0]?.data().tipo_mov, "ENTRADA");
    assert.equal(movements.docs[0]?.data().quantity, input.counted_qty);
    assert.equal(movements.docs[0]?.data().qty_before, 0);
    assert.equal(movements.docs[0]?.data().qty_after, input.counted_qty);
    assert.equal(
      movements.docs[0]?.data().source,
      "functions_opening_inventory",
    );

    assert.equal(lines.size, 1);
    assert.equal(lines.docs[0]?.data().status, "counted");
    assert.equal(lines.docs[0]?.data().product_registration, "new");
    assert.equal(lines.docs[0]?.data().location_id, input.location_id);
    assert.equal(lines.docs[0]?.data().unit_cost, input.unit_cost);
    assert.deepEqual(lines.docs[0]?.data().photo_urls, input.photo_urls);
    assert.deepEqual(
      lines.docs[0]?.data().photo_storage_paths,
      input.photo_storage_paths,
    );

    assert.equal(cycleCounts.size, 1);
    assert.equal(cycleCounts.docs[0]?.data().mode, "opening");
    assert.equal(cycleCounts.docs[0]?.data().adjustment_delta, 12);

    assert.equal(projections.size, 1);
    assert.equal(projections.docs[0]?.data().qty_on_hand, 12);
    assert.equal(projections.docs[0]?.data().qty_available, 12);
    assert.equal(projections.docs[0]?.data().unit_cost, undefined);
    assert.equal(projections.docs[0]?.data().total_cost, undefined);
    assert.deepEqual(projections.docs[0]?.data().photo_urls, input.photo_urls);

    const persistedSession = await db
      .collection("opening_inventory_sessions")
      .doc(String(session.session_id))
      .get();
    assert.equal(persistedSession.data()?.line_count, 1);
    assert.equal(persistedSession.data()?.unit_count, 12);
    assert.ok(
      Math.abs(Number(persistedSession.data()?.total_cost) - 418.8) < 1e-9,
    );

    const movementAfter = await db
      .collection("movements")
      .doc(String(created.movement_id))
      .get();
    const lineAfter = await db
      .collection("opening_inventory_lines")
      .doc(String(linesBefore.docs[0]?.id))
      .get();
    const projectionAfter = await db
      .collection("client_inventory")
      .doc(String(projectionBefore.docs[0]?.id))
      .get();
    assert.equal(
      movementAfter.updateTime?.toMillis(),
      movementBefore.updateTime?.toMillis(),
    );
    assert.equal(
      lineAfter.updateTime?.toMillis(),
      linesBefore.docs[0]?.updateTime?.toMillis(),
    );
    assert.equal(
      projectionAfter.updateTime?.toMillis(),
      projectionBefore.docs[0]?.updateTime?.toMillis(),
    );
    assert.equal(balances.docs[0]?.data().location_id, input.location_id);
  });

  it("remove uma linha com reversão auditável e permite relançar a contagem", async () => {
    await clearFirestore();

    const session = await createOpeningInventorySessionTransaction(
      db,
      {
        customer_code: "BTG Pactual",
        reference: "INVENTARIO-ABERTURA-CORRECAO",
        idempotency_key: "opening-session-remove-line-test",
      },
      actor,
    );
    const sessionId = String(session.session_id);
    const firstInput = openingCountInput(sessionId, {
      counted_qty: 12,
      unit_cost: 34.9,
      idempotency_key: "opening-count-before-removal",
    });
    const firstCount = await recordCycleCountTransaction(db, firstInput, actor);
    const openingLinesBefore = await db
      .collection("opening_inventory_lines")
      .where("session_id", "==", sessionId)
      .get();
    assert.equal(openingLinesBefore.size, 1);
    const openingLineId = openingLinesBefore.docs[0]!.id;

    const removalInput = {
      customer_code: "BTG Pactual",
      session_id: sessionId,
      opening_line_id: openingLineId,
      idempotency_key: "opening-remove-line-1",
    };
    const removed = await removeOpeningInventoryLineTransaction(
      db,
      removalInput,
      actor,
    );
    const repeatedRemoval = await removeOpeningInventoryLineTransaction(
      db,
      removalInput,
      actor,
    );
    assert.deepEqual(repeatedRemoval, removed);
    assert.equal(removed.status, "removed");
    assert.equal(removed.quantity_removed, 12);

    assert.equal(
      (
        await db
          .collection("opening_inventory_lines")
          .doc(openingLineId)
          .get()
      ).exists,
      false,
    );
    assert.equal((await db.collection("stock_balances").get()).size, 0);
    assert.equal((await db.collection("client_inventory").get()).size, 0);
    assert.equal((await db.collection("products").get()).size, 0);
    assert.equal((await db.collection("skus").get()).size, 0);

    const reversedCount = await db
      .collection("cycle_counts")
      .doc(String(firstCount.cycle_count_id))
      .get();
    assert.equal(reversedCount.data()?.status, "reversed");
    assert.equal(
      reversedCount.data()?.reversal_operation_id,
      String(
        (
          await db
            .collection("operational_operations")
            .where("kind", "==", "inventory.opening_line.remove")
            .limit(1)
            .get()
        ).docs[0]?.id,
      ),
    );

    const movementsAfterRemoval = await db
      .collection("movements")
      .where("sku_code", "==", "BTG-000001")
      .get();
    assert.equal(movementsAfterRemoval.size, 2);
    assert.deepEqual(
      movementsAfterRemoval.docs
        .map((document) => document.data().tipo_mov)
        .sort(),
      ["ENTRADA", "SAIDA"],
    );
    const reversal = movementsAfterRemoval.docs.find(
      (document) =>
        document.data().source === "functions_opening_inventory_reversal",
    );
    assert.ok(reversal);
    assert.equal(reversal.data().quantity, 12);
    assert.equal(
      reversal.data().reversed_movement_id,
      String(firstCount.movement_id),
    );

    const sessionAfterRemoval = await db
      .collection("opening_inventory_sessions")
      .doc(sessionId)
      .get();
    assert.equal(sessionAfterRemoval.data()?.status, "open");
    assert.equal(sessionAfterRemoval.data()?.line_count, 0);
    assert.equal(sessionAfterRemoval.data()?.unit_count, 0);
    assert.ok(Math.abs(Number(sessionAfterRemoval.data()?.total_cost)) < 1e-9);
    assert.equal(
      (
        await db
          .collection("events")
          .where("type", "==", "inventory.opening_line_removed")
          .get()
      ).size,
      1,
    );

    const relaunchedInput = openingCountInput(sessionId, {
      counted_qty: 9,
      unit_cost: 36.5,
      reference: "ABERTURA-001-CORRIGIDA",
      idempotency_key: "opening-count-after-removal",
    });
    const relaunched = await recordCycleCountTransaction(
      db,
      relaunchedInput,
      actor,
    );
    assert.equal(relaunched.qty_counted, 9);
    assert.equal(relaunched.adjustment_delta, 9);
    // Número de SKU não volta: a remoção apagou o cadastro que a linha criou
    // e a recontagem recebe o próximo da sequência da sigla.
    assert.equal(relaunched.sku_code, "BTG-000002");

    const openingLinesAfter = await db
      .collection("opening_inventory_lines")
      .where("session_id", "==", sessionId)
      .get();
    const balancesAfter = await db
      .collection("stock_balances")
      .where("sku_code", "==", "BTG-000002")
      .get();
    const movementsAfterRelaunch = await db.collection("movements").get();
    const sessionAfterRelaunch = await db
      .collection("opening_inventory_sessions")
      .doc(sessionId)
      .get();
    assert.equal(openingLinesAfter.size, 1);
    assert.equal(openingLinesAfter.docs[0]?.data().counted_qty, 9);
    assert.equal(balancesAfter.size, 1);
    assert.equal(balancesAfter.docs[0]?.data().qty_on_hand, 9);
    assert.equal(balancesAfter.docs[0]?.data().qty_available, 9);
    assert.equal(movementsAfterRelaunch.size, 3);
    assert.equal(sessionAfterRelaunch.data()?.line_count, 1);
    assert.equal(sessionAfterRelaunch.data()?.unit_count, 9);
    assert.ok(
      Math.abs(Number(sessionAfterRelaunch.data()?.total_cost) - 328.5) < 1e-9,
    );
  });

  it("bloqueia pedido de saída enquanto o inventário de abertura é obrigatório", async () => {
    await clearFirestore();

    await createOpeningInventorySessionTransaction(
      db,
      {
        customer_code: "BTG Pactual",
        reference: "INVENTARIO-ABERTURA-BLOQUEIO",
        idempotency_key: "opening-session-outbound-block-test",
      },
      actor,
    );
    await db.collection("stock_balances").doc("opening-block-balance").set({
      id: "opening-block-balance",
      customer_code: "BTG Pactual",
      sku_code: "SKU-BLOCK-001",
      client_item_code: "CLIENTE-BLOCK-001",
      product_name: "Produto com saldo ainda não publicado",
      location_id: "RUA-B/PRAT-02/CX-001",
      qty_on_hand: 20,
      qty_reserved: 0,
      qty_available: 20,
      unit_cost: 10,
    });

    await assert.rejects(
      createCustomerRequestTransaction(
        db,
        {
          type: "retirada",
          priority: "normal",
          title: "Pedido antes do fechamento da abertura",
          destination: "Loja BTG",
          customer_code: "BTG Pactual",
          idempotency_key: "outbound-during-opening-required",
          items: [
            {
              sku_code: "SKU-BLOCK-001",
              client_item_code: "CLIENTE-BLOCK-001",
              product_name: "Produto com saldo ainda não publicado",
              quantity: 1,
            },
          ],
        },
        { ...actor, role: "cliente", uid: "client-opening-block" },
      ),
      /inventário de abertura/,
    );

    const inventoryControl = await db
      .collection("system_controls")
      .doc("inventory")
      .get();
    assert.equal(inventoryControl.data()?.stock_initialized, false);
    assert.equal(inventoryControl.data()?.opening_inventory_required, true);
    assert.equal((await db.collection("customer_requests").get()).size, 0);
    assert.equal((await db.collection("orders").get()).size, 0);
    assert.equal((await db.collection("stock_reservations").get()).size, 0);
  });

  it("publica para o portal a trava de saída da abertura, da BTG e de outro cliente", async () => {
    await clearFirestore();
    await db.collection("customers").doc("Itau").set({
      code: "Itaú",
      customer_code: "Itaú",
      name: "Itaú Unibanco",
      sku_prefix: "ITAU",
      status: "active",
    });
    async function outboundBlocked(customer: string) {
      const status = await db.collection("client_portal_status").doc(customer).get();
      return status.data()?.outbound_blocked;
    }

    const btgSession = String(
      (
        await createOpeningInventorySessionTransaction(
          db,
          { customer_code: "BTG Pactual", idempotency_key: "portal-status-btg-start" },
          actor,
        )
      ).session_id,
    );
    const itauSession = String(
      (
        await createOpeningInventorySessionTransaction(
          db,
          { customer_code: "Itaú", idempotency_key: "portal-status-itau-start" },
          actor,
        )
      ).session_id,
    );
    assert.equal(await outboundBlocked("BTG Pactual"), true);
    assert.equal(await outboundBlocked("Itaú"), true);
    const btgStatus = await db.collection("client_portal_status").doc("BTG Pactual").get();
    assert.equal(btgStatus.data()?.customer_code, "BTG Pactual");

    // Sessão aberta antes desta publicação: o documento aparece na próxima contagem.
    await db.collection("client_portal_status").doc("BTG Pactual").delete();
    await db.collection("client_portal_status").doc("Itaú").delete();
    await recordCycleCountTransaction(
      db,
      openingCountInput(btgSession, { idempotency_key: "portal-status-btg-count" }),
      actor,
    );
    await recordCycleCountTransaction(
      db,
      openingCountInput(itauSession, {
        customer_code: "Itaú",
        client_item_code: "7781-02",
        barcode: "7891000000002",
        location_id: "RUA-B/PRAT-01/CX-001",
        idempotency_key: "portal-status-itau-count",
      }),
      actor,
    );
    assert.equal(await outboundBlocked("BTG Pactual"), true);
    assert.equal(await outboundBlocked("Itaú"), true);

    // Concluir a abertura de um cliente não libera o portal do outro.
    await completeOpeningInventorySessionTransaction(
      db,
      { customer_code: "Itaú", session_id: itauSession, idempotency_key: "portal-status-itau-complete" },
      actor,
    );
    assert.equal(await outboundBlocked("Itaú"), false);
    assert.equal(await outboundBlocked("BTG Pactual"), true);

    await completeOpeningInventorySessionTransaction(
      db,
      { customer_code: "BTG Pactual", session_id: btgSession, idempotency_key: "portal-status-btg-complete" },
      actor,
    );
    assert.equal(await outboundBlocked("BTG Pactual"), false);
    assert.equal(await outboundBlocked("Itaú"), false);
  });

  it("normaliza códigos sem diferenciar caixa ou acentos e impede duplicidade", async () => {
    await clearFirestore();

    const session = await createOpeningInventorySessionTransaction(
      db,
      {
        customer_code: "BTG Pactual",
        reference: "INVENTARIO-ABERTURA-NORMALIZACAO",
        idempotency_key: "opening-session-normalization-test",
      },
      actor,
    );
    const sessionId = String(session.session_id);
    await recordCycleCountTransaction(
      db,
      openingCountInput(sessionId, {
        sku_code: " sku-ábc-001 ",
        client_item_code: " cód-clíente-001 ",
        location_id: "RUA-C/PRAT-01/CX-001",
        idempotency_key: "opening-normalized-first-count",
      }),
      actor,
    );

    const product = await db
      .collection("products")
      .doc("COD-CLIENTE-001")
      .get();
    // O SKU de produto novo é gerado; o digitado (" sku-ábc-001 ") é ignorado.
    const sku = await db.collection("skus").doc("BTG-000001").get();
    assert.equal(product.exists, true);
    assert.equal(product.data()?.cod_cliente, "COD-CLIENTE-001");
    assert.equal(product.data()?.cod_cliente_key, "COD-CLIENTE-001");
    assert.equal(sku.exists, true);
    assert.equal(sku.data()?.sku_code, "BTG-000001");
    assert.equal(sku.data()?.sku_code_key, "BTG-000001");

    await assert.rejects(
      recordCycleCountTransaction(
        db,
        openingCountInput(sessionId, {
          sku_code: "SKU-ABC-001",
          client_item_code: "COD-CLIENTE-001",
          location_id: "RUA-C/PRAT-01/CX-002",
          idempotency_key: "opening-normalized-duplicate-count",
        }),
        actor,
      ),
      /já existe/,
    );
    await assert.rejects(
      recordCycleCountTransaction(
        db,
        openingCountInput(sessionId, {
          sku_code: "sku-abc-002",
          client_item_code: "CÓD-CLIENTE-001",
          location_id: "RUA-C/PRAT-01/CX-003",
          product_registration: "existing",
          idempotency_key: "opening-normalized-client-conflict",
        }),
        actor,
      ),
      /já está vinculado ao SKU BTG-000001/,
    );

    assert.equal((await db.collection("products").get()).size, 1);
    assert.equal((await db.collection("skus").get()).size, 1);
    assert.equal((await db.collection("stock_balances").get()).size, 1);
    assert.equal((await db.collection("opening_inventory_lines").get()).size, 1);
    assert.equal((await db.collection("movements").get()).size, 1);
  });

  it("impede códigos duplicados e encerra a sessão de forma idempotente", async () => {
    await clearFirestore();

    const session = await createOpeningInventorySessionTransaction(
      db,
      {
        customer_code: "BTG Pactual",
        reference: "INVENTARIO-ABERTURA-2026",
        idempotency_key: "opening-session-constraints-test",
      },
      actor,
    );
    const sessionId = String(session.session_id);
    const firstInput = openingCountInput(sessionId);
    const firstCount = await recordCycleCountTransaction(db, firstInput, actor);

    await assert.rejects(
      recordCycleCountTransaction(
        db,
        openingCountInput(sessionId, {
          sku_code: "SKU-OPEN-002",
          location_id: "RUA-A/PRAT-01/CX-002",
          idempotency_key: "opening-duplicate-client-code",
        }),
        actor,
      ),
      /já existe/,
    );
    await assert.rejects(
      recordCycleCountTransaction(
        db,
        // SKU digitado só vale para produto existente: este SKU é do
        // CLIENTE-OPEN-001.
        openingCountInput(sessionId, {
          client_item_code: "CLIENTE-OPEN-002",
          product_registration: "existing",
          location_id: "RUA-A/PRAT-01/CX-003",
          idempotency_key: "opening-duplicate-sku-code",
        }),
        actor,
      ),
      /já está vinculado ao Cod\. cliente/,
    );
    await assert.rejects(
      recordCycleCountTransaction(
        db,
        openingCountInput(sessionId, {
          product_registration: "existing",
          idempotency_key: "opening-duplicate-line",
        }),
        actor,
      ),
      /já foi contado neste inventário de abertura/,
    );

    assert.equal((await db.collection("products").get()).size, 1);
    assert.equal((await db.collection("skus").get()).size, 1);
    assert.equal((await db.collection("stock_balances").get()).size, 1);
    assert.equal((await db.collection("movements").get()).size, 1);
    assert.equal((await db.collection("opening_inventory_lines").get()).size, 1);
    assert.equal((await db.collection("client_inventory").get()).size, 1);

    const completeInput = {
      customer_code: "BTG Pactual",
      session_id: sessionId,
      notes: "Inventário físico conferido e encerrado.",
      idempotency_key: "opening-session-complete-1",
    };
    const completed = await completeOpeningInventorySessionTransaction(
      db,
      completeInput,
      actor,
    );
    const repeatedCompletion = await completeOpeningInventorySessionTransaction(
      db,
      completeInput,
      actor,
    );
    assert.deepEqual(repeatedCompletion, completed);
    assert.equal(completed.status, "completed");
    assert.equal(completed.line_count, 1);
    assert.equal(completed.unit_count, 12);
    assert.ok(Math.abs(Number(completed.total_cost) - 418.8) < 1e-9);

    const persistedSession = await db
      .collection("opening_inventory_sessions")
      .doc(sessionId)
      .get();
    assert.equal(persistedSession.data()?.status, "completed");
    assert.equal(
      persistedSession.data()?.completion_notes,
      "Inventário físico conferido e encerrado.",
    );

    const repeatedCount = await recordCycleCountTransaction(
      db,
      firstInput,
      actor,
    );
    assert.deepEqual(repeatedCount, firstCount);
    await assert.rejects(
      createOpeningInventorySessionTransaction(
        db,
        {
          customer_code: "BTG Pactual",
          idempotency_key: "opening-session-after-completion",
        },
        actor,
      ),
      /já foi concluído/,
    );
    await assert.rejects(
      recordCycleCountTransaction(
        db,
        openingCountInput(sessionId, {
          sku_code: "SKU-OPEN-003",
          client_item_code: "CLIENTE-OPEN-003",
          location_id: "RUA-A/PRAT-01/CX-004",
          idempotency_key: "opening-count-after-completion",
        }),
        actor,
      ),
      /não está ativo/,
    );

    assert.equal((await db.collection("opening_inventory_sessions").get()).size, 1);
    assert.equal((await db.collection("opening_inventory_lines").get()).size, 1);
    assert.equal((await db.collection("movements").get()).size, 1);
    assert.equal((await db.collection("client_inventory").get()).size, 1);
    assert.equal((await db.collection("operational_operations").get()).size, 3);

    const completedEvents = await db
      .collection("events")
      .where("type", "==", "inventory.opening_completed")
      .get();
    assert.equal(completedEvents.size, 1);
  });
});

describe("ledger manual e congelamento", () => {
  it("registra inventário cíclico transacional sem romper reservas", async () => {
    await clearFirestore();
    await db.collection("stock_balances").doc("cycle-balance").set({
      id: "cycle-balance",
      customer_code: "BTG Pactual",
      sku_code: "BTG-CYCLE-1",
      client_item_code: "ITEM-CYCLE-1",
      product_name: "Produto de teste inventário cíclico",
      category: "TESTE",
      location_id: "LOC-CYCLE",
      qty_on_hand: 10,
      qty_reserved: 2,
      qty_available: 8,
      unit_cost: 7,
    });
    await db
      .collection("client_inventory")
      .doc("cinv_BTG_Pactual__BTG-CYCLE-1")
      .set({
        id: "cinv_BTG_Pactual__BTG-CYCLE-1",
        customer_code: "BTG Pactual",
        sku_code: "BTG-CYCLE-1",
        client_item_code: "ITEM-CYCLE-1",
        product_name: "Produto de teste inventário cíclico",
        category: "TESTE",
        qty_on_hand: 10,
        qty_reserved: 2,
        qty_available: 8,
        unit_cost: 7,
        total_cost: 70,
      });

    await assert.rejects(
      recordCycleCountTransaction(
        db,
        {
          customer_code: "BTG Pactual",
          sku_code: "BTG-CYCLE-1",
          client_item_code: "ITEM-CYCLE-1",
          product_name: "Produto de teste inventário cíclico",
          category: "TESTE",
          location_id: "LOC-CYCLE",
          counted_qty: 1,
          unit_cost: 7,
          reason: "Teste de bloqueio por reserva ativa",
          idempotency_key: "cycle-count-reserved-block",
        },
        actor,
      ),
      /menor que a reserva ativa/,
    );

    const input = {
      customer_code: "BTG Pactual",
      sku_code: "BTG-CYCLE-1",
      client_item_code: "ITEM-CYCLE-1",
      product_name: "Produto de teste inventário cíclico",
      category: "TESTE",
      location_id: "LOC-CYCLE",
      counted_qty: 8,
      unit_cost: 7,
      reason: "Contagem cíclica da rua de teste",
      reference: "AUD-001",
      idempotency_key: "cycle-count-valid-1",
    };
    const created = await recordCycleCountTransaction(db, input, actor);
    const repeated = await recordCycleCountTransaction(db, input, actor);
    assert.deepEqual(repeated, created);
    assert.equal(created.adjustment_delta, -2);
    assert.equal(created.adjustment_type, "SAIDA");

    const balance = await db.collection("stock_balances").doc("cycle-balance").get();
    assert.equal(balance.data()?.qty_on_hand, 8);
    assert.equal(balance.data()?.qty_reserved, 2);
    assert.equal(balance.data()?.qty_available, 6);

    const projection = await db
      .collection("client_inventory")
      .doc("cinv_BTG_Pactual__BTG-CYCLE-1")
      .get();
    assert.equal(projection.data()?.qty_on_hand, 8);
    assert.equal(projection.data()?.qty_reserved, 2);
    assert.equal(projection.data()?.qty_available, 6);

    const movements = await db
      .collection("movements")
      .where("sku_code", "==", "BTG-CYCLE-1")
      .get();
    assert.equal(movements.size, 1);
    assert.equal(movements.docs[0]?.data().tipo_mov, "SAIDA");
    assert.equal(movements.docs[0]?.data().source, "functions_cycle_count");

    const counts = await db
      .collection("cycle_counts")
      .where("sku_code", "==", "BTG-CYCLE-1")
      .get();
    assert.equal(counts.size, 1);
    assert.equal(counts.docs[0]?.data().adjustment_delta, -2);

    const events = await db
      .collection("events")
      .where("type", "==", "inventory.adjusted")
      .get();
    assert.equal(events.size, 1);
  });

  it("a contagem cíclica espera a entrega do que já foi separado na posição", async () => {
    await clearFirestore();
    // 10 no saldo, 3 separados para um pedido: na prateleira ficaram 7.
    await db.collection("stock_balances").doc("cycle-balance").set({
      id: "cycle-balance",
      customer_code: "BTG Pactual",
      sku_code: "BTG-CYCLE-1",
      client_item_code: "ITEM-CYCLE-1",
      product_name: "Produto de teste inventário cíclico",
      location_id: "LOC-CYCLE",
      qty_on_hand: 10,
      qty_reserved: 3,
      qty_available: 7,
      unit_cost: 7,
    });
    await db.collection("stock_reservations").doc("res_ped_01").set({
      id: "res_ped_01",
      customer_code: "BTG Pactual",
      sku_code: "BTG-CYCLE-1",
      location_id: "LOC-CYCLE",
      order_number: "PED-000042",
      reserved_qty: 3,
      status: "picked",
    });
    const contagem = (counted_qty: number, idempotency_key: string) =>
      recordCycleCountTransaction(
        db,
        {
          customer_code: "BTG Pactual",
          sku_code: "BTG-CYCLE-1",
          client_item_code: "ITEM-CYCLE-1",
          location_id: "LOC-CYCLE",
          counted_qty,
          unit_cost: 7,
          reason: "Contagem da prateleira",
          idempotency_key,
        },
        actor,
      );
    // Contar os 7 da prateleira baixaria os 3 agora e de novo na entrega.
    await assert.rejects(contagem(7, "cycle-picked-1"), /BTG-CYCLE-1 no local LOC-CYCLE tem itens separados esperando a entrega \(pedido PED-000042\)\. Conte depois da entrega\./);
    const intacto = (await db.collection("stock_balances").doc("cycle-balance").get()).data();
    assert.deepEqual([intacto?.qty_on_hand, intacto?.qty_reserved], [10, 3]);
    assert.equal((await db.collection("movements").where("sku_code", "==", "BTG-CYCLE-1").get()).size, 0);

    // Só reservado, o item continua na prateleira: a contagem vale.
    await db.collection("stock_reservations").doc("res_ped_01").update({ status: "reserved" });
    assert.equal((await contagem(9, "cycle-picked-2")).adjustment_delta, -1);
  });

  it("registra devolução e só lança estoque após disposição disponível", async () => {
    await clearFirestore();
    await db.collection("products").doc("ITEM-RETURN-1").set({
      id: "ITEM-RETURN-1",
      customer_code: "BTG Pactual",
      cod_cliente: "ITEM-RETURN-1",
      produto: "Produto de teste devolução",
      preco_unit: 12,
      status: "active",
    });
    await db.collection("skus").doc("BTG-RETURN-1").set({
      id: "BTG-RETURN-1",
      customer_code: "BTG Pactual",
      cod_cliente: "ITEM-RETURN-1",
      cod_btg: "BTG-RETURN-1",
      sku_code: "BTG-RETURN-1",
      produto: "Produto de teste devolução",
      preco_unit: 12,
      status: "active",
    });

    await assert.rejects(
      createReturnReceiptTransaction(
        db,
        {
          customer_code: "BTG Pactual",
          source: "Loja BTG",
          reference: "RET-BLOCK",
          idempotency_key: "return-unknown-product",
          items: [
            {
              sku_code: "BTG-UNKNOWN",
              client_item_code: "ITEM-UNKNOWN",
              product_name: "Produto inexistente",
              quantity: 1,
            },
          ],
        },
        actor,
      ),
      /não existe no cadastro/,
    );

    const input = {
      customer_code: "BTG Pactual",
      source: "Loja BTG",
      reference: "RET-001",
      notes: "Retorno da loja física",
      idempotency_key: "return-create-valid-1",
      items: [
        {
          sku_code: "BTG-RETURN-1",
          client_item_code: "ITEM-RETURN-1",
          product_name: "Produto de teste devolução",
          quantity: 3,
          unit_cost: 12,
        },
      ],
    };
    const created = await createReturnReceiptTransaction(db, input, actor);
    const repeated = await createReturnReceiptTransaction(db, input, actor);
    assert.deepEqual(repeated, created);
    assert.equal(created.qty_total, 3);
    const returnItemIds = created.return_item_ids as string[] | undefined;
    const itemId = String(returnItemIds?.[0] ?? "");
    assert.ok(itemId);

    const movementsBefore = await db.collection("movements").get();
    assert.equal(movementsBefore.size, 0);
    const balancesBefore = await db.collection("stock_balances").get();
    assert.equal(balancesBefore.size, 0);

    const dispositionInput = {
      return_item_id: itemId,
      disposition: "available" as const,
      location_id: "DEVOLUCAO",
      unit_cost: 12,
      notes: "Produto íntegro voltou ao saldo.",
      expected_status: "pending_disposition",
      idempotency_key: "return-disposition-valid-1",
    };
    const disposition = await setReturnDispositionTransaction(
      db,
      dispositionInput,
      actor,
    );
    const repeatedDisposition = await setReturnDispositionTransaction(
      db,
      dispositionInput,
      actor,
    );
    assert.deepEqual(repeatedDisposition, disposition);
    assert.equal(disposition.disposition, "available");
    assert.equal(disposition.return_status, "completed");
    assert.equal(disposition.qty_pending_disposition, 0);

    const completedReturn = await db
      .collection("returns")
      .doc(String(created.return_id))
      .get();
    assert.equal(completedReturn.data()?.status, "completed");
    assert.equal(completedReturn.data()?.qty_pending_disposition, 0);

    const balances = await db
      .collection("stock_balances")
      .where("sku_code", "==", "BTG-RETURN-1")
      .get();
    assert.equal(balances.size, 1);
    assert.equal(balances.docs[0]?.data().qty_on_hand, 3);
    assert.equal(balances.docs[0]?.data().qty_available, 3);

    const projection = await db
      .collection("client_inventory")
      .doc("cinv_BTG_Pactual__BTG-RETURN-1")
      .get();
    assert.equal(projection.data()?.qty_on_hand, 3);
    assert.equal(projection.data()?.total_cost, undefined);
    assert.equal(await storedUnitPrice(db, "BTG Pactual", "BTG-RETURN-1"), 12);

    const movements = await db
      .collection("movements")
      .where("sku_code", "==", "BTG-RETURN-1")
      .get();
    assert.equal(movements.size, 1);
    assert.equal(movements.docs[0]?.data().tipo_mov, "ENTRADA");
    assert.equal(
      movements.docs[0]?.data().source,
      "functions_return_disposition",
    );

    await assert.rejects(
      setReturnDispositionTransaction(
        db,
        {
          ...dispositionInput,
          idempotency_key: "return-disposition-blocked-second",
        },
        actor,
      ),
      /já possui disposição/,
    );

    const damagedReturn = await createReturnReceiptTransaction(
      db,
      {
        customer_code: "BTG Pactual",
        source: "Loja BTG",
        reference: "RET-AVARIA-001",
        idempotency_key: "return-create-damaged-1",
        items: [
          {
            sku_code: "BTG-RETURN-1",
            client_item_code: "ITEM-RETURN-1",
            product_name: "Produto de teste devolução",
            quantity: 1,
            unit_cost: 12,
          },
        ],
      },
      actor,
    );
    const damagedItemId = String(
      (damagedReturn.return_item_ids as string[] | undefined)?.[0] ?? "",
    );
    assert.ok(damagedItemId);

    await assert.rejects(
      setReturnDispositionTransaction(
        db,
        {
          return_item_id: damagedItemId,
          disposition: "damaged",
          expected_status: "pending_disposition",
          idempotency_key: "return-disposition-damaged-no-notes",
        },
        actor,
      ),
      /nota da triagem/,
    );

    const damagedDisposition = await setReturnDispositionTransaction(
      db,
      {
        return_item_id: damagedItemId,
        disposition: "damaged",
        notes: "Peça retornou com avaria visível na conferência.",
        expected_status: "pending_disposition",
        idempotency_key: "return-disposition-damaged-valid",
      },
      actor,
    );
    assert.equal(damagedDisposition.return_status, "completed");
    assert.equal(damagedDisposition.movement_id, undefined);

    const movementsAfterDamaged = await db
      .collection("movements")
      .where("sku_code", "==", "BTG-RETURN-1")
      .get();
    assert.equal(movementsAfterDamaged.size, 1);
  });

  it("é idempotente e bloqueia novas mutações durante reconciliação", async () => {
    await clearFirestore();
    await db.collection("stock_balances").doc("manual-balance").set({
      id: "manual-balance",
      customer_code: "BTG Pactual",
      sku_code: "BTG-MANUAL-1",
      client_item_code: "ITEM-MANUAL-1",
      product_name: "Produto de teste do ledger",
      location_id: "LOC-MANUAL",
      qty_on_hand: 5,
      qty_reserved: 0,
      qty_available: 5,
      unit_cost: 10,
    });
    await db.collection("skus").doc("BTG-MANUAL-1").set({
      id: "BTG-MANUAL-1",
      customer_code: "BTG Pactual",
      cod_btg: "BTG-MANUAL-1",
      sku_code: "BTG-MANUAL-1",
      sku_code_key: "BTG-MANUAL-1",
      estoque_atual: 5,
    });

    const input = {
      type: "ENTRADA" as const,
      quantity: 2,
      customer_code: "BTG Pactual",
      sku_code: "BTG-MANUAL-1",
      client_item_code: "ITEM-MANUAL-1",
      product_name: "Produto de teste do ledger",
      location_id: "LOC-MANUAL",
      unit_cost: 10,
      reason: "Ajuste após contagem física",
      idempotency_key: "manual-entry-1",
    };
    const created = await createInventoryMovementTransaction(db, input, actor);
    const repeated = await createInventoryMovementTransaction(db, input, actor);
    assert.deepEqual(repeated, created);

    const balance = await db
      .collection("stock_balances")
      .doc("manual-balance")
      .get();
    assert.equal(balance.data()?.qty_on_hand, 7);
    const ledger = await db
      .collection("movements")
      .where("sku_code", "==", "BTG-MANUAL-1")
      .get();
    assert.equal(ledger.size, 1);

    await db.collection("system_controls").doc("inventory").set({
      movements_frozen: true,
      imports_frozen: true,
      reconciliation_status: "running",
      reconciliation_id: "reconcile-test",
    });
    await assert.rejects(
      createInventoryMovementTransaction(
        db,
        { ...input, idempotency_key: "manual-entry-2" },
        actor,
      ),
      /temporariamente bloqueadas/,
    );
  });

  it("só movimenta item do cadastro do cliente: nem o de outro cliente, nem SKU fora do cadastro", async () => {
    await clearFirestore();
    await db.collection("skus").doc("ITAU-000001").set({
      id: "ITAU-000001",
      customer_code: "Itaú",
      cod_btg: "ITAU-000001",
      sku_code: "ITAU-000001",
      sku_code_key: "ITAU-000001",
      estoque_atual: 0,
    });
    const entrada = {
      type: "ENTRADA" as const,
      quantity: 3,
      customer_code: "BTG Pactual",
      sku_code: "ITAU-000001",
      location_id: "A-01-02",
      reason: "Ajuste após contagem física",
      idempotency_key: "manual-owner-1",
    };

    await assert.rejects(
      createInventoryMovementTransaction(db, entrada, actor),
      /O SKU ITAU-000001 já está cadastrado para o cliente Itaú/,
    );
    await assert.rejects(
      createInventoryMovementTransaction(
        db,
        { ...entrada, sku_code: "BTG-999999", idempotency_key: "manual-owner-2" },
        actor,
      ),
      /O SKU BTG-999999 não está no cadastro/,
    );
    const semEscrita = await Promise.all(
      ["stock_balances", "movements", "events"].map((name) => db.collection(name).get()),
    );
    assert.deepEqual(semEscrita.map((snapshot) => snapshot.size), [0, 0, 0]);
    assert.equal((await db.collection("skus").doc("ITAU-000001").get()).data()?.estoque_atual, 0);

    const doCliente = await createInventoryMovementTransaction(
      db,
      { ...entrada, customer_code: "Itaú", idempotency_key: "manual-owner-3" },
      actor,
    );
    assert.equal(doCliente.qty_after, 3);
    const saldo = await db.collection("stock_balances").doc(String(doCliente.stock_balance_id)).get();
    assert.equal(saldo.data()?.customer_code, "Itaú");
  });
});

describe("integridade de reservas e agregados de catálogo", () => {
  it("pedir e recusar não zeram o valor da mercadoria do SKU", async () => {
    await db.collection("system_controls").doc("inventory").delete();
    const precoRef = db.collection("catalog_prices").doc(catalogPriceId("BTG Pactual", "SKU-VALOR-1"));
    // O saldo como as callables gravam, sem custo; o valor fica em catalog_prices.
    await Promise.all([
      db.collection("stock_balances").doc("balance-valor").set({
        id: "balance-valor",
        customer_code: "BTG Pactual",
        sku_code: "SKU-VALOR-1",
        client_item_code: "ITEM-VALOR-1",
        product_name: "Produto de teste do valor",
        location_id: "LOC-VALOR",
        qty_on_hand: 10,
        qty_reserved: 0,
        qty_available: 10,
      }),
      precoRef.set({ id: precoRef.id, customer_code: "BTG Pactual", sku_code: "SKU-VALOR-1", item_code: "ITEM-VALOR-1", preco_unit: 25, total_cost: 250 }),
    ]);
    // O pedido do portal não leva custo.
    const created = await createCustomerRequestTransaction(
      db,
      {
        type: "retirada",
        priority: "normal",
        title: "Pedido sem custo",
        customer_code: "BTG Pactual",
        idempotency_key: "request-valor-1",
        items: [{ sku_code: "SKU-VALOR-1", client_item_code: "ITEM-VALOR-1", product_name: "Produto de teste do valor", quantity: 4 }],
      },
      { ...actor, role: "cliente", uid: "client-1" },
    );
    assert.deepEqual([(await precoRef.get()).data()?.preco_unit, (await precoRef.get()).data()?.total_cost], [25, 250]);
    await decideCustomerRequestTransaction(
      db,
      { request_id: String(created.id), action: "reject", expected_status: "open", reason: "Teste do valor", idempotency_key: "reject-valor-1" },
      actor,
    );
    assert.deepEqual([(await precoRef.get()).data()?.preco_unit, (await precoRef.get()).data()?.total_cost], [25, 250]);
  });

  it("o custo mandado no pedido de saída não muda o preço do SKU, base do ad valorem", async () => {
    await db.collection("system_controls").doc("inventory").delete();
    const precoRef = db.collection("catalog_prices").doc(catalogPriceId("BTG Pactual", "SKU-VALOR-2"));
    await Promise.all([
      db.collection("stock_balances").doc("balance-valor-2").set({
        id: "balance-valor-2",
        customer_code: "BTG Pactual",
        sku_code: "SKU-VALOR-2",
        client_item_code: "ITEM-VALOR-2",
        product_name: "Produto de teste do custo",
        location_id: "LOC-VALOR-2",
        qty_on_hand: 10,
        qty_reserved: 0,
        qty_available: 10,
      }),
      precoRef.set({ id: precoRef.id, customer_code: "BTG Pactual", sku_code: "SKU-VALOR-2", item_code: "ITEM-VALOR-2", preco_unit: 25, total_cost: 250 }),
    ]);
    const cliente = { ...actor, role: "cliente", uid: "client-custo" };
    const pedido = (chave: string) => ({
      type: "retirada",
      priority: "normal",
      title: "Pedido com custo",
      customer_code: "BTG Pactual",
      idempotency_key: chave,
      items: [{ sku_code: "SKU-VALOR-2", client_item_code: "ITEM-VALOR-2", product_name: "Produto de teste do custo", unit_cost: 0.01, quantity: 2 }],
    });
    const preco = async () => {
      const dados = (await precoRef.get()).data();
      return [dados?.preco_unit, dados?.total_cost];
    };

    // A criação, e a recusa, que libera a reserva.
    const recusado = await createCustomerRequestTransaction(db, pedido("request-custo-1"), cliente);
    assert.deepEqual(await preco(), [25, 250]);
    await decideCustomerRequestTransaction(
      db,
      { request_id: String(recusado.id), action: "reject", expected_status: "open", reason: "Teste do custo", idempotency_key: "reject-custo-1" },
      actor,
    );
    assert.deepEqual(await preco(), [25, 250]);

    // A aprovação e a entrega.
    const criado = await createCustomerRequestTransaction(db, pedido("request-custo-2"), cliente);
    const aprovado = (await decideCustomerRequestTransaction(
      db,
      { request_id: String(criado.id), action: "approve", expected_status: "open", idempotency_key: "approve-custo-2" },
      actor,
    )) as Record<string, unknown>;
    assert.deepEqual(await preco(), [25, 250]);
    const pickTaskId = String(aprovado.pick_task_id);
    await advance(`picking:${pickTaskId}`, "planned");
    const pickLines = await db.collection("pick_lines").where("pick_task_id", "==", pickTaskId).get();
    const picking = (await advance(`picking:${pickTaskId}`, "in_progress", {
      picking_lines: pickLines.docs.map((document) => ({ pick_line_id: document.id, qty_picked: Number(document.data().qty_to_pick), status: "confirmed" })),
    })) as Record<string, unknown>;
    const packTaskId = String(picking.pack_task_id);
    await advance(`packing:${packTaskId}`, "ready");
    const orderItems = await db.collection("order_items").where("order_id", "==", String(aprovado.order_id)).get();
    const packing = (await advance(`packing:${packTaskId}`, "in_progress", {
      volume_label: "Volume 1",
      seal_code: "LACRE-CUSTO",
      package_count: 1,
      packing_lines: orderItems.docs.map((document) => ({ order_item_id: document.id, qty_packed: Number(document.data().allocated_qty), status: "confirmed" })),
    })) as Record<string, unknown>;
    const shipmentId = String(packing.shipment_id);
    await advance(`shipping:${shipmentId}`, "ready_to_dispatch", { carrier: "Dutelog", driver_name: "Rafael", vehicle_plate: "DUTE-002" });
    await advance(`shipping:${shipmentId}`, "dispatched", { proof_reference: "PROTOCOLO-CUSTO", delivery_notes: "Entregue" });
    const saldo = await db.collection("stock_balances").doc("balance-valor-2").get();
    assert.equal(saldo.data()?.qty_on_hand, 8);
    assert.deepEqual(await preco(), [25, 250]);
  });

  it("rejeitar solicitação de retirada libera a reserva e restaura o estoque", async () => {
    await db.collection("system_controls").doc("inventory").delete();
    await Promise.all([
      db.collection("stock_balances").doc("balance-rej").set({
        id: "balance-rej",
        customer_code: "BTG Pactual",
        sku_code: "SKU-REJ-1",
        client_item_code: "ITEM-REJ-1",
        product_name: "Produto de teste de rejeição",
        location_id: "LOC-REJ",
        qty_on_hand: 8,
        qty_reserved: 0,
        qty_available: 8,
        unit_cost: 10,
      }),
      db.collection("skus").doc("SKU-REJ-1").set({
        id: "SKU-REJ-1",
        cod_btg: "SKU-REJ-1",
        sku_code: "SKU-REJ-1",
        sku_code_key: "SKU-REJ-1",
        cod_cliente: "ITEM-REJ-1",
        cod_cliente_key: "ITEM-REJ-1",
        estoque_atual: 8,
        estoque_reservado: 0,
        estoque_disponivel: 8,
        custo_total: 80,
      }),
      db.collection("products").doc("ITEM-REJ-1").set({
        id: "ITEM-REJ-1",
        cod_cliente: "ITEM-REJ-1",
        cod_cliente_key: "ITEM-REJ-1",
        estoque_btg: 8,
        custo_total: 80,
      }),
    ]);

    const created = await createCustomerRequestTransaction(
      db,
      {
        type: "retirada",
        priority: "normal",
        title: "Retirada que será rejeitada",
        customer_code: "BTG Pactual",
        idempotency_key: "request-reject-1",
        items: [
          {
            sku_code: "SKU-REJ-1",
            client_item_code: "ITEM-REJ-1",
            product_name: "Produto de teste de rejeição",
            unit_cost: 10,
            quantity: 5,
          },
        ],
      },
      { ...actor, role: "cliente", uid: "client-rej" },
    );
    const requestId = String(created.id);

    const reservedBalance = await db
      .collection("stock_balances")
      .doc("balance-rej")
      .get();
    assert.equal(reservedBalance.data()?.qty_reserved, 5);
    assert.equal(reservedBalance.data()?.qty_available, 3);
    const reservedSku = await db.collection("skus").doc("SKU-REJ-1").get();
    assert.equal(reservedSku.data()?.estoque_reservado, 5);
    assert.equal(reservedSku.data()?.estoque_disponivel, 3);

    const rejected = (await decideCustomerRequestTransaction(
      db,
      {
        request_id: requestId,
        action: "reject",
        reason: "Sem janela de expedição",
        expected_status: "open",
        idempotency_key: "reject-outbound-1",
      },
      actor,
    )) as Record<string, unknown>;
    assert.equal(rejected.status, "rejected");

    const balanceAfter = await db
      .collection("stock_balances")
      .doc("balance-rej")
      .get();
    assert.equal(balanceAfter.data()?.qty_reserved, 0);
    assert.equal(balanceAfter.data()?.qty_available, 8);

    const reservations = await db
      .collection("stock_reservations")
      .where("customer_request_id", "==", requestId)
      .get();
    assert.ok(reservations.size > 0);
    for (const document of reservations.docs) {
      assert.equal(document.data().status, "released");
    }

    const requestAfter = await db
      .collection("customer_requests")
      .doc(requestId)
      .get();
    assert.equal(requestAfter.data()?.stock_reservation_status, "released");

    const projection = await db
      .collection("client_inventory")
      .where("customer_code", "==", "BTG Pactual")
      .where("sku_code", "==", "SKU-REJ-1")
      .get();
    assert.equal(projection.size, 1);
    assert.equal(projection.docs[0].data().qty_reserved, 0);
    assert.equal(projection.docs[0].data().qty_available, 8);

    const skuAfter = await db.collection("skus").doc("SKU-REJ-1").get();
    assert.equal(skuAfter.data()?.estoque_reservado, 0);
    assert.equal(skuAfter.data()?.estoque_disponivel, 8);

    // O estoque liberado precisa estar utilizável de novo: uma nova
    // retirada pelo total volta a reservar sem erro de saldo.
    const recreated = await createCustomerRequestTransaction(
      db,
      {
        type: "retirada",
        priority: "normal",
        title: "Retirada total após liberação",
        customer_code: "BTG Pactual",
        idempotency_key: "request-reject-2",
        items: [
          {
            sku_code: "SKU-REJ-1",
            client_item_code: "ITEM-REJ-1",
            product_name: "Produto de teste de rejeição",
            unit_cost: 10,
            quantity: 8,
          },
        ],
      },
      { ...actor, role: "cliente", uid: "client-rej" },
    );
    assert.equal(recreated.reserved_quantity, 8);
  });

  it("decidir a solicitação fecha os avisos dela e não abre avisos novos na caixa do agente", async () => {
    await db.collection("system_controls").doc("inventory").delete();
    await Promise.all([
      db.collection("stock_balances").doc("balance-inbox").set({
        id: "balance-inbox",
        customer_code: "BTG Pactual",
        sku_code: "SKU-INBOX-1",
        client_item_code: "ITEM-INBOX-1",
        product_name: "Produto de teste da caixa do agente",
        location_id: "LOC-INBOX",
        qty_on_hand: 10,
        qty_reserved: 0,
        qty_available: 10,
        unit_cost: 10,
      }),
      db.collection("skus").doc("SKU-INBOX-1").set({
        id: "SKU-INBOX-1",
        cod_btg: "SKU-INBOX-1",
        sku_code: "SKU-INBOX-1",
        sku_code_key: "SKU-INBOX-1",
        cod_cliente: "ITEM-INBOX-1",
        cod_cliente_key: "ITEM-INBOX-1",
        estoque_atual: 10,
        estoque_reservado: 0,
        estoque_disponivel: 10,
        custo_total: 100,
      }),
      db.collection("products").doc("ITEM-INBOX-1").set({
        id: "ITEM-INBOX-1",
        cod_cliente: "ITEM-INBOX-1",
        cod_cliente_key: "ITEM-INBOX-1",
        estoque_btg: 10,
        custo_total: 100,
      }),
    ]);
    const openInbox = async () =>
      (
        await db
          .collection("ai_agent_inbox")
          .where("status", "==", "open")
          .get()
      ).docs.map((doc) => doc.data());
    const baseline = (await openInbox()).length;
    const client = { ...actor, role: "cliente" as const, uid: "client-inbox" };

    // Retirada (reserva na criação → aviso de atenção) aprovada pela triagem.
    const outbound = await createCustomerRequestTransaction(
      db,
      {
        type: "retirada",
        priority: "normal",
        title: "Retirada que será aprovada",
        customer_code: "BTG Pactual",
        idempotency_key: "request-inbox-outbound",
        items: [
          {
            sku_code: "SKU-INBOX-1",
            client_item_code: "ITEM-INBOX-1",
            product_name: "Produto de teste da caixa do agente",
            unit_cost: 10,
            quantity: 4,
          },
        ],
      },
      client,
    );
    const outboundId = String(outbound.id);
    const outboundNotices = (await openInbox()).filter(
      (item) => item.entity_id === outboundId,
    );
    assert.equal(outboundNotices.length, 1);

    // Recebimento urgente (também vira aviso) rejeitado pela triagem.
    const inbound = await createCustomerRequestTransaction(
      db,
      {
        type: "recebimento",
        priority: "urgente",
        title: "Recebimento que será rejeitado",
        customer_code: "BTG Pactual",
        idempotency_key: "request-inbox-inbound",
        items: [
          {
            sku_code: "SKU-INBOX-1",
            client_item_code: "ITEM-INBOX-1",
            product_name: "Produto de teste da caixa do agente",
            unit_cost: 10,
            quantity: 2,
          },
        ],
      },
      client,
    );
    const inboundId = String(inbound.id);
    assert.equal((await openInbox()).length, baseline + 2);

    await decideCustomerRequestTransaction(
      db,
      {
        request_id: outboundId,
        action: "approve",
        expected_status: "open",
        idempotency_key: "approve-inbox-outbound",
      },
      actor,
    );
    await decideCustomerRequestTransaction(
      db,
      {
        request_id: inboundId,
        action: "reject",
        reason: "Sem nota fiscal",
        expected_status: "open",
        idempotency_key: "reject-inbox-inbound",
      },
      actor,
    );

    // Nada da decisão fica pendurado: os avisos de criação fecharam e a
    // aprovação (pedido, reserva, picking) não abriu avisos novos.
    assert.equal((await openInbox()).length, baseline);

    const resolved = await db
      .collection("ai_agent_inbox")
      .doc(outboundNotices[0].id as string)
      .get();
    assert.equal(resolved.data()?.status, "resolved");
    assert.equal(resolved.data()?.resolution, "customer_request.approved");
    assert.equal(resolved.data()?.resolved_by?.uid, actor.uid);

    // Os eventos da decisão continuam no ledger de auditoria.
    const decisionEvents = await db
      .collection("events")
      .where("entity_id", "==", outboundId)
      .where("type", "==", "customer_request.approved")
      .get();
    assert.equal(decisionEvents.size, 1);
  });

  it("inventário cíclico sem divergência preserva a projeção agregada multi-localização", async () => {
    await Promise.all([
      db.collection("stock_balances").doc("balance-cyc-a").set({
        id: "balance-cyc-a",
        customer_code: "BTG Pactual",
        sku_code: "SKU-CYC-1",
        client_item_code: "ITEM-CYC-1",
        product_name: "Produto multi-localização",
        location_id: "LOC-CYC-A",
        qty_on_hand: 10,
        qty_reserved: 0,
        qty_available: 10,
        unit_cost: 20,
      }),
      db.collection("stock_balances").doc("balance-cyc-b").set({
        id: "balance-cyc-b",
        customer_code: "BTG Pactual",
        sku_code: "SKU-CYC-1",
        client_item_code: "ITEM-CYC-1",
        product_name: "Produto multi-localização",
        location_id: "LOC-CYC-B",
        qty_on_hand: 5,
        qty_reserved: 0,
        qty_available: 5,
        unit_cost: 20,
      }),
    ]);

    const counted = (await recordCycleCountTransaction(
      db,
      {
        mode: "cycle",
        customer_code: "BTG Pactual",
        sku_code: "SKU-CYC-1",
        client_item_code: "ITEM-CYC-1",
        location_id: "LOC-CYC-A",
        counted_qty: 10,
        reason: "Contagem cíclica de rotina",
        idempotency_key: "cycle-nodiv-1",
      },
      actor,
    )) as Record<string, unknown>;
    assert.equal(counted.adjustment_delta, 0);

    const projection = await db
      .collection("client_inventory")
      .where("customer_code", "==", "BTG Pactual")
      .where("sku_code", "==", "SKU-CYC-1")
      .get();
    assert.equal(projection.size, 1);
    assert.equal(projection.docs[0].data().qty_on_hand, 15);
    assert.equal(projection.docs[0].data().qty_available, 15);
  });

  it("movimentos manuais e ajustes cíclicos mantêm os agregados de skus/products", async () => {
    await Promise.all([
      db.collection("stock_balances").doc("balance-agg").set({
        id: "balance-agg",
        customer_code: "BTG Pactual",
        sku_code: "SKU-AGG-1",
        client_item_code: "ITEM-AGG-1",
        product_name: "Produto com agregados",
        location_id: "LOC-AGG",
        qty_on_hand: 10,
        qty_reserved: 0,
        qty_available: 10,
        unit_cost: 10,
      }),
      db.collection("skus").doc("SKU-AGG-1").set({
        id: "SKU-AGG-1",
        cod_btg: "SKU-AGG-1",
        sku_code: "SKU-AGG-1",
        sku_code_key: "SKU-AGG-1",
        cod_cliente: "ITEM-AGG-1",
        cod_cliente_key: "ITEM-AGG-1",
        estoque_atual: 10,
        estoque_reservado: 0,
        estoque_disponivel: 10,
        custo_total: 100,
      }),
      db.collection("products").doc("ITEM-AGG-1").set({
        id: "ITEM-AGG-1",
        cod_cliente: "ITEM-AGG-1",
        cod_cliente_key: "ITEM-AGG-1",
        estoque_btg: 10,
        custo_total: 100,
      }),
    ]);

    await createInventoryMovementTransaction(
      db,
      {
        type: "ENTRADA",
        quantity: 5,
        customer_code: "BTG Pactual",
        sku_code: "SKU-AGG-1",
        client_item_code: "ITEM-AGG-1",
        product_name: "Produto com agregados",
        location_id: "LOC-AGG",
        unit_cost: 10,
        reason: "Entrada manual para teste de agregados",
        idempotency_key: "agg-entry-1",
      },
      actor,
    );
    let sku = await db.collection("skus").doc("SKU-AGG-1").get();
    let product = await db.collection("products").doc("ITEM-AGG-1").get();
    assert.equal(sku.data()?.estoque_atual, 15);
    assert.equal(sku.data()?.estoque_disponivel, 15);
    assert.equal(sku.data()?.custo_total, undefined);
    assert.equal(product.data()?.estoque_btg, 15);
    assert.equal(product.data()?.custo_total, undefined);
    assert.equal(await storedUnitPrice(db, "BTG Pactual", "SKU-AGG-1"), 10);

    await createInventoryMovementTransaction(
      db,
      {
        type: "SAIDA",
        quantity: 3,
        customer_code: "BTG Pactual",
        sku_code: "SKU-AGG-1",
        client_item_code: "ITEM-AGG-1",
        product_name: "Produto com agregados",
        location_id: "LOC-AGG",
        unit_cost: 10,
        reason: "Saída manual para teste de agregados",
        idempotency_key: "agg-exit-1",
      },
      actor,
    );
    sku = await db.collection("skus").doc("SKU-AGG-1").get();
    product = await db.collection("products").doc("ITEM-AGG-1").get();
    assert.equal(sku.data()?.estoque_atual, 12);
    assert.equal(sku.data()?.estoque_disponivel, 12);
    assert.equal(sku.data()?.custo_total, undefined);
    assert.equal(product.data()?.estoque_btg, 12);
    assert.equal(product.data()?.custo_total, undefined);

    const adjusted = (await recordCycleCountTransaction(
      db,
      {
        mode: "cycle",
        customer_code: "BTG Pactual",
        sku_code: "SKU-AGG-1",
        client_item_code: "ITEM-AGG-1",
        location_id: "LOC-AGG",
        counted_qty: 10,
        unit_cost: 10,
        reason: "Ajuste cíclico para teste de agregados",
        idempotency_key: "agg-cycle-1",
      },
      actor,
    )) as Record<string, unknown>;
    assert.equal(adjusted.adjustment_delta, -2);

    sku = await db.collection("skus").doc("SKU-AGG-1").get();
    product = await db.collection("products").doc("ITEM-AGG-1").get();
    assert.equal(sku.data()?.estoque_atual, 10);
    assert.equal(sku.data()?.estoque_disponivel, 10);
    assert.equal(sku.data()?.custo_total, undefined);
    assert.equal(product.data()?.estoque_btg, 10);
    assert.equal(product.data()?.custo_total, undefined);
  });

  it("resolve catálogo importado (id stable_id, sem *_key) pelos campos crus", async () => {
    await Promise.all([
      db.collection("stock_balances").doc("balance-leg").set({
        id: "balance-leg",
        customer_code: "BTG Pactual",
        sku_code: "SKU-LEG-1",
        client_item_code: "ITEM-LEG-1",
        product_name: "Produto importado legado",
        location_id: "LOC-LEG",
        qty_on_hand: 4,
        qty_reserved: 0,
        qty_available: 4,
        unit_cost: 25,
      }),
      // Formato do tools/import_btg_firestore.py: id hash, só campos crus.
      db.collection("skus").doc("sku_legado_0a1b2c3d4e5f6a7b").set({
        id: "sku_legado_0a1b2c3d4e5f6a7b",
        cod_btg: "SKU-LEG-1",
        sku_code: "SKU-LEG-1",
        cod_cliente: "ITEM-LEG-1",
        estoque_atual: 4,
        estoque_reservado: 0,
        estoque_disponivel: 4,
        custo_total: 100,
      }),
      db.collection("products").doc("product_legado_9f8e7d6c5b4a3f2e").set({
        id: "product_legado_9f8e7d6c5b4a3f2e",
        cod_cliente: "ITEM-LEG-1",
        estoque_btg: 4,
        custo_total: 100,
      }),
    ]);

    await createInventoryMovementTransaction(
      db,
      {
        type: "ENTRADA",
        quantity: 2,
        customer_code: "BTG Pactual",
        sku_code: "SKU-LEG-1",
        client_item_code: "ITEM-LEG-1",
        product_name: "Produto importado legado",
        location_id: "LOC-LEG",
        unit_cost: 25,
        reason: "Entrada em catálogo importado",
        idempotency_key: "leg-entry-1",
      },
      actor,
    );

    const sku = await db
      .collection("skus")
      .doc("sku_legado_0a1b2c3d4e5f6a7b")
      .get();
    const product = await db
      .collection("products")
      .doc("product_legado_9f8e7d6c5b4a3f2e")
      .get();
    assert.equal(sku.data()?.estoque_atual, 6);
    assert.equal(sku.data()?.estoque_disponivel, 6);
    assert.equal(sku.data()?.custo_total, undefined);
    assert.equal(product.data()?.estoque_btg, 6);
    assert.equal(product.data()?.custo_total, undefined);
    assert.equal(await storedUnitPrice(db, "BTG Pactual", "SKU-LEG-1"), 25);
  });

  it("recontagem de produto arquivado reativa o cadastro em vez de acusar duplicidade", async () => {
    await clearFirestore();

    const session = await createOpeningInventorySessionTransaction(
      db,
      {
        customer_code: "BTG Pactual",
        reference: "INVENTARIO-ABERTURA-REATIVACAO",
        idempotency_key: "opening-session-reactivation-test",
      },
      actor,
    );

    // Cenário real de 31/07: conta o item, remove a linha para corrigir e,
    // no meio, o admin "deleta" pelo Catálogo — que apenas ARQUIVA o
    // cadastro. A recontagem como produto novo não pode virar beco sem
    // saída ("já existe").
    await recordCycleCountTransaction(
      db,
      openingCountInput(String(session.session_id)),
      actor,
    );
    const linhas = await db
      .collection("opening_inventory_lines")
      .where("session_id", "==", String(session.session_id))
      .get();
    assert.equal(linhas.size, 1);
    await removeOpeningInventoryLineTransaction(
      db,
      {
        customer_code: "BTG Pactual",
        session_id: String(session.session_id),
        opening_line_id: String(linhas.docs[0]!.id),
        idempotency_key: "remove-line-reactivation-test",
      },
      actor,
    );
    const input = openingCountInput(String(session.session_id));
    // A exclusão pelo Catálogo só marca archived: o cadastro guarda a
    // identidade (dono, código do cliente e o SKU gerado).
    const identity = {
      customer_code: "BTG Pactual",
      cod_cliente: input.client_item_code,
      cod_cliente_key: input.client_item_code,
      produto: input.product_name,
      archived: true,
      status: "archived",
    };
    await db.collection("products").doc(input.client_item_code!).set({
      id: input.client_item_code,
      ...identity,
    });
    await db.collection("skus").doc("BTG-000001").set({
      id: "BTG-000001",
      ...identity,
      cod_btg: "BTG-000001",
      sku_code: "BTG-000001",
      sku_code_key: "BTG-000001",
    });

    const recontagem = await recordCycleCountTransaction(db, {
      ...input,
      idempotency_key: "opening-count-reactivation-retry",
    }, actor);
    assert.equal(recontagem.qty_counted, 12);
    // Reativação reaproveita o SKU arquivado do mesmo código do cliente em
    // vez de gerar outro número para o mesmo produto.
    assert.equal(recontagem.sku_code, "BTG-000001");
    assert.equal((await db.collection("skus").get()).size, 1);

    const produto = await db
      .collection("products")
      .doc(input.client_item_code!)
      .get();
    const sku = await db.collection("skus").doc("BTG-000001").get();
    assert.equal(produto.data()?.archived, false);
    assert.equal(produto.data()?.status, "active");
    assert.equal(sku.data()?.archived, false);
    assert.equal(sku.data()?.status, "active");
  });

  it("remover a linha apaga também o cartão solto do mesmo código do cliente", async () => {
    await clearFirestore();
    const session = await createOpeningInventorySessionTransaction(
      db,
      {
        customer_code: "BTG Pactual",
        reference: "INVENTARIO-ABERTURA-CARTAO-SOLTO",
        idempotency_key: "opening-session-stray-product",
      },
      actor,
    );
    const sessionId = String(session.session_id);
    const input = openingCountInput(sessionId, {
      idempotency_key: "opening-count-stray-product",
    });
    await recordCycleCountTransaction(db, input, actor);
    await db.collection("products").doc("product_orfao_cliente_open").set({
      id: "product_orfao_cliente_open",
      customer_code: "BTG Pactual",
      cod_cliente: input.client_item_code,
      cod_cliente_key: input.client_item_code,
      produto: "Cartão que sobrou do cancelamento",
      status: "active",
      archived: false,
      estoque_btg: 0,
    });
    const linhas = await db
      .collection("opening_inventory_lines")
      .where("session_id", "==", sessionId)
      .get();
    await removeOpeningInventoryLineTransaction(
      db,
      {
        customer_code: "BTG Pactual",
        session_id: sessionId,
        opening_line_id: String(linhas.docs[0]!.id),
        idempotency_key: "opening-remove-stray-product",
      },
      actor,
    );
    assert.equal((await db.collection("products").get()).size, 0);
    assert.equal((await db.collection("skus").get()).size, 0);
    assert.equal(await deletedCatalogDocs("inventory.opening_counted"), undefined);
    assert.deepEqual(await deletedCatalogDocs("inventory.opening_line_removed"), [
      "products/CLIENTE-OPEN-001",
      "products/product_orfao_cliente_open",
      "skus/BTG-000001",
    ]);
  });

  it("produto novo não apaga o SKU arquivado de outro id que ainda tem saldo", async () => {
    await clearFirestore();
    const session = await createOpeningInventorySessionTransaction(
      db,
      {
        customer_code: "BTG Pactual",
        reference: "INVENTARIO-ABERTURA-SKU-SOLTO-SALDO",
        idempotency_key: "opening-session-stray-sku-stock",
      },
      actor,
    );
    const input = openingCountInput(String(session.session_id), {
      idempotency_key: "opening-count-stray-sku-stock",
    });
    const identity = {
      customer_code: "BTG Pactual",
      cod_cliente: input.client_item_code,
      cod_cliente_key: input.client_item_code,
      archived: true,
      status: "archived",
    };
    await db.collection("products").doc(input.client_item_code!).set({
      id: input.client_item_code,
      ...identity,
      estoque_btg: 0,
    });
    await db.collection("skus").doc("sku_legado_cliente_open").set({
      id: "sku_legado_cliente_open",
      ...identity,
      cod_btg: "BTG-000050",
      sku_code: "BTG-000050",
      sku_code_key: "BTG-000050",
      estoque_atual: 0,
    });
    await db.collection("stock_balances").doc("bal-sku-legado").set({
      customer_code: "BTG Pactual",
      sku_code: "BTG-000050",
      client_item_code: input.client_item_code,
      location_id: "RUA-B/PRAT-02",
      qty_on_hand: 3,
      qty_reserved: 0,
    });

    await assert.rejects(
      recordCycleCountTransaction(db, input, actor),
      /ainda tem saldo/,
    );
    assert.equal(
      (await db.collection("skus").doc("sku_legado_cliente_open").get()).exists,
      true,
    );
    assert.equal((await db.collection("skus").doc("BTG-000050").get()).exists, false);
  });

  it("remover a linha de outro cliente não apaga cartão legado nem cartão solto com saldo no cadastro", async () => {
    await clearFirestore();
    await db.collection("customers").doc("Cliente_Solto").set({
      code: "Cliente Solto",
      customer_code: "Cliente Solto",
      name: "Cliente Solto",
      sku_prefix: "SOL",
      status: "active",
    });
    const session = await createOpeningInventorySessionTransaction(
      db,
      {
        customer_code: "Cliente Solto",
        reference: "INVENTARIO-ABERTURA-CARTAO-ALHEIO",
        idempotency_key: "opening-session-stray-owner",
      },
      actor,
    );
    const sessionId = String(session.session_id);
    const input = openingCountInput(sessionId, {
      customer_code: "Cliente Solto",
      client_item_code: "SOLTO-OPEN-001",
      idempotency_key: "opening-count-stray-owner",
    });
    const counted = await recordCycleCountTransaction(db, input, actor);
    assert.equal(counted.sku_code, "SOL-000001");
    const sameCode = {
      cod_cliente: "SOLTO-OPEN-001",
      cod_cliente_key: "SOLTO-OPEN-001",
      status: "active",
      archived: false,
    };
    // Sem customer_code o registro é do cliente legado (customer-scope.ts).
    await db.collection("products").doc("product_legado_sem_dono").set({
      ...sameCode,
      estoque_btg: 0,
    });
    await db.collection("products").doc("product_solto_com_saldo").set({
      ...sameCode,
      customer_code: "Cliente Solto",
      estoque_btg: 4,
    });
    await db.collection("products").doc("product_solto_sem_saldo").set({
      ...sameCode,
      customer_code: "Cliente Solto",
      estoque_btg: 0,
    });
    const linhas = await db
      .collection("opening_inventory_lines")
      .where("session_id", "==", sessionId)
      .get();
    await removeOpeningInventoryLineTransaction(
      db,
      {
        customer_code: "Cliente Solto",
        session_id: sessionId,
        opening_line_id: String(linhas.docs[0]!.id),
        idempotency_key: "opening-remove-stray-owner",
      },
      actor,
    );
    const products = await db.collection("products").get();
    assert.deepEqual(
      products.docs.map((doc) => doc.id).sort(),
      ["product_legado_sem_dono", "product_solto_com_saldo"],
    );
    assert.equal((await db.collection("skus").get()).size, 0);
    assert.deepEqual(await deletedCatalogDocs("inventory.opening_line_removed"), [
      "products/SOLTO-OPEN-001",
      "products/product_solto_sem_saldo",
      "skus/SOL-000001",
    ]);
  });

  it("remover a linha não apaga o cartão de produto solto cujo código ainda tem saldo no ledger", async () => {
    await clearFirestore();
    await db.collection("customers").doc("Cliente_Solto").set({
      code: "Cliente Solto",
      customer_code: "Cliente Solto",
      name: "Cliente Solto",
      sku_prefix: "SOL",
      status: "active",
    });
    const session = await createOpeningInventorySessionTransaction(
      db,
      {
        customer_code: "Cliente Solto",
        reference: "INVENTARIO-ABERTURA-CARTAO-SOLTO-LEDGER",
        idempotency_key: "opening-session-stray-ledger",
      },
      actor,
    );
    const sessionId = String(session.session_id);
    const input = openingCountInput(sessionId, {
      customer_code: "Cliente Solto",
      client_item_code: "SOLTO-OPEN-001",
      idempotency_key: "opening-count-stray-ledger",
    });
    const counted = await recordCycleCountTransaction(db, input, actor);
    assert.equal(counted.sku_code, "SOL-000001");
    const sameCode = {
      customer_code: "Cliente Solto",
      cod_cliente: "SOLTO-OPEN-001",
      cod_cliente_key: "SOLTO-OPEN-001",
    };
    // O cartão de produto não guarda SKU: o saldo dele no ledger é o do
    // código do cliente, aqui sob um SKU arquivado de outro id.
    await db.collection("products").doc("product_solto_sem_saldo").set({
      ...sameCode,
      status: "active",
      archived: false,
      estoque_btg: 0,
    });
    await db.collection("skus").doc("sku_solto_com_saldo").set({
      ...sameCode,
      archived: true,
      status: "archived",
      cod_btg: "SOL-000077",
      sku_code: "SOL-000077",
      estoque_atual: 0,
    });
    await db.collection("stock_balances").doc("bal-sku-solto").set({
      customer_code: "Cliente Solto",
      sku_code: "SOL-000077",
      client_item_code: "SOLTO-OPEN-001",
      location_id: "RUA-B/PRAT-02",
      qty_on_hand: 2,
      qty_reserved: 0,
    });
    const linhas = await db
      .collection("opening_inventory_lines")
      .where("session_id", "==", sessionId)
      .get();
    await removeOpeningInventoryLineTransaction(
      db,
      {
        customer_code: "Cliente Solto",
        session_id: sessionId,
        opening_line_id: String(linhas.docs[0]!.id),
        idempotency_key: "opening-remove-stray-ledger",
      },
      actor,
    );
    const products = await db.collection("products").get();
    assert.deepEqual(products.docs.map((doc) => doc.id), ["product_solto_sem_saldo"]);
    const skus = await db.collection("skus").get();
    assert.deepEqual(skus.docs.map((doc) => doc.id), ["sku_solto_com_saldo"]);
    assert.equal(
      (await db.collection("stock_balances").doc("bal-sku-solto").get()).data()?.qty_on_hand,
      2,
    );
    assert.deepEqual(await deletedCatalogDocs("inventory.opening_line_removed"), [
      "products/SOLTO-OPEN-001",
      "skus/SOL-000001",
    ]);
  });
});

describe("número do pedido e cancelamento pelo cliente", () => {
  const client = { ...actor, role: "cliente", uid: "client-ped" };
  const retirada = (key: string, quantity: number) =>
    createCustomerRequestTransaction(
      db,
      {
        type: "retirada",
        priority: "normal",
        title: "Kit boas-vindas",
        destination: "BTG Faria Lima",
        customer_code: "BTG Pactual",
        idempotency_key: key,
        items: [{ sku_code: "SKU-PED-1", client_item_code: "ITEM-PED-1", product_name: "POLO PIQUET AZUL M", unit_cost: 10, quantity }],
      },
      client,
    );

  it("numera PED-/ENV- em sequência, publica os itens no portal e o cliente cancela antes da confirmação", async () => {
    await clearFirestore();
    await Promise.all([
      db.collection("stock_balances").doc("balance-ped").set({
        id: "balance-ped",
        customer_code: "BTG Pactual",
        sku_code: "SKU-PED-1",
        client_item_code: "ITEM-PED-1",
        product_name: "POLO PIQUET AZUL M",
        location_id: "LOC-PED",
        qty_on_hand: 10,
        qty_reserved: 0,
        qty_available: 10,
        unit_cost: 10,
      }),
      db.collection("skus").doc("SKU-PED-1").set({
        id: "SKU-PED-1",
        cod_btg: "SKU-PED-1",
        sku_code: "SKU-PED-1",
        sku_code_key: "SKU-PED-1",
        cod_cliente: "ITEM-PED-1",
        cod_cliente_key: "ITEM-PED-1",
        estoque_atual: 10,
        estoque_reservado: 0,
        estoque_disponivel: 10,
      }),
      db.collection("products").doc("ITEM-PED-1").set({ id: "ITEM-PED-1", cod_cliente: "ITEM-PED-1", cod_cliente_key: "ITEM-PED-1", estoque_btg: 10 }),
    ]);

    const first = await retirada("ped-1", 3);
    assert.equal(first.request_number, "PED-0001");
    const envio = await createCustomerRequestTransaction(
      db,
      {
        type: "recebimento",
        priority: "normal",
        title: "Envio de fornecedor",
        customer_code: "BTG Pactual",
        idempotency_key: "env-1",
        items: [{ product_name: "BLUSA MOLETOM", product_registration: "unknown", quantity: 8 }],
      },
      client,
    );
    assert.equal(envio.request_number, "ENV-0001");
    const second = await retirada("ped-2", 4);
    assert.equal(second.request_number, "PED-0002");
    // Mesma chave de idempotência não gasta número.
    assert.equal((await retirada("ped-1", 3)).request_number, "PED-0001");
    assert.equal((await retirada("ped-3", 1)).request_number, "PED-0003");

    const portal = await db.collection("client_request_status").doc(String(first.id)).get();
    assert.equal(portal.data()?.request_number, "PED-0001");
    assert.deepEqual(portal.data()?.items, [
      { line_number: 1, product_name: "POLO PIQUET AZUL M", quantity: 3, client_item_code: "ITEM-PED-1" },
    ]);
    const envioPortal = await db.collection("client_request_status").doc(String(envio.id)).get();
    assert.equal(envioPortal.data()?.items?.[0]?.code_pending, true);

    // Cancelar: só o cliente, só antes da confirmação; a reserva volta.
    await assert.rejects(
      decideCustomerRequestTransaction(
        db,
        { request_id: String(second.id), action: "cancel", expected_status: "open", idempotency_key: "cancel-wms" },
        actor,
      ),
      /Só o cliente/,
    );
    const cancelled = (await decideCustomerRequestTransaction(
      db,
      { request_id: String(second.id), action: "cancel", reason: "Evento adiado", expected_status: "open", idempotency_key: "cancel-ped-2" },
      client,
    )) as Record<string, unknown>;
    assert.equal(cancelled.status, "cancelled");
    const balance = await db.collection("stock_balances").doc("balance-ped").get();
    assert.equal(balance.data()?.qty_reserved, 4); // 3 (PED-0001) + 1 (PED-0003)
    const portalCancelled = await db.collection("client_request_status").doc(String(second.id)).get();
    assert.equal(portalCancelled.data()?.status, "cancelled");
    const cancelEvents = await db.collection("events").where("type", "==", "customer_request.cancelled").get();
    assert.equal(cancelEvents.size, 1);

    // Confirmado pela Dutelog: o pedido sai com o mesmo número e não cancela mais.
    const approved = (await decideCustomerRequestTransaction(
      db,
      { request_id: String(first.id), action: "approve", expected_status: "open", idempotency_key: "approve-ped-1" },
      actor,
    )) as Record<string, unknown>;
    const order = await db.collection("orders").doc(String(approved.order_id)).get();
    assert.equal(order.data()?.order_number, "PED-0001");
    await assert.rejects(
      decideCustomerRequestTransaction(
        db,
        { request_id: String(first.id), action: "cancel", expected_status: "approved", idempotency_key: "cancel-ped-1" },
        client,
      ),
      /já confirmou/,
    );
  });

  it("dá número às solicitações antigas na ordem de criação, sem repetir", async () => {
    await Promise.all([
      db.collection("customer_requests").doc("creq_antigo_a").set({
        id: "creq_antigo_a",
        customer_code: "BTG Pactual",
        type: "retirada",
        status: "cancelled",
        items: [{ sku_code: "SKU-X", client_item_code: "ITEM-X", product_name: "CANECA", quantity: 2, unit_cost: 9 }],
        created_at: new Date("2026-08-01T10:00:00Z"),
      }),
      db.collection("customer_requests").doc("creq_antigo_b").set({
        id: "creq_antigo_b",
        customer_code: "BTG Pactual",
        type: "recebimento",
        status: "open",
        items: [],
        created_at: new Date("2026-08-02T10:00:00Z"),
      }),
      db.collection("client_request_status").doc("creq_antigo_a").set({ id: "creq_antigo_a", customer_code: "BTG Pactual" }),
    ]);

    const preview = await assignMissingRequestNumbers(db, { dryRun: true });
    assert.deepEqual(preview.assigned, [
      { id: "creq_antigo_a", request_number: "PED-0004" },
      { id: "creq_antigo_b", request_number: "ENV-0002" },
    ]);
    assert.equal((await db.collection("customer_requests").doc("creq_antigo_a").get()).data()?.request_number, undefined);

    const applied = await assignMissingRequestNumbers(db, { dryRun: false });
    assert.equal(applied.assigned_count, 2);
    const portal = await db.collection("client_request_status").doc("creq_antigo_a").get();
    assert.equal(portal.data()?.request_number, "PED-0004");
    assert.deepEqual(portal.data()?.items, [{ line_number: 1, product_name: "CANECA", quantity: 2, client_item_code: "ITEM-X" }]);
    assert.equal((await assignMissingRequestNumbers(db, { dryRun: false })).assigned_count, 0);
    // O próximo pedido continua a contagem.
    assert.equal((await retirada("ped-4", 1)).request_number, "PED-0005");
  });
});

describe("fotos do item", () => {
  it("gerencia principal e remoção em todas as projeções, preservando histórico e saldo", async () => {
    const urls = ["https://example.test/original-manage.jpg", "https://example.test/generated-manage.png"];
    const paths = ["product-photos/Cliente_Manage/original.jpg", "product-photos/Cliente_Manage/generated/first.png"];
    const sku = db.collection("skus").doc("SKU-MANAGE");
    const product = db.collection("products").doc("ITEM-MANAGE");
    const balance = db.collection("stock_balances").doc("balance-manage");
    const portal = db.collection("client_inventory").doc("cinv_Cliente_Manage__SKU-MANAGE");
    const base = { customer_code: "Cliente Manage", photo_urls: urls, photo_storage_paths: paths, primary_photo_url: urls[0] };
    await Promise.all([
      sku.set({ ...base, sku_code: "SKU-MANAGE", sku_code_key: "SKU-MANAGE", estoque_atual: 9 }),
      product.set({ ...base, cod_cliente: "ITEM-MANAGE", cod_cliente_key: "ITEM-MANAGE" }),
      balance.set({ ...base, sku_code: "SKU-MANAGE", qty_on_hand: 9, qty_available: 9, qty_reserved: 0 }),
      portal.set({ ...base, sku_code: "SKU-MANAGE", on_hand: 9 }),
    ]);
    const input = { sku_code: "SKU-MANAGE", client_item_code: "ITEM-MANAGE", customer_code: "Cliente Manage", photo_urls: [] };
    await addCatalogPhotosTransaction(db, { ...input, primary_photo_url: urls[1], idempotency_key: "manage-primary" }, actor);
    for (const ref of [sku, product, balance, portal]) assert.equal((await ref.get()).data()?.primary_photo_url, urls[1]);
    const remove = { ...input, remove_photo_urls: [urls[1]!], idempotency_key: "manage-remove" };
    await addCatalogPhotosTransaction(db, remove, actor);
    await addCatalogPhotosTransaction(db, remove, actor);
    for (const ref of [sku, product, balance, portal]) {
      const data = (await ref.get()).data()!;
      assert.deepEqual(data.photo_urls, [urls[0]]);
      assert.deepEqual(data.photo_storage_paths, [paths[0]]);
      assert.equal(data.primary_photo_url, urls[0]);
    }
    assert.equal((await sku.get()).data()?.estoque_atual, 9);
    assert.equal((await balance.get()).data()?.qty_on_hand, 9);
    assert.equal((await portal.get()).data()?.on_hand, 9);
    const archive = await db.collection("catalog_photo_archive").where("sku_code", "==", "SKU-MANAGE").get();
    assert.equal(archive.size, 1);
    assert.deepEqual(archive.docs[0]?.data().photos, [{ url: urls[1], storage_path: paths[1] }]);
    assert.equal(archive.docs[0]?.data().actor.uid, actor.uid);
    await assert.rejects(addCatalogPhotosTransaction(db, { ...input, customer_code: "Outro Cliente", primary_photo_url: urls[0], idempotency_key: "manage-other-customer" }, actor), { code: "failed-precondition" });
    await assert.rejects(addCatalogPhotosTransaction(db, { ...input, primary_photo_url: urls[1], idempotency_key: "manage-absent" }, actor), { code: "invalid-argument" });
    await addCatalogPhotosTransaction(db, { ...input, remove_photo_urls: [urls[0]!], idempotency_key: "manage-last-photo" }, actor);
    for (const ref of [sku, product, balance, portal]) {
      const data = (await ref.get()).data()!;
      assert.deepEqual(data.photo_urls, []);
      assert.deepEqual(data.photo_storage_paths, []);
      assert.equal(data.primary_photo_url, "");
    }
  });
  it("aprova foto gerada como principal, preserva original e não altera saldo", async () => {
    const original = "https://example.test/original.jpg";
    const generated = "https://example.test/generated.png";
    const skuRef = db.collection("skus").doc("SKU-STUDIO");
    const balanceRef = db.collection("stock_balances").doc("balance-studio");
    await skuRef.set({ sku_code: "SKU-STUDIO", sku_code_key: "SKU-STUDIO", customer_code: "Cliente Studio", photo_urls: [original], photo_storage_paths: ["product-photos/Cliente_Studio/original.jpg"], primary_photo_url: original, estoque_atual: 7 });
    await balanceRef.set({ sku_code: "SKU-STUDIO", customer_code: "Cliente Studio", photo_urls: [original], qty_on_hand: 7 });
    const input = { sku_code: "SKU-STUDIO", customer_code: "Cliente Studio", photo_urls: [generated], photo_storage_paths: ["product-photos/Cliente_Studio/generated.png"], primary_photo_url: generated, idempotency_key: "approve-studio" };
    await addCatalogPhotosTransaction(db, input, actor);
    await addCatalogPhotosTransaction(db, input, actor);
    for (const ref of [skuRef, balanceRef]) {
      const data = (await ref.get()).data()!;
      assert.deepEqual(data.photo_urls, [generated, original]);
      assert.equal(data.primary_photo_url, generated);
    }
    assert.equal((await skuRef.get()).data()?.estoque_atual, 7);
    assert.deepEqual((await skuRef.get()).data()?.photo_storage_paths, ["product-photos/Cliente_Studio/generated.png", "product-photos/Cliente_Studio/original.jpg"]);
    assert.equal((await balanceRef.get()).data()?.qty_on_hand, 7);
    await assert.rejects(addCatalogPhotosTransaction(db, { ...input, customer_code: "Outro Cliente", idempotency_key: "other-customer-studio" }, actor), { code: "failed-precondition" });
  });

  it("não descarta originais quando o catálogo está cheio ou a principal é inválida", async () => {
    const originals = Array.from({ length: 8 }, (_, index) => `https://example.test/original-${index}.jpg`);
    const ref = db.collection("skus").doc("SKU-STUDIO-FULL");
    await ref.set({ sku_code: "SKU-STUDIO-FULL", sku_code_key: "SKU-STUDIO-FULL", photo_urls: originals });
    await assert.rejects(addCatalogPhotosTransaction(db, { sku_code: "SKU-STUDIO-FULL", photo_urls: ["https://example.test/new.png"], idempotency_key: "full-studio" }, actor), { code: "failed-precondition" });
    await assert.rejects(addCatalogPhotosTransaction(db, { sku_code: "SKU-STUDIO-FULL", photo_urls: [originals[0]!], primary_photo_url: "https://example.test/missing.jpg", idempotency_key: "invalid-primary-studio" }, actor), { code: "invalid-argument" });
    assert.deepEqual((await ref.get()).data()?.photo_urls, originals);
  });

  it("armazém acrescenta foto a item existente em sku, produto, saldo e portal", async () => {
    await Promise.all([
      db.collection("skus").doc("SKU-FOTO-1").set({
        id: "SKU-FOTO-1",
        sku_code: "SKU-FOTO-1",
        sku_code_key: "SKU-FOTO-1",
        cod_cliente: "ITEM-FOTO-1",
        estoque_atual: 4,
        preco_unit: 50,
      }),
      db.collection("products").doc("ITEM-FOTO-1").set({
        id: "ITEM-FOTO-1",
        cod_cliente: "ITEM-FOTO-1",
        cod_cliente_key: "ITEM-FOTO-1",
        produto: "Cesto quadrado",
        custo_total: 200,
      }),
      db.collection("stock_balances").doc("balance-foto").set({
        id: "balance-foto",
        customer_code: "BTG Pactual",
        sku_code: "SKU-FOTO-1",
        location_id: "LOC-FOTO",
        qty_on_hand: 4,
        qty_reserved: 0,
        qty_available: 4,
      }),
    ]);
    const photo = "https://storage.googleapis.com/demo/cesto.jpg";
    const warehouse = { ...actor, role: "wms" as const };

    const result = (await addCatalogPhotosTransaction(
      db,
      {
        sku_code: "SKU-FOTO-1",
        client_item_code: "ITEM-FOTO-1",
        photo_urls: [photo],
        photo_storage_paths: ["customers/BTG_Pactual/product-photos/cesto.jpg"],
        idempotency_key: "foto-1",
      },
      warehouse,
    )) as Record<string, unknown>;
    assert.equal(result.added, 1);

    const [sku, product, balance] = await Promise.all([
      db.collection("skus").doc("SKU-FOTO-1").get(),
      db.collection("products").doc("ITEM-FOTO-1").get(),
      db.collection("stock_balances").doc("balance-foto").get(),
    ]);
    for (const doc of [sku, product, balance]) {
      assert.deepEqual(doc.data()?.photo_urls, [photo]);
      assert.equal(doc.data()?.primary_photo_url, photo);
    }
    // A foto entra. O valor sai do cadastro e fica em catalog_prices.
    assert.equal(product.data()?.produto, "Cesto quadrado");
    assert.equal(product.data()?.custo_total, undefined);
    assert.equal(sku.data()?.preco_unit, undefined);
    assert.equal(await storedUnitPrice(db, "BTG Pactual", "SKU-FOTO-1"), 50);
    assert.equal(sku.data()?.estoque_atual, 4);
    assert.equal(balance.data()?.qty_on_hand, 4);

    // Idempotente: repetir a mesma chamada não duplica a foto.
    await addCatalogPhotosTransaction(
      db,
      {
        sku_code: "SKU-FOTO-1",
        client_item_code: "ITEM-FOTO-1",
        photo_urls: [photo],
        photo_storage_paths: ["customers/BTG_Pactual/product-photos/cesto.jpg"],
        idempotency_key: "foto-1",
      },
      warehouse,
    );
    assert.deepEqual(
      (await db.collection("skus").doc("SKU-FOTO-1").get()).data()?.photo_urls,
      [photo],
    );

    // Auditável: o evento registra quem acrescentou.
    const events = await db
      .collection("events")
      .where("entity_id", "==", "SKU-FOTO-1")
      .where("type", "==", "catalog.photos_added")
      .get();
    assert.equal(events.size, 1);
    assert.equal(events.docs[0].data().actor?.role, "wms");
  });

  it("recusa item inexistente e foto sem endereço https", async () => {
    await assert.rejects(
      addCatalogPhotosTransaction(
        db,
        {
          sku_code: "SKU-NAO-EXISTE",
          photo_urls: ["https://storage.googleapis.com/demo/x.jpg"],
          idempotency_key: "foto-404",
        },
        actor,
      ),
      /não encontrado/,
    );
    await assert.rejects(
      addCatalogPhotosTransaction(
        db,
        {
          sku_code: "SKU-FOTO-1",
          photo_urls: ["file:///tmp/x.jpg"],
          idempotency_key: "foto-invalida",
        },
        actor,
      ),
      /endereço inválido/,
    );
  });
});

describe("guarda numa posição cadastrada", () => {
  const BTG = "BTG Pactual";
  const SKU = "BTG-GUARDA-1";

  function position(code: string, shelf: number, customer: string, status: string) {
    return db.collection("warehouse_positions").doc(code).set({
      code,
      aisle: code.split("-")[0],
      shelf,
      length_m: 1.8,
      depth_m: 0.75,
      height_m: 0.5,
      sequence: shelf,
      customer_code: customer,
      status,
    });
  }

  // A tarefa como o recebimento grava ao concluir: planejada, saindo do RECEBIMENTO.
  function putawayTask(taskId: string, quantity: number, customer = BTG, sku = SKU) {
    return db.collection("putaway_tasks").doc(taskId).set({
      id: taskId,
      customer_code: customer,
      receipt_id: "inb_guarda_1",
      inbound_item_id: `${taskId}_item`,
      sku_code: sku,
      client_item_code: "ITEM-GUARDA",
      product_name: "Caneca de teste da guarda",
      source_location_id: "RECEBIMENTO",
      quantity,
      total_units: quantity,
      status: "planned",
      priority: "normal",
      title: "Guardar Caneca de teste da guarda",
      source: "wms_receiving",
    });
  }

  async function seedGuard() {
    await clearFirestore();
    await Promise.all([
      position("A-01", 1, BTG, "active"),
      position("A-02", 2, BTG, "blocked"),
      position("C-01", 1, "Outro Cliente", "active"),
      db.collection("stock_balances").doc("bal-guarda-recebimento").set({
        id: "bal-guarda-recebimento",
        customer_code: BTG,
        sku_code: SKU,
        client_item_code: "ITEM-GUARDA",
        product_name: "Caneca de teste da guarda",
        location_id: "RECEBIMENTO",
        qty_on_hand: 10,
        qty_reserved: 0,
        qty_available: 10,
        unit_cost: 5,
      }),
    ]);
  }

  function guardOperation(destination: string, quantity: number) {
    return {
      source_location_id: "RECEBIMENTO",
      destination_location_id: destination,
      location_id: destination,
      quantity,
    };
  }

  async function balanceAt(locationId: string, customer = BTG, sku = SKU) {
    const snapshot = await db
      .collection("stock_balances")
      .where("customer_code", "==", customer)
      .where("sku_code", "==", sku)
      .where("location_id", "==", locationId)
      .get();
    return snapshot.docs.map((document) => document.data());
  }

  it("com a posição da zona, a guarda planejada conclui de uma vez e move o saldo", async () => {
    await seedGuard();
    await Promise.all([putawayTask("put_guarda_1", 6), putawayTask("put_guarda_2", 4)]);

    const first = (await advance("putaway:put_guarda_1", "planned", guardOperation("A-01", 6))) as Record<string, unknown>;
    // Bipado em minúsculas, grava o código da etiqueta.
    const second = (await advance("putaway:put_guarda_2", "planned", guardOperation("a-01", 4))) as Record<string, unknown>;
    assert.equal(first.status, "completed");
    assert.equal(second.status, "completed");

    for (const [taskId, quantity] of [["put_guarda_1", 6], ["put_guarda_2", 4]] as const) {
      const task = (await db.collection("putaway_tasks").doc(taskId).get()).data();
      assert.equal(task?.status, "completed");
      assert.equal(task?.destination_location_id, "A-01");
      assert.equal(task?.location_id, "A-01");

      const movements = await db.collection("movements").where("putaway_task_id", "==", taskId).get();
      const byKind = Object.fromEntries(movements.docs.map((document) => [document.get("movement_kind"), document.data()]));
      assert.equal(movements.size, 2);
      assert.equal(byKind.putaway_transfer_out?.location_id, "RECEBIMENTO");
      assert.equal(byKind.putaway_transfer_out?.tipo_mov, "SAIDA");
      assert.equal(byKind.putaway_transfer_out?.quantity, quantity);
      assert.equal(byKind.putaway_transfer_in?.location_id, "A-01");
      assert.equal(byKind.putaway_transfer_in?.tipo_mov, "ENTRADA");
      assert.equal(byKind.putaway_transfer_in?.quantity, quantity);

      const events = await db
        .collection("events")
        .where("entity_id", "==", taskId)
        .where("type", "==", "putaway.completed")
        .get();
      assert.equal(events.size, 1);
      assert.equal(events.docs[0].get("payload.before_status"), "planned");
      assert.equal(events.docs[0].get("payload.destination_location_id"), "A-01");
    }

    const [source] = await balanceAt("RECEBIMENTO");
    assert.equal(source?.qty_on_hand, 0);
    const destination = await balanceAt("A-01");
    assert.equal(destination.length, 1);
    assert.equal(destination[0]?.qty_on_hand, 10);
    assert.equal(destination[0]?.qty_available, 10);
  });

  it("recusa posição bloqueada, desconhecida e de outra zona sem mover nada", async () => {
    await seedGuard();
    await putawayTask("put_guarda_3", 10);

    const refused: Array<[string, RegExp]> = [
      ["A-02", /^Esta posição está bloqueada\.$/],
      ["Z-99", /^Escolha uma posição cadastrada\.$/],
      ["C-01", /^Esta posição não é da zona de BTG Pactual\.$/],
      ["c-01", /^Esta posição não é da zona de BTG Pactual\.$/],
    ];
    for (const [destination, message] of refused) {
      await assert.rejects(advance("putaway:put_guarda_3", "planned", guardOperation(destination, 10)), {
        code: "failed-precondition",
        message,
      });
    }

    const task = (await db.collection("putaway_tasks").doc("put_guarda_3").get()).data();
    assert.equal(task?.status, "planned");
    assert.equal(task?.destination_location_id, undefined);
    const [source] = await balanceAt("RECEBIMENTO");
    assert.equal(source?.qty_on_hand, 10);
    for (const code of ["A-02", "Z-99", "C-01"]) {
      assert.deepEqual(await balanceAt(code), []);
    }
    assert.equal((await db.collection("movements").where("putaway_task_id", "==", "put_guarda_3").get()).size, 0);
    assert.equal((await db.collection("events").where("entity_id", "==", "put_guarda_3").get()).size, 0);
    assert.equal((await db.collection("operational_operations").get()).size, 0);
  });

  it("usa a zona do cliente da tarefa, não a de quem opera", async () => {
    const OUTRO = "Outro Cliente";
    const OUTRO_SKU = "OUT-GUARDA-1";
    await seedGuard();
    await Promise.all([
      putawayTask("put_guarda_outro", 3, OUTRO, OUTRO_SKU),
      db.collection("stock_balances").doc("bal-guarda-outro-recebimento").set({
        id: "bal-guarda-outro-recebimento",
        customer_code: OUTRO,
        sku_code: OUTRO_SKU,
        client_item_code: "ITEM-GUARDA",
        product_name: "Caneca de teste da guarda",
        location_id: "RECEBIMENTO",
        qty_on_hand: 3,
        qty_reserved: 0,
        qty_available: 3,
        unit_cost: 5,
      }),
    ]);

    // O ator é da BTG: a prateleira dela não serve para a tarefa de outro cliente.
    await assert.rejects(advance("putaway:put_guarda_outro", "planned", guardOperation("A-01", 3)), {
      code: "failed-precondition",
      message: /^Esta posição não é da zona de Outro Cliente\.$/,
    });
    assert.equal((await db.collection("putaway_tasks").doc("put_guarda_outro").get()).get("status"), "planned");
    assert.deepEqual(await balanceAt("A-01", OUTRO, OUTRO_SKU), []);

    const result = (await advance("putaway:put_guarda_outro", "planned", guardOperation("C-01", 3))) as Record<string, unknown>;
    assert.equal(result.status, "completed");
    const task = (await db.collection("putaway_tasks").doc("put_guarda_outro").get()).data();
    assert.equal(task?.status, "completed");
    assert.equal(task?.destination_location_id, "C-01");

    const [source] = await balanceAt("RECEBIMENTO", OUTRO, OUTRO_SKU);
    assert.equal(source?.qty_on_hand, 0);
    const shelf = await balanceAt("C-01", OUTRO, OUTRO_SKU);
    assert.equal(shelf.length, 1);
    assert.equal(shelf[0]?.qty_on_hand, 3);
    // O saldo da BTG não se mexe.
    const [btgSource] = await balanceAt("RECEBIMENTO");
    assert.equal(btgSource?.qty_on_hand, 10);
    assert.deepEqual(await balanceAt("C-01"), []);
  });

  it("recusa origem igual ao destino mesmo com o destino em minúsculas, sem inflar o saldo", async () => {
    await seedGuard();
    await Promise.all([
      putawayTask("put_guarda_4", 5),
      db.collection("stock_balances").doc("bal-guarda-a01").set({
        id: "bal-guarda-a01",
        customer_code: BTG,
        sku_code: SKU,
        client_item_code: "ITEM-GUARDA",
        product_name: "Caneca de teste da guarda",
        location_id: "A-01",
        qty_on_hand: 10,
        qty_reserved: 0,
        qty_available: 10,
        unit_cost: 5,
      }),
    ]);

    await assert.rejects(
      advance("putaway:put_guarda_4", "planned", {
        source_location_id: "A-01",
        destination_location_id: "a-01",
        location_id: "a-01",
        quantity: 5,
      }),
      { code: "failed-precondition", message: /^Endereço de origem e destino não podem ser iguais\.$/ },
    );

    const task = (await db.collection("putaway_tasks").doc("put_guarda_4").get()).data();
    assert.equal(task?.status, "planned");
    const shelf = await balanceAt("A-01");
    assert.equal(shelf.length, 1);
    assert.equal(shelf[0]?.qty_on_hand, 10);
    const [source] = await balanceAt("RECEBIMENTO");
    assert.equal(source?.qty_on_hand, 10);
    assert.equal((await db.collection("movements").where("putaway_task_id", "==", "put_guarda_4").get()).size, 0);
    assert.equal((await db.collection("events").where("entity_id", "==", "put_guarda_4").get()).size, 0);
  });
});
