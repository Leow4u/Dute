import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

import { cancelInboundReceiptTransaction } from "./inbound-cancel.js";
import {
  completeInboundBoxReceipt,
  confirmInboundBoxDestination,
  saveInboundBoxLine,
  setInboundBoxState,
  startInboundBox,
} from "./inbound-boxes.js";
import { linkInboundNoticeTransaction } from "./inbound-notice.js";
import {
  advanceWarehouseTaskTransaction,
  createCustomerRequestTransaction,
  createInboundReceiptTransaction,
  decideCustomerRequestTransaction,
  updateInboundReceiptConferenceTransaction,
  type OperationalActor,
} from "./operations.js";
import { seedDefaultWarehouseLayout, upsertWarehousePositions } from "./warehouse-positions.js";
import { removeWarehouseBox } from "./warehouse-boxes.js";

/** Cancela o processo anterior à entrada, preservando rascunho, catálogo e razão. */
const PROJECT_ID = "demo-dute-operations";
const ALFA = "Uniformes Alfa";
const BETA = "Uniformes Beta";
const PREFIX: Record<string, string> = { [ALFA]: "UNI", [BETA]: "UNB" };
const operacao: OperationalActor = { uid: "cancel-op", role: "wms", name: "Operador" };
const coordenacao: OperationalActor = { uid: "cancel-admin", role: "admin", name: "Coordenação" };
const MEASURES = { length_m: 0.48, width_m: 0.38, height_m: 0.3, gross_weight_kg: 9.4 };
type Row = Record<string, any>;
type Receipt = { id: string; number: string; customer: string; item: string };
let db: Firestore;
let app: ReturnType<typeof initializeApp>;
let nonce = 0;
const key = (label: string) => `cancel-${label}-${++nonce}`;

before(() => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST, "Execute este teste pelo Firebase Emulator.");
  app = initializeApp({ projectId: PROJECT_ID }, `inbound-cancel-${Date.now()}`);
  db = getFirestore(app);
});

beforeEach(async () => {
  const response = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
  assert.equal(response.ok, true, await response.text());
  await seedDefaultWarehouseLayout(db, coordenacao);
  for (const [customer, id] of [[ALFA, "uniformes_alfa"], [BETA, "uniformes_beta"]] as const) {
    const prefix = PREFIX[customer]!;
    await db.collection("customers").doc(id).set({ code: customer, customer_code: customer, name: customer, sku_prefix: prefix, status: "active", operation_template: "uniformes" });
    await db.collection("products").doc(`${prefix}.POLO.XG`).set({ id: `${prefix}.POLO.XG`, customer_code: customer, cod_cliente: `${prefix}.POLO.XG`, produto: "Polo XG", status: "active", estoque_btg: 0 });
    await db.collection("skus").doc(`${prefix}-000001`).set({ id: `${prefix}-000001`, customer_code: customer, cod_cliente: `${prefix}.POLO.XG`, cod_btg: `${prefix}-000001`, sku_code: `${prefix}-000001`, produto: "Polo XG", status: "active", estoque_atual: 0 });
  }
  await upsertWarehousePositions(db, { positions: [{ aisle: "A", shelf: 1, length_m: 1.8, depth_m: 0.75, height_m: 0.65, customer_code: ALFA }] }, coordenacao);
});

after(async () => { await deleteApp(app); });

async function row(collection: string, id: string): Promise<Row> {
  return (await db.collection(collection).doc(id).get()).data() ?? {};
}
async function rows(collection: string): Promise<Row[]> {
  return (await db.collection(collection).get()).docs.map((doc) => ({ id: doc.id, ...doc.data() })).sort((a, b) => String(a.id).localeCompare(String(b.id)));
}
async function snapshot(collections: string[]) {
  return Object.fromEntries(await Promise.all(collections.map(async (collection) => [collection, await rows(collection)])));
}
const STOCK = ["products", "skus", "sku_counters", "catalog_prices", "movements", "stock_balances", "client_inventory", "putaway_tasks", "billing_periods", "faturas"];
const ALL = [...STOCK, "inbound_receipts", "inbound_items", "warehouse_boxes", "warehouse_counters", "warehouse_positions", "events", "operational_operations", "customer_requests", "client_request_status"];

async function receipt(mode: "per_box" | "per_line" = "per_box", customer = ALFA): Promise<Receipt> {
  const prefix = PREFIX[customer]!;
  const created = await createInboundReceiptTransaction(db, {
    customer_code: customer,
    supplier: "Fornecedor da portaria",
    invoice_number: "0048230",
    notes: "Anexo e conferência devem ficar no histórico",
    received_at: "2026-11-04T12:00:00.000Z",
    conference_mode: mode,
    idempotency_key: key("create"),
    items: [{ line_number: 1, sku_code: `${prefix}-000001`, client_item_code: `${prefix}.POLO.XG`, product_name: "Polo XG", product_registration: "existing", size: "XG", quantity: 10, location_id: "RECEBIMENTO" }],
  }, operacao, { boxReceivingEnabled: true });
  const items = await db.collection("inbound_items").where("receipt_id", "==", created.receipt_id).get();
  assert.equal(items.size, 1);
  return { id: String(created.receipt_id), number: String(created.receipt_number), customer, item: items.docs[0]!.id };
}
function cancellation(r: Receipt, extra: Row = {}) {
  return { receipt_id: r.id, customer_code: r.customer, expected_status: "created", reason: "mistake", idempotency_key: key("cancel"), ...extra };
}
function cancel(r: Receipt, extra: Row = {}, actor: OperationalActor = operacao) {
  return cancelInboundReceiptTransaction(db, cancellation(r, extra), actor) as Promise<Row>;
}
async function events(type = "inbound.cancelled") {
  return (await rows("events")).filter((event) => event.type === type);
}
async function start(r: Receipt) {
  const result = await startInboundBox(db, { receipt_id: r.id, idempotency_key: key("box") }, operacao) as Row;
  return String(result.box.code);
}
async function revision(code: string) { return Number((await row("warehouse_boxes", code)).conference_revision); }
async function line(r: Receipt, code: string, quantity = 10) {
  return saveInboundBoxLine(db, { receipt_id: r.id, box_code: code, inbound_item_id: r.item, counted_qty: quantity, expected_revision: await revision(code), idempotency_key: key("line") }, operacao);
}
async function close(r: Receipt, code: string) {
  return setInboundBoxState(db, { action: "close", receipt_id: r.id, box_code: code, ...MEASURES, expected_revision: await revision(code), idempotency_key: key("close") }, operacao);
}
async function confirm(r: Receipt, code: string) {
  return confirmInboundBoxDestination(db, { receipt_id: r.id, box_code: code, location_id: "A-01", expected_revision: await revision(code), idempotency_key: key("confirm") }, operacao);
}
async function box(r: Receipt, status: "counting" | "reviewed" | "committing") {
  const code = await start(r);
  await line(r, code);
  if (status !== "counting") await close(r, code);
  if (status === "committing") await confirm(r, code);
  return code;
}
async function confer(r: Receipt) {
  await advanceWarehouseTaskTransaction(db, { task_uid: `receiving:${r.id}`, expected_status: "created", idempotency_key: key("checking") }, operacao);
  await updateInboundReceiptConferenceTransaction(db, {
    receipt_id: r.id, expected_status: "checking", idempotency_key: key("conference"),
    lines: [{ inbound_item_id: r.item, received_qty: 10, location_id: "RECEBIMENTO" }],
  }, operacao);
}
async function linkedNotice(r: Receipt) {
  const prefix = PREFIX[r.customer]!;
  const result = await createCustomerRequestTransaction(db, {
    type: "recebimento", priority: "normal", title: "Entrega de polos", customer_code: r.customer,
    supplier: "Fornecedor do aviso", invoice_number: "DOC-AVISO", idempotency_key: key("notice"),
    items: [{ line_number: 1, sku_code: `${prefix}-000001`, client_item_code: `${prefix}.POLO.XG`, product_name: "Polo XG", product_registration: "existing", quantity: 10, location_id: "RECEBIMENTO" }],
  }, { uid: "cliente-alfa", role: "cliente", customer_code: r.customer }) as Row;
  const id = String(result.id);
  await linkInboundNoticeTransaction(db, { receipt_id: `receiving:${r.id}`, request_id: id, customer_code: r.customer }, operacao);
  return id;
}
function approve(id: string) {
  return decideCustomerRequestTransaction(db, { request_id: id, action: "approve", expected_status: "open", idempotency_key: key("approve") }, coordenacao) as Promise<Row>;
}
async function assertRejectedWithoutWrites(action: () => Promise<unknown>, code = "failed-precondition") {
  const before = await snapshot(ALL);
  await assert.rejects(action, { code });
  assert.deepEqual(await snapshot(ALL), before, "a recusa não pode deixar mutação parcial");
}

describe("cancelar a chegada antes da entrada", () => {
  it("cancela linha já conferida e preserva quantidades, documento e catálogo sem mexer em estoque nem cobrança", async () => {
    const r = await receipt("per_line");
    await confer(r);
    const receiptBefore = await row("inbound_receipts", r.id);
    const itemBefore = await row("inbound_items", r.item);
    assert.equal(receiptBefore.qty_received, 10);
    assert.ok(receiptBefore.received_at);
    const untouched = await snapshot(STOCK);

    const result = await cancel(r, { expected_status: "checking", reason: "other", note: "Lançamento de treinamento" });
    assert.equal(result.ok, true);
    assert.equal(result.receipt_id, r.id);
    assert.equal(result.status, "cancelled");
    const cancelled = await row("inbound_receipts", r.id);
    assert.equal(cancelled.status, "cancelled");
    assert.ok(cancelled.cancelled_at);
    assert.equal(cancelled.cancelled_by.uid, operacao.uid);
    assert.equal(cancelled.cancellation_reason, "other");
    assert.equal(cancelled.cancellation_note, "Lançamento de treinamento");
    assert.equal(cancelled.cancellation_previous_status, "checking");
    for (const field of ["supplier", "invoice_number", "notes", "qty_expected", "qty_received", "received_at"]) assert.deepEqual(cancelled[field], receiptBefore[field], field);
    const item = await row("inbound_items", r.item);
    assert.equal(item.status, "cancelled");
    for (const field of ["expected_qty", "received_qty", "checked_at", "sku_code", "client_item_code", "product_name"]) assert.deepEqual(item[field], itemBefore[field], field);
    assert.deepEqual(await snapshot(STOCK), untouched);
    const audit = await events();
    assert.equal(audit.length, 1);
    assert.equal(audit[0]!.entity_id, r.id);
    assert.equal(audit[0]!.entity_type, "recebimento");
    assert.equal(audit[0]!.severity, "info");
    assert.equal((await rows("ai_agent_inbox")).filter((entry) => entry.event_id === audit[0]!.id).length, 0);
    assert.equal((await events("inventory.received")).length, 0);
    assert.equal((await events("inventory.arrival_stored")).length, 0);
  });

  for (const status of ["counting", "reviewed", "committing"] as const) {
    it(`preserva a caixa ${status} e seu conteúdo; encerra a reserva sem reutilizar o número CX`, async () => {
      const r = await receipt();
      const code = await box(r, status);
      const before = await row("warehouse_boxes", code);
      const itemBefore = await row("inbound_items", r.item);
      const counter = await row("warehouse_counters", "boxes");
      const positionBefore = await row("warehouse_positions", "A-01");
      const untouched = await snapshot(STOCK);
      await cancel(r);
      const cancelled = await row("warehouse_boxes", code);
      assert.equal(cancelled.status, "cancelled");
      assert.equal(cancelled.cancellation_previous_status, status);
      for (const field of ["lines", "draft_line_count", "draft_unit_count", "length_m", "width_m", "height_m", "gross_weight_kg", "receipt_id"]) assert.deepEqual(cancelled[field], before[field], field);
      assert.equal(Number(cancelled.conference_revision), Number(before.conference_revision) + 1);
      assert.ok(!cancelled.location_id);
      assert.ok(!cancelled.destination_location_id);
      for (const field of ["front_m", "depth_m", "placed_height_m", "orientation", "support_box_code", "base_height_m"]) assert.ok(!cancelled[field], field);
      if (status === "committing") {
        assert.equal(cancelled.cancellation_previous_location_id, "A-01");
        assert.equal(cancelled.cancellation_previous_destination_location_id, "A-01");
      }
      assert.deepEqual(await row("warehouse_counters", "boxes"), counter);
      assert.deepEqual((await row("inbound_items", r.item)).boxed_qty, itemBefore.boxed_qty);
      assert.deepEqual((await row("inbound_items", r.item)).box_codes, itemBefore.box_codes);
      const positionAfter = await row("warehouse_positions", "A-01");
      assert.equal(Number(positionAfter.occupancy_revision ?? 0), Number(positionBefore.occupancy_revision ?? 0) + (status === "committing" ? 1 : 0));
      assert.deepEqual(await snapshot(STOCK), untouched);
    });
  }

  it("duplicata referencia a original do mesmo cliente sem mudar a original nem o estoque que ela já possui", async () => {
    const original = await receipt("per_line");
    await confer(original);
    await advanceWarehouseTaskTransaction(db, { task_uid: `receiving:${original.id}`, expected_status: "checking", idempotency_key: key("receive-original") }, operacao);
    const duplicate = await receipt();
    const originalBefore = await row("inbound_receipts", original.id);
    const untouched = await snapshot(STOCK);
    await cancel(duplicate, { reason: "duplicate", duplicate_of_receipt_id: original.id });
    const cancelled = await row("inbound_receipts", duplicate.id);
    assert.equal(cancelled.duplicate_of_receipt_id, original.id);
    assert.equal(cancelled.duplicate_of_receipt_number, original.number);
    assert.deepEqual(await row("inbound_receipts", original.id), originalBefore);
    assert.deepEqual(await snapshot(STOCK), untouched);
  });

  it("cancela todas as caixas da chegada e libera a posição compartilhada uma vez", async () => {
    const r = await receipt();
    const first = await box(r, "committing");
    const second = await box(r, "committing");
    const positionBefore = await row("warehouse_positions", "A-01");
    await cancel(r);
    for (const code of [first, second]) {
      const stored = await row("warehouse_boxes", code);
      assert.equal(stored.status, "cancelled");
      assert.equal(stored.lines[0].counted_qty, 10);
      assert.equal(stored.cancellation_previous_location_id, "A-01");
      assert.equal(stored.location_id, "");
    }
    assert.equal((await row("warehouse_positions", "A-01")).occupancy_revision, Number(positionBefore.occupancy_revision) + 1);
    assert.equal((await events()).length, 1);
    assert.equal((await rows("movements")).length, 0);
  });

  it("desvincula aviso aberto e mantém o aviso disponível para a chegada correta", async () => {
    const r = await receipt();
    const requestId = await linkedNotice(r);
    const linkedBefore = await row("inbound_receipts", r.id);
    const requestBefore = await snapshot(["customer_requests", "client_request_status"]);
    await cancel(r);
    const cancelled = await row("inbound_receipts", r.id);
    assert.ok(!cancelled.customer_request_id);
    assert.equal(cancelled.cancelled_customer_request_id, requestId);
    for (const field of ["supplier", "invoice_number", "request_number", "notice_prelink"]) assert.deepEqual(cancelled[field], linkedBefore[field], field);
    assert.deepEqual(await snapshot(["customer_requests", "client_request_status"]), requestBefore);
    const correct = await receipt();
    await linkInboundNoticeTransaction(db, { receipt_id: `receiving:${correct.id}`, request_id: requestId, customer_code: correct.customer }, operacao);
    assert.equal((await row("inbound_receipts", correct.id)).customer_request_id, requestId);
  });

  it("recusa cancelar o vínculo já aprovado sem tocar aviso, chegada ou portal", async () => {
    const r = await receipt();
    const notice = await linkedNotice(r);
    assert.equal((await approve(notice)).inbound_id, r.id);
    await assertRejectedWithoutWrites(() => cancel(r));
  });

  it("a remoção genérica de caixa não apaga o histórico cancelado, mesmo sem saldo publicado", async () => {
    const r = await receipt();
    const code = await box(r, "counting");
    await cancel(r);
    const before = await row("warehouse_boxes", code);
    assert.equal(before.line_count, 0);
    assert.equal(before.unit_count, 0);
    await assertRejectedWithoutWrites(() => removeWarehouseBox(db, { code, customer_code: r.customer }, operacao));
    assert.deepEqual(await row("warehouse_boxes", code), before);
  });
});

describe("barreiras do cancelamento", () => {
  for (const role of ["owner", "admin", "interno", "wms"]) {
    it(`permite o papel ${role} cancelar uma avulsa sem entrada`, async () => {
      const r = await receipt();
      assert.equal((await cancel(r, {}, { uid: `ator-${role}`, role })).status, "cancelled");
    });
  }

  for (const role of ["cliente", "financeiro", "comercial", "campo", "painel"]) {
    it(`nega ${role} antes de qualquer escrita`, async () => {
      const r = await receipt();
      await assertRejectedWithoutWrites(() => cancel(r, {}, { uid: `ator-${role}`, role, customer_code: r.customer }), "permission-denied");
    });
  }

  it("recusa cliente ativo diferente e chegada que não é avulsa", async () => {
    const r = await receipt();
    await assertRejectedWithoutWrites(() => cancel(r, { customer_code: BETA }), "permission-denied");
    await db.collection("inbound_receipts").doc(r.id).update({ source: "customer_request" });
    await assertRejectedWithoutWrites(() => cancel(r));
  });

  it("recusa estado esperado desatualizado e estoque congelado", async () => {
    const r = await receipt();
    await assertRejectedWithoutWrites(() => cancel(r, { expected_status: "checking" }), "aborted");
    await db.collection("system_controls").doc("inventory").set({ movements_frozen: true });
    await assertRejectedWithoutWrites(() => cancel(r));
  });

  it("outro motivo exige explicação e duplicidade exige uma original válida", async () => {
    const r = await receipt();
    await assertRejectedWithoutWrites(() => cancel(r, { reason: "other", note: "   " }), "invalid-argument");
    await assertRejectedWithoutWrites(() => cancel(r, { reason: "duplicate" }), "invalid-argument");
    await assertRejectedWithoutWrites(() => cancel(r, { reason: "duplicate", duplicate_of_receipt_id: r.id }), "invalid-argument");
    await assertRejectedWithoutWrites(() => cancel(r, { reason: "duplicate", duplicate_of_receipt_id: "inexistente" }), "not-found");
    const foreign = await receipt("per_box", BETA);
    await assertRejectedWithoutWrites(() => cancel(r, { reason: "duplicate", duplicate_of_receipt_id: foreign.id }), "permission-denied");
    const alreadyCancelled = await receipt();
    await cancel(alreadyCancelled);
    await assertRejectedWithoutWrites(() => cancel(r, { reason: "duplicate", duplicate_of_receipt_id: alreadyCancelled.id }));
  });

  it("recusa depois da entrada real por linha, preservando saldo, movimento e guarda", async () => {
    const r = await receipt("per_line");
    await confer(r);
    await advanceWarehouseTaskTransaction(db, { task_uid: `receiving:${r.id}`, expected_status: "checking", idempotency_key: key("receive") }, operacao);
    assert.equal((await row("inbound_receipts", r.id)).status, "received");
    assert.ok((await rows("movements")).length > 0);
    assert.ok((await rows("putaway_tasks")).length > 0);
    await assertRejectedWithoutWrites(() => cancel(r, { expected_status: "checking" }));
  });

  const evidence: Array<{ name: string; seed: (r: Receipt) => Promise<unknown> }> = [
    { name: "status recebido", seed: (r) => db.collection("inbound_receipts").doc(r.id).update({ status: "received" }) },
    { name: "status concluído", seed: (r) => db.collection("inbound_receipts").doc(r.id).update({ status: "completed" }) },
    { name: "item já recebido", seed: (r) => db.collection("inbound_items").doc(r.item).update({ status: "received" }) },
    { name: "movimento vinculado", seed: (r) => db.collection("movements").doc("entrada-antiga").set({ receipt_id: r.id, customer_code: r.customer, sku_code: "UNI-000001", type: "ENTRADA", quantity: 10, source: "wms_receiving" }) },
    { name: "tarefa de guarda vinculada", seed: (r) => db.collection("putaway_tasks").doc("guarda-antiga").set({ receipt_id: r.id, inbound_item_id: r.item, customer_code: r.customer, status: "pending", quantity: 10 }) },
    { name: "caixa armazenada", seed: async (r) => { const code = await box(r, "counting"); await db.collection("warehouse_boxes").doc(code).update({ status: "stored" }); } },
    { name: "conteúdo de caixa já publicado", seed: async (r) => { const code = await box(r, "counting"); await db.collection("warehouse_boxes").doc(code).update({ line_count: 1, unit_count: 10 }); } },
  ];
  for (const scenario of evidence) {
    it(`recusa inconsistência com ${scenario.name}, mesmo sem saldo consultável`, async () => {
      const r = await receipt();
      await scenario.seed(r);
      assert.equal((await rows("stock_balances")).length, 0);
      await assertRejectedWithoutWrites(() => cancel(r));
    });
  }

  it("não recria uma posição apagada ao soltar a reserva", async () => {
    const r = await receipt();
    const code = await box(r, "committing");
    await db.collection("warehouse_positions").doc("A-01").delete();
    await cancel(r);
    assert.equal((await db.collection("warehouse_positions").doc("A-01").get()).exists, false);
    assert.equal((await row("warehouse_boxes", code)).status, "cancelled");
    assert.ok(!(await row("warehouse_boxes", code)).location_id);
  });

  it("recusa reserva que serve de apoio, mas aceita referências históricas sem ocupação", async () => {
    const r = await receipt();
    const code = await box(r, "committing");
    const upper = db.collection("warehouse_boxes").doc("CX-009999");
    await upper.set({ customer_code: r.customer, support_box_code: code, status: "stored", location_id: "A-01", line_count: 1, unit_count: 1 });
    await assertRejectedWithoutWrites(() => cancel(r));
    await upper.update({ status: "cancelled", location_id: "", line_count: 0, unit_count: 0 });
    const before = await row("warehouse_boxes", "CX-009999");
    await cancel(r);
    assert.deepEqual(await row("warehouse_boxes", "CX-009999"), before);
    assert.equal((await row("warehouse_boxes", code)).status, "cancelled");
  });
});

describe("replay e concorrência do cancelamento", () => {
  it("mesma chave repete resultado; outra chave não troca motivo nem duplica o evento", async () => {
    const r = await receipt();
    const input = cancellation(r, { reason: "other", note: "Conferência de treinamento" });
    const first = await cancelInboundReceiptTransaction(db, input, operacao);
    const before = await snapshot(ALL);
    assert.deepEqual(await cancelInboundReceiptTransaction(db, input, operacao), first);
    assert.deepEqual(await snapshot(ALL), before);
    await assertRejectedWithoutWrites(() => cancelInboundReceiptTransaction(db, { ...input, note: "Outro conteúdo" }, operacao), "already-exists");
    const receiptBefore = await row("inbound_receipts", r.id);
    const second = await cancel(r);
    assert.equal(second.already_cancelled, true);
    assert.deepEqual(await row("inbound_receipts", r.id), receiptBefore);
    assert.equal((await events()).length, 1);
  });

  it("dois cancelamentos simultâneos encerram uma vez e liberam uma reserva só", async () => {
    const r = await receipt();
    await box(r, "committing");
    const before = Number((await row("warehouse_positions", "A-01")).occupancy_revision ?? 0);
    const results = await Promise.all([cancel(r), cancel(r)]);
    assert.ok(results.every((result) => result.status === "cancelled"));
    assert.equal(results.filter((result) => result.already_cancelled === true).length, 1);
    assert.equal((await events()).length, 1);
    assert.equal(Number((await row("warehouse_positions", "A-01")).occupancy_revision), before + 1);
  });

  it("cancelar versus concluir: só um termina e nunca há entrada para a chegada cancelada", async () => {
    const r = await receipt();
    await box(r, "committing");
    const results = await Promise.allSettled([
      cancel(r),
      completeInboundBoxReceipt(db, { receipt_id: r.id, expected_status: "created", idempotency_key: key("complete") }, operacao),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    const status = (await row("inbound_receipts", r.id)).status;
    assert.ok(status === "cancelled" || status === "received");
    const movements = (await rows("movements")).filter((movement) => movement.receipt_id === r.id);
    assert.equal(movements.length, status === "cancelled" ? 0 : 1);
    assert.equal((await events()).length, status === "cancelled" ? 1 : 0);
  });

  for (const action of ["iniciar", "salvar", "fechar", "confirmar"] as const) {
    it(`cancelar versus ${action} caixa não deixa rascunho ou reserva ativos`, async () => {
      const r = await receipt();
      const code = action === "iniciar" ? undefined : await box(r, action === "confirmar" ? "reviewed" : "counting");
      const work = action === "iniciar" ? () => start(r)
        : action === "salvar" ? () => line(r, code!, 7)
          : action === "fechar" ? () => close(r, code!)
            : () => confirm(r, code!);
      const results = await Promise.allSettled([cancel(r), work()]);
      assert.equal(results[0]!.status, "fulfilled");
      if (results[1]!.status === "rejected") assert.equal(results[1]!.reason.code, "failed-precondition");
      assert.equal((await row("inbound_receipts", r.id)).status, "cancelled");
      const boxes = (await rows("warehouse_boxes")).filter((entry) => entry.origin?.receipt_id === r.id);
      for (const entry of boxes) {
        assert.equal(entry.status, "cancelled");
        assert.ok(!entry.location_id);
        assert.ok(!entry.destination_location_id);
        if (action === "salvar" && results[1]!.status === "fulfilled") assert.equal(entry.lines[0].counted_qty, 7);
      }
      if (code) assert.equal((await row("warehouse_boxes", code)).status, "cancelled");
      if (action === "iniciar" && results[1]!.status === "fulfilled") {
        assert.equal((await row("warehouse_boxes", String(results[1]!.value))).status, "cancelled");
      }
      assert.equal((await rows("movements")).length, 0);
      assert.equal((await rows("putaway_tasks")).length, 0);
      assert.equal((await events()).length, 1);
    });
  }

  it("cancelar versus aprovar aviso nunca aprova usando uma chegada cancelada", async () => {
    const r = await receipt();
    const requestId = await linkedNotice(r);
    const results = await Promise.allSettled([cancel(r), approve(requestId)]);
    assert.equal(results[1]!.status, "fulfilled");
    const target = await row("inbound_receipts", r.id);
    const request = await row("customer_requests", requestId);
    assert.equal(request.status, "approved");
    if (target.status === "cancelled") {
      assert.equal(results[0]!.status, "fulfilled");
      assert.ok(!target.customer_request_id);
      assert.notEqual(request.created_entities.inbound_id, r.id);
      assert.notEqual((await row("inbound_receipts", request.created_entities.inbound_id)).status, "cancelled");
    } else {
      assert.equal(results[0]!.status, "rejected");
      assert.equal(request.created_entities.inbound_id, r.id);
      assert.equal((await events()).length, 0);
    }
  });
});
