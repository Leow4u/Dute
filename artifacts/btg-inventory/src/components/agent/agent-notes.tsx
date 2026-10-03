import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, NotebookPen, X } from "lucide-react";

import { fetchChatJson } from "@/components/agent/chat";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

/**
 * Anotações que o Agent Dute sugeriu nas conversas. Pendentes não mudam
 * nenhuma resposta; a coordenação aprova (pode editar e escolher quem vê),
 * recusa ou arquiva. Cada decisão grava evento no backend.
 */

type Note = {
  id: string;
  text: string;
  reason: string | null;
  visibility: "todos" | "equipe";
  status: "pending" | "active";
  suggested_by_name: string | null;
  suggested_by_role: string | null;
  created_at: string | null;
};

const notesKey = ["agent-dute-notes"] as const;
const dateBr = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" });

function when(iso: string | null) {
  const date = iso ? new Date(iso) : null;
  return date && !Number.isNaN(date.getTime()) ? dateBr.format(date) : "";
}

function who(note: Note) {
  const origin = note.suggested_by_role === "cliente" ? "na conversa de" : "na conversa da equipe com";
  return [note.suggested_by_name ? `${origin} ${note.suggested_by_name.split(/\s+/)[0]}` : "", when(note.created_at)].filter(Boolean).join(" · ");
}

export function AgentNotes() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const notes = useQuery({
    queryKey: notesKey,
    queryFn: () => fetchChatJson<{ notes: Note[] }>("/api/agent-dute/notes"),
  });
  const decide = useMutation({
    mutationFn: ({ id, action, text, visibility }: { id: string; action: "approve" | "reject" | "archive"; text?: string; visibility?: Note["visibility"] }) =>
      fetchChatJson(`/api/agent-dute/notes/${encodeURIComponent(id)}/${action}`, {
        method: "POST",
        body: JSON.stringify({ text, visibility }),
      }),
    onSuccess: (_result, input) => {
      toast({ title: input.action === "approve" ? "Anotação aprovada: o Agent Dute passa a considerar" : input.action === "reject" ? "Anotação recusada" : "Anotação arquivada" });
      void queryClient.invalidateQueries({ queryKey: notesKey });
    },
    onError: (error) => toast({ title: "Não foi possível salvar", description: error instanceof Error ? error.message : "", variant: "destructive" }),
  });

  const list = notes.data?.notes ?? [];
  const pending = list.filter((note) => note.status === "pending");
  const active = list.filter((note) => note.status === "active");

  return (
    <section className="rounded-[18px] border border-border bg-card px-5 py-4">
      <header className="flex items-start gap-3">
        <NotebookPen className="mt-0.5 h-5 w-5 text-agent" aria-hidden="true" />
        <div>
          <h2 className="font-semibold">Anotações do Agent Dute</h2>
          <p className="text-sm text-muted-foreground">
            O que o agente sugeriu lembrar nas conversas. Só passa a valer depois de aprovado.
          </p>
        </div>
      </header>

      {notes.isLoading ? (
        <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</p>
      ) : notes.isError ? (
        <p className="mt-3 text-sm text-destructive">{notes.error instanceof Error ? notes.error.message : "Não foi possível carregar."}</p>
      ) : (
        <>
          <h3 className="mt-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Para aprovar{pending.length ? ` · ${pending.length}` : ""}
          </h3>
          {pending.length ? (
            <ul className="mt-2 flex flex-col gap-2">
              {pending.map((note) => (
                <PendingNote key={note.id} note={note} busy={decide.isPending} onDecide={(input) => decide.mutate({ id: note.id, ...input })} />
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">Nenhuma sugestão esperando.</p>
          )}

          <h3 className="mt-5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Valendo{active.length ? ` · ${active.length}` : ""}
          </h3>
          {active.length ? (
            <ul className="mt-2 divide-y divide-border/60 rounded-xl border border-border/70">
              {active.map((note) => (
                <li key={note.id} className="flex items-start justify-between gap-3 px-3 py-2 text-sm">
                  <span className="min-w-0">
                    {note.text}
                    <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                      {note.visibility === "equipe" ? "só equipe" : "cliente e equipe"}
                    </span>
                  </span>
                  <button
                    type="button"
                    disabled={decide.isPending}
                    className="shrink-0 text-xs font-medium text-muted-foreground hover:text-foreground"
                    onClick={() => decide.mutate({ id: note.id, action: "archive" })}
                  >
                    Arquivar
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">Nenhuma anotação valendo ainda.</p>
          )}
        </>
      )}
    </section>
  );
}

function PendingNote({
  note,
  busy,
  onDecide,
}: {
  note: Note;
  busy: boolean;
  onDecide: (input: { action: "approve" | "reject"; text?: string; visibility?: Note["visibility"] }) => void;
}) {
  const [text, setText] = useState(note.text);
  const [visibility, setVisibility] = useState(note.visibility);
  return (
    <li className="rounded-xl border border-agent-border bg-agent-soft p-3">
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        maxLength={300}
        rows={2}
        aria-label="Texto da anotação"
        className="w-full resize-none rounded-lg border border-border bg-card px-2.5 py-1.5 text-sm outline-none focus:border-primary/40"
      />
      <p className="mt-1 text-xs text-muted-foreground">
        {[who(note), note.reason ? `“${note.reason}”` : ""].filter(Boolean).join(" · ")}
      </p>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-lg border border-border bg-card p-0.5 text-xs" role="group" aria-label="Quem o agente considera">
          {(["todos", "equipe"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={visibility === value}
              onClick={() => setVisibility(value)}
              className={cn("rounded-md px-2.5 py-1", visibility === value ? "bg-foreground text-background" : "text-muted-foreground")}
            >
              {value === "todos" ? "Cliente e equipe" : "Só equipe"}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => onDecide({ action: "reject" })}
            className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-muted"
          >
            <X className="h-3.5 w-3.5" /> Recusar
          </button>
          <button
            type="button"
            disabled={busy || text.trim().length < 8}
            onClick={() => onDecide({ action: "approve", text: text.trim() !== note.text ? text.trim() : undefined, visibility })}
            className="inline-flex items-center gap-1 rounded-lg bg-foreground px-3 py-1.5 text-xs font-semibold text-background hover:bg-foreground/85 disabled:opacity-50"
          >
            <Check className="h-3.5 w-3.5" /> Aprovar
          </button>
        </div>
      </div>
    </li>
  );
}
