import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Send, Sparkles } from "lucide-react";

import {
  ChatBubble,
  chatQueryKey,
  fetchChatJson,
  type ChatMessage,
  type ChatResponse,
} from "@/components/agent/chat";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

const promptShortcuts = [
  "O que precisa da minha atenção hoje?",
  "Há divergência de saldo em algum SKU?",
  "Quais pedidos estão parados?",
  "O que entrou ou saiu do estoque hoje?",
];

/**
 * Conversa com o Agent Dute dentro do painel lateral. O agente só responde:
 * nenhuma baixa, faturamento ou convite sai daqui.
 */
export default function AgentChatPanel() {
  const [message, setMessage] = useState("");
  const [pendingMessage, setPendingMessage] = useState<ChatMessage | null>(
    null,
  );
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const chat = useQuery<ChatResponse, Error>({
    queryKey: chatQueryKey,
    queryFn: () => fetchChatJson<ChatResponse>("/api/agent-dute/chat"),
  });
  const sendMessage = useMutation<ChatResponse, Error, string>({
    mutationFn: (content) =>
      fetchChatJson<ChatResponse>("/api/agent-dute/chat", {
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

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, sendMessage.isPending]);

  function submit(content = message) {
    const trimmed = content.trim();
    if (!trimmed || sendMessage.isPending) return;
    setPendingMessage({
      id: "pending-user-message",
      role: "user",
      content: trimmed,
      created_at: new Date().toISOString(),
    });
    sendMessage.mutate(trimmed);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
        {chat.isLoading && !pendingMessage ? (
          <p className="text-sm text-muted-foreground">Carregando conversa...</p>
        ) : messages.length === 0 ? (
          <div className="flex flex-col gap-4 pt-2">
            <p className="text-sm text-foreground/70">
              Pergunte sobre pedidos, estoque, divergências ou rotinas. O agente
              consulta os dados reais e recomenda; quem decide é você.
            </p>
            <div className="flex flex-col gap-2">
              {promptShortcuts.map((prompt) => (
                <Button
                  key={prompt}
                  type="button"
                  variant="outline"
                  className="h-auto justify-start whitespace-normal rounded-2xl px-4 py-2.5 text-left text-sm font-medium"
                  disabled={sendMessage.isPending}
                  onClick={() => submit(prompt)}
                >
                  <Sparkles className="size-3.5 shrink-0" aria-hidden="true" />
                  {prompt}
                </Button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {messages.map((item) => (
              <ChatBubble key={item.id} message={item} />
            ))}
            {sendMessage.isPending ? (
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <div className="flex size-9 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary">
                  <Bot className="size-4" aria-hidden="true" />
                </div>
                <span>Consultando os dados reais...</span>
              </div>
            ) : null}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-border/70 p-3">
        <div className="flex items-end gap-2 rounded-[22px] border border-border bg-white/80 p-2">
          <Textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            placeholder="Pergunte ao Agent Dute..."
            rows={2}
            disabled={sendMessage.isPending}
            className="min-h-[56px] resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
          />
          <Button
            type="button"
            size="icon"
            className="size-10 shrink-0 rounded-2xl"
            disabled={!message.trim() || sendMessage.isPending}
            onClick={() => submit()}
          >
            <Send className="size-4" />
            <span className="sr-only">Enviar</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
