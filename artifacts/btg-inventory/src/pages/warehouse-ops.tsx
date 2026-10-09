import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Ban,
  Box,
  Camera,
  ChevronRight,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  FileWarning,
  Forklift,
  Hash,
  ImagePlus,
  Inbox,
  ListChecks,
  MapPin,
  MessageSquareWarning,
  PackageCheck,
  PackageOpen,
  PackageSearch,
  PlayCircle,
  RefreshCw,
  RotateCcw,
  Route,
  ShieldAlert,
  Sparkles,
  Trash2,
  Truck,
  UserRound,
  Warehouse as WarehouseIcon,
  type LucideIcon,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import {
  Card,
  CardContent,
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";


import {
  type AdvanceOperationPayload,
  type AdvanceTaskPayload,
  type AlertSeverity,
  type AnyRecord,
  type DerivedMetrics,
  type ExceptionPayload,
  type LineConfirmationMap,
  type LineResolution,
  type LineResolutionCounts,
  type NormalizedQueue,
  type OpsAlert,
  type OpsMetrics,
  type OpsQueue,
  type PackingCheckRow,
  type QueueKey,
  type QueueMeta,
  type TaskPriority,
  type TaskQueueEntry,
  type WarehouseOpsModule,
  type WarehouseOpsModuleKey,
  type WarehouseOpsResponse,
  type WarehouseTask,
  type WarehouseTaskItem,
  type WarehouseTaskTimelineEvent,
  EXCEPTION_EVENT_TYPE,
  FOCUS_QUEUE_KEYS,
  LINE_CONFIRMED_STATUSES,
  LINE_DAMAGED_STATUSES,
  LINE_RESOLUTION_COPY,
  LINE_SHORTAGE_STATUSES,
  PACKING_DIVERGENT_STATUSES,
  QUALITY_TASK_STATUSES,
  QUEUE_ACTION_FALLBACK,
  QUEUE_ALIASES,
  QUEUE_META,
  QUEUE_OPERATOR_COPY,
  TERMINAL_STATUSES,
  WAREHOUSE_OPS_MODULES,
  alertClass,
  buildLineExceptionNote,
  buildPackingOperation,
  buildPickingOperation,
  canAdvanceTask,
  canRegisterException,
  clampPercent,
  coerceNumber,
  coerceText,
  dateFormatter,
  deriveMetrics,
  fetchJson,
  firstFiniteNumber,
  formatCurrency,
  formatDate,
  formatDeltaUnits,
  formatNumber,
  formatSla,
  formatUnits,
  getAdvanceGate,
  getErrorMessage,
  getLineResolution,
  getLineResolutionCounts,
  getModuleAlerts,
  getModuleGridClass,
  getModuleQueues,
  getPackingCheckRows,
  getPhysicalLineRows,
  getQueueAction,
  getQueueCardGridClass,
  getTaskDate,
  getTaskTitle,
  hasPhysicalIssue,
  inferLineResolution,
  isDueSoon,
  isTaskInModule,
  isTerminalTask,
  lineConfirmationKey,
  normalizeQueues,
  normalizeSlug,
  normalizeStatus,
  numberFormatter,
  packageLabel,
  pickDefaultTaskEntry,
  priorityClass,
  priorityLabel,
  queueEntries,
  queueSlaState,
  scopeQueueTasks,
  sortTasks,
  statusClass,
  statusLabel,
  sumPackingQuantity,
  taskHasExceptionSignal,
  taskHasQualitySignal,
  taskPriorityScore,
  timelineDate,
  toQueueKey,
} from "@/lib/warehouse-ops/model";

export type { WarehouseOpsModuleKey };

import { ExceptionDialog, useWarehouseTaskActions } from "@/features/warehouse-ops/task-actions";
import { CycleCountWorkspace } from "@/features/warehouse-ops/inventory";
import {
  ExceptionWorkspace,
  ReturnWorkspace,
} from "@/features/warehouse-ops/exceptions";
import { TaskDetailPanel } from "@/features/warehouse-ops/task-detail";

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
      <CardHeader className="flex flex-row items-start justify-between gap-4 pb-3">
        <div className="min-w-0">
          <CardTitle className="text-sm font-medium text-foreground/70">
            {title}
          </CardTitle>
          <div className="mt-3 truncate text-2xl font-semibold text-foreground">
            {value}
          </div>
        </div>
        <div className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border bg-card">
          <Icon className="size-4 text-primary" aria-hidden="true" />
        </div>
      </CardHeader>
      {caption ? (
        <CardContent className="pt-0">
          <p className="text-xs leading-5 text-foreground/65">{caption}</p>
        </CardContent>
      ) : null}
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
    <Card className="min-w-0 overflow-hidden border-primary/20 bg-card">
      <CardHeader className="border-b border-border/60 bg-card">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 gap-3">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-card">
              <Icon className="size-5 text-primary" />
            </div>
            <div className="min-w-0">
              <CardTitle className="text-lg">{module.label}</CardTitle>
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
            <Badge variant="outline" className="border-border bg-card text-muted-foreground">
              {formatNumber(alerts.length)} alerta(s)
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3 p-4 md:grid-cols-[repeat(4,minmax(0,1fr))] xl:grid-cols-[repeat(4,minmax(0,1fr))_minmax(260px,1.3fr)]">
        <div className="rounded-md border border-border bg-card px-3 py-2">
          <div className="text-xs text-foreground/70">Pendentes</div>
          <div className="mt-1 text-lg font-semibold text-foreground">
            {formatNumber(pending)}
          </div>
        </div>
        <div className="rounded-md border border-border bg-card px-3 py-2">
          <div className="text-xs text-foreground/70">Em execução</div>
          <div className="mt-1 text-lg font-semibold text-foreground">
            {formatNumber(inProgress)}
          </div>
        </div>
        <div className="rounded-md border border-border bg-card px-3 py-2">
          <div className="text-xs text-foreground/70">Exceções</div>
          <div
            className={cn(
              "mt-1 text-lg font-semibold",
              exceptions > 0 ? "text-destructive" : "text-foreground",
            )}
          >
            {formatNumber(exceptions)}
          </div>
        </div>
        <div className="rounded-md border border-border bg-card px-3 py-2">
          <div className="text-xs text-muted-foreground">Abertas</div>
          <div className="mt-1 text-lg font-semibold text-foreground">
            {formatNumber(pending)}
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card px-4 py-3 md:col-span-4 xl:col-span-1">
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
    <Empty className="min-h-[260px] border border-border bg-card">
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
        <Skeleton className="h-11 w-72 rounded-lg" />
        <Skeleton className="h-4 w-full max-w-[560px]" />
      </div>
      <Skeleton className="h-20 rounded-lg" />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {[1, 2, 3, 4, 5].map((item) => (
          <Skeleton key={item} className="h-32 rounded-lg" />
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[1, 2, 3, 4].map((item) => (
          <Skeleton key={item} className="h-48 rounded-lg" />
        ))}
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="grid gap-4 lg:grid-cols-2">
          {[1, 2, 3, 4, 5].map((item) => (
            <Skeleton key={item} className="h-[430px] rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-[680px] rounded-lg" />
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
      <CardHeader className="border-b border-border/60 bg-card pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border bg-card">
              <Icon className="size-4 text-primary" />
            </div>
            <div className="min-w-0">
              <CardTitle className="truncate text-base">{queue.label}</CardTitle>
            </div>
          </div>
          <Badge variant="outline" className={cn("shrink-0", slaState.className)}>
            {slaState.label}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 pt-4">
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-md border border-border bg-card px-3 py-2">
            <div className="text-lg font-semibold text-foreground">
              {formatNumber(queue.pending)}
            </div>
            <div className="text-xs text-foreground/70">Pendentes</div>
          </div>
          <div className="rounded-md border border-border bg-card px-3 py-2">
            <div className="text-lg font-semibold text-foreground">
              {formatNumber(queue.blockedCount)}
            </div>
            <div className="text-xs text-foreground/70">Bloqueios</div>
          </div>
          <div className="rounded-md border border-border bg-card px-3 py-2">
            <div className="text-lg font-semibold text-foreground">
              {formatNumber(queue.exceptionCount)}
            </div>
            <div className="text-xs text-foreground/70">Exceções</div>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
            <span>Fluxo concluído hoje</span>
            <span>{queue.progress}%</span>
          </div>
          <Progress value={queue.progress} />
        </div>

        <div className="rounded-lg border border-border bg-card px-4 py-3">
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
  title = "Fluxo físico",
}: {
  queues: NormalizedQueue[];
  alerts: OpsAlert[];
  selectedTaskId?: string;
  onSelectTask: (taskId: string) => void;
  flowKeys?: QueueKey[];
  title?: string;
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
      <CardHeader className="border-b border-border/60 bg-card">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <CardTitle className="text-base">
              {title}
            </CardTitle>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge
              variant="outline"
              className="border-border bg-card text-muted-foreground"
            >
              {formatNumber(pendingTotal)} pendentes
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
                    "soft-panel flex h-full min-h-[178px] w-full min-w-0 flex-col rounded-lg p-4 text-left outline-none transition-[border-color,box-shadow,background-color]",
                    "focus-visible:ring-2 focus-visible:ring-ring/30",
                    activeTask && "cursor-pointer hover:border-primary/30",
                    isSelected &&
                      "border-primary/35 bg-primary/5",
                    isBlocked && "border-destructive/20 bg-destructive/5",
                  )}
                  onClick={() => {
                    if (activeTask) onSelectTask(activeTask.id);
                  }}
                  disabled={!activeTask}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-card">
                        <Icon className="size-4 text-primary" />
                      </span>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-foreground">
                          {queue.label}
                        </div>
                        <div className="text-xs text-muted-foreground">
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
                    <div className="rounded-md border border-border bg-card px-2 py-2">
                      <div className="font-semibold text-foreground">
                        {formatNumber(queue.pending)}
                      </div>
                      <div className="text-foreground/70">Pendentes</div>
                    </div>
                    <div className="rounded-md border border-border bg-card px-2 py-2">
                      <div className="font-semibold text-foreground">
                        {formatNumber(queue.inProgress)}
                      </div>
                      <div className="text-foreground/70">Em execução</div>
                    </div>
                    <div className="rounded-md border border-border bg-card px-2 py-2">
                      <div
                        className={cn(
                          "font-semibold",
                          isBlocked ? "text-destructive" : "text-foreground",
                        )}
                      >
                        {formatNumber(queue.blockedCount)}
                      </div>
                      <div className="text-foreground/70">Bloqueios</div>
                    </div>
                  </div>

                  <div className="mt-4 min-w-0 flex-1">
                    <div className="text-xs font-medium uppercase text-muted-foreground">
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
  onSelect,
}: {
  task: WarehouseTask;
  queue: NormalizedQueue;
  isSelected: boolean;
  onSelect: (id: string) => void;
}) {
  const title = getTaskTitle(task);
  const exceptions = coerceNumber(task.exception_count);

  return (
    <div
      role="button"
      tabIndex={0}
      className={cn(
        "soft-panel flex min-w-0 cursor-pointer flex-col gap-3 rounded-lg p-4 outline-none transition-[border-color,box-shadow,background-color]",
        "focus-visible:ring-2 focus-visible:ring-ring/30",
        isSelected && "border-primary/35 bg-primary/5",
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
              <Badge variant="outline" className="border-warning-soft-border bg-warning-soft text-warning-soft-foreground">
                {formatNumber(exceptions)} exceções
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
        {!isTerminalTask(task) ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full shrink-0 sm:w-auto"
            onClick={(event) => {
              event.stopPropagation();
              onSelect(task.id);
            }}
            aria-label={`Conferir ${title}`}
          >
            <ArrowRight data-icon="inline-start" />
            Conferir
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
        <div className="rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs leading-5 text-destructive">
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
  onSelectTask,
}: {
  queue: NormalizedQueue;
  isFocusQueue: boolean;
  selectedTaskId?: string;
  onSelectTask: (id: string) => void;
}) {
  const Icon = queue.icon;

  return (
    <Card
      className={cn(
        "flex min-h-[420px] min-w-0 flex-col overflow-hidden",
        isFocusQueue && "border-primary/25",
      )}
    >
      <CardHeader className="border-b border-border/60 bg-card p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border bg-card">
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
            </div>
          </div>
          <Badge variant="outline" className="shrink-0">
            {formatNumber(queue.pending)} pendentes
          </Badge>
        </div>

        <div className="grid gap-3 pt-2 sm:grid-cols-4">
          <div>
            <div className="text-lg font-semibold text-foreground">
              {formatNumber(queue.inProgress)}
            </div>
            <div className="text-xs text-foreground/70">Em execução</div>
          </div>
          <div>
            <div className="text-lg font-semibold text-foreground">
              {formatNumber(queue.blockedCount)}
            </div>
            <div className="text-xs text-foreground/70">Bloqueios</div>
          </div>
          <div>
            <div className="text-lg font-semibold text-foreground">
              {formatNumber(queue.completedToday)}
            </div>
            <div className="text-xs text-foreground/70">Hoje</div>
          </div>
          <div>
            <div className="text-lg font-semibold text-foreground">
              {formatSla(queue.slaMinutes)}
            </div>
            <div className="text-xs text-muted-foreground">SLA</div>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card px-4 py-3">
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
                />
              ))}
            </div>
          </ScrollArea>
        ) : (
          <Empty className="min-h-[240px] border border-border bg-card">
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
                  "min-w-0 rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-left transition-[border-color,box-shadow,background-color]",
                  "hover:border-destructive/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30",
                  selectedTaskId === task.id && "bg-destructive/10",
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
          <Empty className="min-h-[180px] border border-border bg-card">
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
            <div className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border bg-card">
              <ShieldAlert className="size-4 text-primary" />
            </div>
            <div className="min-w-0">
              <CardTitle className="text-base">Alertas do agente</CardTitle>
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
                      <div className="rounded-md border border-border bg-card px-3 py-2 text-xs leading-5 text-foreground">
                        {alert.action}
                      </div>
                    ) : null}
                  </div>
                </AlertDescription>
              </Alert>
            ))}
          </div>
        ) : (
          <Empty className="min-h-[220px] border border-border bg-card">
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

        <div className="rounded-lg border border-border bg-card px-4 py-3 text-xs leading-5 text-muted-foreground">
          Última atualização: {formatDate(updatedAt, "Sem atualização")}
        </div>
      </CardContent>
    </Card>
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
  const [lineConfirmations, setLineConfirmations] =
    useState<LineConfirmationMap>({});

  useEffect(() => {
    setActiveModuleKey(initialModule);
  }, [initialModule]);

  const ops = useQuery({
    queryKey: ["warehouse-ops"],
    queryFn: () => fetchJson<WarehouseOpsResponse>("/api/warehouse/ops"),
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
    enabled: activeModuleKey !== "inventory",
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
  const activeModule = useMemo(() => {
    const found = WAREHOUSE_OPS_MODULES.find(
      (module) => module.key === activeModuleKey,
    );
    if (found) return found;
    // Never silently remap unknown keys to Recebimento.
    return (
      WAREHOUSE_OPS_MODULES.find((module) => module.key === initialModule) ??
      WAREHOUSE_OPS_MODULES[0]
    );
  }, [activeModuleKey, initialModule]);
  const taskEntries = useMemo(() => queueEntries(queues), [queues]);
  const actions = useWarehouseTaskActions({
    findEntry: (taskId) => taskEntries.find((entry) => entry.task.id === taskId),
  });
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
  const exceptionTaskEntry = actions.exception.entry ?? selectedTaskEntry;
  const selectedResolvedId = selectedTaskEntry?.task.id;
  const blockedEntries = taskEntries.filter(({ task }) => Boolean(task.blocked_reason));
  const activeBlockedEntries = moduleTaskEntries.filter(({ task }) =>
    Boolean(task.blocked_reason),
  );

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

  if (activeModule.key === "inventory") {
    return (
      <div className="flex flex-col gap-6">
        <div className="flex min-w-0 gap-3">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-border bg-card">
            <ClipboardCheck className="size-5 text-primary" />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-normal text-foreground">
              Inventário do estoque
            </h1>
          </div>
        </div>
        <CycleCountWorkspace />
      </div>
    );
  }

  const pageTitle = initialModule === "receiving" ? "Receber" : activeModule.label;

  if (ops.isLoading) return <WarehouseOpsLoading />;

  if (ops.error || !ops.data) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title={pageTitle} />

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
      <PageHeader
        title={pageTitle}
        actions={
          <>
            {blockedEntries.length > 0 ? (
              <Badge variant="destructive">{formatNumber(blockedEntries.length)} bloqueio(s)</Badge>
            ) : null}
            <Button type="button" variant="outline" onClick={() => ops.refetch()} disabled={ops.isFetching}>
              <RefreshCw data-icon="inline-start" className={cn(ops.isFetching && "animate-spin")} />
              Atualizar
            </Button>
          </>
        }
      />

      {activeModule.key === "returns" ? (
        <ReturnWorkspace />
      ) : activeModule.key === "exceptions" ? (
        <ExceptionWorkspace />
      ) : (
        <>
          {/* Só o que muda a próxima ação do turno: carga, urgência e
              bloqueio. Vazão de hoje é histórico; alertas IA têm dono
              (Agent Dute, onde existe a ação de resolver). */}
          <div className="grid gap-4 md:grid-cols-3">
            <MetricCard
              title="Pendências totais"
              value={formatNumber(metrics.pendingTotal)}
              icon={ClipboardCheck}
            />
            <MetricCard
              title="Prazo próximo"
              value={formatNumber(metrics.dueSoon)}
              icon={Clock3}
            />
            <MetricCard
              title="Críticos"
              value={formatNumber(metrics.critical)}
              icon={AlertTriangle}
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
              onAdvance={(taskId, operation, note) =>
                actions.advanceTask.mutate({ id: taskId, operation, note })
              }
              onLineConfirmationChange={handleLineConfirmationChange}
              onOpenException={actions.exception.openFor}
              advancingTaskId={actions.advancingTaskId}
              registeringExceptionId={actions.registeringExceptionId}
            />
          </div>
        </>
      )}

      <ExceptionDialog
        open={actions.exception.open}
        taskEntry={exceptionTaskEntry}
        note={actions.exception.note}
        isPending={actions.registerException.isPending}
        onOpenChange={actions.exception.onOpenChange}
        onNoteChange={actions.exception.setNote}
        onSubmit={(event) => actions.exception.submit(event, selectedTaskEntry)}
      />
    </div>
  );
}
