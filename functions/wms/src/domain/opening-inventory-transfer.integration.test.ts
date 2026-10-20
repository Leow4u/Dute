import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

import {
  createOpeningInventorySessionTransaction,
  recordCycleCountTransaction,
  removeOpeningInventoryLineTransaction,
  moveOpeningInventoryLineTransaction,
  type OperationalActor,
} from "./operations.js";
import { seedDefaultWarehouseLayout, upsertWarehousePositions } from "./warehouse-positions.js";
import {
  createWarehouseBox,
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
  app = initializeApp({ projectId: PROJECT_ID }, "opening-inventory-transfer-test");
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


async function scenario() {
  const session = await createOpeningInventorySessionTransaction(
    db, { customer_code: BTG, reference: "ABERTURA", idempotency_key: "opening" }, operacao,
  );
  const sessionId = String(session.session_id);
  await store("A-01", "box-1", { session_id: sessionId });
  await store("A-01", "box-2", { session_id: sessionId });
  await store("A-02", "box-3", { session_id: sessionId });
  const first = await openingLine(sessionId, "CX-000001");
  const line = (await db.collection("opening_inventory_lines").where("session_id", "==", sessionId).get()).docs[0]!;
  const input = {
    customer_code: BTG, session_id: sessionId, opening_line_id: line.id,
    target_box_code: "CX-000002", reason: "Conferência física: lançamento na caixa errada",
    idempotency_key: "move-1",
  };
  return { sessionId, first, line, input };
}

async function catalog(): Promise<Array<Array<Record<string, unknown>>>> {
  return Promise.all(["products", "skus", "client_inventory"].map(async (collection) =>
    (await db.collection(collection).get()).docs.map((doc) => ({ id: doc.id, ...doc.data() })),
  ));
}

describe("correção de caixa de linha do inventário de abertura", () => {
  it("transfere a linha inteira na mesma posição preservando catálogo, fotos, custo e totais; replay não duplica", async () => {
    const { sessionId, line, input } = await scenario();
    const beforeCatalog = await catalog();
    const beforeSession = (await db.collection("opening_inventory_sessions").doc(sessionId).get()).data()!;
    const beforeBalances = (await db.collection("stock_balances").get()).docs.map((doc) => doc.data());
    const beforeMovements = (await db.collection("movements").get()).size;
    const result = await moveOpeningInventoryLineTransaction(db, input, operacao);
    assert.equal(result.quantity_moved, 12);
    assert.notEqual(result.opening_line_id, line.id);
    assert.equal((await line.ref.get()).exists, false);
    const moved = (await db.collection("opening_inventory_lines").doc(String(result.opening_line_id)).get()).data()!;
    for (const field of ["sku_code", "client_item_code", "photo_urls", "photo_storage_paths", "unit_cost", "total_cost", "counted_qty", "cycle_count_id", "movement_id"]) {
      assert.deepEqual(moved[field], line.data()[field], field);
    }
    assert.equal(moved.box_code, "CX-000002");
    assert.equal(moved.location_id, "A-01");
    assert.deepEqual(await catalog(), beforeCatalog);
    assert.deepEqual((await db.collection("stock_balances").get()).docs.map((doc) => doc.data()), beforeBalances);
    assert.equal((await db.collection("movements").get()).size, beforeMovements);
    const afterSession = (await db.collection("opening_inventory_sessions").doc(sessionId).get()).data()!;
    for (const field of ["line_count", "unit_count", "total_cost"]) assert.equal(afterSession[field], beforeSession[field]);
    const source = (await db.collection("warehouse_boxes").doc("CX-000001").get()).data()!;
    const target = (await db.collection("warehouse_boxes").doc("CX-000002").get()).data()!;
    assert.deepEqual([source.line_count, source.unit_count, source.total_cost, source.sku_codes], [0, 0, 0, []]);
    assert.deepEqual([target.line_count, target.unit_count, target.sku_codes], [1, 12, ["BTG-000001"]]);
    assert.ok(Math.abs(Number(target.total_cost) - 12 * 189.9) < 1e-6);
    assert.deepEqual(await moveOpeningInventoryLineTransaction(db, input, operacao), result);
    await assert.rejects(
      moveOpeningInventoryLineTransaction(db, { ...input, target_box_code: "CX-000003" }, operacao),
      /idempotência|idempotency|mesma chave/i,
    );
    const audit = await events("inventory.opening_line_moved");
    assert.equal(audit.length, 1);
    assert.equal(audit[0]!.actor.uid, operacao.uid);
    assert.equal(audit[0]!.payload.reason, input.reason);
  });

  it("transfere entre posições com saldo existente, deixa rastro não faturável e permite estornar a linha corrigida", async () => {
    const { sessionId, line, input } = await scenario();
    await openingLine(sessionId, "CX-000003", {
      location_id: "A-02", product_registration: "existing", counted_qty: 18,
    });
    await store("A-02", "box-4", { session_id: sessionId });
    const beforeCatalog = await catalog();
    const result = await moveOpeningInventoryLineTransaction(db, { ...input, target_box_code: "CX-000004" }, operacao);
    assert.deepEqual(await catalog(), beforeCatalog);
    const balances = (await db.collection("stock_balances").get()).docs.map((doc) => doc.data());
    assert.equal(balances.length, 1);
    assert.deepEqual([balances[0]!.location_id, balances[0]!.qty_on_hand, balances[0]!.qty_available], ["A-02", 30, 30]);
    const transfers = (await db.collection("movements").where("source", "==", "functions_opening_inventory_transfer").get()).docs.map((doc) => doc.data());
    assert.equal(transfers.length, 2);
    assert.equal(transfers.reduce((sum, row) => sum + Number(row.saldo_delta), 0), 0);
    for (const movement of transfers) {
      assert.equal(movement.type, "inventory.relocated");
      assert.equal(movement.billable, false);
      assert.equal(movement.unit_cost, line.data().unit_cost);
      assert.equal(movement.total_cost, line.data().total_cost);
      assert.equal(movement.original_movement_id, line.data().movement_id);
    }
    const deltas = transfers.map((row) => [row.location_id, row.saldo_delta]).sort();
    assert.deepEqual(deltas, [["A-01", -12], ["A-02", 12]]);
    await removeOpeningInventoryLineTransaction(db, {
      customer_code: BTG, session_id: sessionId, opening_line_id: String(result.opening_line_id), idempotency_key: "remove-moved",
    }, operacao);
    const afterBalance = (await db.collection("stock_balances").get()).docs[0]!.data();
    assert.deepEqual([afterBalance.location_id, afterBalance.qty_on_hand], ["A-02", 18]);
    const boxFour = (await db.collection("warehouse_boxes").doc("CX-000004").get()).data()!;
    assert.deepEqual([boxFour.line_count, boxFour.unit_count], [0, 0]);
    const sku = (await db.collection("skus").doc("BTG-000001").get()).data()!;
    assert.equal(sku.estoque_atual, 18);
    assert.deepEqual(sku.photo_urls, beforeCatalog[1]![0]!.photo_urls);
    const allMovements = (await db.collection("movements").get()).docs.map((doc) => doc.data());
    assert.equal(allMovements.reduce((sum, row) => sum + Number(row.saldo_delta), 0), 18);
    const session = (await db.collection("opening_inventory_sessions").doc(sessionId).get()).data()!;
    assert.deepEqual([session.line_count, session.unit_count], [1, 18]);
  });

  it("cria o saldo de destino quando ele ainda não existe e preserva a soma global", async () => {
    const { input } = await scenario();
    await moveOpeningInventoryLineTransaction(db, { ...input, target_box_code: "CX-000003" }, operacao);
    const balances = (await db.collection("stock_balances").get()).docs.map((doc) => doc.data());
    assert.equal(balances.length, 1);
    assert.deepEqual([balances[0]!.location_id, balances[0]!.qty_on_hand], ["A-02", 12]);
    assert.equal((await db.collection("skus").doc("BTG-000001").get()).get("estoque_atual"), 12);
  });

  it("rejeita destino com o mesmo SKU sem juntar contagens nem alterar qualquer saldo", async () => {
    const { sessionId, input } = await scenario();
    await openingLine(sessionId, "CX-000002", { product_registration: "existing", counted_qty: 18 });
    const beforeCatalog = await catalog();
    await assert.rejects(moveOpeningInventoryLineTransaction(db, input, operacao), /já contém este SKU/);
    assert.deepEqual(await catalog(), beforeCatalog);
    assert.equal((await db.collection("opening_inventory_lines").get()).size, 2);
    assert.equal((await events("inventory.opening_line_moved")).length, 0);
  });

  it("valida papel, motivo, sessão, cliente das caixas e estado de guarda", async () => {
    const { sessionId, input } = await scenario();
    await assert.rejects(moveOpeningInventoryLineTransaction(db, input, cliente), /somente à operação/);
    await assert.rejects(moveOpeningInventoryLineTransaction(db, { ...input, reason: "" }, operacao), /motivo/);
    await assert.rejects(moveOpeningInventoryLineTransaction(db, { ...input, customer_code: "OUTRO" }, operacao), /sessão não pertence/);
    await assert.rejects(moveOpeningInventoryLineTransaction(db, { ...input, target_box_code: "CX-000001" }, operacao), /diferente/);
    const target = db.collection("warehouse_boxes").doc("CX-000002");
    const original = (await target.get()).data()!;
    await target.update({ customer_code: "OUTRO" });
    await assert.rejects(moveOpeningInventoryLineTransaction(db, input, operacao), /mesmo cliente e inventário/);
    await target.set({ ...original, origin: { kind: "opening_inventory", session_id: "outra-sessao" } });
    await assert.rejects(moveOpeningInventoryLineTransaction(db, input, operacao), /mesmo cliente e inventário/);
    await target.set({ ...original, status: "committing" });
    await assert.rejects(moveOpeningInventoryLineTransaction(db, input, operacao), /precisam estar guardadas/);
    await target.set(original);
    await db.collection("warehouse_boxes").doc("CX-000001").update({ status: "committing" });
    await assert.rejects(moveOpeningInventoryLineTransaction(db, input, operacao), /precisam estar guardadas/);
    await db.collection("warehouse_boxes").doc("CX-000001").update({ status: "stored" });
    await db.collection("opening_inventory_sessions").doc(sessionId).update({ status: "completed" });
    await assert.rejects(moveOpeningInventoryLineTransaction(db, input, operacao), /enquanto o inventário/);
    assert.equal((await events("inventory.opening_line_moved")).length, 0);
  });

  it("bloqueia estoque congelado, reserva e saldo inconsistente antes de escrever", async () => {
    const { input } = await scenario();
    const control = db.collection("system_controls").doc("inventory");
    await control.set({ movements_frozen: true });
    await assert.rejects(moveOpeningInventoryLineTransaction(db, input, operacao), /congelad|bloquead|reconcilia/i);
    await control.delete();
    const balance = (await db.collection("stock_balances").get()).docs[0]!;
    await balance.ref.update({ qty_reserved: 1, qty_available: 11 });
    await assert.rejects(moveOpeningInventoryLineTransaction(db, input, operacao), /reserva/);
    await balance.ref.update({ qty_reserved: 0, qty_on_hand: 2, qty_available: 2 });
    await assert.rejects(moveOpeningInventoryLineTransaction(db, input, operacao), /não comporta/);
    assert.equal((await db.collection("opening_inventory_lines").get()).size, 1);
    assert.equal((await events("inventory.opening_line_moved")).length, 0);
  });

  it("duas correções concorrentes da mesma linha não duplicam produtos ou estoque", async () => {
    const { input } = await scenario();
    const results = await Promise.allSettled([
      moveOpeningInventoryLineTransaction(db, input, operacao),
      moveOpeningInventoryLineTransaction(db, { ...input, target_box_code: "CX-000003", idempotency_key: "move-2" }, operacao),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal((await db.collection("opening_inventory_lines").get()).size, 1);
    assert.equal((await events("inventory.opening_line_moved")).length, 1);
    const boxes = (await db.collection("warehouse_boxes").get()).docs.map((doc) => doc.data());
    assert.equal(boxes.reduce((sum, row) => sum + Number(row.unit_count), 0), 12);
    const balances = (await db.collection("stock_balances").get()).docs.map((doc) => doc.data());
    assert.equal(balances.reduce((sum, row) => sum + Number(row.qty_on_hand), 0), 12);
  });
});
