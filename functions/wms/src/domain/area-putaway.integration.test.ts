import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

import { openAreaPutaway, previewAreaPutaway } from "./area-putaway.js";
import { advanceWarehouseTaskTransaction, createInventoryMovementTransaction, type OperationalActor } from "./operations.js";

/**
 * A ação "Guardar" no Estoque (docs/plataforma/recebimento-com-caixas.md,
 * decisão 16 e parte 7e), com as transações de verdade no emulador: a
 * coordenação abre a guarda do saldo parado numa área de passagem, só do que
 * nenhuma guarda aberta vai tirar dali, e a guarda segue a de hoje até a
 * prateleira, quando as peças passam ao disponível do portal.
 */

const PROJECT_ID = "demo-dute-operations";
const BTG = "BTG Pactual";
const OUTRO = "Outro Cliente";
const SKU = "BTG-AREA-1";
const PORTAL = `cinv_BTG_Pactual__${SKU}`;
const coordenacao: OperationalActor = { uid: "coord-1", email: "coord@dutelog.com.br", name: "Mariana Lopes", role: "interno", customer_code: "Dutelog" };
const armazem: OperationalActor = { uid: "wms-1", email: "wms@dutelog.com.br", name: "Rafael", role: "wms", customer_code: "Dutelog" };
const FROZEN = { code: "failed-precondition", message: "Movimentações de estoque estão temporariamente bloqueadas para reconciliação." };

let db: Firestore;
let app: ReturnType<typeof initializeApp>;

before(() => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST, "Execute este teste pelo Firebase Emulator.");
  app = initializeApp({ projectId: PROJECT_ID }, `area-putaway-${Date.now()}`);
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
    db.collection("products").doc("POLO-P").set({ id: "POLO-P", customer_code: BTG, cod_cliente: "POLO-P", produto: "Camiseta polo P", status: "active" }),
    db.collection("skus").doc(SKU).set({ id: SKU, customer_code: BTG, cod_cliente: "POLO-P", cod_btg: SKU, sku_code: SKU, produto: "Camiseta polo P", status: "active" }),
    db.collection("warehouse_positions").doc("A-01").set({ code: "A-01", aisle: "A", shelf: 1, sequence: 1, length_m: 1.8, depth_m: 0.75, height_m: 0.5, customer_code: BTG, status: "active" }),
    db.collection("client_inventory").doc(PORTAL).set({
      id: PORTAL,
      customer_code: BTG,
      sku_code: SKU,
      client_item_code: "POLO-P",
      product_name: "Camiseta polo P",
      qty_on_hand: 0,
      qty_reserved: 0,
      qty_available: 0,
      qty_receiving: 0,
      status: "active",
    }),
  ]);
  // A contagem achou 30 no RECEBIMENTO: a entrada manual não abre guarda.
  await createInventoryMovementTransaction(
    db,
    { customer_code: BTG, type: "ENTRADA", quantity: 30, sku_code: SKU, client_item_code: "POLO-P", product_name: "Camiseta polo P", location_id: "RECEBIMENTO", reason: "Contagem achou no RECEBIMENTO", idempotency_key: "entrada-1" },
    coordenacao,
  );
});

const preview = (extra: Record<string, unknown> = {}) =>
  previewAreaPutaway(db, { customer_code: BTG, sku_code: SKU, location_id: "RECEBIMENTO", ...extra });
const open = (quantity: number, key = `abrir-${quantity}`, extra: Record<string, unknown> = {}) =>
  openAreaPutaway(db, { customer_code: BTG, sku_code: SKU, location_id: "RECEBIMENTO", quantity, reason: "Contagem achou no RECEBIMENTO", idempotency_key: key, ...extra }, coordenacao);

async function tasks() {
  return (await db.collection("putaway_tasks").where("source", "==", "wms_area_putaway").get()).docs.map((doc) => doc.data());
}

describe("a ação Guardar no Estoque (recebimento com caixas, parte 7e)", () => {
  it("abre a guarda só do que está sem guarda, e a guarda segue a de hoje até a prateleira", async () => {
    // Uma guarda por linha de uma chegada e uma caixa ainda vão tirar 10 do RECEBIMENTO.
    await db.collection("putaway_tasks").doc("put_linha").set({ id: "put_linha", customer_code: BTG, sku_code: SKU, source_location_id: "RECEBIMENTO", quantity: 6, status: "planned" });
    await db.collection("putaway_tasks").doc("put_box_1").set({ id: "put_box_1", customer_code: BTG, box_code: "CX-000001", sku_codes: [SKU], lines: [{ sku_code: SKU, counted_qty: 4 }], quantity: 4, status: "planned" });
    // A guarda de outro cliente com o mesmo código não conta.
    await db.collection("putaway_tasks").doc("put_outro").set({ id: "put_outro", customer_code: OUTRO, sku_code: SKU, source_location_id: "RECEBIMENTO", quantity: 30, status: "planned" });
    assert.deepEqual(await preview(), {
      customer_code: BTG,
      sku_code: SKU,
      location_id: "RECEBIMENTO",
      area: "RECEBIMENTO",
      product_name: "Camiseta polo P",
      client_item_code: "POLO-P",
      livre: 30,
      em_guardas_abertas: 10,
      sem_guarda: 20,
    });

    await assert.rejects(open(21), {
      code: "failed-precondition",
      message: "No RECEBIMENTO há 20 un. de Camiseta polo P sem guarda; a guarda pedida é de 21.",
    });
    assert.equal((await tasks()).length, 0);

    const caixaDoAgente = (await db.collection("ai_agent_inbox").get()).size;
    const aberta = await open(20, "abrir-20");
    const taskId = String(aberta.putaway_task_id);
    assert.match(taskId, /^put_area_[0-9a-f]{32}$/);
    assert.deepEqual([aberta.quantity, aberta.sem_guarda], [20, 0]);
    const [task, ...outras] = await tasks();
    assert.equal(outras.length, 0);
    assert.deepEqual(
      [task!.customer_code, task!.sku_code, task!.client_item_code, task!.source_location_id, task!.quantity, task!.status, task!.reason, task!.destination_location_id],
      [BTG, SKU, "POLO-P", "RECEBIMENTO", 20, "planned", "Contagem achou no RECEBIMENTO", undefined],
    );
    const [evento] = (await db.collection("events").where("type", "==", "warehouse.area_putaway_opened").get()).docs.map((doc) => doc.data());
    assert.deepEqual([evento!.severity, evento!.customer_code, evento!.entity_id, evento!.payload.quantity, evento!.payload.reason], ["info", BTG, taskId, 20, "Contagem achou no RECEBIMENTO"]);
    assert.doesNotMatch(JSON.stringify(evento), /cost|valor|preco/);
    assert.equal((await db.collection("ai_agent_inbox").get()).size, caixaDoAgente, "a guarda aberta não vai à caixa do agente");
    assert.equal((await preview()).sem_guarda, 0);

    // A mesma chave devolve o mesmo, sem segunda guarda; com outro conteúdo, recusa.
    assert.deepEqual(await open(20, "abrir-20"), aberta);
    assert.equal((await tasks()).length, 1);
    await assert.rejects(open(19, "abrir-20"), { code: "already-exists" });

    // A guarda de hoje leva as 20 à prateleira, e o portal passa a contá-las.
    await advanceWarehouseTaskTransaction(
      db,
      { task_uid: `putaway:${taskId}`, expected_status: "planned", operation: { destination_location_id: "A-01", quantity: 20 }, idempotency_key: "guardar-20" },
      armazem,
    );
    const saldos = (await db.collection("stock_balances").where("sku_code", "==", SKU).get()).docs
      .map((doc) => [doc.get("location_id"), doc.get("qty_on_hand")])
      .sort();
    assert.deepEqual(saldos, [["A-01", 20], ["RECEBIMENTO", 10]]);
    const portal = (await db.collection("client_inventory").doc(PORTAL).get()).data() ?? {};
    assert.deepEqual([portal.qty_available, portal.qty_receiving], [20, 10]);
  });

  it("o recibo da guarda aberta fica em operational_operations, com os outros recibos do WMS", async () => {
    const aberta = await open(5, "recibo-5");
    const task = (await db.collection("putaway_tasks").doc(String(aberta.putaway_task_id)).get()).data() ?? {};
    const recibo = await db.collection("operational_operations").doc(String(task.created_from_operation_id)).get();
    assert.equal(recibo.exists, true, "o recibo não está em operational_operations");
    assert.deepEqual(
      [recibo.get("kind"), recibo.get("target_id"), recibo.get("status"), recibo.get("customer_code"), recibo.get("actor")?.uid],
      ["warehouse.area_putaway.open", aberta.putaway_task_id, "completed", BTG, coordenacao.uid],
    );
    assert.equal((await db.collection("operations").get()).size, 0, "nenhum recibo na coleção operations");
  });

  it("a chave repetida com o recibo antigo em operations não abre uma segunda guarda", async () => {
    const aberta = await open(5, "antes-da-correcao");
    const opId = String((await db.collection("putaway_tasks").doc(String(aberta.putaway_task_id)).get()).get("created_from_operation_id"));
    // Como ficou a guarda aberta antes da correção: o recibo só em operations.
    const recibo = (await db.collection("operational_operations").doc(opId).get()).data() ?? {};
    await db.collection("operations").doc(opId).set(recibo);
    await db.collection("operational_operations").doc(opId).delete();
    // A guarda tem o id tirado do recibo: a segunda criação é recusada, e nada muda.
    await assert.rejects(open(5, "antes-da-correcao"), { code: 6 }); // ALREADY_EXISTS
    assert.equal((await tasks()).length, 1);
    assert.equal((await db.collection("events").where("type", "==", "warehouse.area_putaway_opened").get()).size, 1);
    assert.equal((await preview()).sem_guarda, 25);
  });

  it("na EXPEDICAO, só o livre: o reservado do pedido não se guarda", async () => {
    await db.collection("stock_balances").doc("bal-expedicao").set({ id: "bal-expedicao", customer_code: BTG, sku_code: SKU, client_item_code: "POLO-P", product_name: "Camiseta polo P", location_id: "EXPEDICAO", qty_on_hand: 5, qty_reserved: 3, qty_available: 2 });
    const conta = await preview({ location_id: "EXPEDICAO" });
    assert.deepEqual([conta.area, conta.livre, conta.em_guardas_abertas, conta.sem_guarda], ["EXPEDICAO", 2, 0, 2]);
    await assert.rejects(open(3, "expedicao-3", { location_id: "EXPEDICAO" }), { message: "No EXPEDICAO há 2 un. de Camiseta polo P sem guarda; a guarda pedida é de 3." });
    const aberta = await open(2, "expedicao-2", { location_id: "EXPEDICAO" });
    assert.equal((await db.collection("putaway_tasks").doc(String(aberta.putaway_task_id)).get()).get("source_location_id"), "EXPEDICAO");
    // Aberta, ela conta: nada mais fica sem guarda na EXPEDICAO.
    const depois = await preview({ location_id: "EXPEDICAO" });
    assert.deepEqual([depois.em_guardas_abertas, depois.sem_guarda], [2, 0]);
    await assert.rejects(open(1, "expedicao-1", { location_id: "EXPEDICAO" }), { message: "No EXPEDICAO há 0 un. de Camiseta polo P sem guarda; a guarda pedida é de 1." });
  });

  it("a volta do pedido cancelado, aberta na EXPEDICAO, já tira as peças dela", async () => {
    await db.collection("stock_balances").doc("bal-expedicao").set({ id: "bal-expedicao", customer_code: BTG, sku_code: SKU, client_item_code: "POLO-P", product_name: "Camiseta polo P", location_id: "EXPEDICAO", qty_on_hand: 3, qty_reserved: 0, qty_available: 3 });
    // Como cancelWarehouseOrderTransaction abre a volta do separado.
    await db.collection("putaway_tasks").doc("put_volta").set({ id: "put_volta", customer_code: BTG, order_id: "ped-1", sku_code: SKU, source_location_id: "EXPEDICAO", quantity: 3, total_units: 3, status: "planned", source: "wms_order_cancel" });
    const conta = await preview({ location_id: "EXPEDICAO" });
    assert.deepEqual([conta.livre, conta.em_guardas_abertas, conta.sem_guarda], [3, 3, 0]);
    await assert.rejects(open(1, "volta-cancelada-1", { location_id: "EXPEDICAO" }), { code: "failed-precondition" });
  });

  it("o resto de ponto flutuante do saldo não abre uma guarda que a guarda recusaria", async () => {
    const SKU2 = "BTG-AREA-2";
    await Promise.all([
      db.collection("products").doc("POLO-G").set({ id: "POLO-G", customer_code: BTG, cod_cliente: "POLO-G", produto: "Camiseta polo G", status: "active" }),
      db.collection("skus").doc(SKU2).set({ id: SKU2, customer_code: BTG, cod_cliente: "POLO-G", cod_btg: SKU2, sku_code: SKU2, produto: "Camiseta polo G", status: "active" }),
    ]);
    await createInventoryMovementTransaction(
      db,
      { customer_code: BTG, type: "ENTRADA", quantity: 0.3, sku_code: SKU2, client_item_code: "POLO-G", product_name: "Camiseta polo G", location_id: "RECEBIMENTO", reason: "Contagem achou no RECEBIMENTO", idempotency_key: "entrada-fracionada" },
      coordenacao,
    );
    const guardar = async (quantity: number, key: string) => {
      const aberta = await openAreaPutaway(db, { customer_code: BTG, sku_code: SKU2, location_id: "RECEBIMENTO", quantity, reason: "Resto da contagem", idempotency_key: key }, coordenacao);
      const task = (await db.collection("putaway_tasks").doc(String(aberta.putaway_task_id)).get()).data() ?? {};
      await advanceWarehouseTaskTransaction(
        db,
        { task_uid: `putaway:${aberta.putaway_task_id}`, expected_status: "planned", operation: { destination_location_id: "A-01", quantity: Number(task.quantity) }, idempotency_key: `guardar-${key}` },
        armazem,
      );
    };
    await guardar(0.1, "fracionada-1");
    // 0,3 − 0,1 deixa 0,19999… no RECEBIMENTO: o diálogo mostra 0,2, e a guarda de 0,2 conclui.
    const conta = await previewAreaPutaway(db, { customer_code: BTG, sku_code: SKU2, location_id: "RECEBIMENTO" });
    assert.equal(conta.sem_guarda, 0.2);
    await guardar(0.2, "fracionada-2");
    const recebimento = (await db.collection("stock_balances").where("sku_code", "==", SKU2).where("location_id", "==", "RECEBIMENTO").get()).docs[0]!;
    assert.equal(recebimento.get("qty_on_hand"), 0);
  });

  it("recusa a prateleira, o saldo de outro cliente, o motivo vazio e, com o estoque congelado, não abre nada", async () => {
    await assert.rejects(open(1, "prateleira", { location_id: "A-01" }), {
      code: "failed-precondition",
      message: "O local A-01 não é uma área de passagem: o saldo dele já está guardado.",
    });
    await assert.rejects(open(1, "outro-cliente", { customer_code: OUTRO }), {
      code: "failed-precondition",
      message: `Saldo não encontrado para SKU ${SKU} no local RECEBIMENTO.`,
    });
    await assert.rejects(open(1, "sem-motivo", { reason: " " }), { code: "invalid-argument", message: "Informe o motivo da guarda." });
    // A quantidade que some em três casas não abre a guarda sem teto.
    await assert.rejects(open(0.0001, "quase-zero"), { code: "invalid-argument", message: "Informe a quantidade da guarda." });
    await assert.rejects(openAreaPutaway(db, { sku_code: SKU, location_id: "RECEBIMENTO", quantity: 1, reason: "Sem cliente", idempotency_key: "sem-cliente" }, coordenacao), {
      code: "invalid-argument",
      message: "Campo inválido: customer_code.",
    });
    await db.collection("system_controls").doc("inventory").set({ movements_frozen: true });
    await assert.rejects(open(1, "congelado"), FROZEN);
    assert.equal((await tasks()).length, 0);
    assert.equal((await db.collection("events").where("type", "==", "warehouse.area_putaway_opened").get()).size, 0);
  });
});
