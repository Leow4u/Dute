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
