import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, CheckCircle2, Loader2 } from "lucide-react";

import { fetchChatJson } from "@/components/agent/chat";
import { parseDraftSent, type RoutineDraft } from "@/lib/agent-draft";
import { describeSchedule, routineFormFromSuggestion, routinePayload, routineProblem, routinesKey, type RoutineForm } from "@/lib/agent-routines";

import { RoutineFields } from "./routines";

/**
 * Rotina que o Agent Dute propôs no chat ("toda segunda me manda…"). Nada é
 * criado até a pessoa clicar em "Criar rotina"; a mesma mensagem nunca cria
 * duas rotinas.
 */
export function RoutineDraftCard({ draft, messageId, sent: sentValue }: { draft: RoutineDraft; messageId?: string; sent?: unknown }) {
  const queryClient = useQueryClient();
  const initial = routineFormFromSuggestion(draft.value);
  const [form, setForm] = useState<RoutineForm | null>(initial);
  const [created, setCreated] = useState(() => Boolean(parseDraftSent(sentValue)));
  const create = useMutation({
    mutationFn: (next: RoutineForm) =>
      fetchChatJson("/api/agent-dute/routines", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(routinePayload(next, messageId)),
      }),
    onSuccess: async () => {
      setCreated(true);
      await Promise.all([queryClient.invalidateQueries({ queryKey: routinesKey }), queryClient.invalidateQueries({ queryKey: ["agent-dute-chat"] })]);
    },
  });
  if (!form) return null;

  if (created) {
    return (
      <section className="mt-3 rounded-2xl border border-border bg-white px-4 py-3">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />
          Rotina criada: {form.name}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {describeSchedule(form)}. Ela aparece na coluna Rotinas, e as respostas chegam numa conversa própria aqui no Agent Dute.
        </p>
      </section>
    );
  }

  const problem = routineProblem(form);
  return (
    <section className="mt-3 overflow-hidden rounded-2xl border border-[#d9d0fb] bg-[#faf8ff]">
      <header className="flex items-start gap-2.5 px-4 pt-3">
        <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-[#5b3fc4]" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-sm font-semibold">Rotina para confirmar</p>
          <p className="text-xs text-muted-foreground">Só consulta: nunca faz pedido nem muda dado.</p>
        </div>
      </header>
      <div className="px-4 pt-3">
        <RoutineFields
          form={form}
          onChange={(next) => {
            create.reset();
            setForm(next);
          }}
          idPrefix={`routine-draft-${messageId ?? "x"}`}
          disabled={create.isPending}
        />
      </div>
      {create.isError ? (
        <p className="mx-4 mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {create.error instanceof Error ? create.error.message : "Não consegui criar a rotina."}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-end gap-3 px-4 py-3">
        {problem ? <span className="text-xs text-amber-800">{problem}</span> : null}
        <button
          type="button"
          disabled={Boolean(problem) || !messageId || create.isPending}
          onClick={() => create.mutate(form)}
          className="inline-flex items-center gap-2 rounded-xl bg-foreground px-3.5 py-2 text-sm font-semibold text-background hover:bg-foreground/85 disabled:opacity-50"
        >
          {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {create.isPending ? "Criando…" : "Criar rotina"}
        </button>
      </div>
    </section>
  );
}
