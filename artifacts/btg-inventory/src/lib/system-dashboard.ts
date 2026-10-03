import { describeSchedule, type RoutineFrequency } from "@/lib/agent-routines";

/**
 * Painel do sistema (functions/src/domain/system-dashboard.ts): os tipos que
 * vêm do servidor e os textos da tela.
 */

export type UsageKind = "chat" | "rotinas" | "leitura_nota";

export type SystemDashboard = {
  generated_at: string;
  settings: { input_per_million: number; output_per_million: number; monthly_budget: number | null };
  usage: {
    priced: boolean;
    month: { cost: number; by_kind: Record<UsageKind, number>; projection: number; budget: number | null; over_budget: boolean };
    days: Array<{ day: string; cost: number; count: number }>;
    week: {
      count: number;
      avg_latency_ms: number | null;
      fallback: number;
      failed: number;
      by_role: Array<{ role: string; count: number; cost: number }>;
    };
    today: { count: number; fallback: number; failed: number };
    problems: Array<{ kind: UsageKind; outcome: "failed" | "fallback"; at: string; error: string }>;
  };
  usage_truncated: boolean;
  routines: {
    list: Array<{
      id: string;
      name: string;
      user_name: string;
      frequency: string;
      days: number[];
      day_of_month: number | null;
      time: string;
      active: boolean;
      last_status: string | null;
      last_run_at: string | null;
      last_attempt_at: string | null;
      last_error: string | null;
    }>;
    active: number;
    failed: number;
    problems: Array<{ name: string; at: string; error: string }>;
  };
};

export const dashboardKey = ["system-dashboard"] as const;

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
export function formatMoney(value: number) {
  return money.format(value);
}

export const KIND_LABELS: Record<UsageKind, string> = { chat: "Chat", rotinas: "Rotinas", leitura_nota: "Leitura de NF" };

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  interno: "Coordenação",
  suporte: "Suporte",
  wms: "WMS",
  financeiro: "Financeiro",
  cliente: "Cliente",
};
export function roleLabel(role: string) {
  return ROLE_LABELS[role] ?? role;
}

/** "Toda segunda · 10:00", com o mesmo texto da coluna Rotinas. */
export function routineSchedule(routine: { frequency: string; days: number[]; day_of_month: number | null; time: string }) {
  const frequency = (["daily", "weekdays", "weekly", "monthly"].includes(routine.frequency) ? routine.frequency : "daily") as RoutineFrequency;
  return describeSchedule({ frequency, days: routine.days, day_of_month: routine.day_of_month, time: routine.time });
}

/** O que deu errado nas últimas 24 h, em uma lista só, da mais recente para a mais antiga. */
export function problemList(dashboard: SystemDashboard) {
  const usage = dashboard.usage.problems.map((problem) => ({
    tag: problem.kind === "rotinas" ? "Rotina" : problem.kind === "leitura_nota" ? "Leitura de NF" : "Agent Dute",
    tone: problem.outcome === "failed" ? ("bad" as const) : ("warn" as const),
    text:
      problem.outcome === "failed"
        ? "Não respondeu: o modelo principal e o reserva falharam"
        : "Respondeu pelo modelo reserva (o principal falhou)",
    detail: problem.error,
    at: problem.at,
  }));
  const routines = dashboard.routines.problems.map((problem) => ({
    tag: "Rotina",
    tone: "bad" as const,
    text: `"${problem.name}" não rodou`,
    detail: problem.error,
    at: problem.at,
  }));
  return [...usage, ...routines].sort((left, right) => right.at.localeCompare(left.at));
}
