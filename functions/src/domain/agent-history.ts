import type { Firestore } from "firebase-admin/firestore";

import { normalize } from "./agent-dute.js";

/**
 * "Conversas anteriores" do Agent Dute: procura no que a própria pessoa já
 * conversou com o agente (ideia do session search do Hermes Agent). Só lê as
 * conversas do mesmo usuário e do mesmo cliente; a conversa atual fica de
 * fora, porque o histórico dela já vai junto na pergunta.
 *
 * Usa os índices que já existem: a lista de conversas da pessoa e, para cada
 * uma, as mensagens dela (as mesmas consultas da tela do agente).
 */

const CONVERSATIONS = 20;
const MESSAGES_PER_CONVERSATION = 30;
const RESULTS = 6;
const SNIPPET = 500;

type Message = { role: "user" | "assistant"; content: string; created_at: string };

function snippet(value: string) {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > SNIPPET ? `${clean.slice(0, SNIPPET)}…` : clean;
}

function words(query: string) {
  return [...new Set(normalize(query).split(/[^a-z0-9.-]+/).filter((word) => word.length >= 3))];
}

export async function searchPastConversations(
  db: Firestore,
  input: { customerCode: string; userId: string; currentConversationId?: string; query: string },
) {
  const terms = words(input.query);
  if (!terms.length) return { encontrados: 0, trechos: [], observacao: "Diga sobre o que procurar (ex.: número do pedido, item, assunto)." };

  const conversations = await db
    .collection("agent_conversations")
    .where("user_id", "==", input.userId)
    .where("customer_code", "==", input.customerCode)
    .orderBy("last_message_at", "desc")
    .limit(CONVERSATIONS + 1)
    .get();

  const others = conversations.docs
    .filter((doc) => doc.id !== input.currentConversationId)
    .slice(0, CONVERSATIONS);

  const perConversation = await Promise.all(
    others.map(async (conversation) => {
      const snapshot = await db
        .collection("agent_messages")
        .where("conversation_id", "==", conversation.id)
        .where("customer_code", "==", input.customerCode)
        .where("user_id", "==", input.userId)
        .orderBy("created_at_iso", "desc")
        .limit(MESSAGES_PER_CONVERSATION)
        .get();
      const messages: Message[] = snapshot.docs
        .map((doc) => {
          const data = doc.data();
          return {
            role: data.role === "assistant" ? ("assistant" as const) : ("user" as const),
            content: String(data.content ?? ""),
            created_at: String(data.created_at_iso ?? ""),
          };
        })
        .sort((left, right) => left.created_at.localeCompare(right.created_at) || (left.role === "user" ? -1 : 1));
      const title = String(conversation.data().title ?? "").trim() || "Conversa";
      // Uma pergunta e a resposta que veio depois dela formam um trecho.
      const hits: Array<{ score: number; conversa: string; quando: string; pergunta: string; resposta: string }> = [];
      messages.forEach((message, index) => {
        if (message.role !== "user") return;
        const answer = messages[index + 1]?.role === "assistant" ? messages[index + 1]!.content : "";
        const haystack = normalize(`${message.content} ${answer}`);
        const score = terms.filter((term) => haystack.includes(term)).length;
        if (!score) return;
        hits.push({ score, conversa: title, quando: message.created_at, pergunta: snippet(message.content), resposta: snippet(answer) });
      });
      return hits;
    }),
  );

  const ranked = perConversation
    .flat()
    .sort((left, right) => right.score - left.score || right.quando.localeCompare(left.quando));
  return {
    encontrados: ranked.length,
    trechos: ranked.slice(0, RESULTS).map(({ score: _score, ...hit }) => hit),
    observacao: ranked.length ? undefined : `Nada encontrado nas últimas ${CONVERSATIONS} conversas.`,
  };
}
