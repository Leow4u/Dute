import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import {
  completeOpeningInventorySessionTransaction,
  createOpeningInventorySessionTransaction,
  moveOpeningInventoryLineTransaction,
  openingInventorySessionDocumentId,
  recordCycleCountTransaction,
  removeOpeningInventoryLineTransaction,
  type OperationalActor,
  type RecordCycleCountInput,
} from "./operations.js";
import {
  createOpeningConferenceBox,
  getOpeningConferenceBox,
  OPENING_CONFERENCE_LINES,
  removeOpeningConferenceLine,
  resumeOpeningConferenceBox,
  saveOpeningConferenceLine,
  setOpeningConferenceBoxState,
  storeOpeningConferenceBox,
} from "./opening-inventory-conference.js";
import { createWarehouseBox, openingSessionDocId, removeWarehouseBox, suggestWarehousePosition } from "./warehouse-boxes.js";
import { seedDefaultWarehouseLayout, upsertWarehousePositions } from "./warehouse-positions.js";

type Row = Record<string, unknown>;
const PROJECT = "demo-dute-operations";
const CUSTOMER = "BTG Pactual";
const actor: OperationalActor = { uid: "conference-operator", role: "wms", name: "Conferente" };
const admin: OperationalActor = { uid: "conference-admin", role: "interno" };
const dimensions = { length_m: 0.5, width_m: 0.5, height_m: 0.35, gross_weight_kg: 2 };
const photo = "https://storage.googleapis.com/demo-dute-operations/product-photos/camisa.jpg";
let db: Firestore;
let app: ReturnType<typeof initializeApp>;
let sessionId: string;
let serial = 0;
const nonce = () => `conference-test-${++serial}`;
const scope = (code: string) => ({ customer_code: CUSTOMER, session_id: sessionId, box_code: code });
const number = (value: unknown) => Number(value ?? 0);

before(() => {
  app = initializeApp({ projectId: PROJECT }, "opening-conference-test");
  db = getFirestore(app);
});
beforeEach(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error("FIRESTORE_EMULATOR_HOST não definido.");
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: "DELETE" });
  serial = 0;
  await seedDefaultWarehouseLayout(db, admin);
  await db.collection("customers").doc("BTG_Pactual").set({
    code: CUSTOMER, customer_code: CUSTOMER, sku_prefix: "BTG", status: "active",
  });
  await upsertWarehousePositions(db, {
    positions: [1, 2, 3].map((shelf) => ({ aisle: "A", shelf, length_m: 1.8, depth_m: 0.75, height_m: 0.65, customer_code: CUSTOMER })),
  }, admin);
  const session = await createOpeningInventorySessionTransaction(db, {
    customer_code: CUSTOMER, idempotency_key: nonce(),
  }, actor);
  sessionId = String(session.session_id);
});
after(async () => { await deleteApp(app); });

async function createBox() {
  const input = { customer_code: CUSTOMER, session_id: sessionId, idempotency_key: nonce() };
  const result = await createOpeningConferenceBox(db, input, actor);
  return { code: String((result.box as Row).code), input };
}
async function state(code: string) { return getOpeningConferenceBox(db, scope(code), actor); }
async function revision(code: string) { return number((await state(code)).box.conference_revision); }
function item(extra: Row = {}) {
  return {
    client_item_code: "CAMISA-G", product_name: "Camisa branca G", product_registration: "new",
    category: "Uniforme", genero: "Masculino", grupo: "Camisa", size: "G", color: "Branco",
    photo_urls: [photo], photo_storage_paths: ["customers/BTG_Pactual/product-photos/camisa.jpg"],
    counted_qty: 3, unit_cost: 20, reason: "Inventário de abertura", ...extra,
  };
}
async function save(code: string, extra: Row = {}) {
  const result = await saveOpeningConferenceLine(db, {
    ...scope(code), ...item(extra), expected_revision: await revision(code), idempotency_key: nonce(),
  }, actor);
  return result.line as Row;
}
async function change(code: string, action: "review" | "reopen" | "release") {
  return setOpeningConferenceBoxState(db, {
    ...scope(code), action, expected_revision: await revision(code), idempotency_key: nonce(),
  }, actor);
}
async function storeInput(code: string, location = "A-01") {
  return { ...scope(code), ...dimensions, location_id: location, expected_revision: await revision(code), idempotency_key: nonce() };
}
async function rows(collection: string) {
  return (await db.collection(collection).get()).docs.map((doc) => ({ ...doc.data(), id: doc.id }) as Row);
}
async function committedStock() {
  return {
    balances: await rows("stock_balances"), products: await rows("products"), skus: await rows("skus"),
    projections: await rows("client_inventory"), movements: await rows("movements"), lines: await rows("opening_inventory_lines"),
  };
}
async function assertNoStock() {
  const stock = await committedStock();
  for (const [name, values] of Object.entries(stock)) assert.equal(values.length, 0, name);
}

/** Fixture de uma chamada interrompida depois de reservar a posição e antes de processar linhas. */
async function reserveCheckpoint(code: string, location = "A-01") {
  const commitId = `checkpoint-${code}`;
  await db.collection("warehouse_boxes").doc(code).update({
    status: "committing", opening_closed: true, location_id: location, ...dimensions,
    front_m: 0.5, depth_m: 0.5, placed_height_m: 0.35, orientation: "length_width_height",
    conference_commit_id: commitId, conference_commit_started_at: "2026-10-20T15:00:00.000Z",
    conference_revision: (await revision(code)) + 1,
  });
  return commitId;
}
/** Catálogo completo, sem saldo: simula cadastro concluído por outro recebimento. */
async function seedCatalog(code: string, sku: string) {
  const common = { customer_code: CUSTOMER, cod_cliente: code, cod_cliente_key: code, produto: "Camisa cadastrada",
    category: "Uniforme", genero: "Masculino", grupo: "Camisa", status: "active", archived: false,
    unit_cost: 20, preco_unit: 20, photo_urls: [photo], custo_total: 0 };
  await db.collection("products").doc(code).set({ ...common, estoque_btg: 0, num_skus: 1 });
  await db.collection("skus").doc(sku).set({ ...common, cod_btg: sku, sku_code: sku, sku_code_key: sku,
    estoque_atual: 0, estoque_reservado: 0, estoque_disponivel: 0 });
}

describe("inventário de abertura: conferir antes de guardar", () => {
  it("persiste a caixa e os rascunhos sem criar catálogo, saldo, movimento ou posição ocupada", async () => {
    const { code, input } = await createBox();
    const replay = await createOpeningConferenceBox(db, input, actor);
    assert.equal((replay.box as Row).code, code);
    assert.equal((await rows("warehouse_boxes")).length, 1);
    const line = await save(code);
    let current = await state(code);
    assert.equal(current.box.status, "counting");
    assert.equal(current.box.location_id, "");
    assert.equal(current.box.line_count, 0);
    assert.equal(current.box.draft_line_count, 1);
    assert.equal(current.box.draft_unit_count, 3);
    assert.equal(current.box.draft_total_cost, 60);
    await assertNoStock();
    const suggestion = await suggestWarehousePosition(db, { customer_code: CUSTOMER, ...dimensions }, actor);
    assert.equal(suggestion.position?.code, "A-01");
    assert.equal(suggestion.position?.leftover_m, 1.3);
    await assert.rejects(removeWarehouseBox(db, { code, customer_code: CUSTOMER }, actor), /em conferência/);
    await save(code, { line_id: line.id, counted_qty: 5 });
    current = await state(code);
    assert.equal(current.box.draft_line_count, 1);
    assert.equal(current.box.draft_unit_count, 5);
    await removeOpeningConferenceLine(db, {
      ...scope(code), line_id: line.id, expected_revision: await revision(code), idempotency_key: nonce(),
    }, actor);
    await removeWarehouseBox(db, { code, customer_code: CUSTOMER }, actor);
    assert.equal((await rows(OPENING_CONFERENCE_LINES)).length, 0);
    assert.equal((await rows("warehouse_boxes")).length, 0);
    await assertNoStock();
  });

  it("rejeita revisão vazia, dados incompletos, aliases repetidos e edição com revisão antiga", async () => {
    const { code } = await createBox();
    await assert.rejects(change(code, "review"), /ao menos um produto/);
    await assert.rejects(save(code, { photo_urls: [] }), /ao menos uma foto/);
    await assert.rejects(save(code, { genero: "" }));
    await assert.rejects(save(code, { counted_qty: 0 }));
    await save(code, { client_item_code: "CÓD  G" });
    await assert.rejects(save(code, { client_item_code: "COD G" }), /já está nesta caixa/);
    await assert.rejects(saveOpeningConferenceLine(db, {
      ...scope(code), ...item({ client_item_code: "OUTRO" }), expected_revision: 0, idempotency_key: nonce(),
    }, actor), /outra tela/);
    assert.equal((await state(code)).lines.length, 1);
    await assertNoStock();
  });

  it("preserva códigos do cliente com barra e impede colisão do documento de produto na mesma caixa", async () => {
    const { code } = await createBox();
    await save(code, { client_item_code: "MODELO/01.G" });
    await assert.rejects(save(code, { client_item_code: "MODELO_01.G" }), /já está nesta caixa/);
    await change(code, "review");
    await storeOpeningConferenceBox(db, await storeInput(code), actor);
    const stock = await committedStock();
    assert.equal(stock.skus.length, 1);
    assert.equal(stock.skus[0]!.cod_cliente, "MODELO/01.G");
    assert.equal(stock.products[0]!.id, "MODELO_01.G");
    assert.equal(stock.lines[0]!.client_item_code, "MODELO/01.G");
  });

  it("revê e reabre de forma persistente; caixa revisada bloqueia novos lançamentos e conclusão da abertura", async () => {
    const { code } = await createBox();
    const line = await save(code);
    await change(code, "review");
    assert.equal((await state(code)).box.status, "reviewed");
    assert.equal((await state(code)).box.opening_closed, true);
    await assert.rejects(save(code, { line_id: line.id, counted_qty: 4 }), /Reabra/);
    await assert.rejects(completeOpeningInventorySessionTransaction(db, {
      customer_code: CUSTOMER, session_id: sessionId, idempotency_key: nonce(),
    }, actor), /caixa|conferência/i);
    await change(code, "reopen");
    await save(code, { line_id: line.id, counted_qty: 4 });
    assert.equal((await state(code)).box.draft_unit_count, 4);
    await assertNoStock();
  });

  it("guarda com o mesmo CX, gera estoque uma vez e preserva fotos, custo, posição e fechamento", async () => {
    const { code } = await createBox();
    await save(code);
    await change(code, "review");
    const input = await storeInput(code);
    const first = await storeOpeningConferenceBox(db, input, actor);
    assert.equal(first.box.code, code);
    assert.equal(first.box.status, "stored");
    assert.equal(first.box.opening_closed, true);
    await storeOpeningConferenceBox(db, input, actor);
    await resumeOpeningConferenceBox(db, scope(code), actor);
    const stock = await committedStock();
    assert.equal(stock.skus.length, 1);
    assert.equal(stock.products.length, 1);
    assert.equal(stock.movements.length, 1);
    assert.equal(stock.lines.length, 1);
    assert.equal(stock.balances.length, 1);
    assert.equal(stock.balances[0]!.qty_on_hand, 3);
    assert.equal(stock.balances[0]!.location_id, "A-01");
    assert.equal(stock.lines[0]!.box_code, code);
    assert.equal(stock.lines[0]!.total_cost, 60);
    assert.deepEqual(stock.skus[0]!.photo_urls, [photo]);
    assert.deepEqual(stock.lines[0]!.photo_storage_paths, ["customers/BTG_Pactual/product-photos/camisa.jpg"]);
    const current = await state(code);
    assert.equal(current.box.unit_count, 3);
    assert.equal(current.box.line_count, 1);
    assert.equal(current.box.total_cost, 60);
    const session = (await db.collection("opening_inventory_sessions").doc(sessionId).get()).data()!;
    assert.equal(session.line_count, 1);
    assert.equal(session.unit_count, 3);
    assert.equal(session.total_cost, 60);
    assert.equal((await rows("events")).filter((row) => row.type === "warehouse.box_stored").length, 1);
    await assert.rejects(recordCycleCountTransaction(db, {
      mode: "opening", ...scope(code), sku_code: String(stock.skus[0]!.sku_code),
      ...item({ product_registration: "existing" }), location_id: "A-01", idempotency_key: nonce(),
    } as RecordCycleCountInput, actor), /fechada|conferência/);
  });

  it("valida conflito de catálogo e saldo recebido antes de reservar espaço", async () => {
    const { code } = await createBox();
    const line = await save(code);
    await change(code, "review");
    await seedCatalog("CAMISA-G", "BTG-900001");
    await assert.rejects(storeOpeningConferenceBox(db, await storeInput(code), actor), /já existe/);
    assert.equal((await state(code)).box.status, "reviewed");
    assert.equal((await state(code)).box.location_id, "");
    await change(code, "reopen");
    await save(code, { line_id: line.id, product_registration: "existing", sku_code: "BTG-900001" });
    await change(code, "review");
    await db.collection("stock_balances").doc("receipt-balance").set({
      customer_code: CUSTOMER, sku_code: "BTG-900001", location_id: "A-01", qty_on_hand: 2, qty_reserved: 0,
    });
    await assert.rejects(storeOpeningConferenceBox(db, await storeInput(code), actor), /saldo recebido ou reservado/);
    assert.equal((await state(code)).box.status, "reviewed");
    const result = await storeOpeningConferenceBox(db, await storeInput(code, "A-02"), actor);
    assert.equal(result.box.location_id, "A-02");
  });

  it("recupera checkpoint processing cujo lançamento já confirmou sem gerar outro SKU nem somar duas vezes", async () => {
    const { code } = await createBox();
    const draft = await save(code);
    await change(code, "review");
    const commitId = await reserveCheckpoint(code);
    const prepared: RecordCycleCountInput = {
      mode: "opening", ...scope(code), ...item(), location_id: "A-01",
      occurred_at: "2026-10-20T15:00:00.000Z", idempotency_key: `checkpoint-${draft.id}-v1`,
    } as RecordCycleCountInput;
    const lineRef = db.collection(OPENING_CONFERENCE_LINES).doc(String(draft.id));
    await lineRef.update({ status: "processing", prepared_input: prepared });
    const internal = { conference_commit_id: commitId, conference_line_id: String(draft.id), conference_version: 1 };
    await recordCycleCountTransaction(db, prepared, actor, internal);
    // Checkpoint compatível com a queda entre o commit do ledger e o reconhecimento da linha.
    await lineRef.update({ status: "processing" });
    await resumeOpeningConferenceBox(db, scope(code), actor);
    assert.equal((await state(code)).box.status, "stored");
    const stock = await committedStock();
    assert.equal(stock.skus.length, 1);
    assert.equal(stock.movements.length, 1);
    assert.equal(stock.lines.length, 1);
    assert.equal(stock.balances[0]!.qty_on_hand, 3);
    assert.equal((await lineRef.get()).get("status"), "committed");
  });

  it("corrige somente a linha que falhou após publicação parcial e retoma preservando a primeira", async () => {
    const { code } = await createBox();
    await save(code, { client_item_code: "CAMISA-G", counted_qty: 3 });
    await save(code, { client_item_code: "CAMISA-M", size: "M", counted_qty: 4 });
    await change(code, "review");
    await reserveCheckpoint(code);
    const ordered = (await state(code)).lines as Row[];
    const second = ordered[1]!;
    await seedCatalog(String(second.client_item_code), "BTG-900002");
    await assert.rejects(resumeOpeningConferenceBox(db, scope(code), actor), /já existe/);
    let current = await state(code);
    assert.equal(current.box.status, "committing");
    const committed = (current.lines as Row[]).find((line) => line.status === "committed")!;
    const failed = (current.lines as Row[]).find((line) => line.status === "failed")!;
    assert.ok(committed);
    assert.ok(failed);
    const originalSku = String((await rows("opening_inventory_lines"))[0]!.sku_code);
    await assert.rejects(save(code, { ...committed, line_id: committed.id }), /não podem ser alteradas/);
    await assert.rejects(change(code, "release"), /confirmados|processamento/);
    const published = (await rows("opening_inventory_lines"))[0]!;
    await assert.rejects(removeOpeningInventoryLineTransaction(db, {
      customer_code: CUSTOMER, session_id: sessionId, opening_line_id: String(published.id), idempotency_key: nonce(),
    }, actor), /finalize a guarda/);
    const target = await createWarehouseBox(db, { customer_code: CUSTOMER, session_id: sessionId, ...dimensions,
      location_id: "A-02", idempotency_key: nonce() }, actor);
    await assert.rejects(moveOpeningInventoryLineTransaction(db, {
      customer_code: CUSTOMER, session_id: sessionId, opening_line_id: String(published.id),
      target_box_code: target.box.code, reason: "Correção de caixa", idempotency_key: nonce(),
    }, actor), /guardadas/);
    await save(code, { ...failed, line_id: failed.id, product_registration: "existing", sku_code: "BTG-900002" });
    await resumeOpeningConferenceBox(db, scope(code), actor);
    current = await state(code);
    assert.equal(current.box.status, "stored");
    assert.equal(current.box.line_count, 2);
    assert.equal(current.box.unit_count, 7);
    const stock = await committedStock();
    assert.equal(stock.lines.length, 2);
    assert.equal(stock.movements.length, 2);
    assert.ok(stock.lines.some((line) => line.sku_code === originalSku));
    assert.equal(stock.balances.reduce((sum, row) => sum + number(row.qty_on_hand), 0), 7);
  });

  it("permite liberar reserva sem lançamento confirmado, preservando o rascunho para nova escolha", async () => {
    const { code } = await createBox();
    await save(code);
    await change(code, "review");
    await reserveCheckpoint(code);
    await assert.rejects(removeWarehouseBox(db, { code, customer_code: CUSTOMER }, actor), /sendo guardada/);
    await change(code, "release");
    const current = await state(code);
    assert.equal(current.box.status, "counting");
    assert.equal(current.box.location_id, "");
    assert.equal(current.box.conference_commit_id, null);
    assert.equal(current.lines.length, 1);
    await assertNoStock();
  });

  it("duas guardas concorrentes na última vaga: a segunda entra marcada e o lançamento não duplica", async () => {
    await upsertWarehousePositions(db, { positions: [{ aisle: "A", shelf: 1,
      length_m: 0.5, depth_m: 0.5, height_m: 0.65, customer_code: CUSTOMER }] }, admin);
    const first = await createBox();
    const second = await createBox();
    await save(first.code, { client_item_code: "CAMISA-G" });
    await save(second.code, { client_item_code: "CAMISA-M", size: "M" });
    await change(first.code, "review");
    await change(second.code, "review");
    const inputs = await Promise.all([storeInput(first.code), storeInput(second.code)]);
    const results = await Promise.allSettled(inputs.map((input) => storeOpeningConferenceBox(db, input, actor)));
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 2);
    const boxes = await rows("warehouse_boxes");
    const stored = boxes.filter((box) => box.status === "stored" && box.location_id === "A-01");
    assert.equal(stored.length, 2);
    assert.equal(stored.filter((box) => box.opening_model_fit === false).length, 1);
    assert.equal((await rows("movements")).length, 2);
    assert.equal((await db.collection("warehouse_positions").doc("A-01").get()).get("occupancy_revision"), 2);
  });

  it("retomadas simultâneas de um produto novo não liberam edição de uma linha já publicada", async () => {
    const { code } = await createBox();
    await save(code);
    await change(code, "review");
    await reserveCheckpoint(code);
    await Promise.allSettled(Array.from({ length: 4 }, () => resumeOpeningConferenceBox(db, scope(code), actor)));
    await resumeOpeningConferenceBox(db, scope(code), actor);
    const current = await state(code);
    assert.equal(current.box.status, "stored");
    assert.equal((current.lines[0] as Row).status, "committed");
    assert.equal((await rows("movements")).length, 1);
    assert.equal((await rows("skus")).length, 1);
    assert.equal(current.box.unit_count, 3);
  });

  it("nega cliente externo, sessão trocada, caixa de outro cliente e escrita após conclusão", async () => {
    const { code } = await createBox();
    await assert.rejects(createOpeningConferenceBox(db, {
      customer_code: CUSTOMER, session_id: sessionId, idempotency_key: nonce(),
    }, { uid: "client-user", role: "cliente", customer_code: CUSTOMER }), /somente administração/);
    await assert.rejects(getOpeningConferenceBox(db, { ...scope(code), session_id: "outra-sessao" }, actor), /outro cliente/);
    const other = "Cliente Outro";
    const otherSession = openingInventorySessionDocumentId(other);
    await db.collection("opening_inventory_sessions").doc(otherSession).set({ customer_code: other, status: "open" });
    await assert.rejects(getOpeningConferenceBox(db, {
      customer_code: other, session_id: otherSession, box_code: code,
    }, actor), /outro cliente ou sessão/);
    await db.collection("opening_inventory_sessions").doc(sessionId).update({ status: "completed" });
    await assert.rejects(save(code), /não está ativo/);
  });
});

describe("guarda de conferência com empilhamento", () => {
  it("leva a permissão e o apoio da sugestão até a guarda e o saldo em A-02", async () => {
    for (let i = 0; i < 3; i += 1) {
      await createWarehouseBox(db, { customer_code: CUSTOMER, ...dimensions, length_m: 0.6, width_m: 0.6, height_m: 0.3,
        location_id: "A-02", idempotency_key: nonce() }, actor);
    }
    const { code } = await createBox();
    await save(code);
    await change(code, "review");
    const measured = { ...dimensions, length_m: 0.6, width_m: 0.6, height_m: 0.3 };
    const suggestion = await suggestWarehousePosition(db, {
      customer_code: CUSTOMER, ...measured, allow_stacking: true, exclude: ["A-01"],
    }, actor);
    assert.equal(suggestion.position?.code, "A-02");
    const placement = suggestion.position!.placement;
    const input = { ...await storeInput(code, "A-02"), ...measured, allow_stacking: true,
      orientation: placement.orientation, support_box_code: placement.support_box_code };
    const stored = await storeOpeningConferenceBox(db, input, actor);
    assert.equal(stored.box.status, "stored");
    assert.equal(stored.box.support_box_code, placement.support_box_code);
    assert.equal(stored.box.base_height_m, 0.3);
    assert.equal(stored.box.location_id, "A-02");
    assert.equal((await rows("stock_balances"))[0]!.location_id, "A-02");
    const replayed = await storeOpeningConferenceBox(db, input, actor);
    assert.equal(replayed.box.code, code);
    assert.equal((await rows("opening_inventory_lines")).length, 1);
    await assert.rejects(removeWarehouseBox(db, { code: placement.support_box_code!, customer_code: CUSTOMER }, actor), /serve de apoio/);
  });

  it("reserva empilhada bloqueia o apoio e libera o vínculo ao voltar à conferência", async () => {
    const base = await createWarehouseBox(db, { customer_code: CUSTOMER, ...dimensions, height_m: 0.3,
      location_id: "A-02", idempotency_key: nonce() }, actor);
    const { code } = await createBox();
    await save(code);
    await change(code, "review");
    await reserveCheckpoint(code, "A-02");
    await db.collection("warehouse_boxes").doc(code).update({
      allow_stacking: true, support_box_code: base.box.code, base_height_m: 0.3,
    });
    await assert.rejects(removeWarehouseBox(db, { code: base.box.code, customer_code: CUSTOMER }, actor), /serve de apoio/);
    await change(code, "release");
    const released = (await state(code)).box;
    assert.equal(released.status, "counting");
    assert.equal(released.support_box_code, null);
    assert.equal(released.base_height_m, null);
    await removeWarehouseBox(db, { code: base.box.code, customer_code: CUSTOMER }, actor);
  });

  it("na abertura, a prateleira escolhida entra mesmo sem o encaixe calculado", async () => {
    assert.equal(openingSessionDocId(CUSTOMER), openingInventorySessionDocumentId(CUSTOMER));
    assert.equal(sessionId, openingSessionDocId(CUSTOMER));
    await createWarehouseBox(db, {
      customer_code: CUSTOMER, length_m: 1.8, width_m: 0.5, height_m: 0.4, location_id: "A-02", idempotency_key: nonce(),
    }, actor);
    const measured = { length_m: 0.5, width_m: 0.4, height_m: 0.305, allow_tilt: true, allow_stacking: true };
    await assert.rejects(
      suggestWarehousePosition(db, { customer_code: CUSTOMER, ...measured, location_id: "A-02" }, actor),
      /não cabe/,
    );
    const preview = await suggestWarehousePosition(db, {
      customer_code: CUSTOMER, ...measured, location_id: "A-02", exclude: ["A-02"], opening_inventory: true,
    }, actor);
    assert.equal(preview.position?.code, "A-02");
    assert.equal(preview.position?.model_fit, false);
    assert.equal(preview.position?.placement.orientation, "height_length_width");
    assert.equal(preview.position?.placement.front_m, 0.305);
    assert.match(preview.position?.reason ?? "", /não confirmou/);
    const automatic = await suggestWarehousePosition(db, { customer_code: CUSTOMER, ...measured, opening_inventory: true }, actor);
    assert.equal(automatic.position?.code, "A-01");
    assert.equal(automatic.position?.model_fit, undefined);
    await db.collection("warehouse_positions").doc("A-03").update({ status: "blocked" });
    await assert.rejects(
      suggestWarehousePosition(db, { customer_code: CUSTOMER, ...measured, location_id: "A-03", opening_inventory: true }, actor),
      /ativa/,
    );

    const { code } = await createBox();
    await save(code);
    await change(code, "review");
    const stored = await storeOpeningConferenceBox(db, {
      ...await storeInput(code, "A-02"), ...measured,
      orientation: preview.position!.placement.orientation, support_box_code: null,
    }, actor);
    assert.equal(stored.box.status, "stored");
    assert.equal(stored.box.location_id, "A-02");
    assert.equal(stored.box.opening_model_fit, false);
    assert.equal(stored.box.front_m, 0.305);
    const started = (await db.collection("events").where("type", "==", "inventory.opening_box_storage_started").get()).docs
      .map((row) => row.data())
      .find((event) => event.entity_id === code);
    assert.equal(started?.payload.opening_model_fit, false);
    assert.ok(Math.abs(Number(started?.payload.occupancy_before.front_used_m) - 1.8) < 0.001);

    const second = await createBox();
    await save(second.code, { client_item_code: "CAMISA-M", size: "M" });
    await change(second.code, "review");
    const again = await storeOpeningConferenceBox(db, { ...await storeInput(second.code, "A-02"), ...measured }, actor);
    assert.equal(again.box.location_id, "A-02");
    assert.equal(again.box.opening_model_fit, false);

    const legacy = await createWarehouseBox(db, {
      customer_code: CUSTOMER, session_id: sessionId, ...measured, location_id: "A-02", idempotency_key: nonce(),
    }, actor);
    assert.equal(legacy.box.opening_model_fit, false);
    const legacyEvent = (await db.collection("events").where("entity_id", "==", legacy.box.code).get()).docs
      .map((row) => row.data())
      .find((event) => event.type === "warehouse.box_stored");
    assert.match(String(legacyEvent?.description), /não confirmou/);

    await db.collection("opening_inventory_sessions").doc(sessionId).update({ status: "completed" });
    await assert.rejects(
      suggestWarehousePosition(db, { customer_code: CUSTOMER, ...measured, location_id: "A-02", opening_inventory: true }, actor),
      /não cabe/,
    );
    await assert.rejects(createWarehouseBox(db, {
      customer_code: CUSTOMER, session_id: sessionId, ...measured, location_id: "A-02", idempotency_key: nonce(),
    }, actor), /não cabe/);
  });
});
