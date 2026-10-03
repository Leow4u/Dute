import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Settings2 } from "lucide-react";

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  dashboardKey,
  formatMoney,
  KIND_LABELS,
  problemList,
  roleLabel,
  routineSchedule,
  type SystemDashboard,
  type UsageKind,
} from "@/lib/system-dashboard";
import { cn } from "@/lib/utils";

import { InfraSection, InfraTiles } from "./infra-panels";
import { dayTime, fetchJson, field, Health, Panel } from "./parts";

/**
 * Painel do sistema (só owner): custo estimado e uso do Agent Dute, as
 * rotinas de todo mundo e o que deu errado. Atualiza sozinho a cada minuto.
 * Nada da operação (estoque, pedidos) entra aqui.
 */

const KIND_COLORS: Record<UsageKind, string> = { chat: "hsl(var(--agent))", rotinas: "#2f5bd3", leitura_nota: "#c08a1e" };
const shortDay = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" });
const integer = new Intl.NumberFormat("pt-BR");

function DailyBars({ days }: { days: SystemDashboard["usage"]["days"] }) {
  const max = Math.max(...days.map((day) => day.cost), 0.01);
  const width = 420;
  const height = 120;
  const bar = (width - 40) / days.length;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label="Custo por dia nos últimos 14 dias">
      <line x1="34" y1="96" x2={width - 4} y2="96" stroke="hsl(var(--border))" />
      <line x1="34" y1="16" x2={width - 4} y2="16" stroke="hsl(var(--border))" strokeDasharray="3 3" />
      <text x="0" y="99" fontSize="10" fill="hsl(var(--muted-foreground))">0</text>
      <text x="0" y="19" fontSize="10" fill="hsl(var(--muted-foreground))">{max.toFixed(2).replace(".", ",")}</text>
      {days.map((day, index) => {
        const barHeight = (day.cost / max) * 80;
        const last = index === days.length - 1;
        return (
          <rect key={day.day} x={38 + index * bar} y={96 - barHeight} width={bar - 6} height={Math.max(barHeight, day.count ? 1 : 0)} rx="3" fill={last ? "#2f5bd3" : "hsl(var(--agent))"}>
            <title>{`${shortDay.format(new Date(`${day.day}T12:00:00-03:00`))}: ${formatMoney(day.cost)} · ${day.count} respostas`}</title>
          </rect>
        );
      })}
      <text x="38" y="112" fontSize="10" fill="hsl(var(--muted-foreground))">{shortDay.format(new Date(`${days[0]!.day}T12:00:00-03:00`))}</text>
      <text x={width - 30} y="112" fontSize="10" fill="hsl(var(--muted-foreground))">hoje</text>
    </svg>
  );
}

function CostSettingsDialog({ settings, onClose }: { settings: SystemDashboard["settings"]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const show = (value: number | null) => (value ? String(value).replace(".", ",") : "");
  const [input, setInput] = useState(show(settings.input_per_million));
  const [output, setOutput] = useState(show(settings.output_per_million));
  const [budget, setBudget] = useState(show(settings.monthly_budget));
  const parse = (value: string) => Number(value.replace(",", ".") || 0);
  const save = useMutation({
    mutationFn: () =>
      fetchJson("/api/system/agent-costs", {
        method: "POST",
        body: JSON.stringify({ input_per_million: parse(input), output_per_million: parse(output), monthly_budget: parse(budget) || null }),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: dashboardKey });
      toast({ title: "Preços e orçamento salvos" });
      onClose();
    },
    onError: (error: Error) => toast({ title: "Não consegui salvar", description: error.message, variant: "destructive" }),
  });
  const invalid = [input, output, budget].some((value) => value.trim() !== "" && (!Number.isFinite(parse(value)) || parse(value) < 0));
  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="max-w-lg bg-card">
        <DialogHeader>
          <DialogTitle>Preços e orçamento do Agent Dute</DialogTitle>
          <DialogDescription>
            O custo do painel é estimado: tokens de cada resposta × o preço do modelo. Use o preço do Gemini na tabela da Vertex AI, convertido para reais.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5 text-sm font-semibold" htmlFor="cost-input">
            Entrada (R$ por milhão de tokens)
            <input id="cost-input" inputMode="decimal" value={input} onChange={(event) => setInput(event.target.value)} className={field} placeholder="ex.: 1,70" />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-semibold" htmlFor="cost-output">
            Saída (R$ por milhão de tokens)
            <input id="cost-output" inputMode="decimal" value={output} onChange={(event) => setOutput(event.target.value)} className={field} placeholder="ex.: 14,00" />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-semibold sm:col-span-2" htmlFor="cost-budget">
            Orçamento mensal (R$, opcional)
            <input id="cost-budget" inputMode="decimal" value={budget} onChange={(event) => setBudget(event.target.value)} className={field} placeholder="ex.: 100" />
            <span className="text-xs font-normal text-muted-foreground">Quando a projeção do mês passar desse valor, o painel mostra um aviso no topo.</span>
          </label>
        </div>
        <DialogFooter className="gap-2">
          <button type="button" onClick={onClose} className="rounded-xl border border-border bg-card px-3.5 py-2 text-sm font-medium hover:bg-muted">
            Cancelar
          </button>
          <button
            type="button"
            disabled={invalid || save.isPending}
            onClick={() => save.mutate()}
            className="rounded-xl bg-foreground px-4 py-2 text-sm font-semibold text-background hover:bg-foreground/85 disabled:opacity-50"
          >
            {save.isPending ? "Salvando…" : "Salvar"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function OwnerDashboard() {
  const [editingCosts, setEditingCosts] = useState(false);
  const dashboard = useQuery<SystemDashboard, Error>({
    queryKey: dashboardKey,
    queryFn: () => fetchJson<SystemDashboard>("/api/system/dashboard"),
    refetchInterval: 60_000,
  });

  if (dashboard.isLoading) return <p className="text-sm text-muted-foreground">Carregando o painel…</p>;
  if (dashboard.isError || !dashboard.data) {
    return <p className="rounded-[18px] border border-destructive-soft-border bg-destructive-soft px-5 py-4 text-sm text-destructive-soft-foreground">Não consegui carregar o painel: {dashboard.error?.message}</p>;
  }
  const data = dashboard.data;
  const { usage, routines } = data;
  const problems = problemList(data);
  const kinds = Object.keys(KIND_LABELS) as UsageKind[];

  return (
    <div className="space-y-4">
      {usage.month.over_budget ? (
        <p className="flex items-start gap-2 rounded-[14px] border border-warning-soft-border bg-warning-soft px-4 py-3 text-sm text-warning-soft-foreground" role="alert">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          A projeção do mês ({formatMoney(usage.month.projection)}) passou do orçamento de {formatMoney(usage.month.budget ?? 0)}.
        </p>
      ) : null}
      {!usage.priced ? (
        <p className="flex flex-wrap items-center justify-between gap-2 rounded-[14px] border border-border bg-card px-4 py-3 text-sm">
          <span>Para ver o custo em reais, informe o preço do modelo (R$ por milhão de tokens).</span>
          <button type="button" onClick={() => setEditingCosts(true)} className="font-semibold text-primary hover:underline">
            Informar preços
          </button>
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Health
          label="Agent Dute hoje"
          value={`${integer.format(usage.today.count)} ${usage.today.count === 1 ? "resposta" : "respostas"}`}
          detail={`${usage.today.failed} sem resposta · ${usage.today.fallback} no modelo reserva`}
          tone={usage.today.failed ? "bad" : usage.today.fallback ? "warn" : "ok"}
        />
        <Health
          label="Rotinas"
          value={`${routines.active} ${routines.active === 1 ? "ativa" : "ativas"}${routines.failed ? ` · ${routines.failed} falhou` : ""}`}
          detail={`${routines.list.length} no total, de todas as pessoas`}
          tone={routines.failed ? "warn" : "ok"}
        />
        <InfraTiles />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Panel
          title="Custo do Agent Dute no mês"
          note="estimado pelo consumo"
          action={
            <button type="button" onClick={() => setEditingCosts(true)} className="flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
              <Settings2 className="h-4 w-4" aria-hidden="true" /> Preços e orçamento
            </button>
          }
        >
          <div className="flex flex-col gap-3 px-5 py-4">
            <div className="text-[1.7rem] font-bold tabular-nums">
              {formatMoney(usage.month.cost)}{" "}
              <span className="text-sm font-medium text-muted-foreground">
                até hoje · projeção do mês {formatMoney(usage.month.projection)}
                {usage.month.budget ? ` · orçamento ${formatMoney(usage.month.budget)}` : ""}
              </span>
            </div>
            <div className="flex h-3 overflow-hidden rounded-full bg-muted" role="img" aria-label="Divisão do custo do mês">
              {kinds.map((kind) =>
                usage.month.cost > 0 ? (
                  <span key={kind} style={{ width: `${(usage.month.by_kind[kind] / usage.month.cost) * 100}%`, background: KIND_COLORS[kind] }} />
                ) : null,
              )}
            </div>
            <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
              {kinds.map((kind) => (
                <span key={kind} className="flex items-center gap-1.5">
                  <i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: KIND_COLORS[kind] }} />
                  {KIND_LABELS[kind]} {formatMoney(usage.month.by_kind[kind])}
                </span>
              ))}
            </div>
            <DailyBars days={usage.days} />
            {data.usage_truncated ? <p className="text-xs text-warning-soft-foreground">Muitos registros no período: o painel considerou os 20 mil mais antigos.</p> : null}
          </div>
        </Panel>

        <Panel title="Uso do Agent Dute" note="últimos 7 dias">
          <div className="grid grid-cols-2 gap-2 px-5 py-4 sm:grid-cols-4">
            {[
              [integer.format(usage.week.count), "respostas"],
              [usage.week.avg_latency_ms ? `${(usage.week.avg_latency_ms / 1000).toFixed(1).replace(".", ",")} s` : "—", "tempo médio"],
              [usage.week.count ? `${Math.round((usage.week.fallback / usage.week.count) * 100)}%` : "—", "modelo reserva"],
              [integer.format(usage.week.failed), "sem resposta"],
            ].map(([value, label]) => (
              <div key={label} className="rounded-xl bg-muted/60 px-3 py-2">
                <b className="block text-base tabular-nums">{value}</b>
                <span className="text-xs text-muted-foreground">{label}</span>
              </div>
            ))}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-y border-border/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-5 py-2 font-semibold">Perfil</th>
                  <th className="px-5 py-2 font-semibold">Respostas</th>
                  <th className="px-5 py-2 font-semibold">Custo</th>
                </tr>
              </thead>
              <tbody>
                {usage.week.by_role.length ? (
                  usage.week.by_role.map((entry) => (
                    <tr key={entry.role} className="border-b border-border/40 last:border-0">
                      <td className="px-5 py-2">{roleLabel(entry.role)}</td>
                      <td className="px-5 py-2 tabular-nums">{integer.format(entry.count)}</td>
                      <td className="px-5 py-2 tabular-nums">{formatMoney(entry.cost)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={3} className="px-5 py-3 text-muted-foreground">
                      Sem uso nos últimos 7 dias.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Rotinas" note="todas as pessoas">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-5 py-2 font-semibold">Rotina</th>
                  <th className="px-5 py-2 font-semibold">De quem</th>
                  <th className="px-5 py-2 font-semibold">Agenda</th>
                  <th className="px-5 py-2 font-semibold">Última</th>
                </tr>
              </thead>
              <tbody>
                {routines.list.length ? (
                  routines.list.map((routine) => {
                    const state = !routine.active
                      ? { label: routine.last_status === "no_access" ? "pausada (sem acesso)" : "pausada", tone: "bg-muted text-muted-foreground" }
                      : routine.last_status === "failed"
                        ? { label: `falhou${routine.last_attempt_at ? ` · ${shortDay.format(new Date(routine.last_attempt_at))}` : ""}`, tone: "bg-destructive-soft text-destructive-soft-foreground" }
                        : routine.last_run_at
                          ? { label: `ok · ${shortDay.format(new Date(routine.last_run_at))}`, tone: "bg-success-soft text-success-soft-foreground" }
                          : { label: "ainda não rodou", tone: "bg-muted text-muted-foreground" };
                    return (
                      <tr key={routine.id} className="border-b border-border/40 last:border-0">
                        <td className="px-5 py-2">{routine.name}</td>
                        <td className="px-5 py-2 text-muted-foreground">{routine.user_name}</td>
                        <td className="whitespace-nowrap px-5 py-2 text-muted-foreground">{routineSchedule(routine)}</td>
                        <td className="px-5 py-2">
                          <span className={cn("whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold", state.tone)}>{state.label}</span>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={4} className="px-5 py-3 text-muted-foreground">
                      Ninguém criou rotina ainda.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title="O que deu errado" note="últimas 24 h">
          {problems.length ? (
            <ul>
              {problems.map((problem, index) => (
                <li key={`${problem.at}-${index}`} className="flex items-start gap-3 border-b border-border/40 px-5 py-3 text-sm last:border-0">
                  <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold", problem.tone === "bad" ? "bg-destructive-soft text-destructive-soft-foreground" : "bg-warning-soft text-warning-soft-foreground")}>
                    {problem.tag}
                  </span>
                  <span className="min-w-0 flex-1">
                    {problem.text}
                    {problem.detail ? <span className="mt-0.5 block truncate text-xs text-muted-foreground" title={problem.detail}>{problem.detail}</span> : null}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">{dayTime.format(new Date(problem.at))}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-5 py-4 text-sm text-muted-foreground">Nada deu errado nas últimas 24 h.</p>
          )}
        </Panel>
      </div>

      <InfraSection agentMonthCost={usage.priced ? usage.month.cost : null} />

      {editingCosts ? <CostSettingsDialog settings={data.settings} onClose={() => setEditingCosts(false)} /> : null}
    </div>
  );
}
