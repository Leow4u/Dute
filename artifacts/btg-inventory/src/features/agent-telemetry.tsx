/**
 * Telemetria de desenvolvimento do núcleo AI-native — Controle Genkit e
 * Malha operacional (modelo Firestore). Movida da tela Agent Dute
 * (pages/ai-control.tsx) para a Observabilidade: é status de implementação,
 * não informação de turno para quem opera o armazém.
 * JSX preservado na íntegra; apenas o local de exibição mudou.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  Database,
  Layers3,
  ListChecks,
  Radio,
  Route,
  UploadCloud,
  type LucideIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import {
  MODULES_BY_STATUS,
  MODULE_STATUS_CLASS,
  MODULE_STATUS_LABEL,
  OPERATIONAL_MODULES,
} from "@/lib/operational-modules";
import type { OperationalFoundationSnapshot } from "@/lib/operational-foundation";
import { cn } from "@/lib/utils";

/** Campos de evento que a telemetria realmente usa (tipagem estrutural). */
export type TelemetryEvent = {
  type: string;
  title: string;
  occurred_at?: string | null;
};

type GenkitFlowStatus = "active" | "ready" | "planned";

type GenkitFlow = {
  id: string;
  name: string;
  moduleId: string;
  moduleTitle: string;
  status: GenkitFlowStatus;
  source: string;
  trigger: string;
  evidence: string;
  eventTypes: string[];
  collections: string[];
  icon: LucideIcon;
};

export type GenkitFlowRuntime = GenkitFlow & {
  observedEvents: number;
  latestEventAt?: string | null;
  latestEventTitle?: string;
};

type RealFoundationSyncResult = {
  ok: true;
  writes: Array<{
    collection: string;
    count: number;
    batches: number;
  }>;
  snapshot: OperationalFoundationSnapshot;
};

const numberFormatter = new Intl.NumberFormat("pt-BR");
const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
});

const flowStatusOrder: Record<GenkitFlowStatus, number> = {
  active: 1,
  ready: 2,
  planned: 3,
};

function formatDate(value?: string | null) {
  if (!value) return "Sem data";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Sem data";
  return dateFormatter.format(date);
}

function toTimestamp(value?: string | null) {
  if (!value) return 0;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: "include", ...init });
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return (await response.json()) as T;
}

function flowStatusFromModule(status: string): GenkitFlowStatus {
  if (status === "planned") return "planned";
  if (status === "partial") return "ready";
  return "active";
}

function flowStatusLabel(status: GenkitFlowStatus) {
  if (status === "active") return "Ativo";
  if (status === "ready") return "Pronto";
  return "Planejado";
}

function flowStatusClass(status: GenkitFlowStatus) {
  if (status === "active") {
    return "border-blue-200 bg-blue-50 text-blue-700";
  }
  if (status === "ready") {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }
  return "border-border bg-white/70 text-muted-foreground";
}

function flowStatusCaption(status: GenkitFlowStatus) {
  if (status === "active") return "rodando ou alimentado por eventos";
  if (status === "ready") return "contrato e dados parciais prontos";
  return "aguardando construção do módulo";
}

function formatFlowName(value: string) {
  return value
    .replace(/Flow$/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase();
}

const GENKIT_FLOW_CATALOG: GenkitFlow[] = OPERATIONAL_MODULES.flatMap(
  (module) =>
    module.aiFlows.map((flowName, index) => ({
      id: `${module.id}:${flowName}`,
      name: flowName,
      moduleId: module.id,
      moduleTitle: module.title,
      status: flowStatusFromModule(module.status),
      source: module.source,
      trigger: module.eventTypes[index] ?? module.eventTypes[0] ?? "event.analyzed",
      evidence: module.mvp,
      eventTypes: module.eventTypes,
      collections: module.collections,
      icon: module.icon,
    })),
);

function latestEventForTypes(events: TelemetryEvent[], eventTypes: string[]) {
  return events
    .filter((event) => eventTypes.includes(event.type))
    .sort((a, b) => toTimestamp(b.occurred_at) - toTimestamp(a.occurred_at))[0];
}

export function buildRuntimeFlows(events: TelemetryEvent[]): GenkitFlowRuntime[] {
  return GENKIT_FLOW_CATALOG.map((flow) => {
    const observedEvents = events.filter((event) =>
      flow.eventTypes.includes(event.type),
    );
    const latestEvent = latestEventForTypes(events, flow.eventTypes);

    return {
      ...flow,
      observedEvents: observedEvents.length,
      latestEventAt: latestEvent?.occurred_at,
      latestEventTitle: latestEvent?.title,
    };
  }).sort((a, b) => {
    const statusDelta = flowStatusOrder[a.status] - flowStatusOrder[b.status];
    if (statusDelta) return statusDelta;
    const observedDelta = b.observedEvents - a.observedEvents;
    if (observedDelta) return observedDelta;
    return a.moduleTitle.localeCompare(b.moduleTitle, "pt-BR");
  });
}

function summarizeFlows(flows: GenkitFlowRuntime[]) {
  return flows.reduce(
    (acc, flow) => {
      acc[flow.status] += 1;
      return acc;
    },
    { active: 0, ready: 0, planned: 0 } satisfies Record<
      GenkitFlowStatus,
      number
    >,
  );
}

function FoundationStat({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-[18px] border border-border bg-white/58 px-4 py-3 shadow-[0_8px_24px_rgba(15,23,42,.04)] backdrop-blur-[32px]">
      <div className="text-xs font-medium text-foreground/70">{label}</div>
      <div className="mt-2 text-xl font-semibold text-foreground">{value}</div>
    </div>
  );
}

export function GenkitFlowBoard({ flows }: { flows: GenkitFlowRuntime[] }) {
  const summary = summarizeFlows(flows);
  const observedFlowCount = flows.filter((flow) => flow.observedEvents > 0).length;
  const activeFlows = flows
    .filter((flow) => flow.status !== "planned")
    .slice(0, 6);
  const plannedFlows = flows
    .filter((flow) => flow.status === "planned")
    .slice(0, 6);

  return (
    <Card>
      <CardHeader className="border-b border-border/60">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[16px] border border-border bg-white/70">
              <Activity className="h-4 w-4 text-muted-foreground" />
            </div>
            <div>
              <CardTitle className="text-base">Controle Genkit</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                Flows ativos, prontos e planejados por módulo operacional.
              </p>
            </div>
          </div>
          <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-700">
            {numberFormatter.format(observedFlowCount)} com evidência no ledger
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-5 pt-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <FoundationStat
            label="Ativos"
            value={numberFormatter.format(summary.active)}
            caption="executando no núcleo AI-native"
          />
          <FoundationStat
            label="Prontos"
            value={numberFormatter.format(summary.ready)}
            caption="contrato parcial validado"
          />
          <FoundationStat
            label="Planejados"
            value={numberFormatter.format(summary.planned)}
            caption="backlog Genkit de produção"
          />
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Radio className="h-4 w-4 text-primary" />
              Ativos e prontos
            </div>
            {activeFlows.map((flow) => {
              const Icon = flow.icon;
              return (
                <div key={flow.id} className="soft-panel rounded-[18px] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[14px] border border-border bg-white/70">
                        <Icon className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-foreground">
                          {formatFlowName(flow.name)}
                        </div>
                        <div className="mt-1 truncate font-mono text-xs text-muted-foreground">
                          {flow.name}
                        </div>
                      </div>
                    </div>
                    <Badge
                      variant="outline"
                      className={cn("shrink-0", flowStatusClass(flow.status))}
                    >
                      {flowStatusLabel(flow.status)}
                    </Badge>
                  </div>

                  <div className="mt-3 grid gap-2 text-xs text-muted-foreground">
                    <div className="flex items-center gap-2">
                      <Route className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">
                        Gatilho: {flow.trigger}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Database className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">
                        {flow.observedEvents
                          ? `${numberFormatter.format(flow.observedEvents)} evento(s) · ${formatDate(flow.latestEventAt)}`
                          : flowStatusCaption(flow.status)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <ListChecks className="h-4 w-4 text-primary" />
              Planejados para produção
            </div>
            {plannedFlows.map((flow) => {
              const Icon = flow.icon;
              return (
                <div key={flow.id} className="soft-panel rounded-[18px] p-4">
                  <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[14px] border border-border bg-white/70">
                      <Icon className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-sm font-semibold text-foreground">
                          {flow.moduleTitle}
                        </div>
                        <Badge
                          variant="outline"
                          className={flowStatusClass(flow.status)}
                        >
                          {flowStatusLabel(flow.status)}
                        </Badge>
                      </div>
                      <div className="mt-1 font-mono text-xs text-muted-foreground">
                        {flow.name}
                      </div>
                      <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">
                        {flow.evidence}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                        {flow.collections.slice(0, 2).map((collection) => (
                          <span key={collection}>{collection}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function OperationalFoundationCard() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const foundation = useQuery({
    queryKey: ["operational-foundation"],
    queryFn: () =>
      fetchJson<OperationalFoundationSnapshot>("/api/operational/foundation"),
    refetchInterval: 120_000,
    refetchOnWindowFocus: false,
  });

  const syncRealFoundation = useMutation({
    mutationFn: async () =>
      fetchJson<RealFoundationSyncResult>("/api/operational/sync-real-foundation", {
        method: "POST",
      }),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["operational-foundation"] });
      qc.invalidateQueries({ queryKey: ["ai-overview"] });
      const written =
        result.writes?.reduce((sum, item) => sum + item.count, 0) ?? 0;
      toast({
        title: "Fundação operacional preparada",
        description: `${numberFormatter.format(written)} registro(s) sincronizados no Firestore.`,
      });
    },
    onError: () => {
      toast({
        title: "Erro ao preparar fundação operacional",
        variant: "destructive",
      });
    },
  });

  const foundationMetrics = foundation.data?.metrics;

  return (
    <Card>
      <CardHeader className="border-b border-border/60">
        <div className="flex flex-col gap-1">
          <CardTitle className="text-base">
            Malha operacional AI-native
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Módulos que vamos construir a partir da planilha atual e dos
            benchmarks de WMS/OMS.
          </p>
        </div>
      </CardHeader>
      <CardContent className="space-y-5 pt-5">
        <div className="grid gap-3 md:grid-cols-4">
          <div className="soft-panel rounded-[20px] p-4">
            <div className="text-2xl font-semibold">
              {MODULES_BY_STATUS.online}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              módulos operando
            </div>
          </div>
          <div className="soft-panel rounded-[20px] p-4">
            <div className="text-2xl font-semibold">
              {MODULES_BY_STATUS.partial}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              módulos parciais
            </div>
          </div>
          <div className="soft-panel rounded-[20px] p-4">
            <div className="text-2xl font-semibold">
              {MODULES_BY_STATUS.foundation}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              infraestrutura IA
            </div>
          </div>
          <div className="soft-panel rounded-[20px] p-4">
            <div className="text-2xl font-semibold">
              {MODULES_BY_STATUS.planned}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              módulos planejados
            </div>
          </div>
        </div>

        <div className="soft-panel rounded-[24px] p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[16px] border border-border bg-white/70">
                <Layers3 className="h-4 w-4 text-muted-foreground" />
              </div>
              <div>
                <div className="text-sm font-semibold text-foreground">
                  Modelo Firestore operacional
                </div>
                <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
                  Coleções base para portal do cliente, saldos, recebimento,
                  pedidos, picking e packing derivadas da operação BTG atual.
                </p>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => syncRealFoundation.mutate()}
              disabled={syncRealFoundation.isPending}
            >
              <UploadCloud
                className={cn(
                  "h-4 w-4",
                  syncRealFoundation.isPending && "animate-pulse",
                )}
              />
              {syncRealFoundation.isPending
                ? "Sincronizando..."
                : "Sincronizar dados reais"}
            </Button>
          </div>

          {foundation.error ? (
            <div className="mt-4 rounded-[16px] border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              Não consegui ler a fundação operacional agora.
            </div>
          ) : (
            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <FoundationStat
                label="Coleções mapeadas"
                value={
                  foundationMetrics
                    ? numberFormatter.format(foundationMetrics.collections)
                    : foundation.isLoading
                      ? "..."
                      : "0"
                }
                caption={`${numberFormatter.format(foundationMetrics?.modules ?? 0)} módulo(s)`}
              />
              <FoundationStat
                label="Cliente e contas"
                value={numberFormatter.format(
                  foundationMetrics?.customers ?? 0,
                )}
                caption={`${numberFormatter.format(foundationMetrics?.customer_accounts ?? 0)} conta(s) vinculada(s)`}
              />
              <FoundationStat
                label="Locais físicos"
                value={`${numberFormatter.format(foundationMetrics?.locations ?? 0)} / ${numberFormatter.format(foundationMetrics?.derived_locations ?? 0)}`}
                caption="gravados / derivados dos SKUs"
              />
              <FoundationStat
                label="Saldos por SKU"
                value={`${numberFormatter.format(foundationMetrics?.stock_balances ?? 0)} / ${numberFormatter.format(foundationMetrics?.derived_stock_balances ?? 0)}`}
                caption="gravados / derivados da planilha"
              />
              <FoundationStat
                label="Recebimentos"
                value={numberFormatter.format(
                  foundationMetrics?.inbound_receipts ?? 0,
                )}
                caption="entradas agrupadas por NF/documento"
              />
              <FoundationStat
                label="Itens de pedido"
                value={numberFormatter.format(
                  foundationMetrics?.order_items ?? 0,
                )}
                caption={`${numberFormatter.format(foundationMetrics?.open_orders ?? 0)} pedido(s) aberto(s)`}
              />
              <FoundationStat
                label="Picking"
                value={numberFormatter.format(
                  foundationMetrics?.pick_tasks ?? 0,
                )}
                caption="tarefas de separação preparadas"
              />
              <FoundationStat
                label="Packing"
                value={numberFormatter.format(
                  foundationMetrics?.pack_tasks ?? 0,
                )}
                caption="tarefas de conferência/volume"
              />
            </div>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-left text-sm">
            <thead className="border-b border-border text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-3 font-medium">Módulo</th>
                <th className="px-3 py-3 font-medium">Status</th>
                <th className="px-3 py-3 font-medium">Fonte</th>
                <th className="px-3 py-3 font-medium">Coleções</th>
                <th className="px-3 py-3 font-medium">Eventos</th>
                <th className="px-3 py-3 font-medium">Flow IA</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {OPERATIONAL_MODULES.map((module) => {
                const Icon = module.icon;
                return (
                  <tr key={module.id} className="align-top hover:bg-white/50">
                    <td className="px-3 py-4">
                      <div className="flex gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[14px] border border-border bg-white/70">
                          <Icon className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div>
                          <div className="font-medium text-foreground">
                            {module.title}
                          </div>
                          <div className="mt-1 max-w-[280px] text-xs leading-5 text-muted-foreground">
                            {module.purpose}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-4">
                      <Badge
                        variant="outline"
                        className={MODULE_STATUS_CLASS[module.status]}
                      >
                        {MODULE_STATUS_LABEL[module.status]}
                      </Badge>
                    </td>
                    <td className="px-3 py-4 text-xs text-muted-foreground">
                      {module.source}
                    </td>
                    <td className="px-3 py-4 text-xs text-muted-foreground">
                      {module.collections.slice(0, 3).join(", ")}
                      {module.collections.length > 3 ? "..." : ""}
                    </td>
                    <td className="px-3 py-4 text-xs text-muted-foreground">
                      {module.eventTypes.slice(0, 2).join(", ")}
                      {module.eventTypes.length > 2 ? "..." : ""}
                    </td>
                    <td className="px-3 py-4 text-xs text-muted-foreground">
                      {module.aiFlows[0]}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
