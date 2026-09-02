import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  Bell,
  CheckCircle2,
  Clock3,
  CloudCog,
  Database,
  FileWarning,
  RefreshCw,
  ShieldCheck,
  Siren,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  GenkitFlowBoard,
  OperationalFoundationCard,
  buildRuntimeFlows,
} from "@/features/agent-telemetry";
import { cn } from "@/lib/utils";

type AnyRecord = Record<string, any>;

type AiOverview = {
  snapshot?: {
    total_events?: number;
    open_insights?: number;
    last_event_at?: string | null;
  };
  inbox?: AnyRecord[];
  events?: AnyRecord[];
};

type ListResponse<T> = {
  items?: T[];
  total?: number;
};

type IncidentForm = {
  severity: "info" | "attention" | "critical";
  customer_code: string;
  title: string;
  description: string;
  entity_type: string;
  entity_id: string;
};

const emptyIncident: IncidentForm = {
  severity: "attention",
  customer_code: "BTG Pactual",
  title: "",
  description: "",
  entity_type: "suporte",
  entity_id: "",
};

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const payload = (await response.json().catch(() => ({}))) as {
    message?: string;
  };
  if (!response.ok) {
    throw new Error(payload.message || "Falha ao acessar o sistema.");
  }
  return payload as T;
}

function rows<T>(payload: ListResponse<T> | T[] | undefined): T[] {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  return payload.items ?? [];
}

function toNumber(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeText(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function isOpenStatus(value: unknown) {
  return ![
    "closed",
    "resolved",
    "completed",
    "delivered",
    "cancelled",
    "canceled",
    "arquivado",
    "archived",
    "pago",
    "entregue",
  ].includes(normalizeText(value));
}

function isCritical(value: unknown) {
  return ["critical", "critico", "crítico", "high", "alta"].includes(
    normalizeText(value),
  );
}

function formatDate(value: unknown) {
  if (!value) return "Sem evento recente";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "Sem evento recente";
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function MetricCard({
  icon: Icon,
  tone = "stable",
  title,
  value,
  caption,
}: {
  icon: typeof Activity;
  tone?: "stable" | "attention" | "critical";
  title: string;
  value: string;
  caption?: string;
}) {
  return (
    <Card
      className={cn(
        "rounded-3xl border-slate-200 bg-white/75 shadow-[0_18px_60px_rgba(15,23,42,.05)] backdrop-blur-[40px]",
        tone === "attention" && "border-blue-200",
        tone === "critical" && "border-red-200",
      )}
    >
      <CardContent className="flex items-start justify-between gap-4 p-5">
        <div>
          <div className="text-sm text-slate-500">{title}</div>
          <div className="mt-2 text-2xl font-semibold text-slate-900">
            {value}
          </div>
          {caption ? (
            <div className="mt-1 text-xs text-slate-400">{caption}</div>
          ) : null}
        </div>
        <div
          className={cn(
            "flex h-11 w-11 items-center justify-center rounded-2xl border bg-white/70",
            tone === "critical"
              ? "border-red-100 text-red-500"
              : tone === "attention"
                ? "border-blue-100 text-blue-500"
                : "border-slate-200 text-slate-500",
          )}
        >
          <Icon className="h-5 w-5" />
        </div>
      </CardContent>
    </Card>
  );
}

function severityLabel(value: unknown) {
  if (normalizeText(value) === "critical") return "Crítico";
  if (normalizeText(value) === "attention") return "Atenção";
  return "Info";
}

export default function Support() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [incident, setIncident] = useState<IncidentForm>(emptyIncident);

  const health = useQuery({
    queryKey: ["support-health"],
    queryFn: () => fetchJson<{ ok?: boolean }>("/api/healthz"),
    refetchInterval: 120_000,
  });
  const ai = useQuery({
    queryKey: ["support-ai-overview"],
    queryFn: () => fetchJson<AiOverview>("/api/ai/overview"),
    refetchInterval: 120_000,
  });
  const wms = useQuery({
    queryKey: ["support-warehouse-ops"],
    queryFn: () => fetchJson<AnyRecord>("/api/warehouse/ops"),
    refetchInterval: 120_000,
  });
  const requests = useQuery({
    queryKey: ["support-customer-requests"],
    queryFn: () =>
      fetchJson<ListResponse<AnyRecord>>("/api/customer-requests?limit=100"),
    refetchInterval: 120_000,
  });
  const customers = useQuery({
    queryKey: ["support-customers"],
    queryFn: () => fetchJson<ListResponse<AnyRecord>>("/api/customers?limit=100"),
    refetchInterval: 120_000,
  });

  const derived = useMemo(() => {
    const inbox = ai.data?.inbox ?? [];
    const events = ai.data?.events ?? [];
    const requestRows = rows(requests.data);
    const customerRows = rows(customers.data);
    const metrics = wms.data?.metrics ?? {};
    const openRequests = requestRows.filter((request) =>
      isOpenStatus(request.status),
    );
    const criticalAlerts = inbox.filter((alert) =>
      isCritical(alert.priority ?? alert.severity),
    );
    const criticalEvents = events.filter((event) => isCritical(event.severity));
    const pendingWms = toNumber(
      metrics.pending_total ?? metrics.pendingTotal,
      0,
    );
    return {
      activeCustomers: customerRows.filter((customer) =>
        isOpenStatus(customer.status),
      ).length,
      criticalAlerts,
      criticalEvents,
      events,
      inbox,
      lastEventAt: ai.data?.snapshot?.last_event_at,
      openRequests,
      pendingWms,
      totalEvents: toNumber(ai.data?.snapshot?.total_events, events.length),
    };
  }, [ai.data, customers.data, requests.data, wms.data]);
  const customerOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const customer of rows(customers.data)) {
      const code = String(customer.code ?? customer.id ?? "").trim();
      if (code) map.set(code, String(customer.name ?? code));
    }
    if (!map.has("BTG Pactual")) map.set("BTG Pactual", "BTG Pactual");
    if (!map.has("Dutelog")) map.set("Dutelog", "Dutelog");
    return Array.from(map.entries()).map(([code, name]) => ({ code, name }));
  }, [customers.data]);

  const createIncident = useMutation({
    mutationFn: async () => {
      if (!incident.title.trim()) {
        throw new Error("Informe um titulo para o incidente.");
      }
      return fetchJson("/api/ai/events", {
        method: "POST",
        body: JSON.stringify({
          type: "support.incident",
          title: incident.title.trim(),
          description: incident.description.trim(),
          severity: incident.severity,
          entity_type: incident.entity_type || "suporte",
          entity_id: incident.entity_id || `support_${Date.now()}`,
          customer_code: incident.customer_code,
          source: "support_console",
          payload: {
            support_status: "open",
            channel: "dute_system",
          },
        }),
      });
    },
    onSuccess: async () => {
      toast({ title: "Incidente registrado" });
      setIncident(emptyIncident);
      await queryClient.invalidateQueries({ queryKey: ["support-ai-overview"] });
    },
    onError: (error) =>
      toast({
        title: "Erro ao registrar incidente",
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      }),
  });

  const refreshAll = () => {
    health.refetch();
    ai.refetch();
    wms.refetch();
    requests.refetch();
    customers.refetch();
  };

  const submitIncident = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    createIncident.mutate();
  };

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-2">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-blue-100 bg-blue-50 text-blue-500">
            <CloudCog className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-3xl font-semibold tracking-normal text-slate-900">
              Suporte e Observabilidade
            </h1>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          className="rounded-2xl"
          onClick={refreshAll}
        >
          <RefreshCw className="mr-2 h-4 w-4" />
          Atualizar
        </Button>
      </section>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <MetricCard
          title="API do app"
          value={health.data?.ok ? "Online" : health.isError ? "Falha" : "Checando"}
          caption="Smoke /api/healthz"
          icon={Activity}
          tone={health.isError ? "critical" : "stable"}
        />
        <MetricCard
          title="Eventos"
          value={derived.totalEvents.toLocaleString("pt-BR")}
          caption={`Último: ${formatDate(derived.lastEventAt)}`}
          icon={Database}
        />
        <MetricCard
          title="Alertas críticos"
          value={String(derived.criticalAlerts.length + derived.criticalEvents.length)}
          caption="Inbox IA + eventos"
          icon={AlertTriangle}
          tone={
            derived.criticalAlerts.length + derived.criticalEvents.length > 0
              ? "critical"
              : "stable"
          }
        />
        <MetricCard
          title="WMS pendente"
          value={derived.pendingWms.toLocaleString("pt-BR")}
          caption="Filas operacionais abertas"
          icon={Clock3}
          tone={derived.pendingWms > 0 ? "attention" : "stable"}
        />
        <MetricCard
          title="Clientes ativos"
          value={String(derived.activeCustomers)}
          caption="Governança multi-cliente"
          icon={ShieldCheck}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.05fr_.95fr]">
        <Card className="rounded-3xl border-slate-200 bg-white/75 shadow-[0_18px_60px_rgba(15,23,42,.05)] backdrop-blur-[40px]">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base font-semibold">
              <Siren className="h-4 w-4 text-blue-500" />
              Registrar incidente
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={submitIncident}>
              <div className="grid gap-3 md:grid-cols-3">
                <div className="space-y-2">
                  <Label>Severidade</Label>
                  <Select
                    value={incident.severity}
                    onValueChange={(value: IncidentForm["severity"]) =>
                      setIncident((current) => ({
                        ...current,
                        severity: value,
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="info">Informação</SelectItem>
                      <SelectItem value="attention">Atenção</SelectItem>
                      <SelectItem value="critical">Crítico</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Cliente</Label>
                  <Select
                    value={incident.customer_code}
                    onValueChange={(value) =>
                      setIncident((current) => ({
                        ...current,
                        customer_code: value,
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {customerOptions.map((customer) => {
                        const code = customer.code;
                        return (
                          <SelectItem key={code} value={code}>
                            {customer.name}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Entidade</Label>
                  <Input
                    value={incident.entity_id}
                    onChange={(event) =>
                      setIncident((current) => ({
                        ...current,
                        entity_id: event.target.value,
                      }))
                    }
                    placeholder="Pedido, SKU, função..."
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Título</Label>
                <Input
                  value={incident.title}
                  onChange={(event) =>
                    setIncident((current) => ({
                      ...current,
                      title: event.target.value,
                    }))
                  }
                  placeholder="Ex.: Portal do cliente sem atualizar estoque"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Descrição e impacto</Label>
                <Textarea
                  value={incident.description}
                  onChange={(event) =>
                    setIncident((current) => ({
                      ...current,
                      description: event.target.value,
                    }))
                  }
                  placeholder="Causa percebida, impacto, horário, responsável e ação tomada."
                  className="min-h-32"
                />
              </div>
              <div className="flex justify-end">
                <Button type="submit" disabled={createIncident.isPending}>
                  <Bell className="mr-2 h-4 w-4" />
                  Registrar no ledger
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card className="rounded-3xl border-slate-200 bg-white/75 shadow-[0_18px_60px_rgba(15,23,42,.05)] backdrop-blur-[40px]">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base font-semibold">
              <CheckCircle2 className="h-4 w-4 text-blue-500" />
              Rotina diária
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {[
              "Conferir alertas críticos e fila do Agent Dute.",
              "Validar se eventos novos estão entrando no ledger.",
              "Checar WMS pendente, bloqueios e SLA curto.",
              "Revisar solicitações abertas do cliente.",
              "Confirmar backup/export e registrar qualquer exceção.",
            ].map((item, index) => (
              <div
                key={item}
                className="flex gap-3 rounded-2xl border border-slate-200 bg-white/60 p-3 text-sm"
              >
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-50 text-xs font-semibold text-blue-500">
                  {index + 1}
                </div>
                <div className="text-slate-600">{item}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="rounded-3xl border-slate-200 bg-white/75 shadow-[0_18px_60px_rgba(15,23,42,.05)] backdrop-blur-[40px]">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base font-semibold">
              <FileWarning className="h-4 w-4 text-blue-500" />
              Alertas e incidentes recentes
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {[...derived.criticalAlerts, ...derived.criticalEvents]
              .slice(0, 8)
              .map((item, index) => (
                <div
                  key={String(item.id ?? index)}
                  className="rounded-2xl border border-slate-200 bg-white/65 p-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 font-medium text-slate-900">
                      {item.title ?? "Alerta operacional"}
                    </div>
                    <Badge variant="outline" className="rounded-full">
                      {severityLabel(item.severity ?? item.priority)}
                    </Badge>
                  </div>
                  <div className="mt-1 text-sm text-slate-500">
                    {item.message ?? item.description ?? "Sem descrição."}
                  </div>
                  <div className="mt-3 text-xs text-slate-400">
                    {item.customer_code ?? "Dutelog"} ·{" "}
                    {formatDate(item.created_at ?? item.occurred_at)}
                  </div>
                </div>
              ))}
            {derived.criticalAlerts.length + derived.criticalEvents.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-white/50 p-8 text-center text-sm text-slate-500">
                Nenhum alerta crítico ativo.
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card className="rounded-3xl border-slate-200 bg-white/75 shadow-[0_18px_60px_rgba(15,23,42,.05)] backdrop-blur-[40px]">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base font-semibold">
              <Clock3 className="h-4 w-4 text-blue-500" />
              Solicitações abertas
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {derived.openRequests.slice(0, 8).map((request, index) => (
              <div
                key={String(request.id ?? index)}
                className="rounded-2xl border border-slate-200 bg-white/65 p-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="font-medium text-slate-900">
                    {request.title ?? request.type ?? "Solicitação"}
                  </div>
                  <Badge variant="outline" className="rounded-full">
                    {request.status ?? "aberta"}
                  </Badge>
                </div>
                <div className="mt-1 text-sm text-slate-500">
                  {request.description ?? "Sem descrição."}
                </div>
                <div className="mt-3 text-xs text-slate-400">
                  {request.customer_code ?? "BTG Pactual"} ·{" "}
                  {formatDate(request.created_at)}
                </div>
              </div>
            ))}
            {!derived.openRequests.length ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-white/50 p-8 text-center text-sm text-slate-500">
                Nenhuma solicitação aberta no momento.
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {/* Telemetria de desenvolvimento (Genkit + malha Firestore): status de
          implementação pertence à Observabilidade, não às telas de turno.
          Blocos movidos da tela Agent Dute. */}
      <GenkitFlowBoard
        flows={buildRuntimeFlows(
          derived.events.map((event) => ({
            type: String(event.type ?? ""),
            title: String(event.title ?? ""),
            occurred_at: (event.occurred_at as string | null) ?? null,
          })),
        )}
      />
      <OperationalFoundationCard />
    </div>
  );
}
