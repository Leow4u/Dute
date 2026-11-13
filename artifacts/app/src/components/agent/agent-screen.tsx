import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { ArrowDown, ArrowUp, CalendarClock, Check, Copy, FileText, MessageCircle, MessagesSquare, PanelLeftClose, PanelLeftOpen, Paperclip, Plus, Search, Sparkles, X } from "lucide-react";

import type { ChatMessage, ChatResponse } from "@/components/agent/chat";
import { DraftCard } from "@/components/agent/draft-card";
import { RoutinesPage, useRoutines } from "@/components/agent/routines";
import { AgentMarkdown } from "@/components/agent/markdown";
import { FontesDaResposta, TrilhaDoAgente, TrilhaRecolhida, type ConsultaDoAgente } from "@/components/agent/trilha-do-agente";
import { Button } from "@/components/ui/button";
import { CarregandoNaRegiao } from "@/components/ui/carregando-na-regiao";
import { BlocoSemConexao, ErroNaLeitura, useFaltaNaTela } from "@/components/ui/erro-na-leitura";
import { Esqueleto } from "@/components/ui/esqueleto";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { useToast } from "@/hooks/use-toast";
import {
  agentView,
  filterConversations,
  fontesDaResposta,
  groupConversations,
  newConversationId,
  settleStreamingMarkdown,
  uniqueTools,
  type AgentView,
  type ConversationSummary,
  type Suggestion,
} from "@/lib/agent-chat";
import { useAnuncio } from "@/lib/carregando/anunciador";
import { CARREGANDO } from "@/lib/carregando/tempo";
import { useEspera } from "@/lib/carregando/use-espera";
import { useLeituraComFalha } from "@/lib/carregando/use-leitura-com-falha";
import { PRAZO_ESGOTADO, ehFaltaDeConexao, prazoEsgotado } from "@/lib/conexao";
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
  /** O que a pessoa escreveu, que volta ao campo se ela parar de esperar. */
  content: string;
  /** Nomes das notas anexadas nesta pergunta. */
  files: string[];
  /** As notas anexadas, para voltar ao campo e para o "Tentar de novo". */
  sentFiles: PendingFile[];
  /** Cada consulta que o stream informou, na ordem, com as repetidas (a mesma ferramenta chamada de novo é outra consulta). */
  tools: string[];
  /** A consulta da vez (a última de `tools`), ou nulo quando nenhuma está rodando. */
  runningTool: string | null;
  text: string;
  /** Mensagem do modelo a que o texto pertence; muda depois de uma consulta. */
  textIndex: number;
  /** `esperando` enquanto a resposta chega; `sem-resposta` no prazo do chat (180 s), com o "Tentar de novo". */
  estado: "esperando" | "sem-resposta";
  /** A última notícia do servidor (`performance.now()`): o prazo do chat conta daqui. */
  sinalEm: number;
  /** As mensagens que a conversa já tinha quando a pergunta saiu: o "Tentar de novo" relê e vê se a resposta chegou depois. */
  conhecidas: string[];
  /** O "Tentar de novo" relendo a conversa antes de perguntar de novo. */
  relendo: boolean;
};

/** A resposta não chegou no prazo do chat. */
export const SEM_RESPOSTA_DO_AGENTE = "Sem resposta do Agent Dute";

/**
 * As consultas da trilha a partir do stream: as feitas e, por último, a da
 * vez. A mesma ferramenta chamada de novo é uma consulta nova, no fim.
 */
export function consultasDoStream(tools: readonly string[], runningTool: string | null): ConsultaDoAgente[] {
  const ultima = tools.length - 1;
  return tools.map((nome, indice) => ({ nome, estado: indice === ultima && nome === runningTool ? "lendo" : "lida" }));
}

/** A resposta está sendo escrita: o texto chegou e nenhuma consulta está na vez (o texto antes de uma consulta é trocado pelo da resposta). */
function escrevendo(streaming: Pick<Streaming, "text" | "runningTool">): boolean {
  return Boolean(streaming.text) && !streaming.runningTool;
}

/** A resposta desta pergunta foi gravada depois que a espera parou neste aparelho (o servidor continuou). */
function respondidaDepois(mensagens: readonly ChatMessage[], streaming: Pick<Streaming, "question" | "conhecidas">): boolean {
  const conhecidas = new Set(streaming.conhecidas);
  const novas = mensagens.filter((mensagem) => !conhecidas.has(mensagem.id));
  const pergunta = streaming.question.trim();
  return novas.some((mensagem) => mensagem.role === "user" && mensagem.content.trim() === pergunta) && novas.some((mensagem) => mensagem.role === "assistant");
}

/** O campo da conversa, para onde o foco volta quando o botão em que ele estava sai da tela. */
function focarOCampo() {
  document.querySelector<HTMLTextAreaElement>("[data-agent-input]")?.focus();
}

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
const AVISO_DA_CONVERSA = "O Agent Dute monta pedidos para você conferir; quem envia é você. Confira as informações importantes.";
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
  /** Frase sob o "Como posso ajudar?". A tela na v3 (parte 5.5j) não tem: sem legenda. */
  intro?: string;
  /** A linha sob o campo da conversa. A tela na v3 não tem. */
  aviso?: string | null;
  /** O item "WhatsApp (em breve)" da barra. A tela na v3 não tem: é anúncio, não ação. */
  whatsapp?: boolean;
  placeholder: string;
  /** Atalhos no topo (ex.: Painel do agente). */
  actions?: ReactNode;
};

export function AgentScreen({ basePath, suggestions, intro, placeholder, actions, aviso = AVISO_DA_CONVERSA, whatsapp = true }: AgentScreenProps) {
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
  // O campo como está agora, para o que volta a ele (Parar, falha) não apagar o que a pessoa escreveu durante a espera.
  const campoRef = useRef({ draft, files });
  campoRef.current = { draft, files };
  const streamingRef = useRef<Streaming | null>(null);
  streamingRef.current = streaming;
  // A resposta que acabou de chegar nesta tela: as fontes dela entram em 150 ms; as gravadas já estão no lugar.
  const [chegouAgora, setChegouAgora] = useState<string | null>(null);
  // Cada envio tem a sua vez: parar, o prazo e um envio novo encerram a de antes, e o que chega dela não mexe na tela.
  const sendTurn = useRef(0);
  const anunciar = useAnuncio();
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

  // A leitura que falhou fica na tela enquanto tenta de novo: o "Tentar de novo" não some com o foco nele.
  const conversations = useLeituraComFalha(
    useQuery<ConversationsResponse, Error>({
      queryKey: conversationsQueryKey,
      queryFn: () => agente.conversas(),
    }),
  );
  const chat = useLeituraComFalha(
    useQuery<ChatResponse, Error>({
      queryKey: chatQueryKey(conversationId ?? ""),
      queryFn: () => agente.mensagens(conversationId ?? ""),
      enabled: Boolean(conversationId),
    }),
  );

  // Saiu da tela no meio da resposta: a vez acaba aqui, e o corte não vira toast.
  useEffect(
    () => () => {
      sendTurn.current += 1;
      abortRef.current?.abort();
    },
    [],
  );

  const waiting = streaming?.estado === "esperando";
  // O relógio da resposta (momento 9): aos 10 s sem texto, a demora e o Parar.
  const espera = useEspera(waiting, { desisteMs: CARREGANDO.desisteDoAgenteMs });
  const demorando = waiting && !escrevendo(streaming) && (espera.fase === "demorando" || espera.fase === "sem-resposta");

  /** Encerra a vez do envio de agora: o que chegar dele depois não mexe na tela. */
  function endTurn(reason: "parar" | "prazo") {
    sendTurn.current += 1;
    abortRef.current?.abort(reason);
    abortRef.current = null;
  }

  /**
   * O prazo do chat (180 s), contado da última notícia do servidor: a
   * resposta que ainda chega não é cortada, e a function tem o prazo dela
   * (o stream que fecha sem o resultado também vira "Sem resposta"). Sem
   * notícia nesse tempo, a espera para neste aparelho, e a pergunta fica com
   * o "Tentar de novo".
   */
  const prazoDesde = streaming?.estado === "esperando" ? streaming.sinalEm : null;
  useEffect(() => {
    if (prazoDesde === null) return undefined;
    const prazo = window.setTimeout(
      () => {
        endTurn("prazo");
        setStreaming((current) => (current && current.estado === "esperando" ? { ...current, estado: "sem-resposta", runningTool: null } : current));
      },
      Math.max(0, prazoDesde + CARREGANDO.desisteDoAgenteMs - performance.now()),
    );
    return () => window.clearTimeout(prazo);
  }, [prazoDesde]);

  /** A pergunta e as notas voltam ao campo só se a pessoa não escreveu outra coisa nele durante a espera. */
  function devolverAoCampo(content: string, sentFiles: PendingFile[]) {
    const agora = campoRef.current;
    if (agora.draft.trim() || agora.files.length) return;
    setDraft(content);
    setFiles(sentFiles);
  }

  /**
   * Parar: corta a espera só neste aparelho (o agente só lê e não grava nada
   * por causa disso). A pergunta e as notas voltam ao campo, se ele está
   * vazio, e o foco também.
   */
  function stop() {
    const current = streaming;
    if (!current || current.estado !== "esperando") return;
    endTurn("parar");
    setStreaming(null);
    devolverAoCampo(current.content, current.sentFiles);
    window.requestAnimationFrame(focarOCampo);
  }

  /**
   * "Tentar de novo" no prazo do chat. O servidor pode ter continuado e
   * gravado a resposta depois que a espera parou aqui: relê a conversa antes
   * e, se a resposta está lá, mostra ela em vez de perguntar de novo. Se não,
   * a mesma pergunta, com as mesmas notas, sem mexer no campo.
   */
  async function retry() {
    const current = streaming;
    if (!current || current.estado !== "sem-resposta" || current.relendo) return;
    const mesmaEspera = (atual: Streaming | null) => atual !== null && atual.conversationId === current.conversationId && atual.question === current.question && atual.estado === "sem-resposta";
    setStreaming((atual) => (mesmaEspera(atual) ? { ...atual!, relendo: true } : atual));
    let respondida = false;
    try {
      const lida = await queryClient.fetchQuery<ChatResponse>({
        queryKey: chatQueryKey(current.conversationId),
        queryFn: () => agente.mensagens(current.conversationId),
        staleTime: 0,
      });
      respondida = respondidaDepois(lida.messages ?? [], current);
    } catch {
      // Sem a releitura, pergunta de novo: é o que a pessoa pediu.
    }
    // Saiu da conversa ou mudou de pergunta enquanto relia: nada mais.
    if (!mesmaEspera(streamingRef.current)) return;
    if (respondida) {
      setStreaming(null);
      anunciar("Resposta pronta");
      void queryClient.invalidateQueries({ queryKey: conversationsQueryKey });
      return;
    }
    void send(current.content, { files: current.sentFiles, conversa: current.conversationId, deNovo: true });
  }

  // Pergunta vinda da barra do Início (?q=): abre uma conversa nova e envia.
  const handledQuestion = useRef<string | null>(null);
  useEffect(() => {
    if (!askedFromOutside || waiting || handledQuestion.current === askedFromOutside) return;
    handledQuestion.current = askedFromOutside;
    void send(askedFromOutside, { fresh: true });
  }, [askedFromOutside]);

  function openConversation(id: string | null) {
    setMobileRail(false);
    if (waiting) return;
    // A pergunta sem resposta fica para trás: a outra conversa não a mostra.
    if (streaming) setStreaming(null);
    setChegouAgora(null);
    navigate(id ? `${basePath}?c=${encodeURIComponent(id)}` : basePath);
  }

  function openView(next: Exclude<AgentView, "chat">) {
    setMobileRail(false);
    navigate(`${basePath}?v=${next}`);
  }

  /**
   * Envia a pergunta. `deNovo` é o "Tentar de novo": a pergunta não vem do
   * campo, e o que a pessoa escreveu nele fica.
   */
  async function send(content: string, options: { fresh?: boolean; files?: PendingFile[]; conversa?: string; deNovo?: boolean } = {}) {
    const pending = options.files ?? files;
    if (pending.some((file) => file.status === "uploading")) return;
    const sentFiles = pending.filter((file) => file.status === "ready" && file.attachment);
    const attachments = sentFiles.map((file) => file.attachment!);
    const question = content.trim() || (attachments.length ? "Segue a nota fiscal em anexo." : "");
    if (!question || waiting) return;
    const current = options.fresh ? null : (options.conversa ?? conversationId);
    const id = current ?? newConversationId();
    // A pergunta das boas-vindas troca a tela para a conversa: o campo (ou a sugestão) em que o foco estava sai da
    // tela, e o foco iria ao body. Ele vai ao campo da conversa.
    const ativo = typeof document === "undefined" ? null : document.activeElement;
    const dasBoasVindas = ativo instanceof HTMLElement && ativo.closest("[data-boas-vindas]") !== null;
    if (!current) navigate(`${basePath}?c=${encodeURIComponent(id)}`, { replace: Boolean(options.fresh) });
    if (dasBoasVindas) window.requestAnimationFrame(focarOCampo);
    if (!options.deNovo) {
      setDraft("");
      setFiles([]);
    }
    setChegouAgora(null);
    setStreaming({
      conversationId: id,
      question,
      content,
      files: sentFiles.map((file) => file.name),
      sentFiles,
      tools: [],
      runningTool: null,
      text: "",
      textIndex: -1,
      estado: "esperando",
      sinalEm: performance.now(),
      conhecidas: (queryClient.getQueryData<ChatResponse>(chatQueryKey(id))?.messages ?? []).map((mensagem) => mensagem.id),
      relendo: false,
    });
    sendTurn.current += 1;
    const turn = sendTurn.current;
    const controller = new AbortController();
    abortRef.current = controller;
    const onChunk = (chunk: AgentDuteStreamChunk) => {
      if (sendTurn.current !== turn) return;
      const sinalEm = performance.now();
      setStreaming((current) => {
        if (!current || current.estado !== "esperando") return current;
        if (chunk.type === "reset") return { ...current, tools: [], runningTool: null, text: "", textIndex: -1, sinalEm };
        if (chunk.type === "tool") {
          // A mesma ferramenta de novo é outra consulta: entra no fim, como a da vez.
          return { ...current, tools: [...current.tools, chunk.name], runningTool: chunk.name, sinalEm };
        }
        // Texto antes de uma consulta ("vou verificar…") é trocado pelo da resposta final.
        const text = chunk.index === current.textIndex ? current.text + chunk.text : chunk.text;
        return { ...current, runningTool: null, text, textIndex: chunk.index, sinalEm };
      });
    };
    try {
      const result = await agente.conversar(
        { message: question, conversation_id: id, ...(attachments.length ? { attachments } : {}) },
        onChunk,
        controller.signal,
      );
      // A resposta gravada entra no cache mesmo depois de parar: ela é da conversa (uma vez só, se uma releitura já a trouxe).
      queryClient.setQueryData<ChatResponse>(chatQueryKey(id), (previous) => {
        const vistas = new Set((previous?.messages ?? []).map((mensagem) => mensagem.id));
        return {
          conversation: result.conversation ?? previous?.conversation,
          messages: [...(previous?.messages ?? []), ...(result.messages ?? []).filter((mensagem) => !vistas.has(mensagem.id))],
        };
      });
      if (sendTurn.current !== turn) return;
      setStreaming(null);
      setChegouAgora([...(result.messages ?? [])].reverse().find((mensagem) => mensagem.role === "assistant")?.id ?? null);
      abortRef.current = null;
      // A resposta não fica em região viva: o leitor de tela ouve que ela chegou e a lê quando quiser.
      anunciar("Resposta pronta");
      await queryClient.invalidateQueries({ queryKey: conversationsQueryKey });
    } catch (error) {
      // Parou ou passou do prazo: quem encerrou a vez já cuidou da tela.
      if (sendTurn.current !== turn) return;
      abortRef.current = null;
      if (prazoEsgotado(error) || (error instanceof Error && error.message === PRAZO_ESGOTADO)) {
        sendTurn.current += 1;
        setStreaming((current) => (current ? { ...current, estado: "sem-resposta", runningTool: null } : current));
        return;
      }
      setStreaming(null);
      devolverAoCampo(content, sentFiles);
      toast({
        title: "Não consegui enviar agora",
        description: error instanceof Error ? error.message : "Tente de novo em instantes.",
        variant: "destructive",
      });
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
  // A conversa que não chegou do servidor (sem rede, o Firestore só acharia o cache) não vira a tela de boas-vindas.
  const chatFailed = Boolean(conversationId) && chat.isError && chat.data === undefined && !showingStream;
  const empty = !conversationId || (!chat.isLoading && !chatFailed && messages.length === 0 && !showingStream);
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
      falha={conversations.isError && conversations.data === undefined ? conversations.error : null}
      retrying={conversations.isFetching}
      onRetry={() => void conversations.refetch()}
      view={view}
      activeId={conversationId}
      onOpen={openConversation}
      onView={openView}
      collapsed={collapsed}
      onToggle={() => setRailCollapsed(!railCollapsed)}
      whatsapp={whatsapp}
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
            disabled={waiting}
            draft={draft}
            onDraft={setDraft}
            onSend={send}
            attach={attach}
          />
        ) : (
          <Conversation
            messages={messages}
            loading={chat.isLoading}
            failure={chatFailed ? chat.error : null}
            retrying={chat.isFetching}
            onReload={() => void chat.refetch()}
            streaming={showingStream}
            chegouAgora={chegouAgora}
            demorando={demorando}
            onStop={stop}
            onRetry={() => void retry()}
            draft={draft}
            onDraft={setDraft}
            onSend={send}
            busy={waiting}
            attach={attach}
            aviso={aviso}
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
  falha,
  retrying,
  onRetry,
  view,
  activeId,
  onOpen,
  onView,
  collapsed,
  onToggle,
  whatsapp,
}: {
  conversations: ConversationSummary[];
  history: RoutineHistoryItem[];
  loading: boolean;
  /** As conversas não chegaram (nulo quando chegaram ou ainda leem): erro nunca vira "Suas conversas aparecem aqui". */
  falha: unknown;
  retrying: boolean;
  onRetry: () => void;
  view: AgentView;
  activeId: string | null;
  onOpen: (id: string | null) => void;
  onView: (view: Exclude<AgentView, "chat">) => void;
  collapsed: boolean;
  onToggle: () => void;
  whatsapp: boolean;
}) {
  const [query, setQuery] = useState("");
  const groups = groupConversations(filterConversations(conversations, query), new Date());
  // A falta de conexão diz a mesma coisa que a conversa ao lado (o estado único da conexão, momento 8).
  const faltaNaTela = useFaltaNaTela();
  const motivoDaFalha = !falha
    ? null
    : ehFaltaDeConexao(falha)
      ? faltaNaTela === "sem-conexao"
        ? "Sem conexão."
        : "Reconectando…"
      : "Não consegui carregar as conversas.";
  const unreadHistory = history.some((item) => item.id !== activeId && isUnreadRoutine(item));
  const nav = (
    <>
      <RailButton icon={<Plus />} label="Nova conversa" active={view === "chat" && !activeId} collapsed={collapsed} onClick={() => onOpen(null)} />
      <RailButton icon={<CalendarClock />} label="Rotinas" active={view === "rotinas"} collapsed={collapsed} onClick={() => onView("rotinas")} />
      {whatsapp ? <RailButton icon={<MessageCircle />} label="WhatsApp" badge="em breve" active={view === "whatsapp"} collapsed={collapsed} onClick={() => onView("whatsapp")} /> : null}
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
      <nav aria-label="Conversas recentes" aria-busy={loading || undefined} className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <FantasmasDasConversas />
        ) : motivoDaFalha ? (
          <div className="flex flex-col items-start gap-1 px-2 py-3 text-sm">
            <p className="font-semibold text-foreground">{motivoDaFalha}</p>
            <Button type="button" variant="ghost" className="-ml-3 min-h-11" aria-disabled={retrying || undefined} aria-busy={retrying || undefined} onClick={() => (retrying ? undefined : onRetry())}>
              {retrying ? <Spinner /> : null}
              {retrying ? "Tentando de novo…" : "Tentar de novo"}
            </Button>
          </div>
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

/**
 * As conversas chegando: o rótulo do grupo e as linhas-fantasma no lugar
 * delas, sem texto (o título da barra já diz o que é), com a forma da lista
 * que chega ("HOJE" e as linhas). Entram aos 300 ms; antes, o lugar fica
 * guardado e vazio, e a leitura rápida não pisca os blocos.
 */
function FantasmasDasConversas() {
  const visivel = useEspera(true).visivel;
  return (
    <div aria-hidden="true" data-fantasmas-da-barra="" className={cn("mb-2", !visivel && "invisible")}>
      <div className="flex h-8 items-end px-2 pb-1">
        <Esqueleto forma="texto" className="mb-0.5 h-2.5 w-12" />
      </div>
      <div className="flex flex-col">
        {["w-3/4", "w-1/2", "w-2/3"].map((largura) => (
          <div key={largura} className="flex min-h-9 items-center px-2.5 py-2">
            <Esqueleto forma="texto" className={largura} />
          </div>
        ))}
      </div>
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
                <Spinner />
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
        {/* Sem o que enviar, ou esperando a resposta, o Enviar fica travado sem sair da ordem do foco: nunca `disabled`, que tiraria o foco dele quando a resposta chega. */}
        <button
          type="button"
          aria-disabled={!canSend || undefined}
          onClick={() => {
            if (canSend) onSend(value);
          }}
          aria-label="Enviar"
          className={cn(
            "grid h-9 w-9 place-items-center rounded-xl transition-colors",
            canSend ? "bg-foreground text-background hover:bg-foreground/85" : "bg-muted text-muted-foreground",
          )}
        >
          <ArrowUp className="h-4 w-4" aria-hidden="true" />
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
  intro?: string;
  placeholder: string;
  disabled: boolean;
  draft: string;
  onDraft: (value: string) => void;
  onSend: (value: string) => void;
  attach?: AttachControls;
}) {
  return (
    <div data-boas-vindas="" className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-4 pb-10 pt-6">
      <AgentMark size="lg" />
      <h2 className="mt-4 text-center text-2xl font-semibold tracking-tight md:text-3xl">
        {name ? `Olá, ${name}. Como posso ajudar?` : "Como posso ajudar?"}
      </h2>
      {intro ? <p className="mt-1.5 max-w-xl text-center text-sm text-muted-foreground">{intro}</p> : null}
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
            {suggestion.hint ? <span className="mt-0.5 block text-xs text-muted-foreground">{suggestion.hint}</span> : null}
          </button>
        ))}
      </div>
    </div>
  );
}

function Conversation({
  messages,
  loading,
  failure,
  retrying,
  onReload,
  streaming,
  chegouAgora,
  demorando,
  onStop,
  onRetry,
  draft,
  onDraft,
  onSend,
  busy,
  attach,
  aviso,
}: {
  messages: ChatMessage[];
  loading: boolean;
  /** A conversa não chegou do servidor; nulo quando chegou ou ainda lê. */
  failure: unknown;
  retrying: boolean;
  onReload: () => void;
  streaming: Streaming | null;
  /** A resposta que acabou de chegar nesta tela: as fontes dela entram, as gravadas já estão no lugar. */
  chegouAgora: string | null;
  demorando: boolean;
  onStop: () => void;
  onRetry: () => void;
  draft: string;
  onDraft: (value: string) => void;
  onSend: (value: string) => void;
  busy: boolean;
  attach?: AttachControls;
  aviso: string | null;
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

  // Presa no fim, a conversa acompanha o que entra embaixo: o texto, as consultas, a demora com o Parar e o "Sem resposta" com o "Tentar de novo".
  useEffect(() => {
    if (pinned.current) scrollToBottom();
  }, [ordered.length, streaming?.text, streaming?.tools.length, streaming?.question, demorando, streaming?.estado]);

  useEffect(() => {
    pinned.current = true;
  }, [streaming?.question]);

  // O botão em que o foco estava saiu da tela (o Parar, quando o texto ou a
  // resposta chegou ou o prazo passou; o "Tentar de novo", quando a pergunta
  // saiu de novo ou a resposta gravada apareceu): o foco não cai no body.
  const semResposta = streaming?.estado === "sem-resposta";
  const retryRef = useRef<HTMLDivElement | null>(null);
  const tinhaBotao = useRef(false);
  useEffect(() => {
    const tinha = tinhaBotao.current;
    tinhaBotao.current = demorando || semResposta;
    const perdido = !document.activeElement || document.activeElement === document.body;
    if (!perdido) return;
    if (semResposta) retryRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    else if (tinha) focarOCampo();
  }, [semResposta, demorando]);

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
          {loading && !streaming ? <CarregandoNaRegiao rotulo="Carregando a conversa…" /> : null}
          {failure ? (
            ehFaltaDeConexao(failure) ? (
              <BlocoSemConexao tentando={retrying} onTentar={onReload} />
            ) : (
              <ErroNaLeitura mensagem="Não consegui carregar a conversa." tentando={retrying} onTentar={onReload} />
            )
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
                chegando={message.id === chegouAgora}
              />
            ),
          )}
          {streaming ? (
            <>
              <UserMessage files={streaming.files}>{streaming.question}</UserMessage>
              {semResposta ? (
                <div ref={retryRef} className="mb-7 flex gap-3">
                  <AgentMark />
                  <ErroNaLeitura mensagem={SEM_RESPOSTA_DO_AGENTE} tentando={streaming.relendo} onTentar={onRetry} className="min-w-0 flex-1" />
                </div>
              ) : (
                <AssistantMessage
                  tools={streaming.tools}
                  runningTool={streaming.runningTool}
                  // O texto antes de uma consulta ("Vou verificar…") sai enquanto ela roda: a trilha diz o que ele faz, e a resposta vem depois.
                  content={streaming.runningTool ? "" : streaming.text}
                  demorando={demorando}
                  onStop={onStop}
                  streaming
                />
              )}
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
          {aviso ? <p className="mt-2 text-center text-xs text-muted-foreground">{aviso}</p> : null}
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

/**
 * A resposta do Agent Dute. Enquanto chega, a trilha (momento 9) diz o que ele
 * está lendo e, quando o texto começa, recolhe numa linha; a resposta gravada
 * mostra a mesma linha, para nada mudar de lugar quando ela termina. No fim,
 * "De onde tirei" (invariante 3). A resposta não é região viva: o texto entra
 * em fluxo, sem animação por palavra, e o leitor de tela ouve "Resposta
 * pronta" quando ela chega.
 *
 * Enquanto chega, o bloco não encolhe: a trilha que recolhe numa linha deixa
 * a altura dela para o texto, e a conversa presa no fim não desce e sobe de
 * novo. Com o texto chegando, o lugar das fontes e do Copiar fica guardado
 * (invisível), e na chegada elas entram ali, em 150 ms, sem empurrar nada.
 */
function AssistantMessage({
  id,
  content,
  tools,
  runningTool,
  draft,
  draftSent,
  demorando = false,
  onStop,
  streaming = false,
  chegando = false,
}: {
  id?: string;
  content: string;
  tools?: string[];
  draft?: unknown;
  draftSent?: unknown;
  runningTool?: string | null;
  demorando?: boolean;
  onStop?: () => void;
  streaming?: boolean;
  /** A resposta acabou de chegar nesta tela: as fontes e o Copiar entram (opacidade e 4 px). */
  chegando?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const names = uniqueTools(tools);
  // Escrevendo: o texto chegou e nenhuma consulta está na vez (o texto antes de uma consulta é trocado pelo da resposta).
  const writing = Boolean(content) && !runningTool;
  const bloco = useRef<HTMLDivElement | null>(null);
  const maior = useRef(0);
  useLayoutEffect(() => {
    const elemento = bloco.current;
    if (!streaming || !elemento) return;
    const altura = elemento.getBoundingClientRect().height;
    if (altura > maior.current) {
      maior.current = altura;
      elemento.style.minHeight = `${altura}px`;
    }
  });
  return (
    <div ref={bloco} data-resposta-do-agente="" className="mb-7 flex gap-3">
      <AgentMark />
      <div className="min-w-0 flex-1 pt-0.5">
        {streaming ? (
          <TrilhaDoAgente
            consultas={consultasDoStream(tools ?? [], runningTool ?? null)}
            escrevendo={writing}
            demorando={demorando}
            onParar={onStop}
            className={content ? "mb-2" : undefined}
          />
        ) : (
          <TrilhaRecolhida nomes={names} className="mb-2" />
        )}
        {content ? (
          <AgentMarkdown content={streaming ? settleStreamingMarkdown(content) : content} />
        ) : null}
        {streaming && writing ? (
          // O lugar das fontes e do Copiar, guardado enquanto o texto chega: invisível e fora da árvore.
          <div data-lugar-das-fontes="" className="invisible">
            <FontesDaResposta fontes={fontesDaResposta(names)} className="mt-3" />
            <span className="mt-1.5 inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs">
              <Copy className="h-3.5 w-3.5" />
              Copiar
            </span>
          </div>
        ) : null}
        {!streaming && content ? (
          <FontesDaResposta fontes={fontesDaResposta(names)} className={cn("mt-3", chegando && "agente-chega")} />
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
            className={cn("mt-1.5 inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:bg-muted", chegando && "agente-chega")}
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "Copiado" : "Copiar"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
