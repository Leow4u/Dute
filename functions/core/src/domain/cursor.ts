import { FieldPath, Timestamp, type DocumentSnapshot, type Firestore, type Query, type QueryDocumentSnapshot } from "firebase-admin/firestore";

/**
 * O cursor das rotinas da memória (`ai_cursors/{rotina}`), como o da rotina
 * dos avisos: cada rotina lê os documentos dela depois do cursor, em ordem de
 * gravação, e marca o último que leu.
 *
 * - Só entra o documento gravado há mais de um minuto, para nenhum ficar antes
 *   do cursor por causa do serverTimestamp.
 * - Os eventos: na primeira vez (sem cursor), não lê evento; a rotina refaz
 *   com o histórico que existe e o cursor parte do limite.
 * - Os movimentos do estoque (parte 5.4a): sem cursor, ou com o de outra
 *   versão da rotina, lê do começo, porque o histórico é o próprio razão.
 */

export const AI_CURSORS_COLLECTION = "ai_cursors";
export const EVENTS_COLLECTION = "events";
export const MOVEMENTS_COLLECTION = "movements";

export const ESPERA_DO_EVENTO_MS = 60_000;
export const LOTE_DE_EVENTOS = 200;
export const LOTE_DE_MOVIMENTOS = 300;

/** O último documento lido; `evento_id` guarda o id dele, evento ou movimento. */
export type CursorGravado = { created_at: Timestamp; evento_id: string; versao?: number };

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
  const lote = await depoisDoCursor(ordenados, cursor).limit(LOTE_DE_EVENTOS).get();
  const proximo = cursorDoLote(lote.docs);
  return { primeira: false, eventos: proximo ? lote.docs : [], proximo };
}

export type LoteDeMovimentos = {
  movimentos: QueryDocumentSnapshot[];
  /** O cursor depois do lote, com a versão da rotina; null quando não há movimento novo. */
  proximo: CursorGravado | null;
};

/**
 * O lote do razão do estoque (`movements`) depois do cursor, só com os
 * campos pedidos. Sem cursor, ou com o cursor de outra versão, lê do começo:
 * a rotina que muda o que guarda sobe a versão e relê o razão inteiro.
 */
export async function lerLoteDeMovimentos(db: Firestore, rotina: string, versao: number, instante: Date, campos: readonly string[]): Promise<LoteDeMovimentos> {
  const limite = Timestamp.fromMillis(instante.getTime() - ESPERA_DO_EVENTO_MS);
  const cursor = await db.collection(AI_CURSORS_COLLECTION).doc(rotina).get();
  const doComeco = !(cursor.exists && cursor.get("created_at") instanceof Timestamp && cursor.get("versao") === versao);
  const ordenados = db
    .collection(MOVEMENTS_COLLECTION)
    .where("created_at", "<=", limite)
    .orderBy("created_at", "asc")
    .orderBy(FieldPath.documentId(), "asc")
    .select(...new Set([...campos, "created_at"]));
  const lote = await (doComeco ? ordenados : depoisDoCursor(ordenados, cursor)).limit(LOTE_DE_MOVIMENTOS).get();
  const proximo = cursorDoLote(lote.docs);
  return { movimentos: proximo ? lote.docs : [], proximo: proximo ? { ...proximo, versao } : null };
}

function depoisDoCursor(ordenados: Query, cursor: DocumentSnapshot): Query {
  const createdAt = cursor.get("created_at") as Timestamp;
  const documentoId = texto(cursor.get("evento_id"));
  // Sem o id (o cursor de começo), parte do instante: o que foi gravado nele também fica antes.
  return documentoId ? ordenados.startAfter(createdAt, documentoId) : ordenados.startAfter(createdAt);
}

function cursorDoLote(docs: readonly QueryDocumentSnapshot[]): CursorGravado | null {
  const ultimo = docs.at(-1);
  const ultimoCriado = ultimo?.get("created_at");
  return ultimo && ultimoCriado instanceof Timestamp ? { created_at: ultimoCriado, evento_id: ultimo.id } : null;
}

export async function marcarCursor(db: Firestore, rotina: string, proximo: CursorGravado, instante: Date): Promise<void> {
  await db.collection(AI_CURSORS_COLLECTION).doc(rotina).set({ ...proximo, atualizado_em: instante.toISOString() });
}
