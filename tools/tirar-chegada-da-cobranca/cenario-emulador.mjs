#!/usr/bin/env node
/**
 * A ferramenta contra o WMS de verdade, no emulador. Recusa rodar fora de
 * 127.0.0.1 e de um projeto demo-*.
 *
 * Em cada fase o banco começa vazio: a BTG com a Tabela de preços (uma linha
 * ligada a uma tabela do Comercial), a quantidade manual do mês, outra
 * chegada e uma entrega soltas no mês, e a chegada repetida criada pelo fluxo
 * de verdade da chegada por caixa (criar, iniciar a caixa, lançar GG 30 e
 * XGG 41, fechar, confirmar B-02, concluir e guardar), como a régua
 * billing-callables.integration.test.ts. A prévia de verdade é a callable
 * `getBillingPreview` do functions/wms/lib, pelo `.run`, como na régua.
 *
 * - A: a seco não grava; a prévia da ferramenta é a da callable, antes e
 *   depois de gravar; gravar de novo não repete.
 * - B: com a foto do uso, a seco e a gravação recusam, e nada muda.
 * - C: com a competência emitida, a gravação recusa, e nada muda.
 *
 * De functions/wms, com o Java 21 no PATH:
 *
 *   npx --no-install firebase emulators:exec --only firestore --project demo-tirar-cobranca "node ../../tools/tirar-chegada-da-cobranca/cenario-emulador.mjs"
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const host = process.env.FIRESTORE_EMULATOR_HOST ?? "";
const PROJETO = process.env.GCLOUD_PROJECT ?? "";
if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host)) throw new Error(`Só no emulador: FIRESTORE_EMULATOR_HOST está "${host}".`);
if (!/^demo-/.test(PROJETO)) throw new Error(`Só com projeto demo-*: GCLOUD_PROJECT está "${PROJETO}".`);

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const WMS = path.resolve(AQUI, "..", "..", "functions", "wms");
const lib = (arquivo) => import(pathToFileURL(path.join(WMS, "lib", arquivo)).href);

// O index do WMS inicia o app padrão: ele vem antes de qualquer getFirestore.
const wms = await lib("index.js");
const { getFirestore } = createRequire(path.join(WMS, "package.json"))("firebase-admin/firestore");
const db = getFirestore();
const { competenciaFromDate } = await lib("billing.js");
const { billingDocumentId } = await lib("domain/billing-scope.js");
const caixas = await lib("domain/inbound-boxes.js");
const { createInboundReceiptTransaction } = await lib("domain/operations.js");
const { upsertWarehousePositions } = await lib("domain/warehouse-positions.js");

const BTG = "BTG Pactual";
const COMPETENCIA = competenciaFromDate(new Date());
const ID_DO_MES = billingDocumentId(BTG, COMPETENCIA);
const OPERACAO = { uid: "arm", role: "wms", name: "Armazém" };
const PASTA = mkdtempSync(path.join(os.tmpdir(), "tirar-cobranca-"));

async function zerar() {
  const resposta = await fetch(`http://${host}/emulator/v1/projects/${PROJETO}/databases/(default)/documents`, { method: "DELETE" });
  assert.ok(resposta.ok, `não zerou o emulador (${resposta.status})`);
}

async function semear() {
  const lote = db.batch();
  lote.set(db.collection("users").doc("dono"), { role: "owner", nome: "Dono", email: "dono@dutelog.com.br" });
  lote.set(db.collection("customers").doc("btg_pactual"), { code: BTG, customer_code: BTG, name: BTG, sku_prefix: "BTG", status: "active", operation_template: "uniformes" });
  for (const [codigo, sku, tamanho] of [["A.01.0806.005.GG", "BTG-000090", "GG"], ["A.01.0806.005.XGG", "BTG-000181", "XGG"]]) {
    const nome = "Polo Masculino Piquet Preto";
    lote.set(db.collection("products").doc(codigo), { id: codigo, customer_code: BTG, cod_cliente: codigo, produto: nome, tamanho, status: "active" });
    lote.set(db.collection("skus").doc(sku), { id: sku, customer_code: BTG, cod_cliente: codigo, cod_btg: sku, sku_code: sku, produto: nome, tamanho, status: "active" });
    lote.set(db.collection("catalog_prices").doc(sku), { customer_code: BTG, sku_code: sku, item_code: codigo, preco_unit: 25 });
  }
  const tabela = [
    ["btg_1", { id: 1, customer_code: BTG, grupo: "Armazenagem", item: "Ad valorem", valor_unit: 0, auto_source: "ad_valorem", ordem: 1 }],
    ["btg_2", { id: 2, customer_code: BTG, grupo: "Movimentação", item: "Entrada por peça", valor_unit: 0.35, auto_source: "mov_entrada_pecas", ordem: 2 }],
    // Ligada ao Comercial: o preço sai da tabela da BTG (0,50), não do valor_unit.
    ["btg_3", { id: 3, customer_code: BTG, grupo: "Movimentação", item: "Saída por peça", valor_unit: 0.45, auto_source: "mov_saida_pecas", ordem: 3, lpu_item_id: "saida_peca" }],
    // Sem cliente: vale para a BTG.
    ["btg_4", { id: 4, grupo: "Movimentação", item: "Movimento", valor_unit: 2, auto_source: "mov_count", ordem: 4 }],
    ["btg_5", { id: 5, customer_code: BTG, grupo: "Armazenagem", item: "Posição", unidade: "posição", valor_unit: 100, auto_source: null, ordem: 5 }],
    ["btg_6", { id: 6, customer_code: BTG, grupo: "Serviços", item: "Inativo", valor_unit: 99, auto_source: "mov_count", ordem: 6, ativo: false }],
    ["safra_1", { id: 7, customer_code: "Banco Safra", grupo: "Movimentação", item: "Entrada por peça", valor_unit: 9, auto_source: "mov_entrada_pecas", ordem: 1 }],
  ];
  for (const [doc, item] of tabela) lote.set(db.collection("billing_price_list").doc(doc), item);
  lote.set(db.collection("price_tables").doc("tab_btg"), { customer_code: BTG, vigente_de: "2026-01-01", vigente_ate: null, precos: { saida_peca: { preco: "0.50" } } });
  lote.set(db.collection("billing_config").doc("default"), { ad_valorem_rate: 0.004 });
  lote.set(db.collection("billing_manual").doc(ID_DO_MES), { competencia: COMPETENCIA, customer_code: BTG, items: [{ price_list_id: 5, qtde: 3, observacao: null }] });
  // Soltos no mês: outra chegada (12, fica na cobrança) e a entrega de um pedido (100).
  const agora = new Date().toISOString();
  lote.set(db.collection("movements").doc("r1"), { id: "r1", customer_code: BTG, occurred_at: agora, data: agora, tipo_mov: "ENTRADA", sinal: 1, sign: 1, qtde: 12, quantity: 12, sku_code: "BTG-000186", location_id: "B-03", source: "wms_receiving", receipt_id: "inb_avulso_outra", receipt_number: "AVL-0UTRA000" });
  lote.set(db.collection("movements").doc("s1"), { id: "s1", customer_code: BTG, occurred_at: agora, data: agora, tipo_mov: "SAIDA", sinal: -1, sign: -1, qtde: 100, quantity: 100, sku_code: "BTG-000090", location_id: "B-02", source: "wms_shipping", order_number: "PED-0001" });
  await lote.commit();
  await upsertWarehousePositions(db, { positions: [{ aisle: "B", shelf: 2, length_m: 1.8, depth_m: 0.75, height_m: 0.65, customer_code: BTG }] }, { uid: "coord", role: "interno", name: "Coordenação" });
}

/** A chegada repetida pelo fluxo de verdade da chegada por caixa. */
async function chegadaPorCaixa() {
  const chegada = await createInboundReceiptTransaction(
    db,
    {
      customer_code: BTG,
      supplier: "Confecções",
      invoice_number: "046143",
      idempotency_key: "cenario-repetida",
      conference_mode: "per_box",
      items: [
        { line_number: 1, sku_code: "BTG-000090", client_item_code: "A.01.0806.005.GG", product_name: "Polo Masculino Piquet Preto", product_registration: "existing", quantity: 30 },
        { line_number: 2, sku_code: "BTG-000181", client_item_code: "A.01.0806.005.XGG", product_name: "Polo Masculino Piquet Preto", product_registration: "existing", quantity: 41 },
      ],
    },
    OPERACAO,
    { boxReceivingEnabled: true },
  );
  const receiptId = String(chegada.receipt_id);
  const linhas = (await db.collection("inbound_items").where("receipt_id", "==", receiptId).get()).docs.sort((a, b) => a.get("line_number") - b.get("line_number"));
  const caixa = String((await caixas.startInboundBox(db, { receipt_id: receiptId, idempotency_key: "cenario-iniciar" }, OPERACAO)).box.code);
  const revisao = async () => Number((await db.collection("warehouse_boxes").doc(caixa).get()).get("conference_revision") ?? 0);
  for (const [indice, quantidade] of [[0, 30], [1, 41]]) {
    await caixas.saveInboundBoxLine(db, { receipt_id: receiptId, box_code: caixa, inbound_item_id: linhas[indice].id, counted_qty: quantidade, expected_revision: await revisao(), idempotency_key: `cenario-linha-${indice}` }, OPERACAO);
  }
  await caixas.setInboundBoxState(db, { action: "close", receipt_id: receiptId, box_code: caixa, length_m: 0.48, width_m: 0.38, height_m: 0.3, gross_weight_kg: 9.4, expected_revision: await revisao(), idempotency_key: "cenario-fechar" }, OPERACAO);
  await caixas.confirmInboundBoxDestination(db, { receipt_id: receiptId, box_code: caixa, location_id: "B-02", expected_revision: await revisao(), idempotency_key: "cenario-destino" }, OPERACAO);
  await caixas.completeInboundBoxReceipt(db, { receipt_id: receiptId, expected_status: "created", idempotency_key: "cenario-concluir" }, OPERACAO);
  await caixas.storeInboundBox(db, { receipt_id: receiptId, box_code: caixa, location_id: "B-02", expected_revision: await revisao(), idempotency_key: "cenario-guardar" }, OPERACAO);
  return { receiptId, numero: String(chegada.receipt_number) };
}

async function prepararFase() {
  await zerar();
  await semear();
  const chegada = await chegadaPorCaixa();
  const arquivo = path.join(PASTA, `caso-${chegada.numero}.mjs`);
  const caso = {
    id: "cenario-emulador",
    cliente: BTG,
    competencia: COMPETENCIA,
    chegada: chegada.numero,
    repetiu: "AVL-0D0E620B",
    nf: "046143",
    esperado: { movimentos: 2, pecas: 71 },
    motivo: "Cenário do emulador: a chegada repetida.",
    ator: { uid: "script:tirar-chegada-da-cobranca", role: "admin", name: "Cenário do emulador" },
  };
  writeFileSync(arquivo, `export const CASO = ${JSON.stringify(caso, null, 2)};\n`);
  return { ...chegada, arquivo };
}

function ferramenta(fase, caso, extras = []) {
  const json = path.join(PASTA, `resumo-${fase}-${Date.now()}.json`);
  const saida = spawnSync(process.execPath, [path.join(AQUI, "tirar.mjs"), "--projeto", PROJETO, "--json", json, ...extras], {
    env: { ...process.env, TIRAR_CASO: caso.arquivo },
    encoding: "utf8",
  });
  console.log(`\n----- tirar.mjs ${extras.join(" ") || "(a seco)"} · fase ${fase} · código ${saida.status} -----\n${saida.stdout}${saida.stderr}`);
  return { codigo: saida.status, resumo: JSON.parse(readFileSync(json, "utf8")) };
}

async function previa() {
  const request = { auth: { uid: "dono", token: { email: "dono@dutelog.com.br" } }, data: { competencia: COMPETENCIA, customer_code: BTG }, rawRequest: {} };
  const resultado = await wms.getBillingPreview.run(request);
  return { total_cents: resultado.total_cents, linhas: new Map(resultado.grupos.flatMap((grupo) => grupo.itens.map((linha) => [String(linha.price_list_id), linha]))) };
}

async function entradasDaChegada(receiptId) {
  const movimentos = (await db.collection("movements").where("receipt_id", "==", receiptId).get()).docs.map((doc) => doc.data());
  return {
    entradas: movimentos.filter((m) => m.source === "wms_receiving"),
    guarda: movimentos.filter((m) => m.source === "wms_putaway"),
  };
}

async function nadaGravado(caso) {
  const { entradas } = await entradasDaChegada(caso.receiptId);
  assert.equal(entradas.length, 2);
  assert.ok(entradas.every((m) => !("billable" in m) && !("billing_exclusion" in m)), "nenhuma entrada marcada");
  assert.equal((await db.collection("operational_operations").doc("op_billing_exclude_cenario-emulador").get()).exists, false, "sem recibo");
  assert.equal((await db.collection("events").where("type", "==", "billing.movements_excluded").get()).size, 0, "sem evento");
}

// --- A: a seco, gravar e gravar de novo ----------------------------------------------------

{
  const caso = await prepararFase();
  const { entradas, guarda } = await entradasDaChegada(caso.receiptId);
  assert.deepEqual(entradas.map((m) => m.qtde).sort((a, b) => a - b), [30, 41]);
  assert.equal(guarda.length, 4, "a guarda da caixa: saída e entrada de cada SKU");

  const antes = await previa();
  const seco = ferramenta("A", caso);
  assert.equal(seco.codigo, 0);
  assert.equal(seco.resumo.situacao, "a_gravar");
  assert.equal(seco.resumo.cobrados.length, 2);
  assert.equal(seco.resumo.sem_cobranca.length, 4);
  await nadaGravado(caso);
  // A prévia da ferramenta é a da callable, centavo por centavo.
  assert.equal(seco.resumo.previa.total_antes_cents, antes.total_cents);
  // Entradas 83 (12 + 30 + 41) × 0,35 = 29,05 → 12 × 0,35 = 4,20; movimentos 4 × 2 = 8,00 → 2 × 2 = 4,00.
  assert.deepEqual(
    seco.resumo.previa.linhas.map((l) => [l.price_list_id, l.antes.qtde, l.antes.total_cents, l.depois.qtde, l.depois.total_cents]),
    [[2, 83, 2905, 12, 420], [4, 4, 800, 2, 400]],
  );
  assert.equal(seco.resumo.previa.delta_cents, -2885);
  assert.deepEqual([antes.linhas.get("2").qtde, antes.linhas.get("3").qtde, antes.linhas.get("3").valor_unit, antes.linhas.get("4").qtde], [83, 100, 0.5, 4]);

  const gravou = ferramenta("A", caso, ["--aplicar"]);
  assert.equal(gravou.codigo, 0);
  assert.equal(gravou.resumo.gravacao.gravados.length, 2);
  assert.equal(gravou.resumo.situacao, "ja_aplicado");
  const depois = await previa();
  assert.equal(depois.total_cents, seco.resumo.previa.total_depois_cents);
  assert.equal(depois.total_cents, antes.total_cents - 2885);
  assert.deepEqual([depois.linhas.get("2").qtde, depois.linhas.get("3").qtde, depois.linhas.get("4").qtde], [12, 100, 2]);

  const marcadas = await entradasDaChegada(caso.receiptId);
  assert.ok(marcadas.entradas.every((m) => m.billable === false && m.billing_exclusion?.operation_id === "op_billing_exclude_cenario-emulador"));
  assert.ok(marcadas.guarda.every((m) => !("billable" in m)), "a guarda não muda");
  const eventos = (await db.collection("events").where("type", "==", "billing.movements_excluded").get()).docs.map((doc) => doc.data());
  assert.equal(eventos.length, 1);
  assert.deepEqual([eventos[0].entity_type, eventos[0].entity_id, eventos[0].payload.pecas], ["fatura", COMPETENCIA, 71]);
  assert.equal((await db.collection("operational_operations").doc("op_billing_exclude_cenario-emulador").get()).get("result.pecas"), 71);

  const deNovo = ferramenta("A", caso, ["--aplicar"]);
  assert.equal(deNovo.codigo, 0);
  assert.equal(deNovo.resumo.situacao, "ja_aplicado");
  assert.equal(deNovo.resumo.gravacao, null, "já aplicado: nem tenta gravar");
  assert.equal((await db.collection("events").where("type", "==", "billing.movements_excluded").get()).size, 1);
  assert.equal((await previa()).total_cents, depois.total_cents);
  console.log("\nA: ok — a seco não grava, a prévia bate com a callable antes e depois, e gravar de novo não repete.");
}

// --- B: o uso congelado ----------------------------------------------------------------------

{
  const caso = await prepararFase();
  await db.collection("billing_operational_snapshots").doc(ID_DO_MES).set({ mode: "frozen", customer_code: BTG, competencia: COMPETENCIA, usage: { custo_estoque: 1775, entradas_pecas: 83, saidas_pecas: 100, movimentacoes: 4 }, frozen_at: new Date() });
  const seco = ferramenta("B", caso);
  assert.equal(seco.codigo, 1);
  assert.ok(seco.resumo.recusas.some((r) => /congelad/.test(r)));
  const gravou = ferramenta("B", caso, ["--aplicar"]);
  assert.equal(gravou.codigo, 1);
  await nadaGravado(caso);
  console.log("\nB: ok — com a foto do uso, a seco e a gravação recusam, e nada muda.");
}

// --- C: a competência emitida ----------------------------------------------------------------

{
  const caso = await prepararFase();
  await db.collection("billing_periods").doc(ID_DO_MES).set({ competencia: COMPETENCIA, customer_code: BTG, status: "emitido", emitido_em: new Date().toISOString(), invoice_snapshot: { schema_version: 1, status: "emitido", competencia: COMPETENCIA, linhas: [], total_cents: 0, total: 0 } });
  const gravou = ferramenta("C", caso, ["--aplicar"]);
  assert.equal(gravou.codigo, 1);
  assert.ok(gravou.resumo.recusas.some((r) => /emitida/.test(r)));
  await nadaGravado(caso);
  console.log("\nC: ok — com a competência emitida, a gravação recusa, e nada muda.");
}

console.log(`\nCenário completo (competência ${COMPETENCIA}). Resumos em ${PASTA}.`);
process.exit(0);
