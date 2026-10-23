import { mkdirSync, writeFileSync } from "node:fs";
import { userInfo } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { deleteApp, getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore, type DocumentReference, type Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";

import { CASAS_DO_PRECO, ErroDinheiro, lerDecimal } from "../domain/dinheiro.js";
import { createComercialEvent } from "../domain/events.js";
import { runIdempotent, type ComercialActor } from "../domain/operations.js";
import { PRICE_TABLES_COLLECTION, normalizarVariante, vigenciaContem } from "../domain/tabelas.js";
import { celulaCsv } from "./csv.js";
import { podeGravarNoProjeto } from "./projeto.js";
import { CABECALHO } from "./tabela.js";

/**
 * Levar a LPU de cobrança do WMS de um cliente ao Comercial (parte 7.3b,
 * docs/plataforma/fase-7-financeiro-unificado.md). Três passos, cada um com
 * dry-run:
 *
 * 1. `--exportar`: lê os itens ativos da cobrança do cliente em
 *    `billing_price_list` (sem o ad valorem, que é taxa) e escreve em
 *    tmp/comercial/ o CSV da carga de tabela, com a categoria "Armazenagem",
 *    o serviço igual ao grupo, o código `WMS-<id>` e o preço de hoje. Não
 *    grava nada no banco.
 * 2. Carregar o CSV com a carga de tabela (tabela.js), na variante
 *    "Armazenagem" e com o cliente.
 * 3. `--ligar --tabela <id>`: confere cada item da cobrança na tabela, pelo
 *    código e com o mesmo preço, e grava o `lpu_item_id` dele, numa transação,
 *    com recibo e o evento `price_table.wms_linked`. Ligado, o WMS tira o
 *    preço da tabela (parte 7.3a) e a fatura calcula igual.
 *
 * A tabela tem de valer em toda competência que ainda se emite (a anterior e
 * a atual, e as abertas): senão o WMS recusaria a emissão dela por falta de
 * preço.
 */

/** Cópias literais do WMS (collectionNames e domain/billing-scope.ts); a trava é armazenagem.test.ts. */
export const BILLING_PRICE_LIST = "billing_price_list";
export const BILLING_PERIODS = "billing_periods";
export const CLIENTE_DO_ID_ANTIGO = "BTG Pactual";
const AD_VALOREM = "ad_valorem";

export const VARIANTE_DA_ARMAZENAGEM = "Armazenagem";
export const CATEGORIA_DA_ARMAZENAGEM = "Armazenagem";
const PREFIXO_DO_CODIGO = "WMS-";

const OPERACAO = "armazenagem_link";
const PASTA_DO_ARQUIVO = fileURLToPath(new URL("../../../../tmp/comercial/", import.meta.url));

export class ErroDaArmazenagem extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ErroDaArmazenagem";
  }
}

// --- Argumentos -----------------------------------------------------------------

export type ArgumentosDaArmazenagem = {
  modo: "exportar" | "ligar";
  cliente: string;
  projeto: string;
  tabela: string | null;
  executar: boolean;
  por: string | null;
};

export const USO = [
  "Uso: node functions/comercial/lib/cargas/armazenagem.js --cliente <customer_code> --projeto <projeto> --exportar",
  "       node functions/comercial/lib/cargas/armazenagem.js --cliente <customer_code> --projeto <projeto> --ligar --tabela <id> [--executar] [--por <e-mail>]",
  "O --exportar só lê. O --ligar sem --executar é dry-run. Ver docs/plataforma/fase-7-financeiro-unificado.md, parte 7.3b.",
].join("\n");

const PROJETO = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const TABELA = /^pt_[a-f0-9]{8,64}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CONTROLE = /\p{Cc}/u;

export function lerArgumentos(argv: readonly string[]): ArgumentosDaArmazenagem {
  const valores: Record<string, string> = {};
  const marcas = new Set<string>();
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (["--exportar", "--ligar", "--executar"].includes(token)) {
      if (marcas.has(token)) throw new ErroDaArmazenagem(`${token} repetido.`);
      marcas.add(token);
      continue;
    }
    if (!["--cliente", "--projeto", "--tabela", "--por"].includes(token)) throw new ErroDaArmazenagem(`Opção desconhecida: ${token}.`);
    if (valores[token] !== undefined) throw new ErroDaArmazenagem(`${token} repetido.`);
    const valor = argv[i + 1];
    if (valor === undefined || valor.startsWith("--") || !valor.trim()) throw new ErroDaArmazenagem(`${token} sem valor.`);
    valores[token] = valor.trim();
    i += 1;
  }
  if (marcas.has("--exportar") === marcas.has("--ligar")) throw new ErroDaArmazenagem("Use --exportar ou --ligar, um dos dois.");
  const modo = marcas.has("--exportar") ? "exportar" : "ligar";
  const cliente = valores["--cliente"];
  if (!cliente) throw new ErroDaArmazenagem("Falta --cliente.");
  if (cliente.length > 120 || cliente.includes("/") || CONTROLE.test(cliente)) {
    throw new ErroDaArmazenagem("--cliente: o customer_code tem até 120 caracteres, sem barra nem caractere de controle.");
  }
  const projeto = valores["--projeto"];
  if (!projeto) throw new ErroDaArmazenagem("Falta --projeto (não há projeto padrão). Ex.: --projeto dute-homolog.");
  if (!PROJETO.test(projeto)) throw new ErroDaArmazenagem(`--projeto: "${projeto}" não é id de projeto do Google Cloud.`);
  const tabela = valores["--tabela"] ?? null;
  if (modo === "ligar" && tabela === null) throw new ErroDaArmazenagem("--ligar exige --tabela <id>, a tabela Armazenagem carregada.");
  if (modo === "exportar" && tabela !== null) throw new ErroDaArmazenagem("--tabela é só do --ligar.");
  if (tabela !== null && !TABELA.test(tabela)) throw new ErroDaArmazenagem(`--tabela: "${tabela}" não é id de tabela (pt_...).`);
  if (modo === "exportar" && marcas.has("--executar")) throw new ErroDaArmazenagem("O --exportar só lê: não recebe --executar.");
  const por = valores["--por"] ?? null;
  if (por !== null && !EMAIL.test(por)) throw new ErroDaArmazenagem(`--por: "${por}" não é e-mail.`);
  return { modo, cliente, projeto, tabela, executar: marcas.has("--executar"), por };
}

// --- Os itens da cobrança ------------------------------------------------------------------

type Registro = Record<string, unknown>;

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.normalize("NFC").replace(/\s+/g, " ").trim() : "";
}

export type ItemDaCobranca = {
  /** O id do item no WMS (o `id` do documento, ou o id do documento). */
  id: string;
  doc_id: string;
  item: string;
  grupo: string;
  unidade: string;
  /** O preço de hoje, em texto decimal com ponto; null quando não cabe em 4 casas. */
  preco: string | null;
  lpu_item_id: string | null;
};

/** O número do WMS em texto decimal exato, até 4 casas; null quando não dá. */
export function precoDoNumero(valor: unknown): string | null {
  const numero = typeof valor === "number" ? valor : Number(valor ?? 0);
  if (!Number.isFinite(numero) || numero < 0) return null;
  const escrito = String(numero);
  if (!/^\d+(?:\.\d+)?$/.test(escrito)) return null;
  const casas = escrito.split(".")[1]?.length ?? 0;
  return casas > CASAS_DO_PRECO ? null : escrito;
}

/**
 * Os itens da cobrança do cliente que vão para a tabela: ativos e sem o ad
 * valorem. O item sem cliente é da BTG, como o WMS lê (billingCustomerOf).
 */
export function itensDaCobranca(cliente: string, documentos: ReadonlyArray<{ id: string; dados: Registro }>): ItemDaCobranca[] {
  return documentos
    .filter(({ dados }) => (texto(dados.customer_code) || CLIENTE_DO_ID_ANTIGO) === cliente)
    .filter(({ dados }) => dados.ativo !== false && texto(dados.auto_source) !== AD_VALOREM)
    .map(({ id, dados }) => ({
      id: String(dados.id ?? id),
      doc_id: id,
      item: texto(dados.item) || id,
      grupo: texto(dados.grupo) || CATEGORIA_DA_ARMAZENAGEM,
      unidade: texto(dados.unidade) || "UN",
      preco: precoDoNumero(dados.valor_unit),
      lpu_item_id: texto(dados.lpu_item_id) || null,
    }))
    .sort((a, b) => a.id.localeCompare(b.id, "pt-BR", { numeric: true }));
}

export function codigoDoItem(item: Pick<ItemDaCobranca, "id">): string {
  return `${PREFIXO_DO_CODIGO}${item.id}`;
}

// --- 1. Exportar ---------------------------------------------------------------------------

export type PlanoDaExportacao = { linhas: string[]; erros: string[] };

/** O CSV da carga de tabela (o cabeçalho de tabela.ts), uma linha por item. */
export function planejarExportacao(itens: readonly ItemDaCobranca[]): PlanoDaExportacao {
  const erros: string[] = [];
  if (!itens.length) erros.push("O cliente não tem item ativo na cobrança do WMS além do ad valorem.");
  const linhas = [CABECALHO.join(";")];
  for (const item of itens) {
    if (item.preco === null) {
      erros.push(`O item ${item.item} (${item.id}) tem preço fora do decimal de até ${CASAS_DO_PRECO} casas.`);
      continue;
    }
    linhas.push(
      [codigoDoItem(item), CATEGORIA_DA_ARMAZENAGEM, item.item, item.grupo, item.item, item.unidade, item.preco].map((valor) => celulaCsv(valor)).join(";"),
    );
  }
  return { linhas, erros };
}

// --- 3. Ligar ------------------------------------------------------------------------------

export type TabelaDaArmazenagem = {
  id: string;
  customer_code: string | null;
  variante: string;
  vigente_de: string;
  vigente_ate: string | null;
  /** O item do catálogo de cada código da tabela, com o preço. */
  porCodigo: ReadonlyMap<string, { lpu_item_id: string; preco: string }>;
};

export function tabelaDaArmazenagemLida(id: string, dados: Registro): TabelaDaArmazenagem {
  const porCodigo = new Map<string, { lpu_item_id: string; preco: string }>();
  const precos = dados.precos && typeof dados.precos === "object" ? (dados.precos as Registro) : {};
  for (const [lpuItemId, valor] of Object.entries(precos)) {
    const preco = valor && typeof valor === "object" ? (valor as Registro) : {};
    const codigo = texto(preco.codigo);
    if (codigo && typeof preco.preco === "string") porCodigo.set(codigo, { lpu_item_id: lpuItemId, preco: preco.preco });
  }
  return {
    id,
    customer_code: texto(dados.customer_code) || null,
    variante: texto(dados.variante),
    vigente_de: texto(dados.vigente_de),
    vigente_ate: texto(dados.vigente_ate) || null,
    porCodigo,
  };
}

function mesmoValor(a: string, b: string): boolean {
  try {
    const x = lerDecimal(a, CASAS_DO_PRECO);
    const y = lerDecimal(b, CASAS_DO_PRECO);
    const casas = Math.max(x.casas, y.casas);
    return x.coeficiente * 10n ** BigInt(casas - x.casas) === y.coeficiente * 10n ** BigInt(casas - y.casas);
  } catch (erro) {
    if (erro instanceof ErroDinheiro) return false;
    throw erro;
  }
}

/** "2026-09" → "2026-09-30". */
export function ultimoDia(competencia: string): string {
  const [ano, mes] = competencia.split("-").map(Number);
  return `${competencia}-${String(new Date(Date.UTC(ano, mes, 0)).getUTCDate()).padStart(2, "0")}`;
}

const MES_EM_SAO_PAULO = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit" });

/** A competência de agora e a anterior, no horário de São Paulo. */
export function competenciasRecentes(agora: Date): [anterior: string, atual: string] {
  const atual = MES_EM_SAO_PAULO.format(agora).slice(0, 7);
  const [ano, mes] = atual.split("-").map(Number);
  const anterior = mes === 1 ? `${ano - 1}-12` : `${ano}-${String(mes - 1).padStart(2, "0")}`;
  return [anterior, atual];
}

export type Ligacao = { doc_id: string; id: string; item: string; lpu_item_id: string };

export type PlanoDaLigacao = { ligar: Ligacao[]; ja_ligados: number; erros: string[] };

function mesBr(competencia: string): string {
  const [ano, mes] = competencia.split("-");
  return `${mes}/${ano}`;
}

function diaBr(dia: string): string {
  const [ano, mes, diaDoMes] = dia.split("-");
  return `${diaDoMes}/${mes}/${ano}`;
}

/**
 * O que a ligação grava: cada item da cobrança com o item da tabela do mesmo
 * código e o mesmo preço. Recusa a tabela de outro cliente ou variante, o
 * item sem código na tabela, o preço diferente, o item já ligado a outro item
 * do catálogo e a tabela que não vale em competência que ainda se emite.
 */
export function planejarLigacao(
  cliente: string,
  tabela: TabelaDaArmazenagem,
  itens: readonly ItemDaCobranca[],
  aEmitir: readonly string[],
): PlanoDaLigacao {
  const erros: string[] = [];
  if (tabela.customer_code !== cliente) erros.push(`A tabela ${tabela.id} é de ${tabela.customer_code ?? "nenhum cliente (Padrão Dutelog)"}, não de ${cliente}.`);
  if (normalizarVariante(tabela.variante) !== normalizarVariante(VARIANTE_DA_ARMAZENAGEM)) {
    erros.push(`A tabela ${tabela.id} é da variante ${tabela.variante || "sem nome"}; a ligação usa a variante ${VARIANTE_DA_ARMAZENAGEM}.`);
  }
  for (const competencia of [...new Set(aEmitir)].sort()) {
    if (!vigenciaContem({ vigente_de: tabela.vigente_de, vigente_ate: tabela.vigente_ate }, ultimoDia(competencia))) {
      erros.push(
        `A tabela vale de ${diaBr(tabela.vigente_de)} a ${tabela.vigente_ate ? diaBr(tabela.vigente_ate) : "em aberto"} e não cobre a competência ${mesBr(competencia)}, que ainda se emite. ` +
          "Emita a competência antes, ou carregue a tabela com a vigência que a cobre.",
      );
    }
  }
  if (!itens.length) erros.push("O cliente não tem item ativo na cobrança do WMS além do ad valorem.");
  const ligar: Ligacao[] = [];
  let jaLigados = 0;
  for (const item of itens) {
    const naTabela = tabela.porCodigo.get(codigoDoItem(item));
    if (!naTabela) {
      erros.push(`O item ${item.item} (${codigoDoItem(item)}) não está na tabela ${tabela.id}.`);
      continue;
    }
    if (item.preco === null || !mesmoValor(item.preco, naTabela.preco)) {
      erros.push(`O preço do item ${item.item} no WMS (${item.preco ?? "inválido"}) não é o da tabela (${naTabela.preco}): exporte e carregue de novo.`);
      continue;
    }
    if (item.lpu_item_id === naTabela.lpu_item_id) {
      jaLigados += 1;
      continue;
    }
    if (item.lpu_item_id) {
      erros.push(`O item ${item.item} já está ligado a outro item do catálogo (${item.lpu_item_id}).`);
      continue;
    }
    ligar.push({ doc_id: item.doc_id, id: item.id, item: item.item, lpu_item_id: naTabela.lpu_item_id });
  }
  return { ligar, ja_ligados: jaLigados, erros };
}

/** As competências que ainda se emitem: a anterior e a atual, sem emitir, e as abertas do cliente. */
export function competenciasAEmitir(agora: Date, periodos: ReadonlyArray<{ competencia: string; status: string }>): string[] {
  const status = new Map(periodos.map((periodo) => [periodo.competencia, periodo.status]));
  const recentes = competenciasRecentes(agora).filter((competencia) => (status.get(competencia) ?? "aberto") === "aberto");
  const abertas = periodos.filter((periodo) => periodo.status === "aberto").map((periodo) => periodo.competencia);
  return [...new Set([...recentes, ...abertas])].sort();
}

// --- Banco ---------------------------------------------------------------------------------

async function documentosDaCobranca(leitor: { get(query: FirebaseFirestore.Query): Promise<FirebaseFirestore.QuerySnapshot> }, db: Firestore, cliente: string) {
  // A BTG tem itens antigos sem cliente: lê a lista toda, como o WMS (a lista é pequena).
  const consulta =
    cliente === CLIENTE_DO_ID_ANTIGO
      ? db.collection(BILLING_PRICE_LIST)
      : db.collection(BILLING_PRICE_LIST).where("customer_code", "==", cliente);
  const snapshot = await leitor.get(consulta);
  return snapshot.docs.map((doc) => ({ id: doc.id, dados: doc.data() }));
}

async function periodosDoCliente(leitor: { get(query: FirebaseFirestore.Query): Promise<FirebaseFirestore.QuerySnapshot> }, db: Firestore, cliente: string) {
  const consulta =
    cliente === CLIENTE_DO_ID_ANTIGO ? db.collection(BILLING_PERIODS) : db.collection(BILLING_PERIODS).where("customer_code", "==", cliente);
  const snapshot = await leitor.get(consulta);
  return snapshot.docs
    .map((doc) => ({ id: doc.id, dados: doc.data() }))
    .filter(({ dados }) => (texto(dados.customer_code) || CLIENTE_DO_ID_ANTIGO) === cliente)
    .map(({ id, dados }) => ({ competencia: texto(dados.competencia) || id.slice(-7), status: texto(dados.status) || "aberto" }));
}

export type ResultadoDaArmazenagem = {
  ok: boolean;
  modo: "exportar" | "ligar";
  gravou: boolean;
  replayed: boolean;
  arquivo: string | null;
  itens: number;
  ligados: number;
  ja_ligados: number;
  erros: string[];
};

export type Dependencias = {
  abrirBanco?: (projeto: string) => Firestore;
  /** Padrão: tmp/comercial/ na raiz do repositório. */
  pastaDoArquivo?: string;
  agora?: () => Date;
  env?: Record<string, string | undefined>;
  log?: (linha: string) => void;
};

function abrirBancoPadrao(projeto: string): Firestore {
  return getFirestore(initializeApp({ projectId: projeto }, `carga-armazenagem-${projeto}`));
}

function ator(args: ArgumentosDaArmazenagem): ComercialActor {
  let usuario = "";
  try {
    usuario = userInfo().username;
  } catch {
    usuario = "";
  }
  return { uid: "carga-armazenagem", role: "carga", ...(args.por ? { email: args.por } : {}), ...(usuario ? { name: usuario } : {}) };
}

class ErroDeEstado extends Error {
  readonly erros: string[];

  constructor(erros: string[]) {
    super(erros.join(" "));
    this.erros = erros;
  }
}

async function lerLigacao(db: Firestore, leitor: { get(query: FirebaseFirestore.Query): Promise<FirebaseFirestore.QuerySnapshot>; doc(ref: DocumentReference): Promise<FirebaseFirestore.DocumentSnapshot> }, args: ArgumentosDaArmazenagem, agora: Date) {
  const tabelaSnap = await leitor.doc(db.collection(PRICE_TABLES_COLLECTION).doc(args.tabela as string));
  if (!tabelaSnap.exists) return { plano: { ligar: [], ja_ligados: 0, erros: [`A tabela ${args.tabela} não existe.`] }, tabela: null, itens: [] as ItemDaCobranca[] };
  const tabela = tabelaDaArmazenagemLida(tabelaSnap.id, tabelaSnap.data() ?? {});
  const itens = itensDaCobranca(args.cliente, await documentosDaCobranca(leitor, db, args.cliente));
  const aEmitir = competenciasAEmitir(agora, await periodosDoCliente(leitor, db, args.cliente));
  return { plano: planejarLigacao(args.cliente, tabela, itens, aEmitir), tabela, itens };
}

/** Roda um passo. Erro de argumento ou de projeto é ErroDaArmazenagem; o do estado volta em `erros`. */
export async function rodarArmazenagem(argv: readonly string[], deps: Dependencias = {}): Promise<ResultadoDaArmazenagem> {
  const log = deps.log ?? ((linha: string) => console.log(linha));
  const env = deps.env ?? process.env;
  const args = lerArgumentos(argv);
  if (args.executar) {
    const problema = podeGravarNoProjeto(args.projeto, env);
    if (problema) throw new ErroDaArmazenagem(problema);
  }
  const db = (deps.abrirBanco ?? abrirBancoPadrao)(args.projeto);
  const agora = (deps.agora ?? (() => new Date()))();
  const resultado: ResultadoDaArmazenagem = { ok: false, modo: args.modo, gravou: false, replayed: false, arquivo: null, itens: 0, ligados: 0, ja_ligados: 0, erros: [] };
  const direto = { get: (query: FirebaseFirestore.Query) => query.get(), doc: (ref: DocumentReference) => ref.get() };

  if (args.modo === "exportar") {
    const itens = itensDaCobranca(args.cliente, await documentosDaCobranca(direto, db, args.cliente));
    const plano = planejarExportacao(itens);
    resultado.itens = itens.length;
    resultado.erros.push(...plano.erros);
    if (!plano.erros.length) {
      const pasta = deps.pastaDoArquivo ?? PASTA_DO_ARQUIVO;
      mkdirSync(pasta, { recursive: true });
      const nome = `armazenagem-${args.cliente.replace(/[^\w.-]+/g, "_")}-${agora.toISOString().slice(0, 10)}.csv`;
      resultado.arquivo = join(pasta, nome);
      writeFileSync(resultado.arquivo, `${plano.linhas.join("\n")}\n`, "utf8");
    }
  } else {
    const lido = await lerLigacao(db, direto, args, agora);
    resultado.itens = lido.itens.length;
    resultado.erros.push(...lido.plano.erros);
    resultado.ligados = lido.plano.ligar.length;
    resultado.ja_ligados = lido.plano.ja_ligados;
    if (args.executar && !resultado.erros.length && lido.plano.ligar.length) {
      try {
        const gravado = await runIdempotent<{ ligados: number }>(
          db,
          {
            kind: OPERACAO,
            scope: { tabela: args.tabela, cliente: args.cliente },
            idempotency_key: `${args.tabela}:${args.cliente}`,
            input: { tabela: args.tabela, cliente: args.cliente },
            actor: ator(args),
          },
          async (transaction, { operationId }) => {
            // Tudo de novo dentro da transação, antes de qualquer escrita.
            const naTransacao = await lerLigacao(db, { get: (query) => transaction.get(query), doc: (ref) => transaction.get(ref) }, args, agora);
            if (naTransacao.plano.erros.length) throw new ErroDeEstado(naTransacao.plano.erros);
            for (const ligacao of naTransacao.plano.ligar) {
              transaction.update(db.collection(BILLING_PRICE_LIST).doc(ligacao.doc_id), {
                lpu_item_id: ligacao.lpu_item_id,
                updated_by: "carga-armazenagem",
                updated_at: FieldValue.serverTimestamp(),
              });
            }
            createComercialEvent(transaction, db, {
              operation_id: operationId,
              type: "price_table.wms_linked",
              entity_id: args.tabela as string,
              customer_code: args.cliente,
              payload: { tabela_id: args.tabela as string, variante: normalizarVariante(VARIANTE_DA_ARMAZENAGEM), itens: naTransacao.plano.ligar.length },
              actor: ator(args),
            });
            return { target_id: args.tabela as string, result: { ligados: naTransacao.plano.ligar.length } };
          },
        );
        resultado.replayed = gravado.replayed === true;
        resultado.gravou = !resultado.replayed;
        resultado.ligados = gravado.ligados;
      } catch (erro) {
        if (erro instanceof ErroDeEstado) resultado.erros.push(...erro.erros);
        else if (erro instanceof HttpsError && erro.code === "already-exists") resultado.erros.push("Esta ligação já foi feita com outro conteúdo.");
        else throw erro;
      }
    }
  }

  resultado.ok = resultado.erros.length === 0;
  log(`Armazenagem de ${args.cliente}: ${args.modo}${args.modo === "ligar" ? (args.executar ? ", executar" : ", dry-run") : ""}, projeto ${args.projeto}`);
  log(`Itens da cobrança (sem o ad valorem): ${resultado.itens}`);
  if (resultado.arquivo) {
    log(`Arquivo: ${resultado.arquivo}`);
    log(
      `Próximo passo: node functions/comercial/lib/cargas/tabela.js --arquivo ${resultado.arquivo} --nome "Armazenagem ${args.cliente}" ` +
        `--variante ${VARIANTE_DA_ARMAZENAGEM} --cliente "${args.cliente}" --vigente-de AAAA-MM-DD --projeto ${args.projeto}`,
    );
  }
  if (args.modo === "ligar") log(`A ligar: ${resultado.ligados}; já ligados: ${resultado.ja_ligados}`);
  for (const erro of resultado.erros) log(`Erro: ${erro}`);
  if (!resultado.ok) log("Resultado: nada gravado (corrija os erros acima).");
  else if (resultado.gravou) log("Resultado: gravado.");
  else if (args.modo === "ligar" && !args.executar) log("Resultado: nada gravado (dry-run). Para gravar: --executar.");
  return resultado;
}

export async function main(argv: readonly string[]): Promise<number> {
  try {
    return (await rodarArmazenagem(argv)).ok ? 0 : 1;
  } catch (erro) {
    if (erro instanceof ErroDaArmazenagem) {
      console.error(`Erro: ${erro.message}`);
      console.error(USO);
      return 2;
    }
    console.error(erro);
    return 1;
  } finally {
    await Promise.all(getApps().map((app) => deleteApp(app)));
  }
}

function executadoDireto(): boolean {
  const script = process.argv[1];
  if (!script) return false;
  const chamado = resolve(script);
  const este = fileURLToPath(import.meta.url);
  return process.platform === "win32" ? chamado.toLowerCase() === este.toLowerCase() : chamado === este;
}

if (executadoDireto()) {
  void main(process.argv.slice(2)).then((codigo) => {
    process.exitCode = codigo;
  });
}
