import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, NotebookPen } from "lucide-react";

import { parseDraftSent, type NoteDraft } from "@/lib/agent-draft";
import { chaveNoAlvo } from "@/lib/agente/cliente";
import { useClienteDoAgente } from "@/lib/agente/contexto";

/**
 * A anotação que o agente do núcleo sugeriu na conversa (parte 5.5i). Nada é
 * gravado até a pessoa clicar em "Sugerir anotação"; a mesma mensagem nunca
 * vira duas, e a coordenação aprova antes de valer.
 */
export function NoteDraftCard({ draft, messageId, sent }: { draft: NoteDraft; messageId?: string; sent?: unknown }) {
  const queryClient = useQueryClient();
  const agente = useClienteDoAgente();
  const [sentNow, setSentNow] = useState(false);
  const sugerir = agente.anotacoes.sugerir;
  const send = useMutation({
    mutationFn: () => sugerir!(messageId!),
    onSuccess: async () => {
      setSentNow(true);
      await queryClient.invalidateQueries({ queryKey: chaveNoAlvo(agente, ["agent-dute-chat"]) });
    },
  });
  if (!sugerir) return null;

  if (sentNow || parseDraftSent(sent)) {
    return (
      <section className="mt-3 rounded-2xl border border-border bg-card px-4 py-3">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <CheckCircle2 className="h-4 w-4 text-success-soft-foreground" aria-hidden="true" />
          Anotação enviada para a coordenação
        </p>
        <p className="mt-1 text-sm text-foreground/80">{draft.texto}</p>
      </section>
    );
  }

  return (
    <section className="mt-3 overflow-hidden rounded-2xl border border-agent-border bg-agent-soft">
      <header className="flex items-center gap-2.5 px-4 pt-3">
        <NotebookPen className="h-4 w-4 shrink-0 text-agent" aria-hidden="true" />
        <p className="text-sm font-semibold">Anotação para a coordenação</p>
      </header>
      <p className="px-4 pt-2 text-sm">{draft.texto}</p>
      {send.isError ? (
        <p className="mx-4 mt-3 rounded-lg bg-destructive-soft px-3 py-2 text-sm text-destructive-soft-foreground" role="alert">
          {send.error instanceof Error ? send.error.message : "Não consegui enviar a anotação."}
        </p>
      ) : null}
      <div className="flex justify-end px-4 py-3">
        <button
          type="button"
          disabled={!messageId || send.isPending}
          onClick={() => send.mutate()}
          className="inline-flex items-center gap-2 rounded-xl bg-foreground px-3.5 py-2 text-sm font-semibold text-background hover:bg-foreground/85 disabled:opacity-50"
        >
          {send.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          {send.isPending ? "Enviando…" : "Sugerir anotação"}
        </button>
      </div>
    </section>
  );
}
