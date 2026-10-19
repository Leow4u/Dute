import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

import {
  completeOpeningInventorySessionTransaction,
  createCustomerRequestTransaction,
  createInboundReceiptTransaction,
  createOpeningInventorySessionTransaction,
  createReturnReceiptTransaction,
  recordCycleCountTransaction,
  type OperationalActor,
} from "./operations.js";

/**
 * Isolamento entre clientes nas trilhas de estoque (PR 1b, cliente ativo):
 * a abertura de um cliente não trava nem libera os pedidos de outro, e a
 * operação de um cliente não reaproveita o cadastro de outro.
 */

const PROJECT_ID = "demo-dute-operations";
const BTG = "BTG Pactual";
const ITAU = "Itaú";
const NOVO = "Cliente Novo";
const operacao: OperationalActor = { uid: "wms-1", name: "Operação", role: "wms", email: "wms@dutelog.com.br" };
const pending = { stock_initialized: false, opening_inventory_required: true, movements_frozen: false };
const initialized = { stock_initialized: true, opening_inventory_required: false, movements_frozen: false };

let db: Firestore;
let app: ReturnType<typeof initializeApp>;

before(() => {
  app = initializeApp({ projectId: PROJECT_ID }, `customer-isolation-${Date.now()}`);
  db = getFirestore(app);
});

after(async () => {
  await deleteApp(app);
});

async function reset(control: Record<string, unknown>) {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error("FIRESTORE_EMULATOR_HOST não definido.");
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
  await db.collection("system_controls").doc("inventory").set(control);
}

async function control() {
  return (await db.collection("system_controls").doc("inventory").get()).data() ?? {};
}

async function seedBalance(customer: string, sku: string, client: string) {
  await db.collection("stock_balances").doc(`bal-${sku}`).set({
    id: `bal-${sku}`,
    customer_code: customer,
    sku_code: sku,
    client_item_code: client,
    product_name: "Produto de teste",
    location_id: "A-01",
    qty_on_hand: 10,
    qty_reserved: 0,
    qty_available: 10,
    unit_cost: 10,
  });
}

function outbound(customer: string, sku: string, client: string, key: string) {
  return createCustomerRequestTransaction(
    db,
    {
      type: "retirada",
      priority: "normal",
      title: "Pedido de teste",
      destination: "Destino de teste",
      customer_code: customer,
      idempotency_key: key,
      items: [{ sku_code: sku, client_item_code: client, product_name: "Produto de teste", quantity: 1 }],
    },
    { uid: `cliente-${key}`, role: "cliente", customer_code: customer, name: "Cliente" },
  );
}

async function openSession(customer: string, key: string) {
  const session = await createOpeningInventorySessionTransaction(db, { customer_code: customer, idempotency_key: key }, operacao);
  return String(session.session_id);
}

function count(customer: string, sessionId: string, overrides: Record<string, unknown>) {
  return recordCycleCountTransaction(
    db,
    {
      mode: "opening",
      session_id: sessionId,
      customer_code: customer,
      product_registration: "new",
      category: "MOBILIARIO",
      genero: "Unissex",
      grupo: "MOVEIS",
      location_id: "D-01",
      counted_qty: 2,
      unit_cost: 50,
      reason: "Inventário físico de abertura",
      photo_urls: ["https://storage.googleapis.com/demo/product-photos/peca.jpg"],
      ...overrides,
    } as Parameters<typeof recordCycleCountTransaction>[1],
    operacao,
  );
}

function receipt(customer: string, key: string, item: Record<string, unknown>) {
  return createInboundReceiptTransaction(
    db,
    {
      customer_code: customer,
      supplier: "Fornecedor",
      idempotency_key: key,
      items: [
        {
          product_name: "Produto recebido",
          category: "MOBILIARIO",
          unit_cost: 40,
          quantity: 3,
          photo_urls: ["https://storage.googleapis.com/demo/product-photos/recebido.jpg"],
          ...item,
        },
      ],
    } as Parameters<typeof createInboundReceiptTransaction>[1],
    operacao,
  );
}

describe("inventário de abertura por cliente", () => {
  it("abrir e concluir a contagem de outro cliente não mexe no controle global nem nos pedidos da BTG", async () => {
    await reset(initialized);
    await seedBalance(BTG, "BTG-1", "A.01");
    await seedBalance(ITAU, "ITAU-1", "7781-01");

    const itauSession = await openSession(ITAU, "itau-open-1");
    assert.equal((await control()).stock_initialized, true);
    assert.equal((await control()).opening_inventory_required, false);
    assert.equal((await control()).opening_inventory_session_id, undefined);

    await outbound(BTG, "BTG-1", "A.01", "btg-during-itau-opening");
    await assert.rejects(outbound(ITAU, "ITAU-1", "7781-01", "itau-during-own-opening"), /inventário de abertura/);

    await count(ITAU, itauSession, {
      sku_code: "ITAU-SKU-1",
      client_item_code: "7781-02",
      product_name: "Cadeira giratória preta",
      idempotency_key: "itau-count-1",
    });
    await completeOpeningInventorySessionTransaction(
      db,
      { customer_code: ITAU, session_id: itauSession, idempotency_key: "itau-complete-1" },
      operacao,
    );

    assert.equal((await control()).stock_initialized, true);
    assert.equal((await control()).opening_inventory_session_id, undefined);
    await outbound(ITAU, "ITAU-1", "7781-01", "itau-after-own-opening");
    await outbound(BTG, "BTG-1", "A.01", "btg-after-itau-opening");
  });

  it("depois da zeragem, a BTG segue travada e um cliente novo pede normalmente", async () => {
    await reset(pending);
    await seedBalance(BTG, "BTG-2", "A.02");
    await seedBalance(NOVO, "NOVO-1", "N-01");

    await assert.rejects(outbound(BTG, "BTG-2", "A.02", "btg-after-reset"), /inventário de abertura/);
    await outbound(NOVO, "NOVO-1", "N-01", "novo-after-reset");

    // Concluir a abertura de outro cliente não libera a BTG.
    const itauSession = await openSession(ITAU, "itau-open-2");
    await count(ITAU, itauSession, {
      sku_code: "ITAU-SKU-2",
      client_item_code: "7790-11",
      product_name: "Mesa de reunião",
      idempotency_key: "itau-count-2",
    });
    await completeOpeningInventorySessionTransaction(
      db,
      { customer_code: ITAU, session_id: itauSession, idempotency_key: "itau-complete-2" },
      operacao,
    );
    assert.equal((await control()).opening_inventory_required, true);
    await assert.rejects(outbound(BTG, "BTG-2", "A.02", "btg-after-itau-complete"), /inventário de abertura/);
  });

  it("a abertura da BTG continua escrevendo o controle global, como antes", async () => {
    await reset(initialized);
    const btgSession = await openSession(BTG, "btg-open-3");
    assert.equal((await control()).stock_initialized, false);
    assert.equal((await control()).opening_inventory_session_id, btgSession);
  });
});

describe("catálogo com dono", () => {
  it("a contagem de outro cliente não reaproveita produto da BTG, nem o legado sem customer_code", async () => {
    await reset(initialized);
    const btgSession = await openSession(BTG, "btg-open-cat");
    await count(BTG, btgSession, {
      sku_code: "BTG-SKU-A01",
      client_item_code: "A.01",
      product_name: "Camisa social branca",
      category: "VESTUARIO",
      genero: "Masculino",
      grupo: "CAMISA",
      location_id: "A-01",
      idempotency_key: "btg-count-a01",
    });
    // Cadastro anterior ao multicliente: sem customer_code, é da BTG.
    await db.collection("products").doc("LEGADO-1").set({
      id: "LEGADO-1",
      cod_cliente: "LEGADO-1",
      cod_cliente_key: "LEGADO-1",
      produto: "Gravata legada",
      status: "active",
    });
    await db.collection("skus").doc("SKU-LEGADO-1").set({
      id: "SKU-LEGADO-1",
      sku_code: "SKU-LEGADO-1",
      sku_code_key: "SKU-LEGADO-1",
      cod_btg: "SKU-LEGADO-1",
      cod_cliente: "LEGADO-1",
      cod_cliente_key: "LEGADO-1",
      produto: "Gravata legada",
      status: "active",
    });

    const itauSession = await openSession(ITAU, "itau-open-cat");
    await assert.rejects(
      count(ITAU, itauSession, {
        sku_code: "BTG-SKU-A01",
        client_item_code: "A.01",
        product_name: "Camisa social branca",
        product_registration: "existing",
        idempotency_key: "itau-count-btg-existing",
      }),
      /O código A\.01 já está cadastrado para o cliente BTG Pactual/,
    );
    await assert.rejects(
      count(ITAU, itauSession, {
        sku_code: "ITAU-NOVO",
        client_item_code: "A.01",
        product_name: "Camisa social branca",
        idempotency_key: "itau-count-btg-as-new",
      }),
      /cadastrado para o cliente BTG Pactual/,
    );
    await assert.rejects(
      count(ITAU, itauSession, {
        sku_code: "SKU-LEGADO-1",
        client_item_code: "LEGADO-1",
        product_name: "Gravata legada",
        product_registration: "existing",
        idempotency_key: "itau-count-legacy",
      }),
      /cadastrado para o cliente BTG Pactual/,
    );
    await count(ITAU, itauSession, {
      sku_code: "ITAU-SKU-3",
      client_item_code: "7802-07",
      product_name: "Armário baixo 2 portas",
      idempotency_key: "itau-count-own",
    });

    const legacy = (await db.collection("products").doc("LEGADO-1").get()).data() ?? {};
    assert.equal(legacy.customer_code, undefined);
    const own = (await db.collection("products").doc("7802-07").get()).data() ?? {};
    assert.equal(own.customer_code, ITAU);
    const itauBalances = await db.collection("stock_balances").where("customer_code", "==", ITAU).get();
    assert.deepEqual(itauBalances.docs.map((row) => row.data().sku_code), ["ITAU-SKU-3"]);
  });

  it("o recebimento e a devolução de outro cliente não usam produto da BTG", async () => {
    await reset(initialized);
    await receipt(BTG, "btg-receipt-1", {
      sku_code: "BTG-REC-1",
      client_item_code: "B.01",
      product_registration: "new",
    });

    await assert.rejects(
      receipt(ITAU, "itau-receipt-btg", {
        sku_code: "BTG-REC-1",
        client_item_code: "B.01",
        product_registration: "existing",
      }),
      /O código B\.01 já está cadastrado para o cliente BTG Pactual/,
    );
    await assert.rejects(
      receipt(ITAU, "itau-receipt-btg-new", {
        sku_code: "ITAU-REC-X",
        client_item_code: "B.01",
        product_registration: "new",
      }),
      /cadastrado para o cliente BTG Pactual/,
    );
    await receipt(ITAU, "itau-receipt-own", {
      sku_code: "ITAU-REC-1",
      client_item_code: "7815-09",
      product_registration: "new",
    });
    assert.equal((await db.collection("products").doc("7815-09").get()).data()?.customer_code, ITAU);

    await assert.rejects(
      createReturnReceiptTransaction(
        db,
        {
          customer_code: ITAU,
          source: "Agência",
          idempotency_key: "itau-return-btg",
          items: [{ sku_code: "BTG-REC-1", client_item_code: "B.01", product_name: "Produto recebido", quantity: 1 }],
        },
        operacao,
      ),
      /cadastrado para o cliente BTG Pactual/,
    );
  });
});
