#!/usr/bin/env node
/**
 * Tira da cobrança de novembro a chegada repetida da BTG (caso.mjs). Roteiro
 * em README.md.
 *
 * A seco (padrão): lê o banco e mostra a chegada, as entradas que saem, a
 * situação da competência e a prévia do mês antes e depois, com a mesma conta
 * da tela Faturamento. Não grava nada: só há leitura fora de `gravar`.
 *
 *   node tools/tirar-chegada-da-cobranca/tirar.mjs --projeto dute-prod
 *
 * Gravar: marca as entradas da chegada com `billable: false` (o filtro que a
 * prévia e a emissão do WMS já têm), numa transação com o recibo
 * (operational_operations) e o evento (events). A transação lê de novo a
 * competência, a foto do uso e os movimentos antes de escrever, e recusa como
 * a seco. A chave é fixa: rodar de novo não grava outra vez.
 *
 *   node tools/tirar-chegada-da-cobranca/tirar.mjs --projeto dute-prod --aplicar --confirmo "COBRANCA BTG dute-prod"
 *
 * `--json <arquivo>` grava o resumo (o cenário do emulador confere por ele).
 * Pré-requisitos: npm --prefix functions/wms ci e run build, e a credencial
 * (gcloud auth application-default login), ou o emulador com projeto demo-*.
 */

import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { abrirFirestore } from "../padronizar-nomes/firestore.mjs";
import { CASO as CASO_DA_BTG } from "./caso.mjs";
import {
  comMarca,
  dataDaCobranca,
  diferenca,
  entradaDaPrevia,
  eventoDaRetirada,
  idDaOperacao,
  idDoEvento,
  marcaDoMovimento,
  movimentosDaChegada,
  pecasDe,
  reciboDaRetirada,
  recusas,
  rotuloDoMes,
  tabelaDoCliente,
} from "./regras.mjs";

function abortar(mensagem) {
  console.error(`\nABORTADO: ${mensagem}\n`);
  process.exit(2);
}

const args = (() => {
  const out = { projeto: "", aplicar: false, confirmo: "", json: "" };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const proximo = () => {
      const valor = argv[(i += 1)];
      if (valor === undefined) abortar(`Falta o valor de ${a}.`);
      return valor;
    };
    if (a === "--projeto") out.projeto = proximo();
    else if (a === "--aplicar") out.aplicar = true;
    else if (a === "--dry-run") out.aplicar = false;
    else if (a === "--confirmo") out.confirmo = proximo();
    else if (a === "--json") out.json = proximo();
    else abortar(`Argumento desconhecido: ${a}`);
  }
  if (!out.projeto) abortar("Diga o projeto: --projeto dute-prod (ou demo-* com o emulador).");
  return out;
})();

const { db, FieldValue, emulador } = abrirFirestore(args.projeto, abortar);

// TIRAR_CASO aponta outro caso, só com o emulador: o cenário cria a chegada pelo fluxo de verdade, com outro número.
if (process.env.TIRAR_CASO && !emulador) abortar("TIRAR_CASO só vale com o emulador.");
const CASO = process.env.TIRAR_CASO
  ? (await import(pathToFileURL(path.resolve(process.env.TIRAR_CASO)).href)).CASO
  : CASO_DA_BTG;
const CONFIRMACAO = `COBRANCA BTG ${args.projeto}`;
if (args.aplicar && !emulador && args.confirmo !== CONFIRMACAO) {
  abortar(`Para gravar na nuvem, passe --confirmo "${CONFIRMACAO}". Sem isso a ferramenta só lê.`);
}

let WMS;
try {
  ({ WMS } = await import("./wms.mjs"));
} catch (erro) {
  abortar(erro.message);
}

// --- Leitura -------------------------------------------------------------------------

const texto = (valor) => (typeof valor === "string" || typeof valor === "number" ? String(valor).trim() : "");
const comId = (snap) => snap.docs.map((doc) => ({ ...doc.data(), id: doc.id }));
const pares = (snap) => snap.docs.map((doc) => ({ id: doc.id, data: doc.data() }));
const digest = (valor) => createHash("sha256").update(JSON.stringify(valor)).digest("hex");
const porData = (a, b) => dataDaCobranca(a.occurred_at ?? a.data).localeCompare(dataDaCobranca(b.occurred_at ?? b.data)) || a.id.localeCompare(b.id);

/** O documento da competência como `resolveBillingDocument`: o novo e, só na BTG, o antigo (`AAAA-MM`). */
function refsDaCompetencia(colecao) {
  const refs = [db.collection(colecao).doc(WMS.billingDocumentId(CASO.cliente, CASO.competencia))];
  const antigo = WMS.legacyBillingDocumentId(CASO.cliente, CASO.competencia);
  if (antigo) refs.push(db.collection(colecao).doc(antigo));
  return refs;
}

async function resolvido(refs, tx) {
  for (const ref of refs) {
    const snap = tx ? await tx.get(ref) : await ref.get();
    if (snap.exists) return { ref, data: snap.data() ?? {} };
  }
  return { ref: refs[0], data: null };
}

async function ler() {
  const recebimentos = comId(await db.collection("inbound_receipts").where("receipt_number", "==", CASO.chegada).get());
  const doCliente = recebimentos.filter((r) => texto(r.customer_code) === CASO.cliente);
  if (doCliente.length > 1) abortar(`Há ${doCliente.length} chegadas ${CASO.chegada} da ${CASO.cliente}: ${doCliente.map((r) => r.id).join(", ")}.`);
  const recebimento = doCliente[0] ?? recebimentos[0] ?? null;

  const daChegada = new Map();
  if (recebimento) {
    for (const m of comId(await db.collection("movements").where("receipt_id", "==", recebimento.id).get())) daChegada.set(m.id, m);
  }
  for (const m of comId(await db.collection("movements").where("receipt_number", "==", CASO.chegada).get())) daChegada.set(m.id, m);
  const achados = movimentosDaChegada([...daChegada.values()].sort(porData), CASO, recebimento, WMS);

  const periodo = await resolvido(refsDaCompetencia("billing_periods"));
  const foto = await resolvido(refsDaCompetencia("billing_operational_snapshots"));
  const recibo = await db.collection("operational_operations").doc(idDaOperacao(CASO)).get();

  // Os documentos que a prévia do WMS lê (loadBillingCalculation).
  const tabelaDePrecos = CASO.cliente === WMS.CLIENTE_PADRAO
    ? db.collection("billing_price_list")
    : db.collection("billing_price_list").where("customer_code", "==", CASO.cliente);
  const dados = {
    competencia: CASO.competencia,
    cliente: CASO.cliente,
    clientePadrao: WMS.CLIENTE_PADRAO,
    precos: pares(await tabelaDePrecos.get()),
    tabelas: pares(await db.collection(WMS.COMERCIAL_PRICE_TABLES).where("customer_code", "==", CASO.cliente).get()),
    manual: (await resolvido(refsDaCompetencia("billing_manual"))).data,
    config: (await db.collection("billing_config").doc("default").get()).data() ?? null,
    estoque: (await db.collection("client_inventory").where("customer_code", "==", CASO.cliente).get()).docs.map((doc) => doc.data()),
    precosDoCatalogo: (await db.collection(WMS.CATALOG_PRICES).where("customer_code", "==", CASO.cliente).get()).docs.map((doc) => doc.data()),
    movimentos: comId(await db.collection("movements").where("customer_code", "==", CASO.cliente).get()),
  };
  const depois = { ...dados, movimentos: comMarca(dados.movimentos, achados.cobrados.map((m) => m.id), marcaDoMovimento(CASO, idDaOperacao(CASO))) };
  // O uso não depende do preço: sem a Tabela de preços, a conta do uso sai mesmo quando a prévia recusa um preço.
  const uso = { antes: entradaDaPrevia({ ...dados, precos: [] }, WMS).usage, depois: entradaDaPrevia({ ...depois, precos: [] }, WMS).usage };
  let previa = null;
  let linhasDeHoje = [];
  let erroDaPrevia = null;
  try {
    const antes = WMS.calculateBillingPeriod(entradaDaPrevia(dados, WMS));
    previa = diferenca(antes, WMS.calculateBillingPeriod(entradaDaPrevia(depois, WMS)));
    linhasDeHoje = antes.linhas.map((linha) => ({ grupo: linha.grupo, item: linha.item, auto_source: linha.auto_source, qtde: linha.qtde, valor_unit: linha.valor_unit, total_cents: linha.total_cents }));
  } catch (erro) {
    erroDaPrevia = erro.message;
  }
  // Os itens da Tabela de preços do cliente que tiram a quantidade dos movimentos: só eles mudam de valor.
  const itensDoUso = tabelaDoCliente(dados, WMS)
    .filter((item) => WMS.FONTES_DO_USO.includes(item.auto_source))
    .map((item) => ({ item: item.item, auto_source: item.auto_source, ativo: item.ativo }));

  const lista = recusas({ caso: CASO, recebimento, achados, periodo: periodo.data, foto: foto.data });
  const situacao = recibo.exists ? "ja_aplicado" : lista.length ? "recusado" : "a_gravar";
  return { recebimento, achados, periodo, foto, recibo: recibo.exists, uso, previa, linhasDeHoje, itensDoUso, erroDaPrevia, recusas: lista, situacao };
}

// --- Gravação ------------------------------------------------------------------------

class Recusada extends Error {
  constructor(lista) {
    super(lista.join("\n"));
    this.recusas = lista;
  }
}

async function gravar(leitura) {
  const opId = idDaOperacao(CASO);
  const reciboRef = db.collection("operational_operations").doc(opId);
  const eventoRef = db.collection("events").doc(idDoEvento(CASO));
  const refs = [...leitura.achados.cobrados, ...leitura.achados.jaFora].map((m) => db.collection("movements").doc(m.id));
  const marca = marcaDoMovimento(CASO, opId);
  return db.runTransaction(async (tx) => {
    if ((await tx.get(reciboRef)).exists) return { jaAplicado: true, gravados: [] };
    // Tudo de novo, na transação: a competência pode ter sido emitida, ou o uso congelado, depois da leitura.
    const periodo = await resolvido(refsDaCompetencia("billing_periods"), tx);
    const foto = await resolvido(refsDaCompetencia("billing_operational_snapshots"), tx);
    const snaps = refs.length ? await tx.getAll(...refs) : [];
    const achados = movimentosDaChegada(snaps.filter((s) => s.exists).map((s) => ({ ...s.data(), id: s.id })), CASO, leitura.recebimento, WMS);
    const lista = recusas({ caso: CASO, recebimento: leitura.recebimento, achados, periodo: periodo.data, foto: foto.data });
    if (snaps.some((s) => !s.exists)) lista.push("Um movimento da leitura não está mais no banco.");
    if (!achados.cobrados.length) lista.push(`Nenhuma entrada da chegada ${CASO.chegada} para tirar: as do mês já estão fora da cobrança, sem o recibo desta ferramenta.`);
    if (lista.length) throw new Recusada(lista);
    for (const m of achados.cobrados) {
      tx.update(db.collection("movements").doc(m.id), {
        billable: false,
        billing_exclusion: { ...marca.billing_exclusion, at: FieldValue.serverTimestamp() },
      });
    }
    tx.create(eventoRef, { ...eventoDaRetirada(CASO, achados, opId), occurred_at: new Date().toISOString(), created_at: FieldValue.serverTimestamp() });
    tx.create(reciboRef, {
      ...reciboDaRetirada(CASO, achados, opId),
      input_hash: digest({ caso: CASO.id, movimentos: achados.cobrados.map((m) => m.id) }),
      created_at: FieldValue.serverTimestamp(),
    });
    return { jaAplicado: false, gravados: achados.cobrados.map((m) => m.id) };
  });
}

// --- Saída ---------------------------------------------------------------------------

/** Os rótulos da tela Faturamento (artifacts/app/src/lib/billing-format.ts, AUTO_LABELS). */
const ROTULO_DA_FONTE = {
  ad_valorem: "% do estoque",
  mov_entrada_pecas: "Entradas (peças)",
  mov_saida_pecas: "Saídas (peças)",
  mov_count: "Nº de movimentações",
};
const reais = (cents) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const preco = (valor) => Number(valor).toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 4 });
const pecas = (n) => n.toLocaleString("pt-BR");
const sinalDe = (cents) => (cents < 0 ? `−${reais(-cents)}` : `+${reais(cents)}`);
const dataBr = (iso) => {
  const data = new Date(iso);
  return Number.isNaN(data.getTime()) ? "sem data" : data.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
};
const linhaDoMovimento = (m) =>
  `${dataBr(dataDaCobranca(m.occurred_at ?? m.data))} · ${texto(m.tipo_mov) || "?"} ${pecas(pecasDe(m))} em ${texto(m.location_id) || "?"} · ${texto(m.sku_code)}${texto(m.client_item_code) ? ` (${texto(m.client_item_code)})` : ""} · ${texto(m.source) || "sem origem"} · ${m.id}`;

function imprimir(l, titulo) {
  const mes = rotuloDoMes(CASO.competencia);
  const [ano, mesSeguinte, dia] = WMS.emissionAvailableFrom(CASO.competencia).split("-");
  const fechado = WMS.isCompetenciaClosed(CASO.competencia, new Date());
  console.log(`\n=== ${titulo} ===`);
  console.log(`Agora: ${dataBr(new Date().toISOString())} (São Paulo). ${fechado ? `${mes} já terminou` : `${mes} termina em ${dia}/${mesSeguinte}/${ano} 00:00`}; a primeira prévia ou emissão depois disso congela o uso do mês (a tela Faturamento abre no mês anterior).`);

  const r = l.recebimento;
  console.log(`\nChegada ${CASO.chegada}: ${r ? `${r.id} · ${texto(r.customer_code)} · NF ${texto(r.invoice_number) || "sem número"} · ${texto(r.conference_mode) || "por linha"} · ${texto(r.status)}` : "não encontrada"}`);
  const doMes = [...l.achados.cobrados, ...l.achados.jaFora];
  console.log(`  Saem da cobrança de ${mes}: ${l.achados.cobrados.length} entrada(s), ${pecas(l.achados.cobrados.reduce((s, m) => s + pecasDe(m), 0))} peças${l.achados.cobrados.length ? ":" : ""}`);
  for (const m of l.achados.cobrados) console.log(`    ${linhaDoMovimento(m)}`);
  if (l.achados.jaFora.length) {
    console.log(`  Já fora da cobrança: ${l.achados.jaFora.length} entrada(s), ${pecas(l.achados.jaFora.reduce((s, m) => s + pecasDe(m), 0))} peças:`);
    for (const m of l.achados.jaFora) console.log(`    ${linhaDoMovimento(m)}`);
  }
  if (l.achados.foraDoMes.length) {
    console.log(`  Entradas fora de ${mes}:`);
    for (const m of l.achados.foraDoMes) console.log(`    ${linhaDoMovimento(m)}`);
  }
  if (l.achados.semCobranca.length) console.log(`  Não se cobram (a guarda da caixa): ${l.achados.semCobranca.length} movimento(s).`);
  console.log(`  O caso espera ${CASO.esperado.movimentos} entradas com ${pecas(CASO.esperado.pecas)} peças no mês; a leitura achou ${doMes.length} com ${pecas(doMes.reduce((s, m) => s + pecasDe(m), 0))}.`);

  const p = l.periodo.data;
  const f = l.foto.data;
  console.log(`\nCompetência ${mes}: ${p ? `${texto(p.status) || "aberto"}${p.emitido_em ? `, emitida em ${dataBr(dataDaCobranca(p.emitido_em))}` : ""} (${l.periodo.ref.id})` : "aberta, sem documento (ninguém salvou as quantidades nem emitiu)"}.`);
  console.log(`Foto do uso: ${f ? `${texto(f.mode) || "sem modo"}${f.frozen_at ? ` de ${dataBr(dataDaCobranca(f.frozen_at))}` : ""}, com ${pecas(Number(f.usage?.entradas_pecas ?? 0))} peças de entrada e ${pecas(Number(f.usage?.movimentacoes ?? 0))} movimentos (${l.foto.ref.id})` : "nenhuma (a prévia ainda conta os movimentos)"}.`);
  console.log(`Recibo desta ferramenta: ${l.recibo ? "gravado (já aplicado)" : "nenhum"}.`);

  console.log(`\nUso de ${mes} pelos movimentos de hoje (antes → depois):`);
  console.log(`  Entradas (peças)      ${pecas(l.uso.antes.entradas_pecas)} → ${pecas(l.uso.depois.entradas_pecas)}`);
  console.log(`  Saídas (peças)        ${pecas(l.uso.antes.saidas_pecas)} → ${pecas(l.uso.depois.saidas_pecas)}`);
  console.log(`  Nº de movimentações   ${pecas(l.uso.antes.movimentacoes)} → ${pecas(l.uso.depois.movimentacoes)}`);
  if (f) {
    console.log(`\nCom a foto, a tela Faturamento lê só o uso dela (acima): a conta pelos movimentos não vale mais para ${mes}.`);
  } else if (l.previa) {
    console.log(`\nPrévia de ${mes} hoje, a conta da tela Faturamento (antes → depois):`);
    if (!l.previa.linhas.length) {
      console.log(l.achados.cobrados.length ? "  Nenhuma linha muda: a Tabela de preços não cobra por entrada nem por movimento." : "  Nenhuma linha muda: não há entrada a tirar.");
    }
    for (const linha of l.previa.linhas) {
      const a = linha.antes;
      const d = linha.depois;
      console.log(`  ${linha.item}: ${pecas(a.qtde)} × ${preco(a.valor_unit)} = ${reais(a.total_cents)} → ${d ? `${pecas(d.qtde)} × ${preco(d.valor_unit)} = ${reais(d.total_cents)}` : "sai"} (${sinalDe((d?.total_cents ?? 0) - a.total_cents)})`);
    }
    console.log(`  Total: ${reais(l.previa.total_antes_cents)} → ${reais(l.previa.total_depois_cents)} (${sinalDe(l.previa.delta_cents)})`);
    console.log("  O total de hoje ainda muda até o uso congelar: o ad valorem segue o estoque, e as entradas e saídas do resto do mês somam.");
    const doUso = l.itensDoUso.map((i) => `${i.item} (${ROTULO_DA_FONTE[i.auto_source] ?? i.auto_source}${i.ativo ? "" : ", inativo"})`);
    console.log(`  Itens da Tabela de preços que tiram a quantidade dos movimentos: ${doUso.length ? doUso.join("; ") : "nenhum"}.`);
    console.log(`  As ${l.linhasDeHoje.length} linhas da prévia de hoje:`);
    for (const linha of l.linhasDeHoje) {
      const conta = linha.auto_source === WMS.AD_VALOREM
        ? `mercadoria ${reais(Math.round(linha.qtde * 100))} × ${(linha.valor_unit * 100).toLocaleString("pt-BR", { maximumFractionDigits: 4 })}%`
        : `${pecas(linha.qtde)} × ${preco(linha.valor_unit)}`;
      console.log(`    ${linha.grupo} · ${linha.item}: ${conta} = ${reais(linha.total_cents)}${linha.auto_source ? ` (${ROTULO_DA_FONTE[linha.auto_source] ?? linha.auto_source})` : ""}`);
    }
  } else if (l.erroDaPrevia) {
    console.log(`\nA prévia de ${mes} recusa hoje, como a tela recusaria: ${l.erroDaPrevia}`);
  }

  console.log("");
  if (l.situacao === "ja_aplicado") console.log("SITUAÇÃO: já aplicado. Nada a gravar.");
  else if (l.situacao === "recusado") for (const recusa of l.recusas) console.log(`RECUSA: ${recusa}`);
  else console.log(`SITUAÇÃO: a gravar ${l.achados.cobrados.length} movimento(s) com billable: false, o evento ${idDoEvento(CASO)} e o recibo ${idDaOperacao(CASO)}.`);
}

function resumo(l, gravacao) {
  const ids = (lista) => lista.map((m) => m.id);
  return {
    caso: CASO.id,
    projeto: args.projeto,
    situacao: l.situacao,
    recusas: l.recusas,
    chegada: l.recebimento ? { id: l.recebimento.id, numero: texto(l.recebimento.receipt_number), nf: texto(l.recebimento.invoice_number) } : null,
    cobrados: ids(l.achados.cobrados),
    ja_fora: ids(l.achados.jaFora),
    fora_do_mes: ids(l.achados.foraDoMes),
    sem_cobranca: ids(l.achados.semCobranca),
    periodo: l.periodo.data ? { id: l.periodo.ref.id, status: texto(l.periodo.data.status) || "aberto" } : null,
    foto: l.foto.data ? { id: l.foto.ref.id, mode: texto(l.foto.data.mode) } : null,
    uso: l.uso,
    previa: l.previa,
    linhas_de_hoje: l.linhasDeHoje,
    itens_do_uso: l.itensDoUso,
    erro_da_previa: l.erroDaPrevia,
    gravacao: gravacao ?? null,
  };
}

// --- Execução ------------------------------------------------------------------------

console.log(`Chegada repetida fora da cobrança · caso ${CASO.id} · projeto ${args.projeto}${emulador ? " (emulador)" : ""} · ${args.aplicar ? "GRAVAÇÃO" : "a seco, nada é gravado"}`);
const leitura = await ler();
imprimir(leitura, "Leitura");

let gravacao = null;
let codigo = leitura.situacao === "recusado" ? 1 : 0;
let final = leitura;
if (args.aplicar && leitura.situacao === "a_gravar") {
  try {
    gravacao = await gravar(leitura);
  } catch (erro) {
    if (!(erro instanceof Recusada)) throw erro;
    gravacao = { jaAplicado: false, gravados: [], recusas: erro.recusas };
    for (const recusa of erro.recusas) console.log(`RECUSA NA GRAVAÇÃO: ${recusa}`);
    codigo = 1;
  }
  if (gravacao.gravados.length) console.log(`\nGRAVADO: ${gravacao.gravados.length} movimento(s) fora da cobrança (${gravacao.gravados.join(", ")}), o evento e o recibo.`);
  else if (gravacao.jaAplicado) console.log("\nJá aplicado por outra execução: nada gravado.");
  final = await ler();
  imprimir(final, "Depois da gravação");
  if (final.foto.data && gravacao.gravados.length) {
    console.log(`\nATENÇÃO: a foto do uso existe (${final.foto.ref.id}). Confira se as entradas dela (${pecas(Number(final.foto.data.usage?.entradas_pecas ?? 0))}) já são as de depois (${pecas(leitura.uso.depois.entradas_pecas)}).`);
  }
}
if (args.json) writeFileSync(args.json, `${JSON.stringify(resumo(final, gravacao), null, 2)}\n`);
process.exit(codigo);
