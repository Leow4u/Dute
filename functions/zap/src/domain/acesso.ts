import type { Firestore } from "firebase-admin/firestore";
import { Timestamp } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";

import { ZAP_ACCESS_COLLECTION } from "./colecoes.js";
import { idDeConversaValido } from "./modelo.js";
import type { ZapProfile } from "./profile.js";

/**
 * Registro de quem olhou. Não guarda texto, nome de contato nem telefone
 * solto: a conversa aberta fica no id, que a administração já pode ler.
 * A tela chama uma vez ao entrar e uma vez ao abrir a conversa.
 */

const ACOES = ["entered", "opened"] as const;
type Acao = (typeof ACOES)[number];

export async function registrarAcessoZapFor(db: Firestore, perfil: ZapProfile, data: unknown, agora = new Date()): Promise<{ id: string }> {
  const corpo = data && typeof data === "object" ? (data as { action?: unknown; conversation_id?: unknown }) : {};
  const action = acao(corpo.action);
  if (!action) throw new HttpsError("invalid-argument", "Ação inválida.");
  let conversationId: string | undefined;
  if (action === "opened") {
    if (!idDeConversaValido(corpo.conversation_id)) throw new HttpsError("invalid-argument", "Conversa inválida.");
    conversationId = corpo.conversation_id;
  }
  const ref = db.collection(ZAP_ACCESS_COLLECTION).doc();
  await ref.set({
    uid: perfil.uid,
    role: perfil.role,
    action,
    ...(conversationId ? { conversation_id: conversationId } : {}),
    at: Timestamp.fromDate(agora),
  });
  return { id: ref.id };
}

function acao(valor: unknown): Acao | null {
  return valor === "entered" || valor === "opened" ? valor : null;
}
