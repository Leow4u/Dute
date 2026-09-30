import { Bot, Clock3, UserRound } from "lucide-react";

import { cn } from "@/lib/utils";

// Peças do chat com o Agent Dute usadas pelo portal do cliente e pelo botão
// flutuante das telas internas. A conversa é a mesma: um histórico por
// usuário, lido de agent_messages e escrito pela callable chatWithAgentDute.

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

function cleanAssistantInline(text: string) {
  return text
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#{1,6}\s+/, "")
    .trim();
}

function AssistantMessageContent({ content }: { content: string }) {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const blocks: Array<
    | { type: "paragraph"; text: string }
    | { type: "heading"; text: string }
    | { type: "list"; items: string[] }
  > = [];

  for (const rawLine of lines) {
    const bulletMatch = rawLine.match(/^[-*]\s+(.*)$/);
    if (bulletMatch) {
      const item = cleanAssistantInline(bulletMatch[1]);
      const previous = blocks[blocks.length - 1];
      if (previous?.type === "list") {
        previous.items.push(item);
      } else {
        blocks.push({ type: "list", items: [item] });
      }
      continue;
    }

    const line = cleanAssistantInline(rawLine);
    const isShortHeading =
      line.endsWith(":") && line.length <= 80 && !line.includes(".");

    blocks.push({
      type: isShortHeading ? "heading" : "paragraph",
      text: isShortHeading ? line.replace(/:$/, "") : line,
    });
  }

  return (
    <div className="space-y-3 text-sm leading-6">
      {blocks.map((block, index) => {
        if (block.type === "heading") {
          return (
            <p key={`${block.type}-${index}`} className="font-medium">
              {block.text}
            </p>
          );
        }

        if (block.type === "list") {
          return (
            <ul key={`${block.type}-${index}`} className="space-y-2 pl-1">
              {block.items.map((item, itemIndex) => (
                <li key={`${item}-${itemIndex}`} className="flex gap-2">
                  <span className="mt-[0.65rem] h-1.5 w-1.5 shrink-0 rounded-full bg-primary/60" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          );
        }

        return <p key={`${block.type}-${index}`}>{block.text}</p>;
      })}
    </div>
  );
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
          <AssistantMessageContent content={message.content} />
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
