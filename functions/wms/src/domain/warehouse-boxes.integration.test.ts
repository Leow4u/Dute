import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

import {
  createOpeningInventorySessionTransaction,
  recordCycleCountTransaction,
  removeOpeningInventoryLineTransaction,
  type OperationalActor,
} from "./operations.js";
import { seedDefaultWarehouseLayout, upsertWarehousePositions } from "./warehouse-positions.js";
import {
  createWarehouseBox,
  listWarehouseBoxes,
  removeWarehouseBox,
  suggestWarehousePosition,
} from "./warehouse-boxes.js";

const PROJECT_ID = "demo-dute-operations";
const BTG = "BTG Pactual";
const coordenacao = { uid: "ops-1", name: "Leonardo", role: "interno", email: "ops@dutelog.com.br" };
const operacao: OperationalActor = { uid: "wms-1", name: "Operador", role: "wms", email: "wms@dutelog.com.br" };
const cliente = { uid: "cli-1", name: "Cristiane", role: "cliente", customer_code: BTG };
const box = { length_m: 0.5, width_m: 0.5, height_m: 0.35, gross_weight_kg: 12.4 };

let db: Firestore;
let app: ReturnType<typeof initializeApp>;

before(() => {
  app = initializeApp({ projectId: PROJECT_ID }, "warehouse-boxes-test");
  db = getFirestore(app);
});

beforeEach(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error("FIRESTORE_EMULATOR_HOST não definido.");
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
  await seedDefaultWarehouseLayout(db, coordenacao);
  // Produto novo ganha SKU na sigla do cliente (domain/catalog-codes.ts).
  await db.collection("customers").doc("BTG_Pactual").set({ code: BTG, customer_code: BTG, name: BTG, sku_prefix: "BTG", status: "active" });
  // Zona da BTG: A-01 a A-03. O resto fica livre.
  await upsertWarehousePositions(
    db,
    {
      positions: [1, 2, 3].map((shelf) => ({ aisle: "A", shelf, length_m: 1.8, depth_m: 0.75, height_m: 0.65, customer_code: BTG })),
    },
    coordenacao,
  );
});

after(async () => {
  await deleteApp(app);
});

async function events(type: string) {
  return (await db.collection("events").where("type", "==", type).get()).docs.map((row) => row.data());
}

function store(locationId: string, key: string, extra: Record<string, unknown> = {}) {
  return createWarehouseBox(db, { customer_code: BTG, ...box, location_id: locationId, idempotency_key: key, ...extra }, operacao);
}

function openingLine(sessionId: string, boxCode: string, overrides: Record<string, unknown> = {}) {
  return recordCycleCountTransaction(
    db,
    {
      mode: "opening",
      session_id: sessionId,
      customer_code: BTG,
      // Produto novo ganha o SKU gerado (o primeiro depois da limpeza é
      // BTG-000001); o código aqui serve à segunda caixa, como existente.
      sku_code: "BTG-000001",
      client_item_code: "A.01.0802.007.G",
      product_name: "Camisa social branca manga longa",
      product_registration: "new",
      category: "Uniforme",
      genero: "Masculino",
      grupo: "Camisa",
      photo_urls: ["https://storage.googleapis.com/demo-dute-operations/product-photos/camisa.jpg"],
      photo_storage_paths: ["customers/BTG_Pactual/product-photos/camisa.jpg"],
      location_id: "A-01",
      counted_qty: 12,
      unit_cost: 189.9,
      reason: "Inventário físico de abertura",
      box_code: boxCode,
      idempotency_key: `line-${boxCode}-${overrides.idempotency_key ?? "1"}`,
      ...overrides,
    },
    operacao,
  );
}

describe("caixas e endereçamento dirigido", () => {
  it("sugere a primeira prateleira da zona, guarda caixas até encher e repete sem duplicar", async () => {
    const first = await suggestWarehousePosition(db, { customer_code: BTG, ...box, sku_codes: [] }, operacao);
    assert.equal(first.position?.code, "A-01");
    assert.equal(first.position?.tier, 3);
    assert.equal(first.zone_positions, 3);

    const created = await store("a-01", "cx-1", { suggestion: { position: "A-01", reason: first.position?.reason, alternatives: ["A-02", "A-03"] } });
    assert.equal(created.box.code, "CX-000001");
    assert.equal(created.box.location_id, "A-01");
    assert.equal(created.box.front_m, 0.5);
    const replayed = await store("a-01", "cx-1", { suggestion: { position: "A-01", reason: first.position?.reason, alternatives: ["A-02", "A-03"] } });
    assert.equal(replayed.box.code, "CX-000001");
    assert.equal(replayed.replayed, true);
    await store("A-01", "cx-2");
    await store("A-01", "cx-3");
    assert.deepEqual((await listWarehouseBoxes(db, BTG)).map((row) => row.code), ["CX-000003", "CX-000002", "CX-000001"]);

    await assert.rejects(store("A-01", "cx-4"), /não cabe na prateleira A-01/);
    const next = await suggestWarehousePosition(db, { customer_code: BTG, ...box, sku_codes: [] }, operacao);
    assert.equal(next.position?.code, "A-02");
    assert.equal(next.checked, 3);
    const stored = await events("warehouse.box_stored");
    assert.equal(stored.length, 3);
    assert.match(String(stored.find((event) => event.entity_id === "CX-000001")?.description), /na posição sugerida/);
  });

  it("só guarda na zona do cliente e em prateleira ativa; recusa marca a prateleira em verificação", async () => {
    await assert.rejects(store("B-01", "fora-da-zona"), /não é da zona de BTG Pactual/);
    await assert.rejects(store("Z-99", "inexistente"), /não está cadastrada/);
    await upsertWarehousePositions(
      db,
      { positions: [{ aisle: "A", shelf: 3, length_m: 1.8, depth_m: 0.75, height_m: 0.65, status: "blocked" }] },
      coordenacao,
    );
    await assert.rejects(store("A-03", "bloqueada"), /bloqueada/);
    await assert.rejects(store("A-01", "sem-permissao", {}).then(() => createWarehouseBox(db, { customer_code: BTG, ...box, location_id: "A-02", idempotency_key: "cliente" }, cliente)), /somente administração ou operação/);

    const refused = await store("A-02", "recusa", { refusal: { position: "A-01", reason: "Prateleira ocupada por material fora do sistema" } });
    assert.equal(refused.box.location_id, "A-02");
    const a01 = (await db.collection("warehouse_positions").doc("A-01").get()).data()!;
    assert.equal(a01.status, "review");
    assert.match(String(a01.notes), /Guarda recusada .* Prateleira ocupada/);
    const refusals = await events("warehouse.position_refused");
    assert.equal(refusals.length, 1);
    assert.equal(refusals[0]!.entity_id, "A-01");
    const after = await suggestWarehousePosition(db, { customer_code: BTG, ...box, sku_codes: [] }, operacao);
    assert.equal(after.position?.code, "A-02");
    assert.equal(after.checked, 1);
  });

  it("rejeita caixa alta ou pesada demais e explica a zona cheia", async () => {
    await assert.rejects(store("A-01", "alta", { height_m: 0.7 }), /não cabe/);
    await upsertWarehousePositions(
      db,
      { positions: [{ aisle: "A", shelf: 1, length_m: 1.8, depth_m: 0.75, height_m: 0.65, max_weight_kg: 20 }] },
      coordenacao,
    );
    await store("A-01", "peso-1");
    await assert.rejects(store("A-01", "peso-2"), /peso máximo 20 kg/);
    const noZone = await suggestWarehousePosition(db, { customer_code: "Cliente Sem Zona", ...box, sku_codes: [] }, operacao);
    assert.equal(noZone.position, null);
    assert.match(String(noZone.rejected), /Atribua uma rua/);
  });

  it("linhas da abertura entram na caixa: somam o saldo da posição, contam na caixa e saem na correção", async () => {
    const session = await createOpeningInventorySessionTransaction(
      db,
      { customer_code: BTG, reference: "ABERTURA", idempotency_key: "sessao-1" },
      operacao,
    );
    const sessionId = String(session.session_id);
    await store("A-01", "cx-1", { session_id: sessionId });
    await store("A-01", "cx-2", { session_id: sessionId });

    await assert.rejects(openingLine(sessionId, "CX-000009"), /não encontrada/);
    await assert.rejects(openingLine(sessionId, "CX-000001", { location_id: "A-02" }), /está em A-01, não em A-02/);

    const first = await openingLine(sessionId, "CX-000001");
    assert.equal(first.box_code, "CX-000001");
    assert.equal(first.qty_counted, 12);
    const second = await openingLine(sessionId, "CX-000002", { product_registration: "existing", counted_qty: 18 });
    assert.equal(second.qty_before, 12);
    assert.equal(second.qty_available, 30);

    const balances = await db.collection("stock_balances").where("customer_code", "==", BTG).get();
    assert.equal(balances.size, 1);
    assert.equal(balances.docs[0]!.data().qty_on_hand, 30);
    assert.equal(balances.docs[0]!.data().location_id, "A-01");
    const lines = await db.collection("opening_inventory_lines").where("session_id", "==", sessionId).get();
    assert.deepEqual(lines.docs.map((row) => row.data().box_code).sort(), ["CX-000001", "CX-000002"]);
    const boxOne = (await db.collection("warehouse_boxes").doc("CX-000001").get()).data()!;
    const boxTwo = (await db.collection("warehouse_boxes").doc("CX-000002").get()).data()!;
    assert.deepEqual([boxOne.line_count, boxOne.unit_count, boxOne.sku_codes], [1, 12, ["BTG-000001"]]);
    assert.deepEqual([boxTwo.line_count, boxTwo.unit_count], [1, 18]);
    assert.ok(Math.abs(Number(boxTwo.total_cost) - 18 * 189.9) < 1e-6);
    const sku = (await db.collection("skus").doc("BTG-000001").get()).data()!;
    assert.equal(sku.estoque_atual, 30);

    // O mesmo SKU já está em A-01: a próxima caixa dele vai para A-01 (ainda cabe uma).
    const suggestion = await suggestWarehousePosition(db, { customer_code: BTG, ...box, sku_codes: ["BTG-000001"] }, operacao);
    assert.equal(suggestion.position?.code, "A-01");
    assert.equal(suggestion.position?.tier, 1);

    // Correção da segunda caixa: o saldo volta a 12, a caixa fica vazia e pode ser removida.
    const secondLine = lines.docs.find((row) => row.data().box_code === "CX-000002")!;
    await removeOpeningInventoryLineTransaction(
      db,
      { customer_code: BTG, session_id: sessionId, opening_line_id: secondLine.id, idempotency_key: "remove-2" },
      operacao,
    );
    const balanceAfter = (await db.collection("stock_balances").where("customer_code", "==", BTG).get()).docs[0]!.data();
    assert.equal(balanceAfter.qty_on_hand, 12);
    assert.equal(balanceAfter.qty_available, 12);
    const boxTwoAfter = (await db.collection("warehouse_boxes").doc("CX-000002").get()).data()!;
    assert.deepEqual([boxTwoAfter.line_count, boxTwoAfter.unit_count], [0, 0]);
    assert.equal((await db.collection("skus").doc("BTG-000001").get()).data()!.estoque_atual, 12);
    const reversal = (await db.collection("movements").where("source", "==", "functions_opening_inventory_reversal").get()).docs[0]!.data();
    assert.equal(reversal.quantity ?? reversal.qtd ?? reversal.quantidade, 18);

    await assert.rejects(removeWarehouseBox(db, { code: "CX-000001" }, operacao), /ainda tem 1 produto/);
    await assert.rejects(removeWarehouseBox(db, { code: "CX-000002" }, cliente), /somente administração ou operação/);
    const removed = await removeWarehouseBox(db, { code: "cx-000002", customer_code: BTG }, operacao);
    assert.equal(removed.code, "CX-000002");
    assert.equal((await db.collection("warehouse_boxes").doc("CX-000002").get()).exists, false);
    assert.equal((await events("warehouse.box_removed")).length, 1);
    await assert.rejects(removeWarehouseBox(db, { code: "CX-000002" }, operacao), /não encontrada/);
  });
});
