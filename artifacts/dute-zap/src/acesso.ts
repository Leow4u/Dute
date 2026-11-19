import { httpsCallable } from "firebase/functions";

import { functions } from "./firebase";

/** Falha do registro não esconde a conversa: a regra do Firestore já limitou a leitura. */
export function registrarAcesso(action: "entered" | "opened", conversationId?: string): void {
  if (!functions) return;
  const call = httpsCallable(functions, "registrarAcessoZap");
  const dados = action === "opened" ? { action, conversation_id: conversationId } : { action };
  void call(dados).catch(() => undefined);
}
