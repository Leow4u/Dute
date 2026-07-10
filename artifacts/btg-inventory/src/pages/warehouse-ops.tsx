import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Ban,
  Box,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  FileWarning,
  Forklift,
  Hash,
  ListChecks,
  MapPin,
  MessageSquareWarning,
  PackageCheck,
  PackageOpen,
  PackageSearch,
  PlayCircle,
  RefreshCw,
  Route,
  ShieldAlert,
  Sparkles,
  Truck,
  UserRound,
  Warehouse as WarehouseIcon,
  type LucideIcon,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type QueueKey = "receiving" | "putaway" | "picking" | "packing" | "expedition";
type WarehouseOpsModuleKey =
  | "receiving"
  | "quality"
  | "putaway"
  | "picking"
  | "packing"
  | "expedition"
  | "exceptions";
export type { WarehouseOpsModuleKey };
type TaskPriority = "low" | "normal" | "high" | "critical";
type AlertSeverity = "info" | "attention" | "critical";

type WarehouseTaskItem = {
  id?: string | null;
  sku?: string | null;
  sku_code?: string | null;
  name?: string | null;
  product_name?: string | null;
  description?: string | null;
  quantity?: number | null;
  expected_quantity?: number | null;
  picked_quantity?: number | null;
  packed_quantity?: number | null;
  qty_packed?: number | null;
  status?: string | null;
  location?: string | null;
  package_id?: string | null;
  package_code?: string | null;
  package_label?: string | null;
  package_number?: string | number | null;
  tracking_code?: string | null;
  volume?: string | null;
  volume_id?: string | null;
};

type WarehouseTaskTimelineEvent = {
  id?: string | null;
  title?: string | null;
  description?: string | null;
  status?: string | null;
  actor?: string | null;
  occurred_at?: string | null;
  created_at?: string | null;
  at?: string | null;
};

type WarehouseTask = {
  id: string;
  title?: string | null;
  reference?: string | null;
  sku?: string | null;
  customer?: string | null;
  location?: string | null;
  quantity?: number | null;
  assignee?: string | null;
  priority?: TaskPriority | string | null;
  status?: string | null;
  due_at?: string | null;
  created_at?: string | null;
  next_action?: string | null;
  notes?: string | null;
  progress?: number | null;
  blocked_reason?: string | null;
  exception_count?: number | null;
  items?: WarehouseTaskItem[];
  timeline?: WarehouseTaskTimelineEvent[];
  customer_request_id?: string | null;
  can_advance?: boolean | null;
  can_register_exception?: boolean | null;
};

type OpsQueue = {
  key?: QueueKey | string | null;
  name?: string | null;
  pending?: number | null;
  in_progress?: number | null;
  completed_today?: number | null;
  sla_minutes?: number | null;
  utilization?: number | null;
  next_action?: string | null;
  tasks?: WarehouseTask[];
  items?: WarehouseTask[];
};

type OpsAlert = {
  id: string;
  title: string;
  message?: string | null;
  severity?: AlertSeverity | string | null;
  queue?: QueueKey | string | null;
  task_id?: string | null;
  action?: string | null;
  source?: string | null;
  created_at?: string | null;
};

type OpsMetrics = {
  pending_total?: number | null;
  due_soon?: number | null;
  critical?: number | null;
  throughput_today?: number | null;
  avg_sla_minutes?: number | null;
  agent_alerts?: number | null;
};

type WarehouseOpsResponse = {
  metrics?: OpsMetrics;
  queues?: Partial<Record<QueueKey, OpsQueue>> | OpsQueue[];
  alerts?: OpsAlert[];
  agent_summary?: string | null;
  updated_at?: string | null;
};

type QueueMeta = {
  key: QueueKey;
  label: string;
  description: string;
  icon: LucideIcon;
};

type WarehouseOpsModule = {
  key: WarehouseOpsModuleKey;
  label: string;
  description: string;
  icon: LucideIcon;
  queueKeys: QueueKey[];
  mode: "queue" | "quality" | "exceptions";
};

type NormalizedQueue = {
  key: QueueKey;
  label: string;
  description: string;
  icon: LucideIcon;
  pending: number;
  inProgress: number;
  completedToday: number;
  progress: number;
  slaMinutes?: number | null;
  nextAction?: string | null;
  tasks: WarehouseTask[];
  blockedCount: number;
  exceptionCount: number;
  dueSoonCount: number;
  activeTask?: WarehouseTask;
};

type DerivedMetrics = {
  pendingTotal: number;
  dueSoon: number;
  critical: number;
  throughputToday: number;
  avgSlaMinutes?: number | null;
  agentAlerts: number;
};

type TaskQueueEntry = {
  task: WarehouseTask;
  queue: NormalizedQueue;
};

type PackingCheckRow = {
  id: string;
  label: string;
  title: string;
  code?: string | null;
  location?: string | null;
  status?: string | null;
  expectedQuantity?: number;
  packedQuantity?: number;
  delta?: number;
  hasDivergence: boolean;
};

type LineResolution = "pending" | "confirmed" | "shortage" | "damaged";

type LineConfirmationMap = Record<string, LineResolution>;

type LineResolutionCounts = Record<LineResolution, number> & {
  total: number;
};

type ExceptionPayload = {
  task: WarehouseTask;
  queue: QueueKey;
  note: string;
};

const QUEUE_META: QueueMeta[] = [
  {
    key: "receiving",
    label: "Receiving",
    description: "Docas, conferência fiscal e entrada física.",
    icon: PackageOpen,
  },
  {
    key: "putaway",
    label: "Putaway",
    description: "Endereçamento, rua, prateleira e caixa.",
    icon: Forklift,
  },
  {
    key: "picking",
    label: "Picking",
    description: "Separação por onda, pedido e prioridade.",
    icon: PackageSearch,
  },
  {
    key: "packing",
    label: "Packing",
    description: "Conferência, embalagem e divergências.",
    icon: PackageCheck,
  },
  {
    key: "expedition",
    label: "Shipping",
    description: "Expedição, romaneio, coleta e liberação de saída.",
    icon: Truck,
  },
];

const QUEUE_ALIASES: Record<string, QueueKey> = {
  inbound: "receiving",
  entrada: "receiving",
  recebimento: "receiving",
  receiving: "receiving",
  alocacao: "putaway",
  armazenagem: "putaway",
  guardar: "putaway",
  putaway: "putaway",
  picking: "picking",
  separacao: "picking",
  conferencia: "packing",
  embalagem: "packing",
  packing: "packing",
  expedition: "expedition",
  expedicao: "expedition",
  shipping: "expedition",
};

const FOCUS_QUEUE_KEYS: QueueKey[] = [
  "receiving",
  "putaway",
  "picking",
  "packing",
  "expedition",
];

const WAREHOUSE_OPS_MODULES: WarehouseOpsModule[] = [
  {
    key: "receiving",
    label: "Recebimento",
    description: "Docas, NF e entrada física.",
    icon: PackageOpen,
    queueKeys: ["receiving"],
    mode: "queue",
  },
  {
    key: "quality",
    label: "Qualidade",
    description: "Conferência, falta, avaria e retenção.",
    icon: ClipboardCheck,
    queueKeys: FOCUS_QUEUE_KEYS,
    mode: "quality",
  },
  {
    key: "putaway",
    label: "Putaway",
    description: "Guarda endereçada e saldo liberado.",
    icon: Forklift,
    queueKeys: ["putaway"],
    mode: "queue",
  },
  {
    key: "picking",
    label: "Picking",
    description: "Separação por onda, pedido e prioridade.",
    icon: PackageSearch,
    queueKeys: ["picking"],
    mode: "queue",
  },
  {
    key: "packing",
    label: "Packing",
    description: "Volume, lacre e divergência.",
    icon: PackageCheck,
    queueKeys: ["packing"],
    mode: "queue",
  },
  {
    key: "expedition",
    label: "Expedição",
    description: "Staging, romaneio, coleta e baixa.",
    icon: Truck,
    queueKeys: ["expedition"],
    mode: "queue",
  },
  {
    key: "exceptions",
    label: "Exceções",
    description: "Bloqueios, críticos e sinais do agente.",
    icon: ShieldAlert,
    queueKeys: FOCUS_QUEUE_KEYS,
    mode: "exceptions",
  },
];

const TERMINAL_STATUSES = new Set([
  "completed",
  "delivered",
  "received",
  "closed",
  "cancelled",
  "canceled",
  "resolved",
]);

const QUEUE_ACTION_FALLBACK: Record<QueueKey, string> = {
  receiving: "Conferir a próxima entrada e registrar divergência antes da guarda.",
  putaway: "Confirmar endereço físico e liberar saldo para separação.",
  picking: "Separar o próximo pedido priorizado e sinalizar falta de item.",
  packing: "Conferir itens separados, fechar volume e liberar expedição.",
  expedition: "Preparar coleta, romaneio e baixa de saída.",
};

const EXCEPTION_EVENT_TYPE: Record<QueueKey, string> = {
  receiving: "inbound.exception_found",
  putaway: "putaway.exception_found",
  picking: "picking.shortage_found",
  packing: "packing.exception_found",
  expedition: "shipment.exception_found",
};

const PACKING_DIVERGENT_STATUSES = new Set([
  "avaria",
  "blocked",
  "damaged",
  "divergence",
  "divergencia",
  "divergent",
  "exception",
  "exception_found",
  "missing",
  "rejected",
  "short",
  "shortage",
]);

const LINE_DAMAGED_STATUSES = new Set([
  "avaria",
  "damaged",
  "damage",
  "rejected",
]);

const LINE_SHORTAGE_STATUSES = new Set([
  "falta",
  "missing",
  "short",
  "shortage",
]);

const LINE_CONFIRMED_STATUSES = new Set([
  "checked",
  "completed",
  "confirmed",
  "delivered",
  "dispatched",
  "packed",
  "ready",
  "ready_to_dispatch",
  "received",
  "resolved",
]);

const QUALITY_TASK_STATUSES = new Set([
  "awaiting_quality",
  "checking",
  "conference",
  "conferencia",
  "divergence",
  "divergencia",
  "inspection",
  "inspecao",
  "quality",
  "quality_check",
  "quality_hold",
  "rejected",
]);

const LINE_RESOLUTION_COPY: Record<
  LineResolution,
  { label: string; shortLabel: string; description: string; className: string }
> = {
  pending: {
    label: "A conferir",
    shortLabel: "A conferir",
    description: "Conte o físico antes de avançar.",
    className: "border-border bg-white/60 text-muted-foreground",
  },
  confirmed: {
    label: "OK físico",
    shortLabel: "OK",
    description: "Linha contada e pronta para seguir.",
    className: "border-primary/20 bg-primary/10 text-primary",
  },
  shortage: {
    label: "Falta física",
    shortLabel: "Falta",
    description: "Segure a etapa e registre exceção.",
    className: "border-amber-200 bg-amber-50 text-amber-800",
  },
  damaged: {
    label: "Avaria",
    shortLabel: "Avaria",
    description: "Separe evidência e registre avaria.",
    className: "border-destructive/20 bg-destructive/10 text-destructive",
  },
};

const QUEUE_OPERATOR_COPY: Record<
  QueueKey,
  { title: string; body: string; steps: string[] }
> = {
  receiving: {
    title: "Entrada física",
    body: "Bipe NF, conte SKU e confirme a linha antes de liberar guarda.",
    steps: ["Conferir doca e NF", "Marcar falta ou avaria", "Liberar para putaway"],
  },
  putaway: {
    title: "Guarda endereçada",
    body: "Leia o endereço real e confirme saldo apenas depois da peça estar no local.",
    steps: ["Validar rua/prateleira", "Confirmar linha guardada", "Liberar saldo WMS"],
  },
  picking: {
    title: "Separação física",
    body: "Conte no endereço, sinalize falta e não avance pedido com divergência aberta.",
    steps: ["Bipar endereço", "Confirmar quantidade", "Levar para packing"],
  },
  packing: {
    title: "Fechamento de volume",
    body: "Confira linha a linha, feche volume, lacre e libere somente sem pendência.",
    steps: ["Conferir itens", "Fechar volume", "Enviar para expedição"],
  },
  expedition: {
    title: "Saída e coleta",
    body: "Valide volumes, romaneio e coleta antes da baixa final de expedição.",
    steps: ["Separar staging", "Conferir romaneio", "Baixar saída"],
  },
};

const numberFormatter = new Intl.NumberFormat("pt-BR");
const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
});

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);

  if (!response.ok) {
    const message = await response.text().catch(() => "");
    throw new Error(message || `HTTP ${response.status}`);
  }

  return response.json() as Promise<T>;
}

function normalizeSlug(value?: string | null) {
  return (value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function normalizeStatus(value?: string | null) {
  return normalizeSlug(value).replace(/-/g, "_");
}

function toQueueKey(value?: string | null): QueueKey | undefined {
  const slug = normalizeSlug(value);
  return QUEUE_ALIASES[slug];
}

function coerceNumber(value: number | null | undefined, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function firstFiniteNumber(...values: Array<number | null | undefined>) {
  return values.find(
    (value): value is number => typeof value === "number" && Number.isFinite(value),
  );
}

function clampPercent(value?: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  const normalized = value > 0 && value <= 1 ? value * 100 : value;
  return Math.min(100, Math.max(0, Math.round(normalized)));
}

function formatNumber(value?: number | null) {
  return numberFormatter.format(coerceNumber(value));
}

function formatUnits(value?: number) {
  return typeof value === "number" ? `${formatNumber(value)} un.` : "aberto";
}

function formatDeltaUnits(value?: number) {
  if (typeof value !== "number") return "sem leitura";
  if (value === 0) return "sem diverg.";
  const prefix = value > 0 ? "+" : "-";
  return `${prefix}${formatNumber(Math.abs(value))} un.`;
}

function formatDate(value?: string | null, fallback = "Sem prazo") {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return dateFormatter.format(date);
}

function formatSla(minutes?: number | null) {
  const value = coerceNumber(minutes);
  if (!value) return "Sem SLA";
  if (value < 60) return `${value} min`;

  const hours = Math.floor(value / 60);
  const remainingMinutes = value % 60;
  return remainingMinutes ? `${hours}h ${remainingMinutes}min` : `${hours}h`;
}

function isDueSoon(value?: string | null) {
  if (!value) return false;
  const dueTime = new Date(value).getTime();
  if (Number.isNaN(dueTime)) return false;

  return dueTime - Date.now() <= 4 * 60 * 60 * 1000;
}

function isTerminalTask(task: WarehouseTask) {
  return TERMINAL_STATUSES.has(normalizeStatus(task.status));
}

function canAdvanceTask(task?: WarehouseTask) {
  if (!task) return false;
  if (typeof task.can_advance === "boolean") return task.can_advance;
  return Boolean(task.id) && !task.blocked_reason && !isTerminalTask(task);
}

function canRegisterException(task?: WarehouseTask) {
  if (!task) return false;
  if (typeof task.can_register_exception === "boolean") {
    return task.can_register_exception;
  }
  return Boolean(task.id) && !isTerminalTask(task);
}

function getTaskTitle(task: WarehouseTask) {
  return task.title || task.reference || `Tarefa ${task.id}`;
}

function getTaskDate(task: WarehouseTask) {
  return task.due_at || task.created_at || null;
}

function taskPriorityScore(task: WarehouseTask) {
  if (task.blocked_reason) return 0;
  if (task.priority === "critical") return 1;
  if (isDueSoon(task.due_at)) return 2;
  if (task.priority === "high") return 3;
  if (!isTerminalTask(task)) return 4;
  return 5;
}

function sortTasks(tasks: WarehouseTask[]) {
  return [...tasks].sort((a, b) => {
    const score = taskPriorityScore(a) - taskPriorityScore(b);
    if (score !== 0) return score;

    const dueA = getTaskDate(a);
    const dueB = getTaskDate(b);
    const timeA = dueA ? new Date(dueA).getTime() : Number.POSITIVE_INFINITY;
    const timeB = dueB ? new Date(dueB).getTime() : Number.POSITIVE_INFINITY;
    return timeA - timeB;
  });
}

function normalizeQueues(
  input: WarehouseOpsResponse["queues"],
): NormalizedQueue[] {
  const byKey = new Map<QueueKey, OpsQueue>();

  if (Array.isArray(input)) {
    input.forEach((queue) => {
      const key = toQueueKey(queue.key ?? queue.name);
      if (key) byKey.set(key, queue);
    });
  } else if (input) {
    Object.entries(input).forEach(([rawKey, queue]) => {
      const key = toQueueKey(rawKey) ?? toQueueKey(queue?.key ?? queue?.name);
      if (key && queue) byKey.set(key, queue);
    });
  }

  return QUEUE_META.map((meta) => {
    const queue = byKey.get(meta.key);
    const tasks = sortTasks(queue?.tasks ?? queue?.items ?? []);
    const activeTasks = tasks.filter((task) => !isTerminalTask(task));
    const pending = coerceNumber(queue?.pending, activeTasks.length);
    const completedToday = coerceNumber(queue?.completed_today);
    const baseTotal = pending + completedToday;
    const inferredProgress = baseTotal > 0 ? (completedToday / baseTotal) * 100 : 0;

    return {
      key: meta.key,
      label: queue?.name || meta.label,
      description: meta.description,
      icon: meta.icon,
      pending,
      inProgress: coerceNumber(queue?.in_progress),
      completedToday,
      progress: clampPercent(queue?.utilization ?? inferredProgress),
      slaMinutes: queue?.sla_minutes,
      nextAction: queue?.next_action,
      tasks,
      blockedCount: tasks.filter((task) => Boolean(task.blocked_reason)).length,
      exceptionCount: tasks.reduce(
        (sum, task) => sum + coerceNumber(task.exception_count),
        0,
      ),
      dueSoonCount: tasks.filter((task) => isDueSoon(task.due_at)).length,
      activeTask: activeTasks[0] ?? tasks[0],
    };
  });
}

function deriveMetrics(
  source: OpsMetrics | undefined,
  queues: NormalizedQueue[],
  alerts: OpsAlert[],
): DerivedMetrics {
  const allTasks = queues.flatMap((queue) => queue.tasks);
  const inferredCritical =
    alerts.filter((alert) => alert.severity === "critical").length +
    allTasks.filter(
      (task) =>
        task.priority === "critical" ||
        Boolean(task.blocked_reason) ||
        coerceNumber(task.exception_count) > 0,
    ).length;

  return {
    pendingTotal:
      source?.pending_total ?? queues.reduce((sum, queue) => sum + queue.pending, 0),
    dueSoon:
      source?.due_soon ?? allTasks.filter((task) => isDueSoon(task.due_at)).length,
    critical: source?.critical ?? inferredCritical,
    throughputToday:
      source?.throughput_today ??
      queues.reduce((sum, queue) => sum + queue.completedToday, 0),
    avgSlaMinutes: source?.avg_sla_minutes,
    agentAlerts: source?.agent_alerts ?? alerts.length,
  };
}

function priorityLabel(priority?: string | null) {
  if (priority === "critical") return "Crítica";
  if (priority === "high") return "Alta";
  if (priority === "low") return "Baixa";
  return "Normal";
}

function priorityClass(priority?: string | null) {
  if (priority === "critical") {
    return "border-destructive/20 bg-destructive/10 text-destructive";
  }
  if (priority === "high") {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }
  if (priority === "low") {
    return "border-border bg-white/60 text-muted-foreground";
  }
  return "border-primary/20 bg-primary/10 text-primary";
}

function statusLabel(status?: string | null) {
  const normalized = normalizeStatus(status);
  if (normalized === "ready_to_dispatch") return "pronto p/ expedição";
  if (normalized === "in_progress") return "em execução";
  if (normalized === "completed") return "concluída";
  if (normalized === "delivered") return "entregue";
  if (normalized === "received") return "recebida";
  if (normalized === "checking") return "em conferência";
  if (normalized === "planned") return "planejada";
  if (normalized === "ready") return "pronta";
  if (normalized === "dispatched") return "despachada";
  return status || "sem status";
}

function statusClass(status?: string | null) {
  const normalized = normalizeStatus(status);
  if (TERMINAL_STATUSES.has(normalized)) {
    return "border-primary/20 bg-primary/10 text-primary";
  }
  if (["checking", "in_progress", "dispatched"].includes(normalized)) {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }
  return "border-border bg-white/60 text-muted-foreground";
}

function alertClass(severity?: string | null) {
  if (severity === "critical") {
    return "border-destructive/20 bg-destructive/10 text-destructive";
  }
  if (severity === "attention") {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }
  return "border-primary/20 bg-primary/10 text-primary";
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Erro inesperado";
}

function getQueueAction(queue: NormalizedQueue) {
  return (
    queue.nextAction ||
    queue.activeTask?.next_action ||
    QUEUE_ACTION_FALLBACK[queue.key]
  );
}

function sumPackingQuantity(
  rows: PackingCheckRow[],
  key: "expectedQuantity" | "packedQuantity",
) {
  let total = 0;
  let hasQuantity = false;

  rows.forEach((row) => {
    const value = row[key];
    if (typeof value === "number") {
      total += value;
      hasQuantity = true;
    }
  });

  return hasQuantity ? total : undefined;
}

function packageLabel(item: WarehouseTaskItem, index: number) {
  const explicitLabel =
    item.package_label ??
    item.package_code ??
    item.tracking_code ??
    item.volume ??
    item.volume_id ??
    item.package_id ??
    item.package_number;

  return explicitLabel ? `Volume ${explicitLabel}` : `Volume ${index + 1}`;
}

function getPackingCheckRows(task: WarehouseTask): PackingCheckRow[] {
  const items = task.items ?? [];

  if (!items.length) {
    const quantity = firstFiniteNumber(task.quantity);
    const hasTaskDivergence =
      Boolean(task.blocked_reason) || coerceNumber(task.exception_count) > 0;

    return [
      {
        id: `${task.id}:volume`,
        label: "Volume principal",
        title: task.reference || getTaskTitle(task),
        code: task.sku,
        location: task.location,
        status: task.status,
        expectedQuantity: quantity,
        packedQuantity: quantity,
        delta: typeof quantity === "number" ? 0 : undefined,
        hasDivergence: hasTaskDivergence,
      },
    ];
  }

  return items.map((item, index) => {
    const expectedQuantity = firstFiniteNumber(
      item.expected_quantity,
      item.picked_quantity,
      item.quantity,
      item.packed_quantity,
      item.qty_packed,
    );
    const packedQuantity = firstFiniteNumber(
      item.packed_quantity,
      item.qty_packed,
      item.quantity,
    );
    const delta =
      typeof expectedQuantity === "number" && typeof packedQuantity === "number"
        ? packedQuantity - expectedQuantity
        : undefined;
    const normalizedStatus = normalizeStatus(item.status);
    const hasDivergence =
      (typeof delta === "number" && delta !== 0) ||
      PACKING_DIVERGENT_STATUSES.has(normalizedStatus);
    const title =
      item.name ||
      item.product_name ||
      item.description ||
      item.sku ||
      item.sku_code ||
      `Linha ${index + 1}`;

    return {
      id: item.id || `${task.id}:packing:${index}`,
      label: packageLabel(item, index),
      title,
      code: item.sku || item.sku_code,
      location: item.location,
      status: item.status || task.status,
      expectedQuantity,
      packedQuantity,
      delta,
      hasDivergence,
    };
  });
}

function getPhysicalLineRows(
  task: WarehouseTask,
  mode: "line" | "volume" = "line",
) {
  const rows = getPackingCheckRows(task);

  if (mode === "volume") return rows;
  if (!task.items?.length) {
    return rows.map((row) => ({ ...row, label: "Linha principal" }));
  }

  return rows.map((row, index) => ({
    ...row,
    label: `Linha ${index + 1}${row.label ? ` · ${row.label}` : ""}`,
  }));
}

function lineConfirmationKey(taskId: string, rowId: string) {
  return `${taskId}::${rowId}`;
}

function inferLineResolution(row: PackingCheckRow): LineResolution {
  const normalizedStatus = normalizeStatus(row.status);

  if (LINE_DAMAGED_STATUSES.has(normalizedStatus)) return "damaged";
  if (LINE_SHORTAGE_STATUSES.has(normalizedStatus)) return "shortage";
  if (row.hasDivergence) return "shortage";
  if (LINE_CONFIRMED_STATUSES.has(normalizedStatus)) return "confirmed";
  return "pending";
}

function getLineResolution(
  taskId: string,
  row: PackingCheckRow,
  confirmations: LineConfirmationMap,
): LineResolution {
  return (
    confirmations[lineConfirmationKey(taskId, row.id)] ?? inferLineResolution(row)
  );
}

function getLineResolutionCounts(
  taskId: string,
  rows: PackingCheckRow[],
  confirmations: LineConfirmationMap,
): LineResolutionCounts {
  const counts: LineResolutionCounts = {
    total: rows.length,
    pending: 0,
    confirmed: 0,
    shortage: 0,
    damaged: 0,
  };

  rows.forEach((row) => {
    counts[getLineResolution(taskId, row, confirmations)] += 1;
  });

  return counts;
}

function hasPhysicalIssue(counts: LineResolutionCounts) {
  return counts.shortage > 0 || counts.damaged > 0;
}

function buildLineExceptionNote(
  task: WarehouseTask,
  rows: PackingCheckRow[],
  confirmations: LineConfirmationMap,
) {
  const issueRows = rows
    .map((row) => ({
      row,
      resolution: getLineResolution(task.id, row, confirmations),
    }))
    .filter(
      ({ resolution }) => resolution === "shortage" || resolution === "damaged",
    );

  if (!issueRows.length) return task.blocked_reason ?? "";

  const details = issueRows
    .slice(0, 4)
    .map(({ row, resolution }) => {
      const code = row.code ? `${row.code} · ` : "";
      return `${row.label}: ${code}${row.title} (${LINE_RESOLUTION_COPY[resolution].shortLabel})`;
    })
    .join("; ");
  const extra =
    issueRows.length > 4
      ? `; +${formatNumber(issueRows.length - 4)} linha(s)`
      : "";

  return `Conferência física ${task.reference || task.id}: ${details}${extra}.`;
}

function queueSlaState(queue: NormalizedQueue) {
  if (queue.blockedCount > 0) {
    return {
      label: "SLA bloqueado",
      className: "border-destructive/20 bg-destructive/10 text-destructive",
    };
  }
  if (queue.dueSoonCount > 0) {
    return {
      label: "SLA em risco",
      className: "border-amber-200 bg-amber-50 text-amber-800",
    };
  }
  if (queue.pending > 0) {
    return {
      label: "SLA em curso",
      className: "border-primary/20 bg-primary/10 text-primary",
    };
  }
  return {
    label: "Fila limpa",
    className: "border-border bg-white/60 text-muted-foreground",
  };
}

function taskHasExceptionSignal(task: WarehouseTask) {
  return (
    Boolean(task.blocked_reason) ||
    coerceNumber(task.exception_count) > 0 ||
    task.priority === "critical"
  );
}

function taskHasQualitySignal(task: WarehouseTask) {
  const normalizedStatus = normalizeStatus(task.status);
  const hasDivergentItem = (task.items ?? []).some((item) =>
    PACKING_DIVERGENT_STATUSES.has(normalizeStatus(item.status)),
  );

  return (
    taskHasExceptionSignal(task) ||
    QUALITY_TASK_STATUSES.has(normalizedStatus) ||
    hasDivergentItem
  );
}

function isTaskInModule(
  task: WarehouseTask,
  queue: NormalizedQueue,
  module: WarehouseOpsModule,
) {
  if (!module.queueKeys.includes(queue.key)) return false;
  if (module.mode === "exceptions") return taskHasExceptionSignal(task);
  if (module.mode === "quality") return taskHasQualitySignal(task);
  return true;
}

function scopeQueueTasks(
  queue: NormalizedQueue,
  tasks: WarehouseTask[],
  preserveQueueTotals = false,
): NormalizedQueue {
  const scopedTasks = sortTasks(tasks);
  const activeTasks = scopedTasks.filter((task) => !isTerminalTask(task));
  const inProgressStatuses = new Set([
    "checking",
    "dispatched",
    "in_progress",
    "planned",
    "ready",
    "ready_to_dispatch",
  ]);

  return {
    ...queue,
    pending: preserveQueueTotals ? queue.pending : activeTasks.length,
    inProgress: preserveQueueTotals
      ? queue.inProgress
      : activeTasks.filter((task) =>
          inProgressStatuses.has(normalizeStatus(task.status)),
        ).length,
    tasks: scopedTasks,
    blockedCount: scopedTasks.filter((task) => Boolean(task.blocked_reason))
      .length,
    exceptionCount: scopedTasks.reduce(
      (sum, task) => sum + coerceNumber(task.exception_count),
      0,
    ),
    dueSoonCount: scopedTasks.filter((task) => isDueSoon(task.due_at)).length,
    activeTask: activeTasks[0] ?? scopedTasks[0],
  };
}

function getModuleQueues(
  queues: NormalizedQueue[],
  module: WarehouseOpsModule,
) {
  return queues.flatMap((queue) => {
    if (!module.queueKeys.includes(queue.key)) return [];

    const scopedTasks =
      module.mode === "queue"
        ? queue.tasks
        : queue.tasks.filter((task) => isTaskInModule(task, queue, module));

    if (module.mode !== "queue" && scopedTasks.length === 0) return [];

    return [scopeQueueTasks(queue, scopedTasks, module.mode === "queue")];
  });
}

function queueEntries(queues: NormalizedQueue[]): TaskQueueEntry[] {
  return queues.flatMap((queue) =>
    queue.tasks.map((task) => ({
      task,
      queue,
    })),
  );
}

function pickDefaultTaskEntry(entries: TaskQueueEntry[]) {
  return (
    entries.find(({ task }) => Boolean(task.blocked_reason)) ??
    entries.find(({ task }) => task.priority === "critical") ??
    entries.find(({ task }) => !isTerminalTask(task)) ??
    entries[0]
  );
}

function getModuleAlerts(alerts: OpsAlert[], module: WarehouseOpsModule) {
  return alerts.filter((alert) => {
    if (module.mode === "exceptions") return true;

    const queueKey = toQueueKey(alert.queue);
    if (!queueKey || !module.queueKeys.includes(queueKey)) return false;

    if (module.mode === "quality") {
      const sourceSlug = normalizeSlug(alert.source);
      return (
        alert.severity !== "info" ||
        sourceSlug.includes("quality") ||
        sourceSlug.includes("conferencia")
      );
    }

    return true;
  });
}

function getModuleGridClass(count: number) {
  if (count <= 1) return "lg:grid-cols-1";
  if (count === 2) return "lg:grid-cols-2";
  if (count === 3) return "lg:grid-cols-3";
  if (count === 4) return "lg:grid-cols-4";
  return "lg:grid-cols-5";
}

function getQueueCardGridClass(count: number) {
  if (count <= 1) return "lg:grid-cols-1";
  return "lg:grid-cols-2";
}

function timelineDate(event: WarehouseTaskTimelineEvent) {
  return event.occurred_at || event.created_at || event.at || null;
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
      <CardHeader className="flex flex-row items-start justify-between gap-4 pb-3">
        <div className="min-w-0">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            {title}
          </CardTitle>
          <div className="mt-3 truncate text-2xl font-semibold text-foreground">
            {value}
          </div>
        </div>
        <div className="flex size-10 shrink-0 items-center justify-center rounded-[16px] border border-border bg-white/70">
          <Icon className="size-4 text-muted-foreground" />
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <p className="text-xs leading-5 text-muted-foreground">{caption}</p>
      </CardContent>
    </Card>
  );
}

function WmsModuleSnapshot({
  module,
  queues,
  alerts,
  selectedEntry,
  onSelectTask,
}: {
  module: WarehouseOpsModule;
  queues: NormalizedQueue[];
  alerts: OpsAlert[];
  selectedEntry?: TaskQueueEntry;
  onSelectTask: (taskId: string) => void;
}) {
  const Icon = module.icon;
  const pending = queues.reduce((sum, queue) => sum + queue.pending, 0);
  const inProgress = queues.reduce((sum, queue) => sum + queue.inProgress, 0);
  const blocked = queues.reduce((sum, queue) => sum + queue.blockedCount, 0);
  const exceptions = queues.reduce((sum, queue) => sum + queue.exceptionCount, 0);
  const activeTask = selectedEntry?.task ?? queues.find((queue) => queue.activeTask)?.activeTask;
  const activeQueue =
    selectedEntry?.queue ??
    queues.find((queue) => queue.activeTask?.id === activeTask?.id);

  return (
    <Card className="min-w-0 overflow-hidden border-primary/20 bg-white/45 backdrop-blur">
      <CardHeader className="border-b border-border/60 bg-white/35">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 gap-3">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-[18px] border border-primary/20 bg-white/70">
              <Icon className="size-5 text-primary" />
            </div>
            <div className="min-w-0">
              <CardTitle className="text-lg">{module.label}</CardTitle>
              <CardDescription className="mt-1">
                {module.description}
              </CardDescription>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge
              variant="outline"
              className={
                blocked > 0
                  ? "border-destructive/20 bg-destructive/10 text-destructive"
                  : "border-primary/20 bg-primary/10 text-primary"
              }
            >
              {formatNumber(blocked)} bloqueio(s)
            </Badge>
            <Badge variant="outline" className="border-border bg-white/70 text-muted-foreground">
              {formatNumber(alerts.length)} alerta(s)
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3 p-4 md:grid-cols-[repeat(4,minmax(0,1fr))] xl:grid-cols-[repeat(4,minmax(0,1fr))_minmax(260px,1.3fr)]">
        <div className="rounded-[16px] border border-border bg-white/65 px-3 py-2">
          <div className="text-xs text-muted-foreground">Pend.</div>
          <div className="mt-1 text-lg font-semibold text-foreground">
            {formatNumber(pending)}
          </div>
        </div>
        <div className="rounded-[16px] border border-border bg-white/65 px-3 py-2">
          <div className="text-xs text-muted-foreground">Exec.</div>
          <div className="mt-1 text-lg font-semibold text-foreground">
            {formatNumber(inProgress)}
          </div>
        </div>
        <div className="rounded-[16px] border border-border bg-white/65 px-3 py-2">
          <div className="text-xs text-muted-foreground">Exceç.</div>
          <div
            className={cn(
              "mt-1 text-lg font-semibold",
              exceptions > 0 ? "text-destructive" : "text-foreground",
            )}
          >
            {formatNumber(exceptions)}
          </div>
        </div>
        <div className="rounded-[16px] border border-border bg-white/65 px-3 py-2">
          <div className="text-xs text-muted-foreground">Filas</div>
          <div className="mt-1 text-lg font-semibold text-foreground">
            {formatNumber(queues.length)}
          </div>
        </div>
        <div className="rounded-[18px] border border-border bg-white/65 px-4 py-3 md:col-span-4 xl:col-span-1">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <Route className="size-3.5 text-primary" />
            Próximo toque
          </div>
          {activeTask && activeQueue ? (
            <button
              type="button"
              className="mt-2 flex w-full min-w-0 items-center justify-between gap-3 text-left text-sm font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
              onClick={() => onSelectTask(activeTask.id)}
            >
              <span className="truncate">
                {activeQueue.label} · {getTaskTitle(activeTask)}
              </span>
              <ArrowRight className="size-4 shrink-0 text-primary" />
            </button>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">Sem tarefa aberta.</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function WmsModuleEmptyState({ module }: { module: WarehouseOpsModule }) {
  const Icon = module.icon;

  return (
    <Empty className="min-h-[260px] border border-border bg-white/35">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon className="size-5" />
        </EmptyMedia>
        <EmptyTitle className="text-base">Sem tarefas em {module.label}</EmptyTitle>
        <EmptyDescription>{module.description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

function WarehouseOpsLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-11 w-72 rounded-[18px]" />
        <Skeleton className="h-4 w-full max-w-[560px]" />
      </div>
      <Skeleton className="h-20 rounded-[24px]" />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {[1, 2, 3, 4, 5].map((item) => (
          <Skeleton key={item} className="h-32 rounded-[24px]" />
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[1, 2, 3, 4].map((item) => (
          <Skeleton key={item} className="h-48 rounded-[24px]" />
        ))}
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="grid gap-4 lg:grid-cols-2">
          {[1, 2, 3, 4, 5].map((item) => (
            <Skeleton key={item} className="h-[430px] rounded-[24px]" />
          ))}
        </div>
        <Skeleton className="h-[680px] rounded-[24px]" />
      </div>
    </div>
  );
}

function QueueSlaCard({
  queue,
  onSelectTask,
}: {
  queue: NormalizedQueue;
  onSelectTask: (taskId: string) => void;
}) {
  const Icon = queue.icon;
  const slaState = queueSlaState(queue);
  const activeTask = queue.activeTask;

  return (
    <Card
      className={cn(
        "min-w-0 overflow-hidden border-primary/20",
        queue.blockedCount > 0 && "border-destructive/25",
      )}
    >
      <CardHeader className="border-b border-border/60 bg-white/35 pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-[16px] border border-border bg-white/70">
              <Icon className="size-4 text-primary" />
            </div>
            <div className="min-w-0">
              <CardTitle className="truncate text-base">{queue.label}</CardTitle>
              <CardDescription className="mt-1">
                SLA alvo {formatSla(queue.slaMinutes)}
              </CardDescription>
            </div>
          </div>
          <Badge variant="outline" className={cn("shrink-0", slaState.className)}>
            {slaState.label}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 pt-4">
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-[16px] border border-border bg-white/55 px-3 py-2">
            <div className="text-lg font-semibold text-foreground">
              {formatNumber(queue.pending)}
            </div>
            <div className="text-xs text-muted-foreground">pend.</div>
          </div>
          <div className="rounded-[16px] border border-border bg-white/55 px-3 py-2">
            <div className="text-lg font-semibold text-foreground">
              {formatNumber(queue.blockedCount)}
            </div>
            <div className="text-xs text-muted-foreground">bloq.</div>
          </div>
          <div className="rounded-[16px] border border-border bg-white/55 px-3 py-2">
            <div className="text-lg font-semibold text-foreground">
              {formatNumber(queue.exceptionCount)}
            </div>
            <div className="text-xs text-muted-foreground">exceç.</div>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
            <span>Fluxo concluído hoje</span>
            <span>{queue.progress}%</span>
          </div>
          <Progress value={queue.progress} />
        </div>

        <div className="rounded-[18px] border border-border bg-white/55 px-4 py-3">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <Route className="size-3.5 text-primary" />
            Ação seguinte
          </div>
          <p className="mt-2 line-clamp-2 text-sm leading-6 text-foreground">
            {getQueueAction(queue)}
          </p>
        </div>

        {activeTask ? (
          <Button
            type="button"
            variant="outline"
            className="w-full justify-between"
            onClick={() => onSelectTask(activeTask.id)}
          >
            <span className="truncate">{getTaskTitle(activeTask)}</span>
            <ArrowRight data-icon="inline-end" />
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

function PhysicalFlowMap({
  queues,
  alerts,
  selectedTaskId,
  onSelectTask,
  flowKeys = FOCUS_QUEUE_KEYS,
  title = "Fluxo físico cliente-operador",
  description = "Recebimento, Putaway, Picking, Packing e Expedição.",
}: {
  queues: NormalizedQueue[];
  alerts: OpsAlert[];
  selectedTaskId?: string;
  onSelectTask: (taskId: string) => void;
  flowKeys?: QueueKey[];
  title?: string;
  description?: string;
}) {
  const flowQueues = flowKeys.flatMap((key) => {
    const queue = queues.find((item) => item.key === key);
    return queue ? [queue] : [];
  });
  const alertQueueKeys = new Set(
    alerts.flatMap((alert) => {
      const key = toQueueKey(alert.queue);
      return key ? [key] : [];
    }),
  );
  const blockedTotal = flowQueues.reduce(
    (sum, queue) => sum + queue.blockedCount,
    0,
  );
  const pendingTotal = flowQueues.reduce((sum, queue) => sum + queue.pending, 0);

  return (
    <Card className="min-w-0 overflow-hidden border-primary/20">
      <CardHeader className="border-b border-border/60 bg-white/35">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <CardTitle className="text-base">
              {title}
            </CardTitle>
            <CardDescription className="mt-1">
              {description}
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge
              variant="outline"
              className="border-border bg-white/70 text-muted-foreground"
            >
              {formatNumber(pendingTotal)} pend.
            </Badge>
            <Badge
              variant="outline"
              className={
                blockedTotal > 0
                  ? "border-destructive/20 bg-destructive/10 text-destructive"
                  : "border-primary/20 bg-primary/10 text-primary"
              }
            >
              {formatNumber(blockedTotal)} bloqueio(s)
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-4">
        <div className={cn("grid gap-3", getModuleGridClass(flowQueues.length))}>
          {flowQueues.map((queue, index) => {
            const Icon = queue.icon;
            const activeTask = queue.activeTask;
            const isSelected = activeTask?.id === selectedTaskId;
            const hasAiSignal = alertQueueKeys.has(queue.key);
            const isBlocked = queue.blockedCount > 0;

            return (
              <div key={queue.key} className="relative min-w-0">
                {index > 0 ? (
                  <ArrowRight className="absolute -left-5 top-1/2 hidden size-4 -translate-y-1/2 text-muted-foreground/50 lg:block" />
                ) : null}
                <button
                  type="button"
                  className={cn(
                    "soft-panel flex h-full min-h-[178px] w-full min-w-0 flex-col rounded-[20px] p-4 text-left outline-none transition-[border-color,box-shadow,background-color]",
                    "focus-visible:ring-2 focus-visible:ring-ring/30",
                    activeTask && "cursor-pointer hover:border-primary/30",
                    isSelected &&
                      "border-primary/35 bg-primary/5 shadow-[0_8px_24px_rgba(15,23,42,.06)]",
                    isBlocked && "border-destructive/20 bg-destructive/5",
                  )}
                  onClick={() => {
                    if (activeTask) onSelectTask(activeTask.id);
                  }}
                  disabled={!activeTask}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-[15px] border border-border bg-white/70">
                        <Icon className="size-4 text-primary" />
                      </span>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-foreground">
                          {queue.label}
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          {formatSla(queue.slaMinutes)}
                        </div>
                      </div>
                    </div>
                    {hasAiSignal ? (
                      <Badge
                        variant="outline"
                        className="shrink-0 border-primary/20 bg-primary/10 text-primary"
                      >
                        IA
                      </Badge>
                    ) : null}
                  </div>

                  <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
                    <div className="rounded-[14px] border border-border bg-white/65 px-2 py-2">
                      <div className="font-semibold text-foreground">
                        {formatNumber(queue.pending)}
                      </div>
                      <div className="text-muted-foreground">pend.</div>
                    </div>
                    <div className="rounded-[14px] border border-border bg-white/65 px-2 py-2">
                      <div className="font-semibold text-foreground">
                        {formatNumber(queue.inProgress)}
                      </div>
                      <div className="text-muted-foreground">exec.</div>
                    </div>
                    <div className="rounded-[14px] border border-border bg-white/65 px-2 py-2">
                      <div
                        className={cn(
                          "font-semibold",
                          isBlocked ? "text-destructive" : "text-foreground",
                        )}
                      >
                        {formatNumber(queue.blockedCount)}
                      </div>
                      <div className="text-muted-foreground">bloq.</div>
                    </div>
                  </div>

                  <div className="mt-4 min-w-0 flex-1">
                    <div className="text-[11px] font-medium uppercase text-muted-foreground">
                      Próximo toque
                    </div>
                    <p className="mt-1 line-clamp-2 text-sm leading-6 text-foreground">
                      {activeTask ? getTaskTitle(activeTask) : getQueueAction(queue)}
                    </p>
                  </div>
                </button>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function TaskListItem({
  task,
  queue,
  isSelected,
  isAdvancing,
  onSelect,
  onAdvance,
}: {
  task: WarehouseTask;
  queue: NormalizedQueue;
  isSelected: boolean;
  isAdvancing: boolean;
  onSelect: (id: string) => void;
  onAdvance: (id: string) => void;
}) {
  const title = getTaskTitle(task);
  const exceptions = coerceNumber(task.exception_count);
  const canAdvance = canAdvanceTask(task);

  return (
    <div
      role="button"
      tabIndex={0}
      className={cn(
        "soft-panel flex min-w-0 cursor-pointer flex-col gap-3 rounded-[20px] p-4 outline-none transition-[border-color,box-shadow,background-color]",
        "focus-visible:ring-2 focus-visible:ring-ring/30",
        isSelected && "border-primary/35 bg-primary/5 shadow-[0_8px_24px_rgba(15,23,42,.06)]",
        task.blocked_reason && "border-destructive/20 bg-destructive/5",
      )}
      onClick={() => onSelect(task.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(task.id);
        }
      }}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className={priorityClass(task.priority)}>
              {priorityLabel(task.priority)}
            </Badge>
            <Badge variant="outline" className={statusClass(task.status)}>
              {statusLabel(task.status)}
            </Badge>
            {task.blocked_reason ? (
              <Badge
                variant="outline"
                className="border-destructive/20 bg-destructive/10 text-destructive"
              >
                Bloqueada
              </Badge>
            ) : null}
            {exceptions > 0 ? (
              <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-800">
                {formatNumber(exceptions)} exceç.
              </Badge>
            ) : null}
          </div>
          <div className="mt-2 truncate text-sm font-semibold text-foreground">
            {title}
          </div>
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
            {task.notes || task.next_action || queue.description}
          </p>
        </div>
        {canAdvance ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full shrink-0 sm:w-auto"
            onClick={(event) => {
              event.stopPropagation();
              onAdvance(task.id);
            }}
            disabled={isAdvancing}
            aria-label={`Avançar ${title}`}
          >
            {isAdvancing ? (
              <RefreshCw data-icon="inline-start" className="animate-spin" />
            ) : (
              <PlayCircle data-icon="inline-start" />
            )}
            {isAdvancing ? "Avançando" : "Avançar"}
          </Button>
        ) : null}
      </div>

      <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
        <div className="flex min-w-0 items-center gap-2">
          <Box className="size-3.5 shrink-0" />
          <span className="truncate">{task.sku || "SKU a definir"}</span>
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <MapPin className="size-3.5 shrink-0" />
          <span className="truncate">{task.location || "Sem endereço"}</span>
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <ClipboardCheck className="size-3.5 shrink-0" />
          <span className="truncate">
            {typeof task.quantity === "number"
              ? `${formatNumber(task.quantity)} un.`
              : "Qtde aberta"}
          </span>
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <Clock3 className="size-3.5 shrink-0" />
          <span className="truncate">{formatDate(task.due_at)}</span>
        </div>
      </div>

      {task.blocked_reason ? (
        <div className="rounded-[16px] border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs leading-5 text-destructive">
          {task.blocked_reason}
        </div>
      ) : null}
    </div>
  );
}

function QueueCard({
  queue,
  isFocusQueue,
  selectedTaskId,
  advancingTaskId,
  onSelectTask,
  onAdvance,
}: {
  queue: NormalizedQueue;
  isFocusQueue: boolean;
  selectedTaskId?: string;
  advancingTaskId?: string;
  onSelectTask: (id: string) => void;
  onAdvance: (id: string) => void;
}) {
  const Icon = queue.icon;

  return (
    <Card
      className={cn(
        "flex min-h-[420px] min-w-0 flex-col overflow-hidden",
        isFocusQueue && "border-primary/25",
      )}
    >
      <CardHeader className="border-b border-border/60 bg-white/35 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-[16px] border border-border bg-white/70">
              <Icon className="size-4 text-primary" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="truncate text-base">{queue.label}</CardTitle>
                {isFocusQueue ? (
                  <Badge variant="outline" className="border-primary/20 bg-primary/10 text-primary">
                    módulo
                  </Badge>
                ) : null}
              </div>
              <CardDescription className="mt-1 line-clamp-2">
                {queue.description}
              </CardDescription>
            </div>
          </div>
          <Badge variant="outline" className="shrink-0">
            {formatNumber(queue.pending)} pend.
          </Badge>
        </div>

        <div className="grid gap-3 pt-2 sm:grid-cols-4">
          <div>
            <div className="text-lg font-semibold text-foreground">
              {formatNumber(queue.inProgress)}
            </div>
            <div className="text-xs text-muted-foreground">exec.</div>
          </div>
          <div>
            <div className="text-lg font-semibold text-foreground">
              {formatNumber(queue.blockedCount)}
            </div>
            <div className="text-xs text-muted-foreground">bloq.</div>
          </div>
          <div>
            <div className="text-lg font-semibold text-foreground">
              {formatNumber(queue.completedToday)}
            </div>
            <div className="text-xs text-muted-foreground">hoje</div>
          </div>
          <div>
            <div className="text-lg font-semibold text-foreground">
              {formatSla(queue.slaMinutes)}
            </div>
            <div className="text-xs text-muted-foreground">SLA</div>
          </div>
        </div>

        <div className="rounded-[18px] border border-border bg-white/55 px-4 py-3">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <Route className="size-3.5 text-primary" />
            Ação seguinte
          </div>
          <p className="mt-2 line-clamp-2 text-sm leading-6 text-foreground">
            {getQueueAction(queue)}
          </p>
        </div>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-4 p-5">
        {queue.tasks.length > 0 ? (
          <ScrollArea className="h-[390px] pr-3">
            <div className="flex flex-col gap-3">
              {queue.tasks.map((task) => (
                <TaskListItem
                  key={task.id}
                  task={task}
                  queue={queue}
                  isSelected={selectedTaskId === task.id}
                  onSelect={onSelectTask}
                  onAdvance={onAdvance}
                  isAdvancing={advancingTaskId === task.id}
                />
              ))}
            </div>
          </ScrollArea>
        ) : (
          <Empty className="min-h-[240px] border border-border bg-white/35">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <CheckCircle2 className="size-5" />
              </EmptyMedia>
              <EmptyTitle className="text-base">Fila limpa</EmptyTitle>
              <EmptyDescription>
                Nenhuma tarefa pendente para esta etapa.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </CardContent>
    </Card>
  );
}

function BlockedTasksPanel({
  entries,
  selectedTaskId,
  onSelectTask,
}: {
  entries: TaskQueueEntry[];
  selectedTaskId?: string;
  onSelectTask: (id: string) => void;
}) {
  return (
    <Card className="min-w-0">
      <CardHeader className="border-b border-border/60">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-base">Tarefas bloqueadas</CardTitle>
            <CardDescription className="mt-1">
              Itens que precisam de decisão antes do próximo avanço.
            </CardDescription>
          </div>
          <Badge
            variant="outline"
            className={cn(
              entries.length > 0
                ? "border-destructive/20 bg-destructive/10 text-destructive"
                : "border-primary/20 bg-primary/10 text-primary",
            )}
          >
            {formatNumber(entries.length)}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="pt-5">
        {entries.length > 0 ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {entries.slice(0, 6).map(({ task, queue }) => (
              <button
                key={`${queue.key}:${task.id}`}
                type="button"
                className={cn(
                  "min-w-0 rounded-[18px] border border-destructive/20 bg-destructive/5 px-4 py-3 text-left transition-[border-color,box-shadow,background-color]",
                  "hover:border-destructive/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30",
                  selectedTaskId === task.id && "bg-destructive/10 shadow-[0_8px_24px_rgba(15,23,42,.05)]",
                )}
                onClick={() => onSelectTask(task.id)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-foreground">
                      {getTaskTitle(task)}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {queue.label} · {statusLabel(task.status)}
                    </div>
                  </div>
                  <Ban className="mt-0.5 size-4 shrink-0 text-destructive" />
                </div>
                <p className="mt-3 line-clamp-2 text-xs leading-5 text-destructive">
                  {task.blocked_reason}
                </p>
              </button>
            ))}
          </div>
        ) : (
          <Empty className="min-h-[180px] border border-border bg-white/35">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <CheckCircle2 className="size-5" />
              </EmptyMedia>
              <EmptyTitle className="text-base">Sem bloqueios abertos</EmptyTitle>
              <EmptyDescription>
                As filas críticas não reportam tarefa parada agora.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </CardContent>
    </Card>
  );
}

function DetailField({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-[16px] border border-border bg-white/55 px-3 py-2">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="size-3.5 shrink-0 text-primary" />
        <span>{label}</span>
      </div>
      <div className="mt-1 truncate text-sm font-medium text-foreground">
        {value}
      </div>
    </div>
  );
}

function LineResolutionControls({
  value,
  onChange,
}: {
  value: LineResolution;
  onChange: (resolution: LineResolution) => void;
}) {
  const options: Array<{
    value: Exclude<LineResolution, "pending">;
    icon: LucideIcon;
  }> = [
    { value: "confirmed", icon: CheckCircle2 },
    { value: "shortage", icon: AlertTriangle },
    { value: "damaged", icon: Ban },
  ];

  return (
    <div className="grid grid-cols-3 gap-2">
      {options.map((option) => {
        const Icon = option.icon;
        const isActive = value === option.value;
        const copy = LINE_RESOLUTION_COPY[option.value];

        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={isActive}
            className={cn(
              "flex min-h-9 items-center justify-center gap-1.5 rounded-[14px] border px-2 text-xs font-medium transition-[background-color,border-color,color,box-shadow]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30",
              isActive
                ? `${copy.className} shadow-[0_8px_24px_rgba(15,23,42,.04)]`
                : "border-border bg-white/70 text-muted-foreground hover:bg-white",
            )}
            onClick={() => onChange(isActive ? "pending" : option.value)}
          >
            <Icon className="size-3.5 shrink-0" />
            <span className="truncate">{copy.shortLabel}</span>
          </button>
        );
      })}
    </div>
  );
}

function ExecutionLineRowCard({
  taskId,
  row,
  resolution,
  onResolutionChange,
}: {
  taskId: string;
  row: PackingCheckRow;
  resolution: LineResolution;
  onResolutionChange: (rowId: string, resolution: LineResolution) => void;
}) {
  const copy = LINE_RESOLUTION_COPY[resolution];
  const hasIssue = resolution === "shortage" || resolution === "damaged";

  return (
    <div
      className={cn(
        "rounded-[16px] border border-border bg-white/65 px-3 py-3",
        resolution === "confirmed" && "border-primary/20 bg-primary/5",
        hasIssue && "border-amber-200 bg-amber-50/70",
        resolution === "damaged" && "border-destructive/20 bg-destructive/10",
      )}
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium uppercase text-muted-foreground">
                {row.label}
              </span>
              <Badge variant="outline" className={copy.className}>
                {copy.label}
              </Badge>
              {row.status ? (
                <Badge variant="outline" className={statusClass(row.status)}>
                  {statusLabel(row.status)}
                </Badge>
              ) : null}
            </div>
            <div className="mt-1 truncate text-sm font-semibold text-foreground">
              {row.title}
            </div>
            <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
              {row.code ? <span>{row.code}</span> : null}
              {row.location ? <span>{row.location}</span> : null}
              <span>{copy.description}</span>
            </div>
          </div>

          <div className="w-full lg:w-[280px]">
            <LineResolutionControls
              value={resolution}
              onChange={(nextResolution) =>
                onResolutionChange(row.id, nextResolution)
              }
            />
          </div>
        </div>

        <div className="grid gap-2 text-xs sm:grid-cols-3">
          <div className="rounded-[14px] border border-border bg-white/70 px-3 py-2">
            <div className="text-muted-foreground">Esperado</div>
            <div className="mt-1 font-medium text-foreground">
              {formatUnits(row.expectedQuantity)}
            </div>
          </div>
          <div className="rounded-[14px] border border-border bg-white/70 px-3 py-2">
            <div className="text-muted-foreground">Físico lido</div>
            <div className="mt-1 font-medium text-foreground">
              {formatUnits(row.packedQuantity)}
            </div>
          </div>
          <div className="rounded-[14px] border border-border bg-white/70 px-3 py-2">
            <div className="text-muted-foreground">Diferença</div>
            <div
              className={cn(
                "mt-1 font-medium",
                hasIssue || row.hasDivergence ? "text-destructive" : "text-foreground",
              )}
            >
              {formatDeltaUnits(row.delta)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function OperatorMicrocopy({
  queue,
  counts,
}: {
  queue: NormalizedQueue;
  counts: LineResolutionCounts;
}) {
  const copy = QUEUE_OPERATOR_COPY[queue.key];

  return (
    <div className="rounded-[18px] border border-border bg-white/55 px-4 py-3">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <ClipboardCheck className="size-3.5 text-primary" />
        {copy.title}
      </div>
      <p className="mt-2 text-sm leading-6 text-foreground">{copy.body}</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        {copy.steps.map((step, index) => (
          <div
            key={step}
            className="rounded-[14px] border border-border bg-white/65 px-3 py-2 text-xs leading-5 text-muted-foreground"
          >
            <span className="font-medium text-foreground">{index + 1}. </span>
            {step}
          </div>
        ))}
      </div>
      <div className="mt-3 rounded-[14px] border border-primary/15 bg-primary/5 px-3 py-2 text-xs leading-5 text-muted-foreground">
        Confirmação local: {formatNumber(counts.confirmed)} de{" "}
        {formatNumber(counts.total)} linha(s) OK; falta/avaria segura o avanço
        até registrar exceção.
      </div>
    </div>
  );
}

function PhysicalLineChecklist({
  task,
  lineConfirmations,
  registeringExceptionId,
  onLineConfirmationChange,
  onOpenException,
}: {
  task: WarehouseTask;
  lineConfirmations: LineConfirmationMap;
  registeringExceptionId?: string;
  onLineConfirmationChange: (
    taskId: string,
    rowId: string,
    resolution: LineResolution,
  ) => void;
  onOpenException: (task: WarehouseTask, suggestedNote?: string) => void;
}) {
  const rows = getPhysicalLineRows(task);
  const counts = getLineResolutionCounts(task.id, rows, lineConfirmations);
  const hasIssue = hasPhysicalIssue(counts);
  const canRegister = canRegisterException(task);
  const isRegistering = registeringExceptionId === task.id;
  const issueNote = buildLineExceptionNote(task, rows, lineConfirmations);

  return (
    <div className="rounded-[22px] border border-border bg-white/45 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-[16px] border border-border bg-white/70">
            <ListChecks className="size-4 text-primary" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-foreground">
              Conferência física por linha
            </div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Marque OK, falta ou avaria enquanto conta no endereço.
            </p>
          </div>
        </div>
        {hasIssue ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="w-full shrink-0 sm:w-auto"
            onClick={() => onOpenException(task, issueNote)}
            disabled={!canRegister || isRegistering}
          >
            {isRegistering ? (
              <RefreshCw data-icon="inline-start" className="animate-spin" />
            ) : (
              <MessageSquareWarning data-icon="inline-start" />
            )}
            Enviar evidência
          </Button>
        ) : null}
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-4">
        <div className="rounded-[16px] border border-border bg-white/65 px-3 py-2">
          <div className="text-xs text-muted-foreground">Linhas</div>
          <div className="mt-1 text-sm font-semibold text-foreground">
            {formatNumber(counts.total)}
          </div>
        </div>
        <div className="rounded-[16px] border border-border bg-white/65 px-3 py-2">
          <div className="text-xs text-muted-foreground">OK físico</div>
          <div className="mt-1 text-sm font-semibold text-primary">
            {formatNumber(counts.confirmed)}
          </div>
        </div>
        <div className="rounded-[16px] border border-border bg-white/65 px-3 py-2">
          <div className="text-xs text-muted-foreground">Falta</div>
          <div className="mt-1 text-sm font-semibold text-amber-800">
            {formatNumber(counts.shortage)}
          </div>
        </div>
        <div className="rounded-[16px] border border-border bg-white/65 px-3 py-2">
          <div className="text-xs text-muted-foreground">Avaria</div>
          <div className="mt-1 text-sm font-semibold text-destructive">
            {formatNumber(counts.damaged)}
          </div>
        </div>
      </div>

      {hasIssue ? (
        <Alert className="mt-4 border-amber-200 bg-amber-50 text-amber-900">
          <AlertTriangle className="size-4" />
          <AlertTitle>Segurar etapa antes de avançar</AlertTitle>
          <AlertDescription>
            Há falta ou avaria marcada na conferência local. Registre a exceção
            para anexar evidência operacional à IA.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="mt-4 flex flex-col gap-2">
        {rows.slice(0, 8).map((row) => (
          <ExecutionLineRowCard
            key={row.id}
            taskId={task.id}
            row={row}
            resolution={getLineResolution(task.id, row, lineConfirmations)}
            onResolutionChange={(rowId, resolution) =>
              onLineConfirmationChange(task.id, rowId, resolution)
            }
          />
        ))}

        {rows.length > 8 ? (
          <div className="rounded-[16px] border border-border bg-white/55 px-3 py-2 text-xs text-muted-foreground">
            + {formatNumber(rows.length - 8)} linha(s) no payload.
          </div>
        ) : null}
      </div>
    </div>
  );
}

function PackingDetailSection({
  task,
  lineConfirmations,
  registeringExceptionId,
  onLineConfirmationChange,
  onOpenException,
}: {
  task: WarehouseTask;
  lineConfirmations: LineConfirmationMap;
  registeringExceptionId?: string;
  onLineConfirmationChange: (
    taskId: string,
    rowId: string,
    resolution: LineResolution,
  ) => void;
  onOpenException: (task: WarehouseTask, suggestedNote?: string) => void;
}) {
  const rows = getPhysicalLineRows(task, "volume");
  const counts = getLineResolutionCounts(task.id, rows, lineConfirmations);
  const totalExpected = sumPackingQuantity(rows, "expectedQuantity");
  const totalPacked = sumPackingQuantity(rows, "packedQuantity");
  const exceptions = coerceNumber(task.exception_count);
  const physicalIssues = counts.shortage + counts.damaged;
  const hasDivergence =
    physicalIssues > 0 || exceptions > 0 || Boolean(task.blocked_reason);
  const canRegister = canRegisterException(task);
  const isRegistering = registeringExceptionId === task.id;
  const isReadyToSeal =
    counts.total > 0 &&
    counts.pending === 0 &&
    !hasPhysicalIssue(counts) &&
    !task.blocked_reason;
  const issueNote = buildLineExceptionNote(task, rows, lineConfirmations);
  const divergenceLabel = hasDivergence
    ? physicalIssues > 0
      ? `${formatNumber(physicalIssues)} linha(s)`
      : exceptions > 0
        ? `${formatNumber(exceptions)} exceç.`
        : "bloqueio"
    : "sem divergência";

  return (
    <div className="rounded-[22px] border border-primary/20 bg-primary/5 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-[16px] border border-primary/20 bg-white/70">
            <PackageCheck className="size-4 text-primary" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-foreground">
              Fechamento físico do packing
            </div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Confira linha, volume, lacre e divergência antes de liberar saída.
            </p>
          </div>
        </div>
        <Button
          type="button"
          size="sm"
          variant={hasDivergence ? "default" : "outline"}
          className="w-full shrink-0 sm:w-auto"
          onClick={() => onOpenException(task, issueNote)}
          disabled={!canRegister || isRegistering}
        >
          {isRegistering ? (
            <RefreshCw data-icon="inline-start" className="animate-spin" />
          ) : (
            <MessageSquareWarning data-icon="inline-start" />
          )}
          {isRegistering ? "Registrando" : "Registrar falta/avaria"}
        </Button>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-4">
        <div className="rounded-[16px] border border-border bg-white/65 px-3 py-2">
          <div className="text-xs text-muted-foreground">Volumes</div>
          <div className="mt-1 text-sm font-semibold text-foreground">
            {formatNumber(rows.length)}
          </div>
        </div>
        <div className="rounded-[16px] border border-border bg-white/65 px-3 py-2">
          <div className="text-xs text-muted-foreground">OK físico</div>
          <div className="mt-1 text-sm font-semibold text-foreground">
            {formatNumber(counts.confirmed)} / {formatNumber(counts.total)}
          </div>
        </div>
        <div className="rounded-[16px] border border-border bg-white/65 px-3 py-2">
          <div className="text-xs text-muted-foreground">Status</div>
          <Badge variant="outline" className={cn("mt-1", statusClass(task.status))}>
            {statusLabel(task.status)}
          </Badge>
        </div>
        <div className="rounded-[16px] border border-border bg-white/65 px-3 py-2">
          <div className="text-xs text-muted-foreground">Divergência</div>
          <div
            className={cn(
              "mt-1 text-sm font-semibold",
              hasDivergence ? "text-destructive" : "text-foreground",
            )}
          >
            {divergenceLabel}
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        <div className="rounded-[16px] border border-border bg-white/60 px-3 py-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <PackageOpen className="size-3.5 text-primary" />
            Físico lido
          </div>
          <div className="mt-1 text-sm font-medium text-foreground">
            {formatUnits(totalPacked)} / {formatUnits(totalExpected)}
          </div>
        </div>
        <div className="rounded-[16px] border border-border bg-white/60 px-3 py-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <ShieldAlert className="size-3.5 text-primary" />
            Lacre
          </div>
          <div className="mt-1 text-sm font-medium text-foreground">
            {isReadyToSeal ? "Pode lacrar" : "Manter volume aberto"}
          </div>
        </div>
        <div className="rounded-[16px] border border-border bg-white/60 px-3 py-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Truck className="size-3.5 text-primary" />
            Expedição
          </div>
          <div className="mt-1 text-sm font-medium text-foreground">
            {isReadyToSeal ? "Pronto para staging" : "Aguardando conferência"}
          </div>
        </div>
      </div>

      {hasDivergence ? (
        <Alert className="mt-4 border-amber-200 bg-amber-50 text-amber-900">
          <AlertTriangle className="size-4" />
          <AlertTitle>Divergência em packing</AlertTitle>
          <AlertDescription>
            {task.blocked_reason ||
              (exceptions > 0
                ? `${formatNumber(exceptions)} exceção(ões) vinculada(s) à tarefa.`
                : "Há diferença entre quantidade esperada e quantidade embalada.")}
          </AlertDescription>
        </Alert>
      ) : (
        <Alert className="mt-4 border-primary/20 bg-primary/10">
          <CheckCircle2 className="size-4" />
          <AlertTitle>Volume sem exceção marcada</AlertTitle>
          <AlertDescription>
            Quando todas as linhas estiverem OK, lacre o volume e siga para
            expedição.
          </AlertDescription>
        </Alert>
      )}

      <div className="mt-4 flex flex-col gap-2">
        {rows.slice(0, 8).map((row) => (
          <ExecutionLineRowCard
            key={row.id}
            taskId={task.id}
            row={row}
            resolution={getLineResolution(task.id, row, lineConfirmations)}
            onResolutionChange={(rowId, resolution) =>
              onLineConfirmationChange(task.id, rowId, resolution)
            }
          />
        ))}

        {rows.length > 8 ? (
          <div className="rounded-[16px] border border-border bg-white/55 px-3 py-2 text-xs text-muted-foreground">
            + {formatNumber(rows.length - 8)} volume(s) no payload.
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ExpeditionReadinessSection({
  task,
  lineConfirmations,
  registeringExceptionId,
  onLineConfirmationChange,
  onOpenException,
}: {
  task: WarehouseTask;
  lineConfirmations: LineConfirmationMap;
  registeringExceptionId?: string;
  onLineConfirmationChange: (
    taskId: string,
    rowId: string,
    resolution: LineResolution,
  ) => void;
  onOpenException: (task: WarehouseTask, suggestedNote?: string) => void;
}) {
  const rows = getPhysicalLineRows(task, "volume");
  const counts = getLineResolutionCounts(task.id, rows, lineConfirmations);
  const exceptions = coerceNumber(task.exception_count);
  const hasIssue =
    hasPhysicalIssue(counts) || exceptions > 0 || Boolean(task.blocked_reason);
  const isReadyToDispatch =
    counts.total > 0 && counts.pending === 0 && !hasIssue;
  const canRegister = canRegisterException(task);
  const isRegistering = registeringExceptionId === task.id;
  const issueNote = buildLineExceptionNote(task, rows, lineConfirmations);
  const steps = [
    {
      label: "Volumes no staging",
      value: `${formatNumber(counts.confirmed)} / ${formatNumber(counts.total)}`,
      done: counts.total > 0 && counts.pending === 0,
    },
    {
      label: "Romaneio sem bloqueio",
      value: task.blocked_reason ? "bloqueado" : "liberado",
      done: !task.blocked_reason && exceptions === 0,
    },
    {
      label: "Coleta",
      value: isReadyToDispatch ? "pode baixar saída" : "segurar doca",
      done: isReadyToDispatch,
    },
  ];

  return (
    <div className="rounded-[22px] border border-border bg-white/45 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-[16px] border border-border bg-white/70">
            <Truck className="size-4 text-primary" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-foreground">
              Expedição física
            </div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Valide volume, staging, romaneio e coleta antes da baixa.
            </p>
          </div>
        </div>
        <Badge
          variant="outline"
          className={
            isReadyToDispatch
              ? "border-primary/20 bg-primary/10 text-primary"
              : "border-amber-200 bg-amber-50 text-amber-800"
          }
        >
          {isReadyToDispatch ? "pronta para saída" : "segurar na doca"}
        </Badge>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        {steps.map((step) => (
          <div
            key={step.label}
            className={cn(
              "rounded-[16px] border px-3 py-2",
              step.done
                ? "border-primary/20 bg-primary/5"
                : "border-border bg-white/65",
            )}
          >
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {step.done ? (
                <CheckCircle2 className="size-3.5 text-primary" />
              ) : (
                <Clock3 className="size-3.5 text-amber-800" />
              )}
              {step.label}
            </div>
            <div className="mt-1 text-sm font-medium text-foreground">
              {step.value}
            </div>
          </div>
        ))}
      </div>

      {hasIssue ? (
        <Alert className="mt-4 border-amber-200 bg-amber-50 text-amber-900">
          <AlertTriangle className="size-4" />
          <AlertTitle>Saída ainda não liberada</AlertTitle>
          <AlertDescription>
            Resolva falta, avaria, exceção ou bloqueio antes de baixar a coleta.
          </AlertDescription>
        </Alert>
      ) : (
        <Alert className="mt-4 border-primary/20 bg-primary/10">
          <CheckCircle2 className="size-4" />
          <AlertTitle>Checklist de expedição limpo</AlertTitle>
          <AlertDescription>
            Volumes conferidos e sem sinal de bloqueio. Confirme coleta no WMS.
          </AlertDescription>
        </Alert>
      )}

      {hasPhysicalIssue(counts) ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="mt-4 w-full"
          onClick={() => onOpenException(task, issueNote)}
          disabled={!canRegister || isRegistering}
        >
          {isRegistering ? (
            <RefreshCw data-icon="inline-start" className="animate-spin" />
          ) : (
            <MessageSquareWarning data-icon="inline-start" />
          )}
          Enviar evidência de saída
        </Button>
      ) : null}

      <div className="mt-4 flex flex-col gap-2">
        {rows.slice(0, 8).map((row) => (
          <ExecutionLineRowCard
            key={row.id}
            taskId={task.id}
            row={row}
            resolution={getLineResolution(task.id, row, lineConfirmations)}
            onResolutionChange={(rowId, resolution) =>
              onLineConfirmationChange(task.id, rowId, resolution)
            }
          />
        ))}
      </div>
    </div>
  );
}

function TaskAiEvidencePanel({
  task,
  queue,
  alerts,
}: {
  task: WarehouseTask;
  queue: NormalizedQueue;
  alerts: OpsAlert[];
}) {
  const relatedAlerts = alerts.filter(
    (alert) => alert.task_id === task.id || toQueueKey(alert.queue) === queue.key,
  );
  const latestTimelineEvent = [...(task.timeline ?? [])].sort((a, b) => {
    const timeA = timelineDate(a) ? new Date(timelineDate(a) ?? "").getTime() : 0;
    const timeB = timelineDate(b) ? new Date(timelineDate(b) ?? "").getTime() : 0;
    return timeB - timeA;
  })[0];
  const exceptions = coerceNumber(task.exception_count);
  const primaryAlert = relatedAlerts[0];
  const evidenceItems = [
    {
      label: "Sinal IA",
      value: primaryAlert?.title ?? "Sem alerta direto",
      caption:
        primaryAlert?.action ||
        primaryAlert?.message ||
        "A fila segue monitorada por prioridade, SLA e exceções.",
      className: primaryAlert
        ? alertClass(primaryAlert.severity)
        : "border-border bg-white/65 text-muted-foreground",
    },
    {
      label: "SLA físico",
      value: isDueSoon(task.due_at) ? "risco próximo" : "sem risco 4h",
      caption: `Prazo: ${formatDate(task.due_at)}`,
      className: isDueSoon(task.due_at)
        ? "border-amber-200 bg-amber-50 text-amber-800"
        : "border-primary/20 bg-primary/10 text-primary",
    },
    {
      label: "Memória operacional",
      value:
        exceptions > 0
          ? `${formatNumber(exceptions)} exceç.`
          : latestTimelineEvent?.title || "sem evento recente",
      caption:
        latestTimelineEvent?.description ||
        "Use a confirmação local para alimentar uma exceção quando houver divergência.",
      className:
        exceptions > 0 || task.blocked_reason
          ? "border-destructive/20 bg-destructive/10 text-destructive"
          : "border-border bg-white/65 text-muted-foreground",
    },
  ];

  return (
    <div className="rounded-[18px] border border-primary/20 bg-primary/5 px-4 py-3">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <Sparkles className="size-3.5 text-primary" />
        Evidências da IA
      </div>
      <div className="mt-3 grid gap-2">
        {evidenceItems.map((item) => (
          <div
            key={item.label}
            className={cn("rounded-[14px] border px-3 py-2", item.className)}
          >
            <div className="text-xs font-medium">{item.label}</div>
            <div className="mt-1 text-sm font-semibold">{item.value}</div>
            <p className="mt-1 line-clamp-2 text-xs leading-5 opacity-80">
              {item.caption}
            </p>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs leading-5 text-muted-foreground">
        A IA prioriza e recomenda; a confirmação física continua sendo a fonte
        de verdade da etapa.
      </p>
    </div>
  );
}

function CustomerVisibilityPanel({
  task,
  queue,
  counts,
}: {
  task: WarehouseTask;
  queue: NormalizedQueue;
  counts: LineResolutionCounts;
}) {
  const exceptions = coerceNumber(task.exception_count);
  const hasIssue =
    hasPhysicalIssue(counts) || Boolean(task.blocked_reason) || exceptions > 0;
  const visibleState = hasIssue
    ? "Aguardando resolução"
    : isTerminalTask(task)
      ? "Etapa concluída"
      : "Em operação";
  const evidenceCopy =
    counts.total > 0
      ? `${formatNumber(counts.confirmed)} de ${formatNumber(
          counts.total,
        )} linha(s) OK no físico`
      : "Sem leitura linha a linha";

  return (
    <div className="rounded-[18px] border border-border bg-white/55 px-4 py-3">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <UserRound className="size-3.5 text-primary" />
        Visão cliente-operador
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <div className="rounded-[14px] border border-border bg-white/65 px-3 py-2">
          <div className="text-xs text-muted-foreground">Portal cliente</div>
          <div className="mt-1 text-sm font-semibold text-foreground">
            {visibleState}
          </div>
        </div>
        <div className="rounded-[14px] border border-border bg-white/65 px-3 py-2">
          <div className="text-xs text-muted-foreground">Fila física</div>
          <div className="mt-1 text-sm font-semibold text-foreground">
            {queue.label}
          </div>
        </div>
        <div className="rounded-[14px] border border-border bg-white/65 px-3 py-2">
          <div className="text-xs text-muted-foreground">Evidência</div>
          <div
            className={cn(
              "mt-1 text-sm font-semibold",
              hasIssue ? "text-destructive" : "text-foreground",
            )}
          >
            {evidenceCopy}
          </div>
        </div>
      </div>
      <p className="mt-3 text-xs leading-5 text-muted-foreground">
        A IA pode destacar risco, mas o avanço para o cliente depende da
        conferência física e da exceção registrada quando houver falta ou avaria.
      </p>
    </div>
  );
}

function TaskItemsList({ items }: { items: WarehouseTaskItem[] }) {
  if (!items.length) {
    return (
      <div className="rounded-[18px] border border-border bg-white/45 px-4 py-3 text-sm text-muted-foreground">
        Sem itens detalhados no payload da tarefa.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {items.slice(0, 8).map((item, index) => {
        const title =
          item.name ||
          item.product_name ||
          item.description ||
          item.sku ||
          item.sku_code ||
          `Item ${index + 1}`;
        const quantity =
          item.quantity ??
          item.expected_quantity ??
          item.picked_quantity ??
          item.packed_quantity ??
          item.qty_packed;

        return (
          <div
            key={item.id || `${title}:${index}`}
            className="rounded-[16px] border border-border bg-white/55 px-3 py-2"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-foreground">
                  {title}
                </div>
                <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                  {item.sku || item.sku_code ? (
                    <span>{item.sku || item.sku_code}</span>
                  ) : null}
                  {item.location ? <span>{item.location}</span> : null}
                  {item.status ? <span>{item.status}</span> : null}
                </div>
              </div>
              <Badge variant="outline" className="shrink-0">
                {typeof quantity === "number" ? `${formatNumber(quantity)} un.` : "qtde aberta"}
              </Badge>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TaskTimeline({ timeline }: { timeline: WarehouseTaskTimelineEvent[] }) {
  if (!timeline.length) {
    return (
      <div className="rounded-[18px] border border-border bg-white/45 px-4 py-3 text-sm text-muted-foreground">
        Sem timeline operacional para esta tarefa.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {timeline.slice(0, 8).map((event, index) => (
        <div key={event.id || `${event.title}:${index}`} className="flex gap-3">
          <div className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-full border border-primary/20 bg-primary/10">
            <Activity className="size-3.5 text-primary" />
          </div>
          <div className="min-w-0 flex-1 rounded-[16px] border border-border bg-white/55 px-3 py-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="truncate text-sm font-medium text-foreground">
                {event.title || event.status || "Evento operacional"}
              </div>
              <span className="text-xs text-muted-foreground">
                {formatDate(timelineDate(event), "Sem data")}
              </span>
            </div>
            {event.description ? (
              <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                {event.description}
              </p>
            ) : null}
            {event.actor ? (
              <div className="mt-2 text-xs text-muted-foreground">
                Responsável: {event.actor}
              </div>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function TaskDetailPanel({
  entry,
  alerts,
  lineConfirmations,
  advancingTaskId,
  registeringExceptionId,
  onLineConfirmationChange,
  onAdvance,
  onOpenException,
}: {
  entry?: TaskQueueEntry;
  alerts: OpsAlert[];
  lineConfirmations: LineConfirmationMap;
  advancingTaskId?: string;
  registeringExceptionId?: string;
  onLineConfirmationChange: (
    taskId: string,
    rowId: string,
    resolution: LineResolution,
  ) => void;
  onAdvance: (id: string) => void;
  onOpenException: (task: WarehouseTask, suggestedNote?: string) => void;
}) {
  if (!entry) {
    return (
      <Card className="min-w-0 xl:sticky xl:top-6">
        <CardContent className="pt-6">
          <Empty className="min-h-[420px] border border-border bg-white/35">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ListChecks className="size-5" />
              </EmptyMedia>
              <EmptyTitle className="text-base">Nenhuma tarefa selecionada</EmptyTitle>
              <EmptyDescription>
                As filas carregadas não têm tarefas para detalhar.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </CardContent>
      </Card>
    );
  }

  const { task, queue } = entry;
  const title = getTaskTitle(task);
  const exceptions = coerceNumber(task.exception_count);
  const canAdvance = canAdvanceTask(task);
  const canRegister = canRegisterException(task);
  const isPacking = queue.key === "packing";
  const isExpedition = queue.key === "expedition";
  const executionRows = getPhysicalLineRows(
    task,
    isPacking || isExpedition ? "volume" : "line",
  );
  const lineCounts = getLineResolutionCounts(
    task.id,
    executionRows,
    lineConfirmations,
  );
  const showGenericExceptionAction = canRegister && !isPacking && !isExpedition;
  const hasVisibleAction =
    canAdvance ||
    showGenericExceptionAction ||
    ((isPacking || isExpedition) && canRegister);

  return (
    <Card className="min-w-0 xl:sticky xl:top-6">
      <CardHeader className="border-b border-border/60">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="border-primary/20 bg-primary/10 text-primary">
                {queue.label}
              </Badge>
              <Badge variant="outline" className={priorityClass(task.priority)}>
                {priorityLabel(task.priority)}
              </Badge>
              <Badge variant="outline" className={statusClass(task.status)}>
                {statusLabel(task.status)}
              </Badge>
            </div>
            <CardTitle className="mt-3 line-clamp-2 text-lg">{title}</CardTitle>
            <CardDescription className="mt-2 line-clamp-2">
              {task.notes || queue.description}
            </CardDescription>
          </div>
          <div className="flex size-11 shrink-0 items-center justify-center rounded-[18px] border border-border bg-white/70">
            <queue.icon className="size-5 text-primary" />
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-5 pt-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <DetailField icon={Hash} label="Referência" value={task.reference || task.id} />
          <DetailField
            icon={Box}
            label="SKU / item"
            value={task.sku || "SKU a definir"}
          />
          <DetailField
            icon={ClipboardCheck}
            label="Quantidade"
            value={
              typeof task.quantity === "number"
                ? `${formatNumber(task.quantity)} un.`
                : "Qtde aberta"
            }
          />
          <DetailField
            icon={MapPin}
            label="Endereço"
            value={task.location || "Sem endereço"}
          />
          <DetailField
            icon={UserRound}
            label="Responsável"
            value={task.assignee || "Sem operador"}
          />
          <DetailField
            icon={Clock3}
            label="Prazo"
            value={formatDate(task.due_at)}
          />
        </div>

        {task.customer || task.customer_request_id || exceptions > 0 ? (
          <div className="grid gap-3 sm:grid-cols-3">
            {task.customer ? (
              <DetailField icon={WarehouseIcon} label="Cliente" value={task.customer} />
            ) : null}
            {task.customer_request_id ? (
              <DetailField
                icon={FileWarning}
                label="Solicitação"
                value={task.customer_request_id}
              />
            ) : null}
            {exceptions > 0 ? (
              <DetailField
                icon={MessageSquareWarning}
                label="Exceções"
                value={formatNumber(exceptions)}
              />
            ) : null}
          </div>
        ) : null}

        {task.blocked_reason ? (
          <Alert className="border-destructive/20 bg-destructive/10 text-destructive">
            <Ban className="size-4" />
            <AlertTitle>Tarefa bloqueada</AlertTitle>
            <AlertDescription>{task.blocked_reason}</AlertDescription>
          </Alert>
        ) : null}

        <TaskAiEvidencePanel task={task} queue={queue} alerts={alerts} />

        <CustomerVisibilityPanel task={task} queue={queue} counts={lineCounts} />

        <OperatorMicrocopy queue={queue} counts={lineCounts} />

        {isPacking ? (
          <PackingDetailSection
            task={task}
            lineConfirmations={lineConfirmations}
            registeringExceptionId={registeringExceptionId}
            onLineConfirmationChange={onLineConfirmationChange}
            onOpenException={onOpenException}
          />
        ) : isExpedition ? (
          <ExpeditionReadinessSection
            task={task}
            lineConfirmations={lineConfirmations}
            registeringExceptionId={registeringExceptionId}
            onLineConfirmationChange={onLineConfirmationChange}
            onOpenException={onOpenException}
          />
        ) : (
          <PhysicalLineChecklist
            task={task}
            lineConfirmations={lineConfirmations}
            registeringExceptionId={registeringExceptionId}
            onLineConfirmationChange={onLineConfirmationChange}
            onOpenException={onOpenException}
          />
        )}

        <div className="rounded-[18px] border border-border bg-white/55 px-4 py-3">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <Route className="size-3.5 text-primary" />
            Próxima ação da fila
          </div>
          <p className="mt-2 text-sm leading-6 text-foreground">
            {task.next_action || getQueueAction(queue)}
          </p>
        </div>

        {canAdvance || showGenericExceptionAction || !hasVisibleAction ? (
          <div className="flex flex-col gap-3 sm:flex-row">
            {canAdvance ? (
              <Button
                type="button"
                className="w-full sm:flex-1"
                onClick={() => onAdvance(task.id)}
                disabled={advancingTaskId === task.id}
              >
                {advancingTaskId === task.id ? (
                  <RefreshCw data-icon="inline-start" className="animate-spin" />
                ) : (
                  <PlayCircle data-icon="inline-start" />
                )}
                {advancingTaskId === task.id ? "Avançando" : "Avançar etapa"}
              </Button>
            ) : null}
            {showGenericExceptionAction ? (
              <Button
                type="button"
                variant="outline"
                className="w-full sm:flex-1"
                onClick={() => onOpenException(task)}
                disabled={registeringExceptionId === task.id}
              >
                {registeringExceptionId === task.id ? (
                  <RefreshCw data-icon="inline-start" className="animate-spin" />
                ) : (
                  <MessageSquareWarning data-icon="inline-start" />
                )}
                Registrar exceção
              </Button>
            ) : null}
            {!hasVisibleAction ? (
              <div className="w-full rounded-[18px] border border-border bg-white/55 px-4 py-3 text-sm text-muted-foreground">
                Nenhuma ação disponível para o status atual.
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Activity className="size-4 text-primary" />
            Timeline
          </div>
          <TaskTimeline timeline={task.timeline ?? []} />
        </div>
      </CardContent>
    </Card>
  );
}

function AgentAlertsPanel({
  alerts,
  summary,
  updatedAt,
}: {
  alerts: OpsAlert[];
  summary?: string | null;
  updatedAt?: string | null;
}) {
  return (
    <Card className="min-w-0">
      <CardHeader className="border-b border-border/60">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-[16px] border border-border bg-white/70">
              <ShieldAlert className="size-4 text-primary" />
            </div>
            <div className="min-w-0">
              <CardTitle className="text-base">Alertas do agente</CardTitle>
              <CardDescription className="mt-1">
                Riscos, bloqueios e recomendações operacionais.
              </CardDescription>
            </div>
          </div>
          <Badge variant="outline" className="shrink-0">
            {formatNumber(alerts.length)}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 pt-5">
        {summary ? (
          <Alert className="border-primary/20 bg-primary/10">
            <Sparkles className="size-4" />
            <AlertTitle>Leitura do agente</AlertTitle>
            <AlertDescription>{summary}</AlertDescription>
          </Alert>
        ) : null}

        {alerts.length > 0 ? (
          <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
            {alerts.slice(0, 6).map((alert) => (
              <Alert key={alert.id} className={alertClass(alert.severity)}>
                <AlertTriangle className="size-4" />
                <AlertTitle className="leading-5">{alert.title}</AlertTitle>
                <AlertDescription>
                  <div className="flex flex-col gap-3">
                    {alert.message ? <p>{alert.message}</p> : null}
                    <div className="flex flex-wrap gap-2 text-xs">
                      {alert.queue ? (
                        <Badge variant="outline">{alert.queue}</Badge>
                      ) : null}
                      {alert.source ? (
                        <Badge variant="outline">{alert.source}</Badge>
                      ) : null}
                      <span className="text-muted-foreground">
                        {formatDate(alert.created_at, "Sem data")}
                      </span>
                    </div>
                    {alert.action ? (
                      <div className="rounded-[14px] border border-border bg-white/55 px-3 py-2 text-xs leading-5 text-foreground">
                        {alert.action}
                      </div>
                    ) : null}
                  </div>
                </AlertDescription>
              </Alert>
            ))}
          </div>
        ) : (
          <Empty className="min-h-[220px] border border-border bg-white/35">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <CheckCircle2 className="size-5" />
              </EmptyMedia>
              <EmptyTitle className="text-base">Sem alertas abertos</EmptyTitle>
              <EmptyDescription>
                O agente não encontrou bloqueios nas filas agora.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}

        <div className="rounded-[18px] border border-border bg-white/55 px-4 py-3 text-xs leading-5 text-muted-foreground">
          Última atualização: {formatDate(updatedAt, "Sem atualização")}
        </div>
      </CardContent>
    </Card>
  );
}

function ExceptionDialog({
  open,
  taskEntry,
  note,
  isPending,
  onOpenChange,
  onNoteChange,
  onSubmit,
}: {
  open: boolean;
  taskEntry?: TaskQueueEntry;
  note: string;
  isPending: boolean;
  onOpenChange: (open: boolean) => void;
  onNoteChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const task = taskEntry?.task;
  const title = task ? getTaskTitle(task) : "Tarefa";
  const canSubmit = Boolean(task && (note.trim() || task.blocked_reason));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form className="flex flex-col gap-5" onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>Registrar exceção</DialogTitle>
            <DialogDescription>
              {title} · {taskEntry?.queue.label ?? "Fila WMS"}
            </DialogDescription>
          </DialogHeader>

          {task?.blocked_reason ? (
            <Alert className="border-destructive/20 bg-destructive/10 text-destructive">
              <Ban className="size-4" />
              <AlertTitle>Bloqueio atual</AlertTitle>
              <AlertDescription>{task.blocked_reason}</AlertDescription>
            </Alert>
          ) : null}

          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-foreground" htmlFor="warehouse-exception-note">
              Motivo da exceção
            </label>
            <Textarea
              id="warehouse-exception-note"
              value={note}
              onChange={(event) => onNoteChange(event.target.value)}
              placeholder="Divergência, falta, avaria, documento pendente..."
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={!canSubmit || isPending}>
              {isPending ? (
                <RefreshCw data-icon="inline-start" className="animate-spin" />
              ) : (
                <MessageSquareWarning data-icon="inline-start" />
              )}
              Registrar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type WarehouseOpsProps = {
  initialModule?: WarehouseOpsModuleKey;
};

export default function WarehouseOps({
  initialModule = "receiving",
}: WarehouseOpsProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [activeModuleKey, setActiveModuleKey] =
    useState<WarehouseOpsModuleKey>(initialModule);
  const [selectedTaskId, setSelectedTaskId] = useState<string>();
  const [exceptionDialogOpen, setExceptionDialogOpen] = useState(false);
  const [exceptionTaskId, setExceptionTaskId] = useState<string>();
  const [exceptionNote, setExceptionNote] = useState("");
  const [lineConfirmations, setLineConfirmations] =
    useState<LineConfirmationMap>({});

  useEffect(() => {
    setActiveModuleKey(initialModule);
  }, [initialModule]);

  const ops = useQuery({
    queryKey: ["warehouse-ops"],
    queryFn: () => fetchJson<WarehouseOpsResponse>("/api/warehouse/ops"),
    refetchInterval: 30000,
  });

  const queues = useMemo(
    () => normalizeQueues(ops.data?.queues),
    [ops.data?.queues],
  );
  const alerts = useMemo(() => ops.data?.alerts ?? [], [ops.data?.alerts]);
  const metrics = useMemo(
    () => deriveMetrics(ops.data?.metrics, queues, alerts),
    [alerts, ops.data?.metrics, queues],
  );
  const activeModule = useMemo(
    () =>
      WAREHOUSE_OPS_MODULES.find((module) => module.key === activeModuleKey) ??
      WAREHOUSE_OPS_MODULES[0],
    [activeModuleKey],
  );
  const taskEntries = useMemo(() => queueEntries(queues), [queues]);
  const moduleQueues = useMemo(
    () => getModuleQueues(queues, activeModule),
    [activeModule, queues],
  );
  const moduleTaskEntries = useMemo(
    () => queueEntries(moduleQueues),
    [moduleQueues],
  );
  const moduleAlerts = useMemo(
    () => getModuleAlerts(alerts, activeModule),
    [activeModule, alerts],
  );
  const moduleDefaultTaskEntry = useMemo(
    () => pickDefaultTaskEntry(moduleTaskEntries),
    [moduleTaskEntries],
  );
  const selectedTaskEntry =
    moduleTaskEntries.find(({ task }) => task.id === selectedTaskId) ??
    moduleDefaultTaskEntry;
  const exceptionTaskEntry =
    taskEntries.find(({ task }) => task.id === exceptionTaskId) ?? selectedTaskEntry;
  const selectedResolvedId = selectedTaskEntry?.task.id;
  const blockedEntries = taskEntries.filter(({ task }) => Boolean(task.blocked_reason));
  const activeBlockedEntries = moduleTaskEntries.filter(({ task }) =>
    Boolean(task.blocked_reason),
  );

  const advanceTask = useMutation<unknown, Error, string>({
    mutationFn: (taskId) => {
      const task = taskEntries.find((entry) => entry.task.id === taskId)?.task;
      return (
      fetchJson(`/api/warehouse/tasks/${encodeURIComponent(taskId)}/advance`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expected_status: task?.status,
          idempotency_key: `${taskId}:${task?.status ?? "unknown"}`,
        }),
      })
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["warehouse-ops"] });
      queryClient.invalidateQueries({ queryKey: ["ai-overview"] });
      toast({
        title: "Tarefa avançada",
        description: "A bancada WMS foi atualizada com a próxima etapa.",
      });
    },
    onError: (error) => {
      toast({
        title: "Não consegui avançar a tarefa",
        description: getErrorMessage(error),
        variant: "destructive",
      });
    },
  });

  const registerException = useMutation<unknown, Error, ExceptionPayload>({
    mutationFn: ({ task, queue, note }) =>
      fetchJson(`/api/warehouse/tasks/${encodeURIComponent(task.id)}/exception`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          note: note || task.blocked_reason || "Exceção registrada na bancada WMS.",
          severity:
            task.priority === "critical" || task.blocked_reason
              ? "critical"
              : "attention",
          source: "warehouse_ops",
          payload: {
            queue,
            event_type: EXCEPTION_EVENT_TYPE[queue],
            task_id: task.id,
            reference: task.reference,
            status: task.status,
            customer_request_id: task.customer_request_id,
            blocked_reason: task.blocked_reason,
            exception_count: task.exception_count,
          },
        }),
      }),
    onSuccess: () => {
      setExceptionDialogOpen(false);
      setExceptionTaskId(undefined);
      setExceptionNote("");
      queryClient.invalidateQueries({ queryKey: ["warehouse-ops"] });
      queryClient.invalidateQueries({ queryKey: ["ai-overview"] });
      toast({
        title: "Exceção registrada",
        description: "O evento operacional foi enviado para a memória da IA.",
      });
    },
    onError: (error) => {
      toast({
        title: "Não consegui registrar a exceção",
        description: getErrorMessage(error),
        variant: "destructive",
      });
    },
  });

  function openExceptionDialog(task: WarehouseTask, suggestedNote?: string) {
    setExceptionTaskId(task.id);
    setExceptionNote(suggestedNote || task.blocked_reason || "");
    setExceptionDialogOpen(true);
  }

  function handleLineConfirmationChange(
    taskId: string,
    rowId: string,
    resolution: LineResolution,
  ) {
    setLineConfirmations((current) => ({
      ...current,
      [lineConfirmationKey(taskId, rowId)]: resolution,
    }));
  }

  function handleExceptionSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!exceptionTaskEntry) return;

    registerException.mutate({
      task: exceptionTaskEntry.task,
      queue: exceptionTaskEntry.queue.key,
      note: exceptionNote.trim(),
    });
  }

  if (ops.isLoading) return <WarehouseOpsLoading />;

  if (ops.error || !ops.data) {
    return (
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 gap-3">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-[18px] border border-border bg-white/70 shadow-[0_8px_24px_rgba(15,23,42,.04)]">
              <WarehouseIcon className="size-5 text-primary" />
            </div>
            <div className="min-w-0">
              <h1 className="text-2xl font-semibold tracking-normal text-foreground">
                Bancada WMS Dutelog
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Operação BTG em Recebimento, Qualidade, Putaway, Picking,
                Packing, Expedição e Exceções.
              </p>
            </div>
          </div>
        </div>

        <Alert variant="destructive" className="bg-destructive/10">
          <AlertCircle className="size-4" />
          <AlertTitle>Não foi possível carregar a bancada WMS</AlertTitle>
          <AlertDescription>
            <div className="flex flex-col gap-4">
              <p>{getErrorMessage(ops.error)}</p>
              <Button
                type="button"
                variant="outline"
                className="w-full sm:w-fit"
                onClick={() => ops.refetch()}
              >
                <RefreshCw data-icon="inline-start" />
                Tentar novamente
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 gap-3">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-[18px] border border-border bg-white/70 shadow-[0_8px_24px_rgba(15,23,42,.04)]">
            <WarehouseIcon className="size-5 text-primary" />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-normal text-foreground">
              Bancada WMS Dutelog
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Operação BTG em Recebimento, Qualidade, Putaway, Picking,
              Packing, Expedição e Exceções.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="border-primary/20 bg-primary/10 text-primary">
            WMS operacional
          </Badge>
          {blockedEntries.length > 0 ? (
            <Badge
              variant="outline"
              className="border-destructive/20 bg-destructive/10 text-destructive"
            >
              {formatNumber(blockedEntries.length)} bloqueio(s)
            </Badge>
          ) : null}
          <Button
            type="button"
            variant="outline"
            onClick={() => ops.refetch()}
            disabled={ops.isFetching}
          >
            <RefreshCw
              data-icon="inline-start"
              className={cn(ops.isFetching && "animate-spin")}
            />
            Atualizar
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <MetricCard
          title="Pendências totais"
          value={formatNumber(metrics.pendingTotal)}
          caption="Tarefas abertas somadas nas filas WMS."
          icon={ClipboardCheck}
        />
        <MetricCard
          title="Prazo próximo"
          value={formatNumber(metrics.dueSoon)}
          caption="Itens vencidos ou com SLA nas próximas 4 horas."
          icon={Clock3}
        />
        <MetricCard
          title="Críticos"
          value={formatNumber(metrics.critical)}
          caption="Bloqueios, prioridade crítica e exceções ativas."
          icon={AlertTriangle}
        />
        <MetricCard
          title="Avançadas hoje"
          value={formatNumber(metrics.throughputToday)}
          caption={`SLA médio: ${formatSla(metrics.avgSlaMinutes)}.`}
          icon={CheckCircle2}
        />
        <MetricCard
          title="Alertas IA"
          value={formatNumber(metrics.agentAlerts)}
          caption="Sinais ativos no painel operacional do agente."
          icon={Sparkles}
        />
      </div>

      <WmsModuleSnapshot
        module={activeModule}
        queues={moduleQueues}
        alerts={moduleAlerts}
        selectedEntry={selectedTaskEntry}
        onSelectTask={setSelectedTaskId}
      />

      {moduleQueues.length > 0 ? (
        <PhysicalFlowMap
          queues={moduleQueues}
          alerts={moduleAlerts}
          selectedTaskId={selectedResolvedId}
          onSelectTask={setSelectedTaskId}
          flowKeys={activeModule.queueKeys}
          title={`${activeModule.label} WMS`}
          description={activeModule.description}
        />
      ) : null}

      {activeModule.mode === "exceptions" && activeBlockedEntries.length > 0 ? (
        <BlockedTasksPanel
          entries={activeBlockedEntries}
          selectedTaskId={selectedResolvedId}
          onSelectTask={setSelectedTaskId}
        />
      ) : null}

      <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="flex min-w-0 flex-col gap-4">
          {moduleQueues.length > 0 ? (
            <div
              className={cn(
                "grid min-w-0 gap-4",
                getQueueCardGridClass(moduleQueues.length),
              )}
            >
              {moduleQueues.map((queue) => (
                <QueueCard
                  key={queue.key}
                  queue={queue}
                  isFocusQueue={activeModule.queueKeys.includes(queue.key)}
                  selectedTaskId={selectedResolvedId}
                  onSelectTask={setSelectedTaskId}
                  onAdvance={(taskId) => advanceTask.mutate(taskId)}
                  advancingTaskId={
                    advanceTask.isPending ? advanceTask.variables : undefined
                  }
                />
              ))}
            </div>
          ) : (
            <WmsModuleEmptyState module={activeModule} />
          )}

          {activeModule.mode === "exceptions" || moduleAlerts.length > 0 ? (
            <AgentAlertsPanel
              alerts={moduleAlerts}
              summary={ops.data.agent_summary}
              updatedAt={ops.data.updated_at}
            />
          ) : null}
        </div>

        <TaskDetailPanel
          entry={selectedTaskEntry}
          alerts={moduleAlerts}
          lineConfirmations={lineConfirmations}
          onAdvance={(taskId) => advanceTask.mutate(taskId)}
          onLineConfirmationChange={handleLineConfirmationChange}
          onOpenException={openExceptionDialog}
          advancingTaskId={advanceTask.isPending ? advanceTask.variables : undefined}
          registeringExceptionId={
            registerException.isPending
              ? registerException.variables.task.id
              : undefined
          }
        />
      </div>

      <ExceptionDialog
        open={exceptionDialogOpen}
        taskEntry={exceptionTaskEntry}
        note={exceptionNote}
        isPending={registerException.isPending}
        onOpenChange={(open) => {
          setExceptionDialogOpen(open);
          if (!open && !registerException.isPending) {
            setExceptionTaskId(undefined);
            setExceptionNote("");
          }
        }}
        onNoteChange={setExceptionNote}
        onSubmit={handleExceptionSubmit}
      />
    </div>
  );
}
