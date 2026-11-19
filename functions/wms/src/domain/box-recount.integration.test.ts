import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type DocumentData, type Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";

import { billingMovementDirection } from "./billing-scope.js";
import { BOX_RECOUNT_EVENT_TYPE, entradaDaRecontagem, recountWarehouseBoxTransaction } from "./box-recount.js";
import { LEGACY_ROUND_ID, completeCountRoundTransaction, entradaDaConclusao, entradaDoInicio, startCountRoundTransaction } from "./count-rounds.js";
import { lerDatasDoEstoque } from "./datas-do-estoque.js";
import {
  clientScopedInventoryId,
  createCustomerRequestTransaction,
  decideCustomerRequestTransaction,
  type OperationalActor,
} from "./operations.js";
import { setPickLineSeparated } from "./pick-progress.js";
import { saldoDaCaixa } from "./saldo-da-caixa.js";

/**
 * Recontar uma caixa (contagem por caixa, diagnóstico da Contagem cíclica,
 * seção 6, item 4), no emulador. Antes, a aba cíclica corrigia o saldo da
 * prateleira e deixava a caixa como estava (achados F01, F05 e G07): a
 * etiqueta, o Mapa e a separação continuavam com o número velho.
 *
 * A-03 tem quatro caixas da BTG: CX-000010 (abertura, 60 polos P), CX-000011
 * e CX-000012 (abertura, 60 polos M cada) e CX-000014 (recebimento, 50 polos
 * GG na própria caixa). O saldo da prateleira bate com elas.
 */

const PROJECT_ID = "demo-dute-operations";
const BTG = "BTG Pactual";
const POLO_P = "BTG-000122";
const POLO_M = "BTG-000123";
const POLO_GG = "BTG-000125";
const BONE = "BTG-000200";

const guilherme: OperationalActor = { uid: "wms-1", email: "guilherme@dutelog.com.br", name: "Guilherme Dantas", role: "wms", customer_code: "Dutelog" };
const rafael: OperationalActor = { uid: "wms-2", email: "rafael@dutelog.com.br", name: "Rafael", role: "wms", customer_code: "Dutelog" };
const coordenacao: OperationalActor = { uid: "coord-1", email: "coord@dutelog.com.br", name: "Mariana Lopes", role: "interno", customer_code: "Dutelog" };
const cliente: OperationalActor = { uid: "client-1", email: "compras@btg.com.br", name: "Compras BTG", role: "cliente", customer_code: BTG };

let db: Firestore;
let app: ReturnType<typeof initializeApp>;

before(() => {
  app = initializeApp({ projectId: PROJECT_ID }, "box-recount-test");
  db = getFirestore(app);
});

after(async () => {
  await deleteApp(app);
});

const NOMES: Record<string, { cod_cliente: string; produto: string; tamanho: string }> = {
  [POLO_P]: { cod_cliente: "A.01.0806.005.P", produto: "Polo Masculino Piquet Preto", tamanho: "P" },
  [POLO_M]: { cod_cliente: "A.01.0806.005.M", produto: "Polo Masculino Piquet Preto", tamanho: "M" },
  [POLO_GG]: { cod_cliente: "A.01.0806.005.GG", produto: "Polo Masculino Piquet Preto", tamanho: "GG" },
  [BONE]: { cod_cliente: "C.0900.001.U", produto: "Boné Preto", tamanho: "U" },
};

function cadastro(sku: string, extra: Record<string, unknown> = {}) {
  const nome = NOMES[sku]!;
  return Promise.all([
    db.collection("skus").doc(sku).set({ id: sku, customer_code: BTG, cod_btg: sku, sku_code: sku, sku_code_key: sku, cod_cliente: nome.cod_cliente, cod_cliente_key: nome.cod_cliente, produto: nome.produto, tamanho: nome.tamanho, status: "active", estoque_atual: 0, ...extra }),
    db.collection("products").doc(nome.cod_cliente).set({ id: nome.cod_cliente, customer_code: BTG, cod_cliente: nome.cod_cliente, cod_cliente_key: nome.cod_cliente, produto: nome.produto, status: "active", estoque_btg: 0, ...extra }),
  ]);
}

function saldoNaPrateleira(sku: string, location: string, qty: number, extra: Record<string, unknown> = {}) {
  const id = `bal_${sku}_${location}`;
  const nome = NOMES[sku]!;
  return db.collection("stock_balances").doc(id).set({
    id,
    customer_code: BTG,
    sku_code: sku,
    client_item_code: nome.cod_cliente,
    product_name: nome.produto,
    size: nome.tamanho,
    location_id: location,
    qty_on_hand: qty,
    qty_reserved: 0,
    qty_available: qty,
    status: "available",
    ...extra,
  });
}

function projecao(sku: string, qty: number) {
  return db.collection("client_inventory").doc(clientScopedInventoryId(BTG, sku)).set({ customer_code: BTG, sku_code: sku, qty_on_hand: qty, qty_reserved: 0, qty_available: qty, qty_receiving: 0 });
}

function caixaDaAbertura(code: string, location: string, storedAt: string, linhas: Array<[string, number]>, extra: Record<string, unknown> = {}) {
  const unidades = linhas.reduce((soma, [, qty]) => soma + qty, 0);
  return Promise.all([
    db.collection("warehouse_boxes").doc(code).set({
      id: code,
      code,
      customer_code: BTG,
      status: "stored",
      location_id: location,
      stored_at: storedAt,
      unit_count: unidades,
      line_count: linhas.length,
      sku_codes: linhas.map(([sku]) => sku),
      origin: { kind: "opening_inventory", session_id: "opening_BTG_Pactual" },
      ...extra,
    }),
    ...linhas.map(([sku, qty]) =>
      db
        .collection("opening_inventory_lines")
        .doc(`oil_${code}_${sku}`)
        .set({ session_id: "opening_BTG_Pactual", customer_code: BTG, sku_code: sku, client_item_code: NOMES[sku]!.cod_cliente, product_name: NOMES[sku]!.produto, size: NOMES[sku]!.tamanho, location_id: location, box_code: code, counted_qty: qty, status: "counted" }),
    ),
  ]);
}

beforeEach(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error("FIRESTORE_EMULATOR_HOST não definido.");
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
  const posicao = (code: string, shelf: number) =>
    db.collection("warehouse_positions").doc(code).set({ code, aisle: code.split("-")[0], shelf, sequence: shelf, length_m: 1.8, depth_m: 0.75, height_m: 0.65, customer_code: BTG, status: "active" });
  await Promise.all([
    db.collection("customers").doc("BTG_Pactual").set({ code: BTG, customer_code: BTG, name: BTG, sku_prefix: "BTG", status: "active" }),
    posicao("A-03", 3),
    posicao("A-04", 4),
    cadastro(POLO_P),
    cadastro(POLO_M),
    cadastro(POLO_GG),
    caixaDaAbertura("CX-000010", "A-03", "2026-10-20T12:00:00.000Z", [[POLO_P, 60]]),
    caixaDaAbertura("CX-000011", "A-03", "2026-10-20T13:00:00.000Z", [[POLO_M, 60]]),
    caixaDaAbertura("CX-000012", "A-03", "2026-10-20T14:00:00.000Z", [[POLO_M, 60]]),
    db.collection("warehouse_boxes").doc("CX-000014").set({
      id: "CX-000014",
      code: "CX-000014",
      customer_code: BTG,
      status: "stored",
      location_id: "A-03",
      stored_at: "2026-11-06T15:00:00.000Z",
      unit_count: 50,
      line_count: 1,
      sku_codes: [POLO_GG],
      origin: { kind: "receipt", receipt_id: "inb_1", invoice_number: "48.377" },
      lines: [{ inbound_item_id: "ini_1", line_number: 1, sku_code: POLO_GG, client_item_code: NOMES[POLO_GG]!.cod_cliente, product_name: NOMES[POLO_GG]!.produto, size: "GG", counted_qty: 50 }],
    }),
    saldoNaPrateleira(POLO_P, "A-03", 60),
    saldoNaPrateleira(POLO_M, "A-03", 120),
    saldoNaPrateleira(POLO_GG, "A-03", 50),
    projecao(POLO_P, 60),
    projecao(POLO_M, 120),
    projecao(POLO_GG, 50),
  ]);
});

let chaves = 0;
function chave(prefixo = "recontar") {
  chaves += 1;
  return `${prefixo}-${String(chaves).padStart(6, "0")}`;
}

type Resultado = Record<string, unknown> & {
  box_recount_id: string;
  status: string;
  difference_units: number;
  shelf_delta_units: number;
  lines: Array<Record<string, unknown>>;
  cycle_count_ids: string[];
  movement_ids: string[];
};

function recontar(entrada: Record<string, unknown>, ator: OperationalActor = guilherme) {
  return recountWarehouseBoxTransaction(
    db,
    entradaDaRecontagem({ customer_code: BTG, location_id: "A-03", idempotency_key: chave(), ...entrada }),
    ator,
  ) as Promise<Resultado>;
}

async function recusa(acao: Promise<unknown>): Promise<HttpsError> {
  try {
    await acao;
  } catch (error) {
    assert.ok(error instanceof HttpsError, String(error));
    return error;
  }
  assert.fail("a recontagem passou");
}

function codigoDa(erro: HttpsError): unknown {
  return (erro.details as { code?: unknown } | undefined)?.code;
}

async function caixa(code: string): Promise<DocumentData> {
  return (await db.collection("warehouse_boxes").doc(code).get()).data() ?? {};
}

async function saldo(sku: string, location = "A-03") {
  const rows = await db.collection("stock_balances").where("customer_code", "==", BTG).where("sku_code", "==", sku).where("location_id", "==", location).get();
  return rows.docs.map((doc) => doc.data());
}

async function todos(colecao: string) {
  return (await db.collection(colecao).get()).docs.map((doc) => ({ id: doc.id, ...doc.data() }) as Record<string, unknown>);
}

async function eventos(tipo: string) {
  return (await todos("events")).filter((evento) => evento.type === tipo);
}

/** O saldo de um item numa caixa, pela regra: a entrada (as linhas da abertura ou as da caixa) menos o retirado mais os ajustes. */
async function saldoNaCaixa(code: string, sku: string) {
  const box = await caixa(code);
  const proprias = Array.isArray(box.lines) ? (box.lines as Array<Record<string, unknown>>) : [];
  const abertura = (await db.collection("opening_inventory_lines").where("box_code", "==", code).get()).docs.map((doc) => doc.data());
  const entrada = (proprias.length ? proprias : abertura).map((linha) => ({ sku_code: String(linha.sku_code), qty: Number(linha.counted_qty) }));
  const saldo = saldoDaCaixa(entrada, (box.taken_lines as never[]) ?? [], (box.count_adjustments as never[]) ?? []);
  return saldo.find((linha) => linha.sku_code === sku)?.qty ?? 0;
}

describe("Recontar a caixa: a caixa e a prateleira na mesma transação", () => {
  it("a caixa da abertura: a falta acerta a caixa e o saldo da prateleira juntos, com o movimento da contagem, o portal, o cycle_counts e o evento", async () => {
    const resultado = await recontar({ box_code: "CX-000012", lines: [{ sku_code: POLO_M, counted_qty: 48 }], reason: "Recontagem geral 17/11" });
    assert.deepEqual([resultado.status, resultado.difference_units, resultado.shelf_delta_units], ["stored", -12, -12]);

    // A caixa guarda o ajuste com o id da contagem; a entrada e o retirado ficam como estavam.
    const box = await caixa("CX-000012");
    assert.deepEqual(
      (box.count_adjustments as Array<Record<string, unknown>>).map((ajuste) => [ajuste.recount_id, ajuste.sku_code, ajuste.qty]),
      [[resultado.box_recount_id, POLO_M, -12]],
    );
    assert.equal(box.unit_count, 60);
    assert.equal(box.taken_lines, undefined);
    assert.deepEqual([box.last_recount_id, box.last_recounted_by.name, box.balance_at === box.last_recounted_at], [resultado.box_recount_id, "Guilherme Dantas", true]);
    assert.equal((await db.collection("opening_inventory_lines").doc(`oil_CX-000012_${POLO_M}`).get()).get("counted_qty"), 60);

    // O razão: o saldo da prateleira e o movimento da contagem cíclica, fora da cobrança.
    const [prateleira] = await saldo(POLO_M);
    assert.deepEqual([prateleira!.qty_on_hand, prateleira!.qty_available, prateleira!.source], [108, 108, "functions_cycle_count"]);
    const [movimento, ...outros] = await todos("movements");
    assert.equal(outros.length, 0);
    assert.deepEqual(
      [movimento!.tipo_mov, movimento!.quantity, movimento!.qty_before, movimento!.qty_after, movimento!.source, movimento!.box_code, movimento!.box_recount_id, movimento!.reason, movimento!.fifo_day],
      ["SAIDA", 12, 120, 108, "functions_cycle_count", "CX-000012", resultado.box_recount_id, "Recontagem geral 17/11", undefined],
    );
    assert.equal(billingMovementDirection(movimento!, { snapshot: false }), null);
    // O portal do cliente acompanha o total.
    assert.equal((await db.collection("client_inventory").doc(clientScopedInventoryId(BTG, POLO_M)).get()).get("qty_on_hand"), 108);
    // O catálogo acompanha o razão, sem preço.
    assert.equal((await db.collection("skus").doc(POLO_M).get()).get("estoque_atual"), -12);
    assert.equal((await db.collection("catalog_prices").get()).size, 0);

    // Um cycle_counts por item, com a caixa: o esperado e o contado na caixa, e o saldo da prateleira antes e depois.
    const [contagem] = await todos("cycle_counts");
    assert.deepEqual(
      [contagem!.mode, contagem!.box_code, contagem!.location_id, contagem!.qty_before, contagem!.counted_qty, contagem!.adjustment_delta, contagem!.shelf_qty_before, contagem!.shelf_qty_after, contagem!.movement_id],
      ["box", "CX-000012", "A-03", 60, 48, -12, 120, 108, movimento!.id],
    );

    // Um evento por caixa, de atenção: a caixa e a prateleira só no payload.
    const [evento] = await eventos(BOX_RECOUNT_EVENT_TYPE);
    assert.deepEqual([evento!.severity, evento!.title, evento!.entity_type, evento!.entity_id], ["attention", "Caixa recontada com diferença", "box_recount", resultado.box_recount_id]);
    assert.doesNotMatch(`${evento!.title} ${evento!.description}`, /CX-|A-03/);
    const payload = evento!.payload as Record<string, unknown>;
    assert.deepEqual([payload.box_code, payload.location_id, payload.difference_units, payload.counted_units], ["CX-000012", "A-03", -12, 48]);

    // O recibo, e a regra de ouro: as caixas da prateleira somam o saldo dela.
    const recibos = (await todos("operational_operations")).filter((recibo) => recibo.kind === "inventory.box_recount");
    assert.equal(recibos.length, 1);
    assert.equal((await saldoNaCaixa("CX-000011", POLO_M)) + (await saldoNaCaixa("CX-000012", POLO_M)), 108);
  });

  it("a caixa do recebimento: o conteúdo é o dela; a peça achada a mais entra com a data da caixa no FIFO, não a de hoje", async () => {
    const resultado = await recontar({ box_code: "CX-000014", lines: [{ sku_code: POLO_GG, counted_qty: 52 }] });
    assert.deepEqual([resultado.difference_units, resultado.shelf_delta_units], [2, 2]);
    assert.deepEqual(((await caixa("CX-000014")).count_adjustments as Array<Record<string, unknown>>).map((ajuste) => ajuste.qty), [2]);
    const [movimento] = await todos("movements");
    assert.deepEqual([movimento!.tipo_mov, movimento!.quantity, movimento!.fifo_day], ["ENTRADA", 2, "2026-11-06"]);
    assert.equal((await saldo(POLO_GG))[0]!.qty_on_hand, 52);
    // As datas que o portal vê: as 2 peças são da caixa (06/11); o resto, que o razão não data, fica sem data.
    const datas = await lerDatasDoEstoque(db, BTG, POLO_GG);
    assert.deepEqual(datas.datas, [
      { desde: null, pecas: 50 },
      { desde: "2026-11-06", pecas: 2 },
    ]);
  });

  // Decisão de 17/11/2026 (pergunta 1 do PR 618): a peça a mais vale o dia que o FIFO já dá ao conteúdo da caixa.
  it("a caixa da abertura: a peça achada a mais vale o dia da sessão, como o resto da caixa, e não abre data nova no portal", async () => {
    await db.collection("opening_inventory_sessions").doc("opening_BTG_Pactual").set({ id: "opening_BTG_Pactual", customer_code: BTG, status: "completed", started_at: "2026-10-16T12:00:00.000Z" });
    // O conteúdo da abertura entrou pela sessão: o FIFO data as 120 polos M pelo dia em que ela começou.
    await db.collection("movements").doc("mov_abertura_m").set({ customer_code: BTG, sku_code: POLO_M, location_id: "A-03", tipo_mov: "ENTRADA", quantity: 120, source: "functions_opening_inventory", opening_inventory_session_id: "opening_BTG_Pactual", created_at: new Date("2026-10-20T14:00:00.000Z") });
    await recontar({ box_code: "CX-000012", lines: [{ sku_code: POLO_M, counted_qty: 62 }] });
    const movimento = (await todos("movements")).find((item) => item.source === "functions_cycle_count")!;
    assert.deepEqual([movimento.tipo_mov, movimento.quantity, movimento.fifo_opening_session_id], ["ENTRADA", 2, "opening_BTG_Pactual"]);
    // Antes, as 2 peças viravam "desde 20/10" (o stored_at da caixa) ao lado das 120 "desde 16/10".
    const datas = await lerDatasDoEstoque(db, BTG, POLO_M);
    assert.deepEqual(datas.datas, [{ desde: "2026-10-16", pecas: 122 }]);
  });

  it("a caixa aberta pela separação: o esperado é a entrada menos o retirado; sem diferença, só a confirmação", async () => {
    await db.collection("warehouse_boxes").doc("CX-000011").update({ taken_lines: [{ sku_code: POLO_M, qty: 10 }], taken_units: 10, balance_at: "2026-11-12T12:00:00.000Z" });
    const confere = await recontar({ box_code: "CX-000011", lines: [{ sku_code: POLO_M, counted_qty: 50 }] });
    assert.deepEqual([confere.difference_units, confere.shelf_delta_units, confere.movement_ids], [0, 0, []]);
    let box = await caixa("CX-000011");
    // Sem diferença, a caixa não ganha ajuste nem muda o saldo dela (a etiqueta segue valendo).
    assert.deepEqual([box.count_adjustments, box.balance_at, box.last_recount_id], [undefined, "2026-11-12T12:00:00.000Z", confere.box_recount_id]);
    assert.equal((await todos("movements")).length, 0);
    const [evento] = await eventos(BOX_RECOUNT_EVENT_TYPE);
    assert.deepEqual([evento!.severity, evento!.title], ["info", "Caixa recontada sem diferença"]);
    assert.equal((await todos("cycle_counts"))[0]!.adjustment_type, "SEM_DIVERGENCIA");

    // Contar a menos acerta a partir do saldo, não da entrada.
    const falta = await recontar({ box_code: "CX-000011", lines: [{ sku_code: POLO_M, counted_qty: 47 }] });
    assert.equal(falta.difference_units, -3);
    box = await caixa("CX-000011");
    assert.deepEqual([box.taken_units, (box.count_adjustments as Array<Record<string, unknown>>).map((ajuste) => ajuste.qty)], [10, [-3]]);
    assert.equal((await saldo(POLO_M))[0]!.qty_on_hand, 117);
  });

  it("o item fora da lista com saldo noutra caixa da prateleira: sai dela, e o saldo da prateleira não muda", async () => {
    const resultado = await recontar({ box_code: "CX-000012", lines: [{ sku_code: POLO_M, counted_qty: 60 }], extra_lines: [{ sku_code: POLO_GG, counted_qty: 2 }] });
    assert.deepEqual([resultado.difference_units, resultado.shelf_delta_units, resultado.movement_ids], [2, 0, []]);
    const achou = await caixa("CX-000012");
    const [ajuste] = achou.count_adjustments as Array<Record<string, unknown>>;
    assert.deepEqual([ajuste!.sku_code, ajuste!.qty, ajuste!.moved_from, ajuste!.product_name, ajuste!.size], [POLO_GG, 2, [{ box_code: "CX-000014", qty: 2 }], "Polo Masculino Piquet Preto", "GG"]);
    assert.ok((achou.sku_codes as string[]).includes(POLO_GG));
    const cedeu = await caixa("CX-000014");
    assert.deepEqual((cedeu.count_adjustments as Array<Record<string, unknown>>).map((linha) => [linha.sku_code, linha.qty, linha.moved_to, linha.recount_id]), [[POLO_GG, -2, "CX-000012", resultado.box_recount_id]]);
    // A prateleira e o portal ficam como estavam: a peça só mudou de caixa.
    assert.equal((await saldo(POLO_GG))[0]!.qty_on_hand, 50);
    assert.equal((await todos("movements")).length, 0);
    assert.equal((await saldoNaCaixa("CX-000012", POLO_GG)) + (await saldoNaCaixa("CX-000014", POLO_GG)), 50);
    const payload = (await eventos(BOX_RECOUNT_EVENT_TYPE))[0]!.payload as { items: Array<Record<string, unknown>> };
    // A resposta e o evento dizem de onde veio cada peça.
    assert.deepEqual(resultado.lines.find((linha) => linha.sku_code === POLO_GG)?.origins, [{ kind: "box", box_code: "CX-000014", qty: 2 }]);
    assert.deepEqual(payload.items.find((item) => item.sku_code === POLO_GG)?.origins, [{ kind: "box", box_code: "CX-000014", qty: 2 }]);
  });

  it("o item fora da lista sem saldo em caixa nenhuma entra na prateleira, com a data da caixa; o produto arquivado volta a ativo", async () => {
    await cadastro(BONE, { archived: true, status: "archived" });
    const resultado = await recontar({ box_code: "CX-000010", lines: [{ sku_code: POLO_P, counted_qty: 60 }], extra_lines: [{ sku_code: BONE, counted_qty: 2 }] });
    assert.deepEqual([resultado.difference_units, resultado.shelf_delta_units, resultado.reactivated_skus], [2, 2, [BONE]]);
    const [prateleira] = await saldo(BONE);
    assert.deepEqual([prateleira!.qty_on_hand, prateleira!.product_name, prateleira!.client_item_code], [2, "Boné Preto", "C.0900.001.U"]);
    const [movimento] = await todos("movements");
    assert.deepEqual([movimento!.tipo_mov, movimento!.quantity, movimento!.fifo_day, movimento!.movement_kind], ["ENTRADA", 2, "2026-10-20", "box_recount_out_of_list"]);
    assert.equal((await db.collection("client_inventory").doc(clientScopedInventoryId(BTG, BONE)).get()).get("qty_on_hand"), 2);
    // O cadastro arquivado volta a ativo, como na abertura.
    const sku = (await db.collection("skus").doc(BONE).get()).data()!;
    assert.deepEqual([sku.archived, sku.status, sku.reactivated_by_recount_id], [false, "active", resultado.box_recount_id]);
    assert.equal((await db.collection("products").doc("C.0900.001.U").get()).get("status"), "active");
    // A origem fica no evento: entrou na prateleira, sem vir de outra caixa.
    const item = ((await eventos(BOX_RECOUNT_EVENT_TYPE))[0]!.payload as { items: Array<Record<string, unknown>> }).items.find((linha) => linha.sku_code === BONE)!;
    assert.deepEqual([item.out_of_list, item.shelf_delta, item.origins], [true, 2, [{ kind: "entry", qty: 2 }]]);
  });

  // Decisão de 17/11/2026 (pergunta 2 do PR 618): o saldo solto vem antes das outras caixas.
  it("o fora da lista consome primeiro o saldo da prateleira que nenhuma caixa cobre, sem mexer na prateleira nem nas outras caixas", async () => {
    // A A-03 tem 53 polos GG no razão e 50 na CX-000014: 3 sem caixa.
    await db.collection("stock_balances").doc(`bal_${POLO_GG}_A-03`).update({ qty_on_hand: 53, qty_available: 53 });
    const resultado = await recontar({ box_code: "CX-000012", lines: [{ sku_code: POLO_M, counted_qty: 60 }], extra_lines: [{ sku_code: POLO_GG, counted_qty: 2 }] });
    // Antes, a peça saía da CX-000014, que ficava com sobra falsa, e o "sem caixa" continuava.
    assert.deepEqual(resultado.lines.find((linha) => linha.sku_code === POLO_GG)?.origins, [{ kind: "loose", qty: 2 }]);
    assert.deepEqual([resultado.shelf_delta_units, resultado.movement_ids], [0, []]);
    assert.equal((await caixa("CX-000014")).count_adjustments, undefined);
    const [ajuste] = (await caixa("CX-000012")).count_adjustments as Array<Record<string, unknown>>;
    assert.deepEqual([ajuste!.sku_code, ajuste!.qty, ajuste!.from_loose, ajuste!.moved_from], [POLO_GG, 2, 2, undefined]);
    assert.equal((await saldo(POLO_GG))[0]!.qty_on_hand, 53);
    // Sobra 1 sem caixa: a regra de ouro fecha mais perto.
    assert.equal(53 - (await saldoNaCaixa("CX-000012", POLO_GG)) - (await saldoNaCaixa("CX-000014", POLO_GG)), 1);
  });

  it("o saldo solto não basta: as outras caixas completam, e só o resto entra na prateleira; a resposta diz cada origem", async () => {
    // A A-03 tem 61 polos P no razão e 60 na CX-000010: 1 sem caixa. A CX-000012 achou 63 polos P.
    await db.collection("stock_balances").doc(`bal_${POLO_P}_A-03`).update({ qty_on_hand: 61, qty_available: 61 });
    const resultado = await recontar({ box_code: "CX-000012", lines: [{ sku_code: POLO_M, counted_qty: 60 }], extra_lines: [{ sku_code: POLO_P, counted_qty: 63 }] });
    const linha = resultado.lines.find((item) => item.sku_code === POLO_P)!;
    assert.deepEqual(linha.origins, [
      { kind: "loose", qty: 1 },
      { kind: "box", box_code: "CX-000010", qty: 60 },
      { kind: "entry", qty: 2 },
    ]);
    assert.deepEqual([linha.difference, linha.shelf_delta, resultado.shelf_delta_units], [63, 2, 2]);
    assert.equal((await saldo(POLO_P))[0]!.qty_on_hand, 63);
    // A CX-000010 cedeu tudo e segue guardada, com saldo zero, até alguém contá-la vazia (pergunta 5).
    const cedeu = await caixa("CX-000010");
    assert.deepEqual([cedeu.status, await saldoNaCaixa("CX-000010", POLO_P)], ["stored", 0]);
    const contagem = (await todos("cycle_counts")).find((item) => item.sku_code === POLO_P)!;
    assert.deepEqual(contagem.origins, linha.origins);
    const [movimento] = await todos("movements");
    assert.deepEqual([movimento!.tipo_mov, movimento!.quantity, movimento!.movement_kind], ["ENTRADA", 2, "box_recount_out_of_list"]);
  });

  // Decisão de 17/11/2026 (pergunta nova do PR 618): a sobra num item da lista também consome antes o saldo solto.
  it("a sobra num item da lista consome primeiro o saldo solto da prateleira, sem tirar de outras caixas; só o que passa dele sobe a prateleira", async () => {
    // A A-03 tem 123 polos M no razão e 60 em cada caixa (CX-000011 e CX-000012): 3 sem caixa.
    await db.collection("stock_balances").doc(`bal_${POLO_M}_A-03`).update({ qty_on_hand: 123, qty_available: 123 });
    const primeira = await recontar({ box_code: "CX-000012", lines: [{ sku_code: POLO_M, counted_qty: 62 }] });
    // Antes, a sobra subia a prateleira para 125 e o "sem caixa" continuava: as 2 peças contavam duas vezes.
    assert.deepEqual(primeira.lines[0]!.origins, [{ kind: "loose", qty: 2 }]);
    assert.deepEqual([primeira.difference_units, primeira.shelf_delta_units, primeira.movement_ids], [2, 0, []]);
    assert.equal((await saldo(POLO_M))[0]!.qty_on_hand, 123);
    const [ajuste] = (await caixa("CX-000012")).count_adjustments as Array<Record<string, unknown>>;
    assert.deepEqual([ajuste!.qty, ajuste!.from_loose], [2, 2]);
    // A outra caixa que lista o item não cede nada: cada caixa é contada por conta própria.
    assert.equal((await caixa("CX-000011")).count_adjustments, undefined);

    // Sobra 1 solto: a próxima sobra o consome, e só o que passa dele sobe a prateleira.
    const segunda = await recontar({ box_code: "CX-000011", lines: [{ sku_code: POLO_M, counted_qty: 63 }] });
    assert.deepEqual(segunda.lines[0]!.origins, [
      { kind: "loose", qty: 1 },
      { kind: "entry", qty: 2 },
    ]);
    assert.deepEqual([segunda.difference_units, segunda.shelf_delta_units], [3, 2]);
    assert.equal((await saldo(POLO_M))[0]!.qty_on_hand, 125);
    const [movimento, ...outros] = await todos("movements");
    assert.deepEqual([outros.length, movimento!.tipo_mov, movimento!.quantity, movimento!.qty_before, movimento!.qty_after], [0, "ENTRADA", 2, 123, 125]);
    // A regra de ouro fecha: as caixas somam o saldo da prateleira.
    assert.equal((await saldoNaCaixa("CX-000011", POLO_M)) + (await saldoNaCaixa("CX-000012", POLO_M)), 125);
    // A falta não mexe no saldo solto: baixa a prateleira, como antes.
    const falta = await recontar({ box_code: "CX-000012", lines: [{ sku_code: POLO_M, counted_qty: 61 }] });
    assert.deepEqual([falta.difference_units, falta.shelf_delta_units, falta.lines[0]!.origins], [-1, -1, undefined]);
  });

  it("na mesma rodada, a caixa já recontada não cede peça ao fora da lista: a peça entra na prateleira", async () => {
    // A rodada é um registro (count-rounds.ts): a recontagem só grava na aberta do cliente.
    const rodada = await startCountRoundTransaction(db, entradaDoInicio({ customer_code: BTG, scope: "general", idempotency_key: chave("rodada") }), guilherme);
    await recontar({ box_code: "CX-000014", lines: [{ sku_code: POLO_GG, counted_qty: 50 }], round_id: rodada.round_id });
    const resultado = await recontar({ box_code: "CX-000012", lines: [{ sku_code: POLO_M, counted_qty: 60 }], extra_lines: [{ sku_code: POLO_GG, counted_qty: 2 }], round_id: rodada.round_id });
    assert.equal(resultado.shelf_delta_units, 2);
    assert.equal((await caixa("CX-000014")).count_adjustments, undefined);
    assert.equal((await saldo(POLO_GG))[0]!.qty_on_hand, 52);
    assert.equal((await caixa("CX-000012")).last_recount_round_id, rodada.round_id);
  });

  it("a separação depois da recontagem tira das caixas pelo que a recontagem deixou", async () => {
    await recontar({ box_code: "CX-000011", lines: [{ sku_code: POLO_M, counted_qty: 50 }] });
    const criado = await createCustomerRequestTransaction(
      db,
      { type: "retirada", priority: "normal", title: "Uniformes", customer_code: BTG, idempotency_key: "pedido-recontagem", items: [{ sku_code: POLO_M, product_name: "Polo Masculino Piquet Preto", quantity: 55 }] },
      cliente,
    );
    const aprovado = (await decideCustomerRequestTransaction(
      db,
      { request_id: String(criado.id), action: "approve", expected_status: "open", idempotency_key: "aprovar-recontagem" },
      coordenacao,
    )) as Record<string, unknown>;
    const pickTaskId = String(aprovado.pick_task_id);
    const [linha] = (await db.collection("pick_lines").where("pick_task_id", "==", pickTaskId).get()).docs;
    const separada = (await setPickLineSeparated(db, { pick_task_id: pickTaskId, pick_line_id: linha!.id, separated: true, idempotency_key: "separar-recontagem" }, guilherme)) as Record<string, unknown>;
    // A CX-000011 tem 50 depois da recontagem (entraram 60): sai inteira com as 50, e a CX-000012 completa.
    assert.deepEqual(separada.boxes, [
      { box_code: "CX-000011", qty: 50, whole: true },
      { box_code: "CX-000012", qty: 5 },
    ]);
    assert.equal((await caixa("CX-000011")).status, "emptied");
  });

  it("a caixa vazia: contado zero em tudo deixa a caixa fora da prateleira, com o evento", async () => {
    const resultado = await recontar({ box_code: "CX-000010", lines: [{ sku_code: POLO_P, counted_qty: 0 }] });
    assert.deepEqual([resultado.status, resultado.emptied, resultado.difference_units], ["emptied", true, -60]);
    const box = await caixa("CX-000010");
    assert.deepEqual([box.status, box.emptied_recount_id, box.emptied_whole, box.emptied_by.name], ["emptied", resultado.box_recount_id, false, "Guilherme Dantas"]);
    const [prateleira] = await saldo(POLO_P);
    assert.deepEqual([prateleira!.qty_on_hand, prateleira!.status], [0, "empty"]);
    const [vazia] = await eventos("warehouse.box_emptied");
    assert.deepEqual([vazia!.title, vazia!.entity_id, vazia!.severity], ["Caixa CX-000010 vazia", "CX-000010", "info"]);
    // A caixa vazia sai do encaixe e do Mapa, que só leem a guardada e a que fecha o destino.
    const naPrateleira = await db.collection("warehouse_boxes").where("location_id", "==", "A-03").where("status", "in", ["stored", "committing"]).get();
    assert.deepEqual(naPrateleira.docs.map((doc) => doc.id).sort(), ["CX-000011", "CX-000012", "CX-000014"]);
    // A caixa vazia não se reconta de novo.
    assert.equal(codigoDa(await recusa(recontar({ box_code: "CX-000010", lines: [] }))), "BOX_RECOUNT_BOX_EMPTIED");
  });
});

describe("Recontar a caixa: as recusas", () => {
  it("abaixo da reserva da prateleira, recusa e nada grava", async () => {
    await db.collection("stock_balances").doc(`bal_${POLO_M}_A-03`).update({ qty_reserved: 115, qty_available: 5 });
    const erro = await recusa(recontar({ box_code: "CX-000012", lines: [{ sku_code: POLO_M, counted_qty: 48 }] }));
    assert.equal(codigoDa(erro), "BOX_RECOUNT_BELOW_RESERVED");
    assert.match(erro.message, /ficaria com 108 un\. de Polo Masculino Piquet Preto · M, menos que a reserva ativa \(115\)/);
    assert.equal((await caixa("CX-000012")).count_adjustments, undefined);
    assert.deepEqual([(await todos("cycle_counts")).length, (await todos("movements")).length, (await saldo(POLO_M))[0]!.qty_on_hand], [0, 0, 120]);
  });

  it("o separado esperando a entrega e a linha já separada recusam: reconte depois da entrega", async () => {
    await db.collection("stock_balances").doc(`bal_${POLO_M}_A-03`).update({ qty_reserved: 5, qty_available: 115 });
    await db.collection("stock_reservations").doc("res_1").set({ customer_code: BTG, sku_code: POLO_M, location_id: "A-03", status: "picked", order_number: "PED-0002", quantity: 5 });
    let erro = await recusa(recontar({ box_code: "CX-000012", lines: [{ sku_code: POLO_M, counted_qty: 60 }] }));
    assert.equal(codigoDa(erro), "BOX_RECOUNT_PICKED_AWAITING_DELIVERY");
    assert.match(erro.message, /pedido PED-0002/);

    await db.collection("stock_reservations").doc("res_1").update({ status: "reserved", order_id: "ord_1", line_number: 1 });
    await db.collection("pick_lines").doc("pli_ord_1_01").set({ status: "open", separated_at: "2026-11-17T12:00:00.000Z", separated_qty: 3 });
    erro = await recusa(recontar({ box_code: "CX-000012", lines: [{ sku_code: POLO_M, counted_qty: 60 }] }));
    assert.equal(codigoDa(erro), "BOX_RECOUNT_LINE_SEPARATED");
    // A linha separada com zero não tirou nada da prateleira: passa.
    await db.collection("pick_lines").doc("pli_ord_1_01").update({ separated_qty: 0 });
    assert.equal((await recontar({ box_code: "CX-000012", lines: [{ sku_code: POLO_M, counted_qty: 60 }] })).difference_units, 0);
  });

  it("o estoque congelado para a recontagem também", async () => {
    await db.collection("system_controls").doc("inventory").set({ movements_frozen: true, reconciliation_id: "rec-1" });
    assert.equal(codigoDa(await recusa(recontar({ box_code: "CX-000012", lines: [{ sku_code: POLO_M, counted_qty: 48 }] }))), "INVENTORY_RECONCILIATION_IN_PROGRESS");
  });

  it("a prateleira com guarda aberta chegando ou saindo, ou com caixa a caminho, recusa até a guarda concluir", async () => {
    const recontarA03 = () => recontar({ box_code: "CX-000012", lines: [{ sku_code: POLO_M, counted_qty: 60 }] });
    await db.collection("putaway_tasks").doc("put_1").set({ customer_code: BTG, sku_code: POLO_M, source_location_id: "RECEBIMENTO", destination_location_id: "A-03", location_id: "A-03", quantity: 10, status: "planned" });
    let erro = await recusa(recontarA03());
    assert.equal(codigoDa(erro), "BOX_RECOUNT_PUTAWAY_OPEN");
    assert.match(erro.message, /A prateleira A-03 tem uma guarda chegando ou saindo/);
    await db.collection("putaway_tasks").doc("put_1").update({ status: "completed" });
    await db.collection("putaway_tasks").doc("put_2").set({ customer_code: BTG, sku_code: POLO_M, source_location_id: "A-03", status: "in_progress" });
    assert.equal(codigoDa(await recusa(recontarA03())), "BOX_RECOUNT_PUTAWAY_OPEN");
    await db.collection("putaway_tasks").doc("put_2").update({ status: "completed" });
    // A caixa do recebimento com o destino confirmado na A-03 (committing) ainda não chegou.
    await db.collection("warehouse_boxes").doc("CX-000230").set({ code: "CX-000230", customer_code: BTG, status: "committing", location_id: "A-03" });
    erro = await recusa(recontarA03());
    assert.match(erro.message, /a caixa CX-000230 a caminho/);
    await db.collection("warehouse_boxes").doc("CX-000230").update({ status: "stored" });
    assert.equal((await recontarA03()).difference_units, 0);
    // A caixa a caminho não se reconta.
    await db.collection("warehouse_boxes").doc("CX-000230").update({ status: "committing" });
    assert.equal(codigoDa(await recusa(recontar({ box_code: "CX-000230", lines: [] }))), "BOX_RECOUNT_BOX_COMMITTING");
  });

  it("a caixa tem de existir, ser do cliente e estar guardada nesta prateleira, cadastrada", async () => {
    assert.equal(codigoDa(await recusa(recontar({ box_code: "CX-000099", lines: [] }))), "BOX_RECOUNT_BOX_NOT_FOUND");
    let erro = await recusa(recontar({ box_code: "CX-000012", location_id: "A-04", lines: [{ sku_code: POLO_M, counted_qty: 60 }] }));
    assert.equal(codigoDa(erro), "BOX_RECOUNT_WRONG_SHELF");
    assert.equal(erro.message, "A caixa CX-000012 está em A-03, não em A-04.");
    // A prateleira em minúsculas é a mesma.
    assert.equal((await recontar({ box_code: "CX-000012", location_id: "a-03", lines: [{ sku_code: POLO_M, counted_qty: 60 }] })).difference_units, 0);
    await db.collection("warehouse_boxes").doc("CX-000050").set({ code: "CX-000050", customer_code: "Itau", status: "stored", location_id: "A-03" });
    erro = await recusa(recontar({ box_code: "CX-000050", lines: [] }));
    assert.deepEqual([erro.code, erro.message], ["permission-denied", "A caixa pertence a outro cliente."]);
    await db.collection("warehouse_boxes").doc("CX-000051").set({ code: "CX-000051", customer_code: BTG, status: "reviewed", location_id: "" });
    assert.equal(codigoDa(await recusa(recontar({ box_code: "CX-000051", location_id: "A-03", lines: [] }))), "BOX_RECOUNT_BOX_NOT_STORED");
    await db.collection("warehouse_boxes").doc("CX-000052").set({ code: "CX-000052", customer_code: BTG, status: "stored", location_id: "Z-99", unit_count: 0 });
    assert.equal(codigoDa(await recusa(recontar({ box_code: "CX-000052", location_id: "Z-99", lines: [] }))), "BOX_RECOUNT_SHELF_NOT_FOUND");
    assert.equal(codigoDa(await recusa(recontar({ box_code: "CX-000012", location_id: "recebimento", lines: [] }))), "BOX_RECOUNT_NOT_A_SHELF");
  });

  it("a lista contada é a da caixa: falta item, item que não é dela, fora da lista que é dela, item repetido", async () => {
    let erro = await recusa(recontar({ box_code: "CX-000012", lines: [] }));
    assert.equal(codigoDa(erro), "BOX_RECOUNT_LIST_CHANGED");
    assert.match(erro.message, /falta Polo Masculino Piquet Preto · M, com 60 un\. esperadas/);
    erro = await recusa(recontar({ box_code: "CX-000012", lines: [{ sku_code: POLO_M, counted_qty: 60 }, { sku_code: POLO_GG, counted_qty: 1 }] }));
    assert.equal(codigoDa(erro), "BOX_RECOUNT_LIST_CHANGED");
    erro = await recusa(recontar({ box_code: "CX-000012", lines: [{ sku_code: POLO_M, counted_qty: 60 }], extra_lines: [{ sku_code: POLO_M, counted_qty: 1 }] }));
    assert.equal(codigoDa(erro), "BOX_RECOUNT_DUPLICATED_ITEM");
    // O código vale em maiúsculas: a mesma polo em minúsculas é repetida.
    erro = await recusa(recontar({ box_code: "CX-000012", lines: [{ sku_code: POLO_M, counted_qty: 60 }, { sku_code: POLO_M.toLowerCase(), counted_qty: 1 }] }));
    assert.equal(codigoDa(erro), "BOX_RECOUNT_DUPLICATED_ITEM");
    await db.collection("warehouse_boxes").doc("CX-000011").update({ count_adjustments: [{ recount_id: "brc_x", sku_code: POLO_GG, qty: 1 }] });
    erro = await recusa(recontar({ box_code: "CX-000011", lines: [{ sku_code: POLO_M, counted_qty: 60 }], extra_lines: [{ sku_code: POLO_GG, counted_qty: 1 }] }));
    assert.match(erro.message, /já está na lista da caixa CX-000011/);
  });

  it("o fora da lista que não está no cadastro do cliente é recusado: produto novo entra pelo Receber", async () => {
    let erro = await recusa(recontar({ box_code: "CX-000012", lines: [{ sku_code: POLO_M, counted_qty: 60 }], extra_lines: [{ sku_code: "BTG-999999", counted_qty: 1 }] }));
    assert.equal(codigoDa(erro), "BOX_RECOUNT_PRODUCT_NOT_FOUND");
    assert.match(erro.message, /entra pelo Receber/);
    await db.collection("skus").doc("ITAU-000001").set({ id: "ITAU-000001", customer_code: "Itau", cod_btg: "ITAU-000001", sku_code: "ITAU-000001", sku_code_key: "ITAU-000001", status: "active" });
    erro = await recusa(recontar({ box_code: "CX-000012", lines: [{ sku_code: POLO_M, counted_qty: 60 }], extra_lines: [{ sku_code: "ITAU-000001", counted_qty: 1 }] }));
    assert.equal(codigoDa(erro), "CATALOG_OWNED_BY_OTHER_CUSTOMER");
    assert.deepEqual([(await todos("cycle_counts")).length, (await todos("events")).length], [0, 0]);
  });

  it("a prateleira com menos saldo que as caixas recusa a falta que a levaria abaixo de zero", async () => {
    await db.collection("stock_balances").doc(`bal_${POLO_M}_A-03`).update({ qty_on_hand: 50, qty_available: 50 });
    const erro = await recusa(recontar({ box_code: "CX-000012", lines: [{ sku_code: POLO_M, counted_qty: 0 }] }));
    assert.equal(codigoDa(erro), "BOX_RECOUNT_SHELF_SHORT");
    assert.match(erro.message, /as caixas dizem mais do que a prateleira\. A prateleira precisa do acerto antes da recontagem: veja a diferença no relatório "Caixas × saldo", na Contagem\./);
  });
});

describe("Recontar a caixa: a repetição e duas pessoas", () => {
  it("a mesma chave devolve o mesmo resultado sem gravar de novo; com outro conteúdo, recusa", async () => {
    const entrada = entradaDaRecontagem({ customer_code: BTG, box_code: "CX-000012", location_id: "A-03", lines: [{ sku_code: POLO_M, counted_qty: 48 }], idempotency_key: "mesma-chave-1" });
    const primeira = await recountWarehouseBoxTransaction(db, entrada, guilherme);
    const segunda = await recountWarehouseBoxTransaction(db, entrada, rafael);
    assert.deepEqual(segunda, primeira);
    assert.deepEqual([(await todos("cycle_counts")).length, (await todos("movements")).length, (await eventos(BOX_RECOUNT_EVENT_TYPE)).length], [1, 1, 1]);
    assert.equal(((await caixa("CX-000012")).count_adjustments as unknown[]).length, 1);
    assert.equal((await saldo(POLO_M))[0]!.qty_on_hand, 108);
    const outra = entradaDaRecontagem({ customer_code: BTG, box_code: "CX-000012", location_id: "A-03", lines: [{ sku_code: POLO_M, counted_qty: 47 }], idempotency_key: "mesma-chave-1" });
    const erro = await recusa(recountWarehouseBoxTransaction(db, outra, guilherme));
    assert.equal(erro.code, "already-exists");
  });

  it("recontar de novo com outra chave parte do que a primeira gravou: a contagem é o novo saldo da caixa", async () => {
    await recontar({ box_code: "CX-000012", lines: [{ sku_code: POLO_M, counted_qty: 48 }] });
    const deNovo = await recontar({ box_code: "CX-000012", lines: [{ sku_code: POLO_M, counted_qty: 48 }] }, rafael);
    assert.deepEqual([deNovo.difference_units, deNovo.shelf_delta_units], [0, 0]);
    assert.equal((deNovo.previous_recount as Record<string, unknown>).by_name, "Guilherme Dantas");
    assert.equal((await saldo(POLO_M))[0]!.qty_on_hand, 108);
  });

  it("duas pessoas recontam a mesma caixa ao mesmo tempo: a prateleira acerta uma vez, e a caixa fica com o contado", async () => {
    const [uma, outra] = await Promise.all([
      recontar({ box_code: "CX-000012", lines: [{ sku_code: POLO_M, counted_qty: 48 }] }, guilherme),
      recontar({ box_code: "CX-000012", lines: [{ sku_code: POLO_M, counted_qty: 48 }] }, rafael),
    ]);
    assert.deepEqual([uma.difference_units + outra.difference_units, uma.shelf_delta_units + outra.shelf_delta_units].sort(), [-12, -12]);
    assert.deepEqual([uma.difference_units, outra.difference_units].sort((a, b) => a - b), [-12, 0]);
    assert.equal(await saldoNaCaixa("CX-000012", POLO_M), 48);
    assert.equal((await saldo(POLO_M))[0]!.qty_on_hand, 108);
    assert.deepEqual([(await todos("movements")).length, (await todos("cycle_counts")).length], [1, 2]);
  });
});

describe("Recontar a caixa: a entrada", () => {
  it("o código da caixa e do item valem em maiúsculas, e o motivo sem a rodada é o padrão", async () => {
    const resultado = await recontar({ box_code: "cx-000012", lines: [{ sku_code: POLO_M.toLowerCase(), counted_qty: 60 }] });
    assert.equal(resultado.box_code, "CX-000012");
    assert.equal((await todos("cycle_counts"))[0]!.reason, "Recontagem por caixa");
  });
});

describe("Recontar a caixa: a rodada", () => {
  const iniciar = (alcance: { scope: "general" | "aisle" | "item"; aisle?: string; sku_code?: string }, cliente = BTG) =>
    startCountRoundTransaction(db, entradaDoInicio({ customer_code: cliente, idempotency_key: chave("rodada"), ...alcance }), guilherme);
  const concluir = (roundId: string) => completeCountRoundTransaction(db, entradaDaConclusao({ customer_code: BTG, round_id: roundId, idempotency_key: chave("concluir") }), guilherme);
  const semDiferenca = (box_code: string, location_id: string, sku: string, qty: number, round_id: string) => recontar({ box_code, location_id, lines: [{ sku_code: sku, counted_qty: qty }], round_id });

  it("a rodada aberta do cliente grava; a concluída recusa; a que não existe recusa; o id fixo sem documento passa", async () => {
    const aberta = await iniciar({ scope: "general" });
    const gravada = await semDiferenca("CX-000010", "A-03", POLO_P, 60, aberta.round_id);
    assert.equal(gravada.round_id, aberta.round_id);
    assert.equal((await caixa("CX-000010")).last_recount_round_id, aberta.round_id);
    await concluir(aberta.round_id);
    const concluida = await recusa(semDiferenca("CX-000010", "A-03", POLO_P, 60, aberta.round_id));
    assert.equal(codigoDa(concluida), "BOX_RECOUNT_ROUND_CLOSED");
    assert.equal(concluida.message, `A contagem «${aberta.title}» já foi concluída: abra a Contagem e inicie outra.`);
    const inexistente = await recusa(semDiferenca("CX-000010", "A-03", POLO_P, 60, "cr_000000000000000000000000"));
    assert.equal(codigoDa(inexistente), "BOX_RECOUNT_ROUND_NOT_FOUND");
    await semDiferenca("CX-000011", "A-03", POLO_M, 60, LEGACY_ROUND_ID);
    assert.equal((await caixa("CX-000011")).last_recount_round_id, LEGACY_ROUND_ID);
  });

  it("fora do alcance: a prateleira de outra rua e a prateleira sem caixa com o item recusam; a rua é a inteira antes do hífen", async () => {
    const posicao = (code: string, aisle: string) => db.collection("warehouse_positions").doc(code).set({ code, aisle, shelf: 1, sequence: 1, length_m: 1.8, depth_m: 0.75, height_m: 0.65, customer_code: BTG, status: "active" });
    await Promise.all([posicao("B-01", "B"), posicao("AB-01", "AB"), caixaDaAbertura("CX-000020", "B-01", "2026-10-20T15:00:00.000Z", [[POLO_P, 10]]), caixaDaAbertura("CX-000021", "AB-01", "2026-10-20T16:00:00.000Z", [[POLO_P, 10]])]);
    const ruaA = await iniciar({ scope: "aisle", aisle: "A" });
    await semDiferenca("CX-000010", "A-03", POLO_P, 60, ruaA.round_id);
    const outraRua = await recusa(semDiferenca("CX-000020", "B-01", POLO_P, 10, ruaA.round_id));
    assert.equal(codigoDa(outraRua), "BOX_RECOUNT_OUT_OF_SCOPE");
    assert.equal(outraRua.message, `A prateleira B-01 está fora da contagem «${ruaA.title}».`);
    assert.equal(codigoDa(await recusa(semDiferenca("CX-000021", "AB-01", POLO_P, 10, ruaA.round_id))), "BOX_RECOUNT_OUT_OF_SCOPE");
    await concluir(ruaA.round_id);

    // Por item: a prateleira com caixa que tem o item se conta inteira; a sem o item fica fora.
    const porItem = await iniciar({ scope: "item", sku_code: POLO_GG });
    await semDiferenca("CX-000010", "A-03", POLO_P, 60, porItem.round_id);
    assert.equal(codigoDa(await recusa(semDiferenca("CX-000020", "B-01", POLO_P, 10, porItem.round_id))), "BOX_RECOUNT_OUT_OF_SCOPE");
  });

  it("a rodada de outro cliente é permission-denied", async () => {
    // Iniciar pede caixa guardada do cliente no alcance.
    await db.collection("warehouse_boxes").doc("CX-000090").set({ id: "CX-000090", code: "CX-000090", customer_code: "Outro Cliente", status: "stored", location_id: "A-04", stored_at: "2026-11-06T15:00:00.000Z", unit_count: 1, line_count: 1, sku_codes: ["OUT-000001"] });
    const deOutro = await iniciar({ scope: "general" }, "Outro Cliente");
    const erro = await recusa(semDiferenca("CX-000010", "A-03", POLO_P, 60, deOutro.round_id));
    assert.equal(erro.code, "permission-denied");
  });
});
