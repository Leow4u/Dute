import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

import {
  createCustomerRequestTransaction,
  createInboundReceiptTransaction,
  createOpeningInventorySessionTransaction,
  decideCustomerRequestTransaction,
  recordCycleCountTransaction,
  type OperationalActor,
} from "./operations.js";

/**
 * SKU gerado pelo sistema na sigla do cliente (PR 2): produto novo da
 * contagem de abertura, da chegada avulsa e do envio avisado no portal nasce
 * com BTG-000001, ITAU-000001; SKU digitado é ignorado; código de barras não
 * se repete dentro do cliente.
 */

const PROJECT_ID = "demo-dute-operations";
const BTG = "BTG Pactual";
const ITAU = "Itaú";
const operacao: OperationalActor = { uid: "wms-1", name: "Operação", role: "wms", email: "wms@dutelog.com.br" };
const cristiane: OperationalActor = { uid: "cli-1", name: "Cristiane", role: "cliente", customer_code: BTG };

let db: Firestore;
let app: ReturnType<typeof initializeApp>;

before(() => {
  app = initializeApp({ projectId: PROJECT_ID }, `catalog-codes-${Date.now()}`);
  db = getFirestore(app);
});

after(async () => {
  await deleteApp(app);
});

async function reset() {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error("FIRESTORE_EMULATOR_HOST não definido.");
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
  await db.collection("system_controls").doc("inventory").set({ stock_initialized: true, opening_inventory_required: false });
  await db.collection("customers").doc("BTG_Pactual").set({ code: BTG, customer_code: BTG, name: BTG, sku_prefix: "BTG", status: "active", archived: false });
  await db.collection("customers").doc("Itau").set({ code: ITAU, customer_code: ITAU, name: "Itaú Unibanco", sku_prefix: "ITAU", status: "active", archived: false });
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
      product_name: "Produto contado",
      category: "VESTUARIO",
      genero: "Unissex",
      grupo: "CAMISA",
      location_id: "A-01",
      counted_qty: 3,
      unit_cost: 20,
      reason: "Inventário físico de abertura",
      photo_urls: ["https://storage.googleapis.com/demo/product-photos/produto.jpg"],
      ...overrides,
    } as Parameters<typeof recordCycleCountTransaction>[1],
    operacao,
  );
}

function receipt(customer: string, key: string, items: Array<Record<string, unknown>>) {
  return createInboundReceiptTransaction(
    db,
    {
      customer_code: customer,
      supplier: "Fornecedor",
      idempotency_key: key,
      items: items.map((item) => ({
        product_name: "Produto recebido",
        category: "VESTUARIO",
        unit_cost: 40,
        quantity: 2,
        product_registration: "new",
        photo_urls: ["https://storage.googleapis.com/demo/product-photos/recebido.jpg"],
        ...item,
      })),
    } as Parameters<typeof createInboundReceiptTransaction>[1],
    operacao,
  );
}

async function skuOf(clientCode: string) {
  const rows = await db.collection("skus").where("cod_cliente_key", "==", clientCode).get();
  return rows.docs.map((row) => row.id);
}

describe("SKU gerado na sigla do cliente", () => {
  it("a contagem de abertura gera em sequência, por cliente, e ignora SKU digitado", async () => {
    await reset();
    const btgSession = await openSession(BTG, "btg-open");
    const first = await count(BTG, btgSession, {
      client_item_code: "A.01.0802.007.G",
      sku_code: "DIGITADO-1",
      idempotency_key: "btg-count-g",
    });
    assert.equal(first.sku_code, "BTG-000001");
    await count(BTG, btgSession, { client_item_code: "A.01.0802.007.M", location_id: "A-02", idempotency_key: "btg-count-m" });
    assert.deepEqual(await skuOf("A.01.0802.007.G"), ["BTG-000001"]);
    assert.deepEqual(await skuOf("A.01.0802.007.M"), ["BTG-000002"]);
    assert.equal((await db.collection("skus").doc("DIGITADO-1").get()).exists, false);

    const itauSession = await openSession(ITAU, "itau-open");
    const itau = await count(ITAU, itauSession, { client_item_code: "7781-02", location_id: "D-01", idempotency_key: "itau-count" });
    assert.equal(itau.sku_code, "ITAU-000001");

    assert.equal((await db.collection("sku_counters").doc("BTG").get()).data()?.last, 2);
    assert.equal((await db.collection("sku_counters").doc("ITAU").get()).data()?.last, 1);
    // O balanço e a linha da abertura usam o SKU gerado.
    const balance = await db.collection("stock_balances").where("sku_code", "==", "BTG-000001").get();
    assert.equal(balance.size, 1);
    assert.equal(balance.docs[0]?.data().customer_code, BTG);
  });

  it("repetir a mesma contagem (mesma chave) devolve o mesmo SKU sem gastar número", async () => {
    await reset();
    const session = await openSession(BTG, "btg-open-replay");
    const input = { client_item_code: "B.01", idempotency_key: "btg-count-replay" };
    const first = await count(BTG, session, input);
    const again = await count(BTG, session, input);
    assert.equal(again.sku_code, first.sku_code);
    assert.equal((await db.collection("sku_counters").doc("BTG").get()).data()?.last, 1);
  });

  it("sem sigla cadastrada, produto novo não nasce; código já existente é pulado", async () => {
    await reset();
    const semSigla = await openSession("Cliente Sem Sigla", "sem-sigla-open");
    await assert.rejects(
      count("Cliente Sem Sigla", semSigla, { client_item_code: "X-1", idempotency_key: "sem-sigla-count" }),
      /Cadastre a sigla do SKU de Cliente Sem Sigla em Configurações › Clientes/,
    );
    // Cadastro antigo só com customer_code também dá a sigla.
    await db.collection("customers").doc("Antigo").set({ customer_code: "Cliente Antigo", name: "Antigo", sku_prefix: "ANT" });
    const antigo = await openSession("Cliente Antigo", "antigo-open");
    const antigoCount = await count("Cliente Antigo", antigo, { client_item_code: "Y-1", idempotency_key: "antigo-count" });
    assert.equal(antigoCount.sku_code, "ANT-000001");

    await db.collection("skus").doc("BTG-000001").set({ sku_code: "BTG-000001", customer_code: BTG, cod_cliente: "LEGADO", cod_cliente_key: "LEGADO" });
    const session = await openSession(BTG, "btg-open-skip");
    const counted = await count(BTG, session, { client_item_code: "C.01", idempotency_key: "btg-count-skip" });
    assert.equal(counted.sku_code, "BTG-000002");
  });

  it("a chegada avulsa gera um SKU por linha nova e devolve os códigos", async () => {
    await reset();
    const created = await receipt(BTG, "btg-receipt", [
      { client_item_code: "D.01", sku_code: "QUALQUER", product_name: "Camisa D" },
      { client_item_code: "D.02", product_name: "Camisa D2" },
    ]);
    assert.deepEqual(
      (created.items as Array<Record<string, unknown>>).map((item) => [item.client_item_code, item.sku_code]),
      [
        ["D.01", "BTG-000001"],
        ["D.02", "BTG-000002"],
      ],
    );
    const lines = await db.collection("inbound_items").where("receipt_id", "==", created.receipt_id).get();
    assert.deepEqual(lines.docs.map((row) => row.data().sku_code).sort(), ["BTG-000001", "BTG-000002"]);
    assert.equal((await db.collection("skus").doc("BTG-000001").get()).data()?.cod_cliente, "D.01");
    assert.equal((await db.collection("skus").doc("QUALQUER").get()).exists, false);
  });
});

describe("código de barras único dentro do cliente", () => {
  it("produto novo com o código de barras de outro do mesmo cliente é recusado; outro cliente pode", async () => {
    await reset();
    const session = await openSession(BTG, "btg-open-barcode");
    await count(BTG, session, { client_item_code: "E.01", barcode: "7891 0000 0001", idempotency_key: "btg-barcode-1" });
    await assert.rejects(
      count(BTG, session, { client_item_code: "E.02", barcode: "789100000001", location_id: "A-02", idempotency_key: "btg-barcode-2" }),
      /O código de barras 789100000001 já é do SKU BTG-000001/,
    );
    await assert.rejects(
      receipt(BTG, "btg-receipt-barcode", [{ client_item_code: "E.03", barcode: "789100000001" }]),
      /já é do SKU BTG-000001/,
    );

    const itauSession = await openSession(ITAU, "itau-open-barcode");
    const itau = await count(ITAU, itauSession, { client_item_code: "7790-11", barcode: "789100000001", location_id: "D-01", idempotency_key: "itau-barcode" });
    assert.equal(itau.sku_code, "ITAU-000001");
    assert.equal((await db.collection("skus").doc("BTG-000001").get()).data()?.barcode_key, "789100000001");
  });
});

describe("envio avisado no portal", () => {
  async function announce(key: string, items: Array<Record<string, unknown>>) {
    const created = await createCustomerRequestTransaction(
      db,
      {
        type: "recebimento",
        priority: "normal",
        title: "Envio de Gráfica Alfa",
        customer_code: BTG,
        supplier: "Gráfica Alfa",
        idempotency_key: key,
        items: items.map((item) => ({ quantity: 10, ...item })),
      } as Parameters<typeof createCustomerRequestTransaction>[1],
      cristiane,
    );
    return String((created as { id: unknown }).id);
  }

  function approve(id: string, key: string) {
    return decideCustomerRequestTransaction(
      db,
      { request_id: id, action: "approve", expected_status: "open", idempotency_key: key },
      operacao,
    );
  }

  it("produto novo ganha o SKU gerado na confirmação; código já cadastrado liga ao SKU dele", async () => {
    await reset();
    await db.collection("skus").doc("BTG-000007").set({
      sku_code: "BTG-000007",
      cod_btg: "BTG-000007",
      customer_code: BTG,
      cod_cliente: "A.01.0114.004.G",
      cod_cliente_key: "A.01.0114.004.G",
      produto: "CAMISETA G",
    });
    const id = await announce("portal-novo", [
      // O portal manda o código do cliente também em sku_code.
      { sku_code: "f.novo.01", client_item_code: "f.novo.01", product_name: "BONÉ", product_registration: "new" },
      { sku_code: "A.01.0114.004.G", client_item_code: "A.01.0114.004.G", product_name: "CAMISETA", product_registration: "new" },
    ]);
    await approve(id, "portal-novo-ok");

    const lines = await db.collection("inbound_items").where("receipt_id", "==", `inb_${id}`).get();
    const byClient = Object.fromEntries(
      lines.docs.map((row) => [row.data().client_item_code, [row.data().sku_code, row.data().product_registration]]),
    );
    assert.deepEqual(byClient, {
      "F.NOVO.01": ["BTG-000001", "new"],
      "A.01.0114.004.G": ["BTG-000007", "existing"],
    });
    assert.equal((await db.collection("sku_counters").doc("BTG").get()).data()?.last, 1);
    assert.equal((await db.collection("skus").doc("F.NOVO.01").get()).exists, false);
  });

  it("código do catálogo de outro cliente não é ligado ao envio", async () => {
    await reset();
    await db.collection("skus").doc("ITAU-000001").set({
      sku_code: "ITAU-000001",
      customer_code: ITAU,
      cod_cliente: "7781-02",
      cod_cliente_key: "7781-02",
    });
    const id = await announce("portal-outro", [
      { sku_code: "7781-02", client_item_code: "7781-02", product_name: "CADEIRA", product_registration: "new" },
    ]);
    await assert.rejects(approve(id, "portal-outro-ok"), /já está cadastrado para o cliente Itaú/);
    assert.equal((await db.collection("inbound_items").get()).size, 0);
  });
});
