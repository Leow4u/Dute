import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  Bot,
  MessageSquareText,
  RefreshCw,
  Send,
  Sparkles,
} from "lucide-react";

import {
  ChatBubble,
  chatQueryKey,
  fetchChatJson as fetchJson,
  type ChatMessage,
  type ChatResponse,
} from "@/components/agent/chat";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

import { ClientDataBoundary, EmptyModuleState, firstText } from "./shared";

type ChatView = "prompt" | "conversation";

const promptShortcuts = [
  "O que precisa da minha atenção hoje?",
  "Onde está meu pedido?",
  "Quais produtos estão acabando?",
  "O que entrou ou saiu do estoque?",
  "Tenho alguma entrega para acompanhar?",
  "Há alguma fatura perto do vencimento?",
];

function PromptComposer({
  disabled,
  message,
  onChange,
  onSubmit,
  variant = "default",
}: {
  disabled?: boolean;
  message: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  variant?: "default" | "landing";
}) {
  const isLanding = variant === "landing";

  return (
    <div
      className={cn(
        "rounded-[28px] border border-border bg-white/72 shadow-[0_18px_60px_rgba(15,23,42,.05)] backdrop-blur-[40px]",
        isLanding ? "p-4 md:p-5" : "p-3",
      )}
    >
      <div className="grid gap-3 md:grid-cols-[1fr_auto]">
        <Textarea
          value={message}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              onSubmit();
            }
          }}
          placeholder="Pergunte sobre pedidos, estoque, divergências ou rotinas operacionais..."
          rows={isLanding ? 4 : 3}
          disabled={disabled}
          className={cn(
            "resize-none border-0 bg-transparent text-base shadow-none outline-none focus-visible:ring-0",
            isLanding ? "min-h-[120px]" : "min-h-[88px]",
          )}
        />
        <Button
          type="button"
          className={cn(
            "rounded-[22px] px-5",
            isLanding ? "min-h-12 md:min-h-[104px]" : "min-h-12 md:min-h-[88px]",
          )}
          disabled={!message.trim() || disabled}
          onClick={onSubmit}
        >
          <Send className="h-4 w-4" />
          Enviar
        </Button>
      </div>
    </div>
  );
}

export function ClienteAssistente() {
  const [message, setMessage] = useState("");
  const [view, setView] = useState<ChatView>("prompt");
  const [pendingMessage, setPendingMessage] = useState<ChatMessage | null>(null);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const chatViewportRef = useRef<HTMLDivElement | null>(null);
  const shouldPinToBottomRef = useRef(true);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const chat = useQuery<ChatResponse, Error>({
    queryKey: chatQueryKey,
    queryFn: () => fetchJson<ChatResponse>("/api/agent-dute/chat"),
  });
  const sendMessage = useMutation<ChatResponse, Error, string>({
    mutationFn: (content) =>
      fetchJson<ChatResponse>("/api/agent-dute/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: content,
          conversation_id: chat.data?.conversation?.id,
        }),
      }),
    onSuccess: async () => {
      setMessage("");
      setPendingMessage(null);
      setView("conversation");
      await queryClient.invalidateQueries({ queryKey: chatQueryKey });
    },
    onError: (error) => {
      setPendingMessage(null);
      toast({
        title: "Não consegui enviar agora",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const messages = useMemo(() => {
    const current = [...(chat.data?.messages ?? [])].sort((left, right) =>
      String(left.created_at ?? "").localeCompare(String(right.created_at ?? "")),
    );

    if (pendingMessage) current.push(pendingMessage);
    return current;
  }, [chat.data?.messages, pendingMessage]);

  function getDistanceFromBottom(viewport: HTMLDivElement) {
    return viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
  }

  function updateConversationScrollState() {
    const viewport = chatViewportRef.current;
    if (!viewport) {
      setShowScrollToBottom(false);
      shouldPinToBottomRef.current = true;
      return;
    }

    const isAwayFromBottom = getDistanceFromBottom(viewport) > 96;
    setShowScrollToBottom(isAwayFromBottom);
    shouldPinToBottomRef.current = !isAwayFromBottom;
  }

  function scrollToConversationBottom(behavior: ScrollBehavior = "smooth") {
    shouldPinToBottomRef.current = true;
    bottomRef.current?.scrollIntoView({ behavior, block: "end" });
    window.setTimeout(updateConversationScrollState, 180);
  }

  useEffect(() => {
    if (view !== "conversation") return;

    const frame = window.requestAnimationFrame(() => {
      if (shouldPinToBottomRef.current || pendingMessage) {
        scrollToConversationBottom("smooth");
        return;
      }

      updateConversationScrollState();
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [messages.length, pendingMessage, sendMessage.isPending, view]);

  useEffect(() => {
    if (view === "prompt") {
      setShowScrollToBottom(false);
    }
  }, [view]);

  function submit(content = message) {
    const trimmed = content.trim();
    if (!trimmed || sendMessage.isPending) return;

    shouldPinToBottomRef.current = true;
    setPendingMessage({
      id: "pending-user-message",
      role: "user",
      content: trimmed,
      created_at: new Date().toISOString(),
      source: "portal_cliente",
    });
    setView("conversation");
    sendMessage.mutate(trimmed);
  }

  return (
    <ClientDataBoundary>
      {(overview) => {
        const customerCode = firstText(overview.customer?.code, "BTG Pactual");

        if (view === "conversation") {
          return (
            <main className="flex h-full min-h-0 flex-col overflow-hidden px-1 py-4 text-foreground">
              <div className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col gap-5">
                <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-muted-foreground">
                      Agent Dute
                    </p>
                    <h1 className="text-2xl font-semibold tracking-normal">
                      Chat
                    </h1>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-border bg-white/70 px-3 py-1 text-sm text-muted-foreground">
                      {customerCode}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      className="rounded-2xl"
                      onClick={() => {
                        shouldPinToBottomRef.current = true;
                        setView("prompt");
                      }}
                    >
                      Nova conversa
                    </Button>
                  </div>
                </header>

                <section className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-[32px] border border-border bg-white/56 shadow-[0_18px_60px_rgba(15,23,42,.05)] backdrop-blur-[40px]">
                  <ScrollArea
                    className="min-h-0 flex-1"
                    viewportRef={chatViewportRef}
                    viewportProps={{ onScroll: updateConversationScrollState }}
                  >
                    <div className="space-y-5 p-5 md:p-6">
                      {chat.isLoading && !pendingMessage ? (
                        <EmptyModuleState
                          title="Carregando conversa"
                          description="Buscando o histórico do Agent Dute para este usuário."
                          icon={RefreshCw}
                        />
                      ) : messages.length > 0 ? (
                        <>
                          {messages.map((item) => (
                            <ChatBubble key={item.id} message={item} />
                          ))}
                          {sendMessage.isPending ? (
                            <div className="flex items-center gap-3 text-sm text-muted-foreground">
                              <div className="flex h-9 w-9 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary">
                                <Bot className="h-4 w-4" />
                              </div>
                              <span>Agent Dute está consultando os dados reais...</span>
                            </div>
                          ) : null}
                        </>
                      ) : (
                        <EmptyModuleState
                          title="Conversa vazia"
                          description="Envie uma pergunta para iniciar o atendimento."
                          icon={MessageSquareText}
                        />
                      )}
                      <div ref={bottomRef} />
                    </div>
                  </ScrollArea>

                  {showScrollToBottom ? (
                    <div className="pointer-events-none absolute inset-x-0 bottom-[132px] z-20 flex justify-center px-4">
                      <Button
                        type="button"
                        variant="outline"
                        className="pointer-events-auto h-10 rounded-full border-border bg-white/85 px-4 text-sm font-medium shadow-[0_18px_60px_rgba(15,23,42,.08)] backdrop-blur-[40px] hover:bg-white"
                        onClick={() => scrollToConversationBottom()}
                      >
                        <ArrowDown className="h-4 w-4" />
                        Descer conversa
                      </Button>
                    </div>
                  ) : null}

                  <div className="border-t border-border/70 p-4">
                    <PromptComposer
                      disabled={sendMessage.isPending}
                      message={message}
                      onChange={setMessage}
                      onSubmit={() => submit()}
                    />
                  </div>
                </section>
              </div>
            </main>
          );
        }

        return (
          <main className="flex h-full min-h-0 items-center justify-center overflow-hidden px-1 py-6 text-foreground">
            <div className="mx-auto flex max-h-full w-full max-w-5xl flex-col items-center overflow-auto overscroll-contain py-4 text-center">
              <div className="mb-8 flex h-12 w-12 items-center justify-center rounded-2xl border border-primary/15 bg-primary/10 text-primary shadow-[0_8px_24px_rgba(15,23,42,.04)]">
                <Bot className="h-5 w-5" />
              </div>

              <div className="mb-9 max-w-3xl space-y-4">
                <p className="text-sm font-medium text-muted-foreground">
                  Agent Dute · {customerCode}
                </p>
                <h1 className="text-4xl font-medium tracking-normal text-foreground md:text-5xl">
                  O que você precisa acompanhar hoje?
                </h1>
              </div>

              <div className="w-full max-w-4xl">
                <PromptComposer
                  disabled={sendMessage.isPending}
                  message={message}
                  onChange={setMessage}
                  onSubmit={() => submit()}
                  variant="landing"
                />
              </div>

              <div className="mt-6 flex max-w-4xl flex-wrap justify-center gap-2">
                {promptShortcuts.map((prompt) => (
                  <Button
                    key={prompt}
                    type="button"
                    variant="outline"
                    className="h-auto min-h-10 rounded-full bg-white/70 px-4 py-2 text-sm font-medium shadow-[0_8px_24px_rgba(15,23,42,.04)]"
                    disabled={sendMessage.isPending}
                    onClick={() => submit(prompt)}
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    {prompt}
                  </Button>
                ))}
              </div>

              {(chat.data?.messages?.length ?? 0) > 0 ? (
                <Button
                  type="button"
                  variant="ghost"
                  className="mt-5 rounded-full text-muted-foreground"
                  onClick={() => {
                    shouldPinToBottomRef.current = true;
                    setView("conversation");
                  }}
                >
                  Continuar conversa recente
                </Button>
              ) : null}
            </div>
          </main>
        );
      }}
    </ClientDataBoundary>
  );
}
