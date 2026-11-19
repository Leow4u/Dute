import type { Firestore } from "firebase-admin/firestore";
import { Timestamp } from "firebase-admin/firestore";

import { ZAP_ACCESS_COLLECTION, ZAP_CONVERSATIONS_COLLECTION, ZAP_MESSAGES_COLLECTION } from "./colecoes.js";

/**
 * Prazo das conversas, mensagens e do registro de acesso. Muda aqui.
 * A rotina só corre nos ambientes de RETENCAO_AMBIENTES_LIBERADOS: hoje a
 * homologação. A produção não apaga (docs/plataforma/lgpd.md).
 */
export const ZAP_RETENCAO_DIAS = 180;

const DIA_MS = 86_400_000;
const LOTE = 200;
const RODADAS = 20;

export function instanteLimite(agora: Date, dias = ZAP_RETENCAO_DIAS): Date {
  if (!Number.isInteger(dias) || dias < 1) throw new Error("Prazo de retenção inválido.");
  return new Date(agora.getTime() - dias * DIA_MS);
}

export async function runZapRetentionFor(db: Firestore, agora = new Date()): Promise<{ messages: number; conversations: number; access: number }> {
  const limite = instanteLimite(agora);
  const messages = await apagarAntigos(db, ZAP_MESSAGES_COLLECTION, "occurred_at", limite);
  const conversations = await apagarAntigos(db, ZAP_CONVERSATIONS_COLLECTION, "last_message_at", limite);
  const access = await apagarAntigos(db, ZAP_ACCESS_COLLECTION, "at", limite);
  return { messages, conversations, access };
}

async function apagarAntigos(db: Firestore, colecao: string, campo: string, limite: Date): Promise<number> {
  const quando = Timestamp.fromDate(limite);
  let total = 0;
  for (let rodada = 0; rodada < RODADAS; rodada += 1) {
    const snap = await db.collection(colecao).where(campo, "<", quando).orderBy(campo, "asc").limit(LOTE).get();
    if (snap.empty) break;
    const lote = db.batch();
    for (const documento of snap.docs) lote.delete(documento.ref);
    await lote.commit();
    total += snap.size;
    if (snap.size < LOTE) break;
  }
  return total;
}
