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
import { billingMovementDirection } from "./billing-scope.js";
import { closeOrderVolume, completeOrderSeparation, setPickLineSeparated } from "./pick-progress.js";

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

/** "Separar menos": o separado de fato, com o motivo. */
function separarMenos(pickTaskId: string, pickLineId: string, separado: number, motivo: Record<string, unknown>, ator: OperationalActor = guilherme) {
  return setPickLineSeparated(
    db,
    { pick_task_id: pickTaskId, pick_line_id: pickLineId, separated: true, separated_qty: separado, ...motivo, idempotency_key: chave("separar-menos") },
    ator,
  ) as Promise<Record<string, unknown>>;
}

function desfazer(pickTaskId: string, pickLineId: string, ator: OperationalActor = guilherme, idempotencyKey = chave("desfazer")) {
  return setPickLineSeparated(db, { pick_task_id: pickTaskId, pick_line_id: pickLineId, separated: false, idempotency_key: idempotencyKey }, ator) as Promise<Record<string, unknown>>;
}

function concluir(pickTaskId: string, ator: OperationalActor = guilherme, idempotencyKey = chave("concluir")) {
  return completeOrderSeparation(db, { pick_task_id: pickTaskId, seal_code: "L-0101", idempotency_key: idempotencyKey }, ator) as Promise<Record<string, unknown>>;
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
      expected_qty: 5,
      quantity: 5,
      // O separado entra no volume aberto (parte 4a).
      volumes: [{ volume_number: 1, qty: 5 }],
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
    const concluido = await concluir(pickTaskId, guilherme, "concluir-pedido-0001");
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
    const repetido = await concluir(pickTaskId, guilherme, "concluir-pedido-0001");
    assert.deepEqual([repetido.ok, repetido.pack_task_id], [true, `pack_${orderId}`]);
    // A repetição também diz qual é a remessa: é dela que a tela abre "Para entregar".
    assert.equal(repetido.shipment_id, shipmentId);
    assert.equal((await eventos("packing.completed")).length, 1);
    // Quem chega depois com outro lacre fica sabendo que o pedido já concluiu, e com qual.
    const outroLacre = await recusa(completeOrderSeparation(db, { pick_task_id: pickTaskId, seal_code: "L-0202", idempotency_key: chave("concluir") }, coordenacao));
    assert.deepEqual([outroLacre.code, outroLacre.message], ["failed-precondition", "A separação deste pedido já foi concluída, com o lacre L-0101."]);
    assert.equal((await db.collection("pack_tasks").doc(`pack_${orderId}`).get()).get("seal_code"), "L-0101");
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

  it("a conclusão confere o progresso que leu: a linha desfeita ou separada de novo depois recusa, e nada conclui", async () => {
    const { orderId, pickTaskId, linhaPolo, linhaBone } = await pedidoAprovado();
    const polo = await separar(pickTaskId, linhaPolo);
    const bone = await separar(pickTaskId, linhaBone);
    // O que a conclusão leu das linhas, antes de outra pessoa desfazer o boné.
    const lido = [
      { pick_line_id: linhaPolo, qty_picked: 5, status: "confirmed", separated_at: polo.separated_at },
      { pick_line_id: linhaBone, qty_picked: 4, status: "confirmed", separated_at: bone.separated_at },
    ];
    await desfazer(pickTaskId, linhaBone, rafael);
    const desfeita = await recusa(avancar(`picking:${pickTaskId}`, "in_progress", { picking_lines: lido }));
    assert.deepEqual([desfeita.code, desfeita.message], ["failed-precondition", "A separação mudou enquanto o pedido era concluído. Atualize e tente de novo."]);
    // Separada de novo, a linha tem outro registro: a leitura antiga continua recusada.
    const deNovo = await separar(pickTaskId, linhaBone, rafael);
    assert.notEqual(deNovo.separated_at, bone.separated_at);
    assert.equal((await recusa(avancar(`picking:${pickTaskId}`, "in_progress", { picking_lines: lido }))).message, desfeita.message);
    assert.equal((await tarefa(pickTaskId)).status, "in_progress");
    const reservas = await porLinha("stock_reservations", orderId);
    assert.deepEqual([reservas[POLO]!.status, reservas[BONE]!.status], ["reserved", "reserved"]);
    assert.equal((await eventos("picking.completed")).length, 0);

    // A conclusão pela bancada lê o progresso de agora e conclui.
    assert.equal((await concluir(pickTaskId)).ok, true);
    assert.equal((await porLinha("pick_lines", orderId))[BONE]!.separated_by.name, "Rafael");
  });

  it("duas pessoas concluem ao mesmo tempo: o pedido conclui uma vez, e a outra recebe a recusa com o lacre gravado", async () => {
    const { orderId, pickTaskId, linhaPolo, linhaBone } = await pedidoAprovado();
    await separar(pickTaskId, linhaPolo);
    await separar(pickTaskId, linhaBone);
    const concluirCom = (lacre: string, ator: OperationalActor) =>
      completeOrderSeparation(db, { pick_task_id: pickTaskId, seal_code: lacre, idempotency_key: chave("concluir") }, ator) as Promise<Record<string, unknown>>;
    const resultados = await Promise.allSettled([concluirCom("L-0101", guilherme), concluirCom("L-0202", rafael)]);
    const feitas = resultados.flatMap((resultado) => (resultado.status === "fulfilled" ? [resultado.value] : []));
    const recusadas = resultados.flatMap((resultado) => (resultado.status === "rejected" ? [resultado.reason as HttpsError] : []));
    assert.deepEqual([feitas.length, recusadas.length], [1, 1], recusadas.map((erro) => erro.message).join(" | "));

    const embalagem = (await db.collection("pack_tasks").doc(`pack_${orderId}`).get()).data() ?? {};
    assert.deepEqual([embalagem.status, embalagem.seal_code], ["completed", feitas[0]!.seal_code]);
    assert.equal(recusadas[0]!.message, `A separação deste pedido já foi concluída, com o lacre ${embalagem.seal_code}.`);
    // Cada transição aconteceu uma vez só.
    for (const tipo of ["picking.completed", "packing.started", "packing.completed"]) {
      assert.equal((await eventos(tipo)).length, 1, tipo);
    }
    assert.equal((await db.collection("packages").where("pack_task_id", "==", `pack_${orderId}`).get()).size, 1);
    assert.equal((await db.collection("shipments").where("order_id", "==", orderId).get()).size, 1);
    assert.deepEqual(await saldos(), { [`${POLO}@A-01`]: [8, 5, 3], [`${BONE}@A-02`]: [4, 4, 0] });
  });

  it("quem opera registra o separado a menos na linha, com o motivo; só a coordenação conclui o pedido com diferença", async () => {
    const { orderId, pickTaskId, linhaPolo, linhaBone } = await pedidoAprovado();
    await separar(pickTaskId, linhaBone);
    // A menos sem o motivo, ou mais que o pedido, é recusado e nada fica gravado.
    assert.equal((await recusa(separarMenos(pickTaskId, linhaPolo, 3, {}))).message, "Informe o motivo da diferença em Camiseta polo G.");
    assert.equal((await recusa(separarMenos(pickTaskId, linhaPolo, 6, { shortage_reason: "falta" }))).code, "failed-precondition");
    assert.equal((await porLinha("pick_lines", orderId))[POLO]!.separated_at, undefined);

    const aMenos = await separarMenos(pickTaskId, linhaPolo, 3, { shortage_reason: "falta", shortage_detail: "A-01 tinha 3" });
    assert.deepEqual([aMenos.separated, aMenos.changed, aMenos.expected_qty, aMenos.separated_qty, aMenos.shortage_reason], [true, true, 5, 3, "falta"]);
    let linhas = await porLinha("pick_lines", orderId);
    assert.deepEqual(
      [linhas[POLO]!.separated_qty, linhas[POLO]!.separated_shortage_reason, linhas[POLO]!.separated_shortage_detail, linhas[POLO]!.status],
      [3, "falta", "A-01 tinha 3", "open"],
    );
    const eventosDaPolo = (await eventos("picking.line_separated")).filter((evento) => evento.payload.pick_line_id === linhaPolo);
    assert.equal(eventosDaPolo.length, 1);
    assert.equal(eventosDaPolo[0]!.description, "3 de 5 un. de Camiseta polo G · A-01");
    assert.deepEqual(
      [eventosDaPolo[0]!.payload.expected_qty, eventosDaPolo[0]!.payload.quantity, eventosDaPolo[0]!.payload.short_qty, eventosDaPolo[0]!.payload.shortage_reason],
      [5, 3, 2, "falta"],
    );
    // A reserva só solta a diferença na conclusão.
    assert.deepEqual(await saldos(), { [`${POLO}@A-01`]: [8, 5, 3], [`${BONE}@A-02`]: [4, 4, 0] });

    // Quem opera não conclui o pedido com diferença.
    const erro = await recusa(concluir(pickTaskId, guilherme));
    assert.equal(erro.code, "permission-denied");
    assert.equal(erro.message, "O pedido tem 1 linha com diferença: só a coordenação conclui.");
    assert.equal((await tarefa(pickTaskId)).status, "in_progress");

    const concluido = await concluir(pickTaskId, coordenacao);
    assert.equal(concluido.ok, true);
    linhas = await porLinha("pick_lines", orderId);
    assert.deepEqual(
      [linhas[POLO]!.qty_picked, linhas[POLO]!.physical_status, linhas[POLO]!.short_qty, linhas[POLO]!.shortage_reason, linhas[POLO]!.shortage_detail],
      [3, "short", 2, "falta", "A-01 tinha 3"],
    );
    const reservas = await porLinha("stock_reservations", orderId);
    assert.deepEqual([reservas[POLO]!.status, reservas[POLO]!.reserved_qty, reservas[POLO]!.released_qty], ["picked", 3, 2]);
    assert.deepEqual(await saldos(), { [`${POLO}@A-01`]: [8, 3, 5], [`${BONE}@A-02`]: [4, 4, 0] });
    assert.equal((await db.collection("shipments").doc(String(concluido.shipment_id)).get()).get("total_units"), 7);
    assert.equal((await eventos("picking.short_picked")).length, 1);
  });

  it("a linha separada inteira vira a menos sem desfazer, e a linha zerada não vai na embalagem", async () => {
    const { orderId, pickTaskId, linhaPolo, linhaBone } = await pedidoAprovado();
    await separar(pickTaskId, linhaPolo);
    await separar(pickTaskId, linhaBone);
    // Na conferência, o boné estava avariado: nada dele segue.
    const zerado = await separarMenos(pickTaskId, linhaBone, 0, { shortage_reason: "avaria" }, rafael);
    assert.deepEqual([zerado.changed, zerado.separated_qty], [true, 0]);
    // Repetir o mesmo separado não muda nada.
    assert.equal((await separarMenos(pickTaskId, linhaBone, 0, { shortage_reason: "avaria" }, rafael)).changed, false);
    assert.equal((await eventos("picking.line_separated")).filter((evento) => evento.payload.pick_line_id === linhaBone).length, 2);

    const concluido = await concluir(pickTaskId, coordenacao);
    const itens = await porLinha("order_items", orderId);
    assert.deepEqual([itens[POLO]!.status, itens[BONE]!.status, itens[BONE]!.picked_qty], ["packed", "short", 0]);
    assert.equal((await db.collection("shipments").doc(String(concluido.shipment_id)).get()).get("total_units"), 5);
    assert.deepEqual(await saldos(), { [`${POLO}@A-01`]: [8, 5, 3], [`${BONE}@A-02`]: [4, 0, 4] });
  });

  it("com todas as linhas zeradas, o pedido não segue: é Cancelar pedido", async () => {
    const { pickTaskId, linhaPolo, linhaBone } = await pedidoAprovado();
    await separarMenos(pickTaskId, linhaPolo, 0, { shortage_reason: "falta" });
    await separarMenos(pickTaskId, linhaBone, 0, { shortage_reason: "falta" });
    assert.equal((await recusa(concluir(pickTaskId, coordenacao))).message, "Nada foi separado. Para desistir do pedido, use Cancelar pedido.");
    assert.equal((await tarefa(pickTaskId)).status, "in_progress");
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
    // A linha separada com zero (falta total) não tirou nada da prateleira: a contagem passa.
    await separarMenos(pickTaskId, linhaPolo, 0, { shortage_reason: "falta" });
    await contar("contagem-0003");
    assert.deepEqual((await saldos())[`${POLO}@A-01`], [6, 5, 1]);
  });

  it("o pedido cancelado no meio da separação: o que já foi separado vai para a EXPEDICAO e volta pela guarda; o resto só solta a reserva", async () => {
    const { orderId, pickTaskId, linhaPolo, linhaBone } = await pedidoAprovado();
    // Das 5 polos, 3 foram separadas (2 em falta); os bonés ainda estão na prateleira.
    await separarMenos(pickTaskId, linhaPolo, 3, { shortage_reason: "falta" });
    const cancelado = (await cancelWarehouseOrderTransaction(
      db,
      { order_id: orderId, reason: "O cliente desistiu do evento", idempotency_key: "cancelar-0001" },
      coordenacao,
    )) as Record<string, unknown> & { returns: Array<Record<string, unknown>> };
    assert.equal((await tarefa(pickTaskId)).status, "cancelled");
    // A reserva sai inteira; só o separado conta como volta.
    assert.deepEqual([cancelado.released_qty, cancelado.returned_qty], [9, 3]);
    assert.equal(cancelado.returns.length, 1);
    const [volta] = cancelado.returns;
    assert.deepEqual([volta!.sku_code, volta!.quantity, volta!.location_id, volta!.destination_location_id], [POLO, 3, "A-01", "A-01"]);
    // As 3 polos estão na bancada: saem do saldo da prateleira e esperam a guarda na EXPEDICAO.
    assert.deepEqual(await saldos(), { [`${POLO}@A-01`]: [5, 0, 5], [`${POLO}@EXPEDICAO`]: [3, 0, 3], [`${BONE}@A-02`]: [4, 0, 4] });
    const reservas = await porLinha("stock_reservations", orderId);
    assert.deepEqual(
      [reservas[POLO]!.status, reservas[POLO]!.released_qty, reservas[POLO]!.returned_qty, reservas[POLO]!.returned_to_location_id],
      ["released", 5, 3, "EXPEDICAO"],
    );
    assert.deepEqual([reservas[BONE]!.status, reservas[BONE]!.released_qty, reservas[BONE]!.returned_to_location_id], ["released", 4, undefined]);
    // O movimento é interno: sai da prateleira e entra na EXPEDICAO, sem cobrança.
    const movimentos = (await db.collection("movements").where("source", "==", "wms_order_cancel").get()).docs.map((doc) => doc.data());
    assert.deepEqual(
      movimentos.map((movimento) => [movimento.movement_kind, movimento.tipo_mov, movimento.location_id, movimento.quantity]).sort(),
      [
        ["order_cancel_in", "ENTRADA", "EXPEDICAO", 3],
        ["order_cancel_out", "SAIDA", "A-01", 3],
      ],
    );
    for (const movimento of movimentos) assert.equal(billingMovementDirection(movimento, { snapshot: false }), null);
    const guarda = (await db.collection("putaway_tasks").doc(String(volta!.putaway_task_id)).get()).data() ?? {};
    assert.deepEqual([guarda.status, guarda.quantity, guarda.source_location_id, guarda.destination_location_id], ["planned", 3, "EXPEDICAO", "A-01"]);

    // A linha fica como histórico e não aceita mais progresso.
    const linhas = await porLinha("pick_lines", orderId);
    assert.deepEqual([linhas[POLO]!.status, linhas[POLO]!.separated_qty], ["cancelled", 3]);
    assert.equal((await recusa(separar(pickTaskId, linhaBone))).message, "Pedido cancelado.");
    assert.equal((await recusa(concluir(pickTaskId))).message, "Pedido cancelado.");

    // A guarda de volta é a de sempre: move da EXPEDICAO para a prateleira.
    const guardada = await avancar(`putaway:${String(volta!.putaway_task_id)}`, "planned", {
      source_location_id: "EXPEDICAO",
      destination_location_id: "A-01",
      location_id: "A-01",
      quantity: 3,
    });
    assert.equal(guardada.status, "completed");
    assert.deepEqual(await saldos(), { [`${POLO}@A-01`]: [8, 0, 8], [`${POLO}@EXPEDICAO`]: [0, 0, 0], [`${BONE}@A-02`]: [4, 0, 4] });
  });

  it("o pedido cancelado com a separação começada e nada fora da prateleira só solta a reserva", async () => {
    const { orderId, pickTaskId, linhaPolo } = await pedidoAprovado();
    // A linha zerada (falta total) não tirou nada da prateleira; desfeita, a outra voltou.
    await separarMenos(pickTaskId, linhaPolo, 0, { shortage_reason: "falta" });
    const cancelado = (await cancelWarehouseOrderTransaction(
      db,
      { order_id: orderId, reason: "O cliente desistiu do evento", idempotency_key: "cancelar-0002" },
      coordenacao,
    )) as Record<string, unknown>;
    assert.deepEqual([cancelado.released_qty, cancelado.returned_qty, cancelado.returns], [9, 0, []]);
    assert.deepEqual(await saldos(), { [`${POLO}@A-01`]: [8, 0, 8], [`${BONE}@A-02`]: [4, 0, 4] });
    assert.equal((await db.collection("putaway_tasks").get()).size, 0);
  });
});

/** Uma caixa guardada, como a abertura ou o recebimento a deixam. */
function caixa(code: string, locationId: string, storedAt: string, unitCount: number, extra: Record<string, unknown> = {}) {
  return db
    .collection("warehouse_boxes")
    .doc(code)
    .set({ id: code, code, customer_code: BTG, status: "stored", location_id: locationId, stored_at: storedAt, unit_count: unitCount, line_count: 1, sku_codes: [POLO], ...extra });
}

/** O conteúdo de entrada da caixa da abertura mora na linha da sessão. */
function linhaDaAbertura(boxCode: string, skuCode: string, quantidade: number, locationId: string) {
  return db
    .collection("opening_inventory_lines")
    .doc(`oil_${boxCode}_${skuCode}`)
    .set({ session_id: "ois_BTG_Pactual", customer_code: BTG, sku_code: skuCode, location_id: locationId, box_code: boxCode, counted_qty: quantidade, status: "counted" });
}

async function caixas() {
  const snapshot = await db.collection("warehouse_boxes").get();
  return Object.fromEntries(snapshot.docs.map((doc) => [doc.id, doc.data()]));
}

describe("A caixa na separação (separação com caixas, parte 3b)", () => {
  /** A-01: a CX-000001 (3 polos, a mais antiga) e a CX-000002 (4 polos e 6 de outro item); A-02: a CX-000003 do recebimento, com os 4 bonés. */
  async function prateleiras() {
    await Promise.all([
      caixa("CX-000001", "A-01", "2026-10-22T13:00:00.000Z", 3),
      linhaDaAbertura("CX-000001", POLO, 3, "A-01"),
      caixa("CX-000002", "A-01", "2026-10-22T14:00:00.000Z", 10, { sku_codes: [POLO, "BTG-OUTRO"], line_count: 2 }),
      linhaDaAbertura("CX-000002", POLO, 4, "A-01"),
      linhaDaAbertura("CX-000002", "BTG-OUTRO", 6, "A-01"),
      caixa("CX-000003", "A-02", "2026-11-06T13:00:00.000Z", 4, {
        sku_codes: [BONE],
        origin: { kind: "receipt", receipt_id: "rec_1" },
        lines: [{ inbound_item_id: "ini_1", line_number: 1, sku_code: BONE, client_item_code: BONE, product_name: "Boné", size: null, counted_qty: 4 }],
      }),
    ]);
  }

  it("separar a linha baixa a caixa mais antiga, e a seguinte completa; a linha guarda de onde saiu", async () => {
    await prateleiras();
    const { orderId, pickTaskId, linhaPolo, linhaBone } = await pedidoAprovado();
    const antes = await saldos();

    const polo = await separar(pickTaskId, linhaPolo);
    // A CX-000001, intacta, sai inteira; as outras 2 saem da CX-000002, que continua com outro item.
    assert.deepEqual(polo.boxes, [
      { box_code: "CX-000001", qty: 3, whole: true },
      { box_code: "CX-000002", qty: 2 },
    ]);
    assert.equal(polo.loose_qty, undefined);
    let guardadas = await caixas();
    assert.deepEqual(
      [guardadas["CX-000001"]!.taken_lines, guardadas["CX-000001"]!.taken_units, guardadas["CX-000001"]!.balance_at],
      [[{ sku_code: POLO, qty: 3 }], 3, polo.separated_at],
    );
    assert.deepEqual([guardadas["CX-000002"]!.taken_lines, guardadas["CX-000002"]!.taken_units], [[{ sku_code: POLO, qty: 2 }], 2]);
    assert.equal(guardadas["CX-000003"]!.taken_lines, undefined);
    const linhas = await porLinha("pick_lines", orderId);
    assert.deepEqual(linhas[POLO]!.separated_boxes, polo.boxes);
    const [evento] = await eventos("picking.line_separated");
    assert.deepEqual(evento.payload.boxes, [
      { box_code: "CX-000001", qty: 3 },
      { box_code: "CX-000002", qty: 2 },
    ]);
    // A caixa do recebimento traz o conteúdo nela: os 4 bonés saem dela inteira.
    const bone = await separar(pickTaskId, linhaBone, rafael);
    assert.deepEqual(bone.boxes, [{ box_code: "CX-000003", qty: 4, whole: true }]);
    assert.deepEqual((await caixas())["CX-000003"]!.taken_lines, [{ sku_code: BONE, qty: 4 }]);
    // A reserva e o saldo da prateleira não mudam: a caixa é só de onde saiu.
    assert.deepEqual(await saldos(), antes);

    // Repetir "Separar" não baixa de novo.
    assert.equal((await separar(pickTaskId, linhaPolo, rafael)).changed, false);
    guardadas = await caixas();
    assert.deepEqual([guardadas["CX-000001"]!.taken_units, guardadas["CX-000002"]!.taken_units], [3, 2]);

    // A conclusão não mexe mais nas caixas.
    await concluir(pickTaskId);
    guardadas = await caixas();
    assert.deepEqual([guardadas["CX-000001"]!.taken_units, guardadas["CX-000002"]!.taken_units, guardadas["CX-000003"]!.taken_units], [3, 2, 4]);
  });

  it("Desfazer devolve às mesmas caixas, e a caixa a que tudo voltou fica intacta de novo", async () => {
    await prateleiras();
    const { orderId, pickTaskId, linhaPolo } = await pedidoAprovado();
    await separar(pickTaskId, linhaPolo);
    const desfeita = await desfazer(pickTaskId, linhaPolo);
    assert.equal(desfeita.changed, true);
    const guardadas = await caixas();
    for (const codigo of ["CX-000001", "CX-000002"]) {
      assert.deepEqual([guardadas[codigo]!.taken_lines, guardadas[codigo]!.taken_units, guardadas[codigo]!.balance_at], [undefined, undefined, undefined], codigo);
    }
    assert.equal((await porLinha("pick_lines", orderId))[POLO]!.separated_boxes, undefined);
    const [evento] = await eventos("picking.line_unseparated");
    assert.deepEqual(evento.payload.boxes, [
      { box_code: "CX-000001", qty: 3 },
      { box_code: "CX-000002", qty: 2 },
    ]);
  });

  it("separar menos, ou mudar o separado, refaz a conta das caixas", async () => {
    await prateleiras();
    const { pickTaskId, linhaPolo } = await pedidoAprovado();
    await separar(pickTaskId, linhaPolo);
    // Das 5, só 2 saíram: voltam as 3 da conta anterior, e as 2 saem da mais antiga, que fica aberta.
    const aMenos = await separarMenos(pickTaskId, linhaPolo, 2, { shortage_reason: "falta" });
    assert.deepEqual(aMenos.boxes, [{ box_code: "CX-000001", qty: 2 }]);
    let guardadas = await caixas();
    assert.deepEqual([guardadas["CX-000001"]!.taken_units, guardadas["CX-000002"]!.taken_units], [2, undefined]);
    // A falta total não tira de caixa nenhuma.
    const zerada = await separarMenos(pickTaskId, linhaPolo, 0, { shortage_reason: "falta" });
    assert.equal(zerada.boxes, undefined);
    guardadas = await caixas();
    assert.deepEqual([guardadas["CX-000001"]!.taken_units, guardadas["CX-000002"]!.taken_units], [undefined, undefined]);
  });

  it("a caixa já aberta que a linha esgota vem marcada como a que esvazia", async () => {
    await prateleiras();
    // Outro pedido já tirou 1 polo da CX-000001: restam 2 nela.
    await db.collection("warehouse_boxes").doc("CX-000001").update({ taken_lines: [{ sku_code: POLO, qty: 1 }], taken_units: 1, balance_at: "2026-11-09T12:00:00.000Z" });
    const { pickTaskId, linhaPolo } = await pedidoAprovado();
    const polo = await separar(pickTaskId, linhaPolo);
    assert.deepEqual(polo.boxes, [
      { box_code: "CX-000001", qty: 2, emptied: true },
      { box_code: "CX-000002", qty: 3 },
    ]);
    const guardadas = await caixas();
    assert.deepEqual(guardadas["CX-000001"]!.taken_lines, [{ sku_code: POLO, qty: 3 }]);
    // Desfazer devolve só o que esta linha tirou: a saída do outro pedido fica.
    await desfazer(pickTaskId, linhaPolo);
    assert.deepEqual((await caixas())["CX-000001"]!.taken_lines, [{ sku_code: POLO, qty: 1 }]);
  });

  it("a caixa de que a separação tira tudo fica vazia e sai da prateleira, com o pedido e se saiu inteira; desfazer a devolve", async () => {
    await prateleiras();
    const { pickTaskId, linhaPolo, linhaBone } = await pedidoAprovado();
    const pedidoNumero = String((await tarefa(pickTaskId)).order_number);
    const polo = await separar(pickTaskId, linhaPolo);
    let guardadas = await caixas();
    // A CX-000001 saiu inteira; a CX-000002, de onde saíram 2 polos, continua guardada com o resto.
    assert.deepEqual(
      [
        guardadas["CX-000001"]!.status,
        guardadas["CX-000001"]!.emptied_at,
        guardadas["CX-000001"]!.emptied_whole,
        guardadas["CX-000001"]!.emptied_order_number,
        guardadas["CX-000001"]!.emptied_pick_line_id,
        guardadas["CX-000001"]!.emptied_by.name,
      ],
      ["emptied", polo.separated_at, true, pedidoNumero, linhaPolo, "Guilherme Dantas"],
    );
    assert.deepEqual([guardadas["CX-000002"]!.status, guardadas["CX-000002"]!.emptied_at], ["stored", undefined]);
    const [vazia] = await eventos("warehouse.box_emptied");
    assert.deepEqual(
      [vazia.title, vazia.description, vazia.entity_type, vazia.entity_id, vazia.customer_code],
      ["Caixa CX-000001 saiu inteira", `CX-000001 · A-01 · pedido ${pedidoNumero}`, "warehouse_boxes", "CX-000001", BTG],
    );
    assert.deepEqual(
      [vazia.payload.box_code, vazia.payload.location_id, vazia.payload.order_number, vazia.payload.pick_line_id, vazia.payload.whole],
      ["CX-000001", "A-01", pedidoNumero, linhaPolo, true],
    );
    const avisos = (await db.collection("ai_agent_inbox").get()).docs.map((doc) => doc.get("event_id"));
    assert.equal(avisos.includes(vazia.id), false);
    // A caixa vazia não entra no encaixe da prateleira: ele só lê a guardada e a que fecha o destino.
    const noEncaixe = await db.collection("warehouse_boxes").where("location_id", "==", "A-01").where("status", "in", ["stored", "committing"]).get();
    assert.deepEqual(noEncaixe.docs.map((doc) => doc.id), ["CX-000002"]);

    // A caixa do recebimento também: os 4 bonés a esvaziam inteira.
    await separar(pickTaskId, linhaBone, rafael);
    assert.deepEqual([(await caixas())["CX-000003"]!.status, (await caixas())["CX-000003"]!.emptied_whole], ["emptied", true]);
    assert.equal((await eventos("warehouse.box_emptied")).length, 2);

    // Desfazer devolve a caixa à prateleira, sem os dados da saída.
    await desfazer(pickTaskId, linhaPolo);
    guardadas = await caixas();
    assert.deepEqual(
      [guardadas["CX-000001"]!.status, guardadas["CX-000001"]!.emptied_at, guardadas["CX-000001"]!.emptied_whole, guardadas["CX-000001"]!.emptied_order_number, guardadas["CX-000001"]!.taken_units],
      ["stored", undefined, undefined, undefined, undefined],
    );
    const [devolvida] = await eventos("warehouse.box_reopened");
    assert.deepEqual([devolvida.title, devolvida.entity_id], ["Caixa CX-000001 de volta à prateleira", "CX-000001"]);

    // A linha separada de novo com menos volta a tirar da caixa que ela mesma tinha esvaziado.
    await separar(pickTaskId, linhaPolo);
    assert.equal((await caixas())["CX-000001"]!.status, "emptied");
    const aMenos = await separarMenos(pickTaskId, linhaPolo, 2, { shortage_reason: "falta" });
    assert.deepEqual(aMenos.boxes, [{ box_code: "CX-000001", qty: 2 }]);
    guardadas = await caixas();
    assert.deepEqual([guardadas["CX-000001"]!.status, guardadas["CX-000001"]!.taken_units, guardadas["CX-000002"]!.taken_units], ["stored", 2, undefined]);
  });

  it("a caixa já aberta que a linha esgota fica vazia sem ter saído inteira, e a caixa vazia de outro pedido não volta a ser sugerida", async () => {
    await prateleiras();
    await db.collection("warehouse_boxes").doc("CX-000001").update({ taken_lines: [{ sku_code: POLO, qty: 1 }], taken_units: 1, balance_at: "2026-11-09T12:00:00.000Z" });
    // A CX-000009 já tinha saído toda num pedido anterior.
    await caixa("CX-000009", "A-01", "2026-10-20T13:00:00.000Z", 6, { status: "emptied", taken_lines: [{ sku_code: POLO, qty: 6 }], taken_units: 6, emptied_at: "2026-11-08T12:00:00.000Z" });
    await linhaDaAbertura("CX-000009", POLO, 6, "A-01");
    const { pickTaskId, linhaPolo } = await pedidoAprovado();
    const polo = await separar(pickTaskId, linhaPolo);
    assert.deepEqual(polo.boxes, [
      { box_code: "CX-000001", qty: 2, emptied: true },
      { box_code: "CX-000002", qty: 3 },
    ]);
    const guardadas = await caixas();
    assert.deepEqual([guardadas["CX-000001"]!.status, guardadas["CX-000001"]!.emptied_whole], ["emptied", false]);
    assert.deepEqual([guardadas["CX-000009"]!.status, guardadas["CX-000009"]!.taken_units, guardadas["CX-000009"]!.emptied_at], ["emptied", 6, "2026-11-08T12:00:00.000Z"]);
    assert.equal((await eventos("warehouse.box_emptied"))[0]!.title, "Caixa CX-000001 vazia");
  });

  it("o que as caixas da prateleira não têm sai sem caixa", async () => {
    await prateleiras();
    // A CX-000002 só tem 1 polo: as caixas somam 4, e o pedido é de 5.
    await db.collection("opening_inventory_lines").doc(`oil_CX-000002_${POLO}`).update({ counted_qty: 1 });
    await db.collection("warehouse_boxes").doc("CX-000002").update({ unit_count: 7 });
    const { pickTaskId, linhaPolo } = await pedidoAprovado();
    const polo = await separar(pickTaskId, linhaPolo);
    assert.deepEqual(polo.boxes, [
      { box_code: "CX-000001", qty: 3, whole: true },
      { box_code: "CX-000002", qty: 1 },
    ]);
    assert.equal(polo.loose_qty, 1);
  });

  it("Outra caixa: a pessoa informa de quais caixas saiu; a soma fecha com a linha, a caixa é da prateleira e tem o item", async () => {
    await prateleiras();
    const { orderId, pickTaskId, linhaPolo } = await pedidoAprovado();
    const informar = (boxes: Array<{ box_code: string; qty: number }>, idempotencyKey = chave("outra-caixa")) =>
      setPickLineSeparated(db, { pick_task_id: pickTaskId, pick_line_id: linhaPolo, separated: true, boxes, idempotency_key: idempotencyKey }, guilherme) as Promise<Record<string, unknown>>;

    // Recusas: a soma não fecha, a caixa não tem tanto, a caixa é de outra prateleira. Nada fica gravado.
    assert.equal((await recusa(informar([{ box_code: "CX-000002", qty: 4 }]))).message, "As caixas somam 4 un., e o separado nas caixas desta prateleira é de 5 un.");
    assert.equal((await recusa(informar([{ box_code: "CX-000001", qty: 5 }]))).message, "A caixa CX-000001 tem 3 un. deste item, e não 5.");
    const outraPrateleira = await recusa(informar([{ box_code: "CX-000003", qty: 5 }]));
    assert.deepEqual([outraPrateleira.code, outraPrateleira.message], ["failed-precondition", "A caixa CX-000003 não tem este item nesta prateleira."]);
    assert.equal((await porLinha("pick_lines", orderId))[POLO]!.separated_at, undefined);
    assert.equal((await caixas())["CX-000002"]!.taken_lines, undefined);

    // A pessoa tirou as 4 da CX-000002 e 1 da CX-000001.
    const informado = await informar([
      { box_code: "CX-000002", qty: 4 },
      { box_code: "cx-000001", qty: 1 },
    ]);
    assert.deepEqual(informado.boxes, [
      { box_code: "CX-000001", qty: 1 },
      { box_code: "CX-000002", qty: 4 },
    ]);
    let guardadas = await caixas();
    assert.deepEqual([guardadas["CX-000001"]!.taken_units, guardadas["CX-000002"]!.taken_units], [1, 4]);

    // Na linha já separada, informar outras caixas troca de onde saiu; as mesmas não mudam nada.
    assert.equal(
      (
        await informar([
          { box_code: "CX-000001", qty: 1 },
          { box_code: "CX-000002", qty: 4 },
        ])
      ).changed,
      false,
    );
    const trocado = await informar([
      { box_code: "CX-000001", qty: 3 },
      { box_code: "CX-000002", qty: 2 },
    ]);
    assert.equal(trocado.changed, true);
    guardadas = await caixas();
    assert.deepEqual([guardadas["CX-000001"]!.taken_units, guardadas["CX-000002"]!.taken_units], [3, 2]);
    assert.equal((await eventos("picking.line_separated")).length, 2);
  });
});

function fecharVolume(pickTaskId: string, volumeId: string, pesoKg?: number, ator: OperationalActor = guilherme, idempotencyKey = chave("fechar-volume")) {
  return closeOrderVolume(db, { pick_task_id: pickTaskId, volume_id: volumeId, weight_kg: pesoKg, idempotency_key: idempotencyKey }, ator) as Promise<Record<string, unknown>>;
}

/** "Levar a caixa": a linha sai das caixas que a bancada mostrou, e a que sai inteira vira o volume. */
function levarACaixa(pickTaskId: string, pickLineId: string, boxes?: Array<{ box_code: string; qty: number }>, ator: OperationalActor = guilherme) {
  return setPickLineSeparated(
    db,
    { pick_task_id: pickTaskId, pick_line_id: pickLineId, separated: true, boxes, take_boxes: true, idempotency_key: chave("levar-a-caixa") },
    ator,
  ) as Promise<Record<string, unknown>>;
}

/** Os volumes da tarefa, resumidos: id, número, estado, unidades, caixa e peso. */
async function volumes(pickTaskId: string) {
  const lista = ((await tarefa(pickTaskId)).volumes ?? []) as Array<Record<string, unknown>>;
  return lista.map((volume) => [volume.id, volume.number, volume.status, volume.units, volume.box_code ?? null, volume.weight_kg ?? null]);
}

describe("Os volumes de expedição (separação com caixas, parte 4a)", () => {
  /** A-01: a CX-000001 (3 polos, a mais antiga) e a CX-000002 (4 polos e 6 de outro item); A-02: a CX-000003, com os 4 bonés e 1,2 kg. */
  async function prateleiras() {
    await Promise.all([
      caixa("CX-000001", "A-01", "2026-10-22T13:00:00.000Z", 3),
      linhaDaAbertura("CX-000001", POLO, 3, "A-01"),
      caixa("CX-000002", "A-01", "2026-10-22T14:00:00.000Z", 10, { sku_codes: [POLO, "BTG-OUTRO"], line_count: 2 }),
      linhaDaAbertura("CX-000002", POLO, 4, "A-01"),
      linhaDaAbertura("CX-000002", "BTG-OUTRO", 6, "A-01"),
      caixa("CX-000003", "A-02", "2026-11-06T13:00:00.000Z", 4, { sku_codes: [BONE], gross_weight_kg: 1.2 }),
      linhaDaAbertura("CX-000003", BONE, 4, "A-02"),
    ]);
  }

  it("a linha separada entra no volume aberto; Fechar volume guarda o peso, opcional, e a linha seguinte abre o próximo", async () => {
    const { orderId, pickTaskId, linhaPolo, linhaBone } = await pedidoAprovado();
    const pedidoNumero = String((await tarefa(pickTaskId)).order_number);

    const polo = await separar(pickTaskId, linhaPolo);
    assert.deepEqual(polo.volumes, [{ volume_id: "v1", number: 1, qty: 5 }]);
    assert.deepEqual(await volumes(pickTaskId), [["v1", 1, "open", 5, null, null]]);
    assert.equal((await tarefa(pickTaskId)).volume_seq, 1);
    assert.deepEqual((await porLinha("pick_lines", orderId))[POLO]!.separated_volumes, [{ volume_id: "v1", qty: 5 }]);
    const [separada] = await eventos("picking.line_separated");
    assert.deepEqual(separada.payload.volumes, [{ volume_number: 1, qty: 5 }]);
    // Separar de novo a linha já separada não põe nada a mais no volume.
    assert.equal((await separar(pickTaskId, linhaPolo, rafael)).changed, false);
    assert.deepEqual(await volumes(pickTaskId), [["v1", 1, "open", 5, null, null]]);

    // O volume que não existe não fecha.
    assert.equal((await recusa(fecharVolume(pickTaskId, "v9"))).message, "Volume não encontrado. Atualize e tente de novo.");
    const fechado = await fecharVolume(pickTaskId, "v1", 2.346, guilherme, "fechar-volume-0001");
    assert.deepEqual([fechado.ok, fechado.volume_id, fechado.volume_number, fechado.units, fechado.weight_kg], [true, "v1", 1, 5, 2.35]);
    const [volume] = ((await tarefa(pickTaskId)).volumes ?? []) as Array<Record<string, any>>;
    assert.deepEqual([volume!.status, volume!.weight_kg, volume!.closed_at, volume!.closed_by.name], ["closed", 2.35, fechado.closed_at, "Guilherme Dantas"]);
    const [evento] = await eventos("picking.volume_closed");
    assert.deepEqual(
      [evento.title, evento.description, evento.entity_type, evento.entity_id, evento.customer_code],
      [`Volume 1 fechado no pedido ${pedidoNumero}`, "5 un. · 2,35 kg", "pick_tasks", pickTaskId, BTG],
    );
    assert.deepEqual(evento.payload, { order_id: orderId, order_number: pedidoNumero, volume_id: "v1", volume_number: 1, units: 5, weight_kg: 2.35 });
    const avisos = (await db.collection("ai_agent_inbox").get()).docs.map((doc) => doc.get("event_id"));
    assert.equal(avisos.includes(evento.id), false);
    // A mesma chave devolve o mesmo resultado; outra chamada fica sabendo que já fechou.
    assert.deepEqual(await fecharVolume(pickTaskId, "v1", 2.346, guilherme, "fechar-volume-0001"), fechado);
    assert.equal((await recusa(fecharVolume(pickTaskId, "v1", 3))).message, "O volume 1 já está fechado.");
    assert.equal((await eventos("picking.volume_closed")).length, 1);

    // A linha seguinte abre o volume 2, e ele fecha sem peso.
    const bone = await separar(pickTaskId, linhaBone, rafael);
    assert.deepEqual(bone.volumes, [{ volume_id: "v2", number: 2, qty: 4 }]);
    assert.deepEqual(await volumes(pickTaskId), [
      ["v1", 1, "closed", 5, null, 2.35],
      ["v2", 2, "open", 4, null, null],
    ]);
    const semPeso = await fecharVolume(pickTaskId, "v2", undefined, rafael);
    assert.deepEqual([semPeso.volume_number, semPeso.units, semPeso.weight_kg], [2, 4, undefined]);
    assert.equal((await eventos("picking.volume_closed")).find((item) => item.payload.volume_number === 2)!.description, "4 un.");
    // A reserva e o saldo não mudam: o volume é só onde o separado está.
    assert.deepEqual(await saldos(), { [`${POLO}@A-01`]: [8, 5, 3], [`${BONE}@A-02`]: [4, 4, 0] });
  });

  it("Levar a caixa: a caixa que sai inteira vira um volume fechado, com o peso de entrada, e o resto da linha entra no volume aberto", async () => {
    await prateleiras();
    const { orderId, pickTaskId, linhaPolo, linhaBone } = await pedidoAprovado();

    // Os 5 polos: a CX-000001 inteira (3) e 2 da CX-000002.
    const polo = await levarACaixa(pickTaskId, linhaPolo, [
      { box_code: "CX-000001", qty: 3 },
      { box_code: "CX-000002", qty: 2 },
    ]);
    assert.deepEqual(polo.volumes, [
      { volume_id: "v1", number: 1, qty: 3, box_code: "CX-000001" },
      { volume_id: "v2", number: 2, qty: 2 },
    ]);
    assert.deepEqual(await volumes(pickTaskId), [
      ["v1", 1, "closed", 3, "CX-000001", null],
      ["v2", 2, "open", 2, null, null],
    ]);
    const [daCaixa] = ((await tarefa(pickTaskId)).volumes ?? []) as Array<Record<string, any>>;
    assert.deepEqual([daCaixa!.closed_at, daCaixa!.closed_by.name], [polo.separated_at, "Guilherme Dantas"]);
    assert.deepEqual((await porLinha("pick_lines", orderId))[POLO]!.separated_volumes, [
      { volume_id: "v1", qty: 3 },
      { volume_id: "v2", qty: 2 },
    ]);
    // A caixa levada sai da prateleira como a que saiu inteira.
    assert.deepEqual([(await caixas())["CX-000001"]!.status, (await caixas())["CX-000001"]!.emptied_whole], ["emptied", true]);

    // Os 4 bonés: sem informar a caixa, vale a mais antiga, que sai inteira, com o peso que ela tinha.
    const bone = await levarACaixa(pickTaskId, linhaBone, undefined, rafael);
    assert.deepEqual(bone.volumes, [{ volume_id: "v3", number: 3, qty: 4, box_code: "CX-000003" }]);
    assert.deepEqual(await volumes(pickTaskId), [
      ["v1", 1, "closed", 3, "CX-000001", null],
      ["v2", 2, "open", 2, null, null],
      ["v3", 3, "closed", 4, "CX-000003", 1.2],
    ]);

    // Desfazer devolve a caixa à prateleira e tira o volume dela.
    const desfeito = await desfazer(pickTaskId, linhaBone);
    assert.deepEqual([desfeito.renumbered_volumes, desfeito.changed_volumes], [undefined, undefined]);
    assert.equal((await caixas())["CX-000003"]!.status, "stored");
    assert.deepEqual(await volumes(pickTaskId), [
      ["v1", 1, "closed", 3, "CX-000001", null],
      ["v2", 2, "open", 2, null, null],
    ]);
    assert.deepEqual((await eventos("picking.line_unseparated"))[0]!.payload.volumes, [{ volume_number: 3, qty: 4 }]);
    // O id do volume não volta: o próximo é o v4.
    assert.deepEqual((await separar(pickTaskId, linhaBone)).volumes, [{ volume_id: "v2", number: 2, qty: 4 }]);
    assert.equal((await tarefa(pickTaskId)).volume_seq, 3);
  });

  it("Levar a caixa só vale para a caixa que sai inteira: a recusa não grava nada", async () => {
    await prateleiras();
    const { orderId, pickTaskId, linhaPolo } = await pedidoAprovado();
    // A pessoa tirou as 4 da CX-000002 (que tem outro item) e 1 da CX-000001: nenhuma sai inteira.
    const recusada = await recusa(
      levarACaixa(pickTaskId, linhaPolo, [
        { box_code: "CX-000002", qty: 4 },
        { box_code: "CX-000001", qty: 1 },
      ]),
    );
    assert.deepEqual([recusada.code, recusada.message], ["failed-precondition", "Nenhuma caixa sai inteira nesta linha. Atualize e tente de novo."]);
    assert.equal((recusada.details as Record<string, unknown>).code, "SEPARATION_BOX_NOT_WHOLE");
    assert.equal((await porLinha("pick_lines", orderId))[POLO]!.separated_at, undefined);
    assert.deepEqual(await volumes(pickTaskId), []);
    assert.equal((await caixas())["CX-000002"]!.taken_lines, undefined);
  });

  it("Desfazer tira a linha dos volumes: o fechado que esvazia sai e o último ocupa o número dele; o fechado de que sai uma parte perde o peso", async () => {
    const { orderId, pickTaskId, linhaPolo, linhaBone } = await pedidoAprovado();
    await separar(pickTaskId, linhaPolo);
    await fecharVolume(pickTaskId, "v1", 2.3);
    await separar(pickTaskId, linhaBone);
    await fecharVolume(pickTaskId, "v2", 1.1);

    // O volume 1 só tinha os polos: ele sai, e o volume 2, já etiquetado, passa a ser o 1.
    const semOPolo = await desfazer(pickTaskId, linhaPolo);
    assert.deepEqual(semOPolo.renumbered_volumes, [{ volume_id: "v2", from: 2, to: 1 }]);
    assert.equal(semOPolo.changed_volumes, undefined);
    assert.deepEqual(await volumes(pickTaskId), [["v2", 1, "closed", 4, null, 1.1]]);
    assert.equal((await porLinha("pick_lines", orderId))[POLO]!.separated_volumes, undefined);

    // Os polos de novo, no volume aberto seguinte; fechado com os dois itens dentro.
    await separar(pickTaskId, linhaPolo);
    await desfazer(pickTaskId, linhaBone);
    assert.deepEqual(await volumes(pickTaskId), [["v3", 1, "open", 5, null, null]]);
    await separar(pickTaskId, linhaBone);
    await fecharVolume(pickTaskId, "v3", 3.5);
    assert.deepEqual(await volumes(pickTaskId), [["v3", 1, "closed", 9, null, 3.5]]);

    // Tirar os bonés do volume fechado: ele continua fechado, sem o peso, e pede etiqueta nova.
    const semOBone = await desfazer(pickTaskId, linhaBone);
    assert.deepEqual([semOBone.changed_volumes, semOBone.renumbered_volumes], [[{ volume_id: "v3", number: 1 }], undefined]);
    assert.deepEqual(await volumes(pickTaskId), [["v3", 1, "closed", 5, null, null]]);
  });

  it("a conclusão grava um volume por volume da bancada, com os itens de cada um; o lacre é um por pedido, e a entrega segue como sempre", async () => {
    await prateleiras();
    const { orderId, pickTaskId, linhaPolo, linhaBone } = await pedidoAprovado();
    const pedidoNumero = String((await tarefa(pickTaskId)).order_number);
    // Volume 1: a CX-000001 inteira (3 polos). Volume 2: os outros 2 polos, fechado com 0,8 kg. Volume 3: os bonés, ainda aberto.
    const polo = await levarACaixa(pickTaskId, linhaPolo, [
      { box_code: "CX-000001", qty: 3 },
      { box_code: "CX-000002", qty: 2 },
    ]);
    const fechado = await fecharVolume(pickTaskId, "v2", 0.8);
    await separar(pickTaskId, linhaBone, rafael);

    const concluido = await concluir(pickTaskId, rafael, "concluir-volumes-0001");
    const packId = `pack_${orderId}`;
    const shipmentId = String(concluido.shipment_id);

    const pacotes = (await db.collection("packages").where("order_id", "==", orderId).get()).docs.map((doc) => doc.data()).sort((left, right) => left.volume_number - right.volume_number);
    assert.deepEqual(
      pacotes.map((pacote) => [pacote.id, pacote.volume_number, pacote.volume_label, pacote.packed_units, pacote.box_code ?? null, pacote.weight_kg ?? null, pacote.package_count, pacote.seal_code, pacote.status]),
      [
        [`pkg_${packId}_001`, 1, "Volume 1", 3, "CX-000001", null, 3, "L-0101", "packed"],
        [`pkg_${packId}_002`, 2, "Volume 2", 2, null, 0.8, 3, "L-0101", "packed"],
        [`pkg_${packId}_003`, 3, "Volume 3", 4, null, null, 3, "L-0101", "packed"],
      ],
    );
    // Quem fechou cada volume e quando: a caixa levada, o fechado na bancada e o que fechou com a conclusão.
    assert.deepEqual(
      pacotes.map((pacote) => [pacote.closed_at, pacote.closed_by.name]),
      [
        [polo.separated_at, "Guilherme Dantas"],
        [fechado.closed_at, "Guilherme Dantas"],
        [pacotes[2]!.closed_at, "Rafael"],
      ],
    );
    assert.ok(String(pacotes[2]!.closed_at) > String(fechado.closed_at));

    // O conteúdo de cada volume: a linha dos polos foi em dois.
    const conteudo = (await db.collection("package_items").where("order_id", "==", orderId).get()).docs
      .map((doc) => doc.data())
      .sort((left, right) => String(left.id).localeCompare(String(right.id)));
    assert.deepEqual(
      conteudo.map((item) => [item.id, item.package_id, item.sku_code, item.qty_packed, item.shipment_id, item.status]),
      [
        [`pki_pkg_${packId}_001_01`, `pkg_${packId}_001`, POLO, 3, shipmentId, "packed"],
        [`pki_pkg_${packId}_002_01`, `pkg_${packId}_002`, POLO, 2, shipmentId, "packed"],
        [`pki_pkg_${packId}_003_02`, `pkg_${packId}_003`, BONE, 4, shipmentId, "packed"],
      ],
    );
    // A remessa continua com uma linha por item do pedido, e diz em quais volumes ele foi.
    const daRemessa = await porLinha("shipment_items", orderId);
    assert.deepEqual(
      [daRemessa[POLO]!.qty_shipped, daRemessa[POLO]!.package_id, daRemessa[POLO]!.package_ids],
      [5, `pkg_${packId}_001`, [`pkg_${packId}_001`, `pkg_${packId}_002`]],
    );
    assert.deepEqual([daRemessa[BONE]!.qty_shipped, daRemessa[BONE]!.package_id, daRemessa[BONE]!.package_ids], [4, `pkg_${packId}_003`, undefined]);
    const remessa = (await db.collection("shipments").doc(shipmentId).get()).data() ?? {};
    assert.deepEqual([remessa.status, remessa.total_units, remessa.package_count, remessa.volume_label, remessa.seal_code], ["ready_to_dispatch", 9, 3, "3 volumes", "L-0101"]);
    const embalagem = (await db.collection("pack_tasks").doc(packId).get()).data() ?? {};
    assert.deepEqual([embalagem.status, embalagem.package_count, embalagem.volume_label, embalagem.seal_code], ["completed", 3, "3 volumes", "L-0101"]);
    const [criada] = await eventos("shipment.created");
    assert.deepEqual(
      [criada.entity_id, criada.description, criada.payload.package_id, criada.payload.package_count, criada.payload.packed_units, criada.payload.seal_code],
      [shipmentId, `${pedidoNumero} pronto para despacho.`, `pkg_${packId}_001`, 3, 9, "L-0101"],
    );

    // Repetir a conclusão não grava volume de novo.
    await concluir(pickTaskId, rafael, "concluir-volumes-0001");
    assert.equal((await db.collection("packages").where("order_id", "==", orderId).get()).size, 3);
    // Depois de concluída, o volume não fecha nem a linha muda.
    assert.equal((await recusa(fecharVolume(pickTaskId, "v3"))).message, "A separação deste pedido já foi concluída.");

    // A saída e a entrega conferem as unidades dos volumes e baixam o saldo.
    await avancar(`shipping:${shipmentId}`, "ready_to_dispatch", { carrier: "Dutelog", driver_name: "Rafael", vehicle_plate: "DUTE-001" });
    await avancar(`shipping:${shipmentId}`, "dispatched", { proof_reference: "Carlos Lima", delivery_notes: "Recebido pelo cliente." });
    assert.deepEqual(await saldos(), { [`${POLO}@A-01`]: [3, 0, 3], [`${BONE}@A-02`]: [0, 0, 0] });
    assert.equal((await db.collection("orders").doc(orderId).get()).get("status"), "ENTREGUE");
    const entregues = (await db.collection("packages").where("order_id", "==", orderId).get()).docs.map((doc) => doc.get("status"));
    assert.deepEqual(new Set(entregues).size, 1);
  });

  it("a linha separada a menos até zero não entra em volume, e o pedido com um volume só conclui com ele", async () => {
    const { orderId, pickTaskId, linhaPolo, linhaBone } = await pedidoAprovado();
    await separar(pickTaskId, linhaPolo);
    const zerada = await separarMenos(pickTaskId, linhaBone, 0, { shortage_reason: "falta" });
    assert.equal(zerada.volumes, undefined);
    assert.deepEqual(await volumes(pickTaskId), [["v1", 1, "open", 5, null, null]]);
    // Com diferença, só a coordenação conclui; o volume aberto fecha junto.
    await concluir(pickTaskId, coordenacao);
    const pacotes = (await db.collection("packages").where("order_id", "==", orderId).get()).docs.map((doc) => doc.data());
    assert.deepEqual(
      pacotes.map((pacote) => [pacote.id, pacote.volume_label, pacote.packed_units, pacote.package_count, pacote.closed_by.name]),
      [[`pkg_pack_${orderId}_001`, "Volume 1", 5, 1, "Mariana Lopes"]],
    );
    const remessa = (await db.collection("shipments").where("order_id", "==", orderId).get()).docs[0]!.data();
    assert.deepEqual([remessa.package_count, remessa.volume_label, remessa.total_units], [1, "Volume 1", 5]);
  });

  it("o pedido separado antes dos volumes conclui no volume único de sempre", async () => {
    const { orderId, pickTaskId, linhaPolo, linhaBone } = await pedidoAprovado();
    await separar(pickTaskId, linhaPolo);
    await separar(pickTaskId, linhaBone);
    // Como a separação ficava gravada antes da parte 4: sem volume na tarefa nem na linha.
    const { FieldValue } = await import("firebase-admin/firestore");
    await Promise.all([
      db.collection("pick_tasks").doc(pickTaskId).update({ volumes: FieldValue.delete(), volume_seq: FieldValue.delete() }),
      db.collection("pick_lines").doc(linhaPolo).update({ separated_volumes: FieldValue.delete() }),
      db.collection("pick_lines").doc(linhaBone).update({ separated_volumes: FieldValue.delete() }),
    ]);
    await concluir(pickTaskId);
    const pacotes = (await db.collection("packages").where("order_id", "==", orderId).get()).docs.map((doc) => doc.data());
    assert.deepEqual(
      pacotes.map((pacote) => [pacote.id, pacote.volume_label, pacote.packed_units, pacote.package_count]),
      [[`pkg_pack_${orderId}_001`, "VOL-1", 9, 1]],
    );
    const conteudo = (await db.collection("package_items").where("order_id", "==", orderId).get()).docs.map((doc) => [doc.get("sku_code"), doc.get("qty_packed")]).sort();
    assert.deepEqual(conteudo, [
      [BONE, 4],
      [POLO, 5],
    ]);
  });

  it("o item que a linha não pôs em volume nenhum vai no volume aberto: os volumes fecham com o separado, e a conclusão não trava", async () => {
    const { orderId, pickTaskId, linhaPolo, linhaBone } = await pedidoAprovado();
    await separar(pickTaskId, linhaPolo);
    await fecharVolume(pickTaskId, "v1", 2.3);
    await separar(pickTaskId, linhaBone);
    // O item dos bonés ficou sem a linha dele (o número da linha não casa): nenhum volume diz que o leva.
    const itens = await porLinha("order_items", orderId);
    await db.collection("order_items").doc(String(itens[BONE]!.id)).update({ line_number: 99 });

    await concluir(pickTaskId);
    const pacotes = (await db.collection("packages").where("order_id", "==", orderId).get()).docs.map((doc) => doc.data()).sort((left, right) => left.volume_number - right.volume_number);
    assert.deepEqual(
      pacotes.map((pacote) => [pacote.volume_number, pacote.packed_units, pacote.weight_kg ?? null]),
      [
        [1, 5, 2.3],
        [2, 4, null],
      ],
    );
    const conteudo = (await db.collection("package_items").where("order_id", "==", orderId).get()).docs
      .map((doc) => [String(doc.get("package_id")).slice(-3), doc.get("sku_code"), doc.get("qty_packed")])
      .sort();
    assert.deepEqual(conteudo, [
      ["001", POLO, 5],
      ["002", BONE, 4],
    ]);
  });

  it("o pedido com volumes cancelado depois de concluído cancela todos os volumes, e o separado volta pela guarda", async () => {
    const { orderId, pickTaskId, linhaPolo, linhaBone } = await pedidoAprovado();
    await separar(pickTaskId, linhaPolo);
    await fecharVolume(pickTaskId, "v1", 2.3);
    await separar(pickTaskId, linhaBone);
    await concluir(pickTaskId);
    assert.equal((await db.collection("packages").where("order_id", "==", orderId).get()).size, 2);

    const cancelado = (await cancelWarehouseOrderTransaction(
      db,
      { order_id: orderId, reason: "O cliente desistiu do evento", idempotency_key: "cancelar-volumes-0001" },
      coordenacao,
    )) as Record<string, unknown>;
    assert.equal(cancelado.returned_qty, 9);
    const pacotes = (await db.collection("packages").where("order_id", "==", orderId).get()).docs.map((doc) => doc.get("status"));
    assert.deepEqual(pacotes, ["cancelled", "cancelled"]);
    const conteudo = (await db.collection("package_items").where("order_id", "==", orderId).get()).docs.map((doc) => doc.get("status"));
    assert.deepEqual(conteudo, ["cancelled", "cancelled"]);
  });
});
