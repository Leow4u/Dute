#!/usr/bin/env node
/**
 * Acerto único do estoque da BTG (29 e 30/10/2026). Roteiro em README.md.
 *
 * Dry-run (padrão): lê o banco, resolve cada operação de `plano.mjs` e imprime
 * o que gravaria. Não grava nada.
 *
 *   node tools/acerto-btg-2026-10/acerto.mjs --projeto dute-prod
 *
 * Aplicar: grava pelas funções de domínio de functions/wms, as mesmas das
 * callables (movimentos, fotos, remoção de caixa), e, nas gravações diretas
 * (cadastro, linhas da abertura, arquivar), com recibo em
 * operational_operations e evento em events. Cada operação tem chave de
 * idempotência fixa: rodar de novo não repete.
 *
 *   node tools/acerto-btg-2026-10/acerto.mjs --projeto dute-prod --aplicar --confirmo "ACERTO BTG dute-prod"
 *
 * Pré-requisitos: `npm --prefix functions/wms ci` e `npm --prefix functions/wms run build`
 * (o script importa `functions/wms/lib`), e credencial: `gcloud auth
 * application-default login` com uma conta do projeto, ou
 * FIRESTORE_EMULATOR_HOST apontando para o emulador local.
 */

import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { BLOCOS, PLANO } from "./plano.mjs";

// --- Linha de comando ---------------------------------------------------------------

const args = (() => {
  const out = { aplicar: false, projeto: "dute-prod", confirmo: "", blocos: [], ops: [] };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const proximo = () => argv[(i += 1)];
    if (a === "--aplicar") out.aplicar = true;
    else if (a === "--dry-run") out.aplicar = false;
    else if (a === "--projeto") out.projeto = proximo();
    else if (a === "--confirmo") out.confirmo = proximo();
    else if (a === "--bloco") out.blocos.push(proximo());
    else if (a === "--op") out.ops.push(proximo());
    else abortar(`Argumento desconhecido: ${a}`);
  }
  return out;
})();

function abortar(mensagem) {
  console.error(`\nABORTADO: ${mensagem}\n`);
  process.exit(2);
}

const emuladorHost = process.env.FIRESTORE_EMULATOR_HOST ?? "";
const emulador = Boolean(emuladorHost);
if (emulador && !/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(emuladorHost)) {
  abortar(`FIRESTORE_EMULATOR_HOST precisa apontar para 127.0.0.1 ou localhost (está ${emuladorHost}).`);
}
const PROJETO = args.projeto;
if (args.aplicar && !emulador && args.confirmo !== `ACERTO BTG ${PROJETO}`) {
  abortar(`Para gravar na nuvem, passe --confirmo "ACERTO BTG ${PROJETO}". Sem isso o script só faz o dry-run.`);
}
process.env.GCLOUD_PROJECT = PROJETO;
process.env.GOOGLE_CLOUD_PROJECT = PROJETO;
if (emulador) {
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
  process.env.METADATA_SERVER_DETECTION = "none";
}

// --- Domínio do WMS (functions/wms/lib) ---------------------------------------------

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const WMS = path.join(RAIZ, "functions", "wms");
const requireWms = createRequire(path.join(WMS, "package.json"));

let adminApp;
let adminFirestore;
try {
  adminApp = requireWms("firebase-admin/app");
  adminFirestore = requireWms("firebase-admin/firestore");
} catch {
  abortar("firebase-admin não encontrado em functions/wms. Rode: npm --prefix functions/wms ci");
}

async function dominio(arquivo) {
  try {
    return await import(pathToFileURL(path.join(WMS, "lib", arquivo)).href);
  } catch (erro) {
    abortar(`Não consegui carregar functions/wms/lib/${arquivo}. Rode: npm --prefix functions/wms run build\n${erro.message}`);
  }
}

const operations = await dominio("domain/operations.js");
const catalogCodes = await dominio("domain/catalog-codes.js");
const warehouseBoxes = await dominio("domain/warehouse-boxes.js");
const { FieldValue } = adminFirestore;

const app = adminApp.initializeApp({ projectId: PROJETO });
const db = adminFirestore.getFirestore(app);

// --- Constantes e utilitários -----------------------------------------------------------

const CLIENTE = PLANO.cliente;
const ATOR = PLANO.ator;
const FONTE = "script_acerto_btg_2026_10";
const ts = () => FieldValue.serverTimestamp();

const text = (v) => String(v ?? "").trim();
const num = (v) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const safeDocId = (v) => String(v).replace(/[^\w.-]/g, "_").slice(0, 900);
const normalizedIdentity = (v) =>
  text(v)
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ");
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, item]) => [k, canonical(item)]),
    );
  }
  return value;
}
const digest = (value, length = 32) =>
  createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex").slice(0, length);
const compact = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
const lista = (v, limite = 8) => (Array.isArray(v) ? v.map(text).filter(Boolean).slice(0, limite) : []);
const fmt = (n) => new Intl.NumberFormat("pt-BR").format(n);
const curto = (url) => (url.length > 60 ? `…${url.slice(-57)}` : url);

class Erro extends Error {}
const chave = (op, parte) => `${PLANO.id}:${op.id}${parte ? `:${parte}` : ""}`;
const doCliente = (data) => (text(data.customer_code) || CLIENTE) === CLIENTE;
const arquivado = (data) => data.archived === true || text(data.status) === "archived";
const linhaViva = (data) => !["removed", "transferred", "reversed", "cancelled"].includes(text(data.status));

const ehSku = (codigo) => /^[A-Z]{2,6}-\d{4,8}$/i.test(text(codigo));

async function skuPorCodigo(codigo, { incluirArquivados = false } = {}) {
  const valor = text(codigo);
  if (!valor) return null;
  const aceita = (data) => doCliente(data) && (incluirArquivados || !arquivado(data));
  const achados = new Map();
  const guardar = (snap) => {
    if (snap?.exists && aceita(snap.data()) && !achados.has(snap.id)) achados.set(snap.id, linhaSku(snap));
  };
  if (ehSku(valor)) {
    guardar(await db.collection("skus").doc(valor.toUpperCase()).get());
  } else {
    const key = normalizedIdentity(valor);
    const porCampo = async (campo, v) => (await db.collection("skus").where(campo, "==", v).get()).docs.forEach(guardar);
    await porCampo("cod_cliente_key", key);
    if (!achados.size) {
      await porCampo("cod_cliente", valor);
      if (valor !== key) await porCampo("cod_cliente", key);
      await porCampo("client_item_code", valor);
    }
    if (!achados.size) {
      // Cadastro sem o campo de busca: chega pelo saldo ou pela linha da abertura.
      const ids = new Set();
      for (const colecao of ["stock_balances", "opening_inventory_lines"]) {
        for (const v of new Set([valor, key])) {
          (await db.collection(colecao).where("client_item_code", "==", v).get()).docs.forEach((d) => {
            if (doCliente(d.data()) && text(d.data().sku_code)) ids.add(text(d.data().sku_code));
          });
        }
      }
      for (const id of ids) guardar(await db.collection("skus").doc(id).get());
    }
  }
  const rows = [...achados.values()];
  if (rows.length > 1) throw new Erro(`Mais de um SKU ${incluirArquivados ? "" : "ativo "}com o código ${valor}: ${rows.map((r) => r.id).join(", ")}; use o SKU no plano`);
  return rows[0] ?? null;
}
function linhaSku(snap) {
  const data = snap.data();
  return {
    id: snap.id,
    ref: snap.ref,
    data,
    codCliente: text(data.cod_cliente || data.client_item_code),
    nome: text(data.produto || data.name || data.product_name),
  };
}
async function produtosPorCodigo(codCliente) {
  if (!codCliente) return [];
  const vistos = new Map();
  for (const [campo, v] of [["cod_cliente_key", normalizedIdentity(codCliente)], ["cod_cliente", text(codCliente)]]) {
    (await db.collection("products").where(campo, "==", v).get()).docs.forEach((d) => {
      if (doCliente(d.data()) && !vistos.has(d.id)) vistos.set(d.id, { id: d.id, ref: d.ref, data: d.data() });
    });
    if (vistos.size) break;
  }
  const direto = await db.collection("products").doc(safeDocId(text(codCliente))).get();
  if (direto.exists && doCliente(direto.data()) && !vistos.has(direto.id)) vistos.set(direto.id, { id: direto.id, ref: direto.ref, data: direto.data() });
  return [...vistos.values()];
}
async function saldosDoSku(skuCode) {
  const snap = await db.collection("stock_balances").where("sku_code", "==", skuCode).get();
  return snap.docs
    .filter((d) => doCliente(d.data()))
    .map((d) => ({ id: d.id, ref: d.ref, data: d.data(), posicao: text(d.data().location_id).toUpperCase() }))
    .sort((a, b) => a.posicao.localeCompare(b.posicao));
}
const descreverSaldos = (rows) =>
  rows.length
    ? rows.map((r) => `${r.posicao} ${fmt(num(r.data.qty_on_hand))}${num(r.data.qty_reserved) ? ` (res. ${fmt(num(r.data.qty_reserved))})` : ""}`).join(", ")
    : "sem saldo";
async function caixa(code) {
  const snap = await db.collection("warehouse_boxes").doc(text(code).toUpperCase()).get();
  return snap.exists ? { id: snap.id, ref: snap.ref, data: snap.data(), posicao: text(snap.data().location_id).toUpperCase() } : null;
}
async function linhasAbertura({ caixa: box, sku }) {
  let query = db.collection("opening_inventory_lines");
  if (box) query = query.where("box_code", "==", text(box).toUpperCase());
  else if (sku) query = query.where("sku_code", "==", sku);
  else throw new Erro("linhasAbertura: informe caixa ou sku");
  const snap = await query.get();
  return snap.docs
    .map((d) => ({ id: d.id, ref: d.ref, data: d.data() }))
    .filter((r) => doCliente(r.data) && linhaViva(r.data) && (!sku || text(r.data.sku_code) === sku));
}
const cinvRef = (skuCode) => db.collection("client_inventory").doc(safeDocId(`cinv_${CLIENTE}__${skuCode}`));
async function cinv(skuCode) {
  const snap = await cinvRef(skuCode).get();
  return snap.exists ? { ref: snap.ref, data: snap.data() } : null;
}
async function reciboExiste(id) {
  return (await db.collection("operational_operations").doc(id).get()).exists;
}
const idReciboDireto = (op, parte) => `op_acerto_${digest({ plano: PLANO.id, op: op.id, parte: parte ?? null })}`;
const idReciboMovimento = (nonce) => `op_inventory_${digest({ customer: CLIENTE, nonce })}`;
const idReciboFotos = (skuCode, nonce) => `op_photos_${digest({ skuCode, nonce })}`;

async function resolverPosicao(spec, origem) {
  if (typeof spec === "string" && spec.trim()) return spec.trim().toUpperCase();
  if (spec && typeof spec === "object" && spec.caixa) {
    const box = await caixa(spec.caixa);
    if (!box) throw new Erro(`Caixa ${spec.caixa} não encontrada`);
    if (!box.posicao) throw new Erro(`Caixa ${spec.caixa} sem posição`);
    return box.posicao;
  }
  if (spec && typeof spec === "object" && spec.sku) {
    const sku = await skuPorCodigo(spec.sku);
    if (!sku) throw new Erro(`SKU ${spec.sku} não encontrado para resolver a posição`);
    const rows = (await saldosDoSku(sku.id)).filter((r) => num(r.data.qty_on_hand) > 0);
    if (rows.length !== 1) throw new Erro(`${spec.sku} tem saldo em ${rows.length} posições (${descreverSaldos(rows)}); informe a posição`);
    return rows[0].posicao;
  }
  if (!origem) throw new Erro("posição não informada");
  const rows = (await saldosDoSku(origem.id)).filter((r) => num(r.data.qty_on_hand) > 0);
  if (rows.length === 1) return rows[0].posicao;
  if (!rows.length) throw new Erro(`${origem.codCliente || origem.id} está sem saldo em qualquer posição`);
  throw new Erro(`${origem.codCliente || origem.id} tem saldo em ${rows.length} posições (${descreverSaldos(rows)}); informe a posição`);
}

const previstos = { contagem: 0 };

/** Saldo que o plano ainda vai tirar de um SKU (transferências e ajustes não pendentes). */
function saidasPrevistasNoPlano(codigo, skuId) {
  const mesmo = (c) => normalizedIdentity(c) === normalizedIdentity(codigo) || normalizedIdentity(c) === normalizedIdentity(skuId);
  let tudo = false;
  let soma = 0;
  for (const bloco of BLOCOS) {
    for (const op of bloco.ops) {
      if (op.pendente) continue;
      if (op.tipo === "transferir" && mesmo(op.de)) {
        if (op.qtde === "tudo") tudo = true;
        else soma += num(op.qtde);
      }
      if (op.tipo === "ajuste" && mesmo(op.codigo) && num(op.delta) < 0) soma += -num(op.delta);
      if (op.tipo === "saida" && op.codigo && mesmo(op.codigo)) soma += num(op.qtde);
    }
  }
  return { tudo, soma };
}

function criaSkuNoPlano(codigo) {
  for (const bloco of BLOCOS) {
    for (const op of bloco.ops) {
      if (op.tipo === "criar_sku" && normalizedIdentity(op.codigo) === normalizedIdentity(codigo)) return op;
    }
  }
  return null;
}

async function destino(codigo) {
  const sku = await skuPorCodigo(codigo);
  if (sku) return { sku, texto: `${codigo} = ${sku.id}` };
  const criacao = criaSkuNoPlano(codigo);
  if (criacao && !criacao.pendente) return { sku: null, texto: `${codigo} (será criado por ${criacao.id})`, seraCriado: true };
  if (criacao) throw new Erro(`SKU ${codigo} não existe e a criação (${criacao.id}) está pendente`);
  throw new Erro(`SKU ${codigo} não encontrado`);
}

const TAMANHOS = "PP|P|M|G|GG|XG|XGG|EG|EGG|U|N1|N2|N3|N4|N5|N6";
function derivarNome(nome, tamIrmao, tamNovo) {
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const alvo = tamIrmao && !/^\d+$/.test(tamIrmao) ? `${esc(tamIrmao)}|${TAMANHOS}` : TAMANHOS;
  const re = new RegExp(`(\\s*[–-]\\s*|\\s+)(?:${alvo})\\s*$`, "i");
  const m = nome.match(re);
  if (m) return `${nome.slice(0, m.index)}${m[1].includes("–") || m[1].includes("-") ? " – " : " "}${tamNovo}`;
  return `${nome} ${tamNovo}`;
}

// --- Escritas diretas: transação com recibo e evento ---------------------------------

async function transacaoDireta(op, tipo, alvo, corpo, parte) {
  const reciboRef = db.collection("operational_operations").doc(idReciboDireto(op, parte));
  return db.runTransaction(async (tx) => {
    const recibo = await tx.get(reciboRef);
    if (recibo.exists) return { jaAplicado: true };
    const resultado = (await corpo(tx)) ?? {};
    tx.create(reciboRef, {
      id: reciboRef.id,
      input_hash: digest({ plano: PLANO.id, op: op.id, parte: parte ?? null }),
      kind: `acerto.${tipo}`,
      target_id: alvo,
      customer_code: CLIENTE,
      actor: ATOR,
      result: resultado,
      source: FONTE,
      created_at: ts(),
    });
    return resultado;
  });
}

function evento(tx, op, tipo, titulo, descricao, entityType, entityId, payload = {}) {
  const ref = db.collection("events").doc(`evt_acerto_${digest({ plano: PLANO.id, op: op.id, tipo, entityId })}`);
  tx.create(ref, {
    id: ref.id,
    type: tipo,
    title: titulo,
    description: descricao,
    severity: "info",
    entity_type: entityType,
    entity_id: entityId,
    customer_code: CLIENTE,
    payload: { ...payload, op: op.id, motivo: op.motivo, referencia: PLANO.referencia },
    occurred_at: new Date().toISOString(),
    source: FONTE,
    actor: ATOR,
  });
}

// --- Operações ---------------------------------------------------------------------------
// Cada tipo tem `ler(op)` (só leitura, devolve estado, previsto, erro, jaAplicado) e
// `gravar(op, leitura)`.

const OPS = {
  nota: {
    async ler() {
      return { estado: [], previsto: [] };
    },
    async gravar() {},
  },

  renomear: {
    async ler(op) {
      const sku = await skuPorCodigo(op.codigo);
      if (!sku) throw new Erro(`SKU ${op.codigo} não encontrado`);
      const atual = sku.nome;
      const novo = op.nome ?? (op.trocar ? atual.replace(new RegExp(op.trocar[0], "i"), (m) => (m === m.toUpperCase() ? op.trocar[1].toUpperCase() : op.trocar[1])) : "");
      if (!novo) throw new Erro("informe nome ou trocar");
      const generoAtual = text(sku.data.genero);
      const semMudanca = novo === atual && (!op.genero || generoAtual === op.genero);
      const [produtos, saldos, linhas, projecao] = await Promise.all([
        produtosPorCodigo(sku.codCliente),
        saldosDoSku(sku.id),
        linhasAbertura({ sku: sku.id }),
        cinv(sku.id),
      ]);
      return {
        jaAplicado: await reciboExiste(idReciboDireto(op)),
        semMudanca,
        estado: [`${sku.id} · "${atual}"${generoAtual ? ` · gênero ${generoAtual}` : ""} · saldo ${descreverSaldos(saldos)}`],
        previsto: [
          `nome → "${novo}"${op.genero ? ` · gênero → ${op.genero}` : ""} em skus, ${produtos.length} products, ${saldos.length} saldos, ${linhas.length} linhas da abertura${projecao ? ", client_inventory" : ""}`,
        ],
        dados: { sku, novo, produtos, saldos, linhas, projecao },
      };
    },
    async gravar(op, L) {
      const { sku, novo, produtos, saldos, linhas, projecao } = L.dados;
      return transacaoDireta(op, "renomear", sku.id, async (tx) => {
        const refs = [sku.ref, ...produtos.map((r) => r.ref), ...saldos.map((r) => r.ref), ...linhas.map((r) => r.ref), ...(projecao ? [projecao.ref] : [])];
        await Promise.all(refs.map((r) => tx.get(r)));
        const catalogo = compact({ produto: novo, genero: op.genero, updated_at: ts(), updated_by: ATOR });
        tx.update(sku.ref, catalogo);
        for (const p of produtos) tx.update(p.ref, catalogo);
        for (const s of saldos) tx.update(s.ref, { product_name: novo, updated_at: ts() });
        for (const l of linhas) tx.update(l.ref, { product_name: novo, updated_at: ts() });
        if (projecao) tx.update(projecao.ref, { product_name: novo, updated_at: ts() });
        evento(tx, op, "catalog.renamed", `Produto ${sku.codCliente || sku.id} renomeado`, `"${sku.nome}" → "${novo}"`, "sku", sku.id, {
          antes: { produto: sku.nome, genero: text(sku.data.genero) || null },
          depois: { produto: novo, genero: op.genero ?? null },
        });
        return { sku: sku.id, produto: novo };
      });
    },
  },

  trocar_fotos: {
    async ler(op) {
      const familia = async (prefixo) => {
        const key = normalizedIdentity(prefixo);
        const snap = await db.collection("skus").where("cod_cliente_key", ">=", key).where("cod_cliente_key", "<=", `${key}`).get();
        const ordem = ["PP", "P", "M", "G", "GG", "XG", "XGG", "EG", "EGG", "U"];
        const tamanho = (sku) => ordem.indexOf(text(sku.codCliente).split(".").pop().toUpperCase());
        const skus = snap.docs.filter((d) => !arquivado(d.data()) && doCliente(d.data())).map(linhaSku).sort((a, b) => tamanho(a) - tamanho(b));
        // As fotos que o card mostra: as do primeiro SKU com foto, na ordem de tamanho.
        const fonte = skus.find((sku) => text(sku.data.primary_photo_url) || lista(sku.data.photo_urls).length);
        const fotos = [];
        const caminhos = new Map();
        if (fonte) {
          const urls = lista(fonte.data.photo_urls);
          const paths = lista(fonte.data.photo_storage_paths);
          for (const url of [text(fonte.data.primary_photo_url), ...urls].filter(Boolean)) if (!fotos.includes(url)) fotos.push(url);
          urls.forEach((url, i) => {
            if (paths[i]) caminhos.set(url, paths[i]);
          });
        }
        return { prefixo, skus, fonte, fotos: fotos.slice(0, 8), caminhos };
      };
      const [A, B] = await Promise.all([familia(op.familia_a), familia(op.familia_b)]);
      if (!A.skus.length || !B.skus.length) throw new Erro(`família sem SKU ativo: ${A.prefixo} (${A.skus.length}), ${B.prefixo} (${B.skus.length})`);
      if (!A.fotos.length || !B.fotos.length) throw new Erro(`família sem foto: ${A.prefixo} (${A.fotos.length}), ${B.prefixo} (${B.fotos.length}); nada a trocar`);
      const recibos = await Promise.all(
        [...A.skus, ...B.skus].map((sku) => reciboExiste(idReciboFotos(sku.id, chave(op, sku.id)))),
      );
      return {
        jaAplicado: recibos.every(Boolean),
        estado: [
          `${A.prefixo}* · ${A.skus.length} SKUs · fotos do ${A.fonte.codCliente}: ${A.fotos.length} · principal ${curto(A.fotos[0])}`,
          `${B.prefixo}* · ${B.skus.length} SKUs · fotos do ${B.fonte.codCliente}: ${B.fotos.length} · principal ${curto(B.fotos[0])}`,
        ],
        previsto: [
          `${A.skus.length} SKUs de ${A.prefixo}* recebem as ${B.fotos.length} fotos de ${B.fonte.codCliente} e perdem as próprias`,
          `${B.skus.length} SKUs de ${B.prefixo}* recebem as ${A.fotos.length} fotos de ${A.fonte.codCliente} e perdem as próprias`,
        ],
        dados: { A, B },
      };
    },
    async gravar(op, L) {
      const { A, B } = L.dados;
      const aplicar = async (alvo, fonte) => {
        const paths = fonte.fotos.map((url) => fonte.caminhos.get(url));
        const comCaminho = paths.every(Boolean);
        for (const sku of alvo.skus) {
          const proprias = [...new Set([text(sku.data.primary_photo_url), ...lista(sku.data.photo_urls)].filter(Boolean))];
          const remover = proprias.filter((url) => !fonte.fotos.includes(url));
          await operations.addCatalogPhotosTransaction(
            db,
            compact({
              sku_code: sku.id,
              client_item_code: sku.codCliente || undefined,
              customer_code: CLIENTE,
              photo_urls: fonte.fotos,
              photo_storage_paths: comCaminho ? paths : undefined,
              primary_photo_url: fonte.fotos[0],
              remove_photo_urls: remover,
              idempotency_key: chave(op, sku.id),
            }),
            ATOR,
          );
        }
      };
      await aplicar(A, B);
      await aplicar(B, A);
      return { trocados: A.skus.length + B.skus.length };
    },
  },

  criar_sku: {
    async ler(op) {
      const existente = await skuPorCodigo(op.codigo);
      if (existente) {
        return {
          jaAplicado: true,
          estado: [`${op.codigo} já existe: ${existente.id} · "${existente.nome}"`],
          previsto: [],
          dados: { existente },
        };
      }
      const irmao = await skuPorCodigo(op.copiar_de);
      if (!irmao) throw new Erro(`SKU de referência ${op.copiar_de} não encontrado`);
      const tamIrmao = text(irmao.data.size || irmao.data.tamanho) || text(op.copiar_de).split(".").pop();
      const nome = op.nome ?? (op.manter_nome ? irmao.nome : derivarNome(irmao.nome, tamIrmao, op.tamanho));
      const clientes = await db.collection("customers").where("code", "==", CLIENTE).get();
      const prefixo = clientes.docs.map((d) => text(d.data().sku_prefix)).find(Boolean) || "?";
      const contador = await db.collection("sku_counters").doc(prefixo).get();
      previstos.contagem += 1;
      const proximo = `${prefixo}-${String(num(contador.data()?.last) + previstos.contagem).padStart(6, "0")}`;
      const fotos = lista(irmao.data.photo_urls);
      return {
        estado: [`${op.codigo} não existe · referência ${op.copiar_de} = ${irmao.id} · "${irmao.nome}" · ${text(irmao.data.categoria || irmao.data.category) || "sem categoria"} · ${text(irmao.data.genero) || "sem gênero"} · ${fotos.length} fotos`],
        previsto: [`cria products e skus ${op.codigo} · "${nome}" · tamanho ${op.tamanho} · SKU ${proximo} (previsto) · saldo 0`],
        dados: { irmao, nome },
      };
    },
    async gravar(op, L) {
      const { irmao, nome } = L.dados;
      return transacaoDireta(op, "criar_sku", op.codigo, async (tx) => {
        const key = normalizedIdentity(op.codigo);
        const jaExiste = (await tx.get(db.collection("skus").where("cod_cliente_key", "==", key))).docs.some((d) => !arquivado(d.data()) && doCliente(d.data()));
        if (jaExiste) throw new Erro(`${op.codigo} apareceu no cadastro entre o dry-run e a gravação`);
        const irmaoSnap = await tx.get(irmao.ref);
        const ref = irmaoSnap.data();
        const alocador = await catalogCodes.openSkuAllocator(tx, db, CLIENTE);
        const skuCode = await alocador.next();
        const catalogo = compact({
          customer_code: CLIENTE,
          cod_cliente: op.codigo,
          cod_cliente_key: key,
          produto: nome,
          category: text(ref.category || ref.categoria) || undefined,
          categoria: text(ref.categoria || ref.category) || undefined,
          genero: text(ref.genero) || undefined,
          grupo: text(ref.grupo) || undefined,
          brand: text(ref.brand || ref.marca) || undefined,
          marca: text(ref.marca || ref.brand) || undefined,
          size: op.tamanho,
          tamanho: op.tamanho,
          color: text(ref.color || ref.cor) || undefined,
          cor: text(ref.cor || ref.color) || undefined,
          photo_urls: lista(ref.photo_urls).length ? lista(ref.photo_urls) : undefined,
          primary_photo_url: text(ref.primary_photo_url) || lista(ref.photo_urls)[0] || undefined,
          photo_storage_paths: lista(ref.photo_storage_paths).length ? lista(ref.photo_storage_paths) : undefined,
          status: "active",
          archived: false,
          source: FONTE,
          created_by: ATOR,
          updated_by: ATOR,
          created_at: ts(),
          updated_at: ts(),
        });
        tx.set(db.collection("products").doc(safeDocId(op.codigo)), { id: op.codigo, ...catalogo, estoque_btg: 0, num_skus: 1 });
        tx.set(db.collection("skus").doc(safeDocId(skuCode)), {
          id: skuCode,
          ...catalogo,
          cod_btg: skuCode,
          sku_code: skuCode,
          sku_code_key: normalizedIdentity(skuCode),
          estoque_atual: 0,
          estoque_reservado: 0,
          estoque_disponivel: 0,
        });
        alocador.commit();
        evento(tx, op, "catalog.created_by_acerto", `SKU ${skuCode} criado para ${op.codigo}`, `"${nome}", copiado de ${irmao.id} (${op.copiar_de})`, "sku", skuCode, {
          cod_cliente: op.codigo,
          copiado_de: irmao.id,
        });
        return { sku: skuCode, cod_cliente: op.codigo, produto: nome };
      });
    },
  },

  transferir: {
    async ler(op) {
      const [saiu, entrou] = await Promise.all([
        reciboExiste(idReciboMovimento(chave(op, "saida"))),
        reciboExiste(idReciboMovimento(chave(op, "entrada"))),
      ]);
      const jaAplicado = saiu && entrou;
      if (jaAplicado) return { jaAplicado, estado: [`saída e entrada já gravadas`], previsto: [] };
      const de = await skuPorCodigo(op.de, { incluirArquivados: saiu });
      if (!de) throw new Erro(`SKU de origem ${op.de} não encontrado`);
      const para = await destino(op.para);
      const posSaida = await resolverPosicao(op.posicao, de);
      const posEntrada = op.posicao_entrada ? await resolverPosicao(op.posicao_entrada, null) : posSaida;
      const saldos = await saldosDoSku(de.id);
      const origem = saldos.find((r) => r.posicao === posSaida);
      const disponivel = origem ? num(origem.data.qty_on_hand) - num(origem.data.qty_reserved) : 0;
      const qtde = op.qtde === "tudo" ? disponivel : num(op.qtde);
      if (!jaAplicado && qtde <= 0) throw new Erro(`nada a transferir: ${de.codCliente || de.id} em ${posSaida} tem ${fmt(disponivel)} disponível`);
      if (!jaAplicado && !saiu && disponivel < qtde) throw new Erro(`${de.codCliente || de.id} em ${posSaida} tem ${fmt(disponivel)} disponível, precisa de ${fmt(qtde)}`);
      return {
        jaAplicado,
        estado: [`${op.de} = ${de.id} · "${de.nome}" · saldo ${descreverSaldos(saldos)} · destino ${para.texto}`],
        previsto: [`SAIDA ${fmt(qtde)} de ${de.id} em ${posSaida} → ENTRADA ${fmt(qtde)} em ${op.para} em ${posEntrada}${saiu && !entrou ? " (saída já gravada; falta a entrada)" : ""}`],
        dados: { de, para, posSaida, posEntrada, qtde, saiu, entrou },
      };
    },
    async gravar(op, L) {
      const { de, posSaida, posEntrada, qtde } = L.dados;
      const paraSku = (await skuPorCodigo(op.para)) ?? null;
      if (!paraSku) throw new Erro(`SKU de destino ${op.para} ainda não existe`);
      const base = { customer_code: CLIENTE, reason: op.motivo, reference: PLANO.referencia };
      await operations.createInventoryMovementTransaction(
        db,
        compact({ ...base, type: "SAIDA", quantity: qtde, sku_code: de.id, client_item_code: de.codCliente || undefined, product_name: de.nome || undefined, location_id: posSaida, idempotency_key: chave(op, "saida") }),
        ATOR,
      );
      await operations.createInventoryMovementTransaction(
        db,
        compact({ ...base, type: "ENTRADA", quantity: qtde, sku_code: paraSku.id, client_item_code: paraSku.codCliente || undefined, product_name: paraSku.nome || undefined, location_id: posEntrada, idempotency_key: chave(op, "entrada") }),
        ATOR,
      );
      return { de: de.id, para: paraSku.id, qtde, posSaida, posEntrada };
    },
  },

  ajuste: {
    async ler(op) {
      if (await reciboExiste(idReciboMovimento(chave(op)))) return { jaAplicado: true, estado: [`ajuste já gravado`], previsto: [] };
      const sku = await skuPorCodigo(op.codigo);
      if (!sku) throw new Erro(`SKU ${op.codigo} não encontrado`);
      const posicao = await resolverPosicao(op.posicao, sku);
      const saldos = await saldosDoSku(sku.id);
      const alvo = saldos.find((r) => r.posicao === posicao);
      const atual = alvo ? num(alvo.data.qty_on_hand) : 0;
      const reservado = alvo ? num(alvo.data.qty_reserved) : 0;
      const delta = num(op.delta);
      if (!delta) throw new Erro("delta zero");
      const jaAplicado = await reciboExiste(idReciboMovimento(chave(op)));
      if (!jaAplicado && delta < 0 && atual - reservado < -delta) throw new Erro(`${op.codigo} em ${posicao} tem ${fmt(atual - reservado)} disponível; não dá para tirar ${fmt(-delta)}`);
      if (!jaAplicado && delta > 0 && !alvo) throw new Erro(`${op.codigo} não tem saldo em ${posicao}; um Ajuste + criaria saldo numa posição nova`);
      return {
        jaAplicado,
        estado: [`${op.codigo} = ${sku.id} · saldo ${descreverSaldos(saldos)}`],
        previsto: [`${delta > 0 ? "ENTRADA" : "SAIDA"} ${fmt(Math.abs(delta))} em ${posicao}: ${fmt(atual)} → ${fmt(atual + delta)}`],
        dados: { sku, posicao, delta },
      };
    },
    async gravar(op, L) {
      const { sku, posicao, delta } = L.dados;
      await operations.createInventoryMovementTransaction(
        db,
        compact({
          type: delta > 0 ? "ENTRADA" : "SAIDA",
          quantity: Math.abs(delta),
          customer_code: CLIENTE,
          sku_code: sku.id,
          client_item_code: sku.codCliente || undefined,
          product_name: sku.nome || undefined,
          location_id: posicao,
          reason: op.motivo,
          reference: PLANO.referencia,
          idempotency_key: chave(op),
        }),
        ATOR,
      );
      return { sku: sku.id, posicao, delta };
    },
  },

  baixar_caixa: {
    async ler(op) {
      const box = await caixa(op.caixa);
      const linhas = await linhasAbertura({ caixa: op.caixa });
      if (!box && !linhas.length) return { jaAplicado: true, estado: [`caixa ${op.caixa} não existe mais e não tem linhas`], previsto: [] };
      if (!linhas.length) throw new Erro(`caixa ${op.caixa} sem linhas da abertura; nada a baixar`);
      const itens = [];
      const estado = [`caixa ${op.caixa}${box ? ` em ${box.posicao} · ${num(box.data.line_count)} produto(s), ${fmt(num(box.data.unit_count))} unidade(s) no registro` : " (registro já removido)"}`];
      let pendentes = 0;
      for (const linha of linhas) {
        const skuCode = text(linha.data.sku_code);
        const posicao = text(linha.data.location_id || box?.data.location_id).toUpperCase();
        const qtde = num(linha.data.counted_qty);
        const saldos = await saldosDoSku(skuCode);
        const alvo = saldos.find((r) => r.posicao === posicao);
        const disponivel = alvo ? num(alvo.data.qty_on_hand) - num(alvo.data.qty_reserved) : 0;
        const feito = await reciboExiste(idReciboMovimento(chave(op, linha.id)));
        if (!feito) pendentes += 1;
        if (!feito && disponivel < qtde) throw new Erro(`${skuCode} em ${posicao} tem ${fmt(disponivel)} disponível, a linha da caixa tem ${fmt(qtde)}`);
        estado.push(`  ${skuCode} · ${text(linha.data.client_item_code)} · "${text(linha.data.product_name)}" · ${fmt(qtde)} em ${posicao} · saldo ${descreverSaldos(saldos)}${feito ? " · baixa já gravada" : ""}`);
        itens.push({ linha, skuCode, posicao, qtde, feito });
      }
      return {
        jaAplicado: pendentes === 0,
        estado,
        previsto: itens.filter((i) => !i.feito).map((i) => `SAIDA ${fmt(i.qtde)} de ${i.skuCode} em ${i.posicao}`),
        dados: { itens },
      };
    },
    async gravar(op, L) {
      for (const item of L.dados.itens) {
        if (item.feito) continue;
        await operations.createInventoryMovementTransaction(
          db,
          compact({
            type: "SAIDA",
            quantity: item.qtde,
            customer_code: CLIENTE,
            sku_code: item.skuCode,
            client_item_code: text(item.linha.data.client_item_code) || undefined,
            product_name: text(item.linha.data.product_name) || undefined,
            location_id: item.posicao,
            reason: `${op.motivo} (caixa ${op.caixa})`,
            reference: PLANO.referencia,
            idempotency_key: chave(op, item.linha.id),
          }),
          ATOR,
        );
      }
      return { linhas: L.dados.itens.length };
    },
  },

  saida: {
    async ler(op) {
      if (await reciboExiste(idReciboMovimento(chave(op)))) return { jaAplicado: true, estado: [`saída já gravada`], previsto: [] };
      if (!op.codigo || !op.qtde) throw new Erro("informe codigo e qtde");
      const sku = await skuPorCodigo(op.codigo);
      if (!sku) throw new Erro(`SKU ${op.codigo} não encontrado`);
      const posicao = await resolverPosicao(op.posicao, sku);
      const saldos = await saldosDoSku(sku.id);
      const alvo = saldos.find((r) => r.posicao === posicao);
      const disponivel = alvo ? num(alvo.data.qty_on_hand) - num(alvo.data.qty_reserved) : 0;
      const jaAplicado = await reciboExiste(idReciboMovimento(chave(op)));
      if (!jaAplicado && disponivel < num(op.qtde)) throw new Erro(`${op.codigo} em ${posicao} tem ${fmt(disponivel)} disponível, precisa de ${fmt(num(op.qtde))}`);
      return { jaAplicado, estado: [`${op.codigo} = ${sku.id} · saldo ${descreverSaldos(saldos)}`], previsto: [`SAIDA ${fmt(num(op.qtde))} em ${posicao}`], dados: { sku, posicao } };
    },
    async gravar(op, L) {
      await operations.createInventoryMovementTransaction(
        db,
        compact({ type: "SAIDA", quantity: num(op.qtde), customer_code: CLIENTE, sku_code: L.dados.sku.id, client_item_code: L.dados.sku.codCliente || undefined, product_name: L.dados.sku.nome || undefined, location_id: L.dados.posicao, reason: op.motivo, reference: PLANO.referencia, idempotency_key: chave(op) }),
        ATOR,
      );
      return { sku: L.dados.sku.id, qtde: num(op.qtde) };
    },
  },

  arquivar: {
    async ler(op) {
      const sku = await skuPorCodigo(op.codigo);
      if (!sku) {
        const recibo = await reciboExiste(idReciboDireto(op));
        if (recibo) return { jaAplicado: true, estado: [`${op.codigo} já está arquivado`], previsto: [] };
        throw new Erro(`SKU ${op.codigo} não encontrado`);
      }
      const saldos = await saldosDoSku(sku.id);
      const total = saldos.reduce((s, r) => s + num(r.data.qty_on_hand), 0);
      const reservado = saldos.reduce((s, r) => s + num(r.data.qty_reserved), 0);
      const previsto = saidasPrevistasNoPlano(op.codigo, sku.id);
      const projetado = previsto.tudo ? 0 : total - previsto.soma;
      if (reservado > 0) throw new Erro(`${op.codigo} tem ${fmt(reservado)} reservado; resolva a reserva antes de arquivar`);
      if (total > 0 && projetado > 0) throw new Erro(`${op.codigo} ainda tem saldo ${fmt(total)} e o plano só tira ${fmt(previsto.tudo ? total : previsto.soma)}; arquivar só com saldo zero`);
      const [produtos, projecao] = await Promise.all([produtosPorCodigo(sku.codCliente), cinv(sku.id)]);
      return {
        estado: [`${op.codigo} = ${sku.id} · "${sku.nome}" · saldo ${fmt(total)}${total > 0 ? ` hoje, zero depois das transferências do plano` : ""}`],
        previsto: [`arquiva skus${produtos.length ? ` e ${produtos.length} products` : ""}${projecao ? " e some do portal (client_inventory)" : ""}`],
        dados: { sku, produtos, projecao },
      };
    },
    async gravar(op, L) {
      const { sku, produtos, projecao } = L.dados;
      const saldosAgora = await saldosDoSku(sku.id);
      const totalAgora = saldosAgora.reduce((s, r) => s + num(r.data.qty_on_hand) + num(r.data.qty_reserved), 0);
      if (totalAgora > 0) throw new Erro(`${op.codigo} ainda tem saldo ${fmt(totalAgora)}; não arquivado`);
      return transacaoDireta(op, "arquivar", sku.id, async (tx) => {
        await Promise.all([sku.ref, ...produtos.map((r) => r.ref), ...(projecao ? [projecao.ref] : [])].map((r) => tx.get(r)));
        const campos = { archived: true, active: false, status: "archived", archived_by: ATOR.uid, archived_at: ts(), updated_at: ts(), updated_by: ATOR };
        tx.update(sku.ref, campos);
        for (const p of produtos) tx.update(p.ref, campos);
        if (projecao) tx.update(projecao.ref, { client_archived: true, client_archived_at: ts(), client_archived_by: ATOR.uid, updated_at: ts() });
        evento(tx, op, "catalog.archived_by_acerto", `SKU ${sku.id} arquivado`, `${sku.codCliente || sku.id} · "${sku.nome}"`, "sku", sku.id, { cod_cliente: sku.codCliente });
        return { sku: sku.id };
      });
    },
  },

  remover_caixa: {
    async ler(op) {
      const box = await caixa(op.caixa);
      if (!box) return { jaAplicado: true, estado: [`caixa ${op.caixa} não existe mais`], previsto: [] };
      if (op.se_apoia === "esvaziar" && (await reciboExiste(idReciboDireto(op)))) return { jaAplicado: true, estado: [`caixa ${op.caixa} já esvaziada`], previsto: [] };
      const linhas = await linhasAbertura({ caixa: op.caixa });
      if (text(box.data.status) === "committing") throw new Erro(`caixa ${op.caixa} está em guarda`);
      const apoiadas = (await db.collection("warehouse_boxes").where("support_box_code", "==", box.id).get()).docs
        .filter((d) => ["stored", "committing"].includes(text(d.data().status)))
        .map((d) => ({ id: d.id, ref: d.ref, data: d.data() }));
      const estado = [`caixa ${op.caixa} em ${box.posicao} · status ${text(box.data.status)} · ${num(box.data.line_count)} produto(s), ${fmt(num(box.data.unit_count))} unidade(s) · ${linhas.length} linha(s) da abertura${apoiadas.length ? ` · apoio de ${apoiadas.map((a) => a.id).join(", ")}` : ""}`];
      if (apoiadas.length && op.se_apoia === "esvaziar") {
        return { estado, previsto: [`zera os contadores e mantém a caixa vazia como apoio de ${apoiadas.map((a) => a.id).join(", ")}`], dados: { box, apoiadas, modo: "esvaziar" } };
      }
      if (apoiadas.length && op.transferir_apoio_para) {
        const destino = await caixa(op.transferir_apoio_para);
        if (!destino) throw new Erro(`caixa de apoio ${op.transferir_apoio_para} não encontrada`);
        if (destino.id === box.id) throw new Erro("a caixa de apoio não pode ser ela mesma");
        if (text(destino.data.status) !== "stored") throw new Erro(`caixa de apoio ${destino.id} não está guardada`);
        if (destino.posicao !== box.posicao) throw new Erro(`caixa de apoio ${destino.id} está em ${destino.posicao}, e a ${box.id} em ${box.posicao}`);
        if (text(destino.data.support_box_code).toUpperCase() === box.id) throw new Erro(`${destino.id} está apoiada na ${box.id}; escolha outra caixa de apoio`);
        return {
          estado,
          previsto: [`muda o apoio de ${apoiadas.map((a) => a.id).join(", ")} para ${destino.id}`, `zera os contadores, apaga warehouse_boxes/${op.caixa} e libera a ocupação de ${box.posicao}; as linhas da abertura ficam como histórico`],
          dados: { box, apoiadas, destino, modo: "remover" },
        };
      }
      if (apoiadas.length) throw new Erro(`caixa ${op.caixa} serve de apoio para ${apoiadas.map((a) => a.id).join(", ")}; no plano, use se_apoia: "esvaziar" ou transferir_apoio_para`);
      return {
        estado,
        previsto: [`zera os contadores, apaga warehouse_boxes/${op.caixa} e libera a ocupação de ${box.posicao}; as linhas da abertura ficam como histórico`],
        dados: { box, apoiadas, modo: "remover" },
      };
    },
    async gravar(op, L) {
      const { box, apoiadas, destino, modo } = L.dados;
      if (destino && apoiadas.length) {
        await transacaoDireta(op, "transferir_apoio", box.id, async (tx) => {
          const atuais = await Promise.all(apoiadas.map((a) => tx.get(a.ref)));
          for (const [i, a] of apoiadas.entries()) {
            if (atuais[i].exists && text(atuais[i].data().support_box_code).toUpperCase() === box.id) tx.update(a.ref, { support_box_code: destino.id, updated_at: ts() });
          }
          evento(tx, op, "warehouse.box_support_moved_by_acerto", `Apoio de ${apoiadas.map((a) => a.id).join(", ")} movido para ${destino.id}`, `A caixa ${box.id} vai ser removida`, "warehouse_box", destino.id, {
            de: box.id,
            para: destino.id,
            caixas: apoiadas.map((a) => a.id),
          });
          return { de: box.id, para: destino.id };
        }, "apoio");
      }
      await transacaoDireta(op, modo === "esvaziar" ? "esvaziar_caixa" : "remover_caixa", box.id, async (tx) => {
        const atual = await tx.get(box.ref);
        if (!atual.exists) return { jaRemovida: true };
        tx.update(box.ref, { line_count: 0, unit_count: 0, draft_line_count: 0, draft_unit_count: 0, total_cost: 0, sku_codes: [], updated_at: ts() });
        evento(tx, op, "warehouse.box_emptied_by_acerto", `Caixa ${box.id} esvaziada no registro`, `Estava em ${box.posicao} com ${num(atual.data().line_count)} produto(s) e ${fmt(num(atual.data().unit_count))} unidade(s)`, "warehouse_box", box.id, {
          antes: { line_count: num(atual.data().line_count), unit_count: num(atual.data().unit_count), sku_codes: lista(atual.data().sku_codes, 50) },
        });
        return { caixa: box.id };
      });
      if (modo !== "esvaziar" && (await caixa(box.id)) !== null) {
        await warehouseBoxes.removeWarehouseBox(db, { code: box.id, customer_code: CLIENTE }, ATOR);
      }
      return { caixa: box.id, modo };
    },
  },

  corrigir_linha: {
    async ler(op) {
      if (await reciboExiste(idReciboDireto(op))) return { jaAplicado: true, estado: [`linha já corrigida`], previsto: [] };
      const de = await skuPorCodigo(op.de, { incluirArquivados: true });
      const deSku = de?.id ?? (ehSku(op.de) ? text(op.de).toUpperCase() : null);
      if (!deSku) throw new Erro(`SKU de origem ${op.de} não encontrado`);
      const linhas = await linhasAbertura(op.caixa ? { caixa: op.caixa, sku: deSku } : { sku: deSku });
      if (linhas.length !== 1) throw new Erro(`${linhas.length} linha(s) da abertura de ${op.de}${op.caixa ? ` na caixa ${op.caixa}` : ""}; precisa ser exatamente 1`);
      const linha = linhas[0];
      const para = await destino(op.para);
      const box = await caixa(text(linha.data.box_code));
      const antes = num(linha.data.counted_qty);
      const depois = op.qtde == null ? antes : num(op.qtde);
      return {
        estado: [`linha ${linha.id} · caixa ${text(linha.data.box_code)}${box ? ` em ${box.posicao}` : ""} · ${deSku} · ${text(linha.data.client_item_code)} · "${text(linha.data.product_name)}" · ${fmt(antes)} un.`],
        previsto: [`linha → ${para.texto} · ${fmt(depois)} un.${depois !== antes ? ` (caixa ${fmt(antes)} → ${fmt(depois)})` : ""}`],
        dados: { linha, box, deSku, antes, depois },
      };
    },
    async gravar(op, L) {
      const { linha, box, deSku, antes, depois } = L.dados;
      const para = await skuPorCodigo(op.para);
      if (!para) throw new Erro(`SKU de destino ${op.para} ainda não existe`);
      return transacaoDireta(op, "corrigir_linha", linha.id, async (tx) => {
        const [linhaSnap, boxSnap, irmas] = await Promise.all([
          tx.get(linha.ref),
          box ? tx.get(box.ref) : Promise.resolve(null),
          tx.get(db.collection("opening_inventory_lines").where("box_code", "==", text(linha.data.box_code))),
        ]);
        const dados = linhaSnap.data();
        tx.update(linha.ref, {
          sku_code: para.id,
          client_item_code: para.codCliente || para.id,
          product_name: para.nome,
          counted_qty: depois,
          acerto: { op: op.id, antes: { sku_code: text(dados.sku_code), client_item_code: text(dados.client_item_code), product_name: text(dados.product_name), counted_qty: num(dados.counted_qty) }, at: new Date().toISOString() },
          updated_at: ts(),
        });
        if (boxSnap?.exists) {
          const outraComDe = irmas.docs.some((d) => d.id !== linha.id && linhaViva(d.data()) && text(d.data().sku_code) === deSku);
          const codigos = lista(boxSnap.data().sku_codes, 100).filter((c) => c !== deSku || outraComDe);
          if (!codigos.includes(para.id)) codigos.push(para.id);
          tx.update(box.ref, compact({ sku_codes: codigos, unit_count: depois !== antes ? FieldValue.increment(depois - antes) : undefined, updated_at: ts() }));
        }
        evento(tx, op, "opening_line.corrected_by_acerto", `Linha da caixa ${text(linha.data.box_code)} corrigida`, `${deSku} ${fmt(antes)} → ${para.id} ${fmt(depois)}`, "opening_inventory_line", linha.id, {
          caixa: text(linha.data.box_code),
          antes: { sku_code: deSku, counted_qty: antes },
          depois: { sku_code: para.id, cod_cliente: para.codCliente, counted_qty: depois },
        });
        return { linha: linha.id, para: para.id, qtde: depois };
      });
    },
  },

  ajustar_linha: {
    async ler(op) {
      if (!op.codigo) throw new Erro("informe codigo");
      const sku = await skuPorCodigo(op.codigo);
      if (!sku) throw new Erro(`SKU ${op.codigo} não encontrado`);
      if (await reciboExiste(idReciboDireto(op))) return { jaAplicado: true, estado: [`linha já ajustada`], previsto: [] };
      const linhas = await linhasAbertura(op.caixa ? { caixa: op.caixa, sku: sku.id } : { sku: sku.id });
      if (linhas.length !== 1) throw new Erro(`${linhas.length} linha(s) da abertura de ${op.codigo}${op.caixa ? ` na caixa ${op.caixa}` : ""}; precisa ser exatamente 1`);
      const linha = linhas[0];
      const antes = num(linha.data.counted_qty);
      const depois = op.qtde != null ? num(op.qtde) : antes + num(op.delta);
      if (depois === antes) return { semMudanca: true, estado: [`linha ${linha.id} · caixa ${text(linha.data.box_code)} · ${fmt(antes)} un.`], previsto: [] };
      return {
        estado: [`linha ${linha.id} · caixa ${text(linha.data.box_code)} · ${sku.id} · ${fmt(antes)} un.`],
        previsto: [`linha e caixa ${fmt(antes)} → ${fmt(depois)}`],
        dados: { linha, antes, depois, sku },
      };
    },
    async gravar(op, L) {
      const { linha, antes, depois, sku } = L.dados;
      return transacaoDireta(op, "ajustar_linha", linha.id, async (tx) => {
        const boxRef = db.collection("warehouse_boxes").doc(text(linha.data.box_code).toUpperCase());
        const [, boxSnap] = await Promise.all([tx.get(linha.ref), tx.get(boxRef)]);
        tx.update(linha.ref, { counted_qty: depois, acerto: { op: op.id, antes: { counted_qty: antes }, at: new Date().toISOString() }, updated_at: ts() });
        if (boxSnap.exists) tx.update(boxRef, { unit_count: FieldValue.increment(depois - antes), updated_at: ts() });
        evento(tx, op, "opening_line.adjusted_by_acerto", `Linha da caixa ${text(linha.data.box_code)} ajustada`, `${sku.id}: ${fmt(antes)} → ${fmt(depois)}`, "opening_inventory_line", linha.id, {
          caixa: text(linha.data.box_code),
          antes: { counted_qty: antes },
          depois: { counted_qty: depois },
        });
        return { linha: linha.id, qtde: depois };
      });
    },
  },
};

// --- Execução ------------------------------------------------------------------------------

const selecionada = (bloco, op) =>
  (!args.blocos.length || args.blocos.includes(bloco.id)) && (!args.ops.length || args.ops.includes(op.id));

function descrever(op) {
  switch (op.tipo) {
    case "renomear": return `renomear ${op.codigo}`;
    case "trocar_fotos": return `trocar fotos ${op.familia_a}* ↔ ${op.familia_b}*`;
    case "criar_sku": return `criar SKU ${op.codigo}`;
    case "transferir": return `transferir ${op.qtde === "tudo" ? "tudo" : fmt(num(op.qtde))} de ${op.de} para ${op.para}`;
    case "ajuste": return `ajuste ${num(op.delta) > 0 ? "+" : ""}${fmt(num(op.delta))} em ${op.codigo}`;
    case "baixar_caixa": return `baixar o conteúdo da caixa ${op.caixa}`;
    case "saida": return `saída de ${op.qtde ?? "?"} de ${op.codigo ?? "?"}`;
    case "arquivar": return `arquivar ${op.codigo}`;
    case "remover_caixa": return `remover caixa ${op.caixa}`;
    case "corrigir_linha": return `corrigir linha ${op.caixa ? `da caixa ${op.caixa} ` : ""}${op.de} → ${op.para}`;
    case "ajustar_linha": return `ajustar linha ${op.caixa ? `da caixa ${op.caixa} ` : ""}${op.codigo ?? "?"}`;
    case "nota": return "nota";
    default: return op.tipo;
  }
}

async function ler(op) {
  const impl = OPS[op.tipo];
  if (!impl) throw new Erro(`tipo desconhecido: ${op.tipo}`);
  try {
    return await impl.ler(op);
  } catch (erro) {
    if (erro instanceof Erro) return { erro: erro.message, estado: [], previsto: [] };
    if (erro?.code && erro?.message) return { erro: `${erro.code}: ${erro.message}`, estado: [], previsto: [] };
    throw erro;
  }
}

function imprimir(bloco, op, L) {
  console.log(`[${op.id}] ${descrever(op)}`);
  for (const linha of L.estado ?? []) console.log(`   agora   : ${linha}`);
  if (op.pendente) console.log(`   PENDENTE: ${op.pendente}`);
  if (L.erro) console.log(op.pendente ? `   (hoje)  : ${L.erro}` : `   ERRO    : ${L.erro}`);
  else if (L.jaAplicado) console.log(`   feito   : já aplicado`);
  else if (L.semMudanca) console.log(`   feito   : sem mudança`);
  else for (const linha of L.previsto ?? []) console.log(`   grava   : ${linha}`);
}

const controle = await db.collection("system_controls").doc("inventory").get();
if (controle.exists && (controle.data().movements_frozen === true || text(controle.data().reconciliation_status) === "running")) {
  abortar("As movimentações do estoque estão congeladas (system_controls/inventory). Libere antes do acerto.");
}

console.log(`\nAcerto único BTG · plano ${PLANO.id} · projeto ${PROJETO}${emulador ? ` · EMULADOR ${emuladorHost}` : ""} · ${args.aplicar ? "APLICAR" : "DRY-RUN, nada será gravado"}`);
console.log(`Cliente: ${CLIENTE} · ator ${ATOR.uid}\n`);

const resumo = { total: 0, gravar: 0, feitas: 0, pendentes: 0, erros: 0, semMudanca: 0 };
const fila = [];
for (const bloco of BLOCOS) {
  const ops = bloco.ops.filter((op) => selecionada(bloco, op));
  if (!ops.length) continue;
  console.log(`== ${bloco.id}: ${bloco.titulo}`);
  for (const op of ops) {
    resumo.total += 1;
    const L = op.pendente && op.tipo === "nota" ? { estado: [], previsto: [] } : await ler(op);
    imprimir(bloco, op, L);
    if (op.pendente) resumo.pendentes += 1;
    else if (L.erro) resumo.erros += 1;
    else if (L.jaAplicado) resumo.feitas += 1;
    else if (L.semMudanca) resumo.semMudanca += 1;
    else {
      resumo.gravar += 1;
      fila.push({ bloco, op });
    }
  }
  console.log("");
}
console.log(`Resumo: ${resumo.total} operações · ${resumo.gravar} a gravar · ${resumo.feitas} já aplicadas · ${resumo.semMudanca} sem mudança · ${resumo.pendentes} pendentes · ${resumo.erros} com erro`);

if (!args.aplicar) {
  console.log("\nDry-run encerrado. Nada foi gravado.");
  process.exit(resumo.erros ? 1 : 0);
}
if (resumo.erros) abortar(`${resumo.erros} operação(ões) com erro. Corrija o plano ou o banco antes de aplicar.`);
if (!fila.length) {
  console.log("\nNada a gravar.");
  process.exit(0);
}

console.log(`\nAplicando ${fila.length} operação(ões)...\n`);
let gravadas = 0;
for (const { op } of fila) {
  const L = await ler(op);
  if (L.erro) abortar(`[${op.id}] ${L.erro} (parou aqui; o que já foi gravado fica, e rodar de novo continua de onde parou)`);
  if (L.jaAplicado) {
    console.log(`[${op.id}] já aplicado`);
    continue;
  }
  if (L.semMudanca) {
    console.log(`[${op.id}] sem mudança`);
    continue;
  }
  try {
    const resultado = await OPS[op.tipo].gravar(op, L);
    gravadas += 1;
    console.log(`[${op.id}] gravado${resultado && typeof resultado === "object" && Object.keys(resultado).length ? ` · ${JSON.stringify(resultado)}` : ""}`);
  } catch (erro) {
    abortar(`[${op.id}] ${erro?.message ?? erro} (parou aqui; o que já foi gravado fica, e rodar de novo continua de onde parou)`);
  }
}
console.log(`\n${gravadas} operação(ões) gravada(s). Rode o dry-run de novo para conferir: tudo deve aparecer como "já aplicado".`);
