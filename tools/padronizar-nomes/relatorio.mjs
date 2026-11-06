#!/usr/bin/env node
/**
 * Relatório dos nomes de produto fora do padrão: o passo 1 da padronização
 * do catálogo (decisões do Leonardo de 06/11/2026, mockups em
 * docs/mockups/Nome*.dc.html, roteiro em README.md desta pasta).
 *
 * SÓ LEITURA. Lê `skus` e `products` do projeto, aplica o padrão de
 * regras.mjs a cada SKU ativo, confere a família (o nome tem de ser o mesmo
 * em todos os tamanhos) e grava um CSV para revisão em tmp/. Não grava nada
 * no Firestore: não há FieldValue, set, update nem create neste arquivo.
 *
 *   node tools/padronizar-nomes/relatorio.mjs --projeto dute-prod
 *   node tools/padronizar-nomes/relatorio.mjs --projeto dute-prod --familia A.01.0806.005
 *   node tools/padronizar-nomes/relatorio.mjs --projeto dute-prod --cliente BTG --saida tmp/nomes.csv
 *
 * Pré-requisitos: `npm --prefix functions/wms ci` (o firebase-admin vem de
 * lá) e `gcloud auth application-default login` com uma conta do projeto; ou
 * FIRESTORE_EMULATOR_HOST apontando para o emulador local, com projeto demo-*.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { familiaDoCodigo, ordemDoTamanho, padronizarNome } from "./regras.mjs";

// --- Puro: montar o relatório a partir dos registros ---------------------------------

const texto = (v) => String(v ?? "").trim();
const num = (v) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
/** A chave de busca do código, como as Functions comparam (cod_cliente_key). */
const chaveDoCodigo = (v) =>
  texto(v)
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ");
const arquivado = (data) => data.archived === true || texto(data.status) === "archived";

/** Os campos de um documento de `skus` que o relatório usa. `id` é o SKU (BTG-000126). */
export function linhaDoSku(id, data) {
  return {
    sku: texto(id),
    cliente: texto(data.customer_code),
    codigo: texto(data.cod_cliente || data.client_item_code),
    nome: texto(data.produto || data.name || data.product_name),
    tamanho: texto(data.tamanho || data.size),
    genero: texto(data.genero),
    estoque: num(data.estoque_atual),
    arquivado: arquivado(data),
  };
}

/** O nome que a família adota: o mais comum entre os tamanhos; empate, o de mais saldo; depois, o do menor tamanho. */
export function nomeDaFamilia(membros) {
  const porNome = new Map();
  for (const membro of membros) {
    if (!membro.proprio.nome) continue;
    const atual = porNome.get(membro.proprio.nome) ?? { nome: membro.proprio.nome, vezes: 0, estoque: 0, ordem: Infinity };
    atual.vezes += 1;
    atual.estoque += membro.linha.estoque;
    atual.ordem = Math.min(atual.ordem, ordemDoTamanho(membro.proprio.tamanho));
    porNome.set(membro.proprio.nome, atual);
  }
  const candidatos = [...porNome.values()].sort((a, b) => b.vezes - a.vezes || b.estoque - a.estoque || a.ordem - b.ordem || a.nome.localeCompare(b.nome, "pt-BR"));
  return candidatos[0]?.nome ?? "";
}

/**
 * As linhas do relatório e o resumo. `skus` e `products` são os documentos
 * como vieram do Firestore ({ id, ...data }); `cliente` e `familia` filtram.
 */
export function montarRelatorio({ skus, products, cliente = "", familia = "", comArquivados = false }) {
  const todas = skus.map((doc) => linhaDoSku(doc.id, doc));
  const arquivados = todas.filter((l) => l.arquivado).length;
  const linhas = todas.filter((l) => (comArquivados || !l.arquivado) && (!cliente || l.cliente === cliente) && (!familia || chaveDoCodigo(l.codigo).startsWith(chaveDoCodigo(familia))));

  // products por código: o apply grava skus e products juntos, então o nome dos dois tem de bater.
  // Chave por cliente e código (invariante 4): dois clientes podem ter o mesmo código.
  const produtos = new Map();
  for (const doc of products) {
    for (const chave of [chaveDoCodigo(doc.cod_cliente_key), chaveDoCodigo(doc.cod_cliente), chaveDoCodigo(doc.id)]) {
      const composta = `${texto(doc.customer_code)}|${chave}`;
      if (chave && !produtos.has(composta)) produtos.set(composta, doc);
    }
  }

  // SKUs ativos com o mesmo código: o apply não sabe qual renomear.
  const porCodigo = new Map();
  for (const linha of linhas) {
    if (linha.arquivado) continue;
    const chave = `${linha.cliente}|${chaveDoCodigo(linha.codigo)}`;
    porCodigo.set(chave, [...(porCodigo.get(chave) ?? []), linha.sku]);
  }

  const membros = linhas.map((linha) => ({
    linha,
    proprio: padronizarNome({ nome: linha.nome, codigo: linha.codigo, genero: linha.genero, tamanho: linha.tamanho }),
    conferir: [],
  }));

  const familias = new Map();
  for (const membro of membros) {
    const chave = `${membro.linha.cliente}|${chaveDoCodigo(familiaDoCodigo(membro.linha.codigo))}`;
    familias.set(chave, [...(familias.get(chave) ?? []), membro]);
  }
  for (const grupo of familias.values()) {
    const nome = nomeDaFamilia(grupo);
    for (const membro of grupo) {
      membro.familia = texto(familiaDoCodigo(membro.linha.codigo));
      membro.proposto = nome || membro.proprio.nome;
      if (nome && membro.proprio.nome && membro.proprio.nome !== nome) membro.conferir.push(`difere da família: "${membro.proprio.nome}"`);
    }
  }

  for (const membro of membros) {
    const { linha } = membro;
    const duplicados = porCodigo.get(`${linha.cliente}|${chaveDoCodigo(linha.codigo)}`) ?? [];
    if (duplicados.length > 1) membro.conferir.push(`código com ${duplicados.length} SKUs ativos (${duplicados.join(", ")})`);
    const produto = produtos.get(`${linha.cliente}|${chaveDoCodigo(linha.codigo)}`);
    if (!produto) membro.conferir.push("sem registro em products");
    else if (texto(produto.produto || produto.name || produto.product_name) !== linha.nome) {
      membro.conferir.push(`products com outro nome: "${texto(produto.produto || produto.name || produto.product_name)}"`);
    }
    if (linha.arquivado) membro.conferir.push("arquivado");
  }

  const resultado = membros.map((membro) => {
    const { linha, proprio } = membro;
    const conferir = [...proprio.conferir, ...membro.conferir];
    const mudouNome = membro.proposto !== linha.nome;
    const mudouTamanho = (proprio.tamanho ?? "") !== linha.tamanho;
    const decisao = conferir.length ? "conferir" : mudouNome || mudouTamanho ? "aprovar" : "—";
    return {
      cliente: linha.cliente,
      familia: membro.familia,
      codigo: linha.codigo,
      sku: linha.sku,
      nome_hoje: linha.nome,
      nome_proposto: membro.proposto,
      motivo: proprio.motivos.join(" · ") || (mudouNome ? "família" : ""),
      tamanho_hoje: linha.tamanho,
      tamanho_proposto: proprio.tamanho ?? "",
      genero: linha.genero,
      decisao,
      conferir: conferir.join(" · "),
    };
  });
  resultado.sort(
    (a, b) =>
      a.cliente.localeCompare(b.cliente, "pt-BR") ||
      a.familia.localeCompare(b.familia, "pt-BR", { numeric: true }) ||
      ordemDoTamanho(a.tamanho_proposto) - ordemDoTamanho(b.tamanho_proposto) ||
      a.codigo.localeCompare(b.codigo, "pt-BR", { numeric: true }),
  );

  const contar = (lista, chave) => {
    const mapa = new Map();
    for (const item of lista) for (const valor of chave(item)) mapa.set(valor, (mapa.get(valor) ?? 0) + 1);
    return Object.fromEntries([...mapa.entries()].sort((a, b) => b[1] - a[1]));
  };
  const familiasComMudanca = new Set(resultado.filter((l) => l.decisao !== "—").map((l) => `${l.cliente}|${l.familia}`)).size;
  const resumo = {
    skus_lidos: skus.length,
    products_lidos: products.length,
    arquivados_ignorados: comArquivados ? 0 : arquivados,
    linhas: resultado.length,
    familias: familias.size,
    familias_com_mudanca: familiasComMudanca,
    por_decisao: contar(resultado, (l) => [l.decisao]),
    por_motivo: contar(resultado, (l) => (l.motivo ? l.motivo.split(" · ") : [])),
    por_conferir: contar(resultado, (l) => (l.conferir ? l.conferir.split(" · ").map((c) => c.replace(/\s*[(:"].*$/, "")) : [])),
  };
  return { linhas: resultado, resumo };
}

export const COLUNAS = [
  ["cliente", "Cliente"],
  ["familia", "Família"],
  ["codigo", "Código"],
  ["sku", "SKU"],
  ["nome_hoje", "Nome hoje"],
  ["nome_proposto", "Nome proposto"],
  ["motivo", "Motivo"],
  ["tamanho_hoje", "Tamanho hoje"],
  ["tamanho_proposto", "Tamanho proposto"],
  ["genero", "Gênero"],
  ["decisao", "Decisão"],
  ["conferir", "Conferir"],
];

/** CSV como o Excel em português abre direto: BOM, ponto e vírgula e CRLF (o mesmo do toExcelCsv do app). */
export function csvDoRelatorio(linhas) {
  const campo = (valor) => {
    const t = String(valor ?? "");
    return /[";\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const saida = [COLUNAS.map(([, rotulo]) => campo(rotulo)).join(";"), ...linhas.map((linha) => COLUNAS.map(([chave]) => campo(linha[chave])).join(";"))];
  return `﻿${saida.join("\r\n")}\r\n`;
}

const fmt = (n) => new Intl.NumberFormat("pt-BR").format(n);

export function textoDoResumo(resumo) {
  const lista = (obj) => Object.entries(obj).map(([k, v]) => `${k} ${fmt(v)}`).join(" · ") || "nenhum";
  return [
    `${fmt(resumo.skus_lidos)} SKUs lidos (${fmt(resumo.products_lidos)} products), ${fmt(resumo.arquivados_ignorados)} arquivados fora.`,
    `${fmt(resumo.linhas)} linhas em ${fmt(resumo.familias)} famílias; ${fmt(resumo.familias_com_mudanca)} famílias com mudança.`,
    `Decisão: ${lista(resumo.por_decisao)}.`,
    `Motivos: ${lista(resumo.por_motivo)}.`,
    `Conferir: ${lista(resumo.por_conferir)}.`,
  ].join("\n");
}

// --- Linha de comando ---------------------------------------------------------------

async function principal() {
  const args = { projeto: "", cliente: "", familia: "", saida: "", limite: 10000, comArquivados: false, json: false };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const proximo = () => argv[(i += 1)];
    if (a === "--projeto") args.projeto = texto(proximo());
    else if (a === "--cliente") args.cliente = texto(proximo());
    else if (a === "--familia") args.familia = texto(proximo());
    else if (a === "--saida") args.saida = texto(proximo());
    else if (a === "--limite") args.limite = Number(proximo());
    else if (a === "--com-arquivados") args.comArquivados = true;
    else if (a === "--json") args.json = true;
    else abortar(`Argumento desconhecido: ${a}`);
  }
  if (!args.projeto) abortar("Informe --projeto (dute-homolog ou dute-prod; demo-* com o emulador).");
  if (!Number.isInteger(args.limite) || args.limite < 1) abortar("--limite precisa ser um inteiro positivo.");

  const emuladorHost = process.env.FIRESTORE_EMULATOR_HOST ?? "";
  const emulador = Boolean(emuladorHost);
  if (emulador && !/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(emuladorHost)) {
    abortar(`FIRESTORE_EMULATOR_HOST precisa apontar para 127.0.0.1 ou localhost (está ${emuladorHost}).`);
  }
  if (emulador && !/^demo-/.test(args.projeto)) {
    abortar(`Com FIRESTORE_EMULATOR_HOST o projeto precisa ser demo-* (está ${args.projeto}). Para a nuvem, limpe a variável antes de rodar.`);
  }
  process.env.GCLOUD_PROJECT = args.projeto;
  process.env.GOOGLE_CLOUD_PROJECT = args.projeto;
  if (emulador) {
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    process.env.METADATA_SERVER_DETECTION = "none";
  }

  const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const requireWms = createRequire(path.join(raiz, "functions", "wms", "package.json"));
  let adminApp;
  let adminFirestore;
  try {
    adminApp = requireWms("firebase-admin/app");
    adminFirestore = requireWms("firebase-admin/firestore");
  } catch {
    abortar("firebase-admin não encontrado em functions/wms. Rode: npm --prefix functions/wms ci");
  }
  const app = adminApp.initializeApp({ projectId: args.projeto });
  const db = adminFirestore.getFirestore(app);

  const ler = async (colecao) => (await db.collection(colecao).limit(args.limite).get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  const [skus, products] = await Promise.all([ler("skus"), ler("products")]);
  for (const [nome, lista] of [["skus", skus], ["products", products]]) {
    if (lista.length >= args.limite) console.error(`AVISO: ${nome} chegou ao limite de ${fmt(args.limite)} documentos; passe --limite maior.`);
  }

  const relatorio = montarRelatorio({ skus, products, cliente: args.cliente, familia: args.familia, comArquivados: args.comArquivados });
  const hoje = new Date();
  const data = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-${String(hoje.getDate()).padStart(2, "0")}`;
  const saida = path.resolve(raiz, args.saida || path.join("tmp", `nomes-fora-do-padrao-${args.projeto}-${data}.csv`));
  mkdirSync(path.dirname(saida), { recursive: true });
  writeFileSync(saida, csvDoRelatorio(relatorio.linhas), "utf8");

  if (args.json) {
    console.log(JSON.stringify({ projeto: args.projeto, saida, resumo: relatorio.resumo }, null, 2));
  } else {
    console.log(`Projeto ${args.projeto}${args.cliente ? ` · cliente ${args.cliente}` : ""}${args.familia ? ` · família ${args.familia}` : ""}`);
    console.log(textoDoResumo(relatorio.resumo));
    const conferir = relatorio.linhas.filter((l) => l.decisao === "conferir");
    if (conferir.length) {
      console.log(`\nPara conferir (${fmt(conferir.length)}${conferir.length > 40 ? ", as 40 primeiras" : ""}):`);
      for (const l of conferir.slice(0, 40)) console.log(`  ${l.codigo} = ${l.sku} · "${l.nome_hoje}" → "${l.nome_proposto}" · ${l.conferir}`);
    }
    console.log(`\nCSV: ${saida}`);
  }
  await app.delete();
}

function abortar(mensagem) {
  console.error(`\nABORTADO: ${mensagem}\n`);
  process.exit(2);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  principal().catch((erro) => {
    console.error(erro);
    process.exit(1);
  });
}
