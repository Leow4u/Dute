import { Bot, Clock3, UserRound } from "lucide-react";

import { cn } from "@/lib/utils";

import { AgentMarkdown } from "./markdown";

// Peças do chat com o Agent Dute. O painel flutuante das telas internas usa
// o ChatBubble; o portal do cliente tem a tela própria (pages/client/assistente).
// As mensagens são lidas de agent_messages e escritas pela callable
// chatWithAgentDute.

const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
});

function formatDate(value?: string | null) {
  if (!value) return "sem data";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "sem data";
  return dateFormatter.format(date);
}

export type ChatRole = "user" | "assistant";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  created_at?: string | null;
  source?: string | null;
  tools_used?: string[];
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

export const chatQueryKey = ["agent-dute-chat"] as const;

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

export function ChatBubble({ message }: { message: ChatMessage }) {
  const isAssistant = message.role === "assistant";

  return (
    <div
      className={cn(
        "flex gap-3",
        isAssistant ? "justify-start" : "justify-end",
      )}
    >
      {isAssistant ? (
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary">
          <Bot className="h-4 w-4" aria-hidden="true" />
        </div>
      ) : null}

      <div
        className={cn(
          "min-w-0 max-w-[760px] rounded-[24px] border px-4 py-3 shadow-[0_8px_24px_rgba(15,23,42,.04)] backdrop-blur-[32px]",
          isAssistant
            ? "border-border bg-white/72 text-foreground"
            : "border-primary/20 bg-primary/10 text-foreground",
        )}
      >
        {isAssistant ? (
          <AgentMarkdown content={message.content} className="text-sm leading-6" />
        ) : (
          <div className="whitespace-pre-wrap text-sm leading-6">
            {message.content}
          </div>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <Clock3 className="h-3 w-3" aria-hidden="true" />
          <span>{formatDate(message.created_at)}</span>
        </div>
      </div>

      {!isAssistant ? (
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-border bg-white/70 text-muted-foreground">
          <UserRound className="h-4 w-4" aria-hidden="true" />
        </div>
      ) : null}
    </div>
  );
}
