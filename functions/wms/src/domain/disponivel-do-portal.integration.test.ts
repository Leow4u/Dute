import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

import {
  CONTROLE_DO_RECALCULO,
  ESPERA_MINIMA_MS,
  VERSAO_DO_RECALCULO,
  recalcularDisponivelDoPortal,
} from "./disponivel-do-portal.js";

/**
 * O recálculo do disponível do portal (recebimento com caixas, parte 7c), no
 * emulador: a projeção que não teve escrita nova desde a parte 7 ainda tem o
 * disponível de antes, que contava todos os locais; a rotina o refaz pelos
 * saldos, sem mexer no total, na reserva nem no resto da projeção, e só se dá
 * por feita com uma passada limpa depois da espera mínima.
 */

const PROJECT_ID = "demo-dute-operations";
const BTG = "BTG Pactual";
const OUTRO = "Outro Cliente";
const LEGADO = "BTG-1043";
const T0 = new Date("2026-11-02T12:00:00.000Z");
const DEPOIS = new Date(T0.getTime() + ESPERA_MINIMA_MS + 60_000);

let db: Firestore;
let app: ReturnType<typeof initializeApp>;

function saldo(id: string, skuCode: string, locationId: string, quantity: number, reserved = 0, clientItemCode?: string, customer = BTG) {
  return db.collection("stock_balances").doc(id).set({
    id,
    customer_code: customer,
    sku_code: skuCode,
    ...(clientItemCode ? { client_item_code: clientItemCode } : {}),
    location_id: locationId,
    qty_on_hand: quantity,
    qty_reserved: reserved,
    qty_available: quantity - reserved,
  });
}

function projecao(id: string, skuCode: string, campos: Record<string, unknown>) {
  return db.collection("client_inventory").doc(id).set({
    id,
    customer_code: BTG,
    sku_code: skuCode,
    product_name: `Produto ${skuCode}`,
    status: "active",
    ...campos,
  });
}

async function lida(id: string) {
  return (await db.collection("client_inventory").doc(id).get()).data() ?? {};
}

async function controle() {
  return (await db.collection("system_controls").doc(CONTROLE_DO_RECALCULO).get()).data();
}

async function eventos() {
  return (await db.collection("events").where("type", "==", "warehouse.client_projection_recalculated").get()).docs.map((doc) => doc.data());
}

/** Roda até a passada limpa depois da espera: a primeira rodada em T0, a segunda depois da espera. */
async function ateTerminar(options: { porPagina?: number } = {}) {
  const primeira = await recalcularDisponivelDoPortal(db, { ...options, agora: () => T0 });
  const segunda = await recalcularDisponivelDoPortal(db, { ...options, agora: () => DEPOIS });
  return { primeira, segunda };
}

before(() => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST, "Execute este teste pelo Firebase Emulator.");
  app = initializeApp({ projectId: PROJECT_ID }, `disponivel-do-portal-${Date.now()}`);
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
    // Com o disponível de antes: 10, todos os locais; e uma reserva na prateleira.
    saldo("s1-a01", "SKU-1", "A-01", 3, 1),
    saldo("s1-rec", "SKU-1", "RECEBIMENTO", 5),
    saldo("s1-exp", "SKU-1", "EXPEDICAO", 2),
    // O mesmo código em outro cliente não conta.
    saldo("o1-a01", "SKU-1", "A-09", 50, 0, undefined, OUTRO),
    projecao("cinv_BTG_Pactual__SKU-1", "SKU-1", { client_item_code: "ITEM-1", qty_on_hand: 10, qty_reserved: 1, qty_available: 9 }),
    // Já escrita depois da parte 7: fica como está.
    saldo("s2-a02", "SKU-2", "A-02", 4, 1),
    projecao("cinv_BTG_Pactual__SKU-2", "SKU-2", { qty_on_hand: 4, qty_reserved: 1, qty_available: 3, qty_receiving: 0 }),
    // Sem saldo nenhum: zero.
    projecao("cinv_BTG_Pactual__SKU-3", "SKU-3", { qty_on_hand: 2, qty_reserved: 0, qty_available: 2 }),
    // O disponível já certo, mas sem o em recebimento: ganha o campo.
    saldo("s5-a05", "SKU-5", "A-05", 6),
    projecao("cinv_BTG_Pactual__SKU-5", "SKU-5", { qty_on_hand: 6, qty_reserved: 0, qty_available: 6 }),
    // O SKU legado com saldos de dois códigos do cliente: uma projeção, que conta os dois.
    saldo("e1-a03", LEGADO, "A-03", 2, 0, "C.1"),
    saldo("e1-rec", LEGADO, "RECEBIMENTO", 1, 0, "C.1"),
    saldo("e2-a04", LEGADO, "A-04", 5, 0, "C.2"),
    projecao(`cinv_BTG_Pactual__${LEGADO}`, LEGADO, { client_item_code: "C.1", qty_on_hand: 8, qty_reserved: 0, qty_available: 8 }),
    // Saldo sem projeção: a rotina não cria projeção.
    saldo("s4-a05", "SKU-4", "A-05", 7),
  ]);
});

describe("o recálculo do disponível do portal (recebimento com caixas, parte 7c)", () => {
  it("refaz o disponível e o em recebimento pelos saldos e só termina com uma passada limpa depois da espera", async () => {
    const { primeira, segunda } = await ateTerminar();
    // Em T0: a passada 1 refaz, a 2 sai limpa, mas cedo; a 3, depois da espera, conclui.
    assert.deepEqual(primeira, { status: "em_andamento", passada: 3, conferidas: 0, refeitas: 0 });
    assert.deepEqual(segunda, { status: "feito", passada: 3, conferidas: 5, refeitas: 4 });

    const sku1 = await lida("cinv_BTG_Pactual__SKU-1");
    assert.deepEqual([sku1.qty_on_hand, sku1.qty_reserved, sku1.qty_available, sku1.qty_receiving], [10, 1, 2, 5]);
    assert.equal(sku1.product_name, "Produto SKU-1");
    assert.equal(sku1.client_item_code, "ITEM-1");
    const sku2 = await lida("cinv_BTG_Pactual__SKU-2");
    assert.deepEqual([sku2.qty_available, sku2.qty_receiving], [3, 0]);
    assert.equal(sku2.updated_at, undefined, "a projeção certa não é escrita");
    const sku3 = await lida("cinv_BTG_Pactual__SKU-3");
    assert.deepEqual([sku3.qty_on_hand, sku3.qty_available, sku3.qty_receiving], [2, 0, 0]);
    const sku5 = await lida("cinv_BTG_Pactual__SKU-5");
    assert.deepEqual([sku5.qty_available, sku5.qty_receiving], [6, 0]);
    const legado = await lida(`cinv_BTG_Pactual__${LEGADO}`);
    assert.deepEqual([legado.qty_available, legado.qty_receiving], [7, 1]);
    assert.equal((await db.collection("client_inventory").doc("cinv_BTG_Pactual__SKU-4").get()).exists, false);

    const feito = (await controle()) ?? {};
    assert.deepEqual(
      [feito.version, feito.status, feito.pass, feito.total_changed, feito.cursor, feito.started_at, feito.pass_started_at, feito.done_at],
      [VERSAO_DO_RECALCULO, "done", 3, 4, null, T0.toISOString(), DEPOIS.toISOString(), DEPOIS.toISOString()],
    );
    const [evento, ...outros] = await eventos();
    assert.equal(outros.length, 0);
    assert.equal(evento!.severity, "info");
    assert.equal(evento!.customer_code, undefined);
    assert.deepEqual(evento!.payload, { version: VERSAO_DO_RECALCULO, passes: 3, projections_checked: 5, projections_changed: 4, started_at: T0.toISOString() });
    assert.equal((await db.collection("ai_agent_inbox").get()).size, 0);

    // Feito, a rodada só lê o controle.
    await db.collection("client_inventory").doc("cinv_BTG_Pactual__SKU-3").update({ qty_available: 9 });
    assert.deepEqual(await recalcularDisponivelDoPortal(db, { agora: () => DEPOIS }), { status: "feito" });
    assert.equal((await lida("cinv_BTG_Pactual__SKU-3")).qty_available, 9);
    assert.equal((await eventos()).length, 1);
  });

  it("uma escrita antiga durante a espera é refeita na passada seguinte", async () => {
    await recalcularDisponivelDoPortal(db, { agora: () => T0 });
    // Uma function de revisão antiga grava o disponível de antes depois da primeira rodada.
    await db.collection("client_inventory").doc("cinv_BTG_Pactual__SKU-1").update({ qty_available: 9, qty_receiving: 0 });
    // A passada que refaz não conclui; a seguinte, limpa e depois da espera, sim.
    const segunda = await recalcularDisponivelDoPortal(db, { agora: () => DEPOIS });
    assert.deepEqual([segunda.status, segunda.passada, segunda.refeitas], ["feito", 4, 5]);
    assert.deepEqual([(await lida("cinv_BTG_Pactual__SKU-1")).qty_available, (await lida("cinv_BTG_Pactual__SKU-1")).qty_receiving], [2, 5]);
  });

  it("com o estoque congelado, a rodada não grava nada, nem o controle nem o evento, e a seguinte continua", async () => {
    await db.collection("system_controls").doc("inventory").set({ movements_frozen: true });
    assert.deepEqual(await recalcularDisponivelDoPortal(db, { agora: () => T0 }), { status: "congelado" });
    assert.equal(await controle(), undefined);
    assert.equal((await lida("cinv_BTG_Pactual__SKU-1")).qty_available, 9);
    assert.equal((await eventos()).length, 0);

    await db.collection("system_controls").doc("inventory").set({ movements_frozen: false });
    const { segunda } = await ateTerminar();
    assert.equal(segunda.status, "feito");
    assert.equal((await lida("cinv_BTG_Pactual__SKU-1")).qty_available, 2);
  });

  it("na zeragem, com as projeções apagadas e o estoque congelado, não recria o controle nem grava evento", async () => {
    const projecoes = await db.collection("client_inventory").get();
    await Promise.all(projecoes.docs.map((doc) => doc.ref.delete()));
    await db.collection("system_controls").doc("inventory").set({ reconciliation_status: "running" });
    assert.deepEqual(await recalcularDisponivelDoPortal(db, { agora: () => DEPOIS }), { status: "congelado" });
    assert.equal(await controle(), undefined);
    assert.equal((await eventos()).length, 0);

    // Descongelado, conclui com nada a refazer, depois da espera.
    await db.collection("system_controls").doc("inventory").delete();
    const { primeira, segunda } = await ateTerminar();
    assert.equal(primeira.status, "em_andamento");
    assert.deepEqual(segunda, { status: "feito", passada: 2, conferidas: 0, refeitas: 0 });
  });

  it("a rodada sem tempo para no fim da página, e a seguinte continua do cursor", async () => {
    const primeira = await recalcularDisponivelDoPortal(db, { porPagina: 2, tempoMs: 0, agora: () => T0 });
    assert.deepEqual(primeira, { status: "em_andamento", passada: 1, conferidas: 2, refeitas: 2 });
    // As duas primeiras pela ordem do id são a do SKU legado e a SKU-1.
    assert.equal((await controle())?.cursor, "cinv_BTG_Pactual__SKU-1");
    const segunda = await recalcularDisponivelDoPortal(db, { porPagina: 2, tempoMs: 0, agora: () => T0 });
    assert.deepEqual(segunda, { status: "em_andamento", passada: 1, conferidas: 4, refeitas: 3 });
    assert.equal((await controle())?.cursor, "cinv_BTG_Pactual__SKU-3", "a segunda rodada seguiu do cursor, não do começo");
    assert.equal((await lida("cinv_BTG_Pactual__SKU-5")).qty_receiving, undefined, "a SKU-5 ainda não foi visitada");

    for (let rodada = 0; rodada < 6 && (await controle())?.status !== "done"; rodada += 1) {
      await recalcularDisponivelDoPortal(db, { porPagina: 2, agora: () => (rodada === 0 ? T0 : DEPOIS) });
    }
    assert.equal((await controle())?.status, "done");
    assert.equal((await lida("cinv_BTG_Pactual__SKU-5")).qty_receiving, 0);
    const [evento] = await eventos();
    assert.equal(evento!.payload.projections_changed, 4);
  });

  it("a passada limpa que começou antes do fim da espera não conclui, mesmo terminando depois dela", async () => {
    // Uma página por rodada: cinco projeções, três páginas por passada.
    const rodada = (quando: Date) => recalcularDisponivelDoPortal(db, { porPagina: 2, tempoMs: 0, agora: () => quando });
    // Em T0, a passada 1 refaz as quatro em três rodadas, e a quarta começa a passada 2.
    for (let vez = 0; vez < 4; vez += 1) await rodada(T0);
    const meio = (await controle()) ?? {};
    assert.deepEqual([meio.pass, meio.pass_started_at, meio.pass_changed], [2, T0.toISOString(), 0]);

    // A passada 2 termina limpa depois da espera, mas começou em T0: não conclui.
    assert.equal((await rodada(DEPOIS)).status, "em_andamento");
    assert.deepEqual(await rodada(DEPOIS), { status: "em_andamento", passada: 3, conferidas: 0, refeitas: 0 });
    assert.equal((await controle())?.pass_started_at, null, "a passada 3 começa na rodada seguinte");
    assert.equal((await eventos()).length, 0);

    // A passada 3 começa depois da espera e conclui no fim.
    for (let vez = 0; vez < 2; vez += 1) assert.equal((await rodada(DEPOIS)).status, "em_andamento");
    assert.deepEqual(await rodada(DEPOIS), { status: "feito", passada: 3, conferidas: 5, refeitas: 4 });
    assert.equal((await controle())?.pass_started_at, DEPOIS.toISOString());
    assert.equal((await eventos()).length, 1);
  });

  it("a rodada que parou no meio de uma página não deixa a passada se dar por limpa", async () => {
    const rodada = (quando: Date) => recalcularDisponivelDoPortal(db, { porPagina: 2, tempoMs: 0, agora: () => quando });
    // Em T0, a passada 1 refaz as quatro em três rodadas.
    for (let vez = 0; vez < 3; vez += 1) await rodada(T0);
    // Depois da espera, a passada 2 confere a primeira página e para no fim dela.
    assert.deepEqual(await rodada(DEPOIS), { status: "em_andamento", passada: 2, conferidas: 2, refeitas: 0 });
    assert.equal((await controle())?.page_open, false);
    // A rodada seguinte marca a segunda página, refaz uma projeção dela e cai
    // antes de gravar o fim da página: é o que ela deixa no banco.
    await db.collection("system_controls").doc(CONTROLE_DO_RECALCULO).update({ page_open: true });

    // O resto da passada 2 sai sem nada a refazer, mas a passada não conclui.
    assert.equal((await rodada(DEPOIS)).status, "em_andamento");
    assert.deepEqual(await rodada(DEPOIS), { status: "em_andamento", passada: 3, conferidas: 0, refeitas: 0 });
    assert.equal((await eventos()).length, 0);
    // A passada 3, inteira, conclui.
    for (let vez = 0; vez < 2; vez += 1) assert.equal((await rodada(DEPOIS)).status, "em_andamento");
    assert.deepEqual(await rodada(DEPOIS), { status: "feito", passada: 3, conferidas: 5, refeitas: 4 });
    assert.equal((await controle())?.page_open, false);
  });

  it("refazer apagando o controle grava o evento do novo recálculo", async () => {
    await ateTerminar();
    // Uma publicação do WMS parou no meio e deixou uma projeção com o
    // disponível de antes: o controle é apagado para refazer.
    await db.collection("client_inventory").doc("cinv_BTG_Pactual__SKU-1").update({ qty_available: 9, qty_receiving: 0 });
    await db.collection("system_controls").doc(CONTROLE_DO_RECALCULO).delete();
    const T1 = new Date(DEPOIS.getTime() + 24 * 60 * 60 * 1000);
    const T1_DEPOIS = new Date(T1.getTime() + ESPERA_MINIMA_MS + 60_000);
    assert.equal((await recalcularDisponivelDoPortal(db, { agora: () => T1 })).status, "em_andamento");
    assert.equal((await recalcularDisponivelDoPortal(db, { agora: () => T1_DEPOIS })).status, "feito");

    const todos = (await eventos()).map((evento) => [evento.payload.started_at, evento.payload.projections_changed]).sort();
    assert.deepEqual(todos, [[T0.toISOString(), 4], [T1.toISOString(), 1]]);
    assert.deepEqual([(await lida("cinv_BTG_Pactual__SKU-1")).qty_available, (await lida("cinv_BTG_Pactual__SKU-1")).qty_receiving], [2, 5]);
  });

  it("a versão nova da conta refaz tudo, mesmo com o recálculo anterior feito", async () => {
    await db.collection("system_controls").doc(CONTROLE_DO_RECALCULO).set({
      version: VERSAO_DO_RECALCULO - 1,
      status: "done",
      pass: 2,
      cursor: null,
      pass_checked: 3,
      pass_changed: 0,
      total_changed: 3,
      started_at: "2026-10-01T12:00:00.000Z",
      done_at: "2026-10-01T13:30:00.000Z",
    });
    const { primeira, segunda } = await ateTerminar();
    assert.equal(primeira.status, "em_andamento");
    assert.equal(segunda.status, "feito");
    assert.equal(segunda.refeitas, 4);
    assert.equal((await controle())?.started_at, T0.toISOString(), "a versão nova começa a espera de novo");
    assert.equal((await lida("cinv_BTG_Pactual__SKU-1")).qty_receiving, 5);
  });
});
