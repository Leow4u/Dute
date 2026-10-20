import { FieldValue, type Firestore } from "firebase-admin/firestore";

/**
 * Resumo de conversa longa do Agent Dute (ideia do context compression do
 * Hermes Agent). O agente lê as últimas WINDOW mensagens; o que ficou para
 * trás vira um resumo guardado na própria conversa (agent_conversations),
 * atualizado quando pelo menos BATCH mensagens antigas ainda não estão nele.
 * O resumo só usa o que a própria pessoa conversou, nunca outra conversa.
 */

export const SUMMARY_WINDOW = 20;
const BATCH = 10;
const MAX_MESSAGES = 200;
const MAX_SUMMARY = 2000;

export type SummaryMessage = { role: "user" | "assistant"; content: string; created_at: string };
export type Summarizer = (previous: string, messages: SummaryMessage[]) => Promise<string>;

type Scope = { conversationId: string; customerCode: string; userId: string };

/** Resumo atual da conversa, se houver (texto já limitado). */
export async function conversationSummary(db: Firestore, input: Scope) {
  const snapshot = await db.collection("agent_conversations").doc(input.conversationId).get();
  const data = snapshot.data();
  if (!data || data.user_id !== input.userId || data.customer_code !== input.customerCode) return "";
  return typeof data.summary === "string" ? data.summary.slice(0, MAX_SUMMARY) : "";
}

/**
 * Atualiza o resumo se houver mensagens antigas suficientes fora dele.
 * Devolve true quando gravou um resumo novo. Falha do resumidor não grava nada.
 */
export async function refreshConversationSummary(db: Firestore, input: Scope, summarize: Summarizer) {
  const conversationRef = db.collection("agent_conversations").doc(input.conversationId);
  const conversation = (await conversationRef.get()).data();
  if (!conversation || conversation.user_id !== input.userId || conversation.customer_code !== input.customerCode) return false;

  const snapshot = await db
    .collection("agent_messages")
    .where("conversation_id", "==", input.conversationId)
    .where("customer_code", "==", input.customerCode)
    .where("user_id", "==", input.userId)
    .orderBy("created_at_iso", "desc")
    .limit(MAX_MESSAGES)
    .get();
  const messages: SummaryMessage[] = snapshot.docs
    .map((doc) => {
      const data = doc.data();
      return {
        role: data.role === "assistant" ? ("assistant" as const) : ("user" as const),
        content: String(data.content ?? ""),
        created_at: String(data.created_at_iso ?? ""),
      };
    })
    .sort((left, right) => left.created_at.localeCompare(right.created_at) || (left.role === "user" ? -1 : 1));
  if (messages.length <= SUMMARY_WINDOW) return false;

  const older = messages.slice(0, messages.length - SUMMARY_WINDOW);
  const upTo = typeof conversation.summary_upto_iso === "string" ? conversation.summary_upto_iso : "";
  const pending = older.filter((message) => message.created_at > upTo);
  if (pending.length < BATCH) return false;

  const previous = typeof conversation.summary === "string" ? conversation.summary : "";
  const summary = (await summarize(previous, pending)).trim().slice(0, MAX_SUMMARY);
  if (!summary) return false;
  await conversationRef.update({
    summary,
    summary_upto_iso: pending[pending.length - 1]!.created_at,
    summary_updated_at: FieldValue.serverTimestamp(),
  });
  return true;
}

/** Texto enviado ao modelo para resumir (o resumo anterior + as mensagens novas). */
export function summaryPrompt(previous: string, messages: SummaryMessage[]) {
  const lines = messages.map((message) => `${message.role === "user" ? "Pessoa" : "Agent Dute"}: ${message.content.slice(0, 1500)}`);
  return [
    "Atualize o resumo desta conversa com o Agent Dute (assistente logístico da Dutelog).",
    "Guarde só o que serve para continuar a conversa: o que a pessoa quer, números de pedido e aviso (PED-, ENV-), itens, quantidades, datas, decisões e pendências.",
    "Português do Brasil, no máximo 12 linhas com '- '. Não invente nada que não esteja abaixo.",
    "",
    `Resumo até agora:\n${previous || "(vazio)"}`,
    "",
    `Mensagens novas:\n${lines.join("\n")}`,
  ].join("\n");
}
