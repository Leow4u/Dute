import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

import {
  advanceWarehouseTaskTransaction,
  cancelWarehouseOrderTransaction,
  createCustomerRequestTransaction,
  createInboundReceiptTransaction,
  createInventoryMovementTransaction,
  decideCustomerRequestTransaction,
  recordCycleCountTransaction,
  updateInboundReceiptConferenceTransaction,
  type OperationalActor,
} from "./operations.js";

/**
 * Só prateleira para o cliente (docs/plataforma/recebimento-com-caixas.md,
 * decisão 10 e parte 7), com as transações de verdade no emulador: o pedido
 * do cliente reserva só da prateleira, e o portal (client_inventory) conta
 * como disponível só o livre das prateleiras; o livre do RECEBIMENTO vai à
 * parte, em qty_receiving, e a EXPEDICAO entra só no total.
 *
 * O SKU começa com 3 na A-01, 2 na EXPEDICAO, 5 no RECEBIMENTO e 4 na S-01:
 * em ordem de local, as duas áreas vêm antes da S-01, e antes desta parte o
 * pedido de 6 reservava A-01 3, EXPEDICAO 2 e RECEBIMENTO 1. O portal começa
 * como a produção está hoje, com o disponível de antes (o total).
 */

const PROJECT_ID = "demo-dute-operations";
const BTG = "BTG Pactual";
const SKU = "BTG-PRATELEIRA-1";
const PORTAL = `cinv_BTG_Pactual__${SKU}`;
const coordenacao: OperationalActor = { uid: "coord-1", email: "coord@dutelog.com.br", name: "Mariana Lopes", role: "interno", customer_code: "Dutelog" };
const armazem: OperationalActor = { uid: "wms-1", email: "wms@dutelog.com.br", name: "Rafael", role: "wms", customer_code: "Dutelog" };
const cliente: OperationalActor = { uid: "client-1", email: "compras@btg.com.br", name: "Compras BTG", role: "cliente", customer_code: BTG };

let db: Firestore;
let app: ReturnType<typeof initializeApp>;

function saldo(id: string, locationId: string, quantity: number, skuCode = SKU) {
  return db.collection("stock_balances").doc(id).set({
    id,
    customer_code: BTG,
    sku_code: skuCode,
    client_item_code: "POLO-P",
    product_name: "Camiseta polo P",
    category: "UNIFORMES",
    location_id: locationId,
    qty_on_hand: quantity,
    qty_reserved: 0,
    qty_available: quantity,
  });
}

before(() => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST, "Execute este teste pelo Firebase Emulator.");
  app = initializeApp({ projectId: PROJECT_ID }, `areas-de-passagem-${Date.now()}`);
  db = getFirestore(app);
});

after(async () => {
  await deleteApp(app);
});

beforeEach(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  const response = await fetch(`http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
  assert.equal(response.ok, true, await response.text());
  const posicao = (code: string, shelf: number) =>
    db.collection("warehouse_positions").doc(code).set({ code, aisle: code.slice(0, 1), shelf, sequence: shelf, length_m: 1.8, depth_m: 0.75, height_m: 0.5, customer_code: BTG, status: "active" });
  await Promise.all([
    db.collection("customers").doc("BTG_Pactual").set({ code: BTG, customer_code: BTG, name: BTG, sku_prefix: "BTG", status: "active" }),
    db.collection("products").doc("POLO-P").set({ id: "POLO-P", customer_code: BTG, cod_cliente: "POLO-P", produto: "Camiseta polo P", status: "active" }),
    db.collection("skus").doc(SKU).set({ id: SKU, customer_code: BTG, cod_cliente: "POLO-P", cod_btg: SKU, sku_code: SKU, produto: "Camiseta polo P", status: "active" }),
    posicao("A-01", 1),
    posicao("S-01", 1),
    saldo("bal-a01", "A-01", 3),
    saldo("bal-expedicao", "EXPEDICAO", 2),
    saldo("bal-recebimento", "RECEBIMENTO", 5),
    saldo("bal-s01", "S-01", 4),
    db.collection("client_inventory").doc(PORTAL).set({
      id: PORTAL,
      customer_code: BTG,
      sku_code: SKU,
      client_item_code: "POLO-P",
      product_name: "Camiseta polo P",
      qty_on_hand: 14,
      qty_reserved: 0,
      qty_available: 14,
      status: "active",
    }),
  ]);
});

function pedir(quantity: number, options: { chave?: string; location_id?: string; sku?: string } = {}) {
  return createCustomerRequestTransaction(
    db,
    {
      type: "retirada",
      priority: "normal",
      title: "Uniformes do evento",
      customer_code: BTG,
      idempotency_key: options.chave ?? `pedido-${quantity}-${options.location_id ?? "livre"}-${options.sku ?? SKU}`,
      items: [{ sku_code: options.sku ?? SKU, product_name: "Camiseta polo P", quantity, ...(options.location_id ? { location_id: options.location_id } : {}) }],
    },
    cliente,
  ) as Promise<Record<string, unknown>>;
}

async function aprovar(requestId: string, chave = `aprovar-${requestId}`) {
  const aprovado = (await decideCustomerRequestTransaction(
    db,
    { request_id: requestId, action: "approve", expected_status: "open", idempotency_key: chave },
    coordenacao,
  )) as Record<string, unknown>;
  return { orderId: String(aprovado.order_id), pickTaskId: String(aprovado.pick_task_id) };
}

function avancar(taskUid: string, expectedStatus: string, operation?: Record<string, unknown>, ator: OperationalActor = armazem) {
  return advanceWarehouseTaskTransaction(
    db,
    { task_uid: taskUid, expected_status: expectedStatus, operation, idempotency_key: `${taskUid}:${expectedStatus}:${ator.uid}` },
    ator,
  ) as Promise<Record<string, unknown>>;
}

/** Separa (a coordenação pode separar a menos), embala e entrega, como as telas de Pedidos. */
async function separar(pickTaskId: string, porLocal: Record<string, number>) {
  await avancar(`picking:${pickTaskId}`, "planned");
  const linhas = await db.collection("pick_lines").where("pick_task_id", "==", pickTaskId).get();
  return avancar(
    `picking:${pickTaskId}`,
    "in_progress",
    {
      picking_lines: linhas.docs.map((linha) => {
        const pedido = Number(linha.get("qty_to_pick"));
        const separado = porLocal[String(linha.get("location_id"))] ?? pedido;
        return {
          pick_line_id: linha.id,
          qty_picked: separado,
          status: "confirmed",
          ...(separado < pedido ? { shortage_reason: "falta", shortage_detail: "A posição tinha menos" } : {}),
        };
      }),
    },
    coordenacao,
  );
}

async function embalar(orderId: string, packTaskId: string) {
  await avancar(`packing:${packTaskId}`, "ready");
  const itens = (await db.collection("order_items").where("order_id", "==", orderId).get()).docs.filter((item) => Number(item.get("picked_qty")) > 0);
  const embalado = await avancar(`packing:${packTaskId}`, "in_progress", {
    volume_label: "VOL-1",
    seal_code: "L-0101",
    package_count: 1,
    packing_lines: itens.map((item) => ({ order_item_id: item.id, qty_packed: Number(item.get("picked_qty")), status: "confirmed" })),
  });
  return String(embalado.shipment_id);
}

async function entregar(shipmentId: string) {
  await avancar(`shipping:${shipmentId}`, "ready_to_dispatch", { carrier: "Dutelog", driver_name: "Rafael", vehicle_plate: "DUTE-001" });
  await avancar(`shipping:${shipmentId}`, "dispatched", { proof_reference: "Carlos Lima", delivery_notes: "Recebido pelo cliente." });
}

async function saldos(skuCode = SKU) {
  const snapshot = await db.collection("stock_balances").where("sku_code", "==", skuCode).get();
  return Object.fromEntries(snapshot.docs.map((doc) => [String(doc.get("location_id")), [doc.get("qty_on_hand"), doc.get("qty_reserved")]]));
}

async function reservasPorLocal(campo: "customer_request_id" | "order_id", valor: unknown) {
  const snapshot = await db.collection("stock_reservations").where(campo, "==", String(valor)).get();
  const porLocal: Record<string, number> = {};
  for (const doc of snapshot.docs) {
    if (doc.get("status") === "released") continue;
    const local = String(doc.get("location_id"));
    porLocal[local] = (porLocal[local] ?? 0) + Number(doc.get("reserved_qty"));
  }
  return porLocal;
}

async function portal() {
  const data = (await db.collection("client_inventory").doc(PORTAL).get()).data() ?? {};
  return { qty_on_hand: data.qty_on_hand, qty_reserved: data.qty_reserved, qty_available: data.qty_available, qty_receiving: data.qty_receiving };
}

describe("o pedido do cliente reserva só da prateleira (recebimento com caixas, parte 7)", () => {
  it("a retirada pula a EXPEDICAO e o RECEBIMENTO: as 6 unidades saem da A-01 e da S-01, e o portal mostra o que sobra em cada lugar", async () => {
    const criado = await pedir(6);
    assert.equal(criado.reserved_quantity, 6);
    assert.deepEqual(await reservasPorLocal("customer_request_id", criado.id), { "A-01": 3, "S-01": 3 });
    assert.deepEqual(await saldos(), { "A-01": [3, 3], EXPEDICAO: [2, 0], RECEBIMENTO: [5, 0], "S-01": [4, 3] });
    assert.deepEqual(await portal(), { qty_on_hand: 14, qty_reserved: 6, qty_available: 1, qty_receiving: 5 });
  });

  it("pedir mais que a prateleira é recusado com o disponível só dela, e nada fica reservado", async () => {
    await assert.rejects(pedir(8), {
      code: "failed-precondition",
      message: `Saldo insuficiente para o SKU ${SKU}. Disponível: 7; solicitado: 8.`,
    });
    assert.equal((await db.collection("stock_reservations").get()).size, 0);
    assert.deepEqual(await saldos(), { "A-01": [3, 0], EXPEDICAO: [2, 0], RECEBIMENTO: [5, 0], "S-01": [4, 0] });
    assert.ok(await pedir(7));
  });

  it("o item que pede o local de uma área é recusado, em qualquer grafia; o local de prateleira segue", async () => {
    for (const local of ["RECEBIMENTO", "expedicao"]) {
      await assert.rejects(pedir(1, { location_id: local }), {
        code: "failed-precondition",
        message: `O local ${local} não atende pedido: o pedido só reserva o que está na prateleira.`,
      });
    }
    assert.equal((await db.collection("stock_reservations").get()).size, 0);
    const daS01 = await pedir(4, { location_id: "S-01" });
    assert.deepEqual(await reservasPorLocal("customer_request_id", daS01.id), { "S-01": 4 });
  });

  it("a área escrita em minúscula ou com acento também fica de fora", async () => {
    const SKU2 = "BTG-PRATELEIRA-2";
    await Promise.all([
      saldo("bal2-expedicao", "Expedição", 2, SKU2),
      saldo("bal2-recebimento", "recebimento", 3, SKU2),
      saldo("bal2-z01", "Z-01", 2, SKU2),
    ]);
    await assert.rejects(pedir(3, { sku: SKU2 }), {
      code: "failed-precondition",
      message: `Saldo insuficiente para o SKU ${SKU2}. Disponível: 2; solicitado: 3.`,
    });
    const criado = await pedir(2, { sku: SKU2 });
    assert.deepEqual(await reservasPorLocal("customer_request_id", criado.id), { "Z-01": 2 });
    const projecao = (await db.collection("client_inventory").doc(`cinv_BTG_Pactual__${SKU2}`).get()).data() ?? {};
    assert.deepEqual([projecao.qty_on_hand, projecao.qty_reserved, projecao.qty_available, projecao.qty_receiving], [7, 2, 0, 3]);
  });

  it("a aprovação da solicitação antiga, sem reserva, também só reserva da prateleira", async () => {
    await db.collection("customer_requests").doc("sol-antiga").set({
      id: "sol-antiga",
      type: "retirada",
      status: "open",
      priority: "normal",
      customer_code: BTG,
      title: "Pedido de antes da reserva na criação",
      items: [{ line_number: 1, sku_code: SKU, client_item_code: "POLO-P", product_name: "Camiseta polo P", quantity: 6 }],
    });
    const { orderId } = await aprovar("sol-antiga");
    assert.deepEqual(await reservasPorLocal("order_id", orderId), { "A-01": 3, "S-01": 3 });
    assert.deepEqual(await saldos(), { "A-01": [3, 3], EXPEDICAO: [2, 0], RECEBIMENTO: [5, 0], "S-01": [4, 3] });
    assert.deepEqual(await portal(), { qty_on_hand: 14, qty_reserved: 6, qty_available: 1, qty_receiving: 5 });
  });

  it("a reserva que já estava numa área continua valendo: a aprovação não a troca", async () => {
    await Promise.all([
      db.collection("customer_requests").doc("sol-reservada").set({
        id: "sol-reservada",
        type: "retirada",
        status: "open",
        priority: "normal",
        customer_code: BTG,
        title: "Pedido reservado antes desta parte",
        items: [{ line_number: 1, sku_code: SKU, client_item_code: "POLO-P", product_name: "Camiseta polo P", quantity: 2 }],
      }),
      db.collection("stock_reservations").doc("res-antiga").set({
        id: "res-antiga",
        customer_code: BTG,
        customer_request_id: "sol-reservada",
        line_number: 1,
        client_line_number: 1,
        sku_code: SKU,
        client_item_code: "POLO-P",
        product_name: "Camiseta polo P",
        location_id: "RECEBIMENTO",
        requested_qty: 2,
        allocated_qty: 2,
        reserved_qty: 2,
        status: "reserved",
        source: "customer_request",
      }),
      db.collection("stock_balances").doc("bal-recebimento").update({ qty_reserved: 2, qty_available: 3 }),
    ]);
    const { orderId } = await aprovar("sol-reservada");
    assert.deepEqual(await reservasPorLocal("order_id", orderId), { RECEBIMENTO: 2 });
    assert.deepEqual(await saldos(), { "A-01": [3, 0], EXPEDICAO: [2, 0], RECEBIMENTO: [5, 2], "S-01": [4, 0] });
  });

  it("recusar a solicitação solta a reserva de volta ao disponível da prateleira", async () => {
    const criado = await pedir(6);
    await decideCustomerRequestTransaction(
      db,
      { request_id: String(criado.id), action: "reject", reason: "Sem transporte nesta semana.", expected_status: "open", idempotency_key: "recusar-1" },
      coordenacao,
    );
    assert.deepEqual(await saldos(), { "A-01": [3, 0], EXPEDICAO: [2, 0], RECEBIMENTO: [5, 0], "S-01": [4, 0] });
    assert.deepEqual(await portal(), { qty_on_hand: 14, qty_reserved: 0, qty_available: 7, qty_receiving: 5 });
  });
});

describe("o portal conta como disponível só o que está na prateleira (parte 7)", () => {
  it("a entrada fica em recebimento, e a guarda passa para o disponível", async () => {
    const chegada = (await createInboundReceiptTransaction(
      db,
      {
        customer_code: BTG,
        supplier: "Confecções Alfa",
        invoice_number: "NF-7",
        idempotency_key: "chegada-1",
        items: [
          {
            line_number: 1,
            sku_code: SKU,
            client_item_code: "POLO-P",
            product_name: "Camiseta polo P",
            product_registration: "existing",
            location_id: "RECEBIMENTO",
            quantity: 4,
          },
        ],
      },
      armazem,
    )) as Record<string, unknown>;
    const receiptId = String(chegada.receipt_id);
    await avancar(`receiving:${receiptId}`, "created");
    const linhas = await db.collection("inbound_items").where("receipt_id", "==", receiptId).get();
    await updateInboundReceiptConferenceTransaction(
      db,
      {
        receipt_id: receiptId,
        expected_status: "checking",
        idempotency_key: "conferencia-1",
        lines: linhas.docs.map((linha) => ({ inbound_item_id: linha.id, received_qty: 4, location_id: "RECEBIMENTO" })),
      },
      armazem,
    );
    await avancar(`receiving:${receiptId}`, "checking");
    assert.deepEqual(await saldos(), { "A-01": [3, 0], EXPEDICAO: [2, 0], RECEBIMENTO: [9, 0], "S-01": [4, 0] });
    assert.deepEqual(await portal(), { qty_on_hand: 18, qty_reserved: 0, qty_available: 7, qty_receiving: 9 });

    const [guarda] = (await db.collection("putaway_tasks").where("receipt_id", "==", receiptId).get()).docs;
    const guardada = await avancar(`putaway:${guarda!.id}`, "planned", {
      source_location_id: "RECEBIMENTO",
      destination_location_id: "A-01",
      location_id: "A-01",
      quantity: 4,
    });
    assert.equal(guardada.status, "completed");
    assert.deepEqual(await saldos(), { "A-01": [7, 0], EXPEDICAO: [2, 0], RECEBIMENTO: [5, 0], "S-01": [4, 0] });
    assert.deepEqual(await portal(), { qty_on_hand: 18, qty_reserved: 0, qty_available: 11, qty_receiving: 5 });
  });

  it("a entrada e a saída manuais mexem só no lugar de cada uma", async () => {
    const mover = (type: "ENTRADA" | "SAIDA", location_id: string, quantity: number, chave: string) =>
      createInventoryMovementTransaction(
        db,
        { customer_code: BTG, type, quantity, sku_code: SKU, client_item_code: "POLO-P", product_name: "Camiseta polo P", location_id, reason: "Ajuste de teste", idempotency_key: chave },
        armazem,
      );
    await mover("ENTRADA", "RECEBIMENTO", 2, "manual-1");
    assert.deepEqual(await portal(), { qty_on_hand: 16, qty_reserved: 0, qty_available: 7, qty_receiving: 7 });
    await mover("SAIDA", "A-01", 1, "manual-2");
    assert.deepEqual(await portal(), { qty_on_hand: 15, qty_reserved: 0, qty_available: 6, qty_receiving: 7 });
    await mover("ENTRADA", "EXPEDICAO", 1, "manual-3");
    assert.deepEqual(await portal(), { qty_on_hand: 16, qty_reserved: 0, qty_available: 6, qty_receiving: 7 });
  });

  it("o separado do pedido cancelado vai para a EXPEDICAO e só volta ao disponível com a guarda", async () => {
    const criado = await pedir(6);
    const { orderId, pickTaskId } = await aprovar(String(criado.id));
    const separado = await separar(pickTaskId, {});
    await embalar(orderId, String(separado.pack_task_id));
    await cancelWarehouseOrderTransaction(
      db,
      { order_id: orderId, reason: "O cliente desistiu da retirada; os uniformes ficam no estoque.", idempotency_key: "cancelar-1" },
      coordenacao,
    );
    assert.deepEqual(await saldos(), { "A-01": [0, 0], EXPEDICAO: [8, 0], RECEBIMENTO: [5, 0], "S-01": [1, 0] });
    assert.deepEqual(await portal(), { qty_on_hand: 14, qty_reserved: 0, qty_available: 1, qty_receiving: 5 });

    const guardas = (await db.collection("putaway_tasks").where("order_id", "==", orderId).get()).docs;
    const daA01 = guardas.find((guarda) => guarda.get("destination_location_id") === "A-01")!;
    await avancar(`putaway:${daA01.id}`, "planned", {
      source_location_id: "EXPEDICAO",
      destination_location_id: "A-01",
      location_id: "A-01",
      quantity: 3,
    });
    assert.deepEqual(await portal(), { qty_on_hand: 14, qty_reserved: 0, qty_available: 4, qty_receiving: 5 });
  });

  it("a separação a menos devolve a diferença ao disponível, e a entrega baixa o que saiu", async () => {
    const criado = await pedir(6);
    const { orderId, pickTaskId } = await aprovar(String(criado.id));
    const separado = await separar(pickTaskId, { "A-01": 1 });
    assert.equal(separado.status, "completed");
    assert.deepEqual(await saldos(), { "A-01": [3, 1], EXPEDICAO: [2, 0], RECEBIMENTO: [5, 0], "S-01": [4, 3] });
    assert.deepEqual(await portal(), { qty_on_hand: 14, qty_reserved: 4, qty_available: 3, qty_receiving: 5 });

    await entregar(await embalar(orderId, String(separado.pack_task_id)));
    assert.deepEqual(await saldos(), { "A-01": [2, 0], EXPEDICAO: [2, 0], RECEBIMENTO: [5, 0], "S-01": [1, 0] });
    assert.deepEqual(await portal(), { qty_on_hand: 10, qty_reserved: 0, qty_available: 3, qty_receiving: 5 });
  });

  it("a contagem no RECEBIMENTO muda o em recebimento; sem diferença, o portal se acerta pelos saldos", async () => {
    const contar = (location_id: string, counted_qty: number, chave: string) =>
      recordCycleCountTransaction(
        db,
        { mode: "cycle", customer_code: BTG, sku_code: SKU, client_item_code: "POLO-P", product_name: "Camiseta polo P", location_id, counted_qty, reason: "Contagem cíclica", idempotency_key: chave },
        armazem,
      );
    await contar("RECEBIMENTO", 3, "contagem-1");
    assert.deepEqual(await saldos(), { "A-01": [3, 0], EXPEDICAO: [2, 0], RECEBIMENTO: [3, 0], "S-01": [4, 0] });
    assert.deepEqual(await portal(), { qty_on_hand: 12, qty_reserved: 0, qty_available: 7, qty_receiving: 3 });

    await db.collection("client_inventory").doc(PORTAL).update({ qty_available: 12, qty_receiving: 0 });
    await contar("A-01", 3, "contagem-2");
    assert.deepEqual(await portal(), { qty_on_hand: 12, qty_reserved: 0, qty_available: 7, qty_receiving: 3 });
  });
});
