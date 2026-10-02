import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarClock,
  Loader2,
  MessageSquareText,
  MoreVertical,
  PanelRightClose,
  PanelRightOpen,
  Pause,
  Pencil,
  Play,
  Plus,
  Trash2,
} from "lucide-react";

import { fetchChatJson } from "@/components/agent/chat";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import {
  describeSchedule,
  editingRoutine,
  EMPTY_ROUTINE,
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
 * sozinho no horário marcado. Cada rotina é um card; clicar abre a janela de
 * edição no meio da tela, e o "⋯" tem executar agora, pausar, editar e
 * apagar. A resposta chega numa conversa própria (lista à esquerda).
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

const SCHEDULE_OPTIONS: Array<{ value: RoutineFrequency; label: string }> = [
  { value: "daily", label: "Todo dia" },
  { value: "weekdays", label: "Dias úteis" },
  { value: "weekly", label: "Semanal" },
  { value: "monthly", label: "Mensal" },
];

/** Formulário da rotina: na janela de criar/editar e no cartão do chat. */
export function RoutineFields({ form, onChange, idPrefix, disabled }: { form: RoutineForm; onChange: (form: RoutineForm) => void; idPrefix: string; disabled?: boolean }) {
  const set = (patch: Partial<RoutineForm>) => onChange({ ...form, ...patch });
  return (
    <fieldset disabled={disabled} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5" htmlFor={`${idPrefix}-name`}>
        <span className="text-sm font-semibold">
          Nome <span className="text-amber-700">*</span>
        </span>
        <input id={`${idPrefix}-name`} value={form.name} maxLength={80} onChange={(event) => set({ name: event.target.value })} placeholder="Ex.: Resumo da semana" className={field} />
      </label>
      <label className="flex flex-col gap-1.5" htmlFor={`${idPrefix}-prompt`}>
        <span className="text-sm font-semibold">
          O que o Agent Dute deve responder <span className="text-amber-700">*</span>
        </span>
        <textarea
          id={`${idPrefix}-prompt`}
          rows={5}
          maxLength={600}
          value={form.prompt}
          onChange={(event) => set({ prompt: event.target.value })}
          placeholder="Ex.: Resumo da semana passada: pedidos que saíram, envios que chegaram e itens abaixo do mínimo."
          className={cn(field, "resize-y leading-6")}
        />
      </label>
      <div className="flex flex-col gap-2">
        <span className="text-sm font-semibold">Agendamento</span>
        <div role="radiogroup" aria-label="Repetir" className="flex flex-wrap gap-1 rounded-xl bg-muted/70 p-1 self-start">
          {SCHEDULE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={form.frequency === option.value}
              onClick={() => set({ frequency: option.value })}
              className={cn(
                "rounded-lg px-3 py-1.5 text-sm",
                form.frequency === option.value ? "bg-white font-semibold text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
        {form.frequency === "weekly" ? (
          <div className="flex flex-wrap gap-1" aria-label="Dias da semana">
            {WEEK_ORDER.map((day) => {
              const selected = form.days.includes(day);
              return (
                <button
                  key={day}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => set({ days: selected ? form.days.filter((item) => item !== day) : [...form.days, day] })}
                  className={cn(
                    "rounded-lg border px-2.5 py-1 text-sm",
                    selected ? "border-[#5b3fc4] bg-[#5b3fc4] text-white" : "border-border bg-white text-foreground/80 hover:bg-muted",
                  )}
                >
                  {WEEKDAYS[day]}
                </button>
              );
            })}
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {form.frequency === "monthly" ? (
            <>
              <label htmlFor={`${idPrefix}-day`} className="text-muted-foreground">
                Todo dia
              </label>
              <select id={`${idPrefix}-day`} value={form.day_of_month} onChange={(event) => set({ day_of_month: Number(event.target.value) })} className={cn(field, "w-20")}>
                {Array.from({ length: 28 }, (_, index) => index + 1).map((day) => (
                  <option key={day} value={day}>
                    {day}
                  </option>
                ))}
              </select>
            </>
          ) : null}
          <label htmlFor={`${idPrefix}-time`} className="text-muted-foreground">
            Às
          </label>
          <select id={`${idPrefix}-time`} value={form.time} onChange={(event) => set({ time: event.target.value })} className={cn(field, "w-28")}>
            {TIME_OPTIONS.map((time) => (
              <option key={time} value={time}>
                {time}
              </option>
            ))}
          </select>
          <span className="text-xs text-muted-foreground">horário de Brasília</span>
        </div>
      </div>
    </fieldset>
  );
}

/** Janela de criar ou editar rotina, no meio da tela. */
function RoutineDialog({ routine, open, onClose }: { routine: Routine | null; open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [form, setForm] = useState<RoutineForm>(() => (routine ? routineForm(routine) : { ...EMPTY_ROUTINE }));
  const problem = routineProblem(form);
  const save = useMutation({
    mutationFn: (next: RoutineForm) => postJson("/api/agent-dute/routines", routinePayload(next)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: routinesKey });
      onClose();
    },
    onError: (error: Error) => toast({ title: "Não consegui salvar a rotina", description: error.message, variant: "destructive" }),
  });
  return (
    <Dialog open={open} onOpenChange={(next) => (!next && !save.isPending ? onClose() : undefined)}>
      <DialogContent className="max-w-2xl bg-white">
        <DialogHeader>
          <DialogTitle>{routine ? "Editar rotina" : "Nova rotina"}</DialogTitle>
          <DialogDescription>O Agent Dute responde sozinho no horário marcado. Só consulta: a rotina nunca faz pedido nem muda dado.</DialogDescription>
        </DialogHeader>
        <RoutineFields form={form} onChange={setForm} idPrefix={`routine-${routine?.id ?? "new"}`} disabled={save.isPending} />
        <DialogFooter className="items-center gap-2 sm:justify-between">
          <span className="text-xs text-amber-800">{problem ?? ""}</span>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} disabled={save.isPending} className="rounded-xl border border-border bg-white px-3.5 py-2 text-sm font-medium hover:bg-muted">
              Cancelar
            </button>
            <button
              type="button"
              disabled={Boolean(problem) || save.isPending}
              onClick={() => save.mutate(form)}
              className="rounded-xl bg-foreground px-4 py-2 text-sm font-semibold text-background hover:bg-foreground/85 disabled:opacity-50"
            >
              {save.isPending ? "Salvando…" : routine ? "Salvar" : "Criar"}
            </button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Card da rotina na coluna: clique abre a janela de edição; "⋯" tem as ações rápidas. */
function RoutineCard({ routine, onEdit, onOpenConversation }: { routine: Routine; onEdit: () => void; onOpenConversation: (id: string) => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const refresh = () => queryClient.invalidateQueries({ queryKey: routinesKey });
  const failed = (title: string) => (error: Error) => toast({ title, description: error.message, variant: "destructive" });
  const run = useMutation({
    mutationFn: () => postJson<{ conversation_id: string }>(`/api/agent-dute/routines/${encodeURIComponent(routine.id)}/run`, {}),
    onSuccess: async (result) => {
      await Promise.all([refresh(), queryClient.invalidateQueries({ queryKey: ["agent-dute-conversations"] })]);
      onOpenConversation(result.conversation_id);
    },
    onError: failed("A rotina não rodou"),
  });
  const toggle = useMutation({
    mutationFn: () => postJson("/api/agent-dute/routines", routinePayload({ ...routineForm(routine), active: !routine.active })),
    onSuccess: refresh,
    onError: failed(routine.active ? "Não consegui pausar a rotina" : "Não consegui retomar a rotina"),
  });
  const remove = useMutation({
    mutationFn: () => postJson(`/api/agent-dute/routines/${encodeURIComponent(routine.id)}/delete`, {}),
    onSuccess: refresh,
    onError: failed("Não consegui apagar a rotina"),
  });
  const busy = run.isPending || toggle.isPending || remove.isPending;
  const state = !routine.active ? "Pausada" : routine.last_status === "failed" ? "Falhou na última vez" : "Ativa";

  return (
    <div className="group relative rounded-xl border border-border bg-white hover:border-[#5b3fc4]/50">
      <button type="button" onClick={onEdit} className="flex w-full flex-col gap-1 px-3 py-2.5 pr-10 text-left">
        <span className="truncate text-sm font-semibold">{routine.name}</span>
        <span className="line-clamp-2 text-xs text-foreground/70">{routine.prompt}</span>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span
            className={cn(
              "h-1.5 w-1.5 shrink-0 rounded-full",
              !routine.active ? "bg-muted-foreground/50" : routine.last_status === "failed" ? "bg-amber-500" : "bg-emerald-500",
            )}
            aria-hidden="true"
          />
          {state} · {describeSchedule(routine)}
        </span>
        {routine.active ? <span className="text-xs text-muted-foreground">{routineStatusLine(routine)}</span> : null}
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`Opções da rotina ${routine.name}`}
          disabled={busy}
          className="absolute right-1.5 top-1.5 grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted data-[state=open]:bg-muted"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreVertical className="h-4 w-4" />}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem onSelect={() => run.mutate()}>
            <Play className="h-4 w-4" /> Executar agora
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => toggle.mutate()}>
            {routine.active ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            {routine.active ? "Pausar" : "Retomar"}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onEdit}>
            <Pencil className="h-4 w-4" /> Editar
          </DropdownMenuItem>
          {routine.last_run_at ? (
            <DropdownMenuItem onSelect={() => onOpenConversation(routine.conversation_id)}>
              <MessageSquareText className="h-4 w-4" /> Ver respostas
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setConfirmDelete(true)} className="text-red-700 focus:text-red-700">
            <Trash2 className="h-4 w-4" /> Apagar
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apagar a rotina "{routine.name}"?</AlertDialogTitle>
            <AlertDialogDescription>Ela para de rodar. As respostas que já chegaram continuam na conversa da rotina.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => remove.mutate()} className="bg-red-700 text-white hover:bg-red-800">
              Apagar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Lista de rotinas; `onCollapse` só no desktop (o celular abre por cima). */
export function RoutinesPanel({ onOpenConversation, onCollapse }: { onOpenConversation: (id: string) => void; onCollapse?: () => void }) {
  const routines = useRoutines();
  // Guarda só qual rotina está aberta: a janela lê a versão atual da lista.
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
            <RoutineCard key={routine.id} routine={routine} onEdit={() => setEditing(routine.id)} onOpenConversation={onOpenConversation} />
          ))
        )}
      </div>
      {list.length ? (
        <p className="text-xs text-muted-foreground">
          {list.length} de {MAX_ROUTINES} rotinas
        </p>
      ) : null}
      {editing && (editing === "new" || open) ? (
        <RoutineDialog key={editing} routine={open} open onClose={() => setEditing(null)} />
      ) : null}
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
