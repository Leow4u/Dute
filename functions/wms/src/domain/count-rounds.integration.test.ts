import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type DocumentData, type Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";

import { entradaDaRecontagem, recountWarehouseBoxTransaction } from "./box-recount.js";
import {
  LEGACY_ROUND_ID,
  LEGACY_ROUND_TITLE,
  ROUND_CLOSED_EVENT_TYPE,
  ROUND_STARTED_EVENT_TYPE,
  completeCountRoundTransaction,
  entradaDaConclusao,
  entradaDoInicio,
  startCountRoundTransaction,
  type EscopoDaRodada,
} from "./count-rounds.js";
import { clientScopedInventoryId, type OperationalActor } from "./operations.js";

/**
 * A rodada da contagem no emulador (docs/superpowers/specs/2026-11-18-registro-da-rodada-design.md):
 * iniciar (uma aberta por cliente, com o título do servidor, o recibo e o
 * evento), concluir (os números das recontagens da rodada) e a recontagem
 * geral de 17/11/2026, que vira documento ao concluir.
 *
 * A BTG tem a CX-000010 (abertura, 60 polos P) em A-03 e a CX-000014
 * (recebimento, 50 polos P) em B-01; o saldo das prateleiras bate com elas.
 */

const PROJECT_ID = "demo-dute-operations";
const BTG = "BTG Pactual";
const OUTRO = "Outro Cliente";
const POLO_P = "BTG-000122";
const CAMISA_OUTRO = "OUT-000001";
const BONE = "BTG-000200";

const guilherme: OperationalActor = { uid: "wms-1", email: "guilherme@dutelog.com.br", name: "Guilherme Dantas", role: "wms", customer_code: "Dutelog" };
const rafael: OperationalActor = { uid: "wms-2", email: "rafael@dutelog.com.br", name: "Rafael", role: "wms", customer_code: "Dutelog" };

const DIA_EM_SAO_PAULO = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric" });

let db: Firestore;
let app: ReturnType<typeof initializeApp>;

before(() => {
  app = initializeApp({ projectId: PROJECT_ID }, "count-rounds-test");
  db = getFirestore(app);
});

after(async () => {
  await deleteApp(app);
});

function cadastro(sku: string, cliente: string, nome: { cod_cliente: string; produto: string; tamanho: string }) {
  return Promise.all([
    db.collection("skus").doc(sku).set({ id: sku, customer_code: cliente, cod_btg: sku, sku_code: sku, sku_code_key: sku, cod_cliente: nome.cod_cliente, cod_cliente_key: nome.cod_cliente, produto: nome.produto, tamanho: nome.tamanho, status: "active", estoque_atual: 0 }),
    db.collection("products").doc(nome.cod_cliente).set({ id: nome.cod_cliente, customer_code: cliente, cod_cliente: nome.cod_cliente, cod_cliente_key: nome.cod_cliente, produto: nome.produto, status: "active", estoque_btg: 0 }),
  ]);
}

function saldo(sku: string, location: string, qty: number) {
  const id = `bal_${sku}_${location}`;
  return db.collection("stock_balances").doc(id).set({ id, customer_code: BTG, sku_code: sku, client_item_code: "A.01.0806.005.P", product_name: "Polo Masculino Piquet Preto", size: "P", location_id: location, qty_on_hand: qty, qty_reserved: 0, qty_available: qty, status: "available" });
}

function caixa(code: string, location: string, storedAt: string, qty: number, origem: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return db.collection("warehouse_boxes").doc(code).set({ id: code, code, customer_code: BTG, status: "stored", location_id: location, stored_at: storedAt, unit_count: qty, line_count: 1, sku_codes: [POLO_P], origin: origem, ...extra });
}

beforeEach(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error("FIRESTORE_EMULATOR_HOST não definido.");
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
  const posicao = (code: string, shelf: number) =>
    db.collection("warehouse_positions").doc(code).set({ code, aisle: code.split("-")[0], shelf, sequence: shelf, length_m: 1.8, depth_m: 0.75, height_m: 0.65, customer_code: BTG, status: "active" });
  await Promise.all([
    db.collection("customers").doc("BTG_Pactual").set({ code: BTG, customer_code: BTG, name: BTG, sku_prefix: "BTG", status: "active" }),
    db.collection("customers").doc("Outro_Cliente").set({ code: OUTRO, customer_code: OUTRO, name: OUTRO, sku_prefix: "OUT", status: "active" }),
    posicao("A-03", 3),
    posicao("B-01", 1),
    // A rua C existe no mapa, sem caixa da BTG; o Outro Cliente tem uma caixa guardada em C-02.
    posicao("C-01", 1),
    db.collection("warehouse_boxes").doc("CX-000090").set({ id: "CX-000090", code: "CX-000090", customer_code: OUTRO, status: "stored", location_id: "C-02", stored_at: "2026-11-06T15:00:00.000Z", unit_count: 10, line_count: 1, sku_codes: [CAMISA_OUTRO], origin: { kind: "receipt", receipt_id: "inb_9" } }),
    // O boné está no cadastro da BTG, sem caixa guardada.
    cadastro(BONE, BTG, { cod_cliente: "C.0900.001.U", produto: "Boné Preto", tamanho: "U" }),
    cadastro(POLO_P, BTG, { cod_cliente: "A.01.0806.005.P", produto: "Polo Masculino Piquet Preto", tamanho: "P" }),
    cadastro(CAMISA_OUTRO, OUTRO, { cod_cliente: "C.01", produto: "Camisa Social", tamanho: "M" }),
    caixa("CX-000010", "A-03", "2026-10-20T12:00:00.000Z", 60, { kind: "opening_inventory", session_id: "opening_BTG_Pactual" }),
    db
      .collection("opening_inventory_lines")
      .doc("oil_CX-000010")
      .set({ session_id: "opening_BTG_Pactual", customer_code: BTG, sku_code: POLO_P, client_item_code: "A.01.0806.005.P", product_name: "Polo Masculino Piquet Preto", size: "P", location_id: "A-03", box_code: "CX-000010", counted_qty: 60, status: "counted" }),
    caixa("CX-000014", "B-01", "2026-11-06T15:00:00.000Z", 50, { kind: "receipt", receipt_id: "inb_1", invoice_number: "48.377" }, {
      lines: [{ inbound_item_id: "ini_1", line_number: 1, sku_code: POLO_P, client_item_code: "A.01.0806.005.P", product_name: "Polo Masculino Piquet Preto", size: "P", counted_qty: 50 }],
    }),
    saldo(POLO_P, "A-03", 60),
    saldo(POLO_P, "B-01", 50),
    db.collection("client_inventory").doc(clientScopedInventoryId(BTG, POLO_P)).set({ customer_code: BTG, sku_code: POLO_P, qty_on_hand: 110, qty_reserved: 0, qty_available: 110, qty_receiving: 0 }),
  ]);
});

let chaves = 0;
function chave(prefixo = "rodada") {
  chaves += 1;
  return `${prefixo}-${String(chaves).padStart(6, "0")}`;
}

type Inicio = Record<string, unknown> & { round_id: string; title: string; status: string; started_at: string };
type Conclusao = Record<string, unknown> & {
  round_id: string;
  title: string;
  status: string;
  started_at: string;
  closed_at: string;
  shelves_total: number;
  shelves_counted: number;
  boxes_total: number;
  boxes_counted: number;
  boxes_with_difference: number;
  difference_units: number;
  recount_count: number;
};

function iniciar(alcance: { scope: EscopoDaRodada; aisle?: string; sku_code?: string }, opcoes: { chave?: string; ator?: OperationalActor; cliente?: string } = {}) {
  return startCountRoundTransaction(db, entradaDoInicio({ customer_code: opcoes.cliente ?? BTG, idempotency_key: opcoes.chave ?? chave(), ...alcance }), opcoes.ator ?? guilherme) as Promise<Inicio>;
}

function concluir(roundId: string, opcoes: { chave?: string; ator?: OperationalActor; cliente?: string } = {}) {
  return completeCountRoundTransaction(db, entradaDaConclusao({ customer_code: opcoes.cliente ?? BTG, round_id: roundId, idempotency_key: opcoes.chave ?? chave("concluir") }), opcoes.ator ?? guilherme) as Promise<Conclusao>;
}

function recontar(entrada: Record<string, unknown>, ator: OperationalActor = guilherme) {
  return recountWarehouseBoxTransaction(db, entradaDaRecontagem({ customer_code: BTG, idempotency_key: chave("recontar"), ...entrada }), ator);
}

async function recusa(acao: Promise<unknown>): Promise<HttpsError> {
  try {
    await acao;
  } catch (error) {
    assert.ok(error instanceof HttpsError, String(error));
    return error;
  }
  assert.fail("a chamada passou");
}

function codigoDa(erro: HttpsError): unknown {
  return (erro.details as { code?: unknown } | undefined)?.code;
}

async function rodada(id: string): Promise<DocumentData> {
  return (await db.collection("count_rounds").doc(id).get()).data() ?? {};
}

async function todos(colecao: string) {
  return (await db.collection(colecao).get()).docs.map((doc) => ({ id: doc.id, ...doc.data() }) as Record<string, unknown>);
}

async function eventos(tipo: string) {
  return (await todos("events")).filter((evento) => evento.type === tipo);
}

describe("Iniciar a rodada", () => {
  it("cria a rodada aberta com o título, o recibo e o evento; a mesma chave devolve o mesmo resultado sem gravar de novo", async () => {
    const primeira = await iniciar({ scope: "general" }, { chave: "rodada-fixa-000001" });
    assert.match(primeira.round_id, /^cr_[0-9a-f]{24}$/);
    assert.equal(primeira.title, `Contagem geral · ${DIA_EM_SAO_PAULO.format(new Date())}`);
    assert.equal(primeira.status, "open");
    const doc = await rodada(primeira.round_id);
    assert.equal(doc.status, "open");
    assert.equal(doc.customer_code, BTG);
    assert.equal(doc.scope, "general");
    assert.equal(doc.title, primeira.title);
    assert.equal(doc.started_at, primeira.started_at);
    assert.equal((doc.started_by as { name?: string }).name, "Guilherme Dantas");
    const [evento] = await eventos(ROUND_STARTED_EVENT_TYPE);
    assert.equal(evento?.title, "Contagem iniciada");
    assert.equal(evento?.description, primeira.title);
    assert.equal((evento?.payload as { round_id?: string }).round_id, primeira.round_id);
    assert.equal((await todos("operational_operations")).length, 1);
    assert.equal((await todos("ai_agent_inbox")).length, 0);

    const repetida = await iniciar({ scope: "general" }, { chave: "rodada-fixa-000001" });
    assert.deepEqual(repetida, primeira);
    assert.equal((await todos("count_rounds")).length, 1);
    assert.equal((await recusa(startCountRoundTransaction(db, entradaDoInicio({ customer_code: BTG, scope: "aisle", aisle: "A", idempotency_key: "rodada-fixa-000001" }), guilherme))).code, "already-exists");
  });

  it("uma rodada aberta por cliente: a segunda recusa com o título da primeira; outro cliente pode", async () => {
    const primeira = await iniciar({ scope: "aisle", aisle: "A" });
    const erro = await recusa(iniciar({ scope: "general" }));
    assert.equal(erro.code, "failed-precondition");
    assert.equal(codigoDa(erro), "COUNT_ROUND_ALREADY_OPEN");
    assert.equal(erro.message, `A contagem «${primeira.title}» está em andamento: conclua-a antes de iniciar outra.`);
    const doOutro = await iniciar({ scope: "general" }, { cliente: OUTRO });
    assert.equal((await rodada(doOutro.round_id)).customer_code, OUTRO);
    assert.equal((await todos("count_rounds")).length, 2);
  });

  it("por rua, a rua precisa existir; por item, o item precisa ser do cliente, e o título leva o nome e o tamanho", async () => {
    const semRua = await recusa(iniciar({ scope: "aisle", aisle: "Z" }));
    assert.equal(codigoDa(semRua), "COUNT_ROUND_AISLE_NOT_FOUND");
    assert.equal(semRua.message, "A rua Z não está no cadastro de Posições.");
    assert.equal(codigoDa(await recusa(iniciar({ scope: "item", sku_code: "BTG-999999" }))), "COUNT_ROUND_PRODUCT_NOT_FOUND");
    assert.equal(codigoDa(await recusa(iniciar({ scope: "item", sku_code: CAMISA_OUTRO }))), "CATALOG_OWNED_BY_OTHER_CUSTOMER");
    assert.equal((await todos("count_rounds")).length, 0);

    const porItem = await iniciar({ scope: "item", sku_code: POLO_P });
    assert.equal(porItem.title, `Contagem de Polo Masculino Piquet Preto · P · ${DIA_EM_SAO_PAULO.format(new Date())}`);
    const doc = await rodada(porItem.round_id);
    assert.equal(doc.sku_code, POLO_P);
    assert.deepEqual(doc.item, { client_item_code: "A.01.0806.005.P", product_name: "Polo Masculino Piquet Preto", size: "P" });
  });

  it("a recontagem geral de 17/11 sem documento, com recontagem gravada, impede iniciar outra", async () => {
    await recontar({ box_code: "CX-000010", location_id: "A-03", lines: [{ sku_code: POLO_P, counted_qty: 60 }], round_id: LEGACY_ROUND_ID });
    const erro = await recusa(iniciar({ scope: "general" }));
    assert.equal(codigoDa(erro), "COUNT_ROUND_LEGACY_OPEN");
    assert.equal(erro.message, `A ${LEGACY_ROUND_TITLE} está em andamento: conclua-a antes de iniciar outra.`);
    // De outro cliente, a recontagem geral da BTG não impede.
    await iniciar({ scope: "general" }, { cliente: OUTRO });
  });
});

describe("Iniciar a rodada: o alcance vazio e a recontagem geral de outro cliente", () => {
  it("o alcance sem caixa guardada do cliente recusa: a rua sem caixa, o item sem caixa, o cliente sem caixa", async () => {
    const semRua = await recusa(iniciar({ scope: "aisle", aisle: "C" }));
    assert.equal(codigoDa(semRua), "COUNT_ROUND_EMPTY_SCOPE");
    assert.equal(semRua.message, "Nenhuma caixa guardada do cliente na rua C.");
    const semItem = await recusa(iniciar({ scope: "item", sku_code: BONE }));
    assert.equal(codigoDa(semItem), "COUNT_ROUND_EMPTY_SCOPE");
    assert.equal(semItem.message, "Nenhuma caixa guardada com Boné Preto.");
    const semCaixa = await recusa(iniciar({ scope: "general" }, { cliente: "Cliente Sem Caixa" }));
    assert.equal(codigoDa(semCaixa), "COUNT_ROUND_EMPTY_SCOPE");
    assert.equal(semCaixa.message, "Nenhuma caixa guardada do cliente: não há prateleira para contar.");
    assert.equal((await todos("count_rounds")).length, 0);
  });

  it("a recontagem geral de 17/11 é da BTG: outro cliente com recontagem no id fixo não fica preso nela", async () => {
    await db.collection("cycle_counts").doc("cc_outro_legado").set({ id: "cc_outro_legado", customer_code: OUTRO, sku_code: CAMISA_OUTRO, location_id: "C-02", box_code: "CX-000090", mode: "box", box_recount_id: "brc_outro", round_id: LEGACY_ROUND_ID, qty_before: 10, counted_qty: 10, adjustment_delta: 0, status: "completed", occurred_at: "2026-11-17T12:00:00.000Z" });
    const nova = await iniciar({ scope: "general" }, { cliente: OUTRO });
    assert.equal((await rodada(nova.round_id)).customer_code, OUTRO);
    const legada = await recusa(concluir(LEGACY_ROUND_ID, { cliente: OUTRO }));
    assert.equal(legada.code, "not-found");
    assert.equal(codigoDa(legada), "COUNT_ROUND_NOT_FOUND");
    assert.equal((await rodada(LEGACY_ROUND_ID)).status, undefined);
  });
});

describe("Concluir a rodada", () => {
  it("fecha com os números das recontagens da rodada, o recibo e o evento; repetir a chave devolve o mesmo", async () => {
    const aberta = await iniciar({ scope: "general" });
    await recontar({ box_code: "CX-000010", location_id: "A-03", lines: [{ sku_code: POLO_P, counted_qty: 57 }], round_id: aberta.round_id });
    const concluida = await concluir(aberta.round_id, { chave: "concluir-fixa-000001" });
    assert.equal(concluida.status, "closed");
    assert.equal(concluida.title, aberta.title);
    assert.deepEqual(
      [concluida.shelves_total, concluida.shelves_counted, concluida.boxes_total, concluida.boxes_counted, concluida.boxes_with_difference, concluida.difference_units, concluida.recount_count],
      [2, 1, 2, 1, 1, -3, 1],
    );
    const doc = await rodada(aberta.round_id);
    assert.equal(doc.status, "closed");
    assert.equal(doc.closed_at, concluida.closed_at);
    assert.equal((doc.closed_by as { name?: string }).name, "Guilherme Dantas");
    assert.equal(doc.started_at, aberta.started_at);
    assert.equal(doc.difference_units, -3);
    const [evento] = await eventos(ROUND_CLOSED_EVENT_TYPE);
    assert.equal(evento?.title, "Contagem concluída");
    assert.equal(evento?.description, "1 de 2 prateleiras · 1 de 2 caixas · 1 com diferença · −3 un.");
    // O aviso na caixa antiga é da recontagem com diferença; o fim da rodada não abre outro.
    assert.equal((await todos("ai_agent_inbox")).filter((aviso) => aviso.event_id === evento?.id).length, 0);
    assert.deepEqual(await concluir(aberta.round_id, { chave: "concluir-fixa-000001" }), concluida);
    assert.equal((await eventos(ROUND_CLOSED_EVENT_TYPE)).length, 1);
    assert.equal((await todos("operational_operations")).filter((recibo) => recibo.kind === "inventory.count_round.complete").length, 1);
  });

  // A caixa que cede a última peça ao fora da lista de outra fica guardada sem nada na lista até alguém contá-la vazia
  // (decisão de 17/11/2026), como a da abertura que perdeu as linhas. Contada vazia, ela não grava linha em
  // `cycle_counts` (não há item), e antes ficava fora das confirmadas: a prateleira nunca fechava (a A-01 e a A-02 da
  // recontagem geral de 17/11, na produção, com caixas da abertura sem linhas).
  it("a caixa que cedeu a última peça e foi contada vazia conta como confirmada no fechamento, sem diferença", async () => {
    // A A-03 ganha a CX-000011 (recebimento, 5 bonés), guardada depois da CX-000010.
    await Promise.all([
      caixa("CX-000011", "A-03", "2026-11-06T15:00:00.000Z", 5, { kind: "receipt", receipt_id: "inb_2", invoice_number: "48.400" }, {
        sku_codes: [BONE],
        lines: [{ inbound_item_id: "ini_2", line_number: 1, sku_code: BONE, client_item_code: "C.0900.001.U", product_name: "Boné Preto", size: "U", counted_qty: 5 }],
      }),
      db.collection("stock_balances").doc(`bal_${BONE}_A-03`).set({ id: `bal_${BONE}_A-03`, customer_code: BTG, sku_code: BONE, client_item_code: "C.0900.001.U", product_name: "Boné Preto", size: "U", location_id: "A-03", qty_on_hand: 5, qty_reserved: 0, qty_available: 5, status: "available" }),
    ]);
    const aberta = await iniciar({ scope: "general" });
    // Os 60 polos da CX-000010 estavam na CX-000011: o fora da lista os tira da CX-000010, que fica guardada sem nada.
    await recontar({ box_code: "CX-000011", location_id: "A-03", lines: [{ sku_code: BONE, counted_qty: 5 }], extra_lines: [{ sku_code: POLO_P, counted_qty: 60 }], round_id: aberta.round_id });
    assert.equal((await db.collection("warehouse_boxes").doc("CX-000010").get()).get("status"), "stored");
    // Contada vazia, com a lista vazia: a caixa sai da prateleira, e nenhuma linha nasce.
    const vazia = (await recontar({ box_code: "CX-000010", location_id: "A-03", lines: [], round_id: aberta.round_id })) as Record<string, unknown>;
    assert.deepEqual([vazia.status, vazia.difference_units, vazia.cycle_count_ids], ["emptied", 0, []]);
    await recontar({ box_code: "CX-000014", location_id: "B-01", lines: [{ sku_code: POLO_P, counted_qty: 50 }], round_id: aberta.round_id }, rafael);
    assert.equal((await todos("cycle_counts")).filter((linha) => linha.box_code === "CX-000010").length, 0);

    const concluida = await concluir(aberta.round_id);
    // As duas prateleiras contadas, com as três caixas confirmadas; a única diferença é a da CX-000011 (+60, as peças que
    // vieram da CX-000010), e a CX-000010 entra sem diferença.
    assert.deepEqual(
      [concluida.shelves_total, concluida.shelves_counted, concluida.boxes_total, concluida.boxes_counted, concluida.boxes_with_difference, concluida.difference_units, concluida.recount_count],
      [2, 2, 3, 3, 1, 60, 3],
    );
    assert.equal((await eventos(ROUND_CLOSED_EVENT_TYPE))[0]?.description, "2 prateleiras · 3 caixas · 1 com diferença · +60 un.");
  });

  it("concluída, não conclui de novo; de outro cliente, permission-denied; inexistente, not-found", async () => {
    const aberta = await iniciar({ scope: "general" });
    await concluir(aberta.round_id);
    const deNovo = await recusa(concluir(aberta.round_id));
    assert.equal(deNovo.code, "failed-precondition");
    assert.equal(codigoDa(deNovo), "COUNT_ROUND_NOT_OPEN");
    assert.equal(deNovo.message, `A contagem «${aberta.title}» já foi concluída.`);
    const outra = await iniciar({ scope: "general" }, { cliente: OUTRO });
    assert.equal((await recusa(concluir(outra.round_id))).code, "permission-denied");
    const inexistente = await recusa(concluir("cr_000000000000000000000000"));
    assert.equal(inexistente.code, "not-found");
    assert.equal(codigoDa(inexistente), "COUNT_ROUND_NOT_FOUND");
    // Concluída, outra pode começar.
    await iniciar({ scope: "aisle", aisle: "B" });
  });

  it("a recontagem geral de 17/11, sem documento: concluir cria o documento concluído com o começo da primeira recontagem", async () => {
    await recontar({ box_code: "CX-000010", location_id: "A-03", lines: [{ sku_code: POLO_P, counted_qty: 60 }], round_id: LEGACY_ROUND_ID }, rafael);
    await recontar({ box_code: "CX-000014", location_id: "B-01", lines: [{ sku_code: POLO_P, counted_qty: 48 }], round_id: LEGACY_ROUND_ID });
    const concluida = await concluir(LEGACY_ROUND_ID);
    assert.equal(concluida.title, LEGACY_ROUND_TITLE);
    assert.deepEqual([concluida.shelves_total, concluida.shelves_counted, concluida.boxes_total, concluida.boxes_counted, concluida.boxes_with_difference, concluida.difference_units, concluida.recount_count], [2, 2, 2, 2, 1, -2, 2]);
    const doc = await rodada(LEGACY_ROUND_ID);
    assert.equal(doc.scope, "general");
    assert.equal(doc.status, "closed");
    assert.equal(doc.customer_code, BTG);
    assert.equal((doc.started_by as { name?: string }).name, "Rafael");
    const primeira = (await todos("cycle_counts")).map((linha) => String(linha.occurred_at)).sort()[0];
    assert.equal(doc.started_at, primeira);
    // Concluída, a recontagem geral deixa de valer como rodada: iniciar outra passa.
    await iniciar({ scope: "general" });
  });

  it("a recontagem geral sem recontagem nenhuma não é rodada: not-found", async () => {
    const erro = await recusa(concluir(LEGACY_ROUND_ID));
    assert.equal(erro.code, "not-found");
    assert.equal(codigoDa(erro), "COUNT_ROUND_NOT_FOUND");
    assert.equal((await todos("count_rounds")).length, 0);
  });
});
