import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

import {
  advanceWarehouseTaskTransaction,
  cancelWarehouseOrderTransaction,
  createCustomerRequestTransaction,
  decideCustomerRequestTransaction,
  type OperationalActor,
} from "./operations.js";

/**
 * Separar a menos (pergunta 59): a conclusão da separação de verdade, no
 * emulador, do pedido aprovado à entrega e ao cancelamento.
 */

const PROJECT_ID = "demo-dute-operations";
const BTG = "BTG Pactual";
const POLO = "BTG-POLO-G";
const BONE = "BTG-BONE";

const coordenacao: OperationalActor = { uid: "coord-1", email: "coord@dutelog.com.br", name: "Mariana Lopes", role: "interno", customer_code: "Dutelog" };
const armazem: OperationalActor = { uid: "wms-1", email: "wms@dutelog.com.br", name: "Rafael", role: "wms", customer_code: "Dutelog" };
const cliente: OperationalActor = { uid: "client-1", email: "compras@btg.com.br", name: "Compras BTG", role: "cliente", customer_code: BTG };

let db: Firestore;
let app: ReturnType<typeof initializeApp>;

before(() => {
  app = initializeApp({ projectId: PROJECT_ID }, "short-pick-test");
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
    balance("bal-polo", POLO, "Camiseta polo G", "A-01", 5),
    balance("bal-bone", BONE, "Boné", "A-02", 4),
  ]);
});

/** O pedido de 5 polos (A-01) e 4 bonés (A-02), aprovado e com a separação iniciada. */
async function pedidoEmSeparacao() {
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
  await avancar(`picking:${pickTaskId}`, "planned");
  const linhas = await db.collection("pick_lines").where("pick_task_id", "==", pickTaskId).get();
  const linhaDe = (sku: string) => linhas.docs.find((linha) => linha.get("sku_code") === sku)!.id;
  return { requestId: String(criado.id), orderId, pickTaskId, linhaPolo: linhaDe(POLO), linhaBone: linhaDe(BONE) };
}

function avancar(taskUid: string, expectedStatus: string, operation?: Record<string, unknown>, ator: OperationalActor = armazem) {
  return advanceWarehouseTaskTransaction(
    db,
    { task_uid: taskUid, expected_status: expectedStatus, operation, idempotency_key: `${taskUid}:${expectedStatus}:${ator.uid}` },
    ator,
  ) as Promise<Record<string, unknown>>;
}

function separar(pickTaskId: string, picking_lines: Array<Record<string, unknown>>, ator: OperationalActor = coordenacao) {
  return avancar(`picking:${pickTaskId}`, "in_progress", { picking_lines: picking_lines.map((linha) => ({ status: "confirmed", ...linha })) }, ator);
}

/** Embala o que foi separado (a tela manda só o item com separado) e entrega. */
async function embalarEEntregar(orderId: string, packTaskId: string) {
  await avancar(`packing:${packTaskId}`, "ready");
  const itens = (await db.collection("order_items").where("order_id", "==", orderId).get()).docs.filter((item) => Number(item.get("picked_qty")) > 0);
  const embalado = await avancar(`packing:${packTaskId}`, "in_progress", {
    volume_label: "VOL-1",
    seal_code: "L-0101",
    package_count: 1,
    packing_lines: itens.map((item) => ({ order_item_id: item.id, qty_packed: Number(item.get("picked_qty")), status: "confirmed" })),
  });
  const shipmentId = String(embalado.shipment_id);
  await avancar(`shipping:${shipmentId}`, "ready_to_dispatch", { carrier: "Dutelog", driver_name: "Rafael", vehicle_plate: "DUTE-001" });
  await avancar(`shipping:${shipmentId}`, "dispatched", { proof_reference: "Carlos Lima", delivery_notes: "Recebido pelo cliente." });
  return shipmentId;
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

describe("Separar a menos (pergunta 59)", () => {
  it("a coordenação separa a menos: a reserva fica com o separado, a diferença volta a ficar disponível, e a entrega baixa só o separado", async () => {
    const { orderId, pickTaskId, linhaPolo, linhaBone } = await pedidoEmSeparacao();

    const separado = await separar(pickTaskId, [
      { pick_line_id: linhaPolo, qty_picked: 3, shortage_reason: "falta", shortage_detail: "A posição A-01 tinha 3" },
      { pick_line_id: linhaBone, qty_picked: 4 },
    ]);
    assert.equal(separado.status, "completed");

    const linhas = await porLinha("pick_lines", orderId);
    assert.equal(linhas[POLO]!.qty_picked, 3);
    assert.equal(linhas[POLO]!.physical_status, "short");
    assert.equal(linhas[POLO]!.short_qty, 2);
    assert.equal(linhas[POLO]!.shortage_reason, "falta");
    assert.equal(linhas[POLO]!.shortage_detail, "A posição A-01 tinha 3");
    assert.equal(linhas[BONE]!.qty_picked, 4);
    assert.equal(linhas[BONE]!.physical_status, "confirmed");

    const itens = await porLinha("order_items", orderId);
    assert.deepEqual([itens[POLO]!.picked_qty, itens[POLO]!.status, itens[POLO]!.short_qty], [3, "picked", 2]);
    assert.deepEqual([itens[BONE]!.picked_qty, itens[BONE]!.status], [4, "picked"]);

    const reservas = await porLinha("stock_reservations", orderId);
    assert.deepEqual(
      [reservas[POLO]!.status, reservas[POLO]!.reserved_qty, reservas[POLO]!.picked_qty, reservas[POLO]!.released_qty, reservas[POLO]!.release_reason],
      ["picked", 3, 3, 2, "short_pick"],
    );
    assert.deepEqual([reservas[BONE]!.status, reservas[BONE]!.reserved_qty], ["picked", 4]);

    // A diferença volta a ficar disponível na posição, no portal e para o próximo pedido.
    assert.deepEqual(await saldos(), { [`${POLO}@A-01`]: [5, 3, 2], [`${BONE}@A-02`]: [4, 4, 0] });
    const portal = (await db.collection("client_inventory").doc(`cinv_BTG_Pactual__${POLO}`).get()).data() ?? {};
    assert.deepEqual([portal.qty_on_hand, portal.qty_reserved, portal.qty_available], [5, 3, 2]);

    const pedido = (await db.collection("orders").doc(orderId).get()).data() ?? {};
    assert.deepEqual([pedido.status, pedido.qtd_sep, pedido.qtd_falta], ["SEPARACAO", 7, 2]);
    const tarefa = (await db.collection("pick_tasks").doc(pickTaskId).get()).data() ?? {};
    assert.deepEqual([tarefa.picked_units, tarefa.short_units], [7, 2]);
    const embalagem = (await db.collection("pack_tasks").doc(String(separado.pack_task_id)).get()).data() ?? {};
    assert.equal(embalagem.picked_units, 7);

    // O aviso ao cliente diz quanto seguiu; o motivo e a posição ficam no payload, da equipe.
    const [aMenos] = await eventos("picking.short_picked");
    assert.equal(aMenos.description, `${pedido.order_number} seguiu com 7 de 9 un.`);
    assert.equal(aMenos.severity, "attention");
    assert.deepEqual(aMenos.payload.lines, [
      {
        line_number: 1,
        sku_code: POLO,
        product_name: "Camiseta polo G",
        location_id: "A-01",
        expected_qty: 5,
        picked_qty: 3,
        short_qty: 2,
        reason: "falta",
        detail: "A posição A-01 tinha 3",
      },
    ]);
    assert.equal(JSON.stringify([aMenos.title, aMenos.description]).includes("A-01"), false);
    const [liberada] = await eventos("stock.reservation_released");
    assert.deepEqual([liberada.payload.release_reason, liberada.payload.released_qty_total], ["short_pick", 2]);

    // A entrega baixa só o separado.
    const shipmentId = await embalarEEntregar(orderId, String(separado.pack_task_id));
    assert.equal((await db.collection("shipments").doc(shipmentId).get()).get("total_units"), 7);
    assert.deepEqual(await saldos(), { [`${POLO}@A-01`]: [2, 0, 2], [`${BONE}@A-02`]: [0, 0, 0] });
    const saidas = (await db.collection("movements").where("source", "==", "wms_shipping").get()).docs.map((doc) => [doc.get("sku_code"), doc.get("quantity")]);
    assert.deepEqual(saidas.sort(), [[BONE, 4], [POLO, 3]]);
    assert.equal((await db.collection("orders").doc(orderId).get()).get("status"), "ENTREGUE");

    // As 2 polos que não foram achadas seguem disponíveis para o próximo pedido.
    const outro = await createCustomerRequestTransaction(
      db,
      { type: "retirada", priority: "normal", title: "Outro pedido", customer_code: BTG, idempotency_key: "pedido-2", items: [{ sku_code: POLO, quantity: 2 }] },
      cliente,
    );
    assert.ok(outro.id);
  });

  it("a linha zerada solta a reserva inteira, e a embalagem e a entrega passam por ela", async () => {
    const { orderId, pickTaskId, linhaPolo, linhaBone } = await pedidoEmSeparacao();
    const separado = await separar(pickTaskId, [
      { pick_line_id: linhaPolo, qty_picked: 0, shortage_reason: "avaria" },
      { pick_line_id: linhaBone, qty_picked: 4 },
    ]);

    const itens = await porLinha("order_items", orderId);
    assert.deepEqual([itens[POLO]!.picked_qty, itens[POLO]!.status, itens[POLO]!.shortage_reason], [0, "short", "avaria"]);
    const reservas = await porLinha("stock_reservations", orderId);
    assert.deepEqual([reservas[POLO]!.status, reservas[POLO]!.released_qty, reservas[POLO]!.reserved_qty], ["released", 5, 0]);
    assert.deepEqual(await saldos(), { [`${POLO}@A-01`]: [5, 0, 5], [`${BONE}@A-02`]: [4, 4, 0] });

    const shipmentId = await embalarEEntregar(orderId, String(separado.pack_task_id));
    const volumes = (await db.collection("package_items").where("order_id", "==", orderId).get()).docs.map((doc) => doc.get("sku_code"));
    assert.deepEqual(volumes, [BONE]);
    assert.equal((await db.collection("shipments").doc(shipmentId).get()).get("total_units"), 4);
    assert.deepEqual(await saldos(), { [`${POLO}@A-01`]: [5, 0, 5], [`${BONE}@A-02`]: [0, 0, 0] });
    assert.equal((await porLinha("stock_reservations", orderId))[POLO]!.status, "released");
  });

  it("quem opera não separa a menos; sem motivo, sem nada separado ou a mais, recusa e nada muda", async () => {
    const { orderId, pickTaskId, linhaPolo, linhaBone } = await pedidoEmSeparacao();
    const recusa = (linhas: Array<Record<string, unknown>>, ator: OperationalActor, erro: { code: string; message: string }) =>
      assert.rejects(separar(pickTaskId, linhas, ator), erro);

    await recusa(
      [{ pick_line_id: linhaPolo, qty_picked: 3, shortage_reason: "falta" }, { pick_line_id: linhaBone, qty_picked: 4 }],
      armazem,
      { code: "permission-denied", message: "Só a coordenação separa a menos. Registre a falta pelo Tratar." },
    );
    await recusa([{ pick_line_id: linhaPolo, qty_picked: 3 }, { pick_line_id: linhaBone, qty_picked: 4 }], coordenacao, {
      code: "invalid-argument",
      message: "Informe o motivo da diferença em Camiseta polo G.",
    });
    await recusa(
      [{ pick_line_id: linhaPolo, qty_picked: 0, shortage_reason: "falta" }, { pick_line_id: linhaBone, qty_picked: 0, shortage_reason: "falta" }],
      coordenacao,
      { code: "failed-precondition", message: "Nada foi separado. Para desistir do pedido, use Cancelar pedido." },
    );
    await recusa([{ pick_line_id: linhaPolo, qty_picked: 6 }, { pick_line_id: linhaBone, qty_picked: 4 }], coordenacao, {
      code: "failed-precondition",
      message: `Linha ${linhaPolo} tem 6 unidade(s) físicas, mas esperava 5. Registre exceção antes de concluir.`,
    });

    assert.equal((await db.collection("pick_tasks").doc(pickTaskId).get()).get("status"), "in_progress");
    const reservas = await porLinha("stock_reservations", orderId);
    assert.deepEqual([reservas[POLO]!.status, reservas[BONE]!.status], ["reserved", "reserved"]);
    assert.deepEqual(await saldos(), { [`${POLO}@A-01`]: [5, 5, 0], [`${BONE}@A-02`]: [4, 4, 0] });
    assert.equal((await eventos("picking.short_picked")).length, 0);

    // O separado completo segue para quem opera, como antes.
    const completo = await separar(pickTaskId, [{ pick_line_id: linhaPolo, qty_picked: 5 }, { pick_line_id: linhaBone, qty_picked: 4 }], armazem);
    assert.equal(completo.status, "completed");
    assert.equal((await db.collection("pick_tasks").doc(pickTaskId).get()).get("short_units"), undefined);
  });

  it("a falta que quem opera registrou pelo Tratar fica resolvida com a separação a menos", async () => {
    const { pickTaskId, linhaPolo, linhaBone } = await pedidoEmSeparacao();
    await Promise.all([
      db.collection("quality_exceptions").doc("wex-1").set({
        id: "wex-1",
        task_uid: `picking:${pickTaskId}`,
        task_type: "picking",
        task_id: pickTaskId,
        customer_code: BTG,
        note: "Falta física na A-01.",
        status: "open",
      }),
      db.collection("pick_tasks").doc(pickTaskId).update({ exception_count: 1, blocked_reason: "Falta física na A-01.", last_exception_id: "wex-1" }),
    ]);

    await separar(pickTaskId, [
      { pick_line_id: linhaPolo, qty_picked: 3, shortage_reason: "falta" },
      { pick_line_id: linhaBone, qty_picked: 4 },
    ]);

    const excecao = (await db.collection("quality_exceptions").doc("wex-1").get()).data() ?? {};
    assert.equal(excecao.status, "resolved");
    assert.equal(excecao.resolution, "Separado a menos pela coordenação: 7 de 9 un.");
    assert.equal(excecao.resolved_by?.uid, "coord-1");
    const tarefa = (await db.collection("pick_tasks").doc(pickTaskId).get()).data() ?? {};
    assert.deepEqual([tarefa.exception_count, tarefa.blocked_reason], [0, null]);
    const [aMenos] = await eventos("picking.short_picked");
    assert.deepEqual(aMenos.payload.resolved_exception_ids, ["wex-1"]);
  });

  it("cancelar depois da separação a menos devolve à posição só o que foi separado", async () => {
    const { orderId, pickTaskId, linhaPolo, linhaBone } = await pedidoEmSeparacao();
    await separar(pickTaskId, [
      { pick_line_id: linhaPolo, qty_picked: 3, shortage_reason: "falta" },
      { pick_line_id: linhaBone, qty_picked: 4 },
    ]);

    const cancelado = await cancelWarehouseOrderTransaction(
      db,
      { order_id: orderId, reason: "O cliente desistiu do evento.", idempotency_key: "cancelar-1234" },
      coordenacao,
    );
    assert.deepEqual([cancelado.released_qty, cancelado.returned_qty], [7, 7]);
    assert.deepEqual(
      (cancelado.returns as Array<Record<string, unknown>>).map((item) => [item.sku_code, item.location_id, item.quantity]).sort(),
      [[BONE, "A-02", 4], [POLO, "A-01", 3]],
    );
    assert.deepEqual(await saldos(), {
      [`${POLO}@A-01`]: [2, 0, 2],
      [`${BONE}@A-02`]: [0, 0, 0],
      [`${POLO}@EXPEDICAO`]: [3, 0, 3],
      [`${BONE}@EXPEDICAO`]: [4, 0, 4],
    });
  });
});
