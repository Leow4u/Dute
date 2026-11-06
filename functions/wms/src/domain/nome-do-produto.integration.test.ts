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
 * O nome do produto novo no padrão de 06/11/2026 (domain/nome-para-gravar.ts,
 * tools/padronizar-nomes/README.md): a Contagem, a chegada avulsa e o aviso do
 * cliente gravam o nome igual em todos os tamanhos ("Polo Masculino Piquet
 * Preto") e o tamanho do código no campo Tamanho; a equipe é recusada quando o
 * nome ou o Tamanho contradizem o código; o aviso do cliente não é recusado
 * (vale o código); o produto já cadastrado guarda o nome que tem.
 */

const PROJECT_ID = "demo-dute-operations";
const BTG = "BTG Pactual";
const operacao: OperationalActor = { uid: "wms-1", name: "Operação", role: "wms", email: "wms@dutelog.com.br" };
const cristiane: OperationalActor = { uid: "cli-1", name: "Cristiane", role: "cliente", customer_code: BTG };
const FOTO = "https://storage.googleapis.com/demo/product-photos/polo.jpg";

let db: Firestore;
let app: ReturnType<typeof initializeApp>;

before(() => {
  app = initializeApp({ projectId: PROJECT_ID }, `nome-do-produto-${Date.now()}`);
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
}

async function openSession(key: string) {
  const session = await createOpeningInventorySessionTransaction(db, { customer_code: BTG, idempotency_key: key }, operacao);
  return String(session.session_id);
}

function count(sessionId: string, overrides: Record<string, unknown>) {
  return recordCycleCountTransaction(
    db,
    {
      mode: "opening",
      session_id: sessionId,
      customer_code: BTG,
      product_registration: "new",
      category: "POLO",
      genero: "Masculino",
      grupo: "VESTUÁRIO",
      location_id: "A-01",
      counted_qty: 3,
      unit_cost: 48.9,
      reason: "Inventário físico de abertura",
      photo_urls: [FOTO],
      ...overrides,
    } as Parameters<typeof recordCycleCountTransaction>[1],
    operacao,
  );
}

function receipt(key: string, items: Array<Record<string, unknown>>) {
  return createInboundReceiptTransaction(
    db,
    {
      customer_code: BTG,
      supplier: "Fornecedor",
      idempotency_key: key,
      items: items.map((item) => ({
        category: "POLO",
        unit_cost: 40,
        quantity: 2,
        product_registration: "new",
        photo_urls: [FOTO],
        ...item,
      })),
    } as Parameters<typeof createInboundReceiptTransaction>[1],
    operacao,
  );
}

async function catalogo(clientCode: string) {
  const [skus, products] = await Promise.all([
    db.collection("skus").where("cod_cliente_key", "==", clientCode).get(),
    db.collection("products").where("cod_cliente_key", "==", clientCode).get(),
  ]);
  return { skus: skus.docs.map((row) => row.data()), products: products.docs.map((row) => row.data()) };
}

describe("o nome do produto novo no padrão (passo 2 da padronização)", () => {
  it("a Contagem grava o nome sem o tamanho, com a etiqueta do gênero, e o tamanho do código", async () => {
    await reset();
    const session = await openSession("abertura-nomes");
    const contado = await count(session, {
      client_item_code: "A.01.0806.005.XG",
      product_name: "polo masculina piquet preto - XG",
      idempotency_key: "conta-xg",
    });
    const { skus, products } = await catalogo("A.01.0806.005.XG");
    assert.equal(skus.length, 1);
    assert.equal(products.length, 1);
    for (const registro of [...skus, ...products]) {
      assert.equal(registro.produto, "Polo Masculino Piquet Preto");
      assert.equal(registro.tamanho, "XG");
      assert.equal(registro.size, "XG");
    }
    const saldo = await db.collection("stock_balances").where("sku_code", "==", contado.sku_code).get();
    assert.equal(saldo.docs[0]?.data().product_name, "Polo Masculino Piquet Preto");
    const portal = await db.collection("client_inventory").where("sku_code", "==", contado.sku_code).get();
    assert.equal(portal.docs[0]?.data().product_name, "Polo Masculino Piquet Preto");
    assert.equal(portal.docs[0]?.data().size, "XG");
  });

  it("a Contagem recusa o nome com outro tamanho e o Tamanho que contradiz o código, sem gravar", async () => {
    await reset();
    const session = await openSession("abertura-recusa");
    await assert.rejects(
      count(session, { client_item_code: "A.01.0806.005.XG", product_name: "Polo Masculino Piquet Preto M", idempotency_key: "conta-nome-m" }),
      /O nome termina em M, e o código A\.01\.0806\.005\.XG é do tamanho XG\./,
    );
    await assert.rejects(
      count(session, { client_item_code: "A.01.0806.005.XG", product_name: "Polo Masculino Piquet Preto", size: "M", idempotency_key: "conta-campo-m" }),
      /O código A\.01\.0806\.005\.XG é do tamanho XG, e o Tamanho informado é M\./,
    );
    assert.deepEqual(await catalogo("A.01.0806.005.XG"), { skus: [], products: [] });
    assert.equal((await db.collection("sku_counters").doc("BTG").get()).data()?.last ?? 0, 0);
  });

  it("o produto já cadastrado guarda o nome que tem até o passo 3", async () => {
    await reset();
    await db.collection("skus").doc("BTG-000126").set({
      id: "BTG-000126",
      sku_code: "BTG-000126",
      cod_btg: "BTG-000126",
      customer_code: BTG,
      cod_cliente: "A.01.0806.005.XG",
      cod_cliente_key: "A.01.0806.005.XG",
      produto: "Polo masculino piquet preto - XG",
      status: "active",
      archived: false,
    });
    await db.collection("products").doc("A.01.0806.005.XG").set({
      id: "A.01.0806.005.XG",
      customer_code: BTG,
      cod_cliente: "A.01.0806.005.XG",
      cod_cliente_key: "A.01.0806.005.XG",
      produto: "Polo masculino piquet preto - XG",
      status: "active",
      archived: false,
    });
    const session = await openSession("abertura-existente");
    await count(session, {
      product_registration: "existing",
      sku_code: "BTG-000126",
      client_item_code: "A.01.0806.005.XG",
      product_name: "Polo masculino piquet preto - XG",
      idempotency_key: "conta-existente",
    });
    const { skus } = await catalogo("A.01.0806.005.XG");
    assert.equal(skus[0]?.produto, "Polo masculino piquet preto - XG");
  });

  it("a chegada avulsa grava o produto novo no padrão e recusa o que contradiz o código", async () => {
    await reset();
    await receipt("chegada-nomes", [
      { client_item_code: "A.02.0809.002.GG", product_name: "POLO FEMININA PIQUET ARPOADOR GG", line_number: 1 },
    ]);
    const { skus, products } = await catalogo("A.02.0809.002.GG");
    assert.equal(skus[0]?.produto, "Polo Feminino Piquet Arpoador");
    assert.equal(skus[0]?.tamanho, "GG");
    assert.equal(products[0]?.produto, "Polo Feminino Piquet Arpoador");
    const linhas = await db.collection("inbound_items").where("client_item_code", "==", "A.02.0809.002.GG").get();
    assert.equal(linhas.docs[0]?.data().product_name, "Polo Feminino Piquet Arpoador");
    assert.equal(linhas.docs[0]?.data().size, "GG");

    await assert.rejects(
      receipt("chegada-recusa", [{ client_item_code: "A.02.0809.002.XG", product_name: "Polo Feminino Piquet Arpoador G" }]),
      /O nome termina em G, e o código A\.02\.0809\.002\.XG é do tamanho XG\./,
    );
    assert.deepEqual(await catalogo("A.02.0809.002.XG"), { skus: [], products: [] });
  });

  it("o aviso do cliente não é recusado: o nome vai para o padrão e vale o tamanho do código", async () => {
    await reset();
    const criado = await createCustomerRequestTransaction(
      db,
      {
        type: "recebimento",
        priority: "normal",
        title: "Envio de uniformes",
        customer_code: BTG,
        supplier: "Confecção",
        idempotency_key: "aviso-nomes",
        items: [
          { sku_code: "A.01.0310.001.G", client_item_code: "A.01.0310.001.G", product_name: "camiseta basica branca masculina M", product_registration: "new", quantity: 10 },
        ],
      } as Parameters<typeof createCustomerRequestTransaction>[1],
      cristiane,
    );
    const id = String((criado as { id: unknown }).id);
    await decideCustomerRequestTransaction(db, { request_id: id, action: "approve", expected_status: "open", idempotency_key: "aviso-nomes-ok" }, operacao);
    const linhas = await db.collection("inbound_items").where("receipt_id", "==", `inb_${id}`).get();
    assert.equal(linhas.size, 1);
    assert.equal(linhas.docs[0]?.data().product_name, "Camiseta Basica Branca Masculino");
    assert.equal(linhas.docs[0]?.data().size, "G");
  });
});
