import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { Timestamp, getFirestore, type Firestore } from "firebase-admin/firestore";

import {
  completeOpeningInventorySessionTransaction,
  createCustomerRequestTransaction,
  createInventoryMovementTransaction,
  createOpeningInventorySessionTransaction,
  decideCustomerRequestTransaction,
  recordCycleCountTransaction,
  type OperationalActor,
} from "./operations.js";

/**
 * FIFO por data (docs/plataforma/fifo-por-data.md, parte 4), com as
 * transações de verdade no emulador: o pedido do cliente vai primeiro à
 * prateleira de data de guarda livre mais antiga e só passa à seguinte quando
 * ela não basta. A data sai do razão (movements): o dia de São Paulo do
 * created_at de cada ENTRADA, e a contagem de abertura vale o dia em que a
 * sessão começou. O servidor grava o created_at da hora de agora, então aqui
 * o razão é semeado (ou reescrito) com o created_at do dia de cada caso.
 *
 * Antes desta parte, o pedido seguia a ordem de location_id: A-01 antes de
 * B-01, qualquer que fosse a data.
 */

const PROJECT_ID = "demo-dute-operations";
const BTG = "BTG Pactual";
const ITAU = "Itaú";
const SKU = "BTG-POLO-M";
const coordenacao: OperationalActor = { uid: "coord-1", email: "coord@dutelog.com.br", name: "Mariana Lopes", role: "interno", customer_code: "Dutelog" };
const armazem: OperationalActor = { uid: "wms-1", email: "wms@dutelog.com.br", name: "Rafael", role: "wms", customer_code: "Dutelog" };
const cliente: OperationalActor = { uid: "client-1", email: "compras@btg.com.br", name: "Compras BTG", role: "cliente", customer_code: BTG };

let db: Firestore;
let app: ReturnType<typeof initializeApp>;
let sequencia = 0;

before(() => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST, "Execute este teste pelo Firebase Emulator.");
  app = initializeApp({ projectId: PROJECT_ID }, `fifo-por-data-${Date.now()}`);
  db = getFirestore(app);
});

after(async () => {
  await deleteApp(app);
});

beforeEach(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  const response = await fetch(`http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
  assert.equal(response.ok, true, await response.text());
  await Promise.all([
    db.collection("customers").doc("BTG_Pactual").set({ code: BTG, customer_code: BTG, name: BTG, sku_prefix: "BTG", status: "active" }),
    db.collection("products").doc("POLO-M").set({ id: "POLO-M", customer_code: BTG, cod_cliente: "POLO-M", produto: "Camiseta polo M", status: "active" }),
    db.collection("skus").doc(SKU).set({ id: SKU, customer_code: BTG, cod_cliente: "POLO-M", cod_btg: SKU, sku_code: SKU, produto: "Camiseta polo M", status: "active" }),
  ]);
});

/** O saldo do SKU num local, como os testes de pedido semeiam. */
function saldo(local: string, quantidade: number, reservado = 0) {
  const id = `bal-${SKU}-${local}`;
  return db.collection("stock_balances").doc(id).set({
    id,
    customer_code: BTG,
    sku_code: SKU,
    client_item_code: "POLO-M",
    product_name: "Camiseta polo M",
    category: "UNIFORMES",
    location_id: local,
    qty_on_hand: quantidade,
    qty_reserved: reservado,
    qty_available: quantidade - reservado,
  });
}

/**
 * Uma ENTRADA do razão com os campos que createMovement grava, e o created_at
 * (a hora do servidor) do dia do caso. `extra` troca o que o caso precisa.
 */
function entrada(local: string, quantidade: number, quando: string, extra: Record<string, unknown> = {}) {
  sequencia += 1;
  const id = `mov-fifo-${sequencia}`;
  const digitado = new Date(quando).toISOString();
  return db.collection("movements").doc(id).set({
    id,
    data: digitado,
    occurred_at: digitado,
    type: "inventory.received",
    tipo_mov: "ENTRADA",
    sign: 1,
    sinal: 1,
    quantity: quantidade,
    qtde: quantidade,
    customer_code: BTG,
    cod_cliente: BTG,
    sku_code: SKU,
    cod_sku: SKU,
    client_item_code: "POLO-M",
    product_name: "Camiseta polo M",
    produto: "Camiseta polo M",
    location_id: local,
    saldo_delta: quantidade,
    source: "wms_putaway",
    ...extra,
    created_at: Timestamp.fromDate(new Date(quando)),
  });
}

/** A prateleira com o saldo e a ENTRADA que o explica. */
async function guardado(local: string, quantidade: number, quando: string) {
  await Promise.all([saldo(local, quantidade), entrada(local, quantidade, quando)]);
}

function pedir(itens: Array<{ quantity: number; location_id?: string }>, chave: string, ator = cliente, customer = BTG, sku = SKU) {
  return createCustomerRequestTransaction(
    db,
    {
      type: "retirada",
      priority: "normal",
      title: "Uniformes do evento",
      customer_code: customer,
      idempotency_key: chave,
      items: itens.map((item, index) => ({
        line_number: index + 1,
        sku_code: sku,
        client_item_code: customer === BTG ? "POLO-M" : "CADEIRA-1",
        product_name: customer === BTG ? "Camiseta polo M" : "Cadeira giratória",
        ...item,
      })),
    },
    ator,
  ) as Promise<Record<string, unknown>>;
}

/** O que o pedido reservou em cada local (sem as reservas soltas). */
async function reservas(campo: "customer_request_id" | "order_id", valor: unknown) {
  const snapshot = await db.collection("stock_reservations").where(campo, "==", String(valor)).get();
  const porLocal: Record<string, number> = {};
  for (const doc of snapshot.docs) {
    if (doc.get("status") === "released") continue;
    const local = String(doc.get("location_id"));
    porLocal[local] = (porLocal[local] ?? 0) + Number(doc.get("reserved_qty"));
  }
  return porLocal;
}

async function saldos() {
  const snapshot = await db.collection("stock_balances").where("sku_code", "==", SKU).get();
  return Object.fromEntries(snapshot.docs.map((doc) => [String(doc.get("location_id")), [doc.get("qty_on_hand"), doc.get("qty_reserved")]]));
}

describe("o pedido sai pela data de guarda mais antiga (FIFO por data, parte 4)", () => {
  it("(a) pela criação do portal, B-01 de 05/08 antes de A-01 de 03/10, pelo created_at do razão: o dia digitado e o razão de outro cliente não contam", async () => {
    await Promise.all([
      saldo("A-01", 50),
      saldo("B-01", 50),
      // O campo data digitado diz o contrário do created_at, e não conta.
      entrada("A-01", 50, "2026-10-03T14:00:00-03:00", { data: "2026-07-01T12:00:00.000Z", occurred_at: "2026-07-01T12:00:00.000Z" }),
      entrada("B-01", 50, "2026-08-05T14:00:00-03:00", { data: "2026-12-30T12:00:00.000Z", occurred_at: "2026-12-30T12:00:00.000Z" }),
      // A ENTRADA mais nova em B-01 é de outro cliente: não muda a data da BTG.
      entrada("B-01", 50, "2026-11-01T10:00:00-03:00", { customer_code: ITAU, cod_cliente: ITAU }),
    ]);

    const criado = await pedir([{ quantity: 30 }], "fifo-a");
    assert.equal(criado.reserved_quantity, 30);
    assert.deepEqual(await reservas("customer_request_id", criado.id), { "B-01": 30 });
    assert.deepEqual(await saldos(), { "A-01": [50, 0], "B-01": [50, 30] });
  });

  it("(b) a data mais antiga de A-01 toda reservada: o pedido seguinte vai a B-01, com a data livre mais antiga", async () => {
    await Promise.all([
      saldo("A-01", 120),
      entrada("A-01", 20, "2026-08-05T10:00:00-03:00"),
      entrada("A-01", 100, "2026-10-01T10:00:00-03:00"),
      guardado("B-01", 100, "2026-09-20T10:00:00-03:00"),
    ]);

    // As 20 de 05/08 são as mais antigas: o primeiro pedido as reserva em A-01.
    const primeiro = await pedir([{ quantity: 20 }], "fifo-b-1");
    assert.deepEqual(await reservas("customer_request_id", primeiro.id), { "A-01": 20 });
    // Em A-01 sobram livres só as de 01/10; as de 20/09, em B-01, vêm antes.
    const segundo = await pedir([{ quantity: 30 }], "fifo-b-2");
    assert.deepEqual(await reservas("customer_request_id", segundo.id), { "B-01": 30 });
    assert.deepEqual(await saldos(), { "A-01": [120, 20], "B-01": [100, 30] });
  });

  it("(c) o RECEBIMENTO e a EXPEDICAO, com entradas mais antigas, continuam fora; o pedido que não cabe numa prateleira segue à próxima data", async () => {
    await Promise.all([
      saldo("RECEBIMENTO", 50),
      entrada("RECEBIMENTO", 50, "2026-08-01T10:00:00-03:00", { source: "wms_receiving" }),
      saldo("EXPEDICAO", 10),
      entrada("EXPEDICAO", 10, "2026-08-02T10:00:00-03:00", { source: "wms_order_cancel" }),
      guardado("A-01", 50, "2026-10-03T10:00:00-03:00"),
      guardado("B-01", 50, "2026-08-05T10:00:00-03:00"),
    ]);

    const primeiro = await pedir([{ quantity: 30 }], "fifo-c-1");
    assert.deepEqual(await reservas("customer_request_id", primeiro.id), { "B-01": 30 });
    // B-01 tem 20 livres de 05/08: o pedido as leva e completa em A-01, sem dividir mais.
    const segundo = await pedir([{ quantity: 40 }], "fifo-c-2");
    assert.deepEqual(await reservas("customer_request_id", segundo.id), { "B-01": 20, "A-01": 20 });
    assert.deepEqual(await saldos(), {
      "A-01": [50, 20],
      "B-01": [50, 50],
      EXPEDICAO: [10, 0],
      RECEBIMENTO: [50, 0],
    });
    await assert.rejects(pedir([{ quantity: 31 }], "fifo-c-3"), {
      code: "failed-precondition",
      message: `Saldo insuficiente para o SKU ${SKU}. Disponível: 30; solicitado: 31.`,
    });
  });

  it("(d) saldos semeados sem movimento no razão seguem a ordem de location_id, como antes", async () => {
    await Promise.all([saldo("C-01", 30), saldo("A-01", 30), saldo("B-01", 30)]);

    const criado = await pedir([{ quantity: 50 }], "fifo-d");
    assert.deepEqual(await reservas("customer_request_id", criado.id), { "A-01": 30, "B-01": 20 });
  });

  it("(d2) a prateleira sem data vai depois da que tem data", async () => {
    await Promise.all([saldo("A-01", 30), guardado("B-01", 30, "2026-10-03T10:00:00-03:00"), saldo("C-01", 30)]);

    const criado = await pedir([{ quantity: 20 }], "fifo-d2");
    assert.deepEqual(await reservas("customer_request_id", criado.id), { "B-01": 20 });
  });

  it("(e) a contagem de abertura vale o dia em que a sessão começou, mesmo contada em três dias; a chegada no meio dela vale o dia dela", async () => {
    await db.collection("customers").doc("Itau").set({ code: ITAU, customer_code: ITAU, name: "Itaú Unibanco", sku_prefix: "ITAU", status: "active" });
    const sessao = await createOpeningInventorySessionTransaction(db, { customer_code: ITAU, idempotency_key: "fifo-abertura" }, armazem);
    const sessionId = String(sessao.session_id);
    const contar = (local: string, extra: Record<string, unknown>) =>
      recordCycleCountTransaction(
        db,
        {
          mode: "opening",
          session_id: sessionId,
          customer_code: ITAU,
          client_item_code: "CADEIRA-1",
          product_name: "Cadeira giratória",
          category: "MOBILIARIO",
          genero: "Unissex",
          grupo: "MOVEIS",
          location_id: local,
          counted_qty: 40,
          unit_cost: 50,
          reason: "Inventário físico de abertura",
          photo_urls: ["https://storage.googleapis.com/demo/product-photos/cadeira.jpg"],
          idempotency_key: `fifo-contagem-${local}`,
          ...extra,
        } as Parameters<typeof recordCycleCountTransaction>[1],
        armazem,
      ) as Promise<Record<string, unknown>>;
    const primeira = await contar("C-01", { product_registration: "new" });
    const sku = String(primeira.sku_code);
    await contar("B-01", { product_registration: "existing", sku_code: sku });
    await completeOpeningInventorySessionTransaction(db, { customer_code: ITAU, session_id: sessionId, idempotency_key: "fifo-abertura-fim" }, armazem);
    // Uma chegada lançada à mão no meio da contagem, com a data digitada lá atrás.
    await createInventoryMovementTransaction(
      db,
      {
        type: "ENTRADA",
        quantity: 40,
        customer_code: ITAU,
        sku_code: sku,
        location_id: "A-01",
        reason: "Chegada do fornecedor",
        occurred_at: "2026-07-01T12:00:00.000Z",
        idempotency_key: "fifo-chegada-a01",
      },
      armazem,
    );

    // O servidor grava a hora de agora: a sessão e o razão voltam aos dias do caso.
    await db.collection("opening_inventory_sessions").doc(sessionId).update({ started_at: "2026-10-16T12:00:00.000Z" });
    const dias: Record<string, string> = {
      "C-01": "2026-10-16T15:00:00.000Z",
      "A-01": "2026-10-17T15:00:00.000Z",
      "B-01": "2026-10-18T15:00:00.000Z",
    };
    const razao = await db.collection("movements").where("customer_code", "==", ITAU).where("sku_code", "==", sku).get();
    assert.deepEqual(
      razao.docs.map((doc) => [doc.get("location_id"), doc.get("tipo_mov"), doc.get("opening_inventory_session_id") ?? null]).sort(),
      [["A-01", "ENTRADA", null], ["B-01", "ENTRADA", sessionId], ["C-01", "ENTRADA", sessionId]],
    );
    await Promise.all(razao.docs.map((doc) => doc.ref.update({ created_at: Timestamp.fromDate(new Date(dias[String(doc.get("location_id"))]!)) })));

    // Pela abertura, B-01 e C-01 são de 16/10 (empate: B-01), antes da chegada de 17/10 em A-01.
    const clienteItau: OperationalActor = { uid: "client-itau", name: "Compras Itaú", role: "cliente", customer_code: ITAU };
    const criado = await pedir([{ quantity: 30 }], "fifo-e", clienteItau, ITAU, sku);
    assert.deepEqual(await reservas("customer_request_id", criado.id), { "B-01": 30 });
  });

  it("(f) a decisão da solicitação que chegou sem reserva segue a mesma ordem", async () => {
    await Promise.all([guardado("A-01", 50, "2026-10-03T10:00:00-03:00"), guardado("B-01", 50, "2026-08-05T10:00:00-03:00")]);
    await db.collection("customer_requests").doc("sol-antiga").set({
      id: "sol-antiga",
      type: "retirada",
      status: "open",
      priority: "normal",
      customer_code: BTG,
      title: "Pedido de antes da reserva na criação",
      items: [{ line_number: 1, sku_code: SKU, client_item_code: "POLO-M", product_name: "Camiseta polo M", quantity: 30 }],
    });

    const aprovado = (await decideCustomerRequestTransaction(
      db,
      { request_id: "sol-antiga", action: "approve", expected_status: "open", idempotency_key: "fifo-f" },
      coordenacao,
    )) as Record<string, unknown>;
    assert.deepEqual(await reservas("order_id", aprovado.order_id), { "B-01": 30 });
  });

  it("(g) o que o próprio pedido já pegou sai das datas mais antigas: a segunda linha do mesmo SKU vai a B-01", async () => {
    await Promise.all([
      saldo("A-01", 120),
      entrada("A-01", 20, "2026-08-05T10:00:00-03:00"),
      entrada("A-01", 100, "2026-10-01T10:00:00-03:00"),
      guardado("B-01", 100, "2026-09-20T10:00:00-03:00"),
    ]);

    const criado = await pedir([{ quantity: 20 }, { quantity: 30 }], "fifo-g");
    assert.deepEqual(await reservas("customer_request_id", criado.id), { "A-01": 20, "B-01": 30 });
  });

  it("(h) o item que pede o local continua reservando nele, mesmo com data mais nova", async () => {
    await Promise.all([guardado("A-01", 50, "2026-10-03T10:00:00-03:00"), guardado("B-01", 50, "2026-08-05T10:00:00-03:00")]);

    const criado = await pedir([{ quantity: 10, location_id: "A-01" }, { quantity: 10 }], "fifo-h");
    assert.deepEqual(await reservas("customer_request_id", criado.id), { "A-01": 10, "B-01": 10 });
  });
});
