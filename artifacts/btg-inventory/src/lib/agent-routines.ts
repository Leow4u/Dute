/**
 * Rotinas do Agent Dute (functions/src/domain/agent-routines.ts): perguntas
 * que o agente responde sozinho no horário marcado. Aqui ficam os textos da
 * coluna Rotinas, o formulário do editor e o "não lido" das conversas de
 * rotina (guardado neste navegador).
 */

export type RoutineFrequency = "daily" | "weekdays" | "weekly" | "monthly";

export type Routine = {
  id: string;
  name: string;
  prompt: string;
  frequency: RoutineFrequency;
  days: number[];
  day_of_month: number | null;
  time: string;
  active: boolean;
  next_run_at: string | null;
  last_run_at: string | null;
  last_status: "ok" | "failed" | "no_access" | null;
  conversation_id: string;
};

export const MAX_ROUTINES = 5;
export const routinesKey = ["agent-dute-routines"] as const;

export const FREQUENCY_LABELS: Record<RoutineFrequency, string> = {
  daily: "Todo dia",
  weekdays: "Todo dia útil",
  weekly: "Toda semana",
  monthly: "Todo mês",
};

/** Domingo primeiro, como o Date; na tela a semana começa na segunda. */
export const WEEKDAYS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"] as const;
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
const WEEKDAY_NAMES = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

/** 00:00, 00:15 … 23:45. */
export const TIME_OPTIONS = Array.from({ length: 96 }, (_, index) => {
  const hours = Math.floor(index / 4);
  const minutes = (index % 4) * 15;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
});

/** "Toda segunda e sexta · 08:00", "Todo dia 1 · 09:00". */
export function describeSchedule(routine: Pick<Routine, "frequency" | "days" | "day_of_month" | "time">) {
  if (routine.frequency === "weekly") {
    const days = WEEK_ORDER.filter((day) => routine.days.includes(day)).map((day) => WEEKDAY_NAMES[day]!);
    const list = days.length > 1 ? `${days.slice(0, -1).join(", ")} e ${days[days.length - 1]}` : (days[0] ?? "semana");
    const every = routine.days.length === 1 && (routine.days[0] === 0 || routine.days[0] === 6) ? "Todo" : "Toda";
    return `${every} ${list} · ${routine.time}`;
  }
  if (routine.frequency === "monthly") return `Todo dia ${routine.day_of_month ?? 1} · ${routine.time}`;
  return `${FREQUENCY_LABELS[routine.frequency]} · ${routine.time}`;
}

const shortWhen = new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
const shortDay = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" });

/** Linha de estado do card: próxima execução, última e se falhou. */
export function routineStatusLine(routine: Routine) {
  if (routine.last_status === "no_access") return "Pausada: o acesso de quem criou foi removido";
  if (!routine.active) return "Pausada";
  const parts = [routine.next_run_at ? `Próxima: ${shortWhen.format(new Date(routine.next_run_at)).replace(".", "")}` : ""];
  if (routine.last_status === "failed") parts.push("não rodou na última vez");
  else if (routine.last_run_at) parts.push(`última: ${shortDay.format(new Date(routine.last_run_at))}`);
  return parts.filter(Boolean).join(" · ");
}

export type RoutineForm = {
  id?: string;
  name: string;
  prompt: string;
  frequency: RoutineFrequency;
  days: number[];
  day_of_month: number;
  time: string;
  active: boolean;
};

export const EMPTY_ROUTINE: RoutineForm = { name: "", prompt: "", frequency: "weekly", days: [1], day_of_month: 1, time: "08:00", active: true };

export function routineForm(routine: Routine): RoutineForm {
  return {
    id: routine.id,
    name: routine.name,
    prompt: routine.prompt,
    frequency: routine.frequency,
    days: [...routine.days],
    day_of_month: routine.day_of_month ?? 1,
    time: routine.time,
    active: routine.active,
  };
}

/** Sugestão do agente (ferramenta sugerir_rotina) no formulário. */
export function routineFormFromSuggestion(value: Record<string, unknown>): RoutineForm | null {
  const frequency = value.frequency;
  if (frequency !== "daily" && frequency !== "weekdays" && frequency !== "weekly" && frequency !== "monthly") return null;
  const time = typeof value.time === "string" && TIME_OPTIONS.includes(value.time) ? value.time : "08:00";
  const days = Array.isArray(value.days) ? value.days.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6) : [];
  const dayOfMonth = Number(value.day_of_month);
  return {
    name: String(value.nome ?? "").slice(0, 80),
    prompt: String(value.pergunta ?? "").slice(0, 600),
    frequency,
    days: frequency === "weekly" && !days.length ? [1] : days,
    day_of_month: Number.isInteger(dayOfMonth) && dayOfMonth >= 1 && dayOfMonth <= 28 ? dayOfMonth : 1,
    time,
    active: true,
  };
}

/** A rotina aberta no editor, pela versão atual da lista ("new" ou nada: nenhuma). */
export function editingRoutine(list: Routine[], editing: string | null) {
  if (!editing || editing === "new") return null;
  return list.find((routine) => routine.id === editing) ?? null;
}

export function routineProblem(form: RoutineForm) {
  if (form.name.trim().length < 2) return "Dê um nome à rotina.";
  if (form.prompt.trim().length < 5) return "Escreva o que o Agent Dute deve responder.";
  if (form.frequency === "weekly" && !form.days.length) return "Escolha ao menos um dia da semana.";
  return null;
}

/** Corpo para saveAgentRoutine (sem undefined: o SDK do Firebase vira null). */
export function routinePayload(form: RoutineForm, agentMessageId?: string) {
  return {
    ...(form.id ? { id: form.id } : {}),
    name: form.name.trim(),
    prompt: form.prompt.trim(),
    frequency: form.frequency,
    ...(form.frequency === "weekly" ? { days: [...new Set(form.days)].sort() } : {}),
    ...(form.frequency === "monthly" ? { day_of_month: form.day_of_month } : {}),
    time: form.time,
    active: form.active,
    ...(agentMessageId ? { agent_message_id: agentMessageId } : {}),
  };
}

// ------------------------------------------------- não lido (neste navegador)

type SeenStorage = Pick<Storage, "getItem" | "setItem">;
const SEEN_KEY = "dute.agent.seen";

function browserStorage(): SeenStorage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

function readSeen(storage: SeenStorage | undefined): Record<string, string> {
  try {
    const parsed = JSON.parse(storage?.getItem(SEEN_KEY) ?? "{}");
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** A conversa foi aberta: o que chegou até agora conta como lido. */
export function markSeen(conversationId: string, lastMessageAt: string, storage = browserStorage()) {
  if (!lastMessageAt) return;
  try {
    const seen = readSeen(storage);
    if ((seen[conversationId] ?? "") >= lastMessageAt) return;
    seen[conversationId] = lastMessageAt;
    storage?.setItem(SEEN_KEY, JSON.stringify(seen));
  } catch {
    // Sem storage (aba privada): tudo aparece como lido.
  }
}

/** Resposta de rotina que chegou depois da última vez que a pessoa abriu a conversa. */
export function isUnreadRoutine(conversation: { id: string; last_message_at: string; routine_id?: string }, storage = browserStorage()) {
  if (!conversation.routine_id || !storage) return false;
  return (readSeen(storage)[conversation.id] ?? "") < conversation.last_message_at;
}
