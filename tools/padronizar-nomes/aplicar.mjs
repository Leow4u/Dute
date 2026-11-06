#!/usr/bin/env node
/**
 * O passo 3 da padronização dos nomes (decisões do Leonardo de 06/11/2026,
 * roteiro no README desta pasta): grava o nome e o tamanho no padrão nos
 * produtos já cadastrados, sem planilha. Lê o catálogo, monta o mesmo
 * relatório do passo 1 (relatorio.mjs) e aplica a proposta, com as escolhas de
 * decisoes.mjs por cima.
 *
 * Só mostra, sem gravar (padrão):
 *
 *   node tools/padronizar-nomes/aplicar.mjs --projeto dute-prod
 *
 * Grava:
 *
 *   node tools/padronizar-nomes/aplicar.mjs --projeto dute-prod --aplicar --confirmo "PADRONIZAR NOMES dute-prod"
 *
 * Por SKU, numa transação, como o renomear do acerto de outubro: o nome e o
 * tamanho em skus e products, o product_name dos saldos e das linhas da
 * abertura, o product_name e o size da projeção do portal (client_inventory),
 * o recibo em operational_operations e o evento catalog.renamed em events. O
 * recibo por SKU impede repetir; o SKU que mudou desde a leitura fica de fora.
 */

import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DECISOES } from "./decisoes.mjs";
import { abrirFirestore, lerColecao } from "./firestore.mjs";
import { chaveDoCodigo, clienteDe, idDoCodigo, linhaDoSku, montarRelatorio } from "./relatorio.mjs";

export const OPERACAO = "padronizar-nomes-2026-11-06";
export const ATOR = {
  uid: "script:padronizar-nomes",
  role: "admin",
  name: "Padronização dos nomes 06/11 (script, Leonardo)",
  email: "leonardo@dutelog.com.br",
};
const FONTE = "script_padronizar_nomes";

const texto = (v) => String(v ?? "").trim();
/** O id de documento como o WMS monta (safeDocId de domain/operations.ts). */
const safeDocId = (v) => String(v).replace(/[^\w.-]/g, "_").slice(0, 900);
const digest = (v) => createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 32);
const fmt = (n) => new Intl.NumberFormat("pt-BR").format(n);
const linhaViva = (data) => !["removed", "transferred", "reversed", "cancelled"].includes(texto(data.status));

// --- Puro: o plano ------------------------------------------------------------------

/** O que não se grava sem uma pessoa: o nome vazio ou só o tamanho, e o código com mais de um SKU ativo. */
const FORA = /^(nome vazio|nome é só o tamanho|código com \d+ SKUs ativos)/;

const base = (linha) => ({ cliente: linha.cliente, sku: linha.sku, codigo: linha.codigo, nome_hoje: linha.nome_hoje, tamanho_hoje: linha.tamanho_hoje });

/**
 * O que gravar em cada SKU, a partir das linhas do relatório: o nome e o
 * tamanho propostos, com a escolha por código ou por nome por cima. A linha
 * igual ao que já está gravado não entra.
 */
export function planoDeRenomes(linhas, decisoes = DECISOES) {
  const porCodigo = new Map(Object.entries(decisoes.codigos ?? {}).map(([codigo, nome]) => [chaveDoCodigo(codigo), nome]));
  const porNome = new Map(Object.entries(decisoes.nomes ?? {}));
  const renomes = [];
  const fora = [];
  let semMudanca = 0;
  for (const linha of linhas) {
    const motivo = (linha.conferir ? linha.conferir.split(" · ") : []).find((item) => FORA.test(item));
    if (motivo) {
      fora.push({ ...base(linha), motivo });
      continue;
    }
    const escolhido = porCodigo.get(chaveDoCodigo(linha.codigo)) ?? porNome.get(linha.nome_proposto);
    const nome = escolhido ?? linha.nome_proposto;
    const tamanho = linha.tamanho_proposto;
    if (nome === linha.nome_hoje && tamanho === linha.tamanho_hoje) {
      semMudanca += 1;
      continue;
    }
    renomes.push({ ...base(linha), nome, tamanho, escolha: Boolean(escolhido) });
  }
  // A escolha que não acha produto é engano de digitação nela: aparece no dry-run. Já aplicada, conta como achada.
  const semUso = [
    ...[...porNome].filter(([de, para]) => !linhas.some((l) => l.nome_proposto === de || l.nome_hoje === para)).map(([de]) => `nome "${de}"`),
    ...[...porCodigo.keys()].filter((codigo) => !linhas.some((l) => chaveDoCodigo(l.codigo) === codigo)).map((codigo) => `código ${codigo}`),
  ];
  return { renomes, fora, sem_mudanca: semMudanca, escolhas_sem_uso: semUso };
}

/**
 * Os campos de skus e products que mudam: o nome em `produto`, e em `name` e
 * `product_name` quando o documento os tem; o tamanho em `tamanho`, e em
 * `size` quando o documento o tem, só se ele mudou.
 */
export function camposDoCatalogo(data, renome) {
  const campos = { produto: renome.nome };
  for (const campo of ["name", "product_name"]) if (campo in data) campos[campo] = renome.nome;
  if (renome.tamanho !== renome.tamanho_hoje) {
    campos.tamanho = renome.tamanho;
    if ("size" in data) campos.size = renome.tamanho;
  }
  return campos;
}

// --- Gravação de um SKU -------------------------------------------------------------

/** Os documentos que guardam o nome do SKU, achados por consulta antes da transação e relidos dentro dela. */
async function documentosDoSku(db, renome) {
  const products = new Map();
  if (renome.codigo) {
    const consultas = await Promise.all([
      db.collection("products").where("cod_cliente_key", "==", chaveDoCodigo(renome.codigo)).get(),
      db.collection("products").where("cod_cliente", "==", renome.codigo).get(),
    ]);
    for (const snap of consultas) for (const doc of snap.docs) if (clienteDe(doc.data()) === renome.cliente) products.set(doc.ref.path, doc.ref);
    const direto = await db.collection("products").doc(idDoCodigo(renome.codigo)).get();
    if (direto.exists && clienteDe(direto.data()) === renome.cliente) products.set(direto.ref.path, direto.ref);
  }
  const doSku = async (colecao, filtro = () => true) =>
    (await db.collection(colecao).where("sku_code", "==", renome.sku).get()).docs
      .filter((doc) => clienteDe(doc.data()) === renome.cliente && filtro(doc.data()))
      .map((doc) => doc.ref);
  return {
    products: [...products.values()],
    saldos: await doSku("stock_balances"),
    linhas: await doSku("opening_inventory_lines", linhaViva),
    projecao: db.collection("client_inventory").doc(safeDocId(`cinv_${renome.cliente}__${renome.sku}`)),
  };
}

/**
 * Grava um SKU do plano. Devolve o estado: "renomeado", "ja_aplicado" (o
 * recibo existe) ou "fora" (o SKU sumiu ou mudou desde a leitura; nada grava).
 */
export async function aplicarUm(db, FieldValue, renome, decisoes = DECISOES) {
  const docs = await documentosDoSku(db, renome);
  const reciboRef = db.collection("operational_operations").doc(safeDocId(`${OPERACAO}_${renome.sku}`));
  const eventoRef = db.collection("events").doc(`evt_${safeDocId(OPERACAO)}_${digest({ operacao: OPERACAO, sku: renome.sku })}`);
  const skuRef = db.collection("skus").doc(renome.sku);
  return db.runTransaction(async (tx) => {
    if ((await tx.get(reciboRef)).exists) return { estado: "ja_aplicado" };
    const skuSnap = await tx.get(skuRef);
    if (!skuSnap.exists) return { estado: "fora", motivo: "o SKU não existe mais" };
    const agora = linhaDoSku(skuSnap.id, skuSnap.data());
    if (agora.nome !== renome.nome_hoje || agora.tamanho !== renome.tamanho_hoje) {
      return { estado: "fora", motivo: `mudou desde a leitura: "${agora.nome}"${agora.tamanho ? ` · tamanho ${agora.tamanho}` : ""}` };
    }
    const [products, saldos, linhas, projecao] = await Promise.all([
      Promise.all(docs.products.map((ref) => tx.get(ref))),
      Promise.all(docs.saldos.map((ref) => tx.get(ref))),
      Promise.all(docs.linhas.map((ref) => tx.get(ref))),
      tx.get(docs.projecao),
    ]);
    const quando = FieldValue.serverTimestamp();
    const tamanhoMudou = renome.tamanho !== renome.tamanho_hoje;
    tx.update(skuRef, { ...camposDoCatalogo(skuSnap.data(), renome), updated_at: quando, updated_by: ATOR });
    const gravados = { products: 0, saldos: 0, linhas: 0, projecao: false };
    for (const doc of products) {
      if (!doc.exists) continue;
      tx.update(doc.ref, { ...camposDoCatalogo(doc.data(), renome), updated_at: quando, updated_by: ATOR });
      gravados.products += 1;
    }
    for (const doc of saldos) {
      if (!doc.exists) continue;
      tx.update(doc.ref, { product_name: renome.nome, updated_at: quando });
      gravados.saldos += 1;
    }
    for (const doc of linhas) {
      if (!doc.exists || !linhaViva(doc.data())) continue;
      tx.update(doc.ref, { product_name: renome.nome, updated_at: quando });
      gravados.linhas += 1;
    }
    if (projecao.exists) {
      tx.update(projecao.ref, { product_name: renome.nome, ...(tamanhoMudou ? { size: renome.tamanho } : {}), updated_at: quando });
      gravados.projecao = true;
    }
    const antes = { produto: renome.nome_hoje, tamanho: renome.tamanho_hoje || null };
    const depois = { produto: renome.nome, tamanho: renome.tamanho || null };
    tx.create(eventoRef, {
      id: eventoRef.id,
      type: "catalog.renamed",
      title: `Produto ${renome.codigo || renome.sku} renomeado`,
      description: `"${renome.nome_hoje}" → "${renome.nome}"${tamanhoMudou ? ` · tamanho ${renome.tamanho_hoje || "vazio"} → ${renome.tamanho}` : ""}`,
      severity: "info",
      entity_type: "sku",
      entity_id: renome.sku,
      customer_code: renome.cliente,
      payload: { antes, depois, escolha: renome.escolha, operacao: OPERACAO, referencia: decisoes.referencia },
      occurred_at: new Date().toISOString(),
      source: FONTE,
      actor: ATOR,
    });
    const resultado = { sku: renome.sku, produto: renome.nome, tamanho: renome.tamanho || null, ...gravados };
    tx.create(reciboRef, {
      id: reciboRef.id,
      input_hash: digest({ operacao: OPERACAO, sku: renome.sku, nome: renome.nome, tamanho: renome.tamanho }),
      kind: "padronizar_nomes.renomear",
      target_id: renome.sku,
      customer_code: renome.cliente,
      actor: ATOR,
      result: resultado,
      source: FONTE,
      created_at: quando,
    });
    return { estado: "renomeado", ...resultado };
  });
}

// --- Linha de comando ---------------------------------------------------------------

const linhaDoRenome = (r) =>
  `  ${r.codigo || "(sem código)"} = ${r.sku} · "${r.nome_hoje}" → "${r.nome}"${r.tamanho !== r.tamanho_hoje ? ` · tamanho ${r.tamanho_hoje || "vazio"} → ${r.tamanho}` : ""}`;

function abortar(mensagem) {
  console.error(`\nABORTADO: ${mensagem}\n`);
  process.exit(2);
}

async function principal() {
  const args = { projeto: "", cliente: "", familia: "", aplicar: false, confirmo: "", listar: false, json: false };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const proximo = () => argv[(i += 1)];
    if (a === "--projeto") args.projeto = texto(proximo());
    else if (a === "--cliente") args.cliente = texto(proximo());
    else if (a === "--familia") args.familia = texto(proximo());
    else if (a === "--aplicar") args.aplicar = true;
    else if (a === "--confirmo") args.confirmo = proximo() ?? "";
    else if (a === "--listar") args.listar = true;
    else if (a === "--json") args.json = true;
    else abortar(`Argumento desconhecido: ${a}`);
  }
  if (!args.projeto) abortar("Informe --projeto (dute-homolog ou dute-prod; demo-* com o emulador).");
  const naNuvem = !process.env.FIRESTORE_EMULATOR_HOST;
  const confirmacao = `PADRONIZAR NOMES ${args.projeto}`;
  if (args.aplicar && naNuvem && args.confirmo !== confirmacao) {
    abortar(`Para gravar, passe --confirmo "${confirmacao}". Sem isso o script só mostra o que muda.`);
  }

  const { app, db, FieldPath, FieldValue } = abrirFirestore(args.projeto, abortar);
  const [skus, products] = await Promise.all([lerColecao(db, FieldPath, "skus"), lerColecao(db, FieldPath, "products")]);
  const { linhas, resumo } = montarRelatorio({ skus, products, cliente: args.cliente, familia: args.familia });
  const plano = planoDeRenomes(linhas);
  const escolhas = plano.renomes.filter((r) => r.escolha);
  const saida = {
    projeto: args.projeto,
    aplicar: args.aplicar,
    skus_lidos: resumo.skus_lidos,
    arquivados_fora: resumo.arquivados_ignorados,
    mudam: plano.renomes.length,
    com_escolha: escolhas.length,
    ja_no_padrao: plano.sem_mudanca,
    fora: plano.fora,
    escolhas_sem_uso: plano.escolhas_sem_uso,
  };

  if (args.aplicar) {
    const contagem = { renomeado: 0, ja_aplicado: 0, fora: [], erro: [] };
    for (const [indice, renome] of plano.renomes.entries()) {
      try {
        const resultado = await aplicarUm(db, FieldValue, renome);
        if (resultado.estado === "fora") contagem.fora.push({ ...renome, motivo: resultado.motivo });
        else contagem[resultado.estado] += 1;
      } catch (erro) {
        contagem.erro.push({ ...renome, motivo: erro instanceof Error ? erro.message : String(erro) });
      }
      if (!args.json && (indice + 1) % 25 === 0) console.log(`  ${fmt(indice + 1)} de ${fmt(plano.renomes.length)}…`);
    }
    saida.resultado = contagem;
    if (contagem.erro.length) process.exitCode = 1;
  }

  if (args.json) {
    console.log(JSON.stringify(saida, null, 2));
  } else {
    const filtro = `${args.cliente ? ` · cliente ${args.cliente}` : ""}${args.familia ? ` · família ${args.familia}` : ""}`;
    console.log(`Projeto ${args.projeto}${filtro}${args.aplicar ? "" : " · só mostra, nada foi gravado"}`);
    console.log(`${fmt(resumo.skus_lidos)} SKUs lidos, ${fmt(resumo.arquivados_ignorados)} arquivados fora.`);
    console.log(`Mudam ${fmt(plano.renomes.length)}, ${fmt(escolhas.length)} com as escolhas de 06/11. Já no padrão: ${fmt(plano.sem_mudanca)}. De fora: ${fmt(plano.fora.length)}.`);
    if (escolhas.length) {
      console.log("\nCom as escolhas de 06/11:");
      for (const r of escolhas) console.log(linhaDoRenome(r));
    }
    if (plano.fora.length) {
      console.log("\nDe fora, sem gravar:");
      for (const r of plano.fora) console.log(`  ${r.codigo || "(sem código)"} = ${r.sku} · "${r.nome_hoje}" · ${r.motivo}`);
    }
    if (plano.escolhas_sem_uso.length) console.log(`\nEscolhas que não acharam produto: ${plano.escolhas_sem_uso.join(", ")}.`);
    if (args.listar) {
      console.log("\nTudo o que muda:");
      for (const r of plano.renomes) console.log(linhaDoRenome(r));
    }
    if (saida.resultado) {
      const { renomeado, ja_aplicado: jaAplicado, fora, erro } = saida.resultado;
      console.log(`\nGravado: ${fmt(renomeado)} renomeados, ${fmt(jaAplicado)} já estavam aplicados, ${fmt(fora.length)} de fora, ${fmt(erro.length)} com erro.`);
      for (const r of [...fora, ...erro]) console.log(`  ${r.codigo || "(sem código)"} = ${r.sku} · ${r.motivo}`);
    } else if (plano.renomes.length) {
      console.log(`\nPara gravar:\n  node tools/padronizar-nomes/aplicar.mjs --projeto ${args.projeto}${args.cliente ? ` --cliente "${args.cliente}"` : ""}${args.familia ? ` --familia ${args.familia}` : ""} --aplicar --confirmo "${confirmacao}"`);
    }
  }
  await app.delete();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  principal().catch((erro) => {
    console.error(erro);
    process.exit(1);
  });
}
