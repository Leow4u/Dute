import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

import { billingMovementDirection } from "./billing-scope.js";
import {
  advanceWarehouseTaskTransaction,
  cancelWarehouseOrderTransaction,
  createCustomerRequestTransaction,
  decideCustomerRequestTransaction,
  type OperationalActor,
} from "./operations.js";

/**
 * Cancelar pedido e Encerrar só depois da entrega (pergunta 59): as
 * transações de verdade, no emulador, do pedido aprovado ao cancelado.
 */

const PROJECT_ID = "demo-dute-operations";
const BTG = "BTG Pactual";
const SKU = "BTG-CANCELA-1";
const MOTIVO = "O cliente desistiu da retirada; os uniformes ficam no estoque.";

const coordenacao: OperationalActor = { uid: "coord-1", email: "coord@dutelog.com.br", name: "Mariana Lopes", role: "interno", customer_code: "Dutelog" };
const armazem: OperationalActor = { uid: "wms-1", email: "wms@dutelog.com.br", name: "Rafael", role: "wms", customer_code: "Dutelog" };
const cliente: OperationalActor = { uid: "client-1", email: "compras@btg.com.br", name: "Compras BTG", role: "cliente", customer_code: BTG };

let db: Firestore;
let app: ReturnType<typeof initializeApp>;

before(() => {
  app = initializeApp({ projectId: PROJECT_ID }, "order-cancel-test");
  db = getFirestore(app);
});

after(async () => {
  await deleteApp(app);
});

beforeEach(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error("FIRESTORE_EMULATOR_HOST não definido.");
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
  const position = (code: string, shelf: number) =>
    db.collection("warehouse_positions").doc(code).set({ code, aisle: "A", shelf, sequence: shelf, length_m: 1.8, depth_m: 0.75, height_m: 0.5, customer_code: BTG, status: "active" });
  const balance = (id: string, locationId: string, quantity: number) =>
    db.collection("stock_balances").doc(id).set({
      id,
      customer_code: BTG,
      sku_code: SKU,
      client_item_code: "POLO-P",
      product_name: "Camiseta polo P",
      category: "UNIFORMES",
      location_id: locationId,
      qty_on_hand: quantity,
      qty_reserved: 0,
      qty_available: quantity,
      unit_cost: 40,
    });
  await Promise.all([
    db.collection("customers").doc("BTG_Pactual").set({ code: BTG, customer_code: BTG, name: BTG, sku_prefix: "BTG", status: "active" }),
    position("A-01", 1),
    position("A-02", 2),
    balance("bal-a01", "A-01", 3),
    balance("bal-a02", "A-02", 4),
  ]);
});

/** O pedido de 6 unidades, aprovado: 3 na A-01 e 3 na A-02. */
async function pedidoAprovado(chave = "pedido-1") {
  const criado = await createCustomerRequestTransaction(
    db,
    {
      type: "retirada",
      priority: "normal",
      title: "Uniformes do evento",
      destination: "Retirada no armazém",
      customer_code: BTG,
      idempotency_key: chave,
      items: [{ sku_code: SKU, client_item_code: "POLO-P", product_name: "Camiseta polo P", quantity: 6 }],
    },
    cliente,
  );
  const requestId = String(criado.id);
  const aprovado = (await decideCustomerRequestTransaction(
    db,
    { request_id: requestId, action: "approve", expected_status: "open", idempotency_key: `aprovar-${chave}` },
    coordenacao,
  )) as Record<string, unknown>;
  return { requestId, orderId: String(aprovado.order_id), pickTaskId: String(aprovado.pick_task_id) };
}

function avancar(taskUid: string, expectedStatus: string, operation?: Record<string, unknown>) {
  return advanceWarehouseTaskTransaction(
    db,
    { task_uid: taskUid, expected_status: expectedStatus, operation, idempotency_key: `${taskUid}:${expectedStatus}` },
    armazem,
  ) as Promise<Record<string, unknown>>;
}

/** Separado e embalado, como o "Separado" da tela de Pedidos. */
async function separarEEmbalar(orderId: string, pickTaskId: string) {
  await avancar(`picking:${pickTaskId}`, "planned");
  const linhas = await db.collection("pick_lines").where("pick_task_id", "==", pickTaskId).get();
  const separado = await avancar(`picking:${pickTaskId}`, "in_progress", {
    picking_lines: linhas.docs.map((linha) => ({ pick_line_id: linha.id, qty_picked: Number(linha.get("qty_to_pick")), status: "confirmed" })),
  });
  const packTaskId = String(separado.pack_task_id);
  await avancar(`packing:${packTaskId}`, "ready");
  const itens = await db.collection("order_items").where("order_id", "==", orderId).get();
  const embalado = await avancar(`packing:${packTaskId}`, "in_progress", {
    volume_label: "VOL-1",
    seal_code: "L-0098",
    package_count: 1,
    packing_lines: itens.docs.map((item) => ({ order_item_id: item.id, qty_packed: Number(item.get("picked_qty")), status: "confirmed" })),
  });
  return { packTaskId, shipmentId: String(embalado.shipment_id) };
}

function cancelar(orderId: string, chave = "cancelar-pedido-1") {
  return cancelWarehouseOrderTransaction(db, { order_id: orderId, reason: MOTIVO, idempotency_key: chave }, coordenacao);
}

async function saldos() {
  const snapshot = await db.collection("stock_balances").where("sku_code", "==", SKU).get();
  return Object.fromEntries(snapshot.docs.map((doc) => [String(doc.get("location_id")), doc.data()]));
}

async function eventos(tipo: string) {
  return (await db.collection("events").where("type", "==", tipo).get()).docs.map((doc) => doc.data());
}

describe("Cancelar pedido (pergunta 59)", () => {
  it("antes da separação: solta a reserva, fecha a separação, e o portal vê Cancelado pela Dutelog sem o motivo", async () => {
    const { requestId, orderId, pickTaskId } = await pedidoAprovado();

    const resultado = await cancelar(orderId);
    assert.equal(resultado.status, "CANCELADO");
    assert.equal(resultado.status_before, "PENDENTE");
    assert.equal(resultado.released_qty, 6);
    assert.equal(resultado.returned_qty, 0);
    assert.deepEqual(resultado.returns, []);
    assert.deepEqual(resultado.cancelled_tasks, [`picking:${pickTaskId}`]);

    const reservas = await db.collection("stock_reservations").where("order_id", "==", orderId).get();
    assert.equal(reservas.size, 2);
    for (const reserva of reservas.docs) {
      assert.equal(reserva.get("status"), "released");
      assert.equal(reserva.get("release_reason"), "order_cancelled");
      assert.equal(reserva.get("released_qty"), 3);
    }
    const porPosicao = await saldos();
    assert.deepEqual(
      Object.fromEntries(Object.entries(porPosicao).map(([local, saldo]) => [local, [saldo.qty_on_hand, saldo.qty_reserved, saldo.qty_available]])),
      { "A-01": [3, 0, 3], "A-02": [4, 0, 4] },
    );
    const portalEstoque = (await db.collection("client_inventory").doc(`cinv_BTG_Pactual__${SKU}`).get()).data() ?? {};
    assert.equal(portalEstoque.qty_on_hand, 7);
    assert.equal(portalEstoque.qty_reserved, 0);

    assert.equal((await db.collection("pick_tasks").doc(pickTaskId).get()).get("status"), "cancelled");
    for (const linha of (await db.collection("pick_lines").where("pick_task_id", "==", pickTaskId).get()).docs) {
      assert.equal(linha.get("status"), "cancelled");
    }
    for (const item of (await db.collection("order_items").where("order_id", "==", orderId).get()).docs) {
      assert.equal(item.get("status"), "cancelled");
    }

    const pedido = (await db.collection("orders").doc(orderId).get()).data() ?? {};
    assert.equal(pedido.status, "CANCELADO");
    assert.equal(pedido.cancel_reason, MOTIVO);
    assert.equal(pedido.cancel_origin, "dutelog");
    assert.equal(pedido.cancelled_by?.uid, "coord-1");
    const solicitacao = (await db.collection("customer_requests").doc(requestId).get()).data() ?? {};
    assert.equal(solicitacao.status, "cancelled");
    assert.equal(solicitacao.cancel_origin, "dutelog");
    assert.equal(solicitacao.cancel_reason, MOTIVO);

    // O cliente vê o cancelamento e a data, nunca o motivo.
    const portal = (await db.collection("client_request_status").doc(requestId).get()).data() ?? {};
    assert.equal(portal.status, "cancelled");
    assert.equal(portal.cancel_origin, "dutelog");
    assert.match(String(portal.cancelled_at), /^\d{4}-\d{2}-\d{2}T/);
    const acompanhamento = (await db.collection("client_order_tracking").doc(orderId).get()).data() ?? {};
    assert.equal(acompanhamento.status, "cancelled");
    assert.equal(acompanhamento.status_label, "Cancelado pela Dutelog");
    assert.equal(acompanhamento.cancelled_at, portal.cancelled_at);
    for (const documento of [portal, acompanhamento]) {
      assert.equal(JSON.stringify(documento).includes("desistiu"), false);
    }

    const [cancelado] = await eventos("order.cancelled");
    assert.equal(cancelado.description, pedido.order_number);
    assert.equal(cancelado.payload.reason, MOTIVO);
    assert.equal(cancelado.payload.released_qty_total, 6);
    const [liberada] = await eventos("stock.reservation_released");
    assert.equal(liberada.payload.release_reason, "order_cancelled");
    assert.equal(liberada.payload.released_qty_total, 6);

    // Repetir com a mesma chave devolve o mesmo; com outra, diz que já estava cancelado.
    assert.deepEqual(await cancelar(orderId), resultado);
    const deNovo = await cancelar(orderId, "cancelar-pedido-2");
    assert.equal(deNovo.already_cancelled, true);
    assert.equal((await eventos("order.cancelled")).length, 1);

    await assert.rejects(avancar(`picking:${pickTaskId}`, "cancelled"), { code: "failed-precondition", message: "Tarefa cancelada com o pedido." });

    // O estoque volta a atender: o pedido seguinte leva as 7 unidades.
    const outro = await createCustomerRequestTransaction(
      db,
      { type: "retirada", priority: "normal", title: "Outro pedido", customer_code: BTG, idempotency_key: "pedido-2", items: [{ sku_code: SKU, quantity: 7 }] },
      cliente,
    );
    assert.ok(outro.id);
  });

  it("já separado e embalado: o separado vai para a EXPEDICAO, a guarda de volta abre sozinha, e nada disso se cobra", async () => {
    const { orderId, pickTaskId } = await pedidoAprovado();
    const { packTaskId, shipmentId } = await separarEEmbalar(orderId, pickTaskId);
    assert.equal((await db.collection("orders").doc(orderId).get()).get("status"), "EM_EXPEDICAO");

    const resultado = await cancelar(orderId);
    assert.equal(resultado.status_before, "EM_EXPEDICAO");
    assert.equal(resultado.released_qty, 6);
    assert.equal(resultado.returned_qty, 6);
    const devolucoes = (resultado.returns as Array<Record<string, unknown>>)
      .map((item) => [item.location_id, item.destination_location_id, item.quantity])
      .sort();
    assert.deepEqual(devolucoes, [["A-01", "A-01", 3], ["A-02", "A-02", 3]]);
    assert.deepEqual(resultado.cancelled_tasks, [`shipping:${shipmentId}`]);

    const porPosicao = await saldos();
    assert.deepEqual(
      Object.fromEntries(Object.entries(porPosicao).map(([local, saldo]) => [local, [saldo.qty_on_hand, saldo.qty_reserved, saldo.qty_available]])),
      { "A-01": [0, 0, 0], "A-02": [1, 0, 1], EXPEDICAO: [6, 0, 6] },
    );
    const portalEstoque = (await db.collection("client_inventory").doc(`cinv_BTG_Pactual__${SKU}`).get()).data() ?? {};
    assert.equal(portalEstoque.qty_on_hand, 7);
    assert.equal(portalEstoque.qty_reserved, 0);

    const movimentos = (await db.collection("movements").where("source", "==", "wms_order_cancel").get()).docs.map((doc) => doc.data());
    assert.equal(movimentos.length, 4);
    assert.deepEqual(movimentos.map((movimento) => movimento.movement_kind).sort(), ["order_cancel_in", "order_cancel_in", "order_cancel_out", "order_cancel_out"]);
    for (const movimento of movimentos) {
      assert.equal(billingMovementDirection(movimento, { snapshot: false }), null);
      assert.equal(movimento.order_id, orderId);
    }

    const guardas = (await db.collection("putaway_tasks").where("order_id", "==", orderId).get()).docs.map((doc) => doc.data());
    assert.deepEqual(
      guardas.map((guarda) => [guarda.status, guarda.source_location_id, guarda.destination_location_id, guarda.quantity]).sort(),
      [["planned", "EXPEDICAO", "A-01", 3], ["planned", "EXPEDICAO", "A-02", 3]],
    );

    // A separação e a embalagem já terminaram e ficam como histórico; a remessa, os volumes e os itens não saem mais.
    assert.equal((await db.collection("pick_tasks").doc(pickTaskId).get()).get("status"), "completed");
    assert.equal((await db.collection("pack_tasks").doc(packTaskId).get()).get("status"), "completed");
    assert.equal((await db.collection("shipments").doc(shipmentId).get()).get("status"), "cancelled");
    for (const colecao of ["packages", "order_items"]) {
      for (const doc of (await db.collection(colecao).where("order_id", "==", orderId).get()).docs) assert.equal(doc.get("status"), "cancelled", colecao);
    }
    for (const colecao of ["package_items", "shipment_items"]) {
      for (const doc of (await db.collection(colecao).where("shipment_id", "==", shipmentId).get()).docs) assert.equal(doc.get("status"), "cancelled", colecao);
    }
    await assert.rejects(avancar(`shipping:${shipmentId}`, "cancelled"), { message: "Tarefa cancelada com o pedido." });

    // A guarda de volta é a de sempre: move da EXPEDICAO para a posição.
    const daA01 = guardas.find((guarda) => guarda.destination_location_id === "A-01")!;
    const guardada = await avancar(`putaway:${daA01.id}`, "planned", {
      source_location_id: "EXPEDICAO",
      destination_location_id: "A-01",
      location_id: "A-01",
      quantity: 3,
    });
    assert.equal(guardada.status, "completed");
    const depois = await saldos();
    assert.equal(depois["A-01"].qty_on_hand, 3);
    assert.equal(depois.EXPEDICAO.qty_on_hand, 3);
  });

  it("o que saiu de uma área volta sem destino, e quem guarda escolhe a posição; o que já estava na EXPEDICAO não se move", async () => {
    // A sobra de um cancelamento de antes (2 na EXPEDICAO) e 1 unidade ainda no RECEBIMENTO.
    const area = (id: string, locationId: string, quantity: number) =>
      db.collection("stock_balances").doc(id).set({
        id,
        customer_code: BTG,
        sku_code: SKU,
        client_item_code: "POLO-P",
        product_name: "Camiseta polo P",
        location_id: locationId,
        qty_on_hand: quantity,
        qty_reserved: 0,
        qty_available: quantity,
      });
    await Promise.all([area("bal-expedicao", "EXPEDICAO", 2), area("bal-recebimento", "RECEBIMENTO", 1)]);
    const criado = await createCustomerRequestTransaction(
      db,
      { type: "retirada", priority: "normal", title: "Tudo", customer_code: BTG, idempotency_key: "pedido-tudo", items: [{ sku_code: SKU, quantity: 10 }] },
      cliente,
    );
    const aprovado = (await decideCustomerRequestTransaction(
      db,
      { request_id: String(criado.id), action: "approve", expected_status: "open", idempotency_key: "aprovar-tudo" },
      coordenacao,
    )) as Record<string, unknown>;
    const orderId = String(aprovado.order_id);
    await separarEEmbalar(orderId, String(aprovado.pick_task_id));

    const resultado = await cancelar(orderId);
    assert.equal(resultado.released_qty, 10);
    assert.equal(resultado.returned_qty, 10);
    assert.deepEqual(
      (resultado.returns as Array<Record<string, unknown>>)
        .map((item) => [item.location_id, item.destination_location_id ?? "sem destino", item.quantity])
        .sort(),
      [["A-01", "A-01", 3], ["A-02", "A-02", 4], ["EXPEDICAO", "sem destino", 2], ["RECEBIMENTO", "sem destino", 1]],
    );
    const porPosicao = await saldos();
    assert.deepEqual(
      Object.fromEntries(Object.entries(porPosicao).map(([local, saldo]) => [local, [saldo.qty_on_hand, saldo.qty_reserved, saldo.qty_available]])),
      { "A-01": [0, 0, 0], "A-02": [0, 0, 0], EXPEDICAO: [10, 0, 10], RECEBIMENTO: [0, 0, 0] },
    );
    const guardas = (await db.collection("putaway_tasks").where("order_id", "==", orderId).get()).docs.map((doc) => doc.data());
    assert.deepEqual(
      guardas.map((guarda) => [guarda.destination_location_id ?? "sem destino", guarda.quantity]).sort(),
      [["A-01", 3], ["A-02", 4], ["sem destino", 1], ["sem destino", 2]],
    );
    // Só o que saiu da A-01, da A-02 e do RECEBIMENTO se move no razão: 3 saídas e 3 entradas.
    const movimentos = await db.collection("movements").where("source", "==", "wms_order_cancel").get();
    assert.equal(movimentos.size, 6);

    // A guarda sem destino conclui com a posição que quem guarda escolhe.
    const doRecebimento = guardas.find((guarda) => guarda.quantity === 1)!;
    const guardada = await avancar(`putaway:${doRecebimento.id}`, "planned", {
      source_location_id: "EXPEDICAO",
      destination_location_id: "A-02",
      quantity: 1,
    });
    assert.equal(guardada.status, "completed");
    const depois = await saldos();
    assert.equal(depois["A-02"].qty_on_hand, 1);
    assert.equal(depois.EXPEDICAO.qty_on_hand, 9);
  });

  it("não cancela o pedido que já saiu do armazém, e não muda nada", async () => {
    const { orderId, pickTaskId } = await pedidoAprovado();
    const { shipmentId } = await separarEEmbalar(orderId, pickTaskId);
    await avancar(`shipping:${shipmentId}`, "ready_to_dispatch", { carrier: "Dutelog", driver_name: "Rafael", vehicle_plate: "DUTE-001" });
    assert.equal((await db.collection("orders").doc(orderId).get()).get("status"), "EXPEDIDO");

    await assert.rejects(cancelar(orderId), { code: "failed-precondition", message: "O pedido já saiu do armazém: não se cancela mais." });
    assert.equal((await db.collection("orders").doc(orderId).get()).get("status"), "EXPEDIDO");
    assert.deepEqual(await eventos("order.cancelled"), []);
    await assert.rejects(cancelWarehouseOrderTransaction(db, { order_id: "ord_inexistente", reason: MOTIVO, idempotency_key: "cancelar-x-1" }, coordenacao), {
      code: "not-found",
      message: "Pedido não encontrado.",
    });
  });

  it("a entrega que já virou demanda na Operação fica de aviso para a coordenação cancelar lá", async () => {
    const { orderId } = await pedidoAprovado();
    await db.collection("orders").doc(orderId).update({ entrega: { modo: "dutelog", demanda: "D-0042", os_numeros: ["OS-0042-01"] } });

    const resultado = await cancelar(orderId);
    assert.equal(resultado.demanda, "D-0042");
    const [aviso] = await eventos("expedicao.demand_left_open");
    assert.equal(aviso.severity, "attention");
    assert.match(String(aviso.description), /cancele a demanda D-0042 na Operação/);
    const caixa = await db.collection("ai_agent_inbox").where("event_id", "==", aviso.id).get();
    assert.equal(caixa.size, 1);
  });
});

describe("Encerrar a solicitação de saída só depois da entrega (pergunta 59)", () => {
  it("antes da entrega recusa e manda cancelar; depois dela, encerra", async () => {
    const { requestId, orderId, pickTaskId } = await pedidoAprovado();
    const encerrar = (chave: string) =>
      decideCustomerRequestTransaction(db, { request_id: requestId, action: "close", expected_status: "approved", idempotency_key: chave }, coordenacao);

    await assert.rejects(encerrar("encerrar-1"), {
      code: "failed-precondition",
      message: "O pedido ainda não foi entregue: encerre depois da entrega. Para desistir dele, use Cancelar pedido.",
    });
    assert.equal((await db.collection("customer_requests").doc(requestId).get()).get("status"), "approved");

    const { shipmentId } = await separarEEmbalar(orderId, pickTaskId);
    await avancar(`shipping:${shipmentId}`, "ready_to_dispatch", { carrier: "Dutelog", driver_name: "Rafael", vehicle_plate: "DUTE-001" });
    await avancar(`shipping:${shipmentId}`, "dispatched", { proof_reference: "PROTOCOLO-1", delivery_notes: "Retirado pelo cliente" });
    assert.equal((await db.collection("customer_requests").doc(requestId).get()).get("operational_status"), "delivered");

    await encerrar("encerrar-2");
    assert.equal((await db.collection("customer_requests").doc(requestId).get()).get("status"), "closed");
  });
});
