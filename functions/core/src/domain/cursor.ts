import { FieldPath, Timestamp, type Firestore, type QueryDocumentSnapshot } from "firebase-admin/firestore";

/**
 * O cursor das rotinas da memória (`ai_cursors/{rotina}`), como o da rotina
 * dos avisos: cada rotina lê os eventos dos tipos dela depois do cursor, em
 * ordem de gravação, e marca o último que leu.
 *
 * - Só entra o evento gravado há mais de um minuto, para nenhum ficar antes do
 *   cursor por causa do serverTimestamp.
 * - Na primeira vez (sem cursor), não lê evento: a rotina refaz com o
 *   histórico que existe e o cursor parte do limite.
 */

export const AI_CURSORS_COLLECTION = "ai_cursors";
export const EVENTS_COLLECTION = "events";

export const ESPERA_DO_EVENTO_MS = 60_000;
export const LOTE_DE_EVENTOS = 200;

export type CursorGravado = { created_at: Timestamp; evento_id: string };

export type LoteDoCursor = {
  /** Sem cursor: a rotina refaz com o histórico. */
  primeira: boolean;
  eventos: QueryDocumentSnapshot[];
  /** O cursor depois do lote; null quando não há evento novo. */
  proximo: CursorGravado | null;
};

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

export async function lerLoteDoCursor(db: Firestore, rotina: string, tipos: readonly string[], instante: Date): Promise<LoteDoCursor> {
  const limite = Timestamp.fromMillis(instante.getTime() - ESPERA_DO_EVENTO_MS);
  const cursor = await db.collection(AI_CURSORS_COLLECTION).doc(rotina).get();
  const createdAt = cursor.get("created_at");
  if (!(cursor.exists && createdAt instanceof Timestamp)) return { primeira: true, eventos: [], proximo: { created_at: limite, evento_id: "" } };

  const ordenados = db
    .collection(EVENTS_COLLECTION)
    .where("type", "in", [...tipos])
    .where("created_at", "<=", limite)
    .orderBy("created_at", "asc")
    .orderBy(FieldPath.documentId(), "asc");
  const eventoId = texto(cursor.get("evento_id"));
  // Sem o id (o cursor de começo), parte do instante: o que foi gravado nele também fica antes.
  const depois = eventoId ? ordenados.startAfter(createdAt, eventoId) : ordenados.startAfter(createdAt);
  const lote = await depois.limit(LOTE_DE_EVENTOS).get();
  const ultimo = lote.docs.at(-1);
  const ultimoCriado = ultimo?.get("created_at");
  if (!ultimo || !(ultimoCriado instanceof Timestamp)) return { primeira: false, eventos: [], proximo: null };
  return { primeira: false, eventos: lote.docs, proximo: { created_at: ultimoCriado, evento_id: ultimo.id } };
}

export async function marcarCursor(db: Firestore, rotina: string, proximo: CursorGravado, instante: Date): Promise<void> {
  await db.collection(AI_CURSORS_COLLECTION).doc(rotina).set({ ...proximo, atualizado_em: instante.toISOString() });
}
