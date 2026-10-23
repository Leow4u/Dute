import { FieldPath, Timestamp, type Firestore, type WriteBatch } from "firebase-admin/firestore";

import {
  AI_MEASURES_COLLECTION,
  TIPOS_DE_MEDIDA,
  amostraDaOs,
  aprovacaoDoEvento,
  linhasDaOs,
  medidasDeDuracao,
  medidasDoPlanejado,
  medidasDoPlanejamento,
  medidasDoPrazo,
  planejamentoDaOs,
  type Medida,
} from "./medidas.js";
import { registrarValoresReais } from "./sugestao-gravacao.js";

/**
 * A rotina das medidas (docs/plataforma/fase-5-memoria.md, partes 5.1a e
 * 5.1b). Lê os eventos depois do cursor, como a dos avisos. Quando chega uma
 * OS revisada ou reaberta, ou uma demanda fechada pelo cliente, recalcula as
 * medidas do zero, a partir das OS revisadas e das demandas fechadas: o
 * resultado não depende da ordem dos eventos nem de rodar duas vezes. Na
 * primeira vez, recalcula com o histórico que existe e marca o cursor.
 */

export const AI_CURSORS_COLLECTION = "ai_cursors";
export const CURSOR_DAS_MEDIDAS = "medidas";
export const EVENTS_COLLECTION = "events";
export const SERVICE_ORDERS_COLLECTION = "service_orders";

/**
 * Os eventos que mudam as medidas: a OS revisada entra; a reaberta sai até ser
 * revisada de novo; a demanda fechada pelo cliente entra no prazo de aprovação.
 */
export const EVENTOS_DAS_MEDIDAS = ["os.reviewed", "os.reopened", "demand.won"] as const;

/** Só entra o evento gravado há mais de um minuto, para nenhum ficar antes do cursor (o mesmo da rotina dos avisos). */
export const ESPERA_DO_EVENTO_MS = 60_000;
export const LOTE_DE_EVENTOS = 200;
/** As gravações de um lote do Firestore, com folga para o limite de 500. */
const GRAVACOES_POR_LOTE = 400;

export type ResultadoDasMedidas = {
  recalculou: boolean;
  eventos: number;
  amostras: number;
  medidas: number;
  gravadas: number;
  apagadas: number;
  /** As sugestões que ganharam o valor real, das OS revisadas no lote (parte 5.2a). */
  reais: number;
};

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

/** A medida sem o instante do cálculo: se só ele mudou, a medida não se grava de novo. */
function semInstante(dados: Record<string, unknown>): string {
  const { calculada_em: _instante, ...resto } = dados;
  return JSON.stringify(Object.keys(resto).sort().map((chave) => [chave, resto[chave]]));
}

function semNulos<T>(lista: ReadonlyArray<T | null>): T[] {
  return lista.filter((item): item is T => item !== null);
}

/** Todas as medidas, do zero: as das OS revisadas e a das demandas fechadas pelo cliente. */
async function calcularMedidas(db: Firestore, calculadaEm: string): Promise<{ amostras: number; medidas: Medida[] }> {
  const revisadas = (await db.collection(SERVICE_ORDERS_COLLECTION).where("status", "==", "revisada").get()).docs.map((doc) => [doc.id, doc.data()] as const);
  const fechadas = (await db.collection(EVENTS_COLLECTION).where("type", "==", "demand.won").get()).docs.map((doc) => doc.data());
  const amostras = semNulos(revisadas.map(([numero, dados]) => amostraDaOs(numero, dados)));
  const medidas: Medida[] = [
    ...medidasDeDuracao(amostras, calculadaEm),
    ...medidasDoPlanejamento(semNulos(revisadas.map(([numero, dados]) => planejamentoDaOs(numero, dados))), calculadaEm),
    ...medidasDoPlanejado(semNulos(revisadas.map(([numero, dados]) => linhasDaOs(numero, dados))), calculadaEm),
    ...medidasDoPrazo(semNulos(fechadas.map(aprovacaoDoEvento)), calculadaEm),
  ];
  return { amostras: amostras.length, medidas };
}

/** Grava as medidas novas e as que mudaram e apaga as que não existem mais (a OS reaberta, o item que saiu). */
async function gravarMedidas(db: Firestore, medidas: readonly Medida[]): Promise<{ gravadas: number; apagadas: number }> {
  const existentes = await db.collection(AI_MEASURES_COLLECTION).where("tipo", "in", [...TIPOS_DE_MEDIDA]).get();
  const atuais = new Map(existentes.docs.map((doc) => [doc.id, doc.data()]));
  const novas = new Set(medidas.map((medida) => medida.id));
  const operacoes: Array<(batch: WriteBatch) => void> = [];
  for (const medida of medidas) {
    const atual = atuais.get(medida.id);
    if (atual && semInstante(atual) === semInstante(medida)) continue;
    operacoes.push((batch) => batch.set(db.collection(AI_MEASURES_COLLECTION).doc(medida.id), medida));
  }
  const gravadas = operacoes.length;
  for (const id of atuais.keys()) {
    if (!novas.has(id)) operacoes.push((batch) => batch.delete(db.collection(AI_MEASURES_COLLECTION).doc(id)));
  }
  for (let inicio = 0; inicio < operacoes.length; inicio += GRAVACOES_POR_LOTE) {
    const batch = db.batch();
    for (const operacao of operacoes.slice(inicio, inicio + GRAVACOES_POR_LOTE)) operacao(batch);
    await batch.commit();
  }
  return { gravadas, apagadas: operacoes.length - gravadas };
}

export async function runMeasuresFor(db: Firestore, opcoes: { agora?: () => Date } = {}): Promise<ResultadoDasMedidas> {
  const instante = (opcoes.agora ?? (() => new Date()))();
  const limite = Timestamp.fromMillis(instante.getTime() - ESPERA_DO_EVENTO_MS);
  const cursorRef = db.collection(AI_CURSORS_COLLECTION).doc(CURSOR_DAS_MEDIDAS);
  const cursor = await cursorRef.get();
  const createdAt = cursor.get("created_at");
  const primeira = !(cursor.exists && createdAt instanceof Timestamp);

  let eventos = 0;
  let revisadasNoLote: string[] = [];
  let novoCursor: { created_at: Timestamp; evento_id: string } = { created_at: limite, evento_id: "" };
  if (!primeira) {
    const ordenados = db
      .collection(EVENTS_COLLECTION)
      .where("type", "in", [...EVENTOS_DAS_MEDIDAS])
      .where("created_at", "<=", limite)
      .orderBy("created_at", "asc")
      .orderBy(FieldPath.documentId(), "asc");
    const eventoId = texto(cursor.get("evento_id"));
    // Sem o id (o cursor de começo), parte do instante: o que foi gravado nele também fica antes.
    const depois = eventoId ? ordenados.startAfter(createdAt, eventoId) : ordenados.startAfter(createdAt);
    const lote = await depois.limit(LOTE_DE_EVENTOS).get();
    eventos = lote.size;
    revisadasNoLote = lote.docs.filter((doc) => doc.get("type") === "os.reviewed").map((doc) => texto(doc.get("payload.id"))).filter(Boolean);
    const ultimo = lote.docs.at(-1);
    const ultimoCriado = ultimo?.get("created_at");
    if (!ultimo || !(ultimoCriado instanceof Timestamp)) return { recalculou: false, eventos: 0, amostras: 0, medidas: 0, gravadas: 0, apagadas: 0, reais: 0 };
    novoCursor = { created_at: ultimoCriado, evento_id: ultimo.id };
  }

  const { amostras, medidas } = await calcularMedidas(db, instante.toISOString());
  const { gravadas, apagadas } = await gravarMedidas(db, medidas);
  const reais = await registrarValoresReais(db, revisadasNoLote, instante);
  await cursorRef.set({ ...novoCursor, atualizado_em: instante.toISOString() });
  return { recalculou: true, eventos, amostras, medidas: medidas.length, gravadas, apagadas, reais };
}
