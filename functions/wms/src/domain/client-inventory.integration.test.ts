import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

import {
  projectMinimumStock,
  readClientInventoryForSku,
  setClientItemArchivedTransaction,
} from "./client-inventory.js";

const PROJECT_ID = "demo-dute-operations";
let db: Firestore;
let app: ReturnType<typeof initializeApp>;

const cristiane = { uid: "cli-1", role: "cliente", customer_code: "BTG Pactual", name: "Cristiane" };

async function seed() {
  const inventory = db.collection("client_inventory");
  await inventory.doc("zerado").set({
    customer_code: "BTG Pactual",
    sku_code: "SKU1",
    client_item_code: "K.0101.001.U",
    product_name: "CANECA",
    qty_on_hand: 0,
    qty_reserved: 0,
    status: "empty",
  });
  await inventory.doc("com-saldo").set({
    customer_code: "BTG Pactual",
    sku_code: "SKU2",
    qty_on_hand: 10,
    qty_reserved: 0,
  });
  await inventory.doc("reservado").set({
    customer_code: "BTG Pactual",
    sku_code: "SKU3",
    qty_on_hand: 0,
    qty_reserved: 2,
  });
  await inventory.doc("outro-cliente").set({
    customer_code: "Outro",
    sku_code: "SKU9",
    qty_on_hand: 0,
    qty_reserved: 0,
  });
}

async function eventsFor(id: string) {
  const snapshot = await db.collection("events").where("entity_id", "==", id).get();
  return snapshot.docs.map((document) => document.data());
}

before(() => {
  app = initializeApp({ projectId: PROJECT_ID }, "client-inventory-test");
  db = getFirestore(app);
});

beforeEach(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error("FIRESTORE_EMULATOR_HOST não definido.");
  await fetch(
    `http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: "DELETE" },
  );
  await seed();
});

after(async () => {
  await deleteApp(app);
});

describe("arquivar item do cliente", () => {
  it("a cliente arquiva item zerado; fica gravado quem e quando, com evento", async () => {
    const result = await setClientItemArchivedTransaction(db, { inventory_id: "zerado", archived: true }, cristiane);
    assert.deepEqual(result, { ok: true, inventory_id: "zerado", archived: true, changed: true });
    const item = (await db.collection("client_inventory").doc("zerado").get()).data() ?? {};
    assert.equal(item.client_archived, true);
    assert.equal(item.client_archived_by, "cli-1");
    assert.equal(item.status, "empty");
    const events = await eventsFor("zerado");
    assert.equal(events.length, 1);
    assert.equal(events[0].type, "client_inventory.archived");
    assert.equal(events[0].customer_code, "BTG Pactual");
  });

  it("repetir não grava de novo; devolver à vitrine limpa o arquivamento", async () => {
    await setClientItemArchivedTransaction(db, { inventory_id: "zerado", archived: true }, cristiane);
    const again = await setClientItemArchivedTransaction(db, { inventory_id: "zerado", archived: true }, cristiane);
    assert.equal(again.changed, false);
    await setClientItemArchivedTransaction(db, { inventory_id: "zerado", archived: false }, cristiane);
    const item = (await db.collection("client_inventory").doc("zerado").get()).data() ?? {};
    assert.equal(item.client_archived, false);
    assert.equal(item.client_archived_by, undefined);
    assert.deepEqual(
      (await eventsFor("zerado")).map((event) => event.type).sort(),
      ["client_inventory.archived", "client_inventory.restored"],
    );
  });

  it("recusa item com saldo ou reserva", async () => {
    for (const id of ["com-saldo", "reservado"]) {
      await assert.rejects(
        setClientItemArchivedTransaction(db, { inventory_id: id, archived: true }, cristiane),
        { code: "failed-precondition" },
      );
    }
  });

  it("recusa item de outro cliente e perfis sem permissão", async () => {
    await assert.rejects(
      setClientItemArchivedTransaction(db, { inventory_id: "outro-cliente", archived: true }, cristiane),
      { code: "permission-denied" },
    );
    for (const role of ["wms", "financeiro", "suporte"]) {
      await assert.rejects(
        setClientItemArchivedTransaction(db, { inventory_id: "zerado", archived: true }, { uid: "x", role }),
        { code: "permission-denied" },
      );
    }
  });

  it("coordenação pode arquivar a pedido da BTG", async () => {
    const result = await setClientItemArchivedTransaction(
      db,
      { inventory_id: "zerado", archived: true },
      { uid: "manoel", role: "interno" },
    );
    assert.equal(result.changed, true);
  });
});

describe("mínimo da ficha no portal", () => {
  it("grava e apaga o mínimo nas projeções do SKU", async () => {
    await db.runTransaction(async (transaction) => {
      const refs = await readClientInventoryForSku(transaction, db, "BTG Pactual", "SKU2");
      projectMinimumStock(transaction, refs, 15);
    });
    assert.equal((await db.collection("client_inventory").doc("com-saldo").get()).data()?.estoque_minimo, 15);
    assert.equal((await db.collection("client_inventory").doc("zerado").get()).data()?.estoque_minimo, undefined);

    await db.runTransaction(async (transaction) => {
      const refs = await readClientInventoryForSku(transaction, db, "BTG Pactual", "SKU2");
      projectMinimumStock(transaction, refs, null);
    });
    assert.equal((await db.collection("client_inventory").doc("com-saldo").get()).data()?.estoque_minimo, undefined);
  });
});
