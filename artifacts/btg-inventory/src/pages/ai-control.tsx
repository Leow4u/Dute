import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bell,
  Box,
  BrainCircuit,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  Clock3,
  Database,
  FileWarning,
  Layers3,
  ListChecks,
  MapPin,
  PackageSearch,
  Radio,
  RefreshCw,
  Route,
  Send,
  ShieldAlert,
  Sparkles,
  UploadCloud,
  UserRound,
  Warehouse,
  type LucideIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  MODULES_BY_STATUS,
  MODULE_STATUS_CLASS,
  MODULE_STATUS_LABEL,
  OPERATIONAL_MODULES,
} from "@/lib/operational-modules";
import type { OperationalFoundationSnapshot } from "@/lib/operational-foundation";
import { cn } from "@/lib/utils";

type EventSeverity = "info" | "attention" | "critical";

type AiEvent = {
  id: string;
  type: string;
  title: string;
  description?: string;
  severity: EventSeverity;
  source?: string;
  entity_type?: string | null;
  entity_id?: string | null;
  customer_code?: string | null;
  occurred_at?: string | null;
  payload?: Record<string, unknown>;
};

type AiInsight = {
  id: string;
  title: string;
  message: string;
  priority: "normal" | "high" | "critical";
  status: "open" | "resolved";
  entity_type?: string | null;
  entity_id?: string | null;
  customer_code?: string | null;
  created_at?: string | null;
};

type AiMemory = {
  id: string;
  scope_type: string;
  scope_id: string;
  title: string;
  summary?: string;
  event_count?: number;
  last_event_title?: string;
  last_event_at?: string | null;
};

type AiOverview = {
  snapshot: {
    total_events: number;
    derived_events: number;
    open_insights: number;
    inventory_value: number;
    total_pieces: number;
    missing_costs: number;
    open_orders: number;
    last_event_at?: string | null;
  };
  inbox: AiInsight[];
  events: AiEvent[];
  memory: AiMemory[];
  sources: string[];
};

type WarehouseTask = {
  id: string;
  title?: string | null;
  reference?: string | null;
  customer?: string | null;
  quantity?: number | null;
  priority?: string | null;
  status?: string | null;
  due_at?: string | null;
  next_action?: string | null;
  notes?: string | null;
  blocked_reason?: string | null;
  exception_count?: number | null;
  customer_request_id?: string | null;
};

type WarehouseQueue = {
  key?: string | null;
  name?: string | null;
  pending?: number | null;
  in_progress?: number | null;
  tasks?: WarehouseTask[];
  next_action?: string | null;
};

type WarehouseOpsResponse = {
  metrics?: {
    pending_total?: number | null;
    due_soon?: number | null;
    critical?: number | null;
    agent_alerts?: number | null;
  };
  queues?: Record<string, WarehouseQueue> | WarehouseQueue[];
  alerts?: AiInsight[];
  agent_summary?: string | null;
  updated_at?: string | null;
};

type CustomerRequest = {
  id: string;
  customer_code?: string | null;
  type?: string | null;
  priority?: string | null;
  title?: string | null;
  description?: string | null;
  status?: string | null;
  quantity?: number | string | null;
  qtd_solic?: number | string | null;
  quantity_total?: number | string | null;
  item_count?: number | string | null;
  order_id?: string | null;
  inbound_id?: string | null;
  pick_task_id?: string | null;
  created_entities?: {
    order_id?: string | null;
    inbound_id?: string | null;
    pick_task_id?: string | null;
  } | null;
  created_at?: string | null;
};

type ListResponse<T> = {
  items: T[];
  total: number;
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

type GenkitFlowRuntime = GenkitFlow & {
  observedEvents: number;
  latestEventAt?: string | null;
  latestEventTitle?: string;
};

type PhysicalWmsRisk = {
  id: string;
  area: string;
  signal: string;
  impact: string;
  guardrail: string;
  priority: OperationalRiskPriority;
  eventType: string;
  relatedEntity?: string | null;
  source: string;
};

type SuggestedDecision = {
  id: string;
  title: string;
  recommendation: string;
  reason: string;
  priority: OperationalRiskPriority;
  owner: string;
  trace: string;
  confidence: "Alta" | "Média";
};

const moneyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const numberFormatter = new Intl.NumberFormat("pt-BR");
const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
});
const completedWmsStatuses = new Set([
  "completed",
  "delivered",
  "received",
  "closed",
  "done",
  "cancelled",
  "canceled",
]);
const openRequestStatuses = new Set(["open", "submitted", "pending"]);
const severityWeight: Record<EventSeverity, number> = {
  info: 1,
  attention: 2,
  critical: 3,
};
const flowStatusOrder: Record<GenkitFlowStatus, number> = {
  active: 1,
  ready: 2,
  planned: 3,
};

const physicalRiskImpact =
  "Pode quebrar a paridade entre estoque físico, reserva e ledger se a etapa avançar sem evidência.";

const genericTraceEventType = "operator.note";

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

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const message = await response.text().catch(() => "");
    throw new Error(message || `HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}

function formatDate(value?: string | null) {
  if (!value) return "Sem data";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Sem data";
  return dateFormatter.format(date);
}

function severityClass(severity?: EventSeverity) {
  if (severity === "critical") {
    return "border-rose-200 bg-rose-50 text-rose-700";
  }
  if (severity === "attention") {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }
  return "border-blue-200 bg-blue-50 text-blue-700";
}

function priorityLabel(priority: AiInsight["priority"]) {
  if (priority === "critical") return "Crítico";
  if (priority === "high") return "Alta";
  return "Normal";
}

function toTimestamp(value?: string | null) {
  if (!value) return 0;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function toNumber(value?: number | string | null) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function entityTypeLabel(value?: string | null) {
  const normalized = String(value ?? "").toLowerCase();
  const labels: Record<string, string> = {
    cliente: "Cliente",
    customer: "Cliente",
    estoque: "Estoque",
    fatura: "Fatura",
    movimentacao: "Movimentação",
    operacao: "Operação",
    pedido: "Pedido",
    produto: "Produto",
    sku: "SKU",
    solicitacao_cliente: "Solicitação",
  };
  return (
    labels[normalized] ??
    (value ? String(value).replaceAll("_", " ") : "Operação")
  );
}

function entityLabel(
  entityType?: string | null,
  entityId?: string | null,
  fallback?: string | null,
) {
  if (entityId) return `${entityTypeLabel(entityType)} ${entityId}`;
  return fallback || entityTypeLabel(entityType);
}

function eventEntityKey(event: AiEvent) {
  if (event.entity_type && event.entity_id) {
    return `${event.entity_type}:${event.entity_id}`;
  }
  if (event.customer_code) return `cliente:${event.customer_code}`;
  return `tipo:${event.type}`;
}

type EventEntityGroup = {
  key: string;
  label: string;
  typeLabel: string;
  customerCode?: string | null;
  count: number;
  latestAt?: string | null;
  severity: EventSeverity;
  events: AiEvent[];
};

function groupEventsByEntity(events: AiEvent[]): EventEntityGroup[] {
  const groups = new Map<string, EventEntityGroup>();

  events.forEach((event) => {
    const key = eventEntityKey(event);
    const current =
      groups.get(key) ??
      ({
        key,
        label: event.entity_id
          ? entityLabel(event.entity_type, event.entity_id)
          : event.customer_code
            ? `Cliente ${event.customer_code}`
            : event.type,
        typeLabel: event.entity_type
          ? entityTypeLabel(event.entity_type)
          : "Evento operacional",
        customerCode: event.customer_code,
        count: 0,
        latestAt: event.occurred_at,
        severity: "info",
        events: [],
      } satisfies EventEntityGroup);

    current.count += 1;
    current.events.push(event);
    if (toTimestamp(event.occurred_at) >= toTimestamp(current.latestAt)) {
      current.latestAt = event.occurred_at;
    }
    if (severityWeight[event.severity] > severityWeight[current.severity]) {
      current.severity = event.severity;
    }
    groups.set(key, current);
  });

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      events: [...group.events].sort(
        (a, b) => toTimestamp(b.occurred_at) - toTimestamp(a.occurred_at),
      ),
    }))
    .sort((a, b) => toTimestamp(b.latestAt) - toTimestamp(a.latestAt));
}

function isClientMemory(item: AiMemory) {
  const scope = String(item.scope_type ?? "").toLowerCase();
  return scope.includes("cliente") || scope.includes("customer");
}

type OperationalRiskPriority = "normal" | "high" | "critical";

type OperationalRisk = {
  id: string;
  title: string;
  detail: string;
  source: string;
  priority: OperationalRiskPriority;
  customerCode?: string | null;
  entity?: string | null;
  dueAt?: string | null;
  createdAt?: string | null;
  action?: string | null;
};

function normalizeRiskPriority(value?: string | null): OperationalRiskPriority {
  const normalized = String(value ?? "").toLowerCase();
  if (
    normalized.includes("critical") ||
    normalized.includes("critico") ||
    normalized.includes("crítico") ||
    normalized.includes("urgent") ||
    normalized.includes("urgente")
  ) {
    return "critical";
  }
  if (
    normalized.includes("high") ||
    normalized.includes("alta") ||
    normalized.includes("attention") ||
    normalized.includes("atenção") ||
    normalized.includes("atencao")
  ) {
    return "high";
  }
  return "normal";
}

function riskPriorityLabel(priority: OperationalRiskPriority) {
  if (priority === "critical") return "Crítico";
  if (priority === "high") return "Alta";
  return "Normal";
}

function riskPriorityClass(priority: OperationalRiskPriority) {
  if (priority === "critical") {
    return "border-rose-200 bg-rose-50 text-rose-700";
  }
  if (priority === "high") {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }
  return "border-blue-200 bg-blue-50 text-blue-700";
}

function riskPriorityScore(priority: OperationalRiskPriority) {
  if (priority === "critical") return 3;
  if (priority === "high") return 2;
  return 1;
}

function statusLabel(value?: string | null) {
  const normalized = String(value ?? "").toLowerCase();
  const labels: Record<string, string> = {
    approved: "Aprovada",
    checking: "Em conferência",
    closed: "Encerrada",
    completed: "Concluída",
    delivered: "Entregue",
    dispatched: "Despachada",
    in_progress: "Em andamento",
    open: "Aberta",
    pending: "Pendente",
    planned: "Planejada",
    ready: "Pronta",
    ready_to_dispatch: "Pronta para expedição",
    received: "Recebida",
    rejected: "Rejeitada",
    submitted: "Enviada",
  };
  return (
    labels[normalized] ??
    (value ? String(value).replaceAll("_", " ") : "Sem status")
  );
}

function normalizeText(value?: string | null) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
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

function latestEventForTypes(events: AiEvent[], eventTypes: string[]) {
  return events
    .filter((event) => eventTypes.includes(event.type))
    .sort((a, b) => toTimestamp(b.occurred_at) - toTimestamp(a.occurred_at))[0];
}

function buildRuntimeFlows(events: AiEvent[]): GenkitFlowRuntime[] {
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

function queueEventType(value?: string | null) {
  const normalized = normalizeText(value);
  if (
    normalized.includes("receiving") ||
    normalized.includes("inbound") ||
    normalized.includes("receb")
  ) {
    return "inbound.exception_found";
  }
  if (
    normalized.includes("putaway") ||
    normalized.includes("endere") ||
    normalized.includes("aloc")
  ) {
    return "putaway.exception_found";
  }
  if (normalized.includes("picking") || normalized.includes("separ")) {
    return "picking.shortage_found";
  }
  if (
    normalized.includes("packing") ||
    normalized.includes("confer") ||
    normalized.includes("embal")
  ) {
    return "packing.exception_found";
  }
  if (
    normalized.includes("expedition") ||
    normalized.includes("expedi") ||
    normalized.includes("shipping")
  ) {
    return "shipment.exception_found";
  }
  return genericTraceEventType;
}

function queueAreaLabel(value?: string | null) {
  const normalized = normalizeText(value);
  if (
    normalized.includes("receiving") ||
    normalized.includes("inbound") ||
    normalized.includes("receb")
  ) {
    return "Receiving";
  }
  if (
    normalized.includes("putaway") ||
    normalized.includes("endere") ||
    normalized.includes("aloc")
  ) {
    return "Putaway";
  }
  if (normalized.includes("picking") || normalized.includes("separ")) {
    return "Picking";
  }
  if (
    normalized.includes("packing") ||
    normalized.includes("confer") ||
    normalized.includes("embal")
  ) {
    return "Packing";
  }
  if (
    normalized.includes("expedition") ||
    normalized.includes("expedi") ||
    normalized.includes("shipping")
  ) {
    return "Expedição";
  }
  return value || "WMS físico";
}

function isDueWithin(value?: string | null, hours = 4) {
  if (!value) return false;
  const dueTime = new Date(value).getTime();
  if (Number.isNaN(dueTime)) return false;
  return dueTime - Date.now() <= hours * 60 * 60 * 1000;
}

function payloadSummary(payload?: Record<string, unknown>) {
  const keys = Object.keys(payload ?? {});
  if (!keys.length) return "Sem payload";
  return keys.slice(0, 4).join(", ") + (keys.length > 4 ? "..." : "");
}

function warehouseQueues(queues?: WarehouseOpsResponse["queues"]) {
  if (!queues) return [];
  return Array.isArray(queues) ? queues : Object.values(queues);
}

function isActiveWmsTask(task: WarehouseTask) {
  return !completedWmsStatuses.has(String(task.status ?? "").toLowerCase());
}

function hasRequestWmsLink(request: CustomerRequest) {
  return Boolean(
    request.order_id ||
    request.inbound_id ||
    request.pick_task_id ||
    request.created_entities?.order_id ||
    request.created_entities?.inbound_id ||
    request.created_entities?.pick_task_id,
  );
}

function requestQuantity(request: CustomerRequest) {
  return (
    toNumber(request.quantity_total) ||
    toNumber(request.quantity) ||
    toNumber(request.qtd_solic) ||
    toNumber(request.item_count)
  );
}

function derivePhysicalWmsRisks({
  requests,
  warehouseOps,
  foundationMetrics,
}: {
  requests: CustomerRequest[];
  warehouseOps?: WarehouseOpsResponse;
  foundationMetrics?: OperationalFoundationSnapshot["metrics"];
}) {
  const risks: PhysicalWmsRisk[] = [];
  const seen = new Set<string>();
  const addRisk = (risk: PhysicalWmsRisk) => {
    if (seen.has(risk.id)) return;
    seen.add(risk.id);
    risks.push(risk);
  };

  warehouseQueues(warehouseOps?.queues).forEach((queue) => {
    const queueName = queue.name || queue.key || "Fila WMS";
    const area = queueAreaLabel(queueName);
    const eventType = queueEventType(queueName);
    const activeTasks = (queue.tasks ?? []).filter(isActiveWmsTask);
    const pending = Number(queue.pending ?? activeTasks.length);

    activeTasks.forEach((task) => {
      const exceptionCount = Number(task.exception_count ?? 0);
      const taskLabel = task.reference || task.title || task.id;
      const relatedEntity = task.customer_request_id
        ? `Solicitação ${task.customer_request_id}`
        : `Tarefa ${taskLabel}`;

      if (task.blocked_reason || exceptionCount > 0) {
        addRisk({
          id: `physical-block:${queue.key ?? queueName}:${task.id}`,
          area,
          signal:
            task.blocked_reason ||
            `${numberFormatter.format(exceptionCount)} exceção(ões) registrada(s)`,
          impact: physicalRiskImpact,
          guardrail:
            "Registrar a divergência no evento da fila e impedir baixa física até conferência.",
          priority: "critical",
          eventType,
          relatedEntity,
          source: "Bancada WMS",
        });
        return;
      }

      if (isDueWithin(task.due_at)) {
        addRisk({
          id: `physical-sla:${queue.key ?? queueName}:${task.id}`,
          area,
          signal: `${statusLabel(task.status)} com prazo ${formatDate(task.due_at)}.`,
          impact:
            "SLA físico perto do vencimento pode atrasar reserva, packing ou expedição do pedido.",
          guardrail:
            task.next_action ||
            "Priorizar a tarefa na bancada e registrar evento se houver impedimento.",
          priority: normalizeRiskPriority(task.priority) === "critical"
            ? "critical"
            : "high",
          eventType,
          relatedEntity,
          source: "Bancada WMS",
        });
      }
    });

    if (pending >= 5 && activeTasks.length > 0) {
      addRisk({
        id: `physical-queue:${queue.key ?? queueName}`,
        area,
        signal: `${numberFormatter.format(pending)} tarefa(s) aguardando execução.`,
        impact:
          "Acúmulo de fila aumenta chance de separação fora de ordem ou saldo reservado parado.",
        guardrail:
          queue.next_action ||
          "Reordenar fila por SLA e cliente antes de abrir novas ondas.",
        priority: pending >= 10 ? "critical" : "high",
        eventType,
        source: "Bancada WMS",
      });
    }
  });

  requests
    .filter((request) =>
      openRequestStatuses.has(String(request.status ?? "").toLowerCase()),
    )
    .filter((request) => !hasRequestWmsLink(request))
    .forEach((request) => {
      addRisk({
        id: `physical-request:${request.id}`,
        area: "Solicitação sem tarefa",
        signal: request.title || request.description || request.id,
        impact:
          "Pedido do cliente ainda não virou recebimento, reserva, picking ou packing rastreável.",
        guardrail:
          "Aprovar/materializar a solicitação ou registrar motivo de bloqueio no ledger.",
        priority: normalizeRiskPriority(request.priority) === "critical"
          ? "critical"
          : "high",
        eventType: "customer_request.approved",
        relatedEntity: `Solicitação ${request.id}`,
        source: "Portal / Solicitações",
      });
    });

  if (
    foundationMetrics &&
    foundationMetrics.derived_locations > foundationMetrics.locations
  ) {
    addRisk({
      id: "physical-foundation:locations",
      area: "Endereçamento",
      signal: `${numberFormatter.format(foundationMetrics.derived_locations)} local(is) derivados contra ${numberFormatter.format(foundationMetrics.locations)} gravado(s).`,
      impact:
        "Endereço derivado da planilha precisa de confirmação antes de virar regra operacional.",
      guardrail:
        "Preparar coleções e confirmar rua, prateleira e caixa antes do putaway automático.",
      priority: foundationMetrics.locations === 0 ? "high" : "normal",
      eventType: "warehouse.location_updated",
      source: "Fundação operacional",
    });
  }

  if (
    foundationMetrics &&
    foundationMetrics.derived_stock_balances > foundationMetrics.stock_balances
  ) {
    addRisk({
      id: "physical-foundation:stock",
      area: "Saldo físico",
      signal: `${numberFormatter.format(foundationMetrics.derived_stock_balances)} saldo(s) derivados da planilha.`,
      impact:
        "Saldo inferido é útil para início, mas precisa de confirmação operacional para baixa segura.",
      guardrail:
        "Gerar stock_balances oficiais e emitir evento quando houver ajuste físico.",
      priority: foundationMetrics.stock_balances === 0 ? "high" : "normal",
      eventType: "inventory.adjusted",
      source: "Fundação operacional",
    });
  }

  return risks
    .sort(
      (a, b) =>
        riskPriorityScore(b.priority) - riskPriorityScore(a.priority) ||
        a.area.localeCompare(b.area, "pt-BR"),
    )
    .slice(0, 8);
}

function deriveOperationalRisks({
  inbox,
  requests,
  warehouseOps,
}: {
  inbox: AiInsight[];
  requests: CustomerRequest[];
  warehouseOps?: WarehouseOpsResponse;
}) {
  const risks: OperationalRisk[] = [];
  const seen = new Set<string>();
  const addRisk = (risk: OperationalRisk) => {
    if (seen.has(risk.id)) return;
    seen.add(risk.id);
    risks.push(risk);
  };

  inbox
    .filter((item) => item.status !== "resolved")
    .forEach((item) => {
      addRisk({
        id: `insight:${item.id}`,
        title: item.title,
        detail: item.message,
        source: "Radar IA",
        priority: normalizeRiskPriority(item.priority),
        customerCode: item.customer_code,
        entity: entityLabel(
          item.entity_type,
          item.entity_id,
          item.customer_code,
        ),
        createdAt: item.created_at,
        action: "Acompanhar até resolução operacional.",
      });
    });

  warehouseQueues(warehouseOps?.queues).forEach((queue) => {
    const queueName =
      queue.name || (queue.key ? entityTypeLabel(queue.key) : "Fila WMS");
    const activeTasks = (queue.tasks ?? []).filter(isActiveWmsTask);

    activeTasks.forEach((task) => {
      const exceptionCount = Number(task.exception_count ?? 0);
      const taskPriority = normalizeRiskPriority(task.priority);
      const hasBlocker = Boolean(task.blocked_reason) || exceptionCount > 0;
      const hasDueDate = Boolean(task.due_at);

      if (!hasBlocker && taskPriority === "normal" && !hasDueDate) return;

      addRisk({
        id: `wms:${queue.key ?? queueName}:${task.id}`,
        title: `${queueName}: ${task.title || task.reference || task.id}`,
        detail:
          task.blocked_reason ||
          task.notes ||
          task.next_action ||
          `${statusLabel(task.status)} com ${numberFormatter.format(task.quantity ?? 0)} unidade(s).`,
        source: "Bancada WMS",
        priority:
          hasBlocker || taskPriority === "critical" ? "critical" : taskPriority,
        customerCode: task.customer,
        entity: task.customer_request_id
          ? `Solicitação ${task.customer_request_id}`
          : task.reference
            ? `Tarefa ${task.reference}`
            : null,
        dueAt: task.due_at,
        action: task.next_action,
      });
    });

    if (Number(queue.pending ?? 0) > 0 && activeTasks.length > 0) {
      addRisk({
        id: `wms-queue:${queue.key ?? queueName}`,
        title: `${queueName} com fila ativa`,
        detail: `${numberFormatter.format(queue.pending ?? 0)} tarefa(s) pendente(s) e ${numberFormatter.format(queue.in_progress ?? 0)} em andamento.`,
        source: "Bancada WMS",
        priority: Number(queue.pending ?? 0) >= 5 ? "high" : "normal",
        action: queue.next_action,
      });
    }
  });

  requests
    .filter((request) =>
      openRequestStatuses.has(String(request.status ?? "").toLowerCase()),
    )
    .forEach((request) => {
      const priority = normalizeRiskPriority(request.priority);
      const hasWmsLink = hasRequestWmsLink(request);
      const quantity = requestQuantity(request);
      const title = request.title || request.description || request.id;

      addRisk({
        id: `request:${request.id}`,
        title: title,
        detail: `${statusLabel(request.status)} · ${request.type || "solicitação"}${quantity ? ` · ${numberFormatter.format(quantity)} un.` : ""}`,
        source: "Solicitações",
        priority: !hasWmsLink && priority === "normal" ? "high" : priority,
        customerCode: request.customer_code,
        entity: hasWmsLink ? "Vínculo WMS criado" : "Aguardando vínculo WMS",
        createdAt: request.created_at,
        action: hasWmsLink
          ? "Acompanhar avanço nas filas operacionais."
          : "Validar e criar fluxo operacional.",
      });
    });

  return risks
    .sort((a, b) => {
      const priorityDelta =
        riskPriorityScore(b.priority) - riskPriorityScore(a.priority);
      if (priorityDelta) return priorityDelta;
      const aDue = toTimestamp(a.dueAt);
      const bDue = toTimestamp(b.dueAt);
      if (aDue || bDue)
        return (
          (aDue || Number.MAX_SAFE_INTEGER) - (bDue || Number.MAX_SAFE_INTEGER)
        );
      return toTimestamp(b.createdAt) - toTimestamp(a.createdAt);
    })
    .slice(0, 8);
}

function deriveSuggestedDecisions({
  operationalRisks,
  physicalRisks,
  requests,
  snapshot,
}: {
  operationalRisks: OperationalRisk[];
  physicalRisks: PhysicalWmsRisk[];
  requests: CustomerRequest[];
  snapshot: AiOverview["snapshot"];
}) {
  const decisions: SuggestedDecision[] = [];
  const seen = new Set<string>();
  const addDecision = (decision: SuggestedDecision) => {
    if (seen.has(decision.id)) return;
    seen.add(decision.id);
    decisions.push(decision);
  };

  physicalRisks
    .filter((risk) => risk.priority !== "normal")
    .slice(0, 2)
    .forEach((risk) => {
      addDecision({
        id: `physical:${risk.id}`,
        title: `Decidir bloqueio em ${risk.area}`,
        recommendation: risk.guardrail,
        reason: risk.signal,
        priority: risk.priority,
        owner: "Líder WMS",
        trace: `${risk.eventType} · ${risk.relatedEntity || risk.source}`,
        confidence: "Alta",
      });
    });

  operationalRisks.slice(0, 2).forEach((risk) => {
    addDecision({
      id: `risk:${risk.id}`,
      title: `Priorizar ${risk.source}`,
      recommendation:
        risk.action || "Definir responsável e registrar próxima transição.",
      reason: risk.detail,
      priority: risk.priority,
      owner: risk.source === "Bancada WMS" ? "Líder WMS" : "Operação",
      trace: risk.entity || risk.customerCode || risk.source,
      confidence: risk.priority === "normal" ? "Média" : "Alta",
    });
  });

  const requestWithoutWms = requests.find(
    (request) =>
      openRequestStatuses.has(String(request.status ?? "").toLowerCase()) &&
      !hasRequestWmsLink(request),
  );

  if (requestWithoutWms) {
    addDecision({
      id: `request:${requestWithoutWms.id}`,
      title: "Materializar solicitação em fluxo WMS",
      recommendation:
        "Aprovar, rejeitar ou transformar a solicitação em recebimento/pedido/tarefa rastreável.",
      reason:
        requestWithoutWms.title ||
        requestWithoutWms.description ||
        "Solicitação aberta sem vínculo físico.",
      priority: normalizeRiskPriority(requestWithoutWms.priority) === "critical"
        ? "critical"
        : "high",
      owner: "Atendimento operacional",
      trace: `customer_request.approved · ${requestWithoutWms.id}`,
      confidence: "Alta",
    });
  }

  if (snapshot.missing_costs > 0) {
    addDecision({
      id: "finance:missing-costs",
      title: "Completar custos antes do fechamento",
      recommendation:
        "Resolver SKUs sem custo para evitar faturamento ou margem com base incompleta.",
      reason: `${numberFormatter.format(snapshot.missing_costs)} custo(s) pendente(s) no inventário monitorado.`,
      priority: "high",
      owner: "Financeiro / Cadastro",
      trace: "inventoryAnomalyFlow · skus",
      confidence: "Alta",
    });
  }

  if (snapshot.open_orders > 0) {
    addDecision({
      id: "ops:open-orders",
      title: "Revisar pedidos abertos no briefing",
      recommendation:
        "Usar o briefing diário para separar pedidos que exigem ação física hoje.",
      reason: `${numberFormatter.format(snapshot.open_orders)} pedido(s) aberto(s) no radar do Agent Dute.`,
      priority: "normal",
      owner: "Operação",
      trace: "dailyBriefingFlow · orders",
      confidence: "Média",
    });
  }

  return decisions
    .sort(
      (a, b) =>
        riskPriorityScore(b.priority) - riskPriorityScore(a.priority) ||
        a.title.localeCompare(b.title, "pt-BR"),
    )
    .slice(0, 5);
}

function MetricCard({
  title,
  value,
  caption,
  icon: Icon,
}: {
  title: string;
  value: string;
  caption: string;
  icon: LucideIcon;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between pb-3">
        <div>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            {title}
          </CardTitle>
          <div className="mt-3 text-2xl font-semibold text-foreground">
            {value}
          </div>
        </div>
        <div className="flex h-10 w-10 items-center justify-center rounded-[16px] border border-border bg-white/70">
          <Icon className="h-4 w-4 text-muted-foreground" />
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <p className="text-xs text-muted-foreground">{caption}</p>
      </CardContent>
    </Card>
  );
}

function AiLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-8 w-72 rounded-[16px] bg-gray-200" />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[1, 2, 3, 4].map((item) => (
          <div key={item} className="h-36 rounded-[24px] bg-gray-200" />
        ))}
      </div>
      <div className="grid gap-6 xl:grid-cols-[1fr_420px]">
        <div className="h-[520px] rounded-[24px] bg-gray-200" />
        <div className="h-[520px] rounded-[24px] bg-gray-200" />
      </div>
    </div>
  );
}

function FoundationStat({
  label,
  value,
  caption,
}: {
  label: string;
  value: string;
  caption: string;
}) {
  return (
    <div className="rounded-[18px] border border-border bg-white/58 px-4 py-3 shadow-[0_8px_24px_rgba(15,23,42,.04)] backdrop-blur-[32px]">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-2 text-xl font-semibold text-foreground">{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{caption}</div>
    </div>
  );
}

function GenkitFlowBoard({ flows }: { flows: GenkitFlowRuntime[] }) {
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

function SuggestedDecisionsPanel({
  decisions,
}: {
  decisions: SuggestedDecision[];
}) {
  return (
    <Card>
      <CardHeader className="border-b border-border/60">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[16px] border border-border bg-white/70">
            <ListChecks className="h-4 w-4 text-muted-foreground" />
          </div>
          <div>
            <CardTitle className="text-base">Decisões sugeridas</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Recomendações acionáveis antes de o Agent Dute avançar a operação.
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-5">
        {decisions.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            Nenhuma decisão sugerida agora.
          </div>
        ) : (
          decisions.map((decision, index) => (
            <div key={decision.id} className="soft-panel rounded-[18px] p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[12px] border border-border bg-white/70 text-xs font-semibold text-foreground">
                    {index + 1}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-foreground">
                      {decision.title}
                    </div>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                      {decision.recommendation}
                    </p>
                  </div>
                </div>
                <Badge
                  variant="outline"
                  className={cn("shrink-0", riskPriorityClass(decision.priority))}
                >
                  {riskPriorityLabel(decision.priority)}
                </Badge>
              </div>
              <div className="mt-3 rounded-[14px] border border-border bg-white/65 px-3 py-2 text-xs leading-5 text-muted-foreground">
                {decision.reason}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>{decision.owner}</span>
                <ArrowRight className="h-3.5 w-3.5" />
                <span>{decision.trace}</span>
                <Badge variant="outline">confiança {decision.confidence}</Badge>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function PhysicalWmsRiskPanel({ risks }: { risks: PhysicalWmsRisk[] }) {
  return (
    <Card>
      <CardHeader className="border-b border-border/60">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[16px] border border-border bg-white/70">
              <FileWarning className="h-4 w-4 text-muted-foreground" />
            </div>
            <div>
              <CardTitle className="text-base">Risco de WMS físico</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                Guardrails para não avançar baixa, reserva ou expedição sem evidência física.
              </p>
            </div>
          </div>
          <Badge variant="outline" className="border-slate-200 bg-white/70">
            <Box className="mr-1 h-3 w-3" />
            {numberFormatter.format(risks.length)} risco(s)
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="pt-5">
        {risks.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            Nenhum risco físico destacado agora.
          </div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {risks.map((risk) => (
              <div key={risk.id} className="soft-panel rounded-[20px] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-foreground">
                      {risk.area}
                    </div>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                      {risk.signal}
                    </p>
                  </div>
                  <Badge
                    variant="outline"
                    className={riskPriorityClass(risk.priority)}
                  >
                    {riskPriorityLabel(risk.priority)}
                  </Badge>
                </div>
                <div className="mt-3 grid gap-2 text-xs leading-5 text-muted-foreground">
                  <div className="rounded-[14px] border border-border bg-white/65 px-3 py-2">
                    {risk.impact}
                  </div>
                  <div className="rounded-[14px] border border-border bg-white/65 px-3 py-2">
                    {risk.guardrail}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <MapPin className="h-3.5 w-3.5" />
                  <span>{risk.source}</span>
                  {risk.relatedEntity ? <span>{risk.relatedEntity}</span> : null}
                  <span>{risk.eventType}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function EventTraceabilityPanel({ events }: { events: AiEvent[] }) {
  const tracedEvents = events.slice(0, 8);

  return (
    <Card>
      <CardHeader className="border-b border-border/60">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[16px] border border-border bg-white/70">
            <Database className="h-4 w-4 text-muted-foreground" />
          </div>
          <div>
            <CardTitle className="text-base">Rastreabilidade por evento</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              IDs, entidade, fonte e payload para auditoria do que a IA viu.
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-5">
        {tracedEvents.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            Sem eventos rastreáveis no ledger.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-left text-sm">
              <thead className="border-b border-border text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-3 font-medium">Evento</th>
                  <th className="px-3 py-3 font-medium">Entidade</th>
                  <th className="px-3 py-3 font-medium">Fonte</th>
                  <th className="px-3 py-3 font-medium">Payload</th>
                  <th className="px-3 py-3 font-medium">Quando</th>
                  <th className="px-3 py-3 font-medium">Severidade</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {tracedEvents.map((event) => (
                  <tr key={event.id} className="align-top hover:bg-white/50">
                    <td className="px-3 py-4">
                      <div className="font-mono text-xs text-foreground">
                        {event.id}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {event.type}
                      </div>
                    </td>
                    <td className="px-3 py-4 text-xs text-muted-foreground">
                      {entityLabel(
                        event.entity_type,
                        event.entity_id,
                        event.customer_code,
                      )}
                    </td>
                    <td className="px-3 py-4 text-xs text-muted-foreground">
                      {event.source || "app"}
                    </td>
                    <td className="px-3 py-4 text-xs text-muted-foreground">
                      {payloadSummary(event.payload)}
                    </td>
                    <td className="px-3 py-4 text-xs text-muted-foreground">
                      {formatDate(event.occurred_at)}
                    </td>
                    <td className="px-3 py-4">
                      <Badge
                        variant="outline"
                        className={severityClass(event.severity)}
                      >
                        {event.severity === "attention"
                          ? "Atenção"
                          : event.severity === "critical"
                            ? "Crítico"
                            : "Info"}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function AiControl() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [note, setNote] = useState("");
  const [severity, setSeverity] = useState<EventSeverity>("info");

  const overview = useQuery({
    queryKey: ["ai-overview"],
    queryFn: () => fetchJson<AiOverview>("/api/ai/overview"),
    refetchInterval: 30000,
  });

  const foundation = useQuery({
    queryKey: ["operational-foundation"],
    queryFn: () =>
      fetchJson<OperationalFoundationSnapshot>("/api/operational/foundation"),
    refetchInterval: 30000,
  });

  const warehouseOps = useQuery({
    queryKey: ["warehouse-ops"],
    queryFn: () => fetchJson<WarehouseOpsResponse>("/api/warehouse/ops"),
    refetchInterval: 30000,
    retry: 1,
  });

  const customerRequests = useQuery({
    queryKey: ["customer-requests", "ai-control"],
    queryFn: () =>
      fetchJson<ListResponse<CustomerRequest>>(
        "/api/customer-requests?limit=200",
      ),
    refetchInterval: 30000,
    retry: 1,
  });

  const createNote = useMutation({
    mutationFn: async () =>
      fetchJson("/api/ai/events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "operator.note",
          title: "Anotação operacional",
          description: note.trim(),
          severity,
          entity_type: "operacao",
          entity_id: "dutelog",
          customer_code: "BTG Pactual",
          source: "operator_note",
        }),
      }),
    onSuccess: () => {
      setNote("");
      setSeverity("info");
      qc.invalidateQueries({ queryKey: ["ai-overview"] });
      qc.invalidateQueries({ queryKey: ["warehouse-ops"] });
      toast({ title: "Anotação enviada para a memória da IA" });
    },
    onError: () => {
      toast({ title: "Erro ao registrar anotação", variant: "destructive" });
    },
  });

  const resolveInsight = useMutation({
    mutationFn: async (id: string) =>
      fetchJson(`/api/ai/inbox/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "resolved" }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ai-overview"] });
      qc.invalidateQueries({ queryKey: ["warehouse-ops"] });
      toast({ title: "Alerta resolvido" });
    },
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

  const sources = useMemo(
    () => overview.data?.sources.join(", ") ?? "",
    [overview.data?.sources],
  );

  if (overview.isLoading) return <AiLoading />;

  if (overview.error || !overview.data) {
    return (
      <div className="rounded-[20px] border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive">
        Não consegui carregar a central da IA agora.
      </div>
    );
  }

  const { snapshot, inbox, events, memory } = overview.data;
  const foundationMetrics = foundation.data?.metrics;
  const eventEntityGroups = groupEventsByEntity(events).slice(0, 6);
  const clientMemory = memory.filter(isClientMemory).slice(0, 6);
  const requestItems = customerRequests.data?.items ?? [];
  const operationalRisks = deriveOperationalRisks({
    inbox,
    requests: requestItems,
    warehouseOps: warehouseOps.data,
  });
  const openRequests = requestItems.filter((request) =>
    openRequestStatuses.has(String(request.status ?? "").toLowerCase()),
  );
  const activeWmsQueues = warehouseQueues(warehouseOps.data?.queues);
  const activeWmsTasks = activeWmsQueues.flatMap((queue) =>
    (queue.tasks ?? []).filter(isActiveWmsTask),
  );
  const genkitFlows = buildRuntimeFlows(events);
  const physicalWmsRisks = derivePhysicalWmsRisks({
    requests: requestItems,
    warehouseOps: warehouseOps.data,
    foundationMetrics,
  });
  const suggestedDecisions = deriveSuggestedDecisions({
    operationalRisks,
    physicalRisks: physicalWmsRisks,
    requests: requestItems,
    snapshot,
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-[18px] border border-border bg-white/70 shadow-[0_8px_24px_rgba(15,23,42,.04)]">
              <BrainCircuit className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-normal text-foreground">
                Agent Dute
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Memória viva de eventos, solicitações, estoque, pedidos e
                faturamento, incluindo contratos e propostas comerciais reais.
              </p>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant="outline"
            className="border-blue-200 bg-blue-50 text-blue-700"
          >
            <Radio className="mr-1 h-3 w-3" />
            Monitorando
          </Badge>
          <Button
            variant="outline"
            onClick={() => {
              overview.refetch();
              foundation.refetch();
              warehouseOps.refetch();
              customerRequests.refetch();
            }}
            disabled={
              overview.isFetching ||
              foundation.isFetching ||
              warehouseOps.isFetching ||
              customerRequests.isFetching
            }
          >
            <RefreshCw
              className={cn(
                "h-4 w-4",
                (overview.isFetching ||
                  foundation.isFetching ||
                  warehouseOps.isFetching ||
                  customerRequests.isFetching) &&
                  "animate-spin",
              )}
            />
            Atualizar
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title="Eventos no ledger"
          value={numberFormatter.format(snapshot.total_events)}
          caption={
            snapshot.derived_events
              ? `${snapshot.derived_events} evento(s) derivados dos dados existentes`
              : "Eventos reais gravados a partir das ações do sistema"
          }
          icon={Database}
        />
        <MetricCard
          title="Radar aberto"
          value={numberFormatter.format(snapshot.open_insights)}
          caption="Alertas e tarefas que o Agent Dute está acompanhando"
          icon={Bell}
        />
        <MetricCard
          title="Valor monitorado"
          value={moneyFormatter.format(snapshot.inventory_value)}
          caption={`${numberFormatter.format(snapshot.total_pieces)} peça(s) em estoque`}
          icon={Sparkles}
        />
        <MetricCard
          title="Pendências críticas"
          value={numberFormatter.format(
            snapshot.missing_costs + snapshot.open_orders,
          )}
          caption={`${snapshot.missing_costs} custo(s) pendente(s), ${snapshot.open_orders} pedido(s) aberto(s)`}
          icon={AlertTriangle}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,.85fr)]">
        <GenkitFlowBoard flows={genkitFlows} />
        <SuggestedDecisionsPanel decisions={suggestedDecisions} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.25fr_.75fr]">
        <Card>
          <CardHeader className="border-b border-border/60">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[16px] border border-border bg-white/70">
                <PackageSearch className="h-4 w-4 text-muted-foreground" />
              </div>
              <div>
                <CardTitle className="text-base">
                  Eventos recentes por entidade
                </CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  Entidades com atividade mais nova no ledger do Agent Dute.
                </p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 pt-5">
            {eventEntityGroups.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                Nenhuma entidade com eventos recentes.
              </div>
            ) : (
              eventEntityGroups.map((group) => (
                <div
                  key={group.key}
                  className="rounded-[20px] border border-border bg-white/58 p-4 shadow-[0_8px_24px_rgba(15,23,42,.04)] backdrop-blur-[32px]"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="font-medium text-foreground">
                        {group.label}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {group.typeLabel} ·{" "}
                        {numberFormatter.format(group.count)} evento(s) ·{" "}
                        {formatDate(group.latestAt)}
                      </div>
                    </div>
                    <Badge
                      variant="outline"
                      className={severityClass(group.severity)}
                    >
                      {group.severity === "attention"
                        ? "Atenção"
                        : group.severity === "critical"
                          ? "Crítico"
                          : "Info"}
                    </Badge>
                  </div>

                  <div className="mt-4 space-y-3">
                    {group.events.slice(0, 3).map((event) => (
                      <div
                        key={event.id}
                        className="border-l-2 border-border pl-3"
                      >
                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <span>{formatDate(event.occurred_at)}</span>
                          <span>{event.type}</span>
                          {event.customer_code ? (
                            <span>{event.customer_code}</span>
                          ) : null}
                        </div>
                        <div className="mt-1 text-sm font-medium text-foreground">
                          {event.title}
                        </div>
                        {event.description ? (
                          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                            {event.description}
                          </p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b border-border/60">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[16px] border border-border bg-white/70">
                <UserRound className="h-4 w-4 text-muted-foreground" />
              </div>
              <div>
                <CardTitle className="text-base">Memória por cliente</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  Contexto persistente que o Agent Dute associa a cada cliente.
                </p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 pt-5">
            {clientMemory.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                Nenhuma memória de cliente criada ainda.
              </div>
            ) : (
              clientMemory.map((item) => (
                <div
                  key={item.id}
                  className="rounded-[20px] border border-border bg-white/58 p-4 shadow-[0_8px_24px_rgba(15,23,42,.04)] backdrop-blur-[32px]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-foreground">
                        {item.title}
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {item.summary ||
                          item.last_event_title ||
                          "Memória em formação"}
                      </p>
                    </div>
                    <Badge variant="outline">cliente</Badge>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <span>{item.scope_id}</span>
                    <span>
                      {numberFormatter.format(item.event_count ?? 0)} evento(s)
                    </span>
                    <span>{formatDate(item.last_event_at)}</span>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="border-b border-border/60">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[16px] border border-border bg-white/70">
                <ShieldAlert className="h-4 w-4 text-muted-foreground" />
              </div>
              <div>
                <CardTitle className="text-base">
                  Próximos riscos operacionais
                </CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  Sinais abertos do Agent Dute cruzados com filas WMS e
                  solicitações.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline" className="border-slate-200 bg-white/70">
                <Warehouse className="mr-1 h-3 w-3" />
                {numberFormatter.format(activeWmsTasks.length)} tarefa(s) WMS
              </Badge>
              <Badge variant="outline" className="border-slate-200 bg-white/70">
                <ClipboardList className="mr-1 h-3 w-3" />
                {numberFormatter.format(openRequests.length)} solicitação(ões)
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 pt-5">
          {warehouseOps.error || customerRequests.error ? (
            <div className="rounded-[16px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              Parte do radar WMS/solicitações não carregou agora.
            </div>
          ) : null}

          {operationalRisks.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Nenhum risco operacional próximo encontrado.
            </div>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {operationalRisks.map((risk) => (
                <div
                  key={risk.id}
                  className="rounded-[20px] border border-border bg-white/58 p-4 shadow-[0_8px_24px_rgba(15,23,42,.04)] backdrop-blur-[32px]"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-foreground">
                        {risk.title}
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {risk.detail}
                      </p>
                    </div>
                    <Badge
                      variant="outline"
                      className={riskPriorityClass(risk.priority)}
                    >
                      {riskPriorityLabel(risk.priority)}
                    </Badge>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <span>{risk.source}</span>
                    {risk.customerCode ? (
                      <span>{risk.customerCode}</span>
                    ) : null}
                    {risk.entity ? <span>{risk.entity}</span> : null}
                    {risk.dueAt || risk.createdAt ? (
                      <span>{formatDate(risk.dueAt || risk.createdAt)}</span>
                    ) : null}
                  </div>

                  {risk.action ? (
                    <div className="mt-3 flex items-start gap-2 rounded-[14px] border border-border bg-white/70 px-3 py-2 text-xs text-muted-foreground">
                      <CalendarClock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>{risk.action}</span>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <PhysicalWmsRiskPanel risks={physicalWmsRisks} />

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

      <div className="grid gap-6 xl:grid-cols-[1fr_420px]">
        <Card>
          <CardHeader className="border-b border-border/60">
            <div className="flex flex-col gap-1">
              <CardTitle className="text-base">
                Linha do tempo operacional
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                O que a IA viu acontecer no sistema.
              </p>
            </div>
          </CardHeader>
          <CardContent className="pt-6">
            {events.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                Ainda não há eventos registrados.
              </div>
            ) : (
              <div className="space-y-5">
                {events.map((event) => (
                  <div
                    key={event.id}
                    className="grid gap-4 sm:grid-cols-[150px_1fr]"
                  >
                    <div className="flex items-start gap-2 text-xs text-muted-foreground">
                      <Clock3 className="mt-0.5 h-3.5 w-3.5" />
                      <span>{formatDate(event.occurred_at)}</span>
                    </div>
                    <div className="rounded-[20px] border border-border bg-white/58 p-4 shadow-[0_8px_24px_rgba(15,23,42,.04)] backdrop-blur-[32px]">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="font-medium text-foreground">
                            {event.title}
                          </div>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {event.description || event.type}
                          </p>
                        </div>
                        <Badge
                          variant="outline"
                          className={severityClass(event.severity)}
                        >
                          {event.severity === "attention"
                            ? "Atenção"
                            : event.severity === "critical"
                              ? "Crítico"
                              : "Info"}
                        </Badge>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                        <span>{event.type}</span>
                        {event.entity_type ? (
                          <span>{event.entity_type}</span>
                        ) : null}
                        {event.customer_code ? (
                          <span>{event.customer_code}</span>
                        ) : null}
                        {event.source === "derived_from_existing_data" ? (
                          <span>derivado dos dados atuais</span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader className="border-b border-border/60">
              <CardTitle className="text-base">Radar do Agent Dute</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 pt-5">
              {inbox.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  Nenhum alerta aberto agora.
                </div>
              ) : (
                inbox.map((item) => {
                  const isDerived = item.id.startsWith("derived_");
                  return (
                    <div
                      key={item.id}
                      className="rounded-[20px] border border-border bg-white/58 p-4 shadow-[0_8px_24px_rgba(15,23,42,.04)] backdrop-blur-[32px]"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-medium text-foreground">
                            {item.title}
                          </div>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {item.message}
                          </p>
                        </div>
                        <Badge variant="outline" className="shrink-0">
                          {priorityLabel(item.priority)}
                        </Badge>
                      </div>
                      <div className="mt-4 flex items-center justify-between gap-2">
                        <span className="text-xs text-muted-foreground">
                          {item.customer_code || "Operação"}
                        </span>
                        {!isDerived ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => resolveInsight.mutate(item.id)}
                            disabled={resolveInsight.isPending}
                          >
                            <CheckCircle2 className="h-4 w-4" />
                            Resolver
                          </Button>
                        ) : (
                          <Badge variant="outline">derivado</Badge>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="border-b border-border/60">
              <CardTitle className="text-base">Ensinar o Agent Dute</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 pt-5">
              <div className="space-y-2">
                <Label htmlFor="ai-note">Anotação operacional</Label>
                <Textarea
                  id="ai-note"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="Ex.: BTG avisou que amanhã chegará remessa urgente para conferência..."
                  rows={4}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                <Select
                  value={severity}
                  onValueChange={(value: EventSeverity) => setSeverity(value)}
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
                <Button
                  onClick={() => createNote.mutate()}
                  disabled={!note.trim() || createNote.isPending}
                >
                  <Send className="h-4 w-4" />
                  Registrar
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <EventTraceabilityPanel events={events} />

      <Card>
        <CardHeader className="border-b border-border/60">
          <CardTitle className="text-base">Memória operacional</CardTitle>
        </CardHeader>
        <CardContent className="pt-5">
          <div className="grid gap-3 lg:grid-cols-2">
            {memory.map((item) => (
              <div
                key={item.id}
                className="rounded-[20px] border border-border bg-white/58 p-4 shadow-[0_8px_24px_rgba(15,23,42,.04)] backdrop-blur-[32px]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-foreground">
                      {item.title}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {item.summary ||
                        item.last_event_title ||
                        "Memória em formação"}
                    </p>
                  </div>
                  <Badge variant="outline">{item.scope_type}</Badge>
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <span>{item.scope_id}</span>
                  <span>
                    {numberFormatter.format(item.event_count ?? 0)} evento(s)
                  </span>
                  <span>{formatDate(item.last_event_at)}</span>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            Fontes observadas: {sources}.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
