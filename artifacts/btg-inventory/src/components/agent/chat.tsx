// Tipos e leitura do chat com o Agent Dute (components/agent/agent-screen).
// As mensagens são lidas de agent_messages e escritas pela callable
// chatWithAgentDute.

export type ChatRole = "user" | "assistant";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  created_at?: string | null;
  source?: string | null;
  tools_used?: string[];
  /** Rascunho de pedido ou aviso de envio montado pelo agente (lib/agent-draft). */
  draft?: unknown;
};

export type ChatResponse = {
  conversation?: {
    id: string;
    customer_code?: string;
    status?: string;
    last_message_at?: string;
  };
  messages: ChatMessage[];
};

export async function fetchChatJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "message" in payload
        ? String(payload.message)
        : text;
    throw new Error(message || `HTTP ${response.status}`);
  }

  return payload as T;
}
