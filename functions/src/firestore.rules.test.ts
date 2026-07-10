import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";

const PROJECT_ID = "demo-dute-operations";
const CUSTOMER_A = "BTG Pactual";
const CUSTOMER_B = "CLIENTE ISOLADO";

let testEnvironment: RulesTestEnvironment;

function emulatorAddress() {
  const address = process.env.FIRESTORE_EMULATOR_HOST;
  assert.ok(address, "Execute este teste pelo Firebase Emulator.");
  const [host, rawPort] = address.split(":");
  return { host, port: Number(rawPort) };
}

function rulesSource() {
  const currentDirectory = dirname(fileURLToPath(import.meta.url));
  return readFileSync(resolve(currentDirectory, "../../firestore.rules"), "utf8");
}

async function seed() {
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    const database = context.firestore();
    const users = [
      ["owner-a", "owner", undefined],
      ["admin-a", "admin", undefined],
      ["ops-a", "interno", undefined],
      ["wms-a", "wms", undefined],
      ["finance-a", "financeiro", undefined],
      ["client-a", "cliente", CUSTOMER_A],
      ["client-b", "cliente", CUSTOMER_B],
    ] as const;
    for (const [uid, role, customerCode] of users) {
      await setDoc(doc(database, "users", uid), {
        nome: uid,
        email: `${uid}@example.com`,
        role,
        ...(customerCode ? { customer_code: customerCode } : {}),
      });
    }

    await setDoc(doc(database, "stock_balances", "balance-a"), {
      customer_code: CUSTOMER_A,
      sku_code: "BTG-TEST-1",
      location_id: "A-01",
      qty_on_hand: 10,
      qty_reserved: 0,
      qty_available: 10,
    });
    await setDoc(doc(database, "movements", "movement-a"), {
      customer_code: CUSTOMER_A,
      sku_code: "BTG-TEST-1",
      quantity: 10,
      type: "inventory.received",
      created_at: new Date(),
    });
    await setDoc(doc(database, "client_inventory", "inventory-a"), {
      customer_code: CUSTOMER_A,
      sku_code: "BTG-TEST-1",
      qty_on_hand: 10,
      qty_reserved: 0,
      qty_available: 10,
      published_at: new Date(),
    });
    await setDoc(doc(database, "client_inventory", "inventory-b"), {
      customer_code: CUSTOMER_B,
      sku_code: "OTHER-1",
      qty_on_hand: 5,
      qty_reserved: 0,
      qty_available: 5,
      published_at: new Date(),
    });
  });
}

before(async () => {
  const { host, port } = emulatorAddress();
  testEnvironment = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { host, port, rules: rulesSource() },
  });
});

beforeEach(async () => {
  await testEnvironment.clearFirestore();
  await seed();
});

after(async () => {
  await testEnvironment.cleanup();
});

describe("ledger e mutações críticas", () => {
  it("permite leitura interna e bloqueia qualquer mutação do ledger no navegador", async () => {
    const database = testEnvironment
      .authenticatedContext("admin-a", { email: "admin-a@example.com" })
      .firestore();
    const movement = doc(database, "movements", "movement-a");

    await assertSucceeds(getDoc(movement));
    await assertFails(
      setDoc(doc(database, "movements", "movement-b"), {
        customer_code: CUSTOMER_A,
        sku_code: "BTG-TEST-1",
        quantity: 1,
      }),
    );
    await assertFails(updateDoc(movement, { quantity: 99 }));
    await assertFails(deleteDoc(movement));
  });

  it("bloqueia saldo, pedido e tarefa WMS fora das Cloud Functions", async () => {
    const database = testEnvironment
      .authenticatedContext("wms-a", { email: "wms-a@example.com" })
      .firestore();

    await assertFails(
      updateDoc(doc(database, "stock_balances", "balance-a"), {
        qty_on_hand: 999,
      }),
    );
    await assertFails(
      setDoc(doc(database, "orders", "order-browser"), {
        customer_code: CUSTOMER_A,
        status: "ABERTO",
      }),
    );
    await assertFails(
      setDoc(doc(database, "pick_tasks", "pick-browser"), {
        customer_code: CUSTOMER_A,
        status: "planned",
      }),
    );
  });
});

describe("isolamento entre clientes", () => {
  it("cliente lê somente a projeção publicada da própria conta", async () => {
    const database = testEnvironment
      .authenticatedContext("client-a", { email: "client-a@example.com" })
      .firestore();

    await assertSucceeds(getDoc(doc(database, "client_inventory", "inventory-a")));
    await assertFails(getDoc(doc(database, "client_inventory", "inventory-b")));
    await assertFails(getDoc(doc(database, "stock_balances", "balance-a")));

    const ownInventory = await assertSucceeds(
      getDocs(
        query(
          collection(database, "client_inventory"),
          where("customer_code", "==", CUSTOMER_A),
        ),
      ),
    );
    assert.equal(ownInventory.size, 1);
  });

  it("cliente não altera nem a própria projeção", async () => {
    const database = testEnvironment
      .authenticatedContext("client-a", { email: "client-a@example.com" })
      .firestore();
    await assertFails(
      updateDoc(doc(database, "client_inventory", "inventory-a"), {
        qty_available: 1000,
      }),
    );
  });
});
