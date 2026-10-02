import { createHash, randomUUID } from "node:crypto";

import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";
import { z } from "genkit";

/**
 * Rotinas do Agent Dute: uma pergunta que o agente responde sozinho no
 * horário marcado (todo dia, dia útil, semana ou mês). Só leitura: a rotina
 * roda com as permissões de quem criou e nunca faz pedido nem muda dado. A
 * resposta chega numa conversa própria (routine_<id>). Uma tarefa agendada
 * de 15 em 15 minutos pega as rotinas vencidas (next_run_at <= agora).
 */

export const ROUTINES_COLLECTION = "agent_routines";
export const MAX_ROUTINES_PER_USER = 5;
/** São Paulo não tem horário de verão desde 2019. */
const SAO_PAULO_OFFSET_MS = -3 * 60 * 60 * 1000;
const DAY_MS = 86_400_000;

export const ROUTINE_FREQUENCIES = ["daily", "weekdays", "weekly", "monthly"] as const;
export type RoutineFrequency = (typeof ROUTINE_FREQUENCIES)[number];

export type RoutineSchedule = {
  frequency: RoutineFrequency;
  /** 0 = domingo … 6 = sábado (toda semana). */
  days: number[];
  /** 1 a 28 (todo mês). */
  day_of_month: number | null;
  /** HH:MM, de 15 em 15 minutos, horário de São Paulo. */
  time: string;
};

const TIME = /^([01]\d|2[0-3]):(00|15|30|45)$/;

export const RoutineInputSchema = z
  .object({
    id: z.string().trim().min(1).max(120).nullish(),
    name: z.string().trim().min(2).max(80),
    prompt: z.string().trim().min(5).max(600),
    frequency: z.enum(ROUTINE_FREQUENCIES),
    days: z.array(z.number().int().min(0).max(6)).max(7).nullish(),
    day_of_month: z.number().int().min(1).max(28).nullish(),
    time: z.string().regex(TIME, "Use um horário de 15 em 15 minutos (ex.: 08:00, 08:15)."),
    active: z.boolean().nullish(),
    // Criada pelo cartão do chat: a mensagem que trouxe a sugestão.
    agent_message_id: z.string().trim().min(1).max(160).nullish(),
  })
  .superRefine((input, context) => {
    if (input.frequency === "weekly" && !input.days?.length) {
      context.addIssue({ code: "custom", path: ["days"], message: "Escolha ao menos um dia da semana." });
    }
    if (input.frequency === "monthly" && !input.day_of_month) {
      context.addIssue({ code: "custom", path: ["day_of_month"], message: "Escolha o dia do mês." });
    }
  });

export type RoutineInput = z.infer<typeof RoutineInputSchema>;

export function scheduleOf(input: { frequency: RoutineFrequency; days?: number[] | null; day_of_month?: number | null; time: string }): RoutineSchedule {
  return {
    frequency: input.frequency,
    days: input.frequency === "weekly" ? [...new Set(input.days ?? [])].sort() : [],
    day_of_month: input.frequency === "monthly" ? (input.day_of_month ?? 1) : null,
    time: input.time,
  };
}

function matches(schedule: RoutineSchedule, local: Date) {
  const weekday = local.getUTCDay();
  if (schedule.frequency === "weekdays") return weekday >= 1 && weekday <= 5;
  if (schedule.frequency === "weekly") return schedule.days.includes(weekday);
  if (schedule.frequency === "monthly") return local.getUTCDate() === schedule.day_of_month;
  return true;
}

/** Próximo horário depois de `after`, em UTC. */
export function nextRun(schedule: RoutineSchedule, after: Date) {
  const [hours, minutes] = schedule.time.split(":").map(Number) as [number, number];
  const localNow = new Date(after.getTime() + SAO_PAULO_OFFSET_MS);
  const startOfDay = Date.UTC(localNow.getUTCFullYear(), localNow.getUTCMonth(), localNow.getUTCDate());
  for (let offset = 0; offset <= 62; offset += 1) {
    const localCandidate = new Date(startOfDay + offset * DAY_MS + (hours * 60 + minutes) * 60_000);
    const utc = new Date(localCandidate.getTime() - SAO_PAULO_OFFSET_MS);
    if (utc.getTime() > after.getTime() && matches(schedule, localCandidate)) return utc;
  }
  throw new Error("Agenda sem próxima execução.");
}

// ------------------------------------------------------- sugestão no chat

const DAY_NAMES: Record<string, number> = { dom: 0, seg: 1, ter: 2, qua: 3, qui: 4, sex: 5, sab: 6, "sáb": 6 };

function roundTime(value: string | undefined) {
  const match = /^(\d{1,2})(?::(\d{2}))?/.exec((value ?? "").trim());
  if (!match) return "08:00";
  const hours = Math.min(23, Number(match[1]));
  const minutes = Math.min(45, Math.round(Number(match[2] ?? 0) / 15) * 15);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export type RoutineSuggestionInput = {
  nome: string;
  pergunta: string;
  frequencia: "todo_dia" | "dia_util" | "semanal" | "mensal";
  dias?: string[];
  dia_do_mes?: number;
  horario?: string;
};

/** Sugestão de rotina (ferramenta sugerir_rotina): não cria nada; a pessoa confirma no cartão. */
export function buildRoutineSuggestion(input: RoutineSuggestionInput) {
  const frequency: RoutineFrequency =
    input.frequencia === "todo_dia" ? "daily" : input.frequencia === "dia_util" ? "weekdays" : input.frequencia === "mensal" ? "monthly" : "weekly";
  const days = (input.dias ?? [])
    .map((day) => DAY_NAMES[day.trim().toLowerCase().slice(0, 3)])
    .filter((day): day is number => day !== undefined);
  const schedule = scheduleOf({
    frequency,
    days: frequency === "weekly" && !days.length ? [1] : days,
    day_of_month: Math.min(28, Math.max(1, Math.floor(input.dia_do_mes ?? 1))),
    time: roundTime(input.horario),
  });
  return {
    tipo: "rotina" as const,
    nome: input.nome.trim().slice(0, 80),
    pergunta: input.pergunta.trim().slice(0, 600),
    ...schedule,
    instrucao:
      "Abaixo da resposta aparece um cartão com a rotina; a pessoa confere e cria pelo botão 'Criar rotina'. Você não cria nada. Diga que a rotina só consulta e que a resposta chega numa conversa própria aqui no Agent Dute.",
  };
}

// ---------------------------------------------------------------- gravação

type Owner = { uid: string; customerCode: string; role: string; name?: string };

function routineId(seed: string) {
  return `rot_${createHash("sha256").update(seed).digest("hex").slice(0, 20)}`;
}

/** Cria ou altera uma rotina da própria pessoa. `seed` fixa o id (cartão do chat: a mesma mensagem não cria duas). */
export async function saveRoutine(db: Firestore, owner: Owner, input: RoutineInput, now = new Date(), seed?: string) {
  const schedule = scheduleOf(input);
  const active = input.active ?? true;
  const routines = db.collection(ROUTINES_COLLECTION);
  return db.runTransaction(async (transaction) => {
    const id = input.id ?? routineId(seed ?? `${owner.uid}|${randomUUID()}`);
    const ref = routines.doc(id);
    const existing = await transaction.get(ref);
    if (existing.exists) {
      const data = existing.data() ?? {};
      if (data.user_id !== owner.uid || data.customer_code !== owner.customerCode) {
        throw new HttpsError("permission-denied", "Esta rotina é de outra pessoa.");
      }
    } else {
      if (input.id) throw new HttpsError("not-found", "Rotina não encontrada.");
      const mine = await transaction.get(
        routines.where("user_id", "==", owner.uid).where("customer_code", "==", owner.customerCode).limit(MAX_ROUTINES_PER_USER + 1),
      );
      if (mine.size >= MAX_ROUTINES_PER_USER) {
        throw new HttpsError("failed-precondition", `Você já tem ${MAX_ROUTINES_PER_USER} rotinas. Exclua uma para criar outra.`);
      }
    }
    const nowIso = now.toISOString();
    transaction.set(
      ref,
      {
        id,
        user_id: owner.uid,
        user_name: owner.name ?? null,
        customer_code: owner.customerCode,
        name: input.name,
        prompt: input.prompt,
        ...schedule,
        active,
        next_run_at: active ? nextRun(schedule, now).toISOString() : null,
        conversation_id: `routine_${id}`,
        retry_pending: false,
        updated_at_iso: nowIso,
        ...(existing.exists ? {} : { created_at_iso: nowIso, last_run_at: null, last_status: null }),
        updated_at: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return { id, name: input.name, created: !existing.exists };
  });
}

export async function deleteRoutine(db: Firestore, owner: Owner, id: string) {
  const ref = db.collection(ROUTINES_COLLECTION).doc(id);
  const data = (await ref.get()).data();
  if (!data) throw new HttpsError("not-found", "Rotina não encontrada.");
  if (data.user_id !== owner.uid || data.customer_code !== owner.customerCode) {
    throw new HttpsError("permission-denied", "Esta rotina é de outra pessoa.");
  }
  await ref.delete();
  return { id };
}

export type RoutineView = RoutineSchedule & {
  id: string;
  name: string;
  prompt: string;
  active: boolean;
  next_run_at: string | null;
  last_run_at: string | null;
  last_status: "ok" | "failed" | "no_access" | null;
  conversation_id: string;
  created_at: string;
};

export async function listRoutines(db: Firestore, owner: Owner): Promise<RoutineView[]> {
  const snapshot = await db
    .collection(ROUTINES_COLLECTION)
    .where("user_id", "==", owner.uid)
    .where("customer_code", "==", owner.customerCode)
    .limit(20)
    .get();
  return snapshot.docs
    .map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        name: String(data.name ?? ""),
        prompt: String(data.prompt ?? ""),
        ...scheduleOf({ frequency: data.frequency, days: data.days, day_of_month: data.day_of_month, time: String(data.time ?? "08:00") }),
        active: data.active === true,
        next_run_at: typeof data.next_run_at === "string" ? data.next_run_at : null,
        last_run_at: typeof data.last_run_at === "string" ? data.last_run_at : null,
        last_status: (["ok", "failed", "no_access"].includes(data.last_status) ? data.last_status : null) as RoutineView["last_status"],
        conversation_id: String(data.conversation_id ?? `routine_${doc.id}`),
        created_at: String(data.created_at_iso ?? ""),
      };
    })
    .sort((left, right) => left.created_at.localeCompare(right.created_at));
}

// ---------------------------------------------------------------- execução

export type DueRoutine = {
  id: string;
  user_id: string;
  customer_code: string;
  name: string;
  prompt: string;
  conversation_id: string;
  retry_pending: boolean;
};

/**
 * Pega as rotinas vencidas e já marca a próxima execução, numa transação
 * por rotina: duas execuções da tarefa ao mesmo tempo não rodam a mesma
 * rotina duas vezes. Pausada fica com next_run_at nulo e não entra.
 */
export async function claimDueRoutines(db: Firestore, now: Date, limit = 20): Promise<DueRoutine[]> {
  const nowIso = now.toISOString();
  const snapshot = await db.collection(ROUTINES_COLLECTION).where("next_run_at", "<=", nowIso).limit(limit).get();
  const claimed: DueRoutine[] = [];
  for (const doc of snapshot.docs) {
    const routine = await db.runTransaction(async (transaction) => {
      const fresh = await transaction.get(doc.ref);
      const data = fresh.data();
      if (!data || data.active !== true || typeof data.next_run_at !== "string" || data.next_run_at > nowIso) return null;
      const schedule = scheduleOf({ frequency: data.frequency, days: data.days, day_of_month: data.day_of_month, time: String(data.time) });
      transaction.update(doc.ref, { next_run_at: nextRun(schedule, now).toISOString(), running_since: nowIso });
      return {
        id: doc.id,
        user_id: String(data.user_id),
        customer_code: String(data.customer_code),
        name: String(data.name ?? ""),
        prompt: String(data.prompt ?? ""),
        conversation_id: String(data.conversation_id ?? `routine_${doc.id}`),
        retry_pending: data.retry_pending === true,
      };
    });
    if (routine) claimed.push(routine);
  }
  return claimed;
}

/**
 * Resultado da execução. Falhou pela primeira vez: tenta de novo em 15
 * minutos. Falhou de novo: fica "não rodou" e volta para a agenda normal.
 * Sem acesso (pessoa removida): pausa.
 */
export async function recordRoutineRun(
  db: Firestore,
  routine: DueRoutine,
  outcome: { status: "ok" | "failed" | "no_access"; error?: string },
  now = new Date(),
) {
  const ref = db.collection(ROUTINES_COLLECTION).doc(routine.id);
  const base = { running_since: FieldValue.delete(), last_error: outcome.error?.slice(0, 500) ?? null };
  if (outcome.status === "no_access") {
    await ref.update({ ...base, active: false, next_run_at: null, last_status: "no_access", retry_pending: false });
    return;
  }
  if (outcome.status === "failed" && !routine.retry_pending) {
    await ref.update({ ...base, retry_pending: true, next_run_at: new Date(now.getTime() + 15 * 60_000).toISOString() });
    return;
  }
  await ref.update({
    ...base,
    retry_pending: false,
    last_status: outcome.status,
    ...(outcome.status === "ok" ? { last_run_at: now.toISOString() } : {}),
  });
}

/** Pergunta enviada ao agente: o texto da rotina, com o dia, para ele responder sobre o período certo. */
export function routinePrompt(routine: { name: string; prompt: string }, now: Date) {
  const day = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Sao_Paulo" }).format(now);
  return `${routine.prompt}\n\n(Rotina agendada "${routine.name}", ${day}. Responda direto, sem perguntas de volta: ninguém está esperando na conversa agora.)`;
}
