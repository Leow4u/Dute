import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type DocumentData, type Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";

import { billingMovementDirection } from "./billing-scope.js";
import { lerCaixasDaPrateleira } from "./box-balance.js";
import {
  BOX_MOVED_EVENT_TYPE,
  BOX_MOVE_SOURCE,
  MOTIVO_DO_MOVER,
  entradaDaPreviaDoMover,
  entradaDoMover,
  moveWarehouseBoxTransaction,
  previewBoxMoveTransaction,
  type ResultadoDoMover,
} from "./box-move.js";
import { LEGACY_ROUND_ID, LEGACY_ROUND_TITLE } from "./count-rounds.js";
import { lerDatasDoEstoque } from "./datas-do-estoque.js";
import { clientScopedInventoryId, type OperationalActor } from "./operations.js";

/**
 * Mover caixa (docs/superpowers/specs/2026-11-19-mover-caixa-design.md), no
 * emulador. Antes, mudar a caixa de prateleira era o lançamento manual de
 * Estoque › Itens: SAÍDA e ENTRADA à mão, e a caixa ficava no lugar antigo
 * (o Mapa, a etiqueta, a separação, o Caixas × saldo e o FIFO errados).
 *
 * A zona da BTG: A-01 com a CX-000121 da abertura (12 polos M e 8 G), A-02
 * com a CX-000141 da abertura (10 G) e a CX-000140 do recebimento (6 G, de
 * 06/11), B-09 com a CX-000130 da abertura (10 M), B-10 e C-02 vazias; Z-01
 * é do Itaú. Os saldos e o razão fecham com as caixas.
 */

const PROJECT_ID = "demo-dute-operations";
const BTG = "BTG Pactual";
const SESSAO = "opening_BTG_Pactual";
const POLO_M = "BTG-000112";
const POLO_G = "BTG-000113";

const guilherme: OperationalActor = { uid: "wms-1", email: "guilherme@dutelog.com.br", name: "Guilherme Dantas", role: "wms", customer_code: "Dutelog" };
const rafael: OperationalActor = { uid: "wms-2", email: "rafael@dutelog.com.br", name: "Rafael", role: "wms", customer_code: "Dutelog" };

const NOMES: Record<string, { cod_cliente: string; tamanho: string }> = {
  [POLO_M]: { cod_cliente: "A.01.0713.005.M", tamanho: "M" },
  [POLO_G]: { cod_cliente: "A.01.0713.005.G", tamanho: "G" },
};

let db: Firestore;
let app: ReturnType<typeof initializeApp>;

before(() => {
  app = initializeApp({ projectId: PROJECT_ID }, "box-move-test");
  db = getFirestore(app);
});

after(async () => {
  await deleteApp(app);
});

const MEDIDAS = { length_m: 0.4, width_m: 0.6, height_m: 0.35, front_m: 0.4, depth_m: 0.6, placed_height_m: 0.35, orientation: "length_width_height", allow_tilt: false, allow_stacking: false, support_box_code: null, base_height_m: 0, gross_weight_kg: 10 };

function caixaDaAbertura(code: string, location: string, storedAt: string, linhas: Array<[string, number]>, extra: Record<string, unknown> = {}) {
  return Promise.all([
    db.collection("warehouse_boxes").doc(code).set({
      id: code,
      code,
      customer_code: BTG,
      status: "stored",
      location_id: location,
      stored_at: storedAt,
      unit_count: linhas.reduce((soma, [, qty]) => soma + qty, 0),
      line_count: linhas.length,
      sku_codes: linhas.map(([sku]) => sku),
      origin: { kind: "opening_inventory", session_id: SESSAO },
      ...MEDIDAS,
      ...extra,
    }),
    ...linhas.map(([sku, qty]) =>
      db
        .collection("opening_inventory_lines")
        .doc(`oil_${code}_${sku}`)
        .set({ session_id: SESSAO, customer_code: BTG, sku_code: sku, client_item_code: NOMES[sku]!.cod_cliente, product_name: "Polo Masculino Piquet Preto", size: NOMES[sku]!.tamanho, location_id: location, box_code: code, counted_qty: qty, status: "counted" }),
    ),
  ]);
}

function saldoNaPrateleira(sku: string, location: string, qty: number, extra: Record<string, unknown> = {}) {
  const id = `bal_${sku}_${location}`;
  return db.collection("stock_balances").doc(id).set({ id, customer_code: BTG, sku_code: sku, client_item_code: NOMES[sku]!.cod_cliente, product_name: "Polo Masculino Piquet Preto", size: NOMES[sku]!.tamanho, location_id: location, qty_on_hand: qty, qty_reserved: 0, qty_available: qty, status: "available", ...extra });
}

function entradaNoRazao(id: string, sku: string, location: string, quantity: number, createdAt: string, extra: Record<string, unknown> = {}) {
  return db.collection("movements").doc(id).set({ id, customer_code: BTG, sku_code: sku, location_id: location, tipo_mov: "ENTRADA", quantity, source: "functions_opening_inventory", created_at: new Date(createdAt), ...extra });
}

beforeEach(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error("FIRESTORE_EMULATOR_HOST não definido.");
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
  const posicao = (code: string, sequence: number, extra: Record<string, unknown> = {}) =>
    db.collection("warehouse_positions").doc(code).set({ code, aisle: code.split("-")[0], shelf: sequence, sequence, length_m: 1.8, depth_m: 0.75, height_m: 0.65, customer_code: BTG, status: "active", ...extra });
  await Promise.all([
    db.collection("customers").doc("BTG_Pactual").set({ code: BTG, customer_code: BTG, name: BTG, sku_prefix: "BTG", status: "active" }),
    db.collection("opening_inventory_sessions").doc(SESSAO).set({ id: SESSAO, customer_code: BTG, status: "completed", started_at: "2026-10-20T11:00:00.000Z" }),
    posicao("A-01", 1),
    posicao("A-02", 2),
    posicao("B-09", 9),
    posicao("B-10", 10),
    posicao("C-02", 12),
    posicao("Z-01", 20, { customer_code: "Itaú" }),
    caixaDaAbertura("CX-000121", "A-01", "2026-10-22T13:00:00.000Z", [
      [POLO_M, 12],
      [POLO_G, 8],
    ]),
    caixaDaAbertura("CX-000130", "B-09", "2026-10-22T14:00:00.000Z", [[POLO_M, 10]]),
    caixaDaAbertura("CX-000141", "A-02", "2026-10-22T15:00:00.000Z", [[POLO_G, 10]]),
    db.collection("warehouse_boxes").doc("CX-000140").set({
      id: "CX-000140",
      code: "CX-000140",
      customer_code: BTG,
      status: "stored",
      location_id: "A-02",
      stored_at: "2026-11-06T18:02:00.000Z",
      unit_count: 6,
      line_count: 1,
      sku_codes: [POLO_G],
      origin: { kind: "receipt", receipt_id: "inb_1", invoice_number: "48.377" },
      lines: [{ inbound_item_id: "ini_1", line_number: 1, sku_code: POLO_G, client_item_code: NOMES[POLO_G]!.cod_cliente, product_name: "Polo Masculino Piquet Preto", size: "G", counted_qty: 6 }],
      ...MEDIDAS,
    }),
    saldoNaPrateleira(POLO_M, "A-01", 12),
    saldoNaPrateleira(POLO_G, "A-01", 8),
    saldoNaPrateleira(POLO_M, "B-09", 10),
    saldoNaPrateleira(POLO_G, "A-02", 16),
    db.collection("client_inventory").doc(clientScopedInventoryId(BTG, POLO_M)).set({ customer_code: BTG, sku_code: POLO_M, qty_on_hand: 22, qty_reserved: 0, qty_available: 22, qty_receiving: 0 }),
    db.collection("client_inventory").doc(clientScopedInventoryId(BTG, POLO_G)).set({ customer_code: BTG, sku_code: POLO_G, qty_on_hand: 24, qty_reserved: 0, qty_available: 24, qty_receiving: 0 }),
    entradaNoRazao("mov_ab_m_a01", POLO_M, "A-01", 12, "2026-10-22T13:00:00.000Z", { opening_inventory_session_id: SESSAO }),
    entradaNoRazao("mov_ab_g_a01", POLO_G, "A-01", 8, "2026-10-22T13:00:00.000Z", { opening_inventory_session_id: SESSAO }),
    entradaNoRazao("mov_ab_m_b09", POLO_M, "B-09", 10, "2026-10-22T14:00:00.000Z", { opening_inventory_session_id: SESSAO }),
    entradaNoRazao("mov_ab_g_a02", POLO_G, "A-02", 10, "2026-10-22T15:00:00.000Z", { opening_inventory_session_id: SESSAO }),
    entradaNoRazao("mov_guarda_g_a02", POLO_G, "A-02", 6, "2026-11-06T18:02:00.000Z", { source: "wms_putaway" }),
  ]);
});

let chaves = 0;
function chave() {
  chaves += 1;
  return `mover-${String(chaves).padStart(6, "0")}`;
}

function mover(entrada: Record<string, unknown>, ator: OperationalActor = guilherme): Promise<ResultadoDoMover> {
  return moveWarehouseBoxTransaction(db, entradaDoMover({ customer_code: BTG, box_code: "CX-000121", from_location_id: "A-01", idempotency_key: chave(), ...entrada }), ator);
}

async function recusa(acao: Promise<unknown>): Promise<HttpsError> {
  try {
    await acao;
  } catch (error) {
    assert.ok(error instanceof HttpsError, String(error));
    return error;
  }
  assert.fail("o mover passou");
}

function codigoDa(erro: HttpsError): unknown {
  return (erro.details as { code?: unknown } | undefined)?.code;
}

async function caixa(code: string): Promise<DocumentData> {
  return (await db.collection("warehouse_boxes").doc(code).get()).data() ?? {};
}

async function saldo(sku: string, location: string) {
  const rows = await db.collection("stock_balances").where("customer_code", "==", BTG).where("sku_code", "==", sku).where("location_id", "==", location).get();
  return rows.docs.map((doc) => doc.data());
}

async function todos(colecao: string) {
  return (await db.collection(colecao).get()).docs.map((doc) => ({ id: doc.id, ...doc.data() }) as Record<string, unknown>);
}

async function movimentosDoMover() {
  return (await todos("movements")).filter((movimento) => movimento.source === BOX_MOVE_SOURCE);
}

describe("Mover caixa: a caixa, os saldos, o razão e as linhas da abertura numa transação", () => {
  it("pela sugestão: a caixa, os saldos, o razão, as linhas da abertura, o evento e o recibo", async () => {
    const entrada = { to_location_id: "B-09", suggestion: { position: "B-09", alternatives: ["C-02", "B-10"] }, idempotency_key: "mover-pela-sugestao" };
    const resultado = await mover(entrada);
    assert.deepEqual(
      [resultado.ok, resultado.box_code, resultado.from_location_id, resultado.to_location_id, resultado.units, resultado.suggestion_followed, resultado.moved_by_name],
      [true, "CX-000121", "A-01", "B-09", 20, true, "Guilherme Dantas"],
    );
    assert.deepEqual(
      resultado.items.map((item) => [item.sku_code, item.qty, item.client_item_code, item.size]),
      [
        [POLO_M, 12, "A.01.0713.005.M", "M"],
        [POLO_G, 8, "A.01.0713.005.G", "G"],
      ],
    );

    // A caixa: a prateleira nova, o encaixe nela e o registro do mover; o stored_at não muda.
    const box = await caixa("CX-000121");
    assert.deepEqual(
      [box.location_id, box.moved_from_location_id, box.move_count, box.stored_at, box.moved_at, box.last_move_id, box.moved_by.name, box.front_m, box.support_box_code],
      ["B-09", "A-01", 1, "2026-10-22T13:00:00.000Z", resultado.moved_at, resultado.box_move_id, "Guilherme Dantas", 0.4, null],
    );

    // Os saldos: a origem fica sem os itens da caixa, o destino os ganha (o G nasce em B-09).
    assert.deepEqual([(await saldo(POLO_M, "A-01"))[0]!.qty_on_hand, (await saldo(POLO_G, "A-01"))[0]!.qty_on_hand], [0, 0]);
    assert.equal((await saldo(POLO_M, "A-01"))[0]!.status, "empty");
    assert.deepEqual([(await saldo(POLO_M, "B-09"))[0]!.qty_on_hand, (await saldo(POLO_G, "B-09"))[0]!.qty_on_hand], [22, 8]);
    assert.deepEqual([(await saldo(POLO_G, "B-09"))[0]!.qty_reserved, (await saldo(POLO_G, "B-09"))[0]!.qty_available], [0, 8]);

    // O razão: a SAÍDA na origem e a ENTRADA no destino por item, fora da cobrança, a ENTRADA com o dia da caixa e a origem.
    const movimentos = await movimentosDoMover();
    assert.equal(movimentos.length, 4);
    assert.deepEqual(resultado.movement_ids.slice().sort(), movimentos.map((movimento) => movimento.id).sort());
    const resumo = movimentos
      .map((movimento) => [movimento.tipo_mov, movimento.sku_code, movimento.location_id, movimento.quantity, movimento.qty_before, movimento.qty_after, movimento.movement_kind])
      .sort((a, b) => String(a).localeCompare(String(b)));
    assert.deepEqual(resumo, [
      ["ENTRADA", POLO_M, "B-09", 12, 10, 22, "box_move_in"],
      ["ENTRADA", POLO_G, "B-09", 8, 0, 8, "box_move_in"],
      ["SAIDA", POLO_M, "A-01", 12, 12, 0, "box_move_out"],
      ["SAIDA", POLO_G, "A-01", 8, 8, 0, "box_move_out"],
    ]);
    for (const movimento of movimentos) {
      assert.deepEqual([movimento.box_code, movimento.reason, movimento.from_location_id, movimento.to_location_id, movimento.box_move_id], ["CX-000121", MOTIVO_DO_MOVER, "A-01", "B-09", resultado.box_move_id]);
      assert.equal(billingMovementDirection(movimento, { snapshot: false }), null);
      const entrada = movimento.tipo_mov === "ENTRADA";
      // Como a recontagem: a sessão vale o dia da abertura, e o fifo_day (o dia da guarda) fica de reserva.
      assert.deepEqual([movimento.fifo_opening_session_id, movimento.fifo_from_location_id, movimento.fifo_day], [entrada ? SESSAO : undefined, entrada ? "A-01" : undefined, entrada ? "2026-10-22" : undefined]);
    }

    // As linhas da abertura vão com a caixa; a primeira prateleira fica guardada.
    const linhas = (await db.collection("opening_inventory_lines").where("box_code", "==", "CX-000121").get()).docs.map((doc) => [doc.get("sku_code"), doc.get("location_id"), doc.get("opening_location_id")]);
    assert.deepEqual(linhas.sort(), [
      [POLO_M, "B-09", "A-01"],
      [POLO_G, "B-09", "A-01"],
    ].sort());

    // O evento: a caixa no título (o rascunho, se houver, é interno), fora da caixa de avisos.
    const eventos = (await todos("events")).filter((evento) => evento.type === BOX_MOVED_EVENT_TYPE);
    assert.equal(eventos.length, 1);
    assert.deepEqual(
      [eventos[0]!.title, eventos[0]!.description, eventos[0]!.entity_type, eventos[0]!.entity_id, eventos[0]!.severity],
      ["Caixa CX-000121 movida de A-01 para B-09", "20 un. · sugestão do sistema", "warehouse_boxes", "CX-000121", "info"],
    );
    assert.equal((await todos("ai_agent_inbox")).length, 0);

    // O recibo: a mesma chave devolve o mesmo resultado; com outro destino, recusa.
    const recibos = (await todos("operational_operations")).filter((recibo) => recibo.kind === "warehouse.box.move");
    assert.equal(recibos.length, 1);
    assert.deepEqual(await mover(entrada), resultado);
    assert.equal((await recusa(mover({ ...entrada, to_location_id: "C-02" }))).code, "already-exists");
    assert.equal((await movimentosDoMover()).length, 4);
  });

  it("à mão, para a prateleira vazia", async () => {
    const resultado = await mover({ to_location_id: "C-02", suggestion: { position: "B-09", alternatives: ["B-10"] } });
    assert.equal(resultado.suggestion_followed, false);
    const [evento] = (await todos("events")).filter((item) => item.type === BOX_MOVED_EVENT_TYPE);
    assert.equal(evento!.description, "20 un. · escolhida à mão");
    assert.deepEqual([(await saldo(POLO_M, "C-02"))[0]!.qty_on_hand, (await saldo(POLO_G, "C-02"))[0]!.qty_on_hand], [12, 8]);
  });

  it("a caixa do recebimento leva o dia da guarda e nenhuma linha da abertura", async () => {
    const resultado = await mover({ box_code: "CX-000140", from_location_id: "A-02", to_location_id: "C-02" });
    assert.equal(resultado.suggestion_followed, null);
    const [entrada] = (await movimentosDoMover()).filter((movimento) => movimento.tipo_mov === "ENTRADA");
    assert.deepEqual([entrada!.quantity, entrada!.fifo_day, entrada!.fifo_opening_session_id, entrada!.fifo_from_location_id], [6, "2026-11-06", undefined, "A-02"]);
    assert.deepEqual([(await saldo(POLO_G, "A-02"))[0]!.qty_on_hand, (await saldo(POLO_G, "C-02"))[0]!.qty_on_hand], [10, 6]);
    // As linhas da CX-000141, a outra caixa de A-02, ficam onde estão.
    assert.equal((await db.collection("opening_inventory_lines").doc(`oil_CX-000141_${POLO_G}`).get()).get("location_id"), "A-02");
  });

  it("a caixa aberta leva o saldo dela, não a entrada", async () => {
    await db.collection("warehouse_boxes").doc("CX-000121").update({
      taken_lines: [{ sku_code: POLO_M, qty: 4 }],
      taken_units: 4,
      count_adjustments: [{ recount_id: "brc_1", sku_code: POLO_G, qty: 1 }],
      balance_at: "2026-11-17T12:00:00.000Z",
    });
    await Promise.all([saldoNaPrateleira(POLO_M, "A-01", 8), saldoNaPrateleira(POLO_G, "A-01", 9)]);
    const resultado = await mover({ to_location_id: "C-02" });
    assert.deepEqual(
      resultado.items.map((item) => [item.sku_code, item.qty]),
      [
        [POLO_M, 8],
        [POLO_G, 9],
      ],
    );
    assert.equal(resultado.units, 17);
    assert.deepEqual([(await saldo(POLO_M, "A-01"))[0]!.qty_on_hand, (await saldo(POLO_G, "A-01"))[0]!.qty_on_hand], [0, 0]);
    assert.deepEqual([(await saldo(POLO_M, "C-02"))[0]!.qty_on_hand, (await saldo(POLO_G, "C-02"))[0]!.qty_on_hand], [8, 9]);
  });

  it("as datas do FIFO das duas prateleiras, na ida e na volta", async () => {
    const dias = async () => (await lerDatasDoEstoque(db, BTG, POLO_G)).datas;
    const doLocal = async (local: string) => (await lerDatasDoEstoque(db, BTG, POLO_G)).locais.find((item) => item.local === local)?.datas ?? [];
    const antes = await dias();
    assert.deepEqual(antes, [
      { desde: "2026-10-20", pecas: 18 },
      { desde: "2026-11-06", pecas: 6 },
    ]);

    // A CX-000140 é a mais nova de A-02: depois do mover, A-02 fica só com o dia da abertura.
    await mover({ box_code: "CX-000140", from_location_id: "A-02", to_location_id: "C-02" });
    assert.deepEqual(await doLocal("A-02"), [{ desde: "2026-10-20", pecas: 10 }]);
    assert.deepEqual(await doLocal("C-02"), [{ desde: "2026-11-06", pecas: 6 }]);
    assert.deepEqual(await dias(), antes);

    // E de volta.
    await mover({ box_code: "CX-000140", from_location_id: "C-02", to_location_id: "A-02" });
    assert.deepEqual(await doLocal("A-02"), [
      { desde: "2026-10-20", pecas: 10 },
      { desde: "2026-11-06", pecas: 6 },
    ]);
    assert.deepEqual(await doLocal("C-02"), []);
    assert.deepEqual(await dias(), antes);
    assert.deepEqual([(await saldo(POLO_G, "A-02"))[0]!.qty_on_hand, (await saldo(POLO_G, "C-02"))[0]!.qty_on_hand], [16, 0]);
  });

  it("a separação acha a caixa no destino", async () => {
    await mover({ to_location_id: "B-09" });
    const noDestino = await db.runTransaction((transaction) => lerCaixasDaPrateleira(transaction, db, { customerCode: BTG, locationId: "B-09", skuCode: POLO_M }));
    assert.deepEqual([...noDestino.porCodigo.keys()].sort(), ["CX-000121", "CX-000130"]);
    assert.equal(noDestino.entradaDoItem.get("CX-000121"), 12);
    const naOrigem = await db.runTransaction((transaction) => lerCaixasDaPrateleira(transaction, db, { customerCode: BTG, locationId: "A-01", skuCode: POLO_M }));
    assert.equal(naOrigem.porCodigo.has("CX-000121"), false);
  });

  it("o portal não muda", async () => {
    const projecao = async () => Promise.all([POLO_M, POLO_G].map(async (sku) => (await db.collection("client_inventory").doc(clientScopedInventoryId(BTG, sku)).get()).data()));
    const antes = await projecao();
    await mover({ to_location_id: "B-09" });
    assert.deepEqual(await projecao(), antes);
  });

  it("duas pessoas, a mesma caixa: uma grava, a outra recusa", async () => {
    const [uma, outra] = await Promise.allSettled([mover({ to_location_id: "B-09" }, guilherme), mover({ to_location_id: "C-02" }, rafael)]);
    const resultados = [uma, outra];
    assert.equal(resultados.filter((resultado) => resultado.status === "fulfilled").length, 1);
    const recusada = resultados.find((resultado) => resultado.status === "rejected") as PromiseRejectedResult;
    assert.equal(codigoDa(recusada.reason as HttpsError), "BOX_MOVE_WRONG_SHELF");
    assert.equal((await movimentosDoMover()).length, 4);
    assert.equal((await todos("events")).filter((evento) => evento.type === BOX_MOVED_EVENT_TYPE).length, 1);
  });
});

describe("as recusas do mover", () => {
  /** Nada mudou: a caixa onde estava, nenhum movimento, evento ou recibo do mover. */
  async function nadaMudou() {
    assert.equal((await caixa("CX-000121")).location_id, "A-01");
    assert.equal((await movimentosDoMover()).length, 0);
    assert.equal((await todos("events")).filter((evento) => evento.type === BOX_MOVED_EVENT_TYPE).length, 0);
    assert.equal((await todos("operational_operations")).filter((recibo) => recibo.kind === "warehouse.box.move").length, 0);
  }

  async function recusaCom(codigo: string, acao: Promise<unknown>, mensagem?: string) {
    const erro = await recusa(acao);
    assert.equal(codigoDa(erro), codigo, erro.message);
    if (mensagem) assert.equal(erro.message, mensagem);
    return erro;
  }

  it("a caixa que não existe", async () => {
    const erro = await recusaCom("BOX_MOVE_BOX_NOT_FOUND", mover({ box_code: "CX-000999", to_location_id: "B-09" }), "A caixa CX-000999 não está cadastrada. Confira o código na etiqueta da caixa.");
    assert.equal(erro.code, "not-found");
    await nadaMudou();
  });

  it("a caixa de outro cliente", async () => {
    await db.collection("warehouse_boxes").doc("CX-000500").set({ code: "CX-000500", customer_code: "Itaú", status: "stored", location_id: "Z-01", ...MEDIDAS });
    const erro = await recusa(mover({ box_code: "CX-000500", from_location_id: "Z-01", to_location_id: "B-09" }));
    assert.deepEqual([erro.code, erro.message], ["permission-denied", "A caixa pertence a outro cliente."]);
    await nadaMudou();
  });

  it("a caixa a caminho não está guardada", async () => {
    await db.collection("warehouse_boxes").doc("CX-000121").update({ status: "committing" });
    await recusaCom("BOX_MOVE_BOX_NOT_STORED", mover({ to_location_id: "B-09" }));
    await nadaMudou();
  });

  it("a caixa que saiu de onde a tela viu", async () => {
    const erro = await recusaCom("BOX_MOVE_WRONG_SHELF", mover({ from_location_id: "A-02", to_location_id: "B-09" }), "A caixa CX-000121 está em A-01, não em A-02: atualize a tela.");
    assert.equal((erro.details as { location_id?: unknown }).location_id, "A-01");
    await nadaMudou();
  });

  it("o destino fora de Posições, a área de passagem e a mesma prateleira", async () => {
    assert.equal((await recusaCom("BOX_MOVE_SHELF_NOT_FOUND", mover({ to_location_id: "Z-99" }), "A prateleira Z-99 não está cadastrada em Estoque › Posições.")).code, "not-found");
    await recusaCom("BOX_MOVE_NOT_A_SHELF", mover({ to_location_id: "recebimento" }), "RECEBIMENTO é área de passagem, não prateleira: a caixa muda só entre prateleiras.");
    await recusaCom("BOX_MOVE_SAME_SHELF", mover({ to_location_id: "A-01" }), "A caixa CX-000121 já está em A-01.");
    await nadaMudou();
  });

  it("o destino bloqueado, em verificação ou de outra zona", async () => {
    await db.collection("warehouse_positions").doc("B-10").update({ status: "blocked" });
    await db.collection("warehouse_positions").doc("C-02").update({ status: "review" });
    await recusaCom("BOX_MOVE_SHELF_UNAVAILABLE", mover({ to_location_id: "B-10" }), "A prateleira B-10 está bloqueada: escolha outra.");
    await recusaCom("BOX_MOVE_SHELF_UNAVAILABLE", mover({ to_location_id: "C-02" }), "A prateleira C-02 está em verificação: escolha outra.");
    await recusaCom("BOX_MOVE_OTHER_ZONE", mover({ to_location_id: "Z-01" }), "A prateleira Z-01 não é da zona de BTG Pactual.");
    await nadaMudou();
  });

  it("o destino sem espaço, inclusive pela caixa a caminho", async () => {
    const ocupando = (code: string, location: string, status: string, front: number) =>
      db.collection("warehouse_boxes").doc(code).set({ code, customer_code: BTG, status, location_id: location, ...MEDIDAS, length_m: front, front_m: front });
    await Promise.all([ocupando("CX-000201", "B-10", "stored", 0.8), ocupando("CX-000202", "B-10", "stored", 0.8), ocupando("CX-000203", "C-02", "committing", 1.6)]);
    await recusaCom("BOX_MOVE_DOES_NOT_FIT", mover({ to_location_id: "B-10" }), "A caixa CX-000121 não cabe em B-10: escolha outra prateleira.");
    await recusaCom("BOX_MOVE_DOES_NOT_FIT", mover({ to_location_id: "C-02" }));
    await nadaMudou();
  });

  it("a caixa com outra em cima", async () => {
    await db.collection("warehouse_boxes").doc("CX-000150").set({ code: "CX-000150", customer_code: BTG, status: "stored", location_id: "A-01", ...MEDIDAS, support_box_code: "CX-000121" });
    await recusaCom("BOX_MOVE_SUPPORTS_ANOTHER", mover({ to_location_id: "B-09" }), "A caixa CX-000150 está em cima da CX-000121: mova a de cima primeiro.");
    await nadaMudou();
  });

  it("o item reservado na origem e no destino", async () => {
    await db.collection("stock_balances").doc(`bal_${POLO_M}_A-01`).update({ qty_reserved: 2, qty_available: 10 });
    await db.collection("stock_reservations").doc("res_1").set({ customer_code: BTG, sku_code: POLO_M, location_id: "A-01", status: "reserved", order_number: "PED-0042", quantity: 2 });
    await recusaCom("BOX_MOVE_RESERVED", mover({ to_location_id: "C-02" }), "Polo Masculino Piquet Preto · M está reservado em A-01 para o pedido PED-0042: mova a caixa depois da entrega.");

    await db.collection("stock_balances").doc(`bal_${POLO_M}_A-01`).update({ qty_reserved: 0, qty_available: 12 });
    await db.collection("stock_balances").doc(`bal_${POLO_M}_B-09`).update({ qty_reserved: 3, qty_available: 7 });
    await db.collection("stock_reservations").doc("res_2").set({ customer_code: BTG, sku_code: POLO_M, location_id: "B-09", status: "picked", order_number: "PED-0043", quantity: 3 });
    await recusaCom(
      "BOX_MOVE_DESTINATION_RESERVED",
      mover({ to_location_id: "B-09" }),
      "Polo Masculino Piquet Preto · M está reservado em B-09 para o pedido PED-0043: escolha outra prateleira ou mova depois da entrega.",
    );
    await nadaMudou();
  });

  it("a contagem por rua na origem e no destino; fora da rua, move", async () => {
    await db.collection("count_rounds").doc("cr_rua_a").set({ id: "cr_rua_a", customer_code: BTG, title: "Contagem da rua A · 19/11/2026", scope: "aisle", aisle: "A", status: "open" });
    await recusaCom("BOX_MOVE_COUNT_ROUND_OPEN", mover({ to_location_id: "C-02" }), "A-01 está na contagem «Contagem da rua A · 19/11/2026»: conclua a contagem antes de mover.");
    await recusaCom("BOX_MOVE_COUNT_ROUND_OPEN", mover({ box_code: "CX-000130", from_location_id: "B-09", to_location_id: "A-02" }), "A-02 está na contagem «Contagem da rua A · 19/11/2026»: conclua a contagem antes de mover.");
    await nadaMudou();
    const fora = await mover({ box_code: "CX-000130", from_location_id: "B-09", to_location_id: "C-02" });
    assert.equal(fora.to_location_id, "C-02");
  });

  it("a recontagem geral de 17/11 da BTG, sem documento, trava todas as prateleiras", async () => {
    await db.collection("cycle_counts").doc("cc_legado").set({ customer_code: BTG, round_id: LEGACY_ROUND_ID, box_recount_id: "brc_legado", box_code: "CX-000130", location_id: "B-09", occurred_at: "2026-11-17T12:00:00.000Z" });
    await recusaCom("BOX_MOVE_COUNT_ROUND_OPEN", mover({ to_location_id: "C-02" }), `A-01 está na contagem «${LEGACY_ROUND_TITLE}»: conclua a contagem antes de mover.`);
    await nadaMudou();
  });

  it("a abertura em andamento", async () => {
    await db.collection("opening_inventory_sessions").doc(SESSAO).update({ status: "open" });
    await recusaCom("BOX_MOVE_OPENING_OPEN", mover({ to_location_id: "C-02" }), "A abertura de BTG Pactual está em andamento: na abertura, use Corrigir caixa.");
    await nadaMudou();
  });

  it("a prateleira com menos do que a caixa diz, e dois saldos do item no destino", async () => {
    await db.collection("stock_balances").doc(`bal_${POLO_M}_A-01`).update({ qty_on_hand: 10, qty_available: 10 });
    await recusaCom(
      "BOX_MOVE_SHELF_SHORT",
      mover({ to_location_id: "C-02" }),
      "A prateleira A-01 tem 10 un. de Polo Masculino Piquet Preto · M e a caixa CX-000121 diz 12: a prateleira precisa do acerto antes (Caixas × saldo, na Contagem).",
    );
    await db.collection("stock_balances").doc(`bal_${POLO_M}_A-01`).update({ qty_on_hand: 12, qty_available: 12 });
    await saldoNaPrateleira(POLO_M, "B-09", 1, { id: "bal_duplicado" });
    await db.collection("stock_balances").doc("bal_duplicado").set({ id: "bal_duplicado", customer_code: BTG, sku_code: POLO_M, location_id: "B-09", qty_on_hand: 1, qty_reserved: 0 });
    await recusaCom("BOX_MOVE_DUPLICATED_BALANCE", mover({ to_location_id: "B-09" }), `Mais de um saldo existe para ${POLO_M} em B-09.`);
    await nadaMudou();
  });

  it("o estoque congelado", async () => {
    await db.collection("system_controls").doc("inventory").set({ movements_frozen: true, reconciliation_id: "rec-1" });
    await recusaCom("INVENTORY_RECONCILIATION_IN_PROGRESS", mover({ to_location_id: "C-02" }));
    await nadaMudou();
  });
});

/**
 * O encaixe no destino (revisão do PR do servidor, 19/11/2026): o motor nunca
 * troca em silêncio o piso, a orientação nem a caixa de apoio
 * (warehouse-boxes.ts, placementFor). A tela manda o encaixe que mostrou; o
 * mover confere esse encaixe e o devolve, no resultado e no evento.
 */
describe("o encaixe no destino", () => {
  it("o mover grava o encaixe que a tela mostrou e o devolve, no resultado e no evento", async () => {
    const previa = await previewBoxMoveTransaction(db, entradaDaPreviaDoMover({ customer_code: BTG, box_code: "CX-000121" }));
    const destino = previa.prateleiras.find((prateleira) => prateleira.code === "C-02")!;
    const resultado = await mover({ to_location_id: "C-02", orientation: destino.placement.orientation, support_box_code: destino.placement.support_box_code ?? null });
    assert.deepEqual(resultado.placement, destino.placement);
    const box = await caixa("CX-000121");
    assert.deepEqual([box.orientation, box.front_m, box.depth_m, box.support_box_code], [destino.placement.orientation, destino.placement.front_m, destino.placement.depth_m, null]);
    const [evento] = (await todos("events")).filter((item) => item.type === BOX_MOVED_EVENT_TYPE);
    assert.deepEqual((evento!.payload as { placement?: unknown }).placement, destino.placement);
  });

  it("o encaixe que a tela viu e não cabe mais recusa, sem trocar por outro", async () => {
    // C-02 com 1,30 m ocupados: 0,50 m livres. De frente (0,40) a caixa cabe; virada (0,60), não.
    await db.collection("warehouse_boxes").doc("CX-000300").set({ code: "CX-000300", customer_code: BTG, status: "stored", location_id: "C-02", ...MEDIDAS, length_m: 1.3, front_m: 1.3 });
    assert.equal(codigoDa(await recusa(mover({ to_location_id: "C-02", orientation: "width_length_height", support_box_code: null }))), "BOX_MOVE_DOES_NOT_FIT");
    // A caixa de apoio que a tela viu não serve (esta caixa não empilha): recusa, sem ir para o piso.
    assert.equal(codigoDa(await recusa(mover({ to_location_id: "C-02", orientation: "length_width_height", support_box_code: "CX-000300" }))), "BOX_MOVE_DOES_NOT_FIT");
    assert.equal((await caixa("CX-000121")).location_id, "A-01");
    // Sem o encaixe na entrada, o motor escolhe o que cabe (de frente) e o devolve.
    const resultado = await mover({ to_location_id: "C-02" });
    assert.deepEqual([resultado.placement.orientation, resultado.placement.front_m], ["length_width_height", 0.4]);
  });
});

describe("a prévia do mover", () => {
  const previa = (box_code = "CX-000121") => previewBoxMoveTransaction(db, entradaDaPreviaDoMover({ customer_code: BTG, box_code }));

  it("a caixa, a sugestão e a lista", async () => {
    // B-10 tem polo M reservado para um pedido: sai da lista (decisão 5).
    await saldoNaPrateleira(POLO_M, "B-10", 2, { qty_reserved: 2, qty_available: 0 });
    const resultado = await previa();
    assert.equal(resultado.bloqueio, null);
    assert.deepEqual(
      [resultado.box.code, resultado.box.status, resultado.box.location_id, resultado.box.units, resultado.box.origin_kind, resultado.box.stored_at, resultado.box.length_m],
      ["CX-000121", "stored", "A-01", 20, "opening_inventory", "2026-10-22T13:00:00.000Z", 0.4],
    );
    assert.deepEqual(
      resultado.box.items.map((item) => [item.sku_code, item.qty, item.product_name, item.size, item.client_item_code]),
      [
        [POLO_M, 12, "Polo Masculino Piquet Preto", "M", "A.01.0713.005.M"],
        [POLO_G, 8, "Polo Masculino Piquet Preto", "G", "A.01.0713.005.G"],
      ],
    );
    // O mesmo produto primeiro (B-09 tem o M, A-02 tem o G), a de mais frente livre antes; depois a mais vazia.
    assert.deepEqual(
      resultado.prateleiras.map((destino) => [destino.code, destino.tier, destino.reason, destino.free_front_m, destino.box_count]),
      [
        ["B-09", 1, "Já tem Polo Masculino Piquet Preto · M e ainda cabe.", 1.4, 1],
        ["A-02", 1, "Já tem Polo Masculino Piquet Preto · G e ainda cabe.", 1, 2],
        ["C-02", 2, "A mais vazia da zona: 1,80 m livres de frente.", 1.8, 0],
      ],
    );
    assert.deepEqual([resultado.com_reserva, resultado.em_contagem, resultado.nao_cabem, resultado.rejected], [["B-10"], [], [], null]);
  });

  it("a reserva na origem bloqueia com a frase do mover", async () => {
    await db.collection("stock_balances").doc(`bal_${POLO_M}_A-01`).update({ qty_reserved: 2, qty_available: 10 });
    await db.collection("stock_reservations").doc("res_1").set({ customer_code: BTG, sku_code: POLO_M, location_id: "A-01", status: "reserved", order_number: "PED-0042", quantity: 2 });
    const resultado = await previa();
    const erro = await recusa(mover({ to_location_id: "C-02" }));
    assert.deepEqual(resultado.bloqueio, { code: "BOX_MOVE_RESERVED", message: erro.message });
    assert.equal(erro.message, "Polo Masculino Piquet Preto · M está reservado em A-01 para o pedido PED-0042: mova a caixa depois da entrega.");
    assert.deepEqual([resultado.prateleiras, resultado.com_reserva, resultado.em_contagem, resultado.nao_cabem], [[], [], [], []]);
  });

  it("a caixa de cima, a abertura e a contagem na origem também bloqueiam", async () => {
    await db.collection("count_rounds").doc("cr_rua_a").set({ id: "cr_rua_a", customer_code: BTG, title: "Contagem da rua A · 19/11/2026", scope: "aisle", aisle: "A", status: "open" });
    assert.deepEqual((await previa()).bloqueio, { code: "BOX_MOVE_COUNT_ROUND_OPEN", message: "A-01 está na contagem «Contagem da rua A · 19/11/2026»: conclua a contagem antes de mover." });
    await db.collection("warehouse_boxes").doc("CX-000150").set({ code: "CX-000150", customer_code: BTG, status: "stored", location_id: "A-01", ...MEDIDAS, support_box_code: "CX-000121" });
    assert.equal((await previa()).bloqueio?.code, "BOX_MOVE_SUPPORTS_ANOTHER");
    await db.collection("opening_inventory_sessions").doc(SESSAO).update({ status: "open" });
    assert.equal((await previa()).bloqueio?.code, "BOX_MOVE_OPENING_OPEN");
    await db.collection("warehouse_boxes").doc("CX-000121").update({ status: "committing" });
    assert.equal((await previa()).bloqueio?.code, "BOX_MOVE_BOX_NOT_STORED");
  });

  it("a contagem por rua tira a rua da lista", async () => {
    await db.collection("count_rounds").doc("cr_rua_c").set({ id: "cr_rua_c", customer_code: BTG, title: "Contagem da rua C · 19/11/2026", scope: "aisle", aisle: "C", status: "open" });
    const resultado = await previa();
    assert.equal(resultado.bloqueio, null);
    assert.deepEqual(resultado.em_contagem, ["C-02"]);
    assert.deepEqual(resultado.prateleiras.map((destino) => destino.code), ["B-09", "A-02", "B-10"]);
  });

  it("a prévia não grava e recusa a caixa de outro cliente", async () => {
    const contar = async () => Promise.all(["operational_operations", "events", "movements", "warehouse_boxes", "stock_balances"].map(async (colecao) => (await db.collection(colecao).get()).size));
    const antes = await contar();
    await previa();
    assert.deepEqual(await contar(), antes);
    await db.collection("warehouse_boxes").doc("CX-000500").set({ code: "CX-000500", customer_code: "Itaú", status: "stored", location_id: "Z-01", ...MEDIDAS });
    assert.equal((await recusa(previa("CX-000500"))).code, "permission-denied");
    assert.equal(codigoDa(await recusa(previa("CX-000999"))), "BOX_MOVE_BOX_NOT_FOUND");
  });
});

