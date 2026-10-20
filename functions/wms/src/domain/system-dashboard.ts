import type { Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";
import { z } from "genkit";

/**
 * Painel do sistema (Configuração > Sistema, só owner): custo estimado e uso
 * do Agent Dute, rotinas de todo mundo e o que deu errado. Tudo sai do que
 * o sistema já grava: agent_usage (cada resposta, leitura de NF e rotina,
 * com tokens) e agent_routines. O custo é estimado: tokens × preço por
 * milhão que o owner informa na tela (system_settings/agent_costs).
 */

export const DASHBOARD_ROLES = ["owner"];
export const COST_SETTINGS_DOC = { collection: "system_settings", id: "agent_costs" } as const;
const USAGE_LIMIT = 20_000;
const DAY_MS = 86_400_000;
const SAO_PAULO_OFFSET_MS = -3 * 3_600_000;

export const CostSettingsSchema = z.object({
  input_per_million: z.number().min(0).max(10_000),
  output_per_million: z.number().min(0).max(10_000),
  monthly_budget: z.number().min(0).max(1_000_000).nullish(),
});

export type CostSettings = { input_per_million: number; output_per_million: number; monthly_budget: number | null };

export function assertOwner(role: string) {
  if (!DASHBOARD_ROLES.includes(role)) {
    throw new HttpsError("permission-denied", "Painel do sistema disponível só para o owner.");
  }
}

export type UsageRow = {
  created_at_iso: string;
  source: string;
  role: string;
  model: string | null;
  input_tokens: number;
  output_tokens: number;
  latency_ms: number | null;
  error: string | null;
};

export type UsageKind = "chat" | "rotinas" | "leitura_nota";

export function usageKind(source: string): UsageKind {
  if (source === "rotina") return "rotinas";
  if (source.startsWith("leitura_nota")) return "leitura_nota";
  return "chat";
}

/** Sem resposta (os dois modelos falharam), no modelo reserva, ou normal. */
export function usageOutcome(row: UsageRow): "failed" | "fallback" | "ok" {
  if (row.source === "fallback_indisponivel") return "failed";
  return row.error ? "fallback" : "ok";
}

export function costOf(row: Pick<UsageRow, "input_tokens" | "output_tokens">, settings: CostSettings) {
  return (row.input_tokens * settings.input_per_million + row.output_tokens * settings.output_per_million) / 1_000_000;
}

/** Dia (AAAA-MM-DD) em São Paulo. */
function localDay(date: Date) {
  return new Date(date.getTime() + SAO_PAULO_OFFSET_MS).toISOString().slice(0, 10);
}

function monthStart(now: Date) {
  const local = new Date(now.getTime() + SAO_PAULO_OFFSET_MS);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - SAO_PAULO_OFFSET_MS);
}

function daysInMonth(now: Date) {
  const local = new Date(now.getTime() + SAO_PAULO_OFFSET_MS);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 0)).getUTCDate();
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/** Resumo do uso: mês (custo, projeção, orçamento), 14 dias por dia, 7 dias por perfil, hoje e as falhas de 24 h. */
export function summarizeUsage(rows: UsageRow[], settings: CostSettings, now: Date) {
  const start = monthStart(now).toISOString();
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS).toISOString();
  const dayAgo = new Date(now.getTime() - DAY_MS).toISOString();
  const today = localDay(now);

  const month = rows.filter((row) => row.created_at_iso >= start);
  const byKind: Record<UsageKind, number> = { chat: 0, rotinas: 0, leitura_nota: 0 };
  for (const row of month) byKind[usageKind(row.source)] += costOf(row, settings);
  const monthCost = byKind.chat + byKind.rotinas + byKind.leitura_nota;
  const elapsedDays = Math.max(1, (now.getTime() - monthStart(now).getTime()) / DAY_MS);
  const projection = (monthCost / elapsedDays) * daysInMonth(now);

  const days: Array<{ day: string; cost: number; count: number }> = [];
  for (let offset = 13; offset >= 0; offset -= 1) {
    days.push({ day: localDay(new Date(now.getTime() - offset * DAY_MS)), cost: 0, count: 0 });
  }
  const dayIndex = new Map(days.map((entry, index) => [entry.day, index]));
  for (const row of rows) {
    const index = dayIndex.get(localDay(new Date(row.created_at_iso)));
    if (index === undefined) continue;
    days[index]!.cost += costOf(row, settings);
    days[index]!.count += 1;
  }

  const week = rows.filter((row) => row.created_at_iso >= weekAgo);
  const roles = new Map<string, { role: string; count: number; cost: number }>();
  for (const row of week) {
    const current = roles.get(row.role) ?? { role: row.role, count: 0, cost: 0 };
    current.count += 1;
    current.cost += costOf(row, settings);
    roles.set(row.role, current);
  }
  const latencies = week.map((row) => row.latency_ms).filter((value): value is number => typeof value === "number" && value > 0);

  const todayRows = rows.filter((row) => localDay(new Date(row.created_at_iso)) === today);
  const problems = rows
    .filter((row) => row.created_at_iso >= dayAgo && usageOutcome(row) !== "ok")
    .map((row) => ({ kind: usageKind(row.source), outcome: usageOutcome(row), at: row.created_at_iso, error: (row.error ?? "").slice(0, 300) }));

  return {
    priced: settings.input_per_million > 0 || settings.output_per_million > 0,
    month: {
      cost: round2(monthCost),
      by_kind: { chat: round2(byKind.chat), rotinas: round2(byKind.rotinas), leitura_nota: round2(byKind.leitura_nota) },
      projection: round2(projection),
      budget: settings.monthly_budget,
      over_budget: settings.monthly_budget !== null && settings.monthly_budget > 0 && projection > settings.monthly_budget,
    },
    days: days.map((entry) => ({ ...entry, cost: round2(entry.cost) })),
    week: {
      count: week.length,
      avg_latency_ms: latencies.length ? Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length) : null,
      fallback: week.filter((row) => usageOutcome(row) === "fallback").length,
      failed: week.filter((row) => usageOutcome(row) === "failed").length,
      by_role: [...roles.values()].map((entry) => ({ ...entry, cost: round2(entry.cost) })).sort((left, right) => right.count - left.count),
    },
    today: {
      count: todayRows.length,
      fallback: todayRows.filter((row) => usageOutcome(row) === "fallback").length,
      failed: todayRows.filter((row) => usageOutcome(row) === "failed").length,
    },
    problems: problems.sort((left, right) => right.at.localeCompare(left.at)).slice(0, 20),
  };
}

function num(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

export async function readCostSettings(db: Firestore): Promise<CostSettings> {
  const data = (await db.collection(COST_SETTINGS_DOC.collection).doc(COST_SETTINGS_DOC.id).get()).data() ?? {};
  return {
    input_per_million: num(data.input_per_million),
    output_per_million: num(data.output_per_million),
    monthly_budget: typeof data.monthly_budget === "number" && data.monthly_budget > 0 ? data.monthly_budget : null,
  };
}

export async function saveCostSettings(db: Firestore, actor: { uid: string; role: string }, input: z.infer<typeof CostSettingsSchema>) {
  assertOwner(actor.role);
  const settings: CostSettings = {
    input_per_million: input.input_per_million,
    output_per_million: input.output_per_million,
    monthly_budget: input.monthly_budget && input.monthly_budget > 0 ? input.monthly_budget : null,
  };
  await db
    .collection(COST_SETTINGS_DOC.collection)
    .doc(COST_SETTINGS_DOC.id)
    .set({ ...settings, updated_by: actor.uid, updated_at_iso: new Date().toISOString() });
  return settings;
}

/** Painel inteiro: uso e custo (desde o início do mês ou 14 dias, o que vier antes) e as rotinas de todo mundo. */
export async function readSystemDashboard(db: Firestore, actor: { role: string }, now = new Date()) {
  assertOwner(actor.role);
  const since = new Date(Math.min(monthStart(now).getTime(), now.getTime() - 14 * DAY_MS)).toISOString();
  const [settings, usage, routines] = await Promise.all([
    readCostSettings(db),
    db.collection("agent_usage").where("created_at_iso", ">=", since).limit(USAGE_LIMIT).get(),
    db.collection("agent_routines").limit(500).get(),
  ]);
  const rows: UsageRow[] = usage.docs.map((doc) => {
    const data = doc.data();
    return {
      created_at_iso: text(data.created_at_iso),
      source: text(data.source),
      role: text(data.role) || "desconhecido",
      model: text(data.model) || null,
      input_tokens: num(data.input_tokens),
      output_tokens: num(data.output_tokens),
      latency_ms: typeof data.latency_ms === "number" ? data.latency_ms : null,
      error: text(data.error) || null,
    };
  });
  const dayAgo = new Date(now.getTime() - DAY_MS).toISOString();
  const routineViews = routines.docs
    .map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        name: text(data.name),
        user_name: text(data.user_name) || "—",
        frequency: text(data.frequency),
        days: Array.isArray(data.days) ? data.days.map(Number) : [],
        day_of_month: typeof data.day_of_month === "number" ? data.day_of_month : null,
        time: text(data.time),
        active: data.active === true,
        last_status: text(data.last_status) || null,
        last_run_at: text(data.last_run_at) || null,
        last_attempt_at: text(data.last_attempt_at) || null,
        last_error: text(data.last_error) || null,
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name, "pt-BR"));
  const routineProblems = routineViews
    .filter((routine) => routine.last_status === "failed" && (routine.last_attempt_at ?? "") >= dayAgo)
    .map((routine) => ({ name: routine.name, at: routine.last_attempt_at!, error: (routine.last_error ?? "").slice(0, 300) }));

  return {
    generated_at: now.toISOString(),
    settings,
    usage: summarizeUsage(rows, settings, now),
    usage_truncated: usage.size >= USAGE_LIMIT,
    routines: {
      list: routineViews,
      active: routineViews.filter((routine) => routine.active).length,
      failed: routineViews.filter((routine) => routine.last_status === "failed").length,
      problems: routineProblems,
    },
  };
}
