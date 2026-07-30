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
    await setDoc(doc(database, "products", "product-a"), {
      id: "product-a",
      customer_code: CUSTOMER_A,
      cod_cliente: "BTG-TEST-1",
      produto: "Produto real de teste",
      status: "active",
    });
    await setDoc(doc(database, "billing_config", "default"), {
      ad_valorem_rate: 0.005,
      cliente_nome: CUSTOMER_A,
    });
    await setDoc(
      doc(database, "billing_operational_snapshots", "2026-07"),
      {
        customer_code: CUSTOMER_A,
        competencia: "2026-07",
        mode: "baseline",
        usage: { custo_estoque: 1000, entradas_pecas: 10 },
      },
    );
    await setDoc(doc(database, "ai_agent_inbox", "alert-a"), {
      status: "open",
      entity_type: "estoque",
      customer_code: CUSTOMER_A,
    });
    await setDoc(doc(database, "invites", "invite-a"), {
      email: "invited@example.com",
      role: "cliente",
      customer_code: CUSTOMER_A,
      status: "pending",
      created_by: "owner-a",
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

  it("bloqueia catálogo, faturamento, alertas e RBAC fora das Cloud Functions", async () => {
    const database = testEnvironment
      .authenticatedContext("owner-a", { email: "owner-a@example.com" })
      .firestore();

    await assertFails(
      updateDoc(doc(database, "products", "product-a"), {
        produto: "Alteração direta indevida",
      }),
    );
    await assertFails(
      updateDoc(doc(database, "billing_config", "default"), {
        ad_valorem_rate: 0.9,
      }),
    );
    await assertSucceeds(
      getDoc(
        doc(database, "billing_operational_snapshots", "2026-07"),
      ),
    );
    await assertFails(
      updateDoc(
        doc(database, "billing_operational_snapshots", "2026-07"),
        { mode: "replace" },
      ),
    );
    await assertFails(
      updateDoc(doc(database, "ai_agent_inbox", "alert-a"), {
        status: "resolved",
      }),
    );
    await assertFails(
      updateDoc(doc(database, "users", "ops-a"), { role: "owner" }),
    );
    await assertFails(
      setDoc(doc(database, "invites", "browser-invite"), {
        email: "browser@example.com",
        role: "owner",
        status: "pending",
      }),
    );
  });

  it("mantém somente a aceitação do próprio convite disponível antes do perfil", async () => {
    const database = testEnvironment
      .authenticatedContext("invited-user", { email: "invited@example.com" })
      .firestore();
    await assertSucceeds(
      updateDoc(doc(database, "invites", "invite-a"), {
        status: "used",
        used_by: "invited-user",
        used_at: new Date(),
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
