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
  Archive,
  MailCheck,
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

type OperationalNotification = {
  id: string;
  status?: "draft" | "approved" | "sent" | "archived" | string;
  channel?: string | null;
  audience?: "client" | "internal" | string | null;
  topic?: string | null;
  customer_code?: string | null;
  title?: string | null;
  subject?: string | null;
  body?: string | null;
  recipients?: string[] | null;
  subject_sent?: string | null;
  body_sent?: string | null;
  email_delivery?: {
    mode?: string | null;
    status?: string | null;
    sent_external?: boolean | null;
    from?: string | null;
    reply_to?: string | null;
    message?: string | null;
  } | null;
  recommended_action?: string | null;
  trigger_event_type?: string | null;
  severity?: EventSeverity | string | null;
  created_at?: string | null;
  updated_at?: string | null;
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
const physicalRiskImpact =
  "Pode quebrar a paridade entre estoque físico, reserva e ledger se a etapa avançar sem evidência.";

const genericTraceEventType = "operator.note";

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

function notificationStatusLabel(status?: string | null) {
  const labels: Record<string, string> = {
    draft: "Rascunho",
    approved: "Aprovada",
    sent: "Enviada",
    archived: "Arquivada",
  };
  return labels[String(status ?? "draft")] ?? String(status ?? "Rascunho");
}

function notificationStatusClass(status?: string | null) {
  if (status === "sent") return "border-success-soft-border bg-success-soft text-success-soft-foreground";
  if (status === "approved") return "border-info-soft-border bg-info-soft text-info-soft-foreground";
  if (status === "archived") return "border-border bg-muted text-muted-foreground";
  return "border-warning-soft-border bg-warning-soft text-warning-soft-foreground";
}

type NotificationDecisionAction = "approve" | "archive" | "mark-sent";
type NotificationDecisionPayload = {
  recipients?: string[];
  subject?: string;
  body?: string;
  note?: string;
};

function splitRecipientDraft(value: string) {
  return value
    .split(/[,;\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function severityClass(severity?: EventSeverity) {
  if (severity === "critical") {
    return "border-destructive-soft-border bg-destructive-soft text-destructive-soft-foreground";
  }
  if (severity === "attention") {
    return "border-warning-soft-border bg-warning-soft text-warning-soft-foreground";
  }
  return "border-info-soft-border bg-info-soft text-info-soft-foreground";
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
    return "border-destructive-soft-border bg-destructive-soft text-destructive-soft-foreground";
  }
  if (priority === "high") {
    return "border-warning-soft-border bg-warning-soft text-warning-soft-foreground";
  }
  return "border-info-soft-border bg-info-soft text-info-soft-foreground";
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
  caption?: string;
  icon: LucideIcon;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between pb-3">
        <div>
          <CardTitle className="text-sm font-medium text-foreground/70">
            {title}
          </CardTitle>
          <div className="mt-3 text-2xl font-semibold text-foreground">
            {value}
          </div>
        </div>
        <div className="flex h-10 w-10 items-center justify-center rounded-[16px] border border-border bg-card/70">
          <Icon className="h-4 w-4 text-primary" aria-hidden="true" />
        </div>
      </CardHeader>
      {caption ? (
        <CardContent className="pt-0">
          <p className="text-xs text-foreground/65">{caption}</p>
        </CardContent>
      ) : null}
    </Card>
  );
}

function AiLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-8 w-72 rounded-[16px] bg-primary/10" />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[1, 2, 3, 4].map((item) => (
          <div key={item} className="h-36 rounded-[24px] bg-primary/10" />
        ))}
      </div>
      <div className="grid gap-6 xl:grid-cols-[1fr_420px]">
        <div className="h-[520px] rounded-[24px] bg-primary/10" />
        <div className="h-[520px] rounded-[24px] bg-primary/10" />
      </div>
    </div>
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
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[16px] border border-border bg-card/70">
            <ListChecks className="h-4 w-4 text-muted-foreground" />
          </div>
          <div>
            <CardTitle className="text-base">Decisões sugeridas</CardTitle>
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
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[12px] border border-border bg-card/70 text-xs font-semibold text-foreground">
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
              <div className="mt-3 rounded-[14px] border border-border bg-card/65 px-3 py-2 text-xs leading-5 text-muted-foreground">
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

function OperationalNotificationsCard({
  notifications,
  isLoading,
  isSyncing,
  isDeciding,
  onSync,
  onDecide,
}: {
  notifications: OperationalNotification[];
  isLoading: boolean;
  isSyncing: boolean;
  isDeciding: boolean;
  onSync: () => void;
  onDecide: (
    id: string,
    action: NotificationDecisionAction,
    payload?: NotificationDecisionPayload,
  ) => void;
}) {
  const [deliveryDrafts, setDeliveryDrafts] = useState<
    Record<string, { recipients: string; subject: string; body: string }>
  >({});
  const visibleNotifications = notifications
    .filter((item) => item.status !== "archived")
    .slice(0, 6);

  const deliveryDraftFor = (item: OperationalNotification) =>
    deliveryDrafts[item.id] ?? {
      recipients: item.recipients?.join(", ") ?? "",
      subject: item.subject_sent ?? item.subject ?? item.title ?? "",
      body: item.body_sent ?? item.body ?? "",
    };
  const updateDeliveryDraft = (
    item: OperationalNotification,
    field: "recipients" | "subject" | "body",
    value: string,
  ) => {
    const current = deliveryDraftFor(item);
    setDeliveryDrafts((previous) => ({
      ...previous,
      [item.id]: { ...current, [field]: value },
    }));
  };

  return (
    <Card>
      <CardHeader className="border-b border-border/60">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">
              Notificações do Agent Dute
            </CardTitle>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={onSync}
            disabled={isSyncing}
          >
            <RefreshCw className={cn("h-4 w-4", isSyncing && "animate-spin")} />
            Sincronizar
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-5">
        {isLoading ? (
          <div className="rounded-[20px] border border-border bg-card/58 p-4 text-sm text-muted-foreground">
            Carregando notificações operacionais...
          </div>
        ) : visibleNotifications.length === 0 ? (
          <div className="rounded-[20px] border border-dashed border-border bg-card/45 p-6 text-center">
            <MailCheck className="mx-auto h-5 w-5 text-muted-foreground" />
            <p className="mt-3 text-sm font-medium text-foreground">
              Nenhuma mensagem pendente
            </p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Sincronize o ledger para o Agent Dute preparar rascunhos quando
              houver eventos comunicáveis.
            </p>
          </div>
        ) : (
          visibleNotifications.map((item) => {
            const deliveryDraft = deliveryDraftFor(item);
            const recipients = splitRecipientDraft(deliveryDraft.recipients);
            const canSend =
              recipients.length > 0 &&
              deliveryDraft.subject.trim().length > 2 &&
              deliveryDraft.body.trim().length > 2;
            return (
              <div
                key={item.id}
                className="rounded-[20px] border border-border bg-card/58 p-4 shadow-[0_8px_24px_rgba(15,23,42,.04)] backdrop-blur-[32px]"
              >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant="outline"
                      className={notificationStatusClass(item.status)}
                    >
                      {notificationStatusLabel(item.status)}
                    </Badge>
                    <Badge variant="outline" className="bg-card/70">
                      {item.audience === "client" ? "Cliente" : "Interno"}
                    </Badge>
                  </div>
                  <p className="mt-3 text-sm font-medium text-foreground">
                    {item.subject || item.title || "Notificação operacional"}
                  </p>
                  <p className="mt-2 whitespace-pre-line text-xs leading-5 text-muted-foreground">
                    {item.body || "Mensagem ainda sem conteúdo preparado."}
                  </p>
                </div>
                <MailCheck className="mt-1 h-4 w-4 shrink-0 text-primary" />
              </div>
              <div className="mt-4 rounded-2xl border border-border bg-card/50 p-3 text-xs leading-5 text-muted-foreground">
                <span className="font-medium text-foreground">Origem:</span>{" "}
                {item.trigger_event_type || "evento operacional"} ·{" "}
                {item.customer_code || "BTG Pactual"}
              </div>
              {item.status === "approved" ? (
                <div className="mt-4 space-y-3 rounded-2xl border border-info-soft-border bg-info-soft/35 p-3">
                  <div>
                    <Label
                      htmlFor={`notification-recipients-${item.id}`}
                      className="text-xs text-muted-foreground"
                    >
                      Destinatários
                    </Label>
                    <Input
                      id={`notification-recipients-${item.id}`}
                      value={deliveryDraft.recipients}
                      onChange={(event) =>
                        updateDeliveryDraft(
                          item,
                          "recipients",
                          event.target.value,
                        )
                      }
                      placeholder="email@cliente.com.br, copia@dutelog.com.br"
                      className="mt-1 h-10 text-sm"
                    />
                  </div>
                  <div>
                    <Label
                      htmlFor={`notification-subject-${item.id}`}
                      className="text-xs text-muted-foreground"
                    >
                      Assunto final
                    </Label>
                    <Input
                      id={`notification-subject-${item.id}`}
                      value={deliveryDraft.subject}
                      onChange={(event) =>
                        updateDeliveryDraft(item, "subject", event.target.value)
                      }
                      className="mt-1 h-10 text-sm"
                    />
                  </div>
                  <div>
                    <Label
                      htmlFor={`notification-body-${item.id}`}
                      className="text-xs text-muted-foreground"
                    >
                      Mensagem final aprovada
                    </Label>
                    <Textarea
                      id={`notification-body-${item.id}`}
                      value={deliveryDraft.body}
                      onChange={(event) =>
                        updateDeliveryDraft(item, "body", event.target.value)
                      }
                      className="mt-1 min-h-28 text-sm"
                    />
                  </div>
                  <p className="text-xs leading-5 text-muted-foreground">
                    O Agent Dute só registra ou envia depois desta revisão
                    humana. Sem destinatário válido, o envio fica bloqueado.
                  </p>
                </div>
              ) : null}
              {item.status === "sent" ? (
                <div className="mt-4 rounded-2xl border border-success-soft-border bg-success-soft/45 p-3 text-xs leading-5 text-success-soft-foreground">
                  {item.email_delivery?.sent_external
                    ? "E-mail transacional enviado pelo provedor configurado."
                    : "Envio registrado em modo auditado. Configure o provedor para disparo externo real."}
                  {item.recipients?.length ? (
                    <span className="mt-1 block text-success-soft-foreground/80">
                      Destinatários: {item.recipients.join(", ")}
                    </span>
                  ) : null}
                </div>
              ) : null}
              <div className="mt-4 flex flex-wrap items-center gap-2">
                {item.status === "draft" ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onDecide(item.id, "approve")}
                    disabled={isDeciding}
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    Aprovar
                  </Button>
                ) : null}
                {item.status === "approved" ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      onDecide(item.id, "mark-sent", {
                        recipients,
                        subject: deliveryDraft.subject.trim(),
                        body: deliveryDraft.body.trim(),
                      })
                    }
                    disabled={isDeciding || !canSend}
                  >
                    <Send className="h-4 w-4" />
                    Enviar / registrar
                  </Button>
                ) : null}
                {item.status !== "sent" ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onDecide(item.id, "archive")}
                    disabled={isDeciding}
                  >
                    <Archive className="h-4 w-4" />
                    Arquivar
                  </Button>
                ) : null}
              </div>
            </div>
            );
          })
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
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[16px] border border-border bg-card/70">
              <FileWarning className="h-4 w-4 text-muted-foreground" />
            </div>
            <div>
              <CardTitle className="text-base">Risco de WMS físico</CardTitle>
            </div>
          </div>
          <Badge variant="outline" className="border-border bg-card/70">
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
                  <div className="rounded-[14px] border border-border bg-card/65 px-3 py-2">
                    {risk.impact}
                  </div>
                  <div className="rounded-[14px] border border-border bg-card/65 px-3 py-2">
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
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[16px] border border-border bg-card/70">
            <Database className="h-4 w-4 text-muted-foreground" />
          </div>
          <div>
            <CardTitle className="text-base">Rastreabilidade por evento</CardTitle>
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
                  <tr key={event.id} className="align-top hover:bg-card/50">
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
    refetchInterval: 120_000,
    refetchOnWindowFocus: false,
  });

  const foundation = useQuery({
    queryKey: ["operational-foundation"],
    queryFn: () =>
      fetchJson<OperationalFoundationSnapshot>("/api/operational/foundation"),
    refetchInterval: 120_000,
    refetchOnWindowFocus: false,
  });

  const warehouseOps = useQuery({
    queryKey: ["warehouse-ops"],
    queryFn: () => fetchJson<WarehouseOpsResponse>("/api/warehouse/ops"),
    refetchInterval: 120_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const customerRequests = useQuery({
    queryKey: ["customer-requests", "ai-control"],
    queryFn: () =>
      fetchJson<ListResponse<CustomerRequest>>(
        "/api/customer-requests?limit=200",
      ),
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const notifications = useQuery({
    queryKey: ["agent-operational-notifications"],
    queryFn: () =>
      fetchJson<ListResponse<OperationalNotification>>(
        "/api/agent-dute/notifications?limit=20",
      ),
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
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

  const syncNotifications = useMutation({
    mutationFn: async () =>
      fetchJson<{
        scanned: number;
        candidates: number;
        created: number;
      }>("/api/agent-dute/notifications/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ customer_code: "BTG Pactual", limit: 250 }),
      }),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["agent-operational-notifications"] });
      qc.invalidateQueries({ queryKey: ["ai-overview"] });
      toast({
        title: "Notificações sincronizadas",
        description: `${numberFormatter.format(result.created)} rascunho(s) novo(s) a partir de ${numberFormatter.format(result.scanned)} evento(s).`,
      });
    },
    onError: () => {
      toast({
        title: "Erro ao sincronizar notificações",
        variant: "destructive",
      });
    },
  });

  const decideNotification = useMutation({
    mutationFn: async ({
      id,
      action,
      payload,
    }: {
      id: string;
      action: NotificationDecisionAction;
      payload?: NotificationDecisionPayload;
    }) =>
      fetchJson(`/api/agent-dute/notifications/${encodeURIComponent(id)}/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload ?? {}),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agent-operational-notifications"] });
      qc.invalidateQueries({ queryKey: ["ai-overview"] });
      toast({ title: "Notificação atualizada" });
    },
    onError: () => {
      toast({
        title: "Erro ao atualizar notificação",
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
            <div className="flex h-11 w-11 items-center justify-center rounded-[18px] border border-border bg-card/70 shadow-[0_8px_24px_rgba(15,23,42,.04)]">
              <BrainCircuit className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-normal text-foreground">
                Agent Dute
              </h1>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant="outline"
            className="border-info-soft-border bg-info-soft text-info-soft-foreground"
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
              notifications.refetch();
            }}
            disabled={
              overview.isFetching ||
              foundation.isFetching ||
              warehouseOps.isFetching ||
              customerRequests.isFetching ||
              notifications.isFetching
            }
          >
            <RefreshCw
              className={cn(
                "h-4 w-4",
                (overview.isFetching ||
                  foundation.isFetching ||
                  warehouseOps.isFetching ||
                  customerRequests.isFetching ||
                  notifications.isFetching) &&
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
          icon={Database}
        />
        <MetricCard
          title="Radar aberto"
          value={numberFormatter.format(snapshot.open_insights)}
          icon={Bell}
        />
        <MetricCard
          title="Valor monitorado"
          value={moneyFormatter.format(snapshot.inventory_value)}
          icon={Sparkles}
        />
        <MetricCard
          title="Pendências críticas"
          value={numberFormatter.format(
            snapshot.missing_costs + snapshot.open_orders,
          )}
          icon={AlertTriangle}
        />
      </div>

      <SuggestedDecisionsPanel decisions={suggestedDecisions} />

      <div className="grid gap-6 xl:grid-cols-[1.25fr_.75fr]">
        <Card>
          <CardHeader className="border-b border-border/60">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[16px] border border-border bg-card/70">
                <PackageSearch className="h-4 w-4 text-muted-foreground" />
              </div>
              <div>
                <CardTitle className="text-base">
                  Eventos recentes por entidade
                </CardTitle>
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
                  className="rounded-[20px] border border-border bg-card/58 p-4 shadow-[0_8px_24px_rgba(15,23,42,.04)] backdrop-blur-[32px]"
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
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[16px] border border-border bg-card/70">
                <UserRound className="h-4 w-4 text-muted-foreground" />
              </div>
              <div>
                <CardTitle className="text-base">Memória por cliente</CardTitle>
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
                  className="rounded-[20px] border border-border bg-card/58 p-4 shadow-[0_8px_24px_rgba(15,23,42,.04)] backdrop-blur-[32px]"
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
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[16px] border border-border bg-card/70">
                <ShieldAlert className="h-4 w-4 text-muted-foreground" />
              </div>
              <div>
                <CardTitle className="text-base">
                  Próximos riscos operacionais
                </CardTitle>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline" className="border-border bg-card/70">
                <Warehouse className="mr-1 h-3 w-3" />
                {numberFormatter.format(activeWmsTasks.length)} tarefa(s) WMS
              </Badge>
              <Badge variant="outline" className="border-border bg-card/70">
                <ClipboardList className="mr-1 h-3 w-3" />
                {numberFormatter.format(openRequests.length)} solicitação(ões)
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 pt-5">
          {warehouseOps.error || customerRequests.error ? (
            <div className="rounded-[16px] border border-warning-soft-border bg-warning-soft px-4 py-3 text-sm text-warning-soft-foreground">
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
                  className="rounded-[20px] border border-border bg-card/58 p-4 shadow-[0_8px_24px_rgba(15,23,42,.04)] backdrop-blur-[32px]"
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
                    <div className="mt-3 flex items-start gap-2 rounded-[14px] border border-border bg-card/70 px-3 py-2 text-xs text-muted-foreground">
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


      <div className="grid gap-6 xl:grid-cols-[1fr_420px]">
        <Card>
          <CardHeader className="border-b border-border/60">
            <div className="flex flex-col gap-1">
              <CardTitle className="text-base">
                Linha do tempo operacional
              </CardTitle>
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
                    <div className="rounded-[20px] border border-border bg-card/58 p-4 shadow-[0_8px_24px_rgba(15,23,42,.04)] backdrop-blur-[32px]">
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
          <OperationalNotificationsCard
            notifications={notifications.data?.items ?? []}
            isLoading={notifications.isLoading}
            isSyncing={syncNotifications.isPending}
            isDeciding={decideNotification.isPending}
            onSync={() => syncNotifications.mutate()}
            onDecide={(id, action, payload) =>
              decideNotification.mutate({ id, action, payload })
            }
          />

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
                      className="rounded-[20px] border border-border bg-card/58 p-4 shadow-[0_8px_24px_rgba(15,23,42,.04)] backdrop-blur-[32px]"
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
                className="rounded-[20px] border border-border bg-card/58 p-4 shadow-[0_8px_24px_rgba(15,23,42,.04)] backdrop-blur-[32px]"
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
