import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { ArrowDown, ArrowUp, CalendarClock, Check, Copy, FileText, Loader2, MessageCircle, MessagesSquare, PanelLeftClose, PanelLeftOpen, Paperclip, Plus, Search, Sparkles, X } from "lucide-react";

import type { ChatMessage, ChatResponse } from "@/components/agent/chat";
import { DraftCard } from "@/components/agent/draft-card";
import { RoutinesPage, useRoutines } from "@/components/agent/routines";
import { AgentMarkdown } from "@/components/agent/markdown";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import {
  agentView,
  filterConversations,
  groupConversations,
  newConversationId,
  settleStreamingMarkdown,
  toolLabel,
  uniqueTools,
  type AgentView,
  type ConversationSummary,
  type Suggestion,
} from "@/lib/agent-chat";
import { chaveNoAlvo } from "@/lib/agente/cliente";
import { useClienteDoAgente } from "@/lib/agente/contexto";
import { useAppUser } from "@/lib/auth";
import type { AgentDuteStreamChunk } from "@/lib/functions-api";
import { isUnreadRoutine, markSeen, routineHistory, type RoutineHistoryItem } from "@/lib/agent-routines";
import { ATTACHMENT_ACCEPT, ATTACHMENT_LIMIT_HINT, isAcceptedAttachment, prepareAttachment, uploadAttachment } from "@/lib/shipment-files";
import type { ClientRequestAttachment } from "@/pages/client/shared";
import { cn } from "@/lib/utils";

/**
 * Agent Dute em tela inteira, como um ChatGPT dentro do sistema. A mesma tela
 * para todos os papéis (portal do cliente e equipe Dutelog). À esquerda, a
 * barra com Nova conversa, Rotinas e WhatsApp (em breve), as conversas
 * recentes e, embaixo, o histórico das rotinas. No centro, a conversa (a
 * resposta chega aos pedaços, com as consultas que o agente fez), a tela de
 * Rotinas (?v=rotinas) ou a do WhatsApp (?v=whatsapp). O agente só lê:
 * pedidos e mudanças continuam nas telas próprias.
 */

type ConversationsResponse = { conversations: ConversationSummary[] };

type Streaming = {
  conversationId: string;
  question: string;
  /** Nomes das notas anexadas nesta pergunta. */
  files: string[];
  tools: string[];
  runningTool: string | null;
  text: string;
  /** Mensagem do modelo a que o texto pertence; muda depois de uma consulta. */
  textIndex: number;
};

const conversationsKey = ["agent-dute-conversations"] as const;

/** Nota anexada no campo do chat: sobe assim que é escolhida. */
type PendingFile = { key: string; name: string; status: "uploading" | "ready" | "error"; attachment?: ClientRequestAttachment };

/** Clipe do chat (só portal do cliente): a nota sobe pelo mesmo caminho do Envios. */
type AttachControls = {
  files: PendingFile[];
  onAttach: (list: FileList | null) => void;
  onRemove: (key: string) => void;
};

const MAX_CHAT_FILES = 3;
const RAIL_KEY = "dute.agent.rail";

/** Barra lateral aberta ou recolhida (só ícones), lembrado neste navegador. */
function useRailCollapsed() {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem(RAIL_KEY) === "collapsed";
    } catch {
      return false;
    }
  });
  const change = (next: boolean) => {
    setCollapsed(next);
    try {
      window.localStorage.setItem(RAIL_KEY, next ? "collapsed" : "open");
    } catch {
      // Sem storage: vale só nesta visita.
    }
  };
  return [collapsed, change] as const;
}
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
  const view = agentView(search);
  const conversationId = view === "chat" ? params.get("c") : null;
  const askedFromOutside = params.get("q");
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState<Streaming | null>(null);
  const [mobileRail, setMobileRail] = useState(false);
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [railCollapsed, setRailCollapsed] = useRailCollapsed();
  const abortRef = useRef<AbortController | null>(null);
  const agente = useClienteDoAgente();
  // A nota anexada vai no aviso de envio: só o cliente, na conversa da Armazenagem.
  const canAttach = user?.publicMetadata.role === "cliente" && (agente.alvo.tipo === "wms" || agente.alvo.modulo === "wms");
  const conversationsQueryKey = chaveNoAlvo(agente, conversationsKey);
  const chatQueryKey = (id: string) => chaveNoAlvo(agente, messagesKey(id));

  function attachFiles(list: FileList | null) {
    if (!list) return;
    const chosen = [...list];
    const accepted = chosen.filter(isAcceptedAttachment).slice(0, Math.max(0, MAX_CHAT_FILES - files.length));
    if (accepted.length !== chosen.length) {
      toast({ title: "Alguns arquivos ficaram de fora", description: `Use PDF ou foto, ${ATTACHMENT_LIMIT_HINT} cada e ${MAX_CHAT_FILES} por mensagem.`, variant: "destructive" });
    }
    for (const file of accepted) {
      const key = `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 8)}`;
      setFiles((current) => [...current, { key, name: file.name, status: "uploading" }]);
      // Scan grande é reduzido no navegador antes de subir (attachment-compact.ts).
      prepareAttachment(file)
        .then((ready) => uploadAttachment(ready, `chat_${conversationId ?? "novo"}`))
        .then((attachment) =>
          setFiles((current) => current.map((item) => (item.key === key ? { ...item, status: "ready", attachment } : item))),
        )
        .catch((error: unknown) => {
          setFiles((current) => current.map((item) => (item.key === key ? { ...item, status: "error" } : item)));
          toast({
            title: `Não consegui anexar ${file.name}`,
            description: error instanceof Error ? error.message : "Tente de novo.",
            variant: "destructive",
          });
        });
    }
  }

  const attach: AttachControls | undefined = canAttach
    ? { files, onAttach: attachFiles, onRemove: (key) => setFiles((current) => current.filter((item) => item.key !== key)) }
    : undefined;

  const conversations = useQuery<ConversationsResponse, Error>({
    queryKey: conversationsQueryKey,
    queryFn: () => agente.conversas(),
  });
  const chat = useQuery<ChatResponse, Error>({
    queryKey: chatQueryKey(conversationId ?? ""),
    queryFn: () => agente.mensagens(conversationId ?? ""),
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

  function openView(next: Exclude<AgentView, "chat">) {
    setMobileRail(false);
    navigate(`${basePath}?v=${next}`);
  }

  async function send(content: string, options: { fresh?: boolean } = {}) {
    if (files.some((file) => file.status === "uploading")) return;
    const sentFiles = files.filter((file) => file.status === "ready" && file.attachment);
    const attachments = sentFiles.map((file) => file.attachment!);
    const question = content.trim() || (attachments.length ? "Segue a nota fiscal em anexo." : "");
    if (!question || streaming) return;
    const current = options.fresh ? null : conversationId;
    const id = current ?? newConversationId();
    if (!current) navigate(`${basePath}?c=${encodeURIComponent(id)}`, { replace: Boolean(options.fresh) });
    setDraft("");
    setFiles([]);
    setStreaming({ conversationId: id, question, files: sentFiles.map((file) => file.name), tools: [], runningTool: null, text: "", textIndex: -1 });
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
      const result = await agente.conversar(
        { message: question, conversation_id: id, ...(attachments.length ? { attachments } : {}) },
        onChunk,
        controller.signal,
      );
      queryClient.setQueryData<ChatResponse>(chatQueryKey(id), (previous) => ({
        conversation: result.conversation ?? previous?.conversation,
        messages: [...(previous?.messages ?? []), ...(result.messages ?? [])],
      }));
      await queryClient.invalidateQueries({ queryKey: conversationsQueryKey });
    } catch (error) {
      setDraft(content);
      setFiles(sentFiles);
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

  const routines = useRoutines();
  const list = conversations.data?.conversations ?? [];
  const history = routineHistory(list, routines.data?.routines ?? []);
  const active = list.find((item) => item.id === conversationId);
  const activeTitle = active?.title;
  // Abriu a conversa de uma rotina: a resposta que chegou conta como lida.
  useEffect(() => {
    if (active?.routine_id) markSeen(active.id, active.last_message_at);
  }, [active?.id, active?.last_message_at]);
  const messages = conversationId ? (chat.data?.messages ?? []) : [];
  const showingStream = streaming && streaming.conversationId === conversationId ? streaming : null;
  const empty = !conversationId || (!chat.isLoading && messages.length === 0 && !showingStream);
  const title =
    view === "rotinas"
      ? "Rotinas"
      : view === "whatsapp"
        ? "WhatsApp"
        : empty
          ? "Agent Dute"
          : activeTitle || showingStream?.question || firstQuestion(messages) || "Conversa";

  const rail = (collapsed: boolean) => (
    <AgentRail
      conversations={list.filter((item) => !item.routine_id)}
      history={history}
      loading={conversations.isLoading}
      view={view}
      activeId={conversationId}
      onOpen={openConversation}
      onView={openView}
      collapsed={collapsed}
      onToggle={() => setRailCollapsed(!railCollapsed)}
    />
  );

  return (
    <main className="flex h-full min-h-0 w-full overflow-hidden bg-card">
      <div className={cn("hidden shrink-0 border-r border-border/70 bg-background md:flex", railCollapsed ? "w-[60px]" : "w-[264px]")}>
        {rail(railCollapsed)}
      </div>
      <Sheet open={mobileRail} onOpenChange={setMobileRail}>
        <SheetContent side="left" className="w-[300px] p-0">
          <SheetTitle className="sr-only">Conversas</SheetTitle>
          {rail(false)}
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
          <h1 className="min-w-0 flex-1 truncate text-base font-semibold">{title}</h1>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </header>

        {view === "rotinas" ? (
          <RoutinesPage role={user?.publicMetadata.role} onOpenConversation={(id) => openConversation(id)} />
        ) : view === "whatsapp" ? (
          <WhatsAppSoon />
        ) : empty ? (
          <Welcome
            name={firstName(user?.fullName)}
            suggestions={suggestions}
            intro={intro}
            placeholder={placeholder}
            disabled={Boolean(streaming)}
            draft={draft}
            onDraft={setDraft}
            onSend={send}
            attach={attach}
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
            attach={attach}
          />
        )}
      </section>

    </main>
  );
}

function RailButton({
  icon,
  label,
  active,
  collapsed,
  onClick,
  badge,
}: {
  icon: ReactNode;
  label: string;
  active: boolean;
  collapsed: boolean;
  onClick: () => void;
  badge?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={collapsed ? (badge ? `${label} (${badge})` : label) : undefined}
      aria-label={collapsed ? label : undefined}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-2.5 rounded-lg text-sm text-foreground/85 hover:bg-muted",
        collapsed ? "h-10 w-10 justify-center" : "w-full px-2.5 py-2",
        active && "bg-muted font-semibold text-foreground",
      )}
    >
      <span className="shrink-0 text-muted-foreground [&>svg]:h-[18px] [&>svg]:w-[18px]">{icon}</span>
      {collapsed ? null : <span className="min-w-0 flex-1 truncate text-left">{label}</span>}
      {!collapsed && badge ? <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">{badge}</span> : null}
    </button>
  );
}

function AgentRail({
  conversations,
  history,
  loading,
  view,
  activeId,
  onOpen,
  onView,
  collapsed,
  onToggle,
}: {
  conversations: ConversationSummary[];
  history: RoutineHistoryItem[];
  loading: boolean;
  view: AgentView;
  activeId: string | null;
  onOpen: (id: string | null) => void;
  onView: (view: Exclude<AgentView, "chat">) => void;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const [query, setQuery] = useState("");
  const groups = groupConversations(filterConversations(conversations, query), new Date());
  const unreadHistory = history.some((item) => item.id !== activeId && isUnreadRoutine(item));
  const nav = (
    <>
      <RailButton icon={<Plus />} label="Nova conversa" active={view === "chat" && !activeId} collapsed={collapsed} onClick={() => onOpen(null)} />
      <RailButton icon={<CalendarClock />} label="Rotinas" active={view === "rotinas"} collapsed={collapsed} onClick={() => onView("rotinas")} />
      <RailButton icon={<MessageCircle />} label="WhatsApp" badge="em breve" active={view === "whatsapp"} collapsed={collapsed} onClick={() => onView("whatsapp")} />
    </>
  );

  if (collapsed) {
    return (
      <div className="flex h-full w-full flex-col items-center gap-1 py-3">
        <button type="button" onClick={onToggle} aria-label="Abrir a barra" title="Abrir a barra" className="mb-2 grid h-9 w-9 place-items-center rounded-lg text-muted-foreground hover:bg-muted">
          <PanelLeftOpen className="h-4 w-4" />
        </button>
        {nav}
        {unreadHistory ? <span className="mt-1 h-2 w-2 rounded-full bg-agent" aria-label="Resposta nova de rotina" /> : null}
      </div>
    );
  }

  const item = (id: string, label: string, unread: boolean, title?: string) => (
    <button
      key={id}
      type="button"
      onClick={() => onOpen(id)}
      title={title ?? label}
      className={cn(
        "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-foreground/80 hover:bg-muted",
        id === activeId && "bg-muted font-semibold text-foreground",
      )}
    >
      {id !== activeId && unread ? <span className="h-2 w-2 shrink-0 rounded-full bg-agent" aria-label="Resposta nova" /> : null}
      <span className="truncate">{label}</span>
    </button>
  );

  return (
    <div className="flex min-h-0 w-full flex-col gap-0.5 px-3 py-3">
      <div className="mb-1 flex justify-end">
        <button type="button" onClick={onToggle} aria-label="Recolher a barra" title="Recolher a barra" className="hidden h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted md:grid">
          <PanelLeftClose className="h-4 w-4" />
        </button>
      </div>
      {nav}
      <label className="my-2 flex items-center gap-2 rounded-lg border border-border/70 bg-card px-2.5 py-1.5 text-sm text-muted-foreground">
        <Search className="h-4 w-4 shrink-0" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar conversas"
          className="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground"
        />
      </label>
      <nav aria-label="Conversas recentes" className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <p className="px-2 py-3 text-sm text-muted-foreground">Carregando…</p>
        ) : groups.length === 0 ? (
          <p className="px-2 py-3 text-sm text-muted-foreground">{query ? "Nenhuma conversa encontrada." : "Suas conversas aparecem aqui."}</p>
        ) : (
          groups.map((group) => (
            <div key={group.label} className="mb-2">
              <p className="px-2 pb-1 pt-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{group.label}</p>
              {group.items.map((conversation) => item(conversation.id, conversation.title, false))}
            </div>
          ))
        )}
      </nav>
      {history.length ? (
        <nav aria-label="Histórico das rotinas" className="max-h-[34%] shrink-0 overflow-y-auto border-t border-border/70 pt-1">
          <p className="px-2 pb-1 pt-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Histórico das rotinas</p>
          {history.map((entry) => item(entry.id, entry.label, isUnreadRoutine(entry)))}
        </nav>
      ) : null}
    </div>
  );
}

function WhatsAppSoon() {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 overflow-y-auto px-6 pb-10 text-center">
      <span className="grid h-14 w-14 place-items-center rounded-2xl bg-success-soft text-success-soft-foreground">
        <MessageCircle className="h-7 w-7" aria-hidden="true" />
      </span>
      <span className="rounded-full bg-success-soft px-2.5 py-0.5 text-xs font-semibold text-success-soft-foreground">Em breve</span>
      <h2 className="text-xl font-semibold tracking-tight">Agent Dute no WhatsApp</h2>
      <p className="max-w-md text-sm text-muted-foreground">
        Você vai poder falar com o Agent Dute pelo WhatsApp, com as mesmas consultas de estoque, pedidos e entregas. As conversas do WhatsApp vão aparecer aqui, junto com as do portal.
      </p>
    </div>
  );
}

function AgentMark({ size = "sm" }: { size?: "sm" | "lg" }) {
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center bg-gradient-to-br from-agent-start to-agent-accent text-white",
        size === "lg" ? "h-14 w-14 rounded-2xl" : "h-8 w-8 rounded-md",
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
  attach,
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: (value: string) => void;
  disabled: boolean;
  placeholder: string;
  autoFocus?: boolean;
  attach?: AttachControls;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const files = attach?.files ?? [];
  const uploading = files.some((file) => file.status === "uploading");
  const hasFile = files.some((file) => file.status === "ready");
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 200)}px`;
  }, [value]);
  const canSend = (value.trim().length > 0 || hasFile) && !uploading && !disabled;
  return (
    <div className="rounded-lg border border-border bg-card px-4 pb-2.5 pt-3 focus-within:border-primary/40">
      {files.length ? (
        <ul className="mb-2 flex flex-wrap gap-1.5">
          {files.map((file) => (
            <li
              key={file.key}
              className={cn(
                "inline-flex max-w-full items-center gap-1.5 rounded-lg border px-2 py-1 text-xs",
                file.status === "error" ? "border-destructive-soft-border bg-destructive-soft text-destructive-soft-foreground" : "border-border bg-muted/50",
              )}
            >
              {file.status === "uploading" ? (
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" />
              ) : (
                <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              )}
              <span className="max-w-[220px] truncate">{file.name}</span>
              {file.status === "uploading" ? <span className="text-muted-foreground">enviando…</span> : null}
              {file.status === "error" ? <span>não anexou</span> : null}
              <button type="button" aria-label={`Tirar ${file.name}`} onClick={() => attach?.onRemove(file.key)} className="text-muted-foreground hover:text-foreground">
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
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
        className="block max-h-[200px] w-full resize-none bg-transparent text-base leading-6 outline-none placeholder:text-muted-foreground"
      />
      <div className={cn("mt-1.5 flex items-center", attach ? "justify-between" : "justify-end")}>
        {attach ? (
          <>
            <input
              ref={fileInput}
              type="file"
              accept={ATTACHMENT_ACCEPT}
              multiple
              className="hidden"
              onChange={(event) => {
                attach.onAttach(event.target.files);
                event.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              disabled={disabled || files.length >= MAX_CHAT_FILES}
              aria-label="Anexar nota fiscal"
              title="Anexar nota fiscal (PDF ou foto)"
              className="grid h-9 w-9 place-items-center rounded-xl text-muted-foreground hover:bg-muted disabled:opacity-40"
            >
              <Paperclip className="h-4 w-4" />
            </button>
          </>
        ) : null}
        <button
          type="button"
          disabled={!canSend}
          onClick={() => onSend(value)}
          aria-label="Enviar"
          className={cn(
            "grid h-9 w-9 place-items-center rounded-xl transition-colors",
            canSend ? "bg-foreground text-background hover:bg-foreground/85" : "bg-muted text-muted-foreground",
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
  attach,
}: {
  name: string;
  suggestions: Suggestion[];
  intro: string;
  placeholder: string;
  disabled: boolean;
  draft: string;
  onDraft: (value: string) => void;
  onSend: (value: string) => void;
  attach?: AttachControls;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-4 pb-10 pt-6">
      <AgentMark size="lg" />
      <h2 className="mt-4 text-center text-2xl font-semibold tracking-tight md:text-3xl">
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
          attach={attach}
        />
      </div>
      <div className="mt-4 grid w-full max-w-[720px] gap-2.5 sm:grid-cols-2">
        {suggestions.map((suggestion) => (
          <button
            key={suggestion.prompt}
            type="button"
            disabled={disabled}
            onClick={() => onSend(suggestion.prompt)}
            className="rounded-2xl border border-border/80 bg-card px-4 py-3 text-left text-sm transition-colors hover:border-primary/40 hover:bg-primary/[0.03] disabled:opacity-60"
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
  attach,
}: {
  messages: ChatMessage[];
  loading: boolean;
  streaming: Streaming | null;
  draft: string;
  onDraft: (value: string) => void;
  onSend: (value: string) => void;
  busy: boolean;
  attach?: AttachControls;
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
              <UserMessage key={message.id} files={(message.attachments ?? []).map((file) => file.file_name)}>
                {message.content}
              </UserMessage>
            ) : (
              <AssistantMessage
                key={message.id}
                id={message.id}
                tools={message.tools_used}
                content={message.content}
                draft={message.draft}
                draftSent={message.draft_sent}
              />
            ),
          )}
          {streaming ? (
            <>
              <UserMessage files={streaming.files}>{streaming.question}</UserMessage>
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
          className="absolute bottom-[150px] left-1/2 grid h-9 w-9 -translate-x-1/2 place-items-center rounded-full border border-border bg-card shadow-md"
          aria-label="Ir para o fim"
        >
          <ArrowDown className="h-4 w-4" />
        </button>
      ) : null}
      <div className="shrink-0 px-4 pb-4 md:px-7">
        <div className="mx-auto w-full max-w-[780px]">
          <Composer value={draft} onChange={onDraft} onSend={onSend} disabled={busy} placeholder="Responder…" attach={attach} />
          <p className="mt-2 text-center text-xs text-muted-foreground">
            O Agent Dute monta pedidos para você conferir; quem envia é você. Confira as informações importantes.
          </p>
        </div>
      </div>
    </>
  );
}

function UserMessage({ children, files = [] }: { children: ReactNode; files?: string[] }) {
  return (
    <div className="mb-5 mt-1 flex flex-col items-end gap-1.5">
      {files.length ? (
        <ul className="flex max-w-[80%] flex-wrap justify-end gap-1.5">
          {files.map((name, index) => (
            <li key={`${name}-${index}`} className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-border bg-card px-2 py-1 text-xs">
              <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="truncate">{name}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="max-w-[80%] whitespace-pre-wrap rounded-lg rounded-br-md bg-muted px-4 py-2.5 text-base leading-6">
        {children}
      </div>
    </div>
  );
}

function AssistantMessage({
  id,
  content,
  tools,
  runningTool,
  draft,
  draftSent,
  streaming = false,
}: {
  id?: string;
  content: string;
  tools?: string[];
  draft?: unknown;
  draftSent?: unknown;
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
                    <Loader2 className="h-3 w-3 animate-spin text-agent-accent" />
                  ) : (
                    <Check className="h-3 w-3 text-success-soft-foreground" />
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
        {!streaming && draft ? <DraftCard value={draft} messageId={id} sent={draftSent} /> : null}
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
