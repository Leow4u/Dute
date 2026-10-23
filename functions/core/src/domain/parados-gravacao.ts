import { createHash } from "node:crypto";

import type { Firestore, QueryDocumentSnapshot } from "firebase-admin/firestore";

import { LOTE_DE_MOVIMENTOS, lerLoteDeMovimentos, marcarCursor } from "./cursor.js";
import { semInstante } from "./estavel.js";
import { instanteValido, marcarMovimento, sentidoDoMovimento, type RelogioDoItem, type SentidoDoMovimento } from "./parados.js";

/**
 * A rotina dos dias parado (docs/plataforma/fase-5-memoria.md, parte 5.4a).
 * Lê o razão do estoque (`movements`) depois do cursor e refaz, em
 * `ai_stock_age`, o item de cada movimento: o relógio (a primeira e a última
 * entrada e a última saída que contam) e o saldo, lido de `stock_balances`.
 * Não grava a idade nem a etiqueta: a regra do modelo do cliente vale na hora,
 * com o dia de hoje, na tela e no alerta (lib/dominio/src/parados.ts).
 *
 * - O relógio guarda só o menor e o maior instante: o resultado não depende
 *   da ordem dos movimentos nem de ler um deles duas vezes.
 * - Todo movimento relê o saldo, até o que não conta no relógio (a guarda, a
 *   contagem cíclica, o estorno da abertura).
 * - O item é o par cliente e SKU: o mesmo código em dois clientes são dois itens.
 * - Na primeira vez, ou quando VERSAO_DOS_PARADOS sobe, lê o razão do começo.
 */

export const AI_STOCK_AGE_COLLECTION = "ai_stock_age";
export const STOCK_BALANCES_COLLECTION = "stock_balances";
export const CURSOR_DOS_PARADOS = "parados";

/** Sobe quando o que o item guarda muda: a rotina relê o razão inteiro. */
export const VERSAO_DOS_PARADOS = 1;

/** Os lotes de cada vez da rotina: até 3.000 movimentos a cada 15 minutos. */
const LOTES_POR_VEZ = 10;
/** Os itens refeitos ao mesmo tempo, cada um com a consulta do saldo. */
const ITENS_POR_VEZ = 25;

const CAMPOS_DO_MOVIMENTO = [
  "customer_code",
  "cod_cliente",
  "sku_code",
  "cod_sku",
  "client_item_code",
  "product_name",
  "source",
  "tipo_mov",
  "occurred_at",
  "data",
] as const;

export type ItemParado = {
  tipo: "item";
  customer_code: string;
  sku_code: string;
  client_item_code: string | null;
  product_name: string | null;
  /** A soma de `qty_on_hand` do item em todas as posições. */
  saldo: number;
  relogio: RelogioDoItem;
  calculada_em: string;
};

export type ResultadoDosParados = { movimentos: number; itens: number; gravados: number };

export type MovimentoLido = {
  customer_code: string;
  sku_code: string;
  client_item_code: string | null;
  product_name: string | null;
  /** null para o movimento que só muda o saldo. */
  sentido: SentidoDoMovimento | null;
  em: string | null;
};

type Registro = Record<string, unknown>;

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

export function idDoItemParado(customerCode: string, skuCode: string): string {
  return `item_${createHash("sha256").update(JSON.stringify([customerCode, skuCode])).digest("hex").slice(0, 24)}`;
}

/** O movimento do razão; null sem cliente ou sem SKU. Lê também os nomes antigos dos campos. */
export function movimentoLido(dados: Registro): MovimentoLido | null {
  const customerCode = texto(dados.customer_code) || texto(dados.cod_cliente);
  const skuCode = texto(dados.sku_code) || texto(dados.cod_sku);
  if (!customerCode || !skuCode) return null;
  return {
    customer_code: customerCode,
    sku_code: skuCode,
    client_item_code: texto(dados.client_item_code) || null,
    product_name: texto(dados.product_name) || null,
    sentido: sentidoDoMovimento(dados.source, dados.tipo_mov),
    em: instanteValido(dados.occurred_at) ?? instanteValido(dados.data),
  };
}

function relogioGravado(valor: unknown): RelogioDoItem {
  const registro = valor && typeof valor === "object" ? (valor as Registro) : {};
  return {
    primeira_entrada: instanteValido(registro.primeira_entrada),
    ultima_entrada: instanteValido(registro.ultima_entrada),
    ultima_saida: instanteValido(registro.ultima_saida),
  };
}

/**
 * O item depois dos movimentos dele no lote, a partir do que estava gravado.
 * O código e o nome são os do movimento mais novo que os tem.
 */
export function itemDepoisDosMovimentos(atual: Registro | null, movimentos: readonly MovimentoLido[], saldo: number, calculadaEm: string): ItemParado | null {
  const [primeiro] = movimentos;
  if (!primeiro) return null;
  let relogio = relogioGravado(atual?.relogio);
  for (const movimento of movimentos) if (movimento.sentido) relogio = marcarMovimento(relogio, movimento.sentido, movimento.em);
  const maisNovo = (campo: "client_item_code" | "product_name") =>
    movimentos.reduce<string | null>((achado, movimento) => movimento[campo] ?? achado, null) ?? (texto(atual?.[campo]) || null);
  return {
    tipo: "item",
    customer_code: primeiro.customer_code,
    sku_code: primeiro.sku_code,
    client_item_code: maisNovo("client_item_code"),
    product_name: maisNovo("product_name"),
    saldo,
    relogio,
    calculada_em: calculadaEm,
  };
}

/** Os movimentos do lote por item, na ordem do razão. */
function movimentosPorItem(docs: readonly QueryDocumentSnapshot[]): Map<string, MovimentoLido[]> {
  const porItem = new Map<string, MovimentoLido[]>();
  for (const doc of docs) {
    const movimento = movimentoLido(doc.data());
    if (!movimento) continue;
    const id = idDoItemParado(movimento.customer_code, movimento.sku_code);
    porItem.set(id, [...(porItem.get(id) ?? []), movimento]);
  }
  return porItem;
}

/** O saldo do item: a soma das posições dele, só do mesmo cliente. */
async function saldoDoItem(db: Firestore, customerCode: string, skuCode: string): Promise<number> {
  const saldos = await db.collection(STOCK_BALANCES_COLLECTION).where("customer_code", "==", customerCode).where("sku_code", "==", skuCode).select("qty_on_hand").get();
  return saldos.docs.reduce((total, doc) => {
    const quantidade = Number(doc.get("qty_on_hand"));
    return Number.isFinite(quantidade) && quantidade > 0 ? total + quantidade : total;
  }, 0);
}

/** Grava o item novo ou o que mudou. */
async function refazerItens(db: Firestore, porItem: Map<string, MovimentoLido[]>, calculadaEm: string): Promise<number> {
  const itens = [...porItem.entries()].sort(([a], [b]) => a.localeCompare(b));
  let gravados = 0;
  for (let inicio = 0; inicio < itens.length; inicio += ITENS_POR_VEZ) {
    const alvos = itens.slice(inicio, inicio + ITENS_POR_VEZ).map(([id, movimentos]) => ({ ref: db.collection(AI_STOCK_AGE_COLLECTION).doc(id), movimentos }));
    const [atuais, saldos] = await Promise.all([
      db.getAll(...alvos.map(({ ref }) => ref)),
      Promise.all(alvos.map(({ movimentos: [primeiro] }) => (primeiro ? saldoDoItem(db, primeiro.customer_code, primeiro.sku_code) : 0))),
    ]);
    const batch = db.batch();
    let mudaram = 0;
    alvos.forEach(({ ref, movimentos }, indice) => {
      const snapshot = atuais[indice];
      const atual = snapshot?.exists ? (snapshot.data() ?? null) : null;
      const item = itemDepoisDosMovimentos(atual, movimentos, saldos[indice] ?? 0, calculadaEm);
      if (!item || (atual && semInstante(atual) === semInstante(item))) return;
      batch.set(ref, item);
      mudaram += 1;
    });
    if (mudaram) await batch.commit();
    gravados += mudaram;
  }
  return gravados;
}

export async function runStockAgeFor(db: Firestore, opcoes: { agora?: () => Date } = {}): Promise<ResultadoDosParados> {
  const instante = (opcoes.agora ?? (() => new Date()))();
  const resultado: ResultadoDosParados = { movimentos: 0, itens: 0, gravados: 0 };
  for (let vez = 0; vez < LOTES_POR_VEZ; vez += 1) {
    const lote = await lerLoteDeMovimentos(db, CURSOR_DOS_PARADOS, VERSAO_DOS_PARADOS, instante, CAMPOS_DO_MOVIMENTO);
    if (!lote.proximo) break;
    const porItem = movimentosPorItem(lote.movimentos);
    resultado.movimentos += lote.movimentos.length;
    resultado.itens += porItem.size;
    resultado.gravados += await refazerItens(db, porItem, instante.toISOString());
    await marcarCursor(db, CURSOR_DOS_PARADOS, lote.proximo, instante);
    if (lote.movimentos.length < LOTE_DE_MOVIMENTOS) break;
  }
  return resultado;
}
