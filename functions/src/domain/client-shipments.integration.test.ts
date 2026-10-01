import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

import { cancelShipmentNoticeTransaction } from "./client-shipments.js";
import {
  createCustomerRequestTransaction,
  decideCustomerRequestTransaction,
  type OperationalActor,
} from "./operations.js";

const PROJECT_ID = "demo-dute-operations";
const BTG = "BTG Pactual";
const cristiane = { uid: "cli-1", role: "cliente", customer_code: BTG, name: "Cristiane" };
const dutelog: OperationalActor = { uid: "op-1", role: "interno", customer_code: BTG, name: "Operação" };
let db: Firestore;
let app: ReturnType<typeof initializeApp>;

async function notice(key: string) {
  const created = await createCustomerRequestTransaction(
    db,
    {
      type: "recebimento",
      priority: "normal",
      title: "Entrega de Gráfica Alfa",
      customer_code: BTG,
      supplier: "Gráfica Alfa",
      invoice_number: "48213",
      idempotency_key: key,
      items: [{ sku_code: "A.01.0114.004.G", client_item_code: "A.01.0114.004.G", product_name: "CAMISETA", quantity: 300 }],
    } as Parameters<typeof createCustomerRequestTransaction>[1],
    { ...dutelog, role: "cliente", uid: "cli-1" } as OperationalActor,
  );
  return String((created as { id: unknown }).id);
}

before(() => {
  app = initializeApp({ projectId: PROJECT_ID }, "client-shipments-test");
  db = getFirestore(app);
});

beforeEach(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error("FIRESTORE_EMULATOR_HOST não definido.");
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
});

after(async () => {
  await deleteApp(app);
});

describe("cancelar aviso de envio", () => {
  it("a cliente cancela aviso ainda não confirmado; o portal e o evento registram", async () => {
    const id = await notice("n1");
    const result = await cancelShipmentNoticeTransaction(db, { request_id: id, reason: "fornecedor atrasou" }, cristiane);
    assert.deepEqual(result, { ok: true, request_id: id, changed: true });
    const request = (await db.collection("customer_requests").doc(id).get()).data() ?? {};
    assert.equal(request.status, "cancelled");
    assert.equal(request.cancelled_by, "cli-1");
    const portal = (await db.collection("client_request_status").doc(id).get()).data() ?? {};
    assert.equal(portal.status, "cancelled");
    assert.equal(portal.cancel_reason, "fornecedor atrasou");
    const events = await db.collection("events").where("entity_id", "==", id).where("type", "==", "customer_request.cancelled").get();
    assert.equal(events.size, 1);
    // Cancelar de novo não muda nada nem duplica evento.
    assert.equal((await cancelShipmentNoticeTransaction(db, { request_id: id }, cristiane)).changed, false);
  });

  it("depois de cancelado, a Dutelog não consegue confirmar", async () => {
    const id = await notice("n2");
    await cancelShipmentNoticeTransaction(db, { request_id: id }, cristiane);
    await assert.rejects(
      decideCustomerRequestTransaction(db, { request_id: id, action: "approve", expected_status: "open", idempotency_key: "a2" }, dutelog),
    );
  });

  it("aviso já confirmado pela Dutelog não pode ser cancelado", async () => {
    const id = await notice("n3");
    await decideCustomerRequestTransaction(db, { request_id: id, action: "approve", expected_status: "open", idempotency_key: "a3" }, dutelog);
    await assert.rejects(cancelShipmentNoticeTransaction(db, { request_id: id }, cristiane), /já confirmou/);
  });

  it("outro cliente e a equipe interna não cancelam pelo portal", async () => {
    const id = await notice("n4");
    await assert.rejects(
      cancelShipmentNoticeTransaction(db, { request_id: id }, { ...cristiane, customer_code: "Outro" }),
      /outro cliente/,
    );
    await assert.rejects(cancelShipmentNoticeTransaction(db, { request_id: id }, { uid: "op-1", role: "admin", customer_code: BTG }));
  });
});
