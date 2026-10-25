import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

import { linkInboundNoticeTransaction } from "./inbound-notice.js";
import {
  advanceWarehouseTaskTransaction,
  createCustomerRequestTransaction,
  createInboundReceiptTransaction,
  decideCustomerRequestTransaction,
  updateInboundReceiptConferenceTransaction,
  type OperationalActor,
} from "./operations.js";

const PROJECT_ID = "demo-dute-operations";
const BTG = "BTG Pactual";
const OUTRO = "Outro Cliente";
const operacao: OperationalActor = { uid: "op-1", role: "wms", customer_code: BTG, name: "Operação" };
const coordenacao: OperationalActor = { uid: "coord-1", role: "admin", customer_code: BTG, name: "Coordenação" };
let db: Firestore;
let app: ReturnType<typeof initializeApp>;

async function seed() {
  await Promise.all([
    db.collection("customers").doc("BTG_Pactual").set({
      code: BTG,
      customer_code: BTG,
      name: BTG,
      sku_prefix: "BTG",
      status: "active",
    }),
    db.collection("products").doc("ITEM-1").set({
      id: "ITEM-1",
      customer_code: BTG,
      cod_cliente: "ITEM-1",
      produto: "Camisa social",
      status: "active",
    }),
    db.collection("skus").doc("BTG-TEST-1").set({
      id: "BTG-TEST-1",
      customer_code: BTG,
      cod_cliente: "ITEM-1",
      cod_btg: "BTG-TEST-1",
      sku_code: "BTG-TEST-1",
      produto: "Camisa social",
      status: "active",
    }),
  ]);
}

/** Chegada avulsa registrada na portaria, sem aviso. */
async function arrival(key: string, extra: { supplier?: string; invoice_number?: string } = {}) {
  const created = await createInboundReceiptTransaction(
    db,
    {
      customer_code: BTG,
      ...extra,
      idempotency_key: key,
      items: [
        {
          line_number: 1,
          sku_code: "BTG-TEST-1",
          client_item_code: "ITEM-1",
          product_name: "Camisa social",
          product_registration: "existing",
          location_id: "RECEBIMENTO",
          quantity: 10,
        },
      ],
    },
    operacao,
  );
  return String(created.receipt_id);
}

/** Aviso de envio do portal, com um produto novo (que ganharia SKU na aprovação). */
async function notice(
  key: string,
  extra: { customer_code?: string; supplier?: string; invoice_number?: string } = {},
) {
  const customer = extra.customer_code ?? BTG;
  const created = await createCustomerRequestTransaction(
    db,
    {
      type: "recebimento",
      priority: "normal",
      title: "Entrega de camisas",
      customer_code: customer,
      supplier: "supplier" in extra ? extra.supplier : "Camisaria Alfa",
      invoice_number: "invoice_number" in extra ? extra.invoice_number : "1842",
      idempotency_key: key,
      items: [
        {
          line_number: 1,
          sku_code: "NOVO-1",
          client_item_code: "NOVO-1",
          product_name: "CAMISA NOVA",
          product_registration: "new",
          location_id: "RECEBIMENTO",
          quantity: 10,
        },
      ],
    },
    { uid: "cli-1", role: "cliente", customer_code: customer, name: "Cristiane" },
  );
  return String((created as { id: unknown }).id);
}

function link(receiptId: string, requestId: string | null, customerCode = BTG) {
  return linkInboundNoticeTransaction(
    db,
    { receipt_id: `receiving:${receiptId}`, request_id: requestId, customer_code: customerCode },
    operacao,
  );
}

function approve(requestId: string) {
  return decideCustomerRequestTransaction(
    db,
    { request_id: requestId, action: "approve", expected_status: "open", idempotency_key: `approve-${requestId}` },
    coordenacao,
  ) as Promise<Record<string, unknown>>;
}

async function eventsOf(type: string, entityId: string) {
  const snapshot = await db.collection("events").where("entity_id", "==", entityId).get();
  return snapshot.docs.map((doc) => doc.data()).filter((event) => event.type === type);
}

before(() => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST, "Execute este teste pelo Firebase Emulator.");
  app = initializeApp({ projectId: PROJECT_ID }, `inbound-notice-${Date.now()}`);
  db = getFirestore(app);
});

beforeEach(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  const response = await fetch(`http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, {
    method: "DELETE",
  });
  assert.equal(response.ok, true, await response.text());
  await seed();
});

after(async () => {
  await deleteApp(app);
});

describe("um código novo, um SKU", () => {
  /** Aviso de envio do portal com as linhas dadas, todas de produto novo. */
  async function noticeWith(key: string, lines: Array<{ code: string; quantity: number }>) {
    const created = await createCustomerRequestTransaction(
      db,
      {
        type: "recebimento",
        priority: "normal",
        title: "Entrega de camisas",
        customer_code: BTG,
        supplier: "Camisaria Alfa",
        invoice_number: key,
        idempotency_key: key,
        items: lines.map((line, index) => ({
          line_number: index + 1,
          sku_code: line.code,
          client_item_code: line.code,
          product_name: "CAMISA NOVA",
          product_registration: "new",
          location_id: "RECEBIMENTO",
          quantity: line.quantity,
        })),
      },
      { uid: "cli-1", role: "cliente", customer_code: BTG, name: "Cristiane" },
    );
    return String((created as { id: unknown }).id);
  }

  async function skusOf(requestId: string) {
    const rows = await db.collection("inbound_items").where("customer_request_id", "==", requestId).get();
    return rows.docs.sort((a, b) => Number(a.get("line_number")) - Number(b.get("line_number"))).map((doc) => doc.get("sku_code"));
  }

  /** Confere e conclui o recebimento do aviso aprovado, com o previsto de cada linha. */
  async function receive(requestId: string) {
    const receiptId = `inb_${requestId}`;
    const advance = (expected: string) =>
      advanceWarehouseTaskTransaction(db, { task_uid: `receiving:${receiptId}`, expected_status: expected, idempotency_key: `${receiptId}:${expected}` }, operacao);
    await advance("created");
    const rows = await db.collection("inbound_items").where("receipt_id", "==", receiptId).get();
    await updateInboundReceiptConferenceTransaction(
      db,
      {
        receipt_id: receiptId,
        expected_status: "checking",
        idempotency_key: `conferencia-${receiptId}`,
        lines: rows.docs.map((doc) => ({ inbound_item_id: doc.id, received_qty: Number(doc.get("expected_qty")), location_id: "RECEBIMENTO" })),
      },
      operacao,
    );
    await advance("checking");
  }

  async function catalogOf(clientCode: string) {
    const skus = await db.collection("skus").where("cod_cliente_key", "==", clientCode).get();
    return skus.docs.map((doc) => [doc.id, doc.get("estoque_atual")]);
  }

  it("o mesmo código novo em duas linhas do aviso ganha um SKU só", async () => {
    const requestId = await noticeWith("env-dup", [
      { code: "NOVO-1", quantity: 10 },
      { code: "NOVO-1", quantity: 5 },
    ]);
    await approve(requestId);
    assert.deepEqual(await skusOf(requestId), ["BTG-000001", "BTG-000001"]);
    await receive(requestId);
    assert.deepEqual(await catalogOf("NOVO-1"), [["BTG-000001", 15]]);
  });

  it("a chegada avulsa do código novo de um aviso aprovado usa o SKU do aviso", async () => {
    const requestId = await noticeWith("env-c", [{ code: "NOVO-3", quantity: 10 }]);
    await approve(requestId);
    const created = await createInboundReceiptTransaction(
      db,
      {
        customer_code: BTG,
        idempotency_key: "avulsa-novo-3",
        items: [
          {
            line_number: 1,
            client_item_code: "NOVO-3",
            product_name: "CAMISA NOVA",
            product_registration: "new",
            category: "CAMISAS",
            unit_cost: 50,
            photo_urls: ["https://exemplo.com.br/camisa.jpg"],
            location_id: "RECEBIMENTO",
            quantity: 3,
          },
        ],
      },
      operacao,
    );
    const rows = await db.collection("inbound_items").where("receipt_id", "==", String(created.receipt_id)).get();
    assert.deepEqual(rows.docs.map((doc) => doc.get("sku_code")), ["BTG-000001"]);
  });

  it("o segundo aviso do código novo que ainda não foi recebido usa o SKU do primeiro", async () => {
    const first = await noticeWith("env-a", [{ code: "NOVO-2", quantity: 10 }]);
    const second = await noticeWith("env-b", [{ code: "NOVO-2", quantity: 4 }]);
    await approve(first);
    await approve(second);
    assert.deepEqual([...(await skusOf(first)), ...(await skusOf(second))], ["BTG-000001", "BTG-000001"]);
    await receive(first);
    await receive(second);
    assert.deepEqual(await catalogOf("NOVO-2"), [["BTG-000001", 14]]);
  });
});

describe("linha existente do aviso", () => {
  /** Aviso de envio do portal com uma linha de produto já cadastrado. */
  async function existingNotice(key: string, skuCode: string, clientCode: string) {
    const created = await createCustomerRequestTransaction(
      db,
      {
        type: "recebimento",
        priority: "normal",
        title: "Entrega de camisas",
        customer_code: BTG,
        supplier: "Camisaria Alfa",
        invoice_number: key,
        idempotency_key: key,
        items: [
          { line_number: 1, sku_code: skuCode, client_item_code: clientCode, product_name: "CAMISA", product_registration: "existing", location_id: "RECEBIMENTO", quantity: 3 },
        ],
      },
      { uid: "cli-1", role: "cliente", customer_code: BTG, name: "Cristiane" },
    );
    return String((created as { id: unknown }).id);
  }

  it("o SKU de outro cliente não entra: a aprovação recusa e nada vira recebimento", async () => {
    await db.collection("skus").doc("OUTRO-000001").set({
      id: "OUTRO-000001",
      customer_code: OUTRO,
      cod_cliente: "OUT-1",
      cod_btg: "OUTRO-000001",
      sku_code: "OUTRO-000001",
      produto: "Cadeira do outro cliente",
      status: "active",
    });
    const foreign = await existingNotice("env-alheio", "OUTRO-000001", "OUT-1");
    await assert.rejects(approve(foreign), /O SKU OUTRO-000001 já está cadastrado para o cliente Outro Cliente/);
    assert.equal((await db.collection("customer_requests").doc(foreign).get()).get("status"), "open");
    assert.equal((await db.collection("inbound_items").where("customer_request_id", "==", foreign).get()).size, 0);

    // O SKU do próprio cliente segue para o recebimento.
    const own = await existingNotice("env-proprio", "BTG-TEST-1", "ITEM-1");
    assert.equal((await approve(own)).status, "approved");
  });
});

describe("aviso de envio vinculado à chegada avulsa", () => {
  it("a aprovação usa a chegada vinculada: um recebimento só, sem linhas nem SKU novos", async () => {
    const receiptId = await arrival("avulsa-1", { supplier: "Fornecedor da portaria" });
    const requestId = await notice("env-1");

    assert.equal((await link(receiptId, requestId)).changed, true);
    const linked = (await db.collection("inbound_receipts").doc(receiptId).get()).data() ?? {};
    const requestNumber = String((await db.collection("customer_requests").doc(requestId).get()).get("request_number"));
    assert.equal(linked.customer_request_id, requestId);
    assert.equal(linked.supplier, "Camisaria Alfa");
    assert.equal(linked.invoice_number, "1842");
    assert.equal(linked.request_number, requestNumber);
    const linkedEvents = await eventsOf("inbound.notice_linked", receiptId);
    assert.equal(linkedEvents.length, 1);
    assert.equal(linkedEvents[0]?.entity_type, "recebimento");
    assert.equal(linkedEvents[0]?.actor?.uid, "op-1");
    assert.equal(linkedEvents[0]?.payload?.customer_request_id, requestId);

    const approved = await approve(requestId);
    assert.equal(approved.inbound_id, receiptId);
    assert.equal(approved.receipt_number, linked.receipt_number);

    // Nenhum segundo recebimento para a mesma mercadoria.
    assert.equal((await db.collection("inbound_receipts").doc(`inb_${requestId}`).get()).exists, false);
    const receipts = await db.collection("inbound_receipts").where("customer_request_id", "==", requestId).get();
    assert.deepEqual(receipts.docs.map((doc) => doc.id), [receiptId]);
    const noticeItems = await db.collection("inbound_items").where("customer_request_id", "==", requestId).get();
    assert.equal(noticeItems.size, 0);
    const receiptItems = await db.collection("inbound_items").where("receipt_id", "==", receiptId).get();
    assert.equal(receiptItems.size, 1);
    // O produto novo do aviso não gastou número de SKU.
    assert.equal((await db.collection("sku_counters").doc("BTG").get()).exists, false);
    assert.equal((await db.collection("skus").get()).size, 1);

    const request = (await db.collection("customer_requests").doc(requestId).get()).data() ?? {};
    assert.equal(request.status, "approved");
    assert.equal(request.operational_status, "receiving_created");
    assert.equal(request.created_entities?.inbound_id, receiptId);
    assert.equal(request.created_entities?.receipt_number, linked.receipt_number);
    const portal = (await db.collection("client_request_status").doc(requestId).get()).data() ?? {};
    assert.equal(portal.status, "approved");
    assert.equal(portal.operational_status, "receiving_created");

    assert.equal((await eventsOf("inbound.created", `inb_${requestId}`)).length, 0);
    const approvedEvents = await eventsOf("inbound.notice_approved", receiptId);
    assert.equal(approvedEvents.length, 1);
    assert.equal(approvedEvents[0]?.payload?.customer_request_id, requestId);
    assert.equal(approvedEvents[0]?.payload?.linked_receipt, true);
    const decision = await eventsOf("customer_request.approved", requestId);
    assert.equal(decision[0]?.payload?.inbound_id, receiptId);

    // Aprovado com esta chegada, o vínculo não se desfaz nem troca.
    await assert.rejects(link(receiptId, null), /já foi aprovado com esta chegada/);
    const other = await notice("env-1b");
    await assert.rejects(link(receiptId, other), /já foi aprovado com esta chegada/);
  });

  it("chegada já conferida antes da aprovação: o portal continua em recebido", async () => {
    const receiptId = await arrival("avulsa-2");
    const requestId = await notice("env-2");
    await link(receiptId, requestId);

    const advance = (expected: string) =>
      advanceWarehouseTaskTransaction(
        db,
        { task_uid: `receiving:${receiptId}`, expected_status: expected, idempotency_key: `${receiptId}:${expected}` },
        operacao,
      );
    await advance("created");
    const rows = await db.collection("inbound_items").where("receipt_id", "==", receiptId).get();
    await updateInboundReceiptConferenceTransaction(
      db,
      {
        receipt_id: receiptId,
        expected_status: "checking",
        idempotency_key: "conferencia-2",
        lines: rows.docs.map((doc) => ({ inbound_item_id: doc.id, received_qty: 10, location_id: "RECEBIMENTO" })),
      },
      operacao,
    );
    await advance("checking");

    const approved = await approve(requestId);
    assert.equal(approved.inbound_id, receiptId);
    const request = (await db.collection("customer_requests").doc(requestId).get()).data() ?? {};
    assert.equal(request.status, "approved");
    assert.equal(request.operational_status, "received");
    const portal = (await db.collection("client_request_status").doc(requestId).get()).data() ?? {};
    assert.equal(portal.status, "closed");
    assert.equal(portal.operational_status, "received");
    assert.equal(portal.qty_received, 10);
    assert.equal((await db.collection("inbound_receipts").doc(`inb_${requestId}`).get()).exists, false);
  });

  it("aviso recusado ou cancelado com a chegada vinculada: receber a chegada não reabre o aviso no portal", async () => {
    const rejectedArrival = await arrival("avulsa-6a");
    const cancelledArrival = await arrival("avulsa-6b");
    const rejected = await notice("env-6a");
    const cancelled = await notice("env-6b");
    await link(rejectedArrival, rejected);
    await link(cancelledArrival, cancelled);

    await decideCustomerRequestTransaction(
      db,
      { request_id: rejected, action: "reject", reason: "NF divergente", expected_status: "open", idempotency_key: "reject-6a" },
      coordenacao,
    );
    await decideCustomerRequestTransaction(
      db,
      { request_id: cancelled, action: "cancel", expected_status: "open", idempotency_key: "cancel-6b" },
      { uid: "cli-1", role: "cliente", customer_code: BTG, name: "Cristiane" },
    );

    for (const [receiptId, requestId, status] of [
      [rejectedArrival, rejected, "rejected"],
      [cancelledArrival, cancelled, "cancelled"],
    ] as const) {
      const advance = (expected: string) =>
        advanceWarehouseTaskTransaction(
          db,
          { task_uid: `receiving:${receiptId}`, expected_status: expected, idempotency_key: `${receiptId}:${expected}` },
          operacao,
        );
      await advance("created");
      const rows = await db.collection("inbound_items").where("receipt_id", "==", receiptId).get();
      await updateInboundReceiptConferenceTransaction(
        db,
        {
          receipt_id: receiptId,
          expected_status: "checking",
          idempotency_key: `conferencia-${receiptId}`,
          lines: rows.docs.map((doc) => ({ inbound_item_id: doc.id, received_qty: 10, location_id: "RECEBIMENTO" })),
        },
        operacao,
      );
      await advance("checking");

      // A chegada entra no estoque normalmente.
      const receipt = (await db.collection("inbound_receipts").doc(receiptId).get()).data() ?? {};
      assert.equal(receipt.status, "received");
      assert.equal(receipt.qty_received, 10);
      assert.equal((await eventsOf("inventory.received", receiptId)).length, 1);

      // O aviso e o portal continuam com a decisão.
      const request = (await db.collection("customer_requests").doc(requestId).get()).data() ?? {};
      assert.equal(request.status, status);
      assert.notEqual(request.operational_status, "received");
      const portal = (await db.collection("client_request_status").doc(requestId).get()).data() ?? {};
      assert.equal(portal.status, status);
      assert.notEqual(portal.operational_status, "received");
      assert.equal(portal.qty_received, undefined);
    }
  });

  it("aviso já vinculado a outra chegada não se vincula de novo", async () => {
    const first = await arrival("avulsa-3a");
    const second = await arrival("avulsa-3b");
    const requestId = await notice("env-3");
    await link(first, requestId);
    const firstNumber = String((await db.collection("inbound_receipts").doc(first).get()).get("receipt_number"));

    await assert.rejects(link(second, requestId), (error: Error) => {
      assert.equal(error.message, `Este aviso já está vinculado à chegada ${firstNumber}.`);
      return true;
    });
    const secondData = (await db.collection("inbound_receipts").doc(second).get()).data() ?? {};
    assert.equal(secondData.customer_request_id, undefined);
    // Vincular de novo à mesma chegada não muda nada nem grava outro evento.
    assert.equal((await link(first, requestId)).changed, false);
    assert.equal((await eventsOf("inbound.notice_linked", first)).length, 1);
  });

  it("desvincular grava evento e devolve fornecedor, NF e número de antes do vínculo", async () => {
    const receiptId = await arrival("avulsa-4", { supplier: "Fornecedor da portaria", invoice_number: "77" });
    const noticeA = await notice("env-4a");
    const noticeB = await notice("env-4b", { supplier: "Malharia Beta", invoice_number: "" });
    const numberB = String((await db.collection("customer_requests").doc(noticeB).get()).get("request_number"));

    await link(receiptId, noticeA);
    await link(receiptId, noticeB);
    const relinked = (await db.collection("inbound_receipts").doc(receiptId).get()).data() ?? {};
    assert.equal(relinked.customer_request_id, noticeB);
    assert.equal(relinked.supplier, "Malharia Beta");
    // O aviso B não tem NF: fica a da própria chegada, não a do aviso A.
    assert.equal(relinked.invoice_number, "77");
    assert.equal(relinked.request_number, numberB);
    assert.deepEqual(relinked.notice_prelink, { supplier: "Fornecedor da portaria", invoice_number: "77" });

    assert.equal((await link(receiptId, null)).changed, true);
    const restored = (await db.collection("inbound_receipts").doc(receiptId).get()).data() ?? {};
    assert.equal(restored.supplier, "Fornecedor da portaria");
    assert.equal(restored.invoice_number, "77");
    assert.equal("request_number" in restored, false);
    assert.equal("customer_request_id" in restored, false);
    assert.equal("notice_prelink" in restored, false);

    const unlinked = await eventsOf("inbound.notice_unlinked", receiptId);
    assert.equal(unlinked.length, 1);
    assert.equal(unlinked[0]?.entity_type, "recebimento");
    assert.equal(unlinked[0]?.actor?.uid, "op-1");
    assert.equal(unlinked[0]?.payload?.customer_request_id, noticeB);
    assert.equal((await eventsOf("inbound.notice_linked", receiptId)).length, 2);

    // Já sem vínculo: desvincular de novo não muda nada nem grava evento.
    assert.equal((await link(receiptId, null)).changed, false);
    assert.equal((await eventsOf("inbound.notice_unlinked", receiptId)).length, 1);

    // Sem vínculo, o aviso é aprovado do jeito de sempre, com recebimento próprio.
    const approved = await approve(noticeA);
    assert.equal(approved.inbound_id, `inb_${noticeA}`);
    assert.equal((await db.collection("inbound_items").where("receipt_id", "==", `inb_${noticeA}`).get()).size, 1);
    assert.equal((await db.collection("sku_counters").doc("BTG").get()).get("last_code"), "BTG-000001");
  });

  it("recusa aviso de outro cliente e chegada prevista", async () => {
    const receiptId = await arrival("avulsa-5");
    const foreign = await notice("env-5", { customer_code: OUTRO });
    await assert.rejects(link(receiptId, foreign), /Aviso de outro cliente/);
    await assert.rejects(link(receiptId, foreign, OUTRO), /Chegada de outro cliente/);
    assert.equal((await db.collection("inbound_receipts").doc(receiptId).get()).get("customer_request_id"), undefined);

    // A chegada prevista nasce do aviso aprovado e não troca de aviso.
    const approvedNotice = await notice("env-5b");
    await approve(approvedNotice);
    const open = await notice("env-5c");
    await assert.rejects(link(`inb_${approvedNotice}`, open), /Só a chegada avulsa/);
    await assert.rejects(link(`inb_${approvedNotice}`, null), /Só a chegada avulsa/);
  });
});
