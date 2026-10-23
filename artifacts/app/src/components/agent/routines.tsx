import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarClock,
  Loader2,
  MessageSquareText,
  MoreVertical,
  Pause,
  Pencil,
  Play,
  Plus,
  Trash2,
} from "lucide-react";

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
import { chaveNoAlvo } from "@/lib/agente/cliente";
import { useClienteDoAgente } from "@/lib/agente/contexto";
import { modelosDoAgente } from "@/lib/agente/resumo-do-dia";
import {
  describeSchedule,
  editingRoutine,
  EMPTY_ROUTINE,
  MAX_ROUTINES,
  routineForm,
  showTemplatesInMine,
  templateForm,
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
  type RoutineTemplate,
} from "@/lib/agent-routines";
import { cn } from "@/lib/utils";

/**
 * Rotinas do Agent Dute: perguntas que o agente responde sozinho no horário
 * marcado. Cada rotina é um card; clicar abre a janela de edição no meio da
 * tela, e o "⋯" tem executar agora, pausar, editar e apagar. A resposta chega
 * numa conversa própria ("Histórico das rotinas", na barra lateral).
 */

const field =
  "w-full min-w-0 rounded-lg border border-border bg-card px-2.5 py-1.5 text-sm outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/15";

export function useRoutines() {
  const agente = useClienteDoAgente();
  return useQuery<{ routines: Routine[] }, Error>({
    queryKey: chaveNoAlvo(agente, routinesKey),
    queryFn: () => agente.rotinas.listar(),
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
          Nome <span className="text-warning-soft-foreground">*</span>
        </span>
        <input id={`${idPrefix}-name`} value={form.name} maxLength={80} onChange={(event) => set({ name: event.target.value })} placeholder="Ex.: Resumo da semana" className={field} />
      </label>
      <label className="flex flex-col gap-1.5" htmlFor={`${idPrefix}-prompt`}>
        <span className="text-sm font-semibold">
          O que o Agent Dute deve responder <span className="text-warning-soft-foreground">*</span>
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
                form.frequency === option.value ? "bg-card font-semibold text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
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
                    selected ? "border-agent bg-agent text-agent-foreground" : "border-border bg-card text-foreground/80 hover:bg-muted",
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
function RoutineDialog({ routine, initial, open, onClose }: { routine: Routine | null; initial?: RoutineForm; open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const agente = useClienteDoAgente();
  const { toast } = useToast();
  const [form, setForm] = useState<RoutineForm>(() => (routine ? routineForm(routine) : { ...(initial ?? EMPTY_ROUTINE) }));
  const problem = routineProblem(form);
  const save = useMutation({
    mutationFn: (next: RoutineForm) => agente.rotinas.salvar(routinePayload(next)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: chaveNoAlvo(agente, routinesKey) });
      onClose();
    },
    onError: (error: Error) => toast({ title: "Não consegui salvar a rotina", description: error.message, variant: "destructive" }),
  });
  return (
    <Dialog open={open} onOpenChange={(next) => (!next && !save.isPending ? onClose() : undefined)}>
      <DialogContent className="max-w-2xl bg-card">
        <DialogHeader>
          <DialogTitle>{routine ? "Editar rotina" : "Nova rotina"}</DialogTitle>
          <DialogDescription>O Agent Dute responde sozinho no horário marcado. Só consulta: a rotina nunca faz pedido nem muda dado.</DialogDescription>
        </DialogHeader>
        <RoutineFields form={form} onChange={setForm} idPrefix={`routine-${routine?.id ?? "new"}`} disabled={save.isPending} />
        <DialogFooter className="items-center gap-2 sm:justify-between">
          <span className="text-xs text-warning-soft-foreground">{problem ?? ""}</span>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} disabled={save.isPending} className="rounded-xl border border-border bg-card px-3.5 py-2 text-sm font-medium hover:bg-muted">
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

/** Card da rotina: clique abre a janela de edição; "⋯" tem as ações rápidas. */
function RoutineCard({ routine, onEdit, onOpenConversation }: { routine: Routine; onEdit: () => void; onOpenConversation: (id: string) => void }) {
  const queryClient = useQueryClient();
  const agente = useClienteDoAgente();
  const { toast } = useToast();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const refresh = () => queryClient.invalidateQueries({ queryKey: chaveNoAlvo(agente, routinesKey) });
  const failed = (title: string) => (error: Error) => toast({ title, description: error.message, variant: "destructive" });
  const run = useMutation({
    mutationFn: () => agente.rotinas.rodar(routine.id),
    onSuccess: async (result) => {
      await Promise.all([refresh(), queryClient.invalidateQueries({ queryKey: chaveNoAlvo(agente, ["agent-dute-conversations"]) })]);
      onOpenConversation(result.conversation_id);
    },
    onError: failed("A rotina não rodou"),
  });
  const toggle = useMutation({
    mutationFn: () => agente.rotinas.salvar(routinePayload({ ...routineForm(routine), active: !routine.active })),
    onSuccess: refresh,
    onError: failed(routine.active ? "Não consegui pausar a rotina" : "Não consegui retomar a rotina"),
  });
  const remove = useMutation({
    mutationFn: () => agente.rotinas.excluir(routine.id),
    onSuccess: refresh,
    onError: failed("Não consegui apagar a rotina"),
  });
  const busy = run.isPending || toggle.isPending || remove.isPending;
  const state = !routine.active ? "Pausada" : routine.last_status === "failed" ? "Falhou na última vez" : "Ativa";

  return (
    <div className="group relative rounded-xl border border-border bg-card hover:border-agent/50">
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
          <DropdownMenuItem onSelect={() => setConfirmDelete(true)} className="text-destructive-soft-foreground focus:text-destructive-soft-foreground">
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

/** Card de um modelo pronto: abre a janela de nova rotina já preenchida. */
function TemplateCard({ template, disabled, onPick }: { template: RoutineTemplate; disabled: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onPick}
      className="flex flex-col gap-1 rounded-xl border border-border bg-card px-3.5 py-3 text-left hover:border-agent/50 disabled:opacity-50"
    >
      <CalendarClock className="mb-1 h-4 w-4 text-agent" aria-hidden="true" />
      <span className="text-sm font-semibold">{template.name}</span>
      <span className="text-xs text-muted-foreground">
        {[template.hint, `${describeSchedule({ ...template, day_of_month: template.day_of_month ?? null })}.`].filter(Boolean).join(" ")}
      </span>
    </button>
  );
}

type RoutinesTab = "mine" | "templates";

/**
 * Tela Rotinas do Agent Dute (aberta pela barra lateral): as rotinas da
 * pessoa e os modelos prontos. Em "Minhas rotinas" os modelos aparecem só
 * enquanto não há nenhuma rotina; depois ficam na aba Modelos.
 */
export function RoutinesPage({ role, onOpenConversation }: { role: string | undefined; onOpenConversation: (id: string) => void }) {
  const routines = useRoutines();
  const agente = useClienteDoAgente();
  // "new", id da rotina ou "tpl:<id>"; a janela lê a versão atual da lista.
  const [editing, setEditing] = useState<string | null>(null);
  const [tab, setTab] = useState<RoutinesTab>("mine");
  const list = routines.data?.routines ?? [];
  // No agente do núcleo, o Resumo do dia do módulo vem primeiro (parte 5.5l).
  const templates = modelosDoAgente(role, agente.alvo);
  const full = list.length >= MAX_ROUTINES;
  const open = editingRoutine(list, editing);
  const template = editing?.startsWith("tpl:") ? templates.find((item) => `tpl:${item.id}` === editing) : undefined;
  const templateGrid = (
    <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
      {templates.map((item) => (
        <TemplateCard key={item.id} template={item} disabled={full} onPick={() => setEditing(`tpl:${item.id}`)} />
      ))}
    </div>
  );

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[920px] flex-col gap-4 px-4 py-6 md:px-7">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1 basis-[420px]">
            <h2 className="text-2xl font-semibold tracking-tight">Rotinas</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Perguntas que o Agent Dute responde sozinho no horário marcado. As respostas ficam em "Histórico das rotinas", na barra ao lado.
            </p>
          </div>
          <button
            type="button"
            disabled={full}
            onClick={() => setEditing("new")}
            className="flex items-center gap-1.5 rounded-xl bg-foreground px-3.5 py-2 text-sm font-semibold text-background hover:bg-foreground/85 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" /> Nova rotina
          </button>
        </div>
        <div role="tablist" aria-label="Rotinas" className="flex gap-5 border-b border-border text-sm">
          {(
            [
              ["mine", `Minhas rotinas${list.length ? ` (${list.length})` : ""}`],
              ["templates", "Modelos"],
            ] as Array<[RoutinesTab, string]>
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              onClick={() => setTab(value)}
              className={cn("-mb-px border-b-2 pb-2", tab === value ? "border-foreground font-semibold text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "templates" ? (
          templateGrid
        ) : routines.isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : routines.isError ? (
          <p className="text-sm text-destructive-soft-foreground">Não consegui carregar as rotinas.</p>
        ) : showTemplatesInMine(list) ? (
          <>
            <p className="rounded-xl border border-dashed border-border px-4 py-5 text-center text-sm text-muted-foreground">
              Nenhuma rotina ainda. Comece por um modelo abaixo, crie do zero ou peça no chat, por exemplo: "toda segunda às 8h me manda o resumo da semana".
            </p>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Comece por um modelo</p>
            {templateGrid}
          </>
        ) : (
          <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
            {list.map((routine) => (
              <RoutineCard key={routine.id} routine={routine} onEdit={() => setEditing(routine.id)} onOpenConversation={onOpenConversation} />
            ))}
          </div>
        )}
        {list.length ? (
          <p className="text-xs text-muted-foreground">
            {list.length} de {MAX_ROUTINES} rotinas{full ? ". Apague uma para criar outra." : ""}
          </p>
        ) : null}
      </div>
      {editing && (editing === "new" || open || template) ? (
        <RoutineDialog key={editing} routine={open} initial={template ? templateForm(template) : undefined} open onClose={() => setEditing(null)} />
      ) : null}
    </div>
  );
}
