import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

import {
  confirmInboundBoxDestination,
  refuseInboundBoxPosition,
  removeInboundBox,
  saveInboundBoxLine,
  setInboundBoxState,
  startInboundBox,
  suggestInboundBoxPosition,
} from "./inbound-boxes.js";
import { createInboundReceiptTransaction, type OperationalActor } from "./operations.js";
import { seedDefaultWarehouseLayout, upsertWarehousePositions } from "./warehouse-positions.js";
import { createWarehouseBox, removeWarehouseBox, suggestWarehousePosition } from "./warehouse-boxes.js";

/**
 * A caixa do recebimento no banco (docs/plataforma/recebimento-com-caixas.md,
 * parte 3): iniciar, lançar, fechar, sugerir, recusar, confirmar o destino e
 * remover, sempre a partir da chegada por caixa, sem escrever a chegada nem
 * pôr nada no estoque.
 */

const PROJECT_ID = "demo-dute-operations";
const ALFA = "Uniformes Alfa";
const BETA = "Uniformes Beta";
const coordenacao = { uid: "ops-1", name: "Coordenação", role: "interno", email: "ops@dutelog.com.br" };
const operacao: OperationalActor = { uid: "wms-1", name: "Operador", role: "wms", email: "wms@dutelog.com.br" };
const BOX = { length_m: 0.48, width_m: 0.38, height_m: 0.3, gross_weight_kg: 9.4 };
const CUBE = { length_m: 0.5, width_m: 0.5, height_m: 0.35, gross_weight_kg: 12.4 };
const PREFIX: Record<string, string> = { [ALFA]: "UNI", [BETA]: "UNB" };
const FROZEN = {
  code: "failed-precondition",
  message: "Movimentações de estoque estão temporariamente bloqueadas para reconciliação.",
};

type Row = Record<string, any>;
type Receipt = { id: string; number: string; customer: string; items: Record<"XG" | "GG", string> };

let db: Firestore;
let app: ReturnType<typeof initializeApp>;
let nonce = 0;
const key = (label: string) => `${label}-${++nonce}`;

before(() => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST, "Execute este teste pelo Firebase Emulator.");
  app = initializeApp({ projectId: PROJECT_ID }, `inbound-boxes-${Date.now()}`);
  db = getFirestore(app);
});

beforeEach(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  const response = await fetch(`http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
  assert.equal(response.ok, true, await response.text());
  await seedDefaultWarehouseLayout(db, coordenacao);
  for (const [code, id] of [[ALFA, "uniformes_alfa"], [BETA, "uniformes_beta"]] as const) {
    const prefix = PREFIX[code]!;
    await db.collection("customers").doc(id).set({ code, customer_code: code, name: code, sku_prefix: prefix, status: "active", operation_template: "uniformes" });
    for (const [index, size] of [[1, "XG"], [2, "GG"]] as const) {
      const sku = `${prefix}-00000${index}`;
      const item = `${prefix}.POLO.${size}`;
      await db.collection("products").doc(item).set({ id: item, customer_code: code, cod_cliente: item, produto: `POLO PIQUET PRETO ${size}`, status: "active" });
      await db.collection("skus").doc(sku).set({ id: sku, customer_code: code, cod_cliente: item, cod_btg: sku, sku_code: sku, produto: `POLO PIQUET PRETO ${size}`, status: "active" });
    }
  }
  // Zona da Alfa: A-01 a A-03; da Beta: B-01 a B-03. O resto fica livre.
  await upsertWarehousePositions(
    db,
    {
      positions: [
        ...[1, 2, 3].map((shelf) => ({ aisle: "A", shelf, length_m: 1.8, depth_m: 0.75, height_m: 0.65, customer_code: ALFA })),
        ...[1, 2, 3].map((shelf) => ({ aisle: "B", shelf, length_m: 1.8, depth_m: 0.75, height_m: 0.65, customer_code: BETA })),
      ],
    },
    coordenacao,
  );
});

after(async () => {
  await deleteApp(app);
});

// ------------------------------------------------------------------ apoio

/** `mode` null cria a chegada sem o campo, por linha. */
async function receipt(customer = ALFA, mode: string | null = "per_box", location = "RECEBIMENTO"): Promise<Receipt> {
  const prefix = PREFIX[customer]!;
  const created = (await createInboundReceiptTransaction(
    db,
    {
      customer_code: customer,
      supplier: "Confecções Alfa",
      invoice_number: "48230",
      idempotency_key: key("nf"),
      ...(mode ? { conference_mode: mode } : {}),
      items: (["XG", "GG"] as const).map((size, index) => ({
        line_number: index + 1,
        sku_code: `${prefix}-00000${index + 1}`,
        client_item_code: `${prefix}.POLO.${size}`,
        product_name: `POLO PIQUET PRETO ${size}`,
        product_registration: "existing",
        size,
        location_id: location,
        quantity: size === "XG" ? 41 : 30,
      })),
    },
    operacao,
    { boxReceivingEnabled: true },
  )) as Row;
  const rows = (await db.collection("inbound_items").where("receipt_id", "==", created.receipt_id).get()).docs
    .sort((left, right) => Number(left.get("line_number")) - Number(right.get("line_number")));
  return { id: String(created.receipt_id), number: String(created.receipt_number), customer, items: { XG: rows[0]!.id, GG: rows[1]!.id } };
}

async function boxOf(code: string) {
  return (await db.collection("warehouse_boxes").doc(code).get()).data() as Row;
}
async function itemOf(id: string) {
  return (await db.collection("inbound_items").doc(id).get()).data() as Row;
}
async function rev(code: string) {
  return Number((await boxOf(code))?.conference_revision ?? 0);
}
async function sizeOf(collection: string) {
  return (await db.collection(collection).get()).size;
}
async function events(type: string) {
  return (await db.collection("events").where("type", "==", type).get()).docs.map((row) => row.data());
}
async function positionOf(code: string) {
  return (await db.collection("warehouse_positions").doc(code).get()).data() as Row;
}

function start(r: Receipt, k = key("start"), extra: Row = {}, actor: OperationalActor = operacao) {
  return startInboundBox(db, { receipt_id: r.id, idempotency_key: k, ...extra }, actor) as Promise<Row>;
}
async function line(r: Receipt, code: string, size: "XG" | "GG", qty: number, k = key("line"), extra: Row = {}) {
  return saveInboundBoxLine(db, { receipt_id: r.id, box_code: code, inbound_item_id: r.items[size], counted_qty: qty, expected_revision: await rev(code), idempotency_key: k, ...extra }, operacao) as Promise<Row>;
}
async function close(r: Receipt, code: string, measures: Row = BOX, k = key("close")) {
  return setInboundBoxState(db, { action: "close", receipt_id: r.id, box_code: code, ...measures, expected_revision: await rev(code), idempotency_key: k }, operacao) as Promise<Row>;
}
async function reopen(r: Receipt, code: string, k = key("reopen")) {
  return setInboundBoxState(db, { action: "reopen", receipt_id: r.id, box_code: code, expected_revision: await rev(code), idempotency_key: k }, operacao) as Promise<Row>;
}
function suggest(r: Receipt, code: string, extra: Row = {}) {
  return suggestInboundBoxPosition(db, { receipt_id: r.id, box_code: code, ...extra }, operacao) as Promise<Row>;
}
async function refuse(r: Receipt, code: string, position: string, reason = "Prateleira com caixa avariada na frente", k = key("refuse")) {
  return refuseInboundBoxPosition(db, { receipt_id: r.id, box_code: code, position, reason, expected_revision: await rev(code), idempotency_key: k }, operacao) as Promise<Row>;
}
async function confirm(r: Receipt, code: string, location: string, extra: Row = {}, k = key("confirm")) {
  return confirmInboundBoxDestination(db, { receipt_id: r.id, box_code: code, location_id: location, expected_revision: await rev(code), idempotency_key: k, ...extra }, operacao) as Promise<Row>;
}
async function remove(r: Receipt, code: string, k = key("remove")) {
  return removeInboundBox(db, { receipt_id: r.id, box_code: code, expected_revision: await rev(code), idempotency_key: k }, operacao) as Promise<Row>;
}

/** Uma caixa iniciada, com uma linha e fechada, pronta para a prateleira. */
async function closedBox(r: Receipt, measures: Row = BOX, size: "XG" | "GG" = "XG", qty = 1) {
  const code = String((await start(r)).box.code);
  await line(r, code, size, qty);
  await close(r, code, measures);
  return code;
}

async function snapshotOf() {
  const boxes = (await db.collection("warehouse_boxes").get()).docs.map((row) => ({ id: row.id, ...row.data() }));
  return {
    boxes: JSON.stringify(boxes.sort((left, right) => left.id.localeCompare(right.id))),
    counter: (await db.collection("warehouse_counters").doc("boxes").get()).get("last") ?? 0,
    events: await sizeOf("events"),
    operations: await sizeOf("operational_operations"),
    items: JSON.stringify((await db.collection("inbound_items").get()).docs.map((row) => [row.id, row.get("boxed_qty") ?? 0, row.get("box_codes") ?? []]).sort()),
    shelves: JSON.stringify((await db.collection("warehouse_positions").get()).docs.map((row) => [row.id, row.get("occupancy_revision") ?? 0]).sort()),
  };
}

async function semEstoque() {
  for (const collection of ["stock_balances", "movements", "putaway_tasks", "client_inventory"]) {
    assert.equal(await sizeOf(collection), 0, collection);
  }
}

// ------------------------------------------------------------------ casos

describe("a caixa do recebimento (recebimento com caixas, parte 3)", () => {
  it("o caminho da bancada: iniciar, lançar, fechar, sugerir e confirmar, sem escrever a chegada", async () => {
    const r = await receipt();
    const receiptRef = db.collection("inbound_receipts").doc(r.id);
    const versionBefore = (await receiptRef.get()).updateTime!;

    const started = await start(r);
    assert.equal(started.box.code, "CX-000001");
    const box = await boxOf("CX-000001");
    assert.equal(box.status, "counting");
    assert.equal(box.customer_code, ALFA);
    assert.equal(box.receipt_id, r.id);
    assert.deepEqual(box.origin, { kind: "receipt", receipt_id: r.id, receipt_number: r.number, invoice_number: "48230" });
    assert.deepEqual([box.location_id, box.lines, box.draft_line_count, box.line_count, box.opening_closed], ["", [], 0, 0, true]);
    assert.equal((await db.collection("warehouse_counters").doc("boxes").get()).get("last"), 1);

    const xg = await line(r, "CX-000001", "XG", 29);
    assert.deepEqual(xg.inbound_item, { id: r.items.XG, boxed_qty: 29, box_codes: ["CX-000001"] });
    const gg = await line(r, "CX-000001", "GG", 12);
    assert.deepEqual([gg.draft_line_count, gg.draft_unit_count], [2, 41]);
    const item = await itemOf(r.items.XG);
    assert.deepEqual([item.boxed_qty, item.box_codes, item.received_qty, item.status, item.location_id], [29, ["CX-000001"], 0, "expected", "RECEBIMENTO"]);
    assert.deepEqual((await boxOf("CX-000001")).lines.map((entry: Row) => [entry.sku_code, entry.size, entry.counted_qty]), [["UNI-000001", "XG", 29], ["UNI-000002", "GG", 12]]);

    const closed = await close(r, "CX-000001");
    assert.equal(closed.status, "reviewed");
    assert.deepEqual(closed.dimensions, { length_m: 0.48, width_m: 0.38, height_m: 0.3, gross_weight_kg: 9.4 });

    const suggestion = await suggest(r, "CX-000001");
    assert.equal(suggestion.position.code, "A-01");
    assert.equal(suggestion.position.tier, 3);
    assert.deepEqual(suggestion.alternatives.map((entry: Row) => entry.code), ["A-02", "A-03"]);
    assert.equal(suggestion.zone_positions, 3);

    const confirmed = await confirm(r, "CX-000001", "A-01", {
      suggestion: { position: "A-01", reason: suggestion.position.reason, alternatives: ["A-02", "A-03"], tier: 3 },
    });
    assert.equal(confirmed.status, "committing");
    const reserved = await boxOf("CX-000001");
    assert.deepEqual([reserved.status, reserved.location_id, reserved.destination_location_id, reserved.front_m], ["committing", "A-01", "A-01", 0.38]);
    assert.equal(reserved.suggestion.followed, true);
    assert.equal((await positionOf("A-01")).occupancy_revision, 1);

    const second = String((await start(r)).box.code);
    assert.equal(second, "CX-000002");
    await line(r, second, "GG", 18);
    assert.deepEqual([(await itemOf(r.items.GG)).boxed_qty, (await itemOf(r.items.GG)).box_codes], [30, ["CX-000001", "CX-000002"]]);

    // Um evento por operação, da caixa e do cliente da chegada, fora da caixa de entrada.
    for (const [type, count] of [
      ["warehouse.box_started", 2],
      ["warehouse.box_line_saved", 3],
      ["warehouse.box_closed", 1],
      ["warehouse.box_destination_confirmed", 1],
    ] as const) {
      const found = await events(type);
      assert.equal(found.length, count, type);
      for (const event of found) {
        assert.deepEqual([event.entity_type, event.customer_code, event.severity, event.payload.receipt_id], ["warehouse_box", ALFA, "info", r.id], type);
        assert.match(String(event.entity_id), /^CX-\d{6}$/);
      }
    }
    assert.equal(await sizeOf("ai_agent_inbox"), 1, "só o item do inbound.created");

    // A chegada nunca foi escrita, e nada entrou no estoque.
    assert.ok((await receiptRef.get()).updateTime!.isEqual(versionBefore));
    await semEstoque();
  });

  it("cabe e não cabe: frente, altura e peso, com o encaixe estrito", async () => {
    const r = await receipt();
    const codes = [await closedBox(r, CUBE), await closedBox(r, CUBE), await closedBox(r, CUBE)];
    for (const code of codes) await confirm(r, code, "A-01");
    assert.equal((await positionOf("A-01")).occupancy_revision, 3);

    const fourth = await closedBox(r, CUBE);
    const before = await snapshotOf();
    await assert.rejects(confirm(r, fourth, "A-01"), { code: "failed-precondition", message: /não cabe na prateleira A-01: frente livre de 30 cm/ });
    assert.deepEqual(await snapshotOf(), before);
    assert.deepEqual([(await boxOf(fourth)).status, (await boxOf(fourth)).location_id], ["reviewed", ""]);
    assert.equal((await suggest(r, fourth)).position.code, "A-02");

    const tall = await closedBox(r, { ...CUBE, height_m: 0.7 });
    await assert.rejects(confirm(r, tall, "A-02"), { code: "failed-precondition", message: /não cabe na prateleira A-02/ });

    await db.collection("warehouse_positions").doc("A-03").update({ max_weight_kg: 20 });
    await confirm(r, await closedBox(r, CUBE), "A-03");
    await assert.rejects(confirm(r, await closedBox(r, CUBE), "A-03"), { code: "failed-precondition", message: /peso máximo 20 kg/ });
  });

  it("duas confirmações na última vaga: uma passa, a outra é recusada", async () => {
    const r = await receipt();
    await db.collection("warehouse_positions").doc("A-01").update({ length_m: 0.5 });
    const first = await closedBox(r, CUBE);
    const second = await closedBox(r, CUBE);
    const results = await Promise.allSettled([confirm(r, first, "A-01"), confirm(r, second, "A-01")]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    const rejected = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
    assert.match(String(rejected.reason?.message), /não cabe na prateleira A-01/);
    assert.equal((await positionOf("A-01")).occupancy_revision, 1);
    const loser = results[0]!.status === "rejected" ? first : second;
    assert.equal((await boxOf(loser)).status, "reviewed");
    await confirm(r, loser, "A-02");
  });

  it("mesmo produto: o saldo da prateleira e a caixa do recebimento já reservada contam", async () => {
    const r = await receipt();
    await db.collection("stock_balances").doc("bal_gg_a02").set({ customer_code: ALFA, sku_code: "UNI-000002", location_id: "A-02", qty_on_hand: 5 });
    const gg = await closedBox(r, BOX, "GG", 4);
    const bySaldo = await suggest(r, gg);
    assert.deepEqual([bySaldo.position.code, bySaldo.position.tier, bySaldo.position.reason], ["A-02", 1, "Já tem UNI-000002 nesta prateleira e ainda cabe."]);
    assert.deepEqual(bySaldo.alternatives.map((entry: Row) => [entry.code, entry.tier]), [["A-01", 2], ["A-03", 2]]);
    await db.collection("stock_balances").doc("bal_gg_a02").delete();

    // A primeira caixa com GG vai à mão para A-03; a segunda é sugerida lá.
    await confirm(r, gg, "A-03", { suggestion: { position: "A-01", tier: 3 } });
    assert.equal((await boxOf(gg)).suggestion.followed, false);
    const next = await closedBox(r, BOX, "GG", 18);
    const byReserve = await suggest(r, next);
    assert.deepEqual([byReserve.position.code, byReserve.position.tier], ["A-03", 1]);
    // O motor genérico não mudou: sem a caixa reservada, a mesma caixa iria para A-01.
    const generic = await suggestWarehousePosition(db, { customer_code: ALFA, ...BOX, sku_codes: ["UNI-000002"] }, operacao);
    assert.deepEqual([generic.position?.code, generic.position?.tier], ["A-01", 3]);
  });

  it("recusa: a prateleira sai da escolha desta caixa e o cadastro dela não muda", async () => {
    const r = await receipt();
    const code = await closedBox(r);
    const shelfBefore = await positionOf("A-01");
    const refused = await refuse(r, code, "A-01");
    assert.deepEqual(refused.refused, ["A-01"]);
    assert.deepEqual(await positionOf("A-01"), shelfBefore);
    const [event] = await events("warehouse.position_refused");
    assert.deepEqual([event.entity_type, event.entity_id, event.customer_code], ["warehouse_position", "A-01", ALFA]);
    assert.deepEqual(event.payload, { box_code: code, receipt_id: r.id, receipt_number: r.number, reason: "Prateleira com caixa avariada na frente" });
    assert.match(event.description, /o estado da prateleira não foi alterado/);

    assert.equal((await suggest(r, code)).position.code, "A-02");
    const other = await closedBox(r);
    assert.equal((await suggest(r, other)).position.code, "A-01");
    await assert.rejects(confirm(r, code, "A-01"), { code: "failed-precondition", message: `A prateleira A-01 foi recusada para esta caixa. Escolha outra.` });
    await confirm(r, code, "A-02", { suggestion: { position: "A-02", tier: 3 } });
    const stored = await boxOf(code);
    assert.equal(stored.suggestion.followed, true);
    assert.deepEqual(stored.refusal, { position: "A-01", reason: "Prateleira com caixa avariada na frente" });

    // Nada é gravado nas recusas inválidas.
    const before = await snapshotOf();
    await assert.rejects(refuse(r, other, "A-02", ""), { code: "invalid-argument", message: "Informe o motivo da recusa." });
    await assert.rejects(refuse(r, other, "B-01"), { code: "failed-precondition", message: "A prateleira B-01 não é da zona de Uniformes Alfa." });
    await assert.rejects(refuse(r, other, "Z-99"), { code: "not-found" });
    await assert.rejects(refuse(r, other, "A/01"), { code: "invalid-argument", message: "Posição inválida." });
    assert.deepEqual(await snapshotOf(), before);
    const open = String((await start(r)).box.code);
    const afterStart = await snapshotOf();
    await assert.rejects(refuse(r, open, "A-01"), { code: "failed-precondition", message: `Feche a caixa ${open} (medidas e peso) antes de escolher a prateleira.` });
    assert.deepEqual(await snapshotOf(), afterStart);

    // O código vem normalizado; a mesma prateleira não é recusada duas vezes; reabrir limpa as recusas.
    assert.deepEqual((await refuse(r, other, "a-02")).refused, ["A-02"]);
    await assert.rejects(refuse(r, other, "A-02"), { code: "failed-precondition", message: "A prateleira A-02 já foi recusada para esta caixa." });
    await reopen(r, other);
    assert.deepEqual((await boxOf(other)).refusals, []);
  });

  it("repetir a mesma chave devolve o que foi gravado, sem gravar de novo", async () => {
    const r = await receipt();
    const startInput = { receipt_id: r.id, idempotency_key: "start-k" };
    const started = await startInboundBox(db, startInput, operacao);
    // As chaves do objeto em outra ordem são a mesma entrada.
    assert.deepEqual(await startInboundBox(db, { idempotency_key: "start-k", receipt_id: r.id }, operacao), started);
    const code = String((started as Row).box.code);

    const lineInput = { receipt_id: r.id, box_code: code, inbound_item_id: r.items.XG, counted_qty: 29, expected_revision: 0, idempotency_key: "line-k" };
    const saved = await saveInboundBoxLine(db, lineInput, operacao);
    assert.deepEqual(await saveInboundBoxLine(db, lineInput, operacao), saved);
    assert.equal((await itemOf(r.items.XG)).boxed_qty, 29);
    await assert.rejects(saveInboundBoxLine(db, { ...lineInput, counted_qty: 30 }, operacao), { code: "already-exists" });

    const closeInput = { action: "close", receipt_id: r.id, box_code: code, ...BOX, expected_revision: 1, idempotency_key: "close-k" };
    const closed = await setInboundBoxState(db, closeInput, operacao);
    assert.deepEqual(await setInboundBoxState(db, closeInput, operacao), closed);

    const refuseInput = { receipt_id: r.id, box_code: code, position: "A-03", reason: "Vão ocupado", expected_revision: 2, idempotency_key: "refuse-k" };
    const refusal = await refuseInboundBoxPosition(db, refuseInput, operacao);
    assert.deepEqual(await refuseInboundBoxPosition(db, refuseInput, operacao), refusal);

    const confirmInput = { receipt_id: r.id, box_code: code, location_id: "A-01", expected_revision: 3, idempotency_key: "confirm-k" };
    const confirmed = await confirmInboundBoxDestination(db, confirmInput, operacao);
    assert.deepEqual(await confirmInboundBoxDestination(db, confirmInput, operacao), confirmed);

    // O lançar depois de fechar e confirmar também repete o gravado.
    assert.deepEqual(await saveInboundBoxLine(db, lineInput, operacao), saved);
    assert.equal((await db.collection("warehouse_counters").doc("boxes").get()).get("last"), 1);
    assert.equal(await sizeOf("warehouse_boxes"), 1);
    assert.equal((await positionOf("A-01")).occupancy_revision, 1);
    for (const type of ["warehouse.box_started", "warehouse.box_line_saved", "warehouse.box_closed", "warehouse.position_refused", "warehouse.box_destination_confirmed"]) {
      assert.equal((await events(type)).length, 1, type);
    }
    assert.equal(await sizeOf("operational_operations"), 6, "o recibo da chegada e um por ação");

    // Duas chamadas ao mesmo tempo com a mesma chave: uma caixa só.
    const together = await Promise.all([start(r, "start-par"), start(r, "start-par")]);
    assert.equal(together[0]!.box.code, together[1]!.box.code);
    assert.equal(await sizeOf("warehouse_boxes"), 2);
  });

  it("outro cliente, outra chegada e a chegada que não é por caixa são recusados sem gravar", async () => {
    const r = await receipt();
    const rb = await receipt(BETA);
    const code = await closedBox(r);
    const before = await snapshotOf();

    await assert.rejects(start(r, key("start"), { customer_code: BETA }), { code: "permission-denied", message: "Chegada de outro cliente. Troque o cliente ativo para Uniformes Alfa." });
    await assert.rejects(line(rb, code, "XG", 1), { code: "permission-denied", message: "Caixa de outra chegada." });
    await assert.rejects(confirm(r, code, "B-01"), { code: "failed-precondition", message: /A prateleira B-01 não é da zona de Uniformes Alfa/ });
    await assert.rejects(confirm(r, code, "C-01"), { code: "failed-precondition", message: /A prateleira C-01 não é da zona de Uniformes Alfa/ });
    await assert.rejects(refuse(r, code, "B-01"), { code: "failed-precondition", message: "A prateleira B-01 não é da zona de Uniformes Alfa." });
    await assert.rejects(start(r, key("start"), {}, { uid: "cli-1", role: "cliente", customer_code: ALFA }), { code: "permission-denied" });
    assert.deepEqual(await snapshotOf(), before);

    // A linha de outra chegada não entra na caixa.
    const open = String((await start(r)).box.code);
    await assert.rejects(
      saveInboundBoxLine(db, { receipt_id: r.id, box_code: open, inbound_item_id: rb.items.XG, counted_qty: 1, expected_revision: 0, idempotency_key: key("line") }, operacao),
      { code: "permission-denied", message: "Linha de outra chegada." },
    );

    // A sugestão só vê a zona do cliente da chegada.
    assert.equal((await suggest(r, code)).zone_positions, 3);

    const porLinha = await receipt(ALFA, null);
    await assert.rejects(start(porLinha), { code: "failed-precondition", details: { code: "RECEIPT_CONFERRED_PER_LINE" } });
    await db.collection("inbound_receipts").doc(r.id).update({ status: "received" });
    await assert.rejects(start(r), { code: "failed-precondition", details: { code: "RECEIPT_NOT_OPEN" } });
  });

  it("zona cheia: a caixa fica fechada e sem destino até a coordenação ampliar a zona", async () => {
    const r = await receipt();
    for (const shelf of ["A-01", "A-02", "A-03"]) {
      await createWarehouseBox(db, { customer_code: ALFA, length_m: 1.8, width_m: 0.5, height_m: 0.4, location_id: shelf, idempotency_key: key("cheia") }, operacao);
    }
    const code = await closedBox(r, { ...BOX, allow_stacking: false });
    const full = await suggest(r, code);
    assert.equal(full.position, null);
    assert.equal(full.checked, 3);
    assert.match(full.rejected, /Nenhuma prateleira da zona de Uniformes Alfa tem espaço para uma caixa de 48 × 38 × 30 cm, 9.4 kg/);
    await assert.rejects(confirm(r, code, "A-01"), { code: "failed-precondition", message: /não cabe na prateleira A-01/ });
    await assert.rejects(confirm(r, code, "B-01"), { code: "failed-precondition", message: /não é da zona de Uniformes Alfa/ });
    assert.deepEqual([(await boxOf(code)).status, (await boxOf(code)).location_id], ["reviewed", ""]);

    await upsertWarehousePositions(db, { positions: [{ aisle: "A", shelf: 4, length_m: 1.8, depth_m: 0.75, height_m: 0.65, customer_code: ALFA }] }, coordenacao);
    assert.equal((await suggest(r, code)).position.code, "A-04");
    assert.equal((await confirm(r, code, "A-04")).location_id, "A-04");
    await semEstoque();
  });

  it("congelamento: nenhuma escrita passa; a repetição e a sugestão respondem", async () => {
    const r = await receipt();
    const started = await start(r, "k1");
    const open = String(started.box.code);
    await line(r, open, "XG", 3);
    const ready = await closedBox(r);
    await db.collection("system_controls").doc("inventory").set({ movements_frozen: true });
    const before = await snapshotOf();

    const frozen = { ...FROZEN, details: { code: "INVENTORY_RECONCILIATION_IN_PROGRESS", reconciliation_id: null } };
    await assert.rejects(start(r), frozen);
    await assert.rejects(line(r, open, "GG", 1), frozen);
    await assert.rejects(close(r, open), frozen);
    await assert.rejects(reopen(r, ready), frozen);
    await assert.rejects(refuse(r, ready, "A-01"), frozen);
    await assert.rejects(confirm(r, ready, "A-01"), frozen);
    await assert.rejects(remove(r, open), frozen);
    assert.deepEqual(await snapshotOf(), before);

    assert.deepEqual(await start(r, "k1"), started);
    assert.equal((await suggest(r, ready)).position.code, "A-01");

    await db.collection("system_controls").doc("inventory").set({ reconciliation_status: "running" });
    await assert.rejects(confirm(r, ready, "A-01"), { code: "failed-precondition", message: FROZEN.message });
    await db.collection("system_controls").doc("inventory").delete();
    assert.equal((await confirm(r, ready, "A-01")).status, "committing");
  });

  it("o conteúdo embutido e as linhas da NF", async () => {
    const r = await receipt();
    const one = String((await start(r)).box.code);
    await line(r, one, "XG", 29);
    assert.equal((await line(r, one, "XG", 31)).inbound_item.boxed_qty, 31);
    // Contar mais que a NF é aceito: a divergência é da conclusão (parte 4).
    assert.equal((await line(r, one, "XG", 50)).inbound_item.boxed_qty, 50);
    const removed = await line(r, one, "XG", 0);
    assert.equal(removed.line, null);
    assert.deepEqual(removed.inbound_item, { id: r.items.XG, boxed_qty: 0, box_codes: [] });
    assert.equal((await events("warehouse.box_line_removed")).length, 1);
    await assert.rejects(line(r, one, "XG", 0), { code: "not-found", message: "Este produto não está nesta caixa." });

    await line(r, one, "GG", 12);
    const two = String((await start(r)).box.code);
    await line(r, two, "GG", 18);
    assert.deepEqual([(await itemOf(r.items.GG)).boxed_qty, (await itemOf(r.items.GG)).box_codes], [30, [one, two]]);

    // Revisão antiga, fechar sem linha e sem peso.
    await assert.rejects(
      saveInboundBoxLine(db, { receipt_id: r.id, box_code: one, inbound_item_id: r.items.XG, counted_qty: 1, expected_revision: 0, idempotency_key: key("line") }, operacao),
      { code: "aborted", details: { code: "CONFERENCE_REVISION_CONFLICT" } },
    );
    const empty = String((await start(r)).box.code);
    await assert.rejects(close(r, empty), { code: "failed-precondition", message: "Lance ao menos um produto antes de fechar a caixa." });
    await assert.rejects(close(r, one, { length_m: 0.48, width_m: 0.38, height_m: 0.3 }), { code: "invalid-argument", message: "Informe o peso da caixa na balança, em quilos." });

    // Fechada pede reabrir; com destino, não muda mais na bancada.
    await close(r, one);
    await assert.rejects(line(r, one, "XG", 1), { code: "failed-precondition", message: `Reabra a caixa ${one} antes de alterar o conteúdo.` });
    await confirm(r, one, "A-01");
    await assert.rejects(line(r, one, "XG", 1), { code: "failed-precondition", message: `A caixa ${one} já tem destino confirmado em A-01.` });
    await assert.rejects(remove(r, one), { code: "failed-precondition", message: `A caixa ${one} já tem destino confirmado em A-01.` });
    await assert.rejects(removeWarehouseBox(db, { code: one }, operacao), { code: "failed-precondition", message: /está sendo guardada/ });

    // A remoção genérica não apaga caixa com produto; a do recebimento devolve as linhas.
    await assert.rejects(removeWarehouseBox(db, { code: two }, operacao), { code: "failed-precondition", message: /ainda tem produtos em conferência/ });
    const gone = await remove(r, two);
    assert.equal(gone.removed_lines, 1);
    assert.equal((await db.collection("warehouse_boxes").doc(two).get()).exists, false);
    assert.deepEqual([(await itemOf(r.items.GG)).boxed_qty, (await itemOf(r.items.GG)).box_codes], [12, [one]]);
    assert.equal((await events("warehouse.box_removed")).length, 1);

    // O limite de 100 produtos por caixa.
    const full = String((await start(r)).box.code);
    await db.collection("warehouse_boxes").doc(full).update({
      lines: Array.from({ length: 100 }, (_, index) => ({ inbound_item_id: `outra_${index}`, line_number: index + 1, sku_code: "UNI-000001", client_item_code: "x", product_name: "x", size: null, counted_qty: 1 })),
    });
    await assert.rejects(line(r, full, "XG", 1), { code: "failed-precondition", message: "Limite de 100 produtos por caixa. Inicie outra caixa." });

    // A linha que vai direto para uma prateleira não passa pela caixa.
    const direct = await receipt(ALFA, "per_box", "A-02");
    const directBox = String((await start(direct)).box.code);
    await assert.rejects(line(direct, directBox, "XG", 1), {
      code: "failed-precondition",
      message: "A linha 1 vai direto para A-02: na chegada por caixa, toda linha passa pela área de recebimento.",
    });
  });
});

type Callable = { run: (request: never) => Promise<unknown> };

describe("as callables da caixa do recebimento (pelo .run)", () => {
  async function viaCallable(data: Row) {
    const { startInboundBox: callable } = (await import("../index.js")) as unknown as { startInboundBox: Callable };
    await db.collection("users").doc("op-callable").set({ role: "wms", nome: "Operação" });
    return (await callable.run({
      auth: { uid: "op-callable", token: { email: "op-callable@dutelog.com.br" } },
      data,
      rawRequest: { headers: {} },
    } as never)) as Row;
  }

  it("o cliente vem da chegada, mesmo sem o código e fora da liberação; o código de outro cliente é recusado", async () => {
    const r = await receipt();
    const created = await viaCallable({ receipt_id: r.id, idempotency_key: key("callable") });
    assert.equal(created.box.customer_code, ALFA);
    await assert.rejects(viaCallable({ receipt_id: r.id, customer_code: "BTG Pactual", idempotency_key: key("callable") }), {
      code: "permission-denied",
      message: "Chegada de outro cliente. Troque o cliente ativo para Uniformes Alfa.",
    });
    await assert.rejects(viaCallable({}), { code: "invalid-argument" });
  });
});
