import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, ChevronLeft, Loader2, PanelRightClose, PanelRightOpen, Plus } from "lucide-react";

import { fetchChatJson } from "@/components/agent/chat";
import { useToast } from "@/hooks/use-toast";
import {
  describeSchedule,
  editingRoutine,
  EMPTY_ROUTINE,
  FREQUENCY_LABELS,
  MAX_ROUTINES,
  routineForm,
  routinePayload,
  routineProblem,
  routinesKey,
  routineStatusLine,
  TIME_OPTIONS,
  WEEK_ORDER,
  WEEKDAYS,
  type Routine,
  type RoutineForm,
  type RoutineFrequency,
} from "@/lib/agent-routines";
import { cn } from "@/lib/utils";

/**
 * Coluna Rotinas da tela do Agent Dute: perguntas que o agente responde
 * sozinho no horário marcado. Cada rotina é um card; o card abre o editor.
 * A resposta chega numa conversa própria (lista à esquerda).
 */

const field =
  "w-full min-w-0 rounded-lg border border-border bg-white px-2.5 py-1.5 text-sm outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/15";

async function postJson<T>(url: string, body: unknown) {
  return fetchChatJson<T>(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

export function useRoutines() {
  return useQuery<{ routines: Routine[] }, Error>({
    queryKey: routinesKey,
    queryFn: () => fetchChatJson<{ routines: Routine[] }>("/api/agent-dute/routines"),
    staleTime: 30_000,
  });
}

/** Formulário da rotina: no editor da coluna e no cartão do chat. */
export function RoutineFields({ form, onChange, idPrefix, disabled }: { form: RoutineForm; onChange: (form: RoutineForm) => void; idPrefix: string; disabled?: boolean }) {
  const set = (patch: Partial<RoutineForm>) => onChange({ ...form, ...patch });
  return (
    <fieldset disabled={disabled} className="grid grid-cols-2 gap-2">
      <label className="col-span-2 flex flex-col gap-1" htmlFor={`${idPrefix}-name`}>
        <span className="text-xs font-semibold text-muted-foreground">Nome</span>
        <input id={`${idPrefix}-name`} value={form.name} maxLength={80} onChange={(event) => set({ name: event.target.value })} placeholder="Ex.: Resumo da semana" className={field} />
      </label>
      <label className="col-span-2 flex flex-col gap-1" htmlFor={`${idPrefix}-prompt`}>
        <span className="text-xs font-semibold text-muted-foreground">O que o Agent Dute deve responder</span>
        <textarea
          id={`${idPrefix}-prompt`}
          rows={3}
          maxLength={600}
          value={form.prompt}
          onChange={(event) => set({ prompt: event.target.value })}
          placeholder="Ex.: Resumo da semana passada: pedidos que saíram, envios que chegaram e itens abaixo do mínimo."
          className={cn(field, "resize-y")}
        />
      </label>
      <label className="flex flex-col gap-1" htmlFor={`${idPrefix}-frequency`}>
        <span className="text-xs font-semibold text-muted-foreground">Repetir</span>
        <select id={`${idPrefix}-frequency`} value={form.frequency} onChange={(event) => set({ frequency: event.target.value as RoutineFrequency })} className={field}>
          {(Object.keys(FREQUENCY_LABELS) as RoutineFrequency[]).map((frequency) => (
            <option key={frequency} value={frequency}>
              {FREQUENCY_LABELS[frequency]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1" htmlFor={`${idPrefix}-time`}>
        <span className="text-xs font-semibold text-muted-foreground">Horário</span>
        <select id={`${idPrefix}-time`} value={form.time} onChange={(event) => set({ time: event.target.value })} className={field}>
          {TIME_OPTIONS.map((time) => (
            <option key={time} value={time}>
              {time}
            </option>
          ))}
        </select>
      </label>
      {form.frequency === "weekly" ? (
        <div className="col-span-2 flex flex-col gap-1">
          <span className="text-xs font-semibold text-muted-foreground">Dias</span>
          <div className="flex flex-wrap gap-1">
            {WEEK_ORDER.map((day) => {
              const selected = form.days.includes(day);
              return (
                <button
                  key={day}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => set({ days: selected ? form.days.filter((item) => item !== day) : [...form.days, day] })}
                  className={cn(
                    "rounded-md border px-2 py-1 text-xs",
                    selected ? "border-[#5b3fc4] bg-[#5b3fc4] text-white" : "border-border bg-white text-foreground/80 hover:bg-muted",
                  )}
                >
                  {WEEKDAYS[day]}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
      {form.frequency === "monthly" ? (
        <label className="col-span-2 flex flex-col gap-1" htmlFor={`${idPrefix}-day`}>
          <span className="text-xs font-semibold text-muted-foreground">Dia do mês</span>
          <select id={`${idPrefix}-day`} value={form.day_of_month} onChange={(event) => set({ day_of_month: Number(event.target.value) })} className={field}>
            {Array.from({ length: 28 }, (_, index) => index + 1).map((day) => (
              <option key={day} value={day}>
                Dia {day}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </fieldset>
  );
}

function RoutineEditor({ routine, onDone, onOpenConversation }: { routine: Routine | null; onDone: () => void; onOpenConversation: (id: string) => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [form, setForm] = useState<RoutineForm>(() => (routine ? routineForm(routine) : { ...EMPTY_ROUTINE }));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const problem = routineProblem(form);
  const refresh = () => queryClient.invalidateQueries({ queryKey: routinesKey });
  const failed = (title: string) => (error: Error) => toast({ title, description: error.message, variant: "destructive" });

  const save = useMutation({
    mutationFn: (next: RoutineForm) => postJson("/api/agent-dute/routines", routinePayload(next)),
    onSuccess: async () => {
      await refresh();
      onDone();
    },
    onError: failed("Não consegui salvar a rotina"),
  });
  const remove = useMutation({
    mutationFn: () => postJson(`/api/agent-dute/routines/${encodeURIComponent(routine!.id)}/delete`, {}),
    onSuccess: async () => {
      await refresh();
      onDone();
    },
    onError: failed("Não consegui excluir a rotina"),
  });
  const run = useMutation({
    mutationFn: () => postJson<{ conversation_id: string }>(`/api/agent-dute/routines/${encodeURIComponent(routine!.id)}/run`, {}),
    onSuccess: async (result) => {
      await Promise.all([refresh(), queryClient.invalidateQueries({ queryKey: ["agent-dute-conversations"] })]);
      onOpenConversation(result.conversation_id);
    },
    onError: failed("A rotina não rodou"),
  });
  const busy = save.isPending || remove.isPending || run.isPending;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
      <button type="button" onClick={onDone} className="flex items-center gap-1 self-start text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-4 w-4" /> Rotinas
      </button>
      <h3 className="text-sm font-semibold">{routine ? "Editar rotina" : "Nova rotina"}</h3>
      <RoutineFields form={form} onChange={setForm} idPrefix={`routine-${routine?.id ?? "new"}`} disabled={busy} />
      <p className="text-xs text-muted-foreground">Só consulta: a rotina nunca faz pedido nem muda dado.</p>
      {problem ? <p className="text-xs text-amber-800">{problem}</p> : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {routine ? (
          <div className="flex gap-1.5">
            <button
              type="button"
              disabled={busy}
              onClick={() => save.mutate({ ...form, active: !form.active })}
              className="rounded-lg border border-border bg-white px-2.5 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
            >
              {form.active ? "Pausar" : "Retomar"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => run.mutate()}
              className="inline-flex items-center gap-1 rounded-lg border border-border bg-white px-2.5 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
            >
              {run.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {run.isPending ? "Rodando…" : "Rodar agora"}
            </button>
          </div>
        ) : (
          <span />
        )}
        <button
          type="button"
          disabled={Boolean(problem) || busy}
          onClick={() => save.mutate(form)}
          className="rounded-xl bg-foreground px-3.5 py-2 text-sm font-semibold text-background hover:bg-foreground/85 disabled:opacity-50"
        >
          {save.isPending ? "Salvando…" : routine ? "Salvar" : "Criar rotina"}
        </button>
      </div>
      {routine ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-3 text-xs">
          {routine.last_run_at ? (
            <button type="button" onClick={() => onOpenConversation(routine.conversation_id)} className="font-medium text-primary hover:underline">
              Ver respostas
            </button>
          ) : (
            <span className="text-muted-foreground">Ainda não rodou.</span>
          )}
          {confirmDelete ? (
            <span className="flex items-center gap-2">
              <span>Excluir de vez?</span>
              <button type="button" disabled={busy} onClick={() => remove.mutate()} className="font-semibold text-red-700 hover:underline">
                Excluir
              </button>
              <button type="button" onClick={() => setConfirmDelete(false)} className="text-muted-foreground hover:underline">
                Cancelar
              </button>
            </span>
          ) : (
            <button type="button" onClick={() => setConfirmDelete(true)} className="text-red-700 hover:underline">
              Excluir rotina
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** Lista de rotinas e o editor; `onCollapse` só no desktop (o celular abre por cima). */
export function RoutinesPanel({ onOpenConversation, onCollapse }: { onOpenConversation: (id: string) => void; onCollapse?: () => void }) {
  const routines = useRoutines();
  // Guarda só qual rotina está aberta: o editor lê a versão atual da lista,
  // que muda depois de "Rodar agora", pausar ou salvar.
  const [editing, setEditing] = useState<string | null>(null);
  const list = routines.data?.routines ?? [];
  const open = editingRoutine(list, editing);

  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-3 px-3 py-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <CalendarClock className="h-4 w-4 text-[#5b3fc4]" aria-hidden="true" /> Rotinas
        </h2>
        {onCollapse ? (
          <button type="button" onClick={onCollapse} aria-label="Recolher rotinas" title="Recolher" className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted">
            <PanelRightClose className="h-4 w-4" />
          </button>
        ) : null}
      </div>
      {editing && (editing === "new" || open) ? (
        <RoutineEditor
          key={editing}
          routine={open}
          onDone={() => setEditing(null)}
          onOpenConversation={onOpenConversation}
        />
      ) : (
        <>
          <p className="text-xs text-muted-foreground">Perguntas que o Agent Dute responde sozinho no horário marcado.</p>
          <button
            type="button"
            disabled={list.length >= MAX_ROUTINES}
            onClick={() => setEditing("new")}
            className="flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-[#d9d0fb] bg-white px-3 py-2 text-sm font-semibold text-[#5b3fc4] hover:bg-[#faf8ff] disabled:opacity-50"
          >
            <Plus className="h-4 w-4" /> Criar rotina
          </button>
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
            {routines.isLoading ? (
              <p className="text-sm text-muted-foreground">Carregando…</p>
            ) : routines.isError ? (
              <p className="text-sm text-red-700">Não consegui carregar as rotinas.</p>
            ) : list.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma rotina ainda. Crie uma aqui ou peça no chat, por exemplo: "toda segunda às 8h me manda o resumo da semana".</p>
            ) : (
              list.map((routine) => (
                <button
                  key={routine.id}
                  type="button"
                  onClick={() => setEditing(routine.id)}
                  className="flex flex-col gap-0.5 rounded-xl border border-border bg-white px-3 py-2.5 text-left hover:border-[#5b3fc4]/50"
                >
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-semibold">{routine.name}</span>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold",
                        !routine.active ? "bg-muted text-muted-foreground" : routine.last_status === "failed" ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-800",
                      )}
                    >
                      {!routine.active ? "pausada" : routine.last_status === "failed" ? "falhou" : "ativa"}
                    </span>
                  </span>
                  <span className="text-xs text-muted-foreground">{describeSchedule(routine)}</span>
                  <span className="text-xs text-muted-foreground">{routineStatusLine(routine)}</span>
                </button>
              ))
            )}
          </div>
          {list.length ? (
            <p className="text-xs text-muted-foreground">
              {list.length} de {MAX_ROUTINES} rotinas
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

/** Coluna recolhida: uma faixa fina com o botão para abrir. */
export function RoutinesCollapsed({ onExpand }: { onExpand: () => void }) {
  return (
    <div className="flex h-full flex-col items-center gap-2 py-4">
      <button type="button" onClick={onExpand} aria-label="Abrir rotinas" title="Rotinas" className="grid h-9 w-9 place-items-center rounded-lg text-muted-foreground hover:bg-muted">
        <PanelRightOpen className="h-4 w-4" />
      </button>
      <button type="button" onClick={onExpand} aria-label="Rotinas" className="grid h-9 w-9 place-items-center rounded-lg text-[#5b3fc4] hover:bg-muted">
        <CalendarClock className="h-4 w-4" />
      </button>
    </div>
  );
}
