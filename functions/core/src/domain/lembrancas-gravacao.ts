import type { Firestore, QueryDocumentSnapshot } from "firebase-admin/firestore";

import { lerLoteDoCursor, marcarCursor } from "./cursor.js";
import { semInstante } from "./estavel.js";
import {
  AI_CASE_MEMORY_COLLECTION,
  ETAPAS_FECHADAS,
  etapaFechada,
  lembrancaDaDemanda,
  osDoCaso,
  revisaoLida,
  rvsDaDemanda,
  type LembrancaDoCaso,
  type OsDoCaso,
} from "./lembrancas.js";

/**
 * A rotina das lembranças (docs/plataforma/fase-5-memoria.md, parte 5.3a).
 * Lê os eventos depois do cursor, como a das medidas, e refaz a lembrança de
 * cada demanda que eles tocam a partir da demanda como ela está agora: a
 * demanda fechada ganha a lembrança; a reaberta perde. O resultado não depende
 * da ordem dos eventos nem de rodar duas vezes. Na primeira vez, refaz as
 * lembranças de todas as demandas fechadas e marca o cursor.
 *
 * O Financeiro leva a demanda de A faturar a faturada e a paga sem
 * `demand.stage_changed`; a lembrança não guarda a etapa, então nada muda
 * nela nesses passos.
 */

export const CURSOR_DAS_LEMBRANCAS = "lembrancas";

/** A mudança de etapa da demanda e a OS revisada ou reaberta (o tempo de trabalho). */
export const EVENTOS_DAS_LEMBRANCAS = ["demand.stage_changed", "os.reviewed", "os.reopened"] as const;

const DEMANDS_COLLECTION = "demands";
const QUOTES_COLLECTION = "quotes";
const REVISOES_SUBCOLLECTION = "revisoes";
const SERVICE_ORDERS_COLLECTION = "service_orders";

/** As demandas refeitas ao mesmo tempo. */
const DEMANDAS_POR_VEZ = 10;

export type ResultadoDasLembrancas = { recalculou: boolean; eventos: number; demandas: number; gravadas: number; apagadas: number };

type Registro = Record<string, unknown>;

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

/** A demanda que o evento toca. A mudança de etapa só conta quando entra ou sai das etapas fechadas. */
export function demandaDoEvento(tipo: unknown, payload: Registro): string | null {
  let numero = "";
  if (tipo === "demand.stage_changed") {
    if (!etapaFechada(payload.etapa_antes) && !etapaFechada(payload.etapa_depois)) return null;
    numero = texto(payload.numero);
  } else if (tipo === "os.reviewed" || tipo === "os.reopened") {
    numero = texto(payload.demanda) || texto(payload.id).split("-")[0];
  }
  return /^\d{5,8}$/.test(numero) ? numero : null;
}

/** A lembrança da demanda como ela está agora; null quando a demanda não existe ou não está fechada. */
export async function lembrancaAtual(db: Firestore, numero: string): Promise<LembrancaDoCaso | null> {
  const snapshot = await db.collection(DEMANDS_COLLECTION).doc(numero).get();
  const demanda = snapshot.data();
  if (!snapshot.exists || !demanda || !etapaFechada(demanda.etapa)) return null;
  const customerCode = texto(demanda.customer_code);

  const rvs = rvsDaDemanda(demanda);
  const lidas = [...new Set([rvs.orcada, rvs.realizada].filter((rv): rv is number => rv !== null))];
  const quote = db.collection(QUOTES_COLLECTION).doc(numero);
  const revisoes = lidas.length ? await db.getAll(...lidas.map((rv) => quote.collection(REVISOES_SUBCOLLECTION).doc(String(rv)))) : [];
  const porRv = new Map(lidas.map((rv, indice) => [rv, revisaoLida(rv, revisoes[indice]?.data() ?? null)]));
  const revisao = (rv: number | null) => (rv === null ? null : (porRv.get(rv) ?? null));

  // Só a OS da demanda e do mesmo cliente: nada de outro cliente entra na lembrança.
  const ordens = (await db.collection(SERVICE_ORDERS_COLLECTION).where("demanda", "==", numero).get()).docs
    .filter((doc) => texto(doc.get("customer_code")) === customerCode)
    .map((doc) => osDoCaso(doc.id, doc.data()))
    .filter((os): os is OsDoCaso => os !== null);
  return lembrancaDaDemanda(numero, demanda, revisao(rvs.orcada), revisao(rvs.realizada), ordens);
}

/** Grava a lembrança nova ou a que mudou; apaga a da demanda que não está mais fechada. */
async function refazer(db: Firestore, numero: string, calculadaEm: string): Promise<"gravada" | "apagada" | null> {
  const ref = db.collection(AI_CASE_MEMORY_COLLECTION).doc(numero);
  const [caso, atual] = await Promise.all([lembrancaAtual(db, numero), ref.get()]);
  if (!caso) {
    if (!atual.exists) return null;
    await ref.delete();
    return "apagada";
  }
  if (atual.exists && semInstante(atual.data() ?? {}) === semInstante(caso)) return null;
  await ref.set({ ...caso, calculada_em: calculadaEm });
  return "gravada";
}

async function demandasDaPrimeiraVez(db: Firestore): Promise<string[]> {
  const [fechadas, existentes] = await Promise.all([
    db.collection(DEMANDS_COLLECTION).where("etapa", "in", [...ETAPAS_FECHADAS]).select().get(),
    db.collection(AI_CASE_MEMORY_COLLECTION).select().get(),
  ]);
  return [...fechadas.docs, ...existentes.docs].map((doc) => doc.id);
}

function demandasDoLote(eventos: readonly QueryDocumentSnapshot[]): string[] {
  return eventos.map((evento) => demandaDoEvento(evento.get("type"), (evento.get("payload") as Registro | undefined) ?? {})).filter((numero): numero is string => numero !== null);
}

export async function runCasesFor(db: Firestore, opcoes: { agora?: () => Date } = {}): Promise<ResultadoDasLembrancas> {
  const instante = (opcoes.agora ?? (() => new Date()))();
  const lote = await lerLoteDoCursor(db, CURSOR_DAS_LEMBRANCAS, EVENTOS_DAS_LEMBRANCAS, instante);
  if (!lote.proximo) return { recalculou: false, eventos: 0, demandas: 0, gravadas: 0, apagadas: 0 };

  const numeros = [...new Set(lote.primeira ? await demandasDaPrimeiraVez(db) : demandasDoLote(lote.eventos))].sort();
  let gravadas = 0;
  let apagadas = 0;
  for (let inicio = 0; inicio < numeros.length; inicio += DEMANDAS_POR_VEZ) {
    const feitos = await Promise.all(numeros.slice(inicio, inicio + DEMANDAS_POR_VEZ).map((numero) => refazer(db, numero, instante.toISOString())));
    gravadas += feitos.filter((feito) => feito === "gravada").length;
    apagadas += feitos.filter((feito) => feito === "apagada").length;
  }
  await marcarCursor(db, CURSOR_DAS_LEMBRANCAS, lote.proximo, instante);
  return { recalculou: true, eventos: lote.eventos.length, demandas: numeros.length, gravadas, apagadas };
}
