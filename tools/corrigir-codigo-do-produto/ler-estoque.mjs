#!/usr/bin/env node
/**
 * Leitura do estoque de alguns itens, SÓ LEITURA, para conferir antes de
 * corrigir (a entrada de 30/10 em B-02 e a CX-000227, 16/11/2026). Para cada
 * código: o SKU, o saldo por prateleira, as datas de entrada (a conta do
 * pedido, functions/wms/lib), os movimentos com a chegada e a NF de cada um,
 * as caixas com o item (o que entrou e o que a separação tirou) e, com
 * --pedido, as linhas do pedido. No fim, as chegadas citadas, com as linhas
 * da NF, para comparar uma com a outra.
 *
 * Não grava nada: só há get neste arquivo. Não mostra quem fez cada coisa.
 *
 *   node tools/corrigir-codigo-do-produto/ler-estoque.mjs --projeto dute-prod --pedido PED-0001 --codigo A.01.0806.005.GG --codigo A.01.0806.005.XG
 *
 * Pré-requisitos: npm --prefix functions/wms ci e run build (as datas vêm de
 * functions/wms/lib) e gcloud auth application-default login.
 */

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { abrirFirestore, RAIZ } from "../padronizar-nomes/firestore.mjs";
import { chaveDoCodigo, clienteDe, fmt, linhasDe, num, quando, texto } from "./comum.mjs";

// --- Puro ----------------------------------------------------------------------------

const ORIGENS = {
  wms_receiving: "recebimento",
  wms_putaway: "guarda",
  wms_area_putaway: "guarda da área",
  wms_shipping: "entrega",
  wms_order_cancel: "cancelamento",
  wms_return: "devolução",
  wms_unplanned_receipt: "recebimento avulso",
  functions_manual_inventory: "ajuste",
  functions_inventory_movement: "ajuste",
  functions_opening_inventory: "abertura",
  functions_opening_inventory_transfer: "abertura, troca de caixa",
};

/**
 * "30/10/2026 14:05 · ENTRADA 30 em B-02 · guarda · chegada AVL-1A2B (NF 48377) · CX-000227 [wms_putaway]".
 * A guarda por linha não guarda a chegada no movimento: ela vem da tarefa de guarda (`tarefas`, id → chegada).
 */
export function linhaDoMovimento(m, chegadas = new Map(), tarefas = new Map()) {
  const fonte = texto(m.source);
  const partes = [quando(m.created_at) || quando(m.occurred_at) || "sem data", `${texto(m.tipo_mov) || "?"} ${fmt(num(m.quantity ?? m.qtde))} em ${texto(m.location_id) || "?"}`];
  partes.push(ORIGENS[fonte] ?? (texto(m.opening_inventory_session_id) ? "abertura" : fonte.startsWith("script") ? "script" : "outra origem"));
  const receiptId = texto(m.receipt_id) || texto(tarefas.get(texto(m.putaway_task_id)));
  if (receiptId) {
    const chegada = chegadas.get(receiptId);
    partes.push(`chegada ${chegada?.numero || texto(m.receipt_number) || receiptId}${chegada?.nf ? ` (NF ${chegada.nf})` : ""}`);
  }
  if (texto(m.box_code)) partes.push(texto(m.box_code));
  if (texto(m.order_number)) partes.push(`pedido ${texto(m.order_number)}`);
  const motivo = texto(m.reason || m.motivo);
  if (motivo && !receiptId) partes.push(`"${motivo.slice(0, 120)}"`);
  return `${partes.join(" · ")} [${fonte || "sem origem"}]`;
}

/** O que entrou de um SKU numa caixa: o conteúdo da própria caixa (recebimento) ou as linhas da abertura dela. */
export function entradaDaCaixa(caixa, linhasDaAbertura, sku) {
  const proprias = linhasDe(caixa);
  if (proprias.length) return proprias.filter((l) => texto(l?.sku_code) === sku).reduce((s, l) => s + num(l.counted_qty), 0);
  return linhasDaAbertura.filter((l) => texto(l.box_code).toUpperCase() === texto(caixa.code || caixa.id).toUpperCase() && texto(l.sku_code) === sku).reduce((s, l) => s + num(l.counted_qty), 0);
}

/** O que as separações tiraram de um SKU da caixa (taken_lines). */
export function retiradoDaCaixa(caixa, sku) {
  return (Array.isArray(caixa.taken_lines) ? caixa.taken_lines : []).filter((t) => texto(t?.sku_code) === sku).reduce((s, t) => s + num(t.qty), 0);
}

/** "A-09 desde 16/10/2026 32 · B-02 desde 30/10/2026 30, desde 06/11/2026 30" */
export function textoDasDatas(locais) {
  const dia = (d) => (d ? d.split("-").reverse().join("/") : "sem data");
  return (locais ?? []).map((l) => `${l.local} ${l.datas?.length ? l.datas.map((d) => `desde ${dia(d.desde)} ${fmt(num(d.pecas))}`).join(", ") : fmt(num(l.pecas))}`).join(" · ") || "nenhuma";
}

// --- Leitura -------------------------------------------------------------------------

async function lerDocs(consulta) {
  return (await consulta.get()).docs;
}

async function skusDoCodigo(db, codigo, cliente) {
  const achados = new Map();
  const direto = await db.collection("skus").doc(texto(codigo).toUpperCase()).get();
  if (direto.exists && clienteDe(direto.data()) === cliente) achados.set(direto.id, direto);
  for (const consulta of [
    db.collection("skus").where("cod_cliente_key", "==", chaveDoCodigo(codigo)),
    db.collection("skus").where("cod_cliente", "==", texto(codigo)),
  ]) {
    for (const doc of await lerDocs(consulta)) if (clienteDe(doc.data()) === cliente) achados.set(doc.id, doc);
  }
  return [...achados.values()];
}

async function chegada(db, cache, receiptId) {
  if (!receiptId) return null;
  if (cache.has(receiptId)) return cache.get(receiptId);
  const snap = await db.collection("inbound_receipts").doc(receiptId).get();
  const d = snap.exists ? snap.data() : {};
  const info = {
    id: receiptId,
    existe: snap.exists,
    numero: texto(d.receipt_number) || receiptId,
    nf: texto(d.invoice_number),
    fornecedor: texto(d.supplier),
    modo: texto(d.conference_mode) === "per_box" ? "por caixa" : "por linha",
    status: texto(d.status),
    criada: quando(d.created_at),
    recebida: quando(d.received_at),
    linhas: null,
  };
  cache.set(receiptId, info);
  return info;
}

async function principal() {
  const args = { projeto: "", cliente: "BTG Pactual", codigos: [], pedido: "", caixas: [] };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const proximo = () => argv[(i += 1)];
    if (a === "--projeto") args.projeto = texto(proximo());
    else if (a === "--cliente") args.cliente = texto(proximo());
    else if (a === "--codigo") args.codigos.push(texto(proximo()));
    else if (a === "--pedido") args.pedido = texto(proximo()).toUpperCase();
    else if (a === "--caixa") args.caixas.push(texto(proximo()).toUpperCase());
    else {
      console.error(`Argumento desconhecido: ${a}`);
      process.exit(2);
    }
  }
  if (!args.projeto || (!args.codigos.length && !args.caixas.length)) {
    console.error("Informe --projeto e ao menos um --codigo ou --caixa.");
    process.exit(2);
  }
  const abortar = (mensagem) => {
    console.error(`\nABORTADO: ${mensagem}\n`);
    process.exit(2);
  };
  const { app, db } = abrirFirestore(args.projeto, abortar);
  let datas = null;
  try {
    datas = await import(pathToFileURL(path.join(RAIZ, "functions", "wms", "lib", "domain", "datas-do-estoque.js")).href);
  } catch {
    console.log("(sem as datas de entrada: rode npm --prefix functions/wms run build)");
  }
  const cliente = args.cliente;
  const chegadas = new Map();
  const tarefas = new Map();
  console.log(`\nLeitura do estoque · projeto ${args.projeto} · ${cliente} · só leitura, nada é gravado`);

  // O pedido: a tarefa de separação e as linhas, para cruzar com cada SKU.
  let linhasDoPedido = [];
  if (args.pedido) {
    const tarefas = (await lerDocs(db.collection("pick_tasks").where("order_number", "==", args.pedido))).filter((d) => clienteDe(d.data()) === cliente);
    for (const tarefa of tarefas) {
      linhasDoPedido.push(...(await lerDocs(db.collection("pick_lines").where("pick_task_id", "==", tarefa.id))).map((d) => d.data()));
    }
    console.log(`Pedido ${args.pedido}: ${tarefas.length ? tarefas.map((t) => `separação ${texto(t.data().status)}`).join(", ") : "não encontrado"} · ${linhasDoPedido.length} linha(s)`);
  }

  for (const codigo of args.codigos) {
    const skus = await skusDoCodigo(db, codigo, cliente);
    if (!skus.length) {
      console.log(`\n== ${codigo}: nenhum SKU de ${cliente} com esse código`);
      continue;
    }
    for (const skuDoc of skus) {
      const sku = skuDoc.id;
      const s = skuDoc.data();
      console.log(`\n== ${texto(s.cod_cliente || s.client_item_code) || codigo} · ${sku} · "${texto(s.produto || s.name)}"${texto(s.status) === "archived" || s.archived ? " · ARQUIVADO" : ""}${texto(s.source_receipt_id) ? ` · nasceu na chegada ${(await chegada(db, chegadas, texto(s.source_receipt_id))).numero}` : ""}`);
      const saldos = (await lerDocs(db.collection("stock_balances").where("sku_code", "==", sku))).filter((d) => clienteDe(d.data()) === cliente).map((d) => d.data());
      console.log(`   saldo     : ${saldos.filter((b) => num(b.qty_on_hand) || num(b.qty_reserved)).map((b) => `${texto(b.location_id)} ${fmt(num(b.qty_on_hand))}${num(b.qty_reserved) ? ` (reservado ${fmt(num(b.qty_reserved))})` : ""}`).join(" · ") || "nenhum"}`);
      if (datas) console.log(`   datas     : ${textoDasDatas((await datas.lerDatasDoEstoque(db, cliente, sku)).locais)}`);
      const movimentos = (await lerDocs(db.collection("movements").where("sku_code", "==", sku)))
        .map((d) => d.data())
        .filter((m) => clienteDe(m) === cliente)
        .sort((a, b) => String(a.created_at?.toDate?.().toISOString() ?? a.occurred_at ?? "").localeCompare(String(b.created_at?.toDate?.().toISOString() ?? b.occurred_at ?? "")));
      for (const m of movimentos) {
        const tarefa = texto(m.putaway_task_id);
        if (!texto(m.receipt_id) && tarefa && !tarefas.has(tarefa)) {
          const snap = await db.collection("putaway_tasks").doc(tarefa).get();
          tarefas.set(tarefa, snap.exists ? texto(snap.data().receipt_id) : "");
        }
        await chegada(db, chegadas, texto(m.receipt_id) || tarefas.get(tarefa) || "");
      }
      console.log(`   movimentos: ${movimentos.length}`);
      for (const m of movimentos) console.log(`     ${linhaDoMovimento(m, chegadas, tarefas)}`);
      // As caixas com o item: as que o listam em sku_codes e as que têm linha da abertura dele.
      const daAbertura = (await lerDocs(db.collection("opening_inventory_lines").where("sku_code", "==", sku))).map((d) => d.data()).filter((l) => clienteDe(l) === cliente);
      const codigosDeCaixa = new Set([
        ...(await lerDocs(db.collection("warehouse_boxes").where("sku_codes", "array-contains", sku))).map((d) => d.id),
        ...daAbertura.map((l) => texto(l.box_code).toUpperCase()).filter(Boolean),
      ]);
      console.log(`   caixas    : ${codigosDeCaixa.size}`);
      for (const codigoDaCaixa of [...codigosDeCaixa].sort()) {
        const snap = await db.collection("warehouse_boxes").doc(codigoDaCaixa).get();
        if (!snap.exists) {
          console.log(`     ${codigoDaCaixa} · não está mais no registro (linha da abertura ainda aponta para ela)`);
          continue;
        }
        const caixa = { ...snap.data(), id: snap.id };
        const origem = caixa.origin ?? {};
        const deOnde = origem.kind === "receipt" ? `chegada ${(await chegada(db, chegadas, texto(origem.receipt_id)))?.numero}` : texto(origem.session_id) ? "abertura" : "outra";
        const linhaAbertura = daAbertura.filter((l) => texto(l.box_code).toUpperCase() === codigoDaCaixa);
        const entrou = entradaDaCaixa(caixa, linhaAbertura, sku);
        const saiu = retiradoDaCaixa(caixa, sku);
        const localDaLinha = [...new Set(linhaAbertura.map((l) => texto(l.location_id)).filter(Boolean))].join(", ");
        console.log(`     ${codigoDaCaixa} · ${texto(caixa.status) || "?"} em ${texto(caixa.location_id) || "sem prateleira"}${quando(caixa.stored_at) ? ` desde ${quando(caixa.stored_at)}` : ""} · ${deOnde} · entrou ${fmt(entrou)} · separação tirou ${fmt(saiu)} · fica ${fmt(Math.max(0, entrou - saiu))}${localDaLinha && localDaLinha !== texto(caixa.location_id) ? ` · ATENÇÃO: a linha da abertura diz ${localDaLinha}` : ""}`);
      }
      const doPedido = linhasDoPedido.filter((l) => texto(l.sku_code) === sku);
      for (const l of doPedido) {
        const caixas = (Array.isArray(l.separated_boxes) ? l.separated_boxes : []).map((c) => `${fmt(num(c.qty))} de ${texto(c.box_code)}`).join(", ");
        const falta = texto(l.separated_shortage_reason || l.shortage_reason);
        console.log(`   ${args.pedido} : linha ${num(l.line_number)} · ${texto(l.location_id)} · pedido ${fmt(num(l.qty_to_pick))} · separado ${fmt(num(l.qty_picked || l.separated_qty))}${caixas ? ` (${caixas})` : ""}${falta ? ` · ${falta}${texto(l.separated_shortage_detail || l.shortage_detail) ? `: "${texto(l.separated_shortage_detail || l.shortage_detail)}"` : ""}` : ""} · ${texto(l.status)}`);
      }
    }
  }

  for (const codigoDaCaixa of args.caixas) {
    const snap = await db.collection("warehouse_boxes").doc(codigoDaCaixa).get();
    if (!snap.exists) {
      console.log(`\n== ${codigoDaCaixa}: não existe`);
      continue;
    }
    const caixa = snap.data();
    const abertura = (await lerDocs(db.collection("opening_inventory_lines").where("box_code", "==", codigoDaCaixa))).map((d) => d.data());
    const conteudo = linhasDe(caixa).length
      ? linhasDe(caixa).map((l) => `${texto(l.client_item_code) || texto(l.sku_code)} ${fmt(num(l.counted_qty))}`)
      : abertura.map((l) => `${texto(l.client_item_code) || texto(l.sku_code)} ${fmt(num(l.counted_qty))}${texto(l.location_id) && texto(l.location_id) !== texto(caixa.location_id) ? ` (linha em ${texto(l.location_id)})` : ""}`);
    const retirado = (Array.isArray(caixa.taken_lines) ? caixa.taken_lines : []).map((t) => `${texto(t.sku_code)} ${fmt(num(t.qty))}`);
    console.log(`\n== ${codigoDaCaixa} · ${texto(caixa.status)} em ${texto(caixa.location_id) || "sem prateleira"} · ${fmt(num(caixa.unit_count))} un. no registro · entrou: ${conteudo.join(", ") || "nada"} · separação tirou: ${retirado.join(", ") || "nada"}`);
  }

  // As chegadas citadas, com as linhas da NF: duas chegadas com a mesma NF e as mesmas peças são a mesma mercadoria.
  if (chegadas.size) console.log("\n== chegadas citadas");
  for (const info of [...chegadas.values()].filter(Boolean).sort((a, b) => a.numero.localeCompare(b.numero))) {
    if (!info.existe) {
      console.log(`   ${info.id}: não existe mais`);
      continue;
    }
    const linhas = (await lerDocs(db.collection("inbound_items").where("receipt_id", "==", info.id))).map((d) => d.data()).sort((a, b) => num(a.line_number) - num(b.line_number));
    console.log(`   ${info.numero} · NF ${info.nf || "?"}${info.fornecedor ? ` · ${info.fornecedor}` : ""} · ${info.modo} · ${info.status}${info.criada ? ` · criada ${info.criada}` : ""}${info.recebida ? ` · recebida ${info.recebida}` : ""}`);
    console.log(`      linhas da NF: ${linhas.map((l) => `${texto(l.client_item_code) || texto(l.sku_code)} ${fmt(num(l.received_qty ?? l.expected_qty))}`).join(" · ") || "nenhuma"}`);
  }
  console.log("\nLeitura encerrada. Nada foi gravado.");
  await app.delete();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  principal().catch((erro) => {
    console.error(erro);
    process.exit(1);
  });
}
