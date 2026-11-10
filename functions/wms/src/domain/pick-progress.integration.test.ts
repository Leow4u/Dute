import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";

import {
  advanceWarehouseTaskTransaction,
  cancelWarehouseOrderTransaction,
  createCustomerRequestTransaction,
  decideCustomerRequestTransaction,
  recordCycleCountTransaction,
  type OperationalActor,
} from "./operations.js";
import { completeOrderSeparation, setPickLineSeparated } from "./pick-progress.js";

/**
 * Separar com o progresso salvo (separação com caixas, parte 2a), no
 * emulador: do pedido aprovado à entrega. Antes, nada ficava gravado até o
 * "Separado" do fim: a linha separada sumia ao recarregar a tela.
 */

const PROJECT_ID = "demo-dute-operations";
const BTG = "BTG Pactual";
const POLO = "BTG-POLO-G";
const BONE = "BTG-BONE";

const coordenacao: OperationalActor = { uid: "coord-1", email: "coord@dutelog.com.br", name: "Mariana Lopes", role: "interno", customer_code: "Dutelog" };
const guilherme: OperationalActor = { uid: "wms-1", email: "guilherme@dutelog.com.br", name: "Guilherme Dantas", role: "wms", customer_code: "Dutelog" };
const rafael: OperationalActor = { uid: "wms-2", email: "rafael@dutelog.com.br", name: "Rafael", role: "wms", customer_code: "Dutelog" };
const cliente: OperationalActor = { uid: "client-1", email: "compras@btg.com.br", name: "Compras BTG", role: "cliente", customer_code: BTG };

let db: Firestore;
let app: ReturnType<typeof initializeApp>;

before(() => {
  app = initializeApp({ projectId: PROJECT_ID }, "pick-progress-test");
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
  const balance = (id: string, skuCode: string, productName: string, locationId: string, quantity: number) =>
    db.collection("stock_balances").doc(id).set({
      id,
      customer_code: BTG,
      sku_code: skuCode,
      client_item_code: skuCode,
      product_name: productName,
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
    balance("bal-polo", POLO, "Camiseta polo G", "A-01", 8),
    balance("bal-bone", BONE, "Boné", "A-02", 4),
  ]);
});

/** O pedido de 5 polos (A-01) e 4 bonés (A-02), aprovado e ainda por separar. */
async function pedidoAprovado() {
  const criado = await createCustomerRequestTransaction(
    db,
    {
      type: "retirada",
      priority: "normal",
      title: "Uniformes do evento",
      customer_code: BTG,
      idempotency_key: "pedido-1",
      items: [
        { sku_code: POLO, product_name: "Camiseta polo G", quantity: 5 },
        { sku_code: BONE, product_name: "Boné", quantity: 4 },
      ],
    },
    cliente,
  );
  const aprovado = (await decideCustomerRequestTransaction(
    db,
    { request_id: String(criado.id), action: "approve", expected_status: "open", idempotency_key: "aprovar-1" },
    coordenacao,
  )) as Record<string, unknown>;
  const orderId = String(aprovado.order_id);
  const pickTaskId = String(aprovado.pick_task_id);
  const linhas = await db.collection("pick_lines").where("pick_task_id", "==", pickTaskId).get();
  const linhaDe = (sku: string) => linhas.docs.find((linha) => linha.get("sku_code") === sku)!.id;
  return { requestId: String(criado.id), orderId, pickTaskId, linhaPolo: linhaDe(POLO), linhaBone: linhaDe(BONE) };
}

let chaves = 0;
function chave(prefixo: string) {
  chaves += 1;
  return `${prefixo}-${String(chaves).padStart(6, "0")}`;
}

function separar(pickTaskId: string, pickLineId: string, ator: OperationalActor = guilherme, idempotencyKey = chave("separar")) {
  return setPickLineSeparated(db, { pick_task_id: pickTaskId, pick_line_id: pickLineId, separated: true, idempotency_key: idempotencyKey }, ator) as Promise<Record<string, unknown>>;
}

function desfazer(pickTaskId: string, pickLineId: string, ator: OperationalActor = guilherme, idempotencyKey = chave("desfazer")) {
  return setPickLineSeparated(db, { pick_task_id: pickTaskId, pick_line_id: pickLineId, separated: false, idempotency_key: idempotencyKey }, ator) as Promise<Record<string, unknown>>;
}

function concluir(pickTaskId: string, extra: Record<string, unknown> = {}, ator: OperationalActor = guilherme, idempotencyKey = chave("concluir")) {
  return completeOrderSeparation(db, { pick_task_id: pickTaskId, seal_code: "L-0101", idempotency_key: idempotencyKey, ...extra }, ator) as Promise<Record<string, unknown>>;
}

function avancar(taskUid: string, expectedStatus: string, operation?: Record<string, unknown>, ator: OperationalActor = guilherme) {
  return advanceWarehouseTaskTransaction(
    db,
    { task_uid: taskUid, expected_status: expectedStatus, operation, idempotency_key: `${taskUid}:${expectedStatus}:${ator.uid}` },
    ator,
  ) as Promise<Record<string, unknown>>;
}

async function saldos() {
  const snapshot = await db.collection("stock_balances").get();
  return Object.fromEntries(
    snapshot.docs.map((doc) => [`${doc.get("sku_code")}@${doc.get("location_id")}`, [doc.get("qty_on_hand"), doc.get("qty_reserved"), doc.get("qty_available")]]),
  );
}

async function porLinha(colecao: string, orderId: string) {
  const docs = (await db.collection(colecao).where("order_id", "==", orderId).get()).docs;
  return Object.fromEntries(docs.map((doc) => [String(doc.get("sku_code")), doc.data()]));
}

async function eventos(tipo: string) {
  return (await db.collection("events").where("type", "==", tipo).get()).docs.map((doc) => doc.data());
}

async function tarefa(pickTaskId: string) {
  return (await db.collection("pick_tasks").doc(pickTaskId).get()).data() ?? {};
}

async function recusa(acao: Promise<unknown>): Promise<HttpsError> {
  try {
    await acao;
  } catch (error) {
    assert.ok(error instanceof HttpsError, String(error));
    return error;
  }
  throw new assert.AssertionError({ message: "Deveria ter recusado." });
}

describe("Separar com o progresso salvo (separação com caixas, parte 2a)", () => {
  it("a primeira linha separada começa a separação e fica gravada, sem mexer na reserva nem no saldo", async () => {
    const { orderId, pickTaskId, linhaPolo } = await pedidoAprovado();
    assert.equal((await tarefa(pickTaskId)).status, "planned");
    const antes = await saldos();

    const resultado = await separar(pickTaskId, linhaPolo);
    assert.deepEqual([resultado.ok, resultado.separated, resultado.changed, resultado.separated_qty], [true, true, true, 5]);

    // A tarefa começou, pela porta de sempre: o evento e o "Em separação" do portal.
    const depois = await tarefa(pickTaskId);
    assert.equal(depois.status, "in_progress");
    assert.equal(depois.separation_started_at, resultado.separated_at);
    assert.equal(depois.separation_started_by.name, "Guilherme Dantas");
    assert.equal((await eventos("picking.started")).length, 1);
    assert.equal((await db.collection("client_order_tracking").doc(orderId).get()).get("status"), "separating");

    // A linha guarda quem separou e quanto, e continua aberta.
    const linhas = await porLinha("pick_lines", orderId);
    assert.deepEqual([linhas[POLO]!.separated_qty, linhas[POLO]!.separated_at, linhas[POLO]!.separated_by.uid], [5, resultado.separated_at, "wms-1"]);
    assert.deepEqual([linhas[POLO]!.status, linhas[POLO]!.qty_picked], ["open", 0]);
    assert.equal(linhas[BONE]!.separated_at, undefined);

    // A reserva e o saldo só mudam na conclusão.
    const reservas = await porLinha("stock_reservations", orderId);
    assert.deepEqual([reservas[POLO]!.status, reservas[BONE]!.status], ["reserved", "reserved"]);
    assert.deepEqual(await saldos(), antes);

    // O evento fica na trilha, sem aviso na caixa, sem valor nem contato.
    const [evento] = await eventos("picking.line_separated");
    assert.equal(evento.entity_id, pickTaskId);
    assert.equal(evento.customer_code, BTG);
    assert.equal(evento.actor.uid, "wms-1");
    assert.deepEqual(evento.payload, {
      order_id: orderId,
      order_number: depois.order_number,
      pick_line_id: linhaPolo,
      line_number: linhas[POLO]!.line_number,
      sku_code: POLO,
      location_id: "A-01",
      quantity: 5,
    });
    const avisos = (await db.collection("ai_agent_inbox").get()).docs.map((doc) => doc.get("event_id"));
    assert.equal(avisos.includes(evento.id), false);
  });

  it("a mesma chave devolve o mesmo resultado; separar a linha já separada não muda nada", async () => {
    const { pickTaskId, linhaPolo } = await pedidoAprovado();
    const primeira = await separar(pickTaskId, linhaPolo, guilherme, "separar-polo-0001");
    const repetida = await separar(pickTaskId, linhaPolo, guilherme, "separar-polo-0001");
    assert.deepEqual(repetida, primeira);
    // A outra pessoa toca na mesma linha: continua de quem separou primeiro.
    const outra = await separar(pickTaskId, linhaPolo, rafael);
    assert.deepEqual([outra.changed, outra.separated, outra.separated_at], [false, true, primeira.separated_at]);
    assert.equal((await eventos("picking.line_separated")).length, 1);
    assert.equal((await eventos("picking.started")).length, 1);
    // A chave usada com outra linha é recusada.
    const erro = await recusa(setPickLineSeparated(db, { pick_task_id: pickTaskId, pick_line_id: linhaPolo, separated: false, idempotency_key: "separar-polo-0001" }, guilherme));
    assert.equal(erro.code, "already-exists");
  });

  it("Desfazer volta a linha, e outra pessoa continua de onde a primeira parou", async () => {
    const { orderId, pickTaskId, linhaPolo, linhaBone } = await pedidoAprovado();
    await separar(pickTaskId, linhaPolo);
    const desfeita = await desfazer(pickTaskId, linhaPolo);
    assert.deepEqual([desfeita.separated, desfeita.changed, desfeita.separated_qty], [false, true, 0]);
    let linhas = await porLinha("pick_lines", orderId);
    assert.deepEqual([linhas[POLO]!.separated_qty, linhas[POLO]!.separated_at, linhas[POLO]!.separated_by], [undefined, undefined, undefined]);
    assert.equal((await eventos("picking.line_unseparated")).length, 1);
    // Desfazer o que não está separado não muda nada.
    assert.equal((await desfazer(pickTaskId, linhaPolo)).changed, false);
    assert.equal((await eventos("picking.line_unseparated")).length, 1);

    // No dia seguinte, outra pessoa separa as duas linhas.
    await separar(pickTaskId, linhaPolo, rafael);
    await separar(pickTaskId, linhaBone, rafael);
    linhas = await porLinha("pick_lines", orderId);
    assert.deepEqual([linhas[POLO]!.separated_by.name, linhas[BONE]!.separated_by.name], ["Rafael", "Rafael"]);
    // O começo da separação continua sendo o da primeira linha.
    assert.equal((await tarefa(pickTaskId)).separation_started_by.name, "Guilherme Dantas");
    assert.equal((await eventos("picking.started")).length, 1);
  });

  it("recusa a linha de outro pedido, a que não existe e a entrada incompleta", async () => {
    const { pickTaskId } = await pedidoAprovado();
    await db.collection("pick_lines").doc("pli_outro_01").set({ id: "pli_outro_01", pick_task_id: "pick_outro", status: "open", qty_to_pick: 1 });
    assert.equal((await recusa(separar(pickTaskId, "pli_outro_01"))).message, "Linha da separação não encontrada.");
    assert.equal((await recusa(separar(pickTaskId, "pli_nao_existe"))).message, "Linha da separação não encontrada.");
    assert.equal((await recusa(separar("pick_nao_existe", "pli_outro_01"))).message, "Separação não encontrada.");
    assert.equal((await recusa(setPickLineSeparated(db, { pick_task_id: pickTaskId }, guilherme))).code, "invalid-argument");
    assert.equal((await recusa(setPickLineSeparated(db, { pick_task_id: pickTaskId, pick_line_id: "x", separated: true, idempotency_key: "curta" }, guilherme))).code, "invalid-argument");
  });

  it("Concluir com linha por separar é recusado; com todas, fecha a separação e a embalagem numa chamada, com o lacre", async () => {
    const { requestId, orderId, pickTaskId, linhaPolo, linhaBone } = await pedidoAprovado();
    assert.equal((await recusa(concluir(pickTaskId))).message, "A separação ainda não começou.");
    await separar(pickTaskId, linhaPolo);
    const pendente = await recusa(concluir(pickTaskId));
    assert.equal(pendente.message, "Falta separar 1 item: Boné.");
    assert.equal((await tarefa(pickTaskId)).status, "in_progress");

    await separar(pickTaskId, linhaBone, rafael);
    const concluido = await concluir(pickTaskId, {}, guilherme, "concluir-pedido-0001");
    assert.deepEqual([concluido.ok, concluido.order_id, concluido.pack_task_id, concluido.seal_code], [true, orderId, `pack_${orderId}`, "L-0101"]);
    const shipmentId = String(concluido.shipment_id);

    // O mesmo fim da cadeia que a tela fazia: separação e embalagem concluídas, remessa pronta.
    assert.equal((await tarefa(pickTaskId)).status, "completed");
    const linhas = await porLinha("pick_lines", orderId);
    assert.deepEqual([linhas[POLO]!.status, linhas[POLO]!.qty_picked, linhas[POLO]!.physical_status], ["completed", 5, "confirmed"]);
    assert.deepEqual([linhas[BONE]!.status, linhas[BONE]!.qty_picked], ["completed", 4]);
    // Quem separou cada linha continua na linha.
    assert.deepEqual([linhas[POLO]!.separated_by.name, linhas[BONE]!.separated_by.name], ["Guilherme Dantas", "Rafael"]);
    const itens = await porLinha("order_items", orderId);
    assert.deepEqual([itens[POLO]!.picked_qty, itens[POLO]!.status, itens[BONE]!.picked_qty], [5, "packed", 4]);
    const reservas = await porLinha("stock_reservations", orderId);
    assert.deepEqual([reservas[POLO]!.status, reservas[BONE]!.status], ["picked", "picked"]);
    const embalagem = (await db.collection("pack_tasks").doc(`pack_${orderId}`).get()).data() ?? {};
    assert.deepEqual([embalagem.status, embalagem.seal_code, embalagem.package_count], ["completed", "L-0101", 1]);
    const remessa = (await db.collection("shipments").doc(shipmentId).get()).data() ?? {};
    assert.deepEqual([remessa.status, remessa.total_units], ["ready_to_dispatch", 9]);
    assert.equal((await db.collection("packages").where("pack_task_id", "==", `pack_${orderId}`).get()).size, 1);
    assert.equal((await db.collection("client_order_tracking").doc(orderId).get()).get("status"), "ready_to_dispatch");
    assert.equal((await db.collection("customer_requests").doc(requestId).get()).get("operational_status"), "ready_to_dispatch");
    for (const tipo of ["picking.completed", "packing.created", "packing.started", "packing.completed"]) {
      assert.equal((await eventos(tipo)).length, 1, tipo);
    }
    // O saldo só baixa na entrega, como sempre.
    assert.deepEqual(await saldos(), { [`${POLO}@A-01`]: [8, 5, 3], [`${BONE}@A-02`]: [4, 4, 0] });

    // Repetir a chamada (o clique dobrado, a rede que caiu) não refaz nada.
    const repetido = await concluir(pickTaskId, {}, guilherme, "concluir-pedido-0001");
    assert.deepEqual([repetido.ok, repetido.pack_task_id], [true, `pack_${orderId}`]);
    assert.equal((await eventos("packing.completed")).length, 1);
    // Depois de concluída, a linha não aceita mais progresso.
    assert.equal((await recusa(desfazer(pickTaskId, linhaPolo))).message, "A separação deste pedido já foi concluída.");

    // A entrega baixa o saldo.
    await avancar(`shipping:${shipmentId}`, "ready_to_dispatch", { carrier: "Dutelog", driver_name: "Rafael", vehicle_plate: "DUTE-001" });
    await avancar(`shipping:${shipmentId}`, "dispatched", { proof_reference: "Carlos Lima", delivery_notes: "Recebido pelo cliente." });
    assert.deepEqual(await saldos(), { [`${POLO}@A-01`]: [3, 0, 3], [`${BONE}@A-02`]: [0, 0, 0] });
    assert.equal((await db.collection("orders").doc(orderId).get()).get("status"), "ENTREGUE");
  });

  it("a conclusão que parou no meio continua de onde parou", async () => {
    const { orderId, pickTaskId, linhaPolo, linhaBone } = await pedidoAprovado();
    await separar(pickTaskId, linhaPolo);
    await separar(pickTaskId, linhaBone);
    // A separação concluiu e a embalagem ficou por fazer (a chamada caiu entre os passos).
    await avancar(`picking:${pickTaskId}`, "in_progress", {
      picking_lines: [
        { pick_line_id: linhaPolo, qty_picked: 5, status: "confirmed" },
        { pick_line_id: linhaBone, qty_picked: 4, status: "confirmed" },
      ],
    });
    assert.equal((await db.collection("pack_tasks").doc(`pack_${orderId}`).get()).get("status"), "ready");
    const concluido = await concluir(pickTaskId);
    assert.equal(concluido.ok, true);
    assert.equal((await db.collection("pack_tasks").doc(`pack_${orderId}`).get()).get("status"), "completed");
    assert.equal((await db.collection("shipments").doc(String(concluido.shipment_id)).get()).get("status"), "ready_to_dispatch");
  });

  it("só a coordenação conclui com uma linha a menos; a diferença volta a ficar disponível", async () => {
    const { orderId, pickTaskId, linhaPolo, linhaBone } = await pedidoAprovado();
    await separar(pickTaskId, linhaBone);
    const aMenos = { short_lines: [{ pick_line_id: linhaPolo, qty_picked: 3, shortage_reason: "falta", shortage_detail: "A-01 tinha 3" }] };
    // Quem opera não separa a menos: a regra é a de sempre.
    const erro = await recusa(concluir(pickTaskId, aMenos, guilherme));
    assert.equal(erro.code, "permission-denied");
    assert.equal((await tarefa(pickTaskId)).status, "in_progress");

    const concluido = await concluir(pickTaskId, aMenos, coordenacao);
    assert.equal(concluido.ok, true);
    const linhas = await porLinha("pick_lines", orderId);
    assert.deepEqual([linhas[POLO]!.qty_picked, linhas[POLO]!.physical_status, linhas[POLO]!.shortage_reason], [3, "short", "falta"]);
    const reservas = await porLinha("stock_reservations", orderId);
    assert.deepEqual([reservas[POLO]!.status, reservas[POLO]!.reserved_qty, reservas[POLO]!.released_qty], ["picked", 3, 2]);
    assert.deepEqual(await saldos(), { [`${POLO}@A-01`]: [8, 3, 5], [`${BONE}@A-02`]: [4, 4, 0] });
    assert.equal((await db.collection("shipments").doc(String(concluido.shipment_id)).get()).get("total_units"), 7);
  });

  it("a contagem cíclica da prateleira com a linha já separada é recusada; desfeita a linha, passa", async () => {
    const { pickTaskId, linhaPolo } = await pedidoAprovado();
    const contar = (chaveDaContagem: string) =>
      recordCycleCountTransaction(
        db,
        { mode: "cycle", customer_code: BTG, sku_code: POLO, location_id: "A-01", counted_qty: 6, reason: "Conferência da prateleira", idempotency_key: chaveDaContagem },
        coordenacao,
      );
    await separar(pickTaskId, linhaPolo);
    // As 5 polos separadas estão na bancada: contar as 3 que ficaram baixaria o item duas vezes.
    const erro = await recusa(contar("contagem-0001"));
    assert.equal(erro.code, "failed-precondition");
    assert.match(erro.message, /tem itens já separados de um pedido em separação \(pedido PED-\d+\)\. Conte depois da entrega\./);
    assert.deepEqual((await saldos())[`${POLO}@A-01`], [8, 5, 3]);

    await desfazer(pickTaskId, linhaPolo);
    await contar("contagem-0002");
    assert.deepEqual((await saldos())[`${POLO}@A-01`], [6, 5, 1]);
  });

  it("o pedido cancelado no meio da separação solta a reserva; a linha não aceita mais progresso", async () => {
    const { orderId, pickTaskId, linhaPolo, linhaBone } = await pedidoAprovado();
    await separar(pickTaskId, linhaPolo);
    await cancelWarehouseOrderTransaction(db, { order_id: orderId, reason: "O cliente desistiu do evento", idempotency_key: "cancelar-0001" }, coordenacao);
    assert.equal((await tarefa(pickTaskId)).status, "cancelled");
    assert.deepEqual(await saldos(), { [`${POLO}@A-01`]: [8, 0, 8], [`${BONE}@A-02`]: [4, 0, 4] });
    assert.equal((await recusa(separar(pickTaskId, linhaBone))).message, "Pedido cancelado.");
    assert.equal((await recusa(concluir(pickTaskId))).message, "Pedido cancelado.");
  });
});
