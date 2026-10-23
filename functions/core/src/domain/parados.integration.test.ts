import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { Timestamp, getFirestore, type Firestore } from "firebase-admin/firestore";

import { AI_CURSORS_COLLECTION, MOVEMENTS_COLLECTION } from "./cursor.js";
import { AI_STOCK_AGE_COLLECTION, CURSOR_DOS_PARADOS, STOCK_BALANCES_COLLECTION, VERSAO_DOS_PARADOS, idDoItemParado, runStockAgeFor } from "./parados-gravacao.js";
import { idadeDoItem, regraDoModelo } from "./parados.js";

/**
 * A rotina dos dias parado no emulador (parte 5.4a). Lê o razão do começo e
 * grava, por cliente e SKU, o relógio dos movimentos que contam e o saldo das
 * posições; a guarda e a contagem cíclica mudam o saldo, não o relógio. O
 * mesmo SKU em dois clientes são dois itens. Ler de novo não muda nada, e o
 * movimento do último minuto espera. Dados sintéticos.
 */

const PROJECT_ID = "demo-dute-core";

let db: Firestore;
let app: ReturnType<typeof initializeApp>;

before(() => {
  app = initializeApp({ projectId: PROJECT_ID }, "core-parados-test");
  db = getFirestore(app);
});

after(async () => {
  await deleteApp(app);
});

const AGORA = "2026-10-20T12:00:00.000Z";
const agora = (iso: string) => () => new Date(iso);

function movimento(customer: string | null, sku: string, source: string, tipo: "ENTRADA" | "SAIDA", ocorrido: string, criado: string) {
  return {
    customer_code: customer,
    sku_code: sku,
    client_item_code: `${sku}-CLI`,
    product_name: `Produto ${sku}`,
    source,
    tipo_mov: tipo,
    quantity: 1,
    occurred_at: ocorrido,
    data: ocorrido,
    location_id: "A-01",
    created_at: Timestamp.fromDate(new Date(criado)),
  };
}

beforeEach(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error("FIRESTORE_EMULATOR_HOST não definido.");
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
  const batch = db.batch();
  const set = (path: string, data: Record<string, unknown>) => batch.set(db.doc(path), data);
  // O SKU-1 do Itaú entrou na abertura em abril e saiu em julho; a guarda de ontem só mudou o lugar.
  set(`${MOVEMENTS_COLLECTION}/mov_01`, movimento("ITAU", "SKU-1", "functions_opening_inventory", "ENTRADA", "2026-04-03T15:00:00.000Z", "2026-10-20T09:00:00.000Z"));
  set(`${MOVEMENTS_COLLECTION}/mov_02`, movimento("ITAU", "SKU-1", "wms_shipping", "SAIDA", "2026-07-12T15:00:00.000Z", "2026-10-20T09:01:00.000Z"));
  set(`${MOVEMENTS_COLLECTION}/mov_03`, movimento("ITAU", "SKU-1", "wms_putaway", "ENTRADA", "2026-10-19T15:00:00.000Z", "2026-10-20T09:02:00.000Z"));
  // O mesmo código no Safra é outro item.
  set(`${MOVEMENTS_COLLECTION}/mov_04`, movimento("SAFRA", "SKU-1", "wms_receiving", "ENTRADA", "2026-10-10T15:00:00.000Z", "2026-10-20T09:03:00.000Z"));
  // A contagem cíclica do SKU-2 corrige o saldo e não conta no relógio.
  set(`${MOVEMENTS_COLLECTION}/mov_05`, movimento("ITAU", "SKU-2", "functions_cycle_count", "ENTRADA", "2026-10-18T15:00:00.000Z", "2026-10-20T09:04:00.000Z"));
  // Sem cliente, o movimento não é de ninguém.
  set(`${MOVEMENTS_COLLECTION}/mov_06`, movimento(null, "SKU-9", "wms_receiving", "ENTRADA", "2026-10-18T15:00:00.000Z", "2026-10-20T09:05:00.000Z"));
  // O recebimento do último minuto espera a próxima vez.
  set(`${MOVEMENTS_COLLECTION}/mov_07`, movimento("ITAU", "SKU-1", "wms_receiving", "ENTRADA", "2026-10-20T11:59:30.000Z", "2026-10-20T11:59:30.000Z"));
  set(`${STOCK_BALANCES_COLLECTION}/bal_1`, { customer_code: "ITAU", sku_code: "SKU-1", location_id: "A-01", qty_on_hand: 20 });
  set(`${STOCK_BALANCES_COLLECTION}/bal_2`, { customer_code: "ITAU", sku_code: "SKU-1", location_id: "DOCA", qty_on_hand: 10 });
  set(`${STOCK_BALANCES_COLLECTION}/bal_3`, { customer_code: "SAFRA", sku_code: "SKU-1", location_id: "B-01", qty_on_hand: 5 });
  set(`${STOCK_BALANCES_COLLECTION}/bal_4`, { customer_code: "ITAU", sku_code: "SKU-2", location_id: "A-02", qty_on_hand: 3 });
  set(`${STOCK_BALANCES_COLLECTION}/bal_5`, { customer_code: "ITAU", sku_code: "SKU-2", location_id: "A-03", qty_on_hand: 0 });
  await batch.commit();
});

async function itens() {
  return Object.fromEntries((await db.collection(AI_STOCK_AGE_COLLECTION).get()).docs.map((doc) => [doc.id, doc.data()]));
}

async function tudoMenosAMemoria() {
  const colecoes = (await db.listCollections()).filter((colecao) => ![AI_STOCK_AGE_COLLECTION, AI_CURSORS_COLLECTION].includes(colecao.id));
  const docs = await Promise.all(colecoes.map(async (colecao) => (await colecao.get()).docs.map((doc) => [doc.ref.path, doc.data()])));
  return Object.fromEntries(docs.flat());
}

const ITAU_1 = idDoItemParado("ITAU", "SKU-1");
const SAFRA_1 = idDoItemParado("SAFRA", "SKU-1");
const ITAU_2 = idDoItemParado("ITAU", "SKU-2");

describe("a rotina dos dias parado", () => {
  it("lê o razão do começo: o relógio dos movimentos que contam e o saldo das posições, por cliente e SKU; não grava fora da memória", async () => {
    const antes = await tudoMenosAMemoria();
    const resultado = await runStockAgeFor(db, { agora: agora(AGORA) });
    assert.deepEqual(resultado, { movimentos: 6, itens: 3, gravados: 3 });
    assert.deepEqual(await tudoMenosAMemoria(), antes);

    const gravados = await itens();
    assert.deepEqual(Object.keys(gravados).sort(), [ITAU_1, ITAU_2, SAFRA_1].sort());
    assert.deepEqual(gravados[ITAU_1], {
      tipo: "item",
      customer_code: "ITAU",
      sku_code: "SKU-1",
      client_item_code: "SKU-1-CLI",
      product_name: "Produto SKU-1",
      saldo: 30,
      relogio: { primeira_entrada: "2026-04-03T15:00:00.000Z", ultima_entrada: "2026-04-03T15:00:00.000Z", ultima_saida: "2026-07-12T15:00:00.000Z" },
      calculada_em: AGORA,
    });
    assert.deepEqual(gravados[SAFRA_1]?.relogio, { primeira_entrada: "2026-10-10T15:00:00.000Z", ultima_entrada: "2026-10-10T15:00:00.000Z", ultima_saida: null });
    assert.equal(gravados[SAFRA_1]?.saldo, 5);
    assert.deepEqual(gravados[ITAU_2]?.relogio, { primeira_entrada: null, ultima_entrada: null, ultima_saida: null });
    assert.equal(gravados[ITAU_2]?.saldo, 3);

    // A etiqueta sai da regra do modelo, na hora: o SKU-1 do Itaú não se mexe desde julho.
    const regra = regraDoModelo("uniformes");
    assert.deepEqual(idadeDoItem(gravados[ITAU_1]?.relogio, gravados[ITAU_1]?.saldo, regra, "2026-10-20"), { dias_parado: 100, dias_sem_saida: 100, etiquetas: ["parado"] });
    assert.deepEqual(idadeDoItem(gravados[SAFRA_1]?.relogio, gravados[SAFRA_1]?.saldo, regra, "2026-10-20").etiquetas, []);

    const cursor = (await db.collection(AI_CURSORS_COLLECTION).doc(CURSOR_DOS_PARADOS).get()).data();
    assert.equal(cursor?.evento_id, "mov_06");
    assert.equal(cursor?.versao, VERSAO_DOS_PARADOS);
  });

  it("depois do cursor, só o movimento novo; o do último minuto entra na vez seguinte", async () => {
    await runStockAgeFor(db, { agora: agora(AGORA) });
    assert.deepEqual(await runStockAgeFor(db, { agora: agora(AGORA) }), { movimentos: 0, itens: 0, gravados: 0 });

    await db.doc(`${STOCK_BALANCES_COLLECTION}/bal_1`).update({ qty_on_hand: 30 });
    const depois = "2026-10-20T12:05:00.000Z";
    assert.deepEqual(await runStockAgeFor(db, { agora: agora(depois) }), { movimentos: 1, itens: 1, gravados: 1 });
    const item = (await itens())[ITAU_1];
    assert.equal(item?.saldo, 40);
    assert.equal(item?.relogio.ultima_entrada, "2026-10-20T11:59:30.000Z");
    assert.equal(item?.relogio.primeira_entrada, "2026-04-03T15:00:00.000Z");
    assert.deepEqual(idadeDoItem(item?.relogio, item?.saldo, regraDoModelo("uniformes"), "2026-10-20").etiquetas, []);
  });

  it("ler o razão de novo, sem cursor ou com o de outra versão, não muda nada", async () => {
    const depois = "2026-10-20T12:05:00.000Z";
    await runStockAgeFor(db, { agora: agora(depois) });
    const gravados = await itens();

    await db.collection(AI_CURSORS_COLLECTION).doc(CURSOR_DOS_PARADOS).delete();
    assert.deepEqual(await runStockAgeFor(db, { agora: agora(depois) }), { movimentos: 7, itens: 3, gravados: 0 });

    await db.collection(AI_CURSORS_COLLECTION).doc(CURSOR_DOS_PARADOS).set({ created_at: Timestamp.fromDate(new Date(depois)), evento_id: "mov_99", versao: VERSAO_DOS_PARADOS - 1 });
    assert.deepEqual(await runStockAgeFor(db, { agora: agora(depois) }), { movimentos: 7, itens: 3, gravados: 0 });
    assert.deepEqual(await itens(), gravados);
  });

  it("o razão maior que um lote é lido inteiro na mesma vez", async () => {
    const batch = db.batch();
    for (let indice = 0; indice < 310; indice += 1) {
      const criado = new Date(Date.parse("2026-10-20T10:00:00.000Z") + indice * 1000).toISOString();
      batch.set(db.doc(`${MOVEMENTS_COLLECTION}/lote_${String(indice).padStart(3, "0")}`), movimento("ITAU", "SKU-3", "wms_shipping", "SAIDA", criado, criado));
    }
    await batch.commit();
    const resultado = await runStockAgeFor(db, { agora: agora(AGORA) });
    assert.equal(resultado.movimentos, 316);
    assert.equal((await itens())[idDoItemParado("ITAU", "SKU-3")]?.relogio.ultima_saida, "2026-10-20T10:05:09.000Z");
  });
});
