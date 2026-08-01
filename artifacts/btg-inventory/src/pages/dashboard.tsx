import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useGetDashboard } from "@workspace/api-client-react";
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  Boxes,
  ClipboardList,
  Gauge,
  Package,
  Radar,
  Receipt,
  ShieldCheck,
  Sparkles,
  TimerReset,
  Truck,
  Warehouse,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Link } from "wouter";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type AnyRecord = Record<string, any>;

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.message ?? "Falha ao carregar dados.");
  }
  return response.json() as Promise<T>;
}

function toNumber(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function formatNumber(value: unknown) {
  return toNumber(value).toLocaleString("pt-BR");
}

function formatCurrency(value: unknown) {
  return toNumber(value).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  });
}

function formatDate(value: unknown) {
  if (!value) return "Sem data";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "Sem data";
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusTone(value: number) {
  if (value > 0) return "attention";
  return "stable";
}

function normalizeText(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function toList(value: unknown): AnyRecord[] {
  if (Array.isArray(value)) return value as AnyRecord[];
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).map(([key, raw]) => {
      if (raw && typeof raw === "object") return { key, ...(raw as AnyRecord) };
      return { key, value: raw };
    });
  }
  return [];
}

function firstMetric(metrics: AnyRecord | undefined, fallback: number, ...keys: string[]) {
  for (const key of keys) {
    const parsed = toNumber(metrics?.[key], Number.NaN);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function isTerminalStatus(value: unknown) {
  return [
    "completed",
    "delivered",
    "received",
    "closed",
    "cancelled",
    "canceled",
    "resolved",
    "concluido",
    "concluida",
    "encerrado",
    "encerrada",
  ].includes(normalizeText(value));
}

function isOpenRequestStatus(value: unknown) {
  return [
    "open",
    "aberta",
    "aberto",
    "submitted",
    "enviada",
    "enviado",
    "pending",
    "pendente",
    "em analise",
  ].includes(normalizeText(value));
}

function isDueSoon(value: unknown) {
  if (!value) return false;
  const dueTime = new Date(String(value)).getTime();
  if (Number.isNaN(dueTime)) return false;
  return dueTime - Date.now() <= 4 * 60 * 60 * 1000;
}

function queueLabel(queue: AnyRecord) {
  const key = String(queue.label ?? queue.name ?? queue.key ?? "Fila");
  const aliases: Record<string, string> = {
    receiving: "Recebimento",
    inbound: "Recebimento",
    putaway: "Putaway",
    picking: "Picking",
    packing: "Packing",
    expedition: "Expedição",
    shipping: "Expedição",
  };
  return aliases[normalizeText(key)] ?? key;
}

function MetricCard({
  title,
  value,
  caption,
  icon: Icon,
  tone = "stable",
}: {
  title: string;
  value: string;
  caption?: string;
  icon: typeof Package;
  tone?: "stable" | "attention" | "critical";
}) {
  return (
    <Card
      className={cn(
        "min-h-[120px]",
        tone === "critical" && "border-destructive/20",
        tone === "attention" && "border-primary/25",
      )}
    >
      <CardContent className="flex h-full flex-col justify-between gap-3 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="text-sm font-medium text-foreground/70">
              {title}
            </CardTitle>
            <div className="mt-2 text-2xl font-semibold text-foreground">
              {value}
            </div>
          </div>
          <div className="flex size-10 shrink-0 items-center justify-center rounded-[16px] border border-border bg-white/65">
            <Icon className="size-4 text-primary" aria-hidden="true" />
          </div>
        </div>
        {caption ? (
          <p className="text-sm leading-5 text-foreground/65">{caption}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ControlSignal({
  label,
  value,
  caption,
  icon: Icon,
}: {
  label: string;
  value: string;
  caption?: string;
  icon: typeof Package;
}) {
  return (
    <div className="rounded-[20px] border border-border bg-white/58 p-4 shadow-[0_8px_24px_rgba(15,23,42,.03)] backdrop-blur-[32px]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-foreground/70">
            {label}
          </p>
          <p className="mt-2 text-xl font-semibold text-foreground">{value}</p>
          {caption ? (
            <p className="mt-1 text-sm leading-5 text-foreground/65">{caption}</p>
          ) : null}
        </div>
        <div className="flex size-9 items-center justify-center rounded-[14px] border border-border bg-white/70">
          <Icon className="size-4 text-primary" aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}

function WorkstreamCard({
  title,
  value,
  total,
  href,
  icon: Icon,
}: {
  title: string;
  value: number;
  total: number;
  href: string;
  icon: typeof Package;
}) {
  const progress = total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0;
  return (
    <Card>
      <CardContent className="flex flex-col gap-4 pt-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-[16px] border border-border bg-white/65">
              <Icon className="size-4 text-primary" aria-hidden="true" />
            </div>
            <div className="text-sm font-medium text-foreground">{title}</div>
          </div>
          <Badge variant="outline">{formatNumber(value)}</Badge>
        </div>
        <Progress value={progress} className="h-2" />
        <Button asChild variant="outline" size="sm" className="w-full justify-between">
          <Link href={href}>
            Abrir módulo
            <ArrowRight data-icon="inline-end" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function LoadingState() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-36 rounded-[28px]" />
      <div className="grid gap-4 md:grid-cols-4">
        {[0, 1, 2, 3].map((item) => (
          <Skeleton key={item} className="h-32 rounded-[24px]" />
        ))}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const dashboard = useGetDashboard();
  const ai = useQuery({
    queryKey: ["ai-overview"],
    queryFn: () => fetchJson<AnyRecord>("/api/ai/overview"),
    refetchInterval: 120_000,
    refetchOnWindowFocus: false,
  });
  const wms = useQuery({
    queryKey: ["warehouse-ops"],
    queryFn: () => fetchJson<AnyRecord>("/api/warehouse/ops"),
    refetchInterval: 120_000,
    refetchOnWindowFocus: false,
  });
  const requests = useQuery({
    queryKey: ["customer-requests", "control-tower"],
    queryFn: () => fetchJson<{ items?: AnyRecord[] }>("/api/customer-requests?limit=80"),
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
  });

  const derived = useMemo(() => {
    const data = dashboard.data as AnyRecord | undefined;
    const metrics = (wms.data?.metrics ?? {}) as AnyRecord;
    const queues = toList(wms.data?.queues);
    const queueSummaries = queues.map((queue) => {
      const tasks = toList(queue.tasks ?? queue.items);
      const activeTasks = tasks.filter((task) => !isTerminalStatus(task.status));
      const pending = toNumber(queue.pending, activeTasks.length);
      const completedToday = toNumber(queue.completed_today ?? queue.completedToday);
      const baseTotal = pending + completedToday;

      return {
        key: String(queue.key ?? queue.name ?? "fila"),
        label: queueLabel(queue),
        pending,
        inProgress: toNumber(queue.in_progress ?? queue.inProgress),
        completedToday,
        dueSoon: activeTasks.filter((task) => isDueSoon(task.due_at)).length,
        blocked: activeTasks.filter(
          (task) => Boolean(task.blocked_reason) || toNumber(task.exception_count) > 0,
        ).length,
        progress:
          baseTotal > 0
            ? Math.min(100, Math.round((completedToday / baseTotal) * 100))
            : toNumber(queue.utilization),
        nextAction:
          queue.next_action ??
          queue.nextAction ??
          activeTasks[0]?.next_action ??
          "Manter fila monitorada e priorizar a próxima tarefa com SLA curto.",
        tasks: activeTasks,
      };
    });
    const queueTasks = queueSummaries.flatMap((queue) =>
      queue.tasks.map((task) => ({ ...task, queue: queue.label })),
    );
    const alerts = [
      ...(Array.isArray(wms.data?.alerts) ? wms.data.alerts : []),
      ...(Array.isArray(ai.data?.inbox) ? ai.data.inbox : []),
    ];
    const requestRows = requests.data?.items ?? [];
    const openRequests = requestRows.filter((request) => isOpenRequestStatus(request.status));
    const criticalAlerts = alerts.filter((alert: AnyRecord) =>
      ["critical", "critico", "crítico", "high", "alta"].includes(
        normalizeText(alert.severity ?? alert.priority),
      ),
    );
    const blockedTasks = queueTasks.filter((task: AnyRecord) =>
      Boolean(task.blocked_reason) || toNumber(task.exception_count) > 0,
    );
    const inferredPending = queueSummaries.reduce((sum, queue) => sum + queue.pending, 0);
    const inferredThroughput = queueSummaries.reduce(
      (sum, queue) => sum + queue.completedToday,
      0,
    );

    return {
      data,
      queueSummaries,
      queueTasks,
      alerts,
      requestRows,
      openRequests,
      criticalAlerts,
      blockedTasks,
      wmsPending: firstMetric(metrics, inferredPending, "pending_total", "pendingTotal"),
      throughputToday: firstMetric(
        metrics,
        inferredThroughput,
        "throughput_today",
        "throughputToday",
      ),
      dueSoon: firstMetric(
        metrics,
        queueSummaries.reduce((sum, queue) => sum + queue.dueSoon, 0),
        "due_soon",
        "dueSoon",
      ),
      agentOpen: toNumber(ai.data?.snapshot?.open_insights, alerts.length),
      inventoryValue: toNumber(data?.custo_total ?? ai.data?.snapshot?.inventory_value),
      pieces: toNumber(data?.total_pecas ?? ai.data?.snapshot?.total_pieces),
      skuTotal: toNumber(data?.total_skus),
      categoryRows: Array.isArray(data?.by_category) ? data.by_category : [],
      recentMovements: Array.isArray(data?.recent_movements) ? data.recent_movements : [],
    };
  }, [ai.data, dashboard.data, requests.data, wms.data]);

  if (dashboard.isLoading && !dashboard.data) return <LoadingState />;

  const operationalHealth =
    derived.criticalAlerts.length > 0
      ? "Crítico"
      : derived.blockedTasks.length > 0 || derived.openRequests.length > 0
        ? "Atenção"
        : "Estável";
  const sourceIssues = [
    dashboard.error || !dashboard.data ? "estoque" : null,
    ai.isError ? "IA" : null,
    wms.isError ? "WMS" : null,
    requests.isError ? "solicitações" : null,
  ].filter((item): item is string => Boolean(item));

  const defaultQueueAction =
    "Manter fila monitorada e priorizar a próxima tarefa com SLA curto.";
  const allQueuesStable =
    derived.queueSummaries.length > 0 &&
    derived.queueSummaries.every(
      (queue) => queue.pending === 0 && queue.blocked === 0 && queue.dueSoon === 0,
    );

  return (
    <div className="flex flex-col gap-5">
      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_430px]">
        <div className="glass-surface rounded-[28px] p-6 md:p-7">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl">
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant="outline"
                  className={cn(
                    operationalHealth === "Crítico" &&
                      "border-destructive/20 bg-destructive/10 text-destructive",
                    operationalHealth === "Atenção" &&
                      "border-amber-200 bg-amber-50 text-amber-800",
                    operationalHealth === "Estável" &&
                      "border-emerald-200 bg-emerald-50 text-emerald-700",
                  )}
                >
                  {operationalHealth}
                </Badge>
              </div>
              <h1 className="mt-4 text-2xl font-semibold tracking-normal text-foreground md:text-3xl">
                Comando operacional
              </h1>
            </div>
            <Button asChild variant="outline" className="shrink-0 justify-between">
              <Link href="/wms">
                Abrir bancada WMS
                <ArrowRight data-icon="inline-end" />
              </Link>
            </Button>
          </div>

          <div className="mt-6 grid gap-3 md:grid-cols-3">
            <ControlSignal
              label="Valor monitorado"
              value={formatCurrency(derived.inventoryValue)}
              icon={Gauge}
            />
            <ControlSignal
              label="Peças no radar"
              value={formatNumber(derived.pieces)}
              caption={`${formatNumber(derived.skuTotal)} SKUs ativos`}
              icon={Boxes}
            />
            <ControlSignal
              label="Último evento"
              value={formatDate(ai.data?.snapshot?.last_event_at)}
              icon={TimerReset}
            />
          </div>
        </div>

        <Card className="border-primary/15 bg-primary/5">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-4">
              <CardTitle className="text-base">Próxima decisão</CardTitle>
              <Radar className="size-5 text-primary" aria-hidden="true" />
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-[20px] border border-border bg-white/65 p-4">
              <p className="text-sm font-semibold text-foreground">
                {derived.criticalAlerts.length > 0
                  ? "Revisar alerta crítico do Agent Dute"
                  : derived.blockedTasks.length > 0
                    ? "Tratar bloqueio físico no WMS"
                    : derived.openRequests.length > 0
                      ? "Priorizar solicitação aberta"
                      : "Manter fila WMS monitorada"}
              </p>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {derived.criticalAlerts[0]?.message ??
                  derived.criticalAlerts[0]?.title ??
                  (derived.blockedTasks[0] as AnyRecord | undefined)
                    ?.blocked_reason ??
                  derived.openRequests[0]?.description ??
                  "Nenhum gargalo crítico identificado nesta leitura."}
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <div className="rounded-[16px] border border-border bg-white/58 p-3">
                <div className="text-lg font-semibold text-foreground">
                  {formatNumber(derived.dueSoon)}
                </div>
                <div className="text-foreground/70">SLA próximo</div>
              </div>
              <div className="rounded-[16px] border border-border bg-white/58 p-3">
                <div className="text-lg font-semibold text-foreground">
                  {formatNumber(derived.blockedTasks.length)}
                </div>
                <div className="text-foreground/70">Bloqueios</div>
              </div>
              <div className="rounded-[16px] border border-border bg-white/58 p-3">
                <div className="text-lg font-semibold text-foreground">
                  {formatNumber(derived.agentOpen)}
                </div>
                <div className="text-foreground/70">Alertas IA</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      {sourceIssues.length > 0 ? (
        <Alert className="border-amber-200 bg-amber-50/80 text-amber-900">
          <AlertTriangle className="size-4" />
          <AlertTitle>Dados parciais na Torre de Controle</AlertTitle>
          <AlertDescription>
            Fonte(s) em fallback: {sourceIssues.join(", ")}. A tela mantém a operação
            visível com os dados disponíveis.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <MetricCard
          title="SKUs ativos"
          value={formatNumber(derived.skuTotal)}
          icon={Boxes}
        />
        <MetricCard
          title="Solicitações abertas"
          value={formatNumber(derived.openRequests.length)}
          icon={ClipboardList}
          tone={statusTone(derived.openRequests.length)}
        />
        <MetricCard
          title="WMS pendente"
          value={formatNumber(derived.wmsPending)}
          caption={`${formatNumber(derived.throughputToday)} concluídas hoje`}
          icon={Warehouse}
          tone={statusTone(derived.wmsPending)}
        />
        <MetricCard
          title="Alertas IA"
          value={formatNumber(derived.agentOpen)}
          icon={Bot}
          tone={statusTone(derived.agentOpen)}
        />
        <MetricCard
          title="Bloqueios físicos"
          value={formatNumber(derived.blockedTasks.length)}
          icon={ShieldCheck}
          tone={derived.blockedTasks.length ? "critical" : "stable"}
        />
      </div>

      <Card>
        <CardHeader className="border-b border-border/60">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <CardTitle className="text-base">Filas WMS</CardTitle>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">{formatNumber(derived.dueSoon)} SLA próximo</Badge>
              <Badge variant="outline">
                {formatNumber(derived.throughputToday)} concluídas hoje
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 pt-5 md:grid-cols-2 2xl:grid-cols-5">
          {derived.queueSummaries.length === 0 ? (
            <div className="rounded-[18px] border border-border bg-white/55 p-5 text-sm text-foreground/70 md:col-span-2 2xl:col-span-5">
              Nenhuma fila WMS disponível nesta leitura.
            </div>
          ) : allQueuesStable ? (
            <div className="rounded-[18px] border border-emerald-200 bg-emerald-50/45 p-5 text-sm text-foreground/80 md:col-span-2 2xl:col-span-5">
              Operação estável — nenhuma pendência nas filas WMS.
            </div>
          ) : (
            derived.queueSummaries.map((queue) => {
              const nextAction = String(queue.nextAction);
              const showNextAction =
                nextAction.length > 0 && nextAction !== defaultQueueAction;

              return (
              <div
                key={queue.key}
                className={cn(
                  "flex min-h-[178px] flex-col rounded-[20px] border border-border bg-white/58 p-4 transition-colors duration-200",
                  queue.blocked > 0 && "border-destructive/20 bg-destructive/5",
                  queue.dueSoon > 0 && !queue.blocked && "border-amber-200 bg-amber-50/45",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-foreground">
                      {queue.label}
                    </div>
                    <div className="mt-1 text-xs text-foreground/70">
                      {formatNumber(queue.inProgress)} em execução
                    </div>
                  </div>
                  <Badge
                    variant="outline"
                    className={cn(
                      queue.blocked > 0 &&
                        "border-destructive/20 bg-destructive/10 text-destructive",
                      queue.dueSoon > 0 &&
                        !queue.blocked &&
                        "border-amber-200 bg-amber-50 text-amber-800",
                    )}
                  >
                    {formatNumber(queue.pending)} pendentes
                  </Badge>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="rounded-[14px] bg-white/65 p-2">
                    <div className="font-semibold text-foreground">{formatNumber(queue.dueSoon)}</div>
                    <div className="text-foreground/70">SLA</div>
                  </div>
                  <div className="rounded-[14px] bg-white/65 p-2">
                    <div className="font-semibold text-foreground">{formatNumber(queue.blocked)}</div>
                    <div className="text-foreground/70">Exceções</div>
                  </div>
                  <div className="rounded-[14px] bg-white/65 p-2">
                    <div className="font-semibold text-foreground">
                      {formatNumber(queue.completedToday)}
                    </div>
                    <div className="text-foreground/70">Hoje</div>
                  </div>
                </div>
                <Progress value={queue.progress} className="mt-4 h-2" />
                {showNextAction ? (
                  <p className="mt-4 line-clamp-2 text-xs leading-5 text-foreground/70">
                    {nextAction}
                  </p>
                ) : null}
                <Button asChild variant="ghost" size="sm" className="mt-auto justify-between px-0 pt-4">
                  <Link href="/wms">
                    Ir para fila
                    <ArrowRight data-icon="inline-end" />
                  </Link>
                </Button>
              </div>
              );
            })
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[1.1fr_.9fr]">
        <Card>
          <CardHeader className="border-b border-border/60">
            <div className="flex items-start justify-between gap-4">
              <CardTitle className="text-base">Radar de decisão</CardTitle>
              <Radar className="size-5 text-primary" aria-hidden="true" />
            </div>
          </CardHeader>
          <CardContent className="space-y-3 pt-5">
            {[...derived.criticalAlerts, ...derived.blockedTasks, ...derived.openRequests]
              .slice(0, 8)
              .map((item: AnyRecord, index) => (
                <div
                  key={item.id ?? index}
                  className="flex items-start justify-between gap-4 rounded-[18px] border border-border bg-white/55 p-4"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-foreground">
                      {item.title ?? item.message ?? item.description ?? item.reference ?? item.protocol ?? "Ponto de atenção"}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {item.queue ?? item.entity_type ?? item.type ?? item.status ?? "Operação"}
                    </div>
                  </div>
                  <Badge variant="outline">{item.severity ?? item.priority ?? item.status ?? "aberto"}</Badge>
                </div>
              ))}
            {!derived.criticalAlerts.length && !derived.blockedTasks.length && !derived.openRequests.length ? (
              <div className="rounded-[18px] border border-border bg-white/55 p-5 text-sm text-muted-foreground">
                Nenhum risco operacional aberto agora.
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b border-border/60">
            <CardTitle className="text-base">Módulos críticos</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 pt-5">
            <WorkstreamCard
              title="Solicitações"
              value={derived.openRequests.length}
              total={Math.max(1, derived.requestRows.length)}
              href="/solicitacoes"
              icon={ClipboardList}
            />
            <WorkstreamCard
              title="WMS físico"
              value={derived.wmsPending}
              total={Math.max(1, derived.queueTasks.length)}
              href="/wms"
              icon={Truck}
            />
            <WorkstreamCard
              title="Agent Dute"
              value={derived.agentOpen}
              total={Math.max(1, derived.alerts.length)}
              href="/agente"
              icon={Sparkles}
            />
            <WorkstreamCard
              title="Faturamento"
              value={toNumber(derived.data?.ad_valorem)}
              total={Math.max(1, toNumber(derived.data?.custo_total))}
              href="/faturamento"
              icon={Receipt}
            />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[.9fr_1.1fr]">
        <Card>
          <CardHeader className="border-b border-border/60">
            <CardTitle className="text-base">Estoque por categoria</CardTitle>
          </CardHeader>
          <CardContent className="pt-5">
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={derived.categoryRows.slice(0, 12)} margin={{ top: 10, right: 12, left: -18, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E8EBEF" />
                  <XAxis dataKey="categoria" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "#64748B" }} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "#64748B" }} />
                  <RechartsTooltip cursor={{ fill: "rgba(241,244,248,.72)" }} contentStyle={{ borderRadius: 16, border: "1px solid #E8EBEF", boxShadow: "0 18px 60px rgba(15,23,42,.05)" }} />
                  <Bar dataKey="total_pecas" fill="hsl(var(--primary))" radius={[10, 10, 0, 0]} maxBarSize={44} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b border-border/60">
            <CardTitle className="text-base">Movimentos recentes</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-border bg-white/45 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">Data</th>
                    <th className="px-4 py-3 font-medium">Tipo</th>
                    <th className="px-4 py-3 font-medium">SKU</th>
                    <th className="px-4 py-3 font-medium">Produto</th>
                    <th className="px-4 py-3 text-right font-medium">Qtde</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {derived.recentMovements.slice(0, 8).map((movement: AnyRecord) => (
                    <tr key={movement.id} className="hover:bg-white/55">
                      <td className="px-4 py-3 text-muted-foreground">{formatDate(movement.data)}</td>
                      <td className="px-4 py-3">
                        <Badge variant="outline">{movement.tipo_mov}</Badge>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">{movement.cod_sku}</td>
                      <td className="max-w-[240px] truncate px-4 py-3">{movement.produto}</td>
                      <td className="px-4 py-3 text-right font-medium">
                        {movement.sinal > 0 ? "+" : "-"}
                        {formatNumber(movement.qtde)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
