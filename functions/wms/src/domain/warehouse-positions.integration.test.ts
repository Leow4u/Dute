import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

import {
  DEFAULT_WAREHOUSE_LAYOUT,
  createWarehouseAisle,
  deleteWarehousePosition,
  listWarehousePositions,
  seedDefaultWarehouseLayout,
  upsertWarehousePositions,
} from "./warehouse-positions.js";

const PROJECT_ID = "demo-dute-operations";
const coordenacao = { uid: "ops-1", name: "Leonardo", role: "interno", email: "ops@dutelog.com.br" };
const operacao = { uid: "wms-1", name: "Operador", role: "wms" };
let db: Firestore;
let app: ReturnType<typeof initializeApp>;

before(() => {
  app = initializeApp({ projectId: PROJECT_ID }, "warehouse-positions-test");
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

async function events(type: string) {
  return (await db.collection("events").where("type", "==", type).get()).docs.map((row) => row.data());
}

describe("cadastro de posições do armazém", () => {
  it("carrega o mapa inicial uma vez só, em ordem de caminhada, com evento", async () => {
    const result = await seedDefaultWarehouseLayout(db, coordenacao);
    assert.equal(result.created.length, DEFAULT_WAREHOUSE_LAYOUT.length);
    const positions = await listWarehousePositions(db);
    assert.equal(positions.length, 43);
    assert.deepEqual(positions.slice(0, 3).map((row) => [row.code, row.sequence]), [["A-01", 1], ["A-02", 2], ["A-03", 3]]);
    assert.deepEqual(positions[14], { ...positions[14], code: "A-16", sequence: 15, status: "active", customer_code: null, source: "default_layout" });
    assert.equal(positions[positions.length - 1]!.code, "C-12");
    assert.equal(positions[positions.length - 1]!.sequence, 43);
    const created = await events("warehouse.positions_created");
    assert.equal(created.length, 1);
    assert.match(String(created[0]!.title), /Mapa inicial/);
    assert.equal(created[0]!.actor.uid, "ops-1");

    await assert.rejects(seedDefaultWarehouseLayout(db, coordenacao), /já tem prateleiras/);
    assert.equal((await listWarehousePositions(db)).length, 43);
  });

  it("edita uma prateleira sem apagar o que não foi enviado; operação WMS não altera", async () => {
    await seedDefaultWarehouseLayout(db, coordenacao);
    await upsertWarehousePositions(
      db,
      { positions: [{ aisle: "a", shelf: 16, length_m: 1.8, depth_m: 0.75, height_m: 1.5, notes: null }] },
      coordenacao,
    );
    const a16 = (await db.collection("warehouse_positions").doc("A-16").get()).data()!;
    assert.equal(a16.height_m, 1.5);
    assert.equal(a16.notes, null);
    assert.equal(a16.sequence, 15);
    assert.equal(a16.status, "active");
    assert.equal(a16.updated_by, "ops-1");
    assert.equal((await events("warehouse.positions_updated")).length, 1);

    await upsertWarehousePositions(
      db,
      { positions: [{ aisle: "A", shelf: 16, length_m: 1.8, depth_m: 0.75, height_m: 1.5, customer_code: "BTG Pactual", max_weight_kg: 80, status: "blocked" }] },
      coordenacao,
    );
    const zoned = (await db.collection("warehouse_positions").doc("A-16").get()).data()!;
    assert.equal(zoned.customer_code, "BTG Pactual");
    assert.equal(zoned.max_weight_kg, 80);
    assert.equal(zoned.status, "blocked");
    assert.equal(zoned.height_m, 1.5);

    await assert.rejects(
      upsertWarehousePositions(db, { positions: [{ aisle: "A", shelf: 1, length_m: 1.8, depth_m: 0.75, height_m: 0.65 }] }, operacao),
      /administração ou coordenação/,
    );
  });

  it("rua nova entra com N prateleiras depois da última sequência; rua repetida é recusada", async () => {
    await seedDefaultWarehouseLayout(db, coordenacao);
    const result = await createWarehouseAisle(
      db,
      { aisle: "d", shelves: 4, length_m: 1.8, depth_m: 0.75, height_m: 0.9, max_weight_kg: null, customer_code: "BTG Pactual" },
      coordenacao,
    );
    assert.deepEqual(result.created, ["D-01", "D-02", "D-03", "D-04"]);
    const positions = await listWarehousePositions(db);
    assert.equal(positions.length, 47);
    assert.deepEqual(positions.slice(43).map((row) => [row.code, row.sequence, row.customer_code, row.source]), [
      ["D-01", 44, "BTG Pactual", "new_aisle"],
      ["D-02", 45, "BTG Pactual", "new_aisle"],
      ["D-03", 46, "BTG Pactual", "new_aisle"],
      ["D-04", 47, "BTG Pactual", "new_aisle"],
    ]);
    await assert.rejects(
      createWarehouseAisle(db, { aisle: "A", shelves: 2, length_m: 1.8, depth_m: 0.75, height_m: 0.9 }, coordenacao),
      /já existe/,
    );
    assert.equal((await listWarehousePositions(db)).length, 47);
  });

  it("remove posição vazia e recusa posição com saldo", async () => {
    await seedDefaultWarehouseLayout(db, coordenacao);
    await db.collection("stock_balances").doc("bal-1").set({
      customer_code: "BTG Pactual",
      sku_code: "BTG-1",
      location_id: "B-05",
      qty_on_hand: 3,
      qty_reserved: 0,
    });
    await assert.rejects(deleteWarehousePosition(db, { code: "B-05" }, coordenacao), /ainda tem saldo/);
    await assert.rejects(deleteWarehousePosition(db, { code: "Z-99" }, coordenacao), /não encontrada/);
    await assert.rejects(deleteWarehousePosition(db, { code: "C-12" }, operacao), /administração ou coordenação/);

    const result = await deleteWarehousePosition(db, { code: "c-12" }, coordenacao);
    assert.equal(result.code, "C-12");
    assert.equal((await db.collection("warehouse_positions").doc("C-12").get()).exists, false);
    assert.equal((await listWarehousePositions(db)).length, 42);
    const deleted = await events("warehouse.position_deleted");
    assert.equal(deleted.length, 1);
    assert.equal(deleted[0]!.entity_id, "C-12");
  });
});
