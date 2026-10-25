/** Pure warehouse-ops domain model (types + helpers, no React UI). */

import {
  ClipboardCheck,
  Forklift,
  ListChecks,
  PackageCheck,
  PackageOpen,
  PackageSearch,
  RotateCcw,
  ShieldAlert,
  Truck,
  type LucideIcon,
} from "lucide-react";

export type QueueKey = "receiving" | "putaway" | "picking" | "packing" | "expedition";
export type WarehouseOpsModuleKey =
  | "receiving"
  | "quality"
  | "putaway"
  | "picking"
  | "packing"
  | "expedition"
  | "returns"
  | "inventory"
  | "exceptions";
export type TaskPriority = "low" | "normal" | "high" | "critical";
export type AlertSeverity = "info" | "attention" | "critical";

export type WarehouseTaskItem = {
  id?: string | null;
  sku?: string | null;
  sku_code?: string | null;
  name?: string | null;
  product_name?: string | null;
  description?: string | null;
  quantity?: number | null;
  expected_quantity?: number | null;
  picked_quantity?: number | null;
  received_qty?: number | null;
  packed_quantity?: number | null;
  qty_packed?: number | null;
  difference_qty?: number | null;
  conference_status?: string | null;
  status?: string | null;
  location?: string | null;
  source_location_id?: string | null;
  destination_location_id?: string | null;
  package_id?: string | null;
  package_code?: string | null;
  package_label?: string | null;
  package_number?: string | number | null;
  tracking_code?: string | null;
  client_item_code?: string | null;
  /** Observação do aviso do cliente (ex.: código do fornecedor). */
  notes?: string | null;
  unit_cost?: number | null;
  volume?: string | null;
  volume_id?: string | null;
};

export type WarehouseTaskTimelineEvent = {
  id?: string | null;
  title?: string | null;
  description?: string | null;
  status?: string | null;
  actor?: string | null;
  occurred_at?: string | null;
  created_at?: string | null;
  at?: string | null;
};

export type WarehouseTask = {
  id: string;
  title?: string | null;
  reference?: string | null;
  sku?: string | null;
  sku_code?: string | null;
  customer?: string | null;
  location?: string | null;
  source_location_id?: string | null;
  destination_location_id?: string | null;
  quantity?: number | null;
  total_units?: number | null;
  package_count?: number | null;
  volume_label?: string | null;
  seal_code?: string | null;
  package_notes?: string | null;
  carrier?: string | null;
  driver_name?: string | null;
  vehicle_plate?: string | null;
  proof_reference?: string | null;
  delivery_notes?: string | null;
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
  /** O pedido de saída da separação, do packing e da expedição (orders/{id}). */
  order_id?: string | null;
  can_advance?: boolean | null;
  can_register_exception?: boolean | null;
};

export type OpsQueue = {
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

export type OpsAlert = {
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

export type OpsMetrics = {
  pending_total?: number | null;
  due_soon?: number | null;
  critical?: number | null;
  throughput_today?: number | null;
  avg_sla_minutes?: number | null;
  agent_alerts?: number | null;
};

export type WarehouseOpsResponse = {
  metrics?: OpsMetrics;
  queues?: Partial<Record<QueueKey, OpsQueue>> | OpsQueue[];
  alerts?: OpsAlert[];
  agent_summary?: string | null;
  updated_at?: string | null;
};

export type QueueMeta = {
  key: QueueKey;
  label: string;
  description: string;
  icon: LucideIcon;
};

export type WarehouseOpsModule = {
  key: WarehouseOpsModuleKey;
  label: string;
  description: string;
  icon: LucideIcon;
  queueKeys: QueueKey[];
  mode: "queue" | "quality" | "exceptions" | "workspace";
};

export type NormalizedQueue = {
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

export type DerivedMetrics = {
  pendingTotal: number;
  dueSoon: number;
  critical: number;
  throughputToday: number;
  avgSlaMinutes?: number | null;
  agentAlerts: number;
};

export type TaskQueueEntry = {
  task: WarehouseTask;
  queue: NormalizedQueue;
};

export type PackingCheckRow = {
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

export type LineResolution = "pending" | "confirmed" | "shortage" | "damaged";

export type LineConfirmationMap = Record<string, LineResolution>;

export type LineResolutionCounts = Record<LineResolution, number> & {
  total: number;
};

export type ExceptionPayload = {
  task: WarehouseTask;
  queue: QueueKey;
  note: string;
};

export const QUEUE_META: QueueMeta[] = [
  {
    key: "receiving",
    label: "Receiving",
    description: "Docas, conferência fiscal e entrada física.",
    icon: PackageOpen,
  },
  {
    key: "putaway",
    label: "Guarda",
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

export const QUEUE_ALIASES: Record<string, QueueKey> = {
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

export const FOCUS_QUEUE_KEYS: QueueKey[] = [
  "receiving",
  "putaway",
  "picking",
  "packing",
  "expedition",
];

export const WAREHOUSE_OPS_MODULES: WarehouseOpsModule[] = [
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
    label: "Guarda",
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
    key: "returns",
    label: "Devoluções",
    description: "Retorno, triagem e disposição física.",
    icon: RotateCcw,
    queueKeys: [],
    mode: "workspace",
  },
  {
    key: "inventory",
    label: "Inventário",
    description: "Abertura de estoque e contagem cíclica.",
    icon: ListChecks,
    queueKeys: [],
    mode: "workspace",
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

export const TERMINAL_STATUSES = new Set([
  "completed",
  "delivered",
  "received",
  "closed",
  "cancelled",
  "canceled",
  "resolved",
]);

export const QUEUE_ACTION_FALLBACK: Record<QueueKey, string> = {
  receiving: "Conferir a próxima entrada e registrar divergência antes da guarda.",
  putaway: "Confirmar endereço físico e liberar saldo para separação.",
  picking: "Separar o próximo pedido priorizado e sinalizar falta de item.",
  packing: "Conferir itens separados, fechar volume e liberar expedição.",
  expedition: "Preparar coleta, romaneio e baixa de saída.",
};

export const EXCEPTION_EVENT_TYPE: Record<QueueKey, string> = {
  receiving: "inbound.exception_found",
  putaway: "putaway.exception_found",
  picking: "picking.shortage_found",
  packing: "packing.exception_found",
  expedition: "shipment.exception_found",
};

export const PACKING_DIVERGENT_STATUSES = new Set([
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

export const LINE_DAMAGED_STATUSES = new Set([
  "avaria",
  "damaged",
  "damage",
  "rejected",
]);

export const LINE_SHORTAGE_STATUSES = new Set([
  "falta",
  "missing",
  "short",
  "shortage",
]);

export const LINE_CONFIRMED_STATUSES = new Set([
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

export const QUALITY_TASK_STATUSES = new Set([
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

export const LINE_RESOLUTION_COPY: Record<
  LineResolution,
  { label: string; shortLabel: string; description: string; className: string }
> = {
  pending: {
    label: "A conferir",
    shortLabel: "A conferir",
    description: "Conte o físico antes de avançar.",
    className: "border-border bg-card text-muted-foreground",
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
    className: "border-warning-soft-border bg-warning-soft text-warning-soft-foreground",
  },
  damaged: {
    label: "Avaria",
    shortLabel: "Avaria",
    description: "Separe evidência e registre avaria.",
    className: "border-destructive/20 bg-destructive/10 text-destructive",
  },
};

export const QUEUE_OPERATOR_COPY: Record<
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

export const numberFormatter = new Intl.NumberFormat("pt-BR");
export const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
});

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);

  if (!response.ok) {
    const message = await response.text().catch(() => "");
    throw new Error(message || `HTTP ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export function normalizeSlug(value?: string | null) {
  return (value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function normalizeStatus(value?: string | null) {
  return normalizeSlug(value).replace(/-/g, "_");
}

export function toQueueKey(value?: string | null): QueueKey | undefined {
  const slug = normalizeSlug(value);
  return QUEUE_ALIASES[slug];
}

export function coerceNumber(value: number | null | undefined, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function firstFiniteNumber(...values: Array<number | null | undefined>) {
  return values.find(
    (value): value is number => typeof value === "number" && Number.isFinite(value),
  );
}

export function clampPercent(value?: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  const normalized = value > 0 && value <= 1 ? value * 100 : value;
  return Math.min(100, Math.max(0, Math.round(normalized)));
}

export function formatNumber(value?: number | null) {
  return numberFormatter.format(coerceNumber(value));
}

export function formatUnits(value?: number) {
  return typeof value === "number" ? `${formatNumber(value)} un.` : "aberto";
}

export function formatDeltaUnits(value?: number) {
  if (typeof value !== "number") return "sem leitura";
  if (value === 0) return "sem diverg.";
  const prefix = value > 0 ? "+" : "-";
  return `${prefix}${formatNumber(Math.abs(value))} un.`;
}

export function formatDate(value?: string | null, fallback = "Sem prazo") {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return dateFormatter.format(date);
}

export function formatSla(minutes?: number | null) {
  const value = coerceNumber(minutes);
  if (!value) return "Sem SLA";
  if (value < 60) return `${value} min`;

  const hours = Math.floor(value / 60);
  const remainingMinutes = value % 60;
  return remainingMinutes ? `${hours}h ${remainingMinutes}min` : `${hours}h`;
}

export function isDueSoon(value?: string | null) {
  if (!value) return false;
  const dueTime = new Date(value).getTime();
  if (Number.isNaN(dueTime)) return false;

  return dueTime - Date.now() <= 4 * 60 * 60 * 1000;
}

export function isTerminalTask(task: WarehouseTask) {
  return TERMINAL_STATUSES.has(normalizeStatus(task.status));
}

export function canAdvanceTask(task?: WarehouseTask) {
  if (!task) return false;
  if (typeof task.can_advance === "boolean") return task.can_advance;
  return Boolean(task.id) && !task.blocked_reason && !isTerminalTask(task);
}

/**
 * A tarefa só para consulta (quem não opera o armazém): sem avançar, sem
 * registrar exceção e sem salvar a conferência, que seguem estas duas regras.
 */
export function somenteConsulta(entry: TaskQueueEntry): TaskQueueEntry {
  return { ...entry, task: { ...entry.task, can_advance: false, can_register_exception: false } };
}

export function canRegisterException(task?: WarehouseTask) {
  if (!task) return false;
  if (typeof task.can_register_exception === "boolean") {
    return task.can_register_exception;
  }
  return Boolean(task.id) && !isTerminalTask(task);
}

export function getTaskTitle(task: WarehouseTask) {
  return task.title || task.reference || `Tarefa ${task.id}`;
}

export function getTaskDate(task: WarehouseTask) {
  return task.due_at || task.created_at || null;
}

export function taskPriorityScore(task: WarehouseTask) {
  if (task.blocked_reason) return 0;
  if (task.priority === "critical") return 1;
  if (isDueSoon(task.due_at)) return 2;
  if (task.priority === "high") return 3;
  if (!isTerminalTask(task)) return 4;
  return 5;
}

export function sortTasks(tasks: WarehouseTask[]) {
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

export function normalizeQueues(
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
      // Cada fonte mantém o nome que manda; só a guarda é sempre "Guarda".
      label: meta.key === "putaway" ? meta.label : queue?.name || meta.label,
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

export function deriveMetrics(
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

export function priorityLabel(priority?: string | null) {
  if (priority === "critical") return "Crítica";
  if (priority === "high") return "Alta";
  if (priority === "low") return "Baixa";
  return "Normal";
}

export function priorityClass(priority?: string | null) {
  if (priority === "critical") {
    return "border-destructive/20 bg-destructive/10 text-destructive";
  }
  if (priority === "high") {
    return "border-warning-soft-border bg-warning-soft text-warning-soft-foreground";
  }
  if (priority === "low") {
    return "border-border bg-card text-muted-foreground";
  }
  return "border-primary/20 bg-primary/10 text-primary";
}

export function statusLabel(status?: string | null) {
  const normalized = normalizeStatus(status);
  if (normalized === "ready_to_dispatch") return "pronto p/ expedição";
  if (normalized === "in_progress") return "em execução";
  if (normalized === "completed") return "concluída";
  if (normalized === "delivered") return "entregue";
  if (normalized === "received") return "recebida";
  // A chegada nasce "created" (conferência ainda não salva).
  if (normalized === "created") return "a conferir";
  if (normalized === "checking") return "em conferência";
  if (normalized === "planned") return "planejada";
  if (normalized === "ready") return "pronta";
  if (normalized === "dispatched") return "despachada";
  return status || "sem status";
}

export function statusClass(status?: string | null) {
  const normalized = normalizeStatus(status);
  if (TERMINAL_STATUSES.has(normalized)) {
    return "border-primary/20 bg-primary/10 text-primary";
  }
  if (["checking", "in_progress", "dispatched"].includes(normalized)) {
    return "border-warning-soft-border bg-warning-soft text-warning-soft-foreground";
  }
  return "border-border bg-card text-muted-foreground";
}

export function alertClass(severity?: string | null) {
  if (severity === "critical") {
    return "border-destructive/20 bg-destructive/10 text-destructive";
  }
  if (severity === "attention") {
    return "border-warning-soft-border bg-warning-soft text-warning-soft-foreground";
  }
  return "border-primary/20 bg-primary/10 text-primary";
}

export function getErrorMessage(error: unknown) {
  if (!(error instanceof Error)) return "Erro inesperado";
  const raw = error.message.trim();
  if (!raw) return "Erro inesperado";
  if (raw.startsWith("{") && raw.endsWith("}")) {
    try {
      const parsed = JSON.parse(raw) as { message?: unknown };
      if (typeof parsed.message === "string" && parsed.message.trim()) {
        return parsed.message.trim() === "INTERNAL"
          ? "Falha interna ao autorizar o upload. Tente novamente ou avise o time técnico."
          : parsed.message.trim();
      }
    } catch {
      // keep raw message
    }
  }
  if (raw === "INTERNAL") {
    return "Falha interna ao autorizar o upload. Tente novamente ou avise o time técnico.";
  }
  return raw;
}

export function getQueueAction(queue: NormalizedQueue) {
  return (
    queue.nextAction ||
    queue.activeTask?.next_action ||
    QUEUE_ACTION_FALLBACK[queue.key]
  );
}

export function sumPackingQuantity(
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

export function packageLabel(item: WarehouseTaskItem, index: number) {
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

export function getPackingCheckRows(task: WarehouseTask): PackingCheckRow[] {
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

export function getPhysicalLineRows(
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

export function lineConfirmationKey(taskId: string, rowId: string) {
  return `${taskId}::${rowId}`;
}

export function inferLineResolution(row: PackingCheckRow): LineResolution {
  const normalizedStatus = normalizeStatus(row.status);

  if (LINE_DAMAGED_STATUSES.has(normalizedStatus)) return "damaged";
  if (LINE_SHORTAGE_STATUSES.has(normalizedStatus)) return "shortage";
  if (row.hasDivergence) return "shortage";
  if (LINE_CONFIRMED_STATUSES.has(normalizedStatus)) return "confirmed";
  return "pending";
}

export function getLineResolution(
  taskId: string,
  row: PackingCheckRow,
  confirmations: LineConfirmationMap,
): LineResolution {
  return (
    confirmations[lineConfirmationKey(taskId, row.id)] ?? inferLineResolution(row)
  );
}

export function getLineResolutionCounts(
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

export function hasPhysicalIssue(counts: LineResolutionCounts) {
  return counts.shortage > 0 || counts.damaged > 0;
}

export function buildLineExceptionNote(
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

export function queueSlaState(queue: NormalizedQueue) {
  if (queue.blockedCount > 0) {
    return {
      label: "SLA bloqueado",
      className: "border-destructive/20 bg-destructive/10 text-destructive",
    };
  }
  if (queue.dueSoonCount > 0) {
    return {
      label: "SLA em risco",
      className: "border-warning-soft-border bg-warning-soft text-warning-soft-foreground",
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
    className: "border-border bg-card text-muted-foreground",
  };
}

export function taskHasExceptionSignal(task: WarehouseTask) {
  return (
    Boolean(task.blocked_reason) ||
    coerceNumber(task.exception_count) > 0 ||
    task.priority === "critical"
  );
}

export function taskHasQualitySignal(task: WarehouseTask) {
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

export function isTaskInModule(
  task: WarehouseTask,
  queue: NormalizedQueue,
  module: WarehouseOpsModule,
) {
  if (!module.queueKeys.includes(queue.key)) return false;
  if (module.mode === "exceptions") return taskHasExceptionSignal(task);
  if (module.mode === "quality") return taskHasQualitySignal(task);
  return true;
}

export function scopeQueueTasks(
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

export function getModuleQueues(
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

export function queueEntries(queues: NormalizedQueue[]): TaskQueueEntry[] {
  return queues.flatMap((queue) =>
    queue.tasks.map((task) => ({
      task,
      queue,
    })),
  );
}

export function pickDefaultTaskEntry(entries: TaskQueueEntry[]) {
  return (
    entries.find(({ task }) => Boolean(task.blocked_reason)) ??
    entries.find(({ task }) => task.priority === "critical") ??
    entries.find(({ task }) => !isTerminalTask(task)) ??
    entries[0]
  );
}

export function getModuleAlerts(alerts: OpsAlert[], module: WarehouseOpsModule) {
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

export function getModuleGridClass(count: number) {
  if (count <= 1) return "lg:grid-cols-1";
  if (count === 2) return "lg:grid-cols-2";
  if (count === 3) return "lg:grid-cols-3";
  if (count === 4) return "lg:grid-cols-4";
  return "lg:grid-cols-5";
}

export function getQueueCardGridClass(count: number) {
  if (count <= 1) return "lg:grid-cols-1";
  return "lg:grid-cols-2";
}

export function timelineDate(event: WarehouseTaskTimelineEvent) {
  return event.occurred_at || event.created_at || event.at || null;
}



export type AnyRecord = Record<string, unknown>;

export type AdvanceOperationPayload = Record<string, unknown>;
export type AdvanceTaskPayload = {
  id: string;
  operation?: AdvanceOperationPayload;
  note?: string;
};

export function coerceText(...values: unknown[]) {
  for (const value of values) {
    if (value == null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
}

export function formatCurrency(value?: number | null) {
  const amount = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(amount);
}

export function getAdvanceGate(
  queue: NormalizedQueue,
  task: WarehouseTask,
  counts?: LineResolutionCounts,
) {
  // A guarda confirma posição e quantidade. A conferência de linha é da entrada.
  const checksLines = queue.key !== "putaway";
  const pendingBlocked = Boolean(checksLines && counts && counts.pending > 0);
  const issueBlocked = Boolean(
    checksLines && counts && (counts.shortage > 0 || counts.damaged > 0) && counts.pending > 0,
  );
  const blocked = pendingBlocked || issueBlocked;
  const blockedReason = !canAdvanceTask(task)
    ? "Esta tarefa não pode avançar no status atual."
    : pendingBlocked
      ? "Confirme todas as linhas físicas antes de avançar."
      : null;
  return {
    canAdvance: canAdvanceTask(task) && !blocked,
    canSubmitAdvance: canAdvanceTask(task) && !blocked,
    blockedReason,
    reason: blockedReason,
    label: queue.key === "putaway" ? "Concluir guarda" : getQueueAction(queue) || "Avançar",
  };
}

/**
 * A conferência de cada linha como o advanceWarehouseTask lê: o id da linha,
 * a quantidade esperada e a marcação do operador como status. O servidor só
 * conclui com todas "confirmed" e na quantidade da linha; falta e avaria vão
 * como estão, e a conclusão para pedindo a exceção.
 */
function lineChecks(task: WarehouseTask, confirmations: LineConfirmationMap) {
  return getPhysicalLineRows(task).flatMap((row) =>
    typeof row.expectedQuantity === "number" && row.expectedQuantity > 0
      ? [{ id: row.id, quantity: row.expectedQuantity, status: getLineResolution(task.id, row, confirmations) }]
      : [],
  );
}

export function buildPickingOperation(
  task: WarehouseTask,
  confirmations: LineConfirmationMap,
): AdvanceOperationPayload {
  return {
    picking_lines: lineChecks(task, confirmations).map((line) => ({
      pick_line_id: line.id,
      qty_picked: line.quantity,
      status: line.status,
    })),
  };
}

export function buildPackingOperation(
  task: WarehouseTask,
  confirmations: LineConfirmationMap,
  packingOperation: AdvanceOperationPayload,
): AdvanceOperationPayload {
  return {
    ...packingOperation,
    packing_lines: lineChecks(task, confirmations).map((line) => ({
      order_item_id: line.id,
      qty_packed: line.quantity,
      status: line.status,
    })),
  };
}
