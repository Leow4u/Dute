import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type DocumentData, type Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";

import { entradaDaRecontagem, recountWarehouseBoxTransaction } from "./box-recount.js";
import {
  LEGACY_ROUND_ID,
  LEGACY_ROUND_TITLE,
  ROUND_STARTED_EVENT_TYPE,
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
function iniciar(alcance: { scope: EscopoDaRodada; aisle?: string; sku_code?: string }, opcoes: { chave?: string; ator?: OperationalActor; cliente?: string } = {}) {
  return startCountRoundTransaction(db, entradaDoInicio({ customer_code: opcoes.cliente ?? BTG, idempotency_key: opcoes.chave ?? chave(), ...alcance }), opcoes.ator ?? guilherme) as Promise<Inicio>;
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
