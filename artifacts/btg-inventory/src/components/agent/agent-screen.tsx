import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { ArrowDown, ArrowUp, Check, Copy, Loader2, MessagesSquare, Plus, Search, Sparkles } from "lucide-react";

import { fetchChatJson, type ChatMessage, type ChatResponse } from "@/components/agent/chat";
import { DraftCard } from "@/components/agent/draft-card";
import { AgentMarkdown } from "@/components/agent/markdown";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import {
  filterConversations,
  groupConversations,
  newConversationId,
  settleStreamingMarkdown,
  toolLabel,
  uniqueTools,
  type ConversationSummary,
  type Suggestion,
} from "@/lib/agent-chat";
import { useAppUser } from "@/lib/auth";
import { streamAgentDuteChat, type AgentDuteStreamChunk } from "@/lib/functions-api";
import { cn } from "@/lib/utils";

/**
 * Agent Dute em tela inteira, como um ChatGPT dentro do sistema. A mesma tela
 * para todos os papéis (portal do cliente e equipe Dutelog): à esquerda as
 * conversas da pessoa; no centro a conversa, com a resposta chegando aos
 * pedaços e as consultas que o agente fez. O agente só lê: pedidos e
 * mudanças continuam nas telas próprias.
 */

type ConversationsResponse = { conversations: ConversationSummary[] };

type Streaming = {
  conversationId: string;
  question: string;
  tools: string[];
  runningTool: string | null;
  text: string;
  /** Mensagem do modelo a que o texto pertence; muda depois de uma consulta. */
  textIndex: number;
};

const conversationsKey = ["agent-dute-conversations"] as const;
const messagesKey = (id: string) => ["agent-dute-chat", id] as const;

function firstQuestion(messages: ChatMessage[]) {
  return messages.find((message) => message.role === "user")?.content.slice(0, 90);
}

function firstName(name: string | undefined) {
  return (name ?? "").trim().split(/\s+/)[0] || "";
}

export type AgentScreenProps = {
  /** Rota da tela: /portal/agente (cliente) ou /agente (equipe). */
  basePath: string;
  suggestions: Suggestion[];
  /** Frase sob o "Como posso ajudar?". */
  intro: string;
  placeholder: string;
  /** Atalhos no topo (ex.: Painel do agente). */
  actions?: ReactNode;
};

export function AgentScreen({ basePath, suggestions, intro, placeholder, actions }: AgentScreenProps) {
  const { user } = useAppUser();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const conversationId = params.get("c");
  const askedFromOutside = params.get("q");
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState<Streaming | null>(null);
  const [mobileRail, setMobileRail] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const conversations = useQuery<ConversationsResponse, Error>({
    queryKey: conversationsKey,
    queryFn: () => fetchChatJson<ConversationsResponse>("/api/agent-dute/conversations"),
  });
  const chat = useQuery<ChatResponse, Error>({
    queryKey: messagesKey(conversationId ?? ""),
    queryFn: () =>
      fetchChatJson<ChatResponse>(`/api/agent-dute/chat?conversation_id=${encodeURIComponent(conversationId ?? "")}`),
    enabled: Boolean(conversationId),
  });

  useEffect(() => () => abortRef.current?.abort(), []);

  // Pergunta vinda da barra do Início (?q=): abre uma conversa nova e envia.
  const handledQuestion = useRef<string | null>(null);
  useEffect(() => {
    if (!askedFromOutside || streaming || handledQuestion.current === askedFromOutside) return;
    handledQuestion.current = askedFromOutside;
    void send(askedFromOutside, { fresh: true });
  }, [askedFromOutside]);

  function openConversation(id: string | null) {
    setMobileRail(false);
    if (streaming) return;
    navigate(id ? `${basePath}?c=${encodeURIComponent(id)}` : basePath);
  }

  async function send(content: string, options: { fresh?: boolean } = {}) {
    const question = content.trim();
    if (!question || streaming) return;
    const current = options.fresh ? null : conversationId;
    const id = current ?? newConversationId();
    if (!current) navigate(`${basePath}?c=${encodeURIComponent(id)}`, { replace: Boolean(options.fresh) });
    setDraft("");
    setStreaming({ conversationId: id, question, tools: [], runningTool: null, text: "", textIndex: -1 });
    const controller = new AbortController();
    abortRef.current = controller;
    const onChunk = (chunk: AgentDuteStreamChunk) => {
      setStreaming((current) => {
        if (!current) return current;
        if (chunk.type === "reset") return { ...current, tools: [], runningTool: null, text: "", textIndex: -1 };
        if (chunk.type === "tool") {
          return {
            ...current,
            tools: current.tools.includes(chunk.name) ? current.tools : [...current.tools, chunk.name],
            runningTool: chunk.name,
          };
        }
        // Texto antes de uma consulta ("vou verificar…") é trocado pelo da resposta final.
        const text = chunk.index === current.textIndex ? current.text + chunk.text : chunk.text;
        return { ...current, runningTool: null, text, textIndex: chunk.index };
      });
    };
    try {
      const result = await streamAgentDuteChat<ChatResponse>(
        { message: question, conversation_id: id },
        onChunk,
        controller.signal,
      );
      queryClient.setQueryData<ChatResponse>(messagesKey(id), (previous) => ({
        conversation: result.conversation ?? previous?.conversation,
        messages: [...(previous?.messages ?? []), ...(result.messages ?? [])],
      }));
      await queryClient.invalidateQueries({ queryKey: conversationsKey });
    } catch (error) {
      setDraft(question);
      toast({
        title: "Não consegui enviar agora",
        description: error instanceof Error ? error.message : "Tente de novo em instantes.",
        variant: "destructive",
      });
    } finally {
      setStreaming(null);
      abortRef.current = null;
    }
  }

  const list = conversations.data?.conversations ?? [];
  const activeTitle = list.find((item) => item.id === conversationId)?.title;
  const messages = conversationId ? (chat.data?.messages ?? []) : [];
  const showingStream = streaming && streaming.conversationId === conversationId ? streaming : null;
  const empty = !conversationId || (!chat.isLoading && messages.length === 0 && !showingStream);

  const rail = (
    <ConversationRail
      conversations={list}
      loading={conversations.isLoading}
      activeId={conversationId}
      onOpen={openConversation}
    />
  );

  return (
    <main className="flex h-full min-h-0 w-full overflow-hidden bg-white">
      <div className="hidden w-[264px] shrink-0 border-r border-border/70 bg-[#fbfbfa] md:flex">{rail}</div>
      <Sheet open={mobileRail} onOpenChange={setMobileRail}>
        <SheetContent side="left" className="w-[300px] p-0">
          <SheetTitle className="sr-only">Conversas</SheetTitle>
          {rail}
        </SheetContent>
      </Sheet>

      <section className="relative flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border/60 px-4 md:px-7">
          <button
            type="button"
            className="grid h-9 w-9 place-items-center rounded-lg text-muted-foreground hover:bg-muted md:hidden"
            onClick={() => setMobileRail(true)}
            aria-label="Conversas"
          >
            <MessagesSquare className="h-5 w-5" />
          </button>
          <h1 className="min-w-0 flex-1 truncate text-[15px] font-semibold">{empty ? "Agent Dute" : activeTitle || showingStream?.question || firstQuestion(messages) || "Conversa"}</h1>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </header>

        {empty ? (
          <Welcome
            name={firstName(user?.fullName)}
            suggestions={suggestions}
            intro={intro}
            placeholder={placeholder}
            disabled={Boolean(streaming)}
            draft={draft}
            onDraft={setDraft}
            onSend={send}
          />
        ) : (
          <Conversation
            messages={messages}
            loading={chat.isLoading}
            streaming={showingStream}
            draft={draft}
            onDraft={setDraft}
            onSend={send}
            busy={Boolean(streaming)}
          />
        )}
      </section>
    </main>
  );
}

function ConversationRail({
  conversations,
  loading,
  activeId,
  onOpen,
}: {
  conversations: ConversationSummary[];
  loading: boolean;
  activeId: string | null;
  onOpen: (id: string | null) => void;
}) {
  const [query, setQuery] = useState("");
  const groups = groupConversations(filterConversations(conversations, query), new Date());
  return (
    <div className="flex min-h-0 w-full flex-col gap-1 px-3 py-4">
      <Button type="button" variant="outline" className="mb-2 h-10 rounded-xl bg-white font-semibold" onClick={() => onOpen(null)}>
        <Plus className="h-4 w-4" />
        Nova conversa
      </Button>
      <label className="mb-2 flex items-center gap-2 rounded-lg border border-border/70 bg-white px-2.5 py-1.5 text-sm text-muted-foreground">
        <Search className="h-4 w-4 shrink-0" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar conversas"
          className="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground"
        />
      </label>
      <nav className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <p className="px-2 py-3 text-sm text-muted-foreground">Carregando…</p>
        ) : groups.length === 0 ? (
          <p className="px-2 py-3 text-sm text-muted-foreground">
            {query ? "Nenhuma conversa encontrada." : "Suas conversas aparecem aqui."}
          </p>
        ) : (
          groups.map((group) => (
            <div key={group.label} className="mb-2">
              <p className="px-2 pb-1 pt-3 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
                {group.label}
              </p>
              {group.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onOpen(item.id)}
                  title={item.title}
                  className={cn(
                    "block w-full truncate rounded-lg px-2.5 py-2 text-left text-[13.5px] text-foreground/80 hover:bg-muted",
                    item.id === activeId && "bg-muted font-semibold text-foreground",
                  )}
                >
                  {item.title}
                </button>
              ))}
            </div>
          ))
        )}
      </nav>
    </div>
  );
}

function AgentMark({ size = "sm" }: { size?: "sm" | "lg" }) {
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center bg-gradient-to-br from-[#5b7cfa] to-[#8b5cf6] text-white",
        size === "lg" ? "h-14 w-14 rounded-2xl" : "h-8 w-8 rounded-[10px]",
      )}
    >
      <Sparkles className={size === "lg" ? "h-7 w-7" : "h-4 w-4"} aria-hidden="true" />
    </span>
  );
}

function Composer({
  value,
  onChange,
  onSend,
  disabled,
  placeholder,
  autoFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: (value: string) => void;
  disabled: boolean;
  placeholder: string;
  autoFocus?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 200)}px`;
  }, [value]);
  const canSend = value.trim().length > 0 && !disabled;
  return (
    <div className="rounded-[22px] border border-border bg-white px-4 pb-2.5 pt-3 shadow-[0_6px_24px_rgba(30,40,70,.06)] focus-within:border-primary/40">
      <textarea
        ref={ref}
        rows={1}
        autoFocus={autoFocus}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            if (canSend) onSend(value);
          }
        }}
        placeholder={placeholder}
        data-agent-input
        className="block max-h-[200px] w-full resize-none bg-transparent text-[15px] leading-6 outline-none placeholder:text-muted-foreground"
      />
      <div className="mt-1.5 flex items-center justify-end">
        <button
          type="button"
          disabled={!canSend}
          onClick={() => onSend(value)}
          aria-label="Enviar"
          className={cn(
            "grid h-9 w-9 place-items-center rounded-xl transition-colors",
            canSend ? "bg-foreground text-white hover:bg-foreground/85" : "bg-muted text-muted-foreground",
          )}
        >
          {disabled ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}

function Welcome({
  name,
  suggestions,
  intro,
  placeholder,
  disabled,
  draft,
  onDraft,
  onSend,
}: {
  name: string;
  suggestions: Suggestion[];
  intro: string;
  placeholder: string;
  disabled: boolean;
  draft: string;
  onDraft: (value: string) => void;
  onSend: (value: string) => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-4 pb-10 pt-6">
      <AgentMark size="lg" />
      <h2 className="mt-4 text-center text-2xl font-semibold tracking-tight md:text-[28px]">
        {name ? `Olá, ${name}. Como posso ajudar?` : "Como posso ajudar?"}
      </h2>
      <p className="mt-1.5 max-w-xl text-center text-sm text-muted-foreground">
        {intro}
      </p>
      <div className="mt-7 w-full max-w-[720px]">
        <Composer
          value={draft}
          onChange={onDraft}
          onSend={onSend}
          disabled={disabled}
          autoFocus
          placeholder={placeholder}
        />
      </div>
      <div className="mt-4 grid w-full max-w-[720px] gap-2.5 sm:grid-cols-2">
        {suggestions.map((suggestion) => (
          <button
            key={suggestion.prompt}
            type="button"
            disabled={disabled}
            onClick={() => onSend(suggestion.prompt)}
            className="rounded-2xl border border-border/80 bg-white px-4 py-3 text-left text-sm transition-colors hover:border-primary/40 hover:bg-primary/[0.03] disabled:opacity-60"
          >
            <span className="block">{suggestion.prompt}</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">{suggestion.hint}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function Conversation({
  messages,
  loading,
  streaming,
  draft,
  onDraft,
  onSend,
  busy,
}: {
  messages: ChatMessage[];
  loading: boolean;
  streaming: Streaming | null;
  draft: string;
  onDraft: (value: string) => void;
  onSend: (value: string) => void;
  busy: boolean;
}) {
  const viewport = useRef<HTMLDivElement | null>(null);
  const pinned = useRef(true);
  const [awayFromBottom, setAwayFromBottom] = useState(false);
  const ordered = useMemo(
    () =>
      [...messages].sort(
        (left, right) =>
          String(left.created_at ?? "").localeCompare(String(right.created_at ?? "")) ||
          (left.role === right.role ? 0 : left.role === "user" ? -1 : 1),
      ),
    [messages],
  );

  function scrollToBottom(behavior: ScrollBehavior = "auto") {
    const element = viewport.current;
    if (element) element.scrollTo({ top: element.scrollHeight, behavior });
  }

  useEffect(() => {
    if (pinned.current) scrollToBottom();
  }, [ordered.length, streaming?.text, streaming?.tools.length, streaming?.question]);

  useEffect(() => {
    pinned.current = true;
  }, [streaming?.question]);

  return (
    <>
      <div
        ref={viewport}
        className="min-h-0 flex-1 overflow-y-auto"
        onScroll={(event) => {
          const element = event.currentTarget;
          const away = element.scrollHeight - element.scrollTop - element.clientHeight > 120;
          pinned.current = !away;
          setAwayFromBottom(away);
        }}
      >
        <div className="mx-auto w-full max-w-[780px] px-4 pb-6 pt-6 md:px-7">
          {loading && !streaming ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando a conversa…
            </p>
          ) : null}
          {ordered.map((message) =>
            message.role === "user" ? (
              <UserMessage key={message.id}>{message.content}</UserMessage>
            ) : (
              <AssistantMessage key={message.id} tools={message.tools_used} content={message.content} draft={message.draft} />
            ),
          )}
          {streaming ? (
            <>
              <UserMessage>{streaming.question}</UserMessage>
              <AssistantMessage
                tools={streaming.tools}
                runningTool={streaming.runningTool}
                content={streaming.text}
                streaming
              />
            </>
          ) : null}
        </div>
      </div>
      {awayFromBottom ? (
        <button
          type="button"
          onClick={() => {
            pinned.current = true;
            scrollToBottom("smooth");
          }}
          className="absolute bottom-[150px] left-1/2 grid h-9 w-9 -translate-x-1/2 place-items-center rounded-full border border-border bg-white shadow-md"
          aria-label="Ir para o fim"
        >
          <ArrowDown className="h-4 w-4" />
        </button>
      ) : null}
      <div className="shrink-0 px-4 pb-4 md:px-7">
        <div className="mx-auto w-full max-w-[780px]">
          <Composer value={draft} onChange={onDraft} onSend={onSend} disabled={busy} placeholder="Responder…" />
          <p className="mt-2 text-center text-[11.5px] text-muted-foreground">
            O Agent Dute consulta, mas não faz pedidos nem altera dados. Confira as informações importantes.
          </p>
        </div>
      </div>
    </>
  );
}

function UserMessage({ children }: { children: ReactNode }) {
  return (
    <div className="mb-5 mt-1 flex justify-end">
      <div className="max-w-[80%] whitespace-pre-wrap rounded-[18px] rounded-br-md bg-muted px-4 py-2.5 text-[15px] leading-6">
        {children}
      </div>
    </div>
  );
}

function AssistantMessage({
  content,
  tools,
  runningTool,
  draft,
  streaming = false,
}: {
  content: string;
  tools?: string[];
  draft?: unknown;
  runningTool?: string | null;
  streaming?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const names = uniqueTools(tools);
  return (
    <div className="mb-7 flex gap-3">
      <AgentMark />
      <div className="min-w-0 flex-1 pt-0.5">
        {names.length ? (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {names.map((name) => {
              const running = streaming && name === runningTool;
              return (
                <span
                  key={name}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-muted/50 px-2.5 py-0.5 text-xs text-muted-foreground"
                >
                  {running ? (
                    <Loader2 className="h-3 w-3 animate-spin text-[#8b5cf6]" />
                  ) : (
                    <Check className="h-3 w-3 text-emerald-600" />
                  )}
                  {toolLabel(name, running)}
                </span>
              );
            })}
          </div>
        ) : null}
        {content ? (
          <div className={cn(streaming && "agent-streaming")}>
            <AgentMarkdown content={streaming ? settleStreamingMarkdown(content) : content} />
          </div>
        ) : streaming ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {names.length ? "Organizando a resposta…" : "Pensando…"}
          </p>
        ) : null}
        {!streaming && draft ? <DraftCard value={draft} /> : null}
        {!streaming && content ? (
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(content).then(() => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1500);
              });
            }}
            className="mt-1.5 inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:bg-muted"
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "Copiado" : "Copiar"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
