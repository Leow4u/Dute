/** Task detail panel and physical-flow section helpers. */

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
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
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { LEGACY_CUSTOMER_CODE } from "@/lib/active-customer";
import {
  positionsForGuard,
  resolveGuardDestination,
  guardQueryDestination,
  type GuardPosition,
} from "@/lib/warehouse-positions";
import { cn } from "@/lib/utils";
import {
  type AdvanceOperationPayload,
  type LineConfirmationMap,
  type LineResolution,
  type LineResolutionCounts,
  type NormalizedQueue,
  type OpsAlert,
  type PackingCheckRow,
  type TaskQueueEntry,
  type WarehouseTask,
  type WarehouseTaskItem,
  type WarehouseTaskTimelineEvent,
  LINE_RESOLUTION_COPY,
  QUEUE_OPERATOR_COPY,
  alertClass,
  buildLineExceptionNote,
  buildPackingOperation,
  buildPickingOperation,
  canAdvanceTask,
  canRegisterException,
  coerceNumber,
  coerceText,
  formatDate,
  formatDeltaUnits,
  formatNumber,
  fetchJson,
  formatUnits,
  getAdvanceGate,
  getLineResolution,
  getLineResolutionCounts,
  getPackingCheckRows,
  getPhysicalLineRows,
  getQueueAction,
  getTaskTitle,
  hasPhysicalIssue,
  inferLineResolution,
  isDueSoon,
  isTerminalTask,
  lineConfirmationKey,
  normalizeStatus,
  packageLabel,
  priorityClass,
  priorityLabel,
  statusClass,
  statusLabel,
  sumPackingQuantity,
  timelineDate,
  toQueueKey,
} from "@/lib/warehouse-ops/model";
import {
  linhasDivergentesDoRecebimento,
  pedeJustificativaDoRecebimento,
  problemaDaJustificativaDoRecebimento,
} from "@/lib/warehouse-ops/receiving";
import { ReceivingConferenceSection } from "@/features/warehouse-ops/receiving";

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
    <div className="rounded-md border border-border bg-card px-3 py-2">
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
              "flex min-h-9 items-center justify-center gap-1.5 rounded-md border px-2 text-xs font-medium transition-[background-color,border-color,color,box-shadow]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30",
              isActive
                ? `${copy.className}`
                : "border-border bg-card text-muted-foreground hover:bg-card",
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
        "@container rounded-md border border-border bg-card px-3 py-3",
        resolution === "confirmed" && "border-primary/20 bg-primary/5",
        hasIssue && "border-warning-soft-border bg-warning-soft/70",
        resolution === "damaged" && "border-destructive/20 bg-destructive/10",
      )}
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 @2xl:flex-row @2xl:items-start @2xl:justify-between">
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

          <div className="w-full @2xl:w-[280px]">
            <LineResolutionControls
              value={resolution}
              onChange={(nextResolution) =>
                onResolutionChange(row.id, nextResolution)
              }
            />
          </div>
        </div>

        <div className="grid gap-2 text-xs sm:grid-cols-3">
          <div className="rounded-md border border-border bg-card px-3 py-2">
            <div className="text-muted-foreground">Esperado</div>
            <div className="mt-1 font-medium text-foreground">
              {formatUnits(row.expectedQuantity)}
            </div>
          </div>
          <div className="rounded-md border border-border bg-card px-3 py-2">
            <div className="text-muted-foreground">Físico lido</div>
            <div className="mt-1 font-medium text-foreground">
              {formatUnits(row.packedQuantity)}
            </div>
          </div>
          <div className="rounded-md border border-border bg-card px-3 py-2">
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
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <ClipboardCheck className="size-3.5 text-primary" />
        {copy.title}
      </div>
      <p className="mt-2 text-sm leading-6 text-foreground">{copy.body}</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        {copy.steps.map((step, index) => (
          <div
            key={step}
            className="rounded-md border border-border bg-card px-3 py-2 text-xs leading-5 text-muted-foreground"
          >
            <span className="font-medium text-foreground">{index + 1}. </span>
            {step}
          </div>
        ))}
      </div>
      <div className="mt-3 rounded-md border border-primary/15 bg-primary/5 px-3 py-2 text-xs leading-5 text-muted-foreground">
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
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border bg-card">
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
        <div className="rounded-md border border-border bg-card px-3 py-2">
          <div className="text-xs text-muted-foreground">Linhas</div>
          <div className="mt-1 text-sm font-semibold text-foreground">
            {formatNumber(counts.total)}
          </div>
        </div>
        <div className="rounded-md border border-border bg-card px-3 py-2">
          <div className="text-xs text-muted-foreground">OK físico</div>
          <div className="mt-1 text-sm font-semibold text-primary">
            {formatNumber(counts.confirmed)}
          </div>
        </div>
        <div className="rounded-md border border-border bg-card px-3 py-2">
          <div className="text-xs text-muted-foreground">Falta</div>
          <div className="mt-1 text-sm font-semibold text-warning-soft-foreground">
            {formatNumber(counts.shortage)}
          </div>
        </div>
        <div className="rounded-md border border-border bg-card px-3 py-2">
          <div className="text-xs text-muted-foreground">Avaria</div>
          <div className="mt-1 text-sm font-semibold text-destructive">
            {formatNumber(counts.damaged)}
          </div>
        </div>
      </div>

      {hasIssue ? (
        <Alert className="mt-4 border-warning-soft-border bg-warning-soft text-warning-soft-foreground">
          <AlertTriangle className="size-4" />
          <AlertTitle>Segurar etapa antes de avançar</AlertTitle>
          <AlertDescription>
            Há falta ou avaria marcada na conferência local. Registre a exceção
            para anexar evidência operacional à IA.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="mt-4 flex flex-col gap-2">
        {rows.map((row) => (
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
          <div className="rounded-md border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
            + {formatNumber(rows.length - 8)} linha(s) no payload.
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function PutawayDetailSection({
  task,
  operation,
  query,
  positions,
  positionsStatus,
  customerCode,
  onOperationChange,
  onQueryChange,
}: {
  task: WarehouseTask;
  operation: AdvanceOperationPayload;
  /** O que está no campo; só volta ao destino na troca de tarefa. */
  query: string;
  positions: GuardPosition[];
  positionsStatus: "loading" | "error" | "ready";
  customerCode: string;
  onOperationChange: (operation: AdvanceOperationPayload) => void;
  onQueryChange: (query: string) => void;
}) {
  const firstItem = task.items?.[0];
  const quantity = coerceNumber(
    Number(
      operation.quantity ??
        task.quantity ??
        task.total_units ??
        firstItem?.quantity ??
        firstItem?.expected_quantity ??
        0,
    ),
  );
  const sourceLocation =
    coerceText(operation.source_location_id, task.source_location_id, firstItem?.source_location_id) ||
    "RECEBIMENTO";
  const destination = coerceText(operation.destination_location_id, operation.location_id);
  const shown = positionsForGuard(positions, query, customerCode);
  const choose = (code: string) => {
    const resolved = resolveGuardDestination(code, positions, customerCode);
    if (!("code" in resolved)) return;
    onOperationChange({
      ...operation,
      source_location_id: sourceLocation,
      destination_location_id: resolved.code,
      location_id: resolved.code,
      quantity: quantity || undefined,
    });
    onQueryChange(resolved.code);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="space-y-1.5">
        <Label htmlFor={`${task.id}-putaway-destination`}>Posição</Label>
        <Input
          id={`${task.id}-putaway-destination`}
          value={query}
          autoComplete="off"
          onChange={(event) => {
            const next = event.target.value;
            onQueryChange(next);
            const code = guardQueryDestination(next, positions, customerCode);
            onOperationChange({
              ...operation,
              source_location_id: sourceLocation,
              destination_location_id: code,
              location_id: code,
              quantity: quantity || undefined,
            });
          }}
          placeholder="Bipe ou busque a prateleira"
        />
      </div>
      {positionsStatus === "loading" ? (
        <p className="text-sm text-muted-foreground">Carregando posições.</p>
      ) : null}
      {positionsStatus === "error" ? (
        <p className="text-sm text-destructive">Não consegui consultar as posições.</p>
      ) : null}
      {positionsStatus === "ready" ? (
        <div className="max-h-48 overflow-y-auto rounded-lg border border-border bg-card">
          {shown.length ? (
            shown.map((position) => {
              const selected = position.code.toUpperCase() === destination.toUpperCase();
              const shelf = String(position.shelf ?? "").padStart(2, "0");
              return (
                <button
                  key={position.code}
                  type="button"
                  className={cn(
                    "flex w-full items-center gap-3 border-t border-border/60 px-3 py-2.5 text-left first:border-t-0",
                    selected && "bg-primary/10",
                  )}
                  onClick={() => choose(position.code)}
                >
                  <span
                    className={cn(
                      "flex size-4 shrink-0 items-center justify-center rounded-full border-2",
                      selected ? "border-primary" : "border-input",
                    )}
                    aria-hidden
                  >
                    {selected ? <span className="size-2 rounded-full bg-primary" /> : null}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-foreground">{position.code}</span>
                    {position.aisle ? (
                      <span className="block text-sm text-muted-foreground">
                        Rua {position.aisle} · prateleira {shelf}
                      </span>
                    ) : null}
                  </span>
                </button>
              );
            })
          ) : (
            <p className="px-3 py-3 text-sm text-muted-foreground">Nenhuma prateleira ativa com esse código.</p>
          )}
        </div>
      ) : null}
      <div className="space-y-1.5">
        <Label htmlFor={`${task.id}-putaway-qty`}>Quantidade</Label>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() =>
              onOperationChange({ ...operation, quantity: Math.max(1, quantity - 1) })
            }
          >
            −
          </Button>
          <span className="min-w-8 text-center text-sm font-semibold">{quantity || 0}</span>
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => onOperationChange({ ...operation, quantity: quantity + 1 })}
          >
            +
          </Button>
          <span className="text-sm text-muted-foreground">un.</span>
        </div>
      </div>
    </div>
  );
}

function PickingDetailSection({
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
  const rows = getPhysicalLineRows(task, "line");
  const counts = getLineResolutionCounts(task.id, rows, lineConfirmations);
  const totalExpected = rows.reduce(
    (sum, row) => sum + coerceNumber(row.expectedQuantity),
    0,
  );
  const uniqueLocations = Array.from(
    new Set(rows.map((row) => coerceText(row.location)).filter(Boolean)),
  );
  const canRegister = canRegisterException(task);
  const isRegistering = registeringExceptionId === task.id;
  const issueNote = buildLineExceptionNote(task, rows, lineConfirmations);
  const isReady =
    counts.total > 0 && counts.pending === 0 && !hasPhysicalIssue(counts);

  return (
    <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-md border border-primary/20 bg-card">
            <PackageSearch className="size-4 text-primary" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-foreground">
              Separação física do pedido
            </div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Confirme endereço e quantidade por linha antes de enviar para
              Packing. Falta ou avaria precisa virar exceção.
            </p>
          </div>
        </div>
        <Badge
          variant="outline"
          className={
            isReady
              ? "border-primary/20 bg-card text-primary"
              : "border-warning-soft-border bg-warning-soft text-warning-soft-foreground"
          }
        >
          {isReady ? "pronto para packing" : "conferir linhas"}
        </Badge>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-4">
        <div className="rounded-md border border-border bg-card px-3 py-2">
          <div className="text-xs text-muted-foreground">Linhas</div>
          <div className="mt-1 text-sm font-semibold text-foreground">
            {formatNumber(counts.confirmed)} / {formatNumber(counts.total)}
          </div>
        </div>
        <div className="rounded-md border border-border bg-card px-3 py-2">
          <div className="text-xs text-muted-foreground">Quantidade</div>
          <div className="mt-1 text-sm font-semibold text-foreground">
            {formatUnits(totalExpected)}
          </div>
        </div>
        <div className="rounded-md border border-border bg-card px-3 py-2">
          <div className="text-xs text-muted-foreground">Endereços</div>
          <div className="mt-1 text-sm font-semibold text-foreground">
            {formatNumber(uniqueLocations.length)}
          </div>
        </div>
        <div className="rounded-md border border-border bg-card px-3 py-2">
          <div className="text-xs text-muted-foreground">Divergências</div>
          <div
            className={cn(
              "mt-1 text-sm font-semibold",
              hasPhysicalIssue(counts) ? "text-destructive" : "text-foreground",
            )}
          >
            {formatNumber(counts.shortage + counts.damaged)}
          </div>
        </div>
      </div>

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
          Registrar falta/avaria da separação
        </Button>
      ) : (
        <Alert className="mt-4 border-primary/20 bg-primary/10">
          <CheckCircle2 className="size-4" />
          <AlertTitle>Separação sem exceção marcada</AlertTitle>
          <AlertDescription>
            Quando todas as linhas estiverem OK, o avanço cria o Packing do
            pedido e mantém as reservas vinculadas até a entrega.
          </AlertDescription>
        </Alert>
      )}

      <div className="mt-4 flex flex-col gap-2">
        {rows.map((row) => (
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

        {rows.length > 12 ? (
          <div className="rounded-md border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
            + {formatNumber(rows.length - 12)} linha(s) no pedido.
          </div>
        ) : null}
      </div>
    </div>
  );
}

function PackingDetailSection({
  task,
  operation,
  onOperationChange,
  lineConfirmations,
  registeringExceptionId,
  onLineConfirmationChange,
  onOpenException,
}: {
  task: WarehouseTask;
  operation: AdvanceOperationPayload;
  onOperationChange: (operation: AdvanceOperationPayload) => void;
  lineConfirmations: LineConfirmationMap;
  registeringExceptionId?: string;
  onLineConfirmationChange: (
    taskId: string,
    rowId: string,
    resolution: LineResolution,
  ) => void;
  onOpenException: (task: WarehouseTask, suggestedNote?: string) => void;
}) {
  const updateOperation = (patch: AdvanceOperationPayload) =>
    onOperationChange({ ...operation, ...patch });
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
    <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-md border border-primary/20 bg-card">
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
        <div className="rounded-md border border-border bg-card px-3 py-2">
          <div className="text-xs text-muted-foreground">Volumes</div>
          <div className="mt-1 text-sm font-semibold text-foreground">
            {formatNumber(rows.length)}
          </div>
        </div>
        <div className="rounded-md border border-border bg-card px-3 py-2">
          <div className="text-xs text-muted-foreground">OK físico</div>
          <div className="mt-1 text-sm font-semibold text-foreground">
            {formatNumber(counts.confirmed)} / {formatNumber(counts.total)}
          </div>
        </div>
        <div className="rounded-md border border-border bg-card px-3 py-2">
          <div className="text-xs text-muted-foreground">Status</div>
          <Badge variant="outline" className={cn("mt-1", statusClass(task.status))}>
            {statusLabel(task.status)}
          </Badge>
        </div>
        <div className="rounded-md border border-border bg-card px-3 py-2">
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
        <div className="rounded-md border border-border bg-card px-3 py-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <PackageOpen className="size-3.5 text-primary" />
            Físico lido
          </div>
          <div className="mt-1 text-sm font-medium text-foreground">
            {formatUnits(totalPacked)} / {formatUnits(totalExpected)}
          </div>
        </div>
        <div className="rounded-md border border-border bg-card px-3 py-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <ShieldAlert className="size-3.5 text-primary" />
            Lacre
          </div>
          <div className="mt-1 text-sm font-medium text-foreground">
            {isReadyToSeal ? "Pode lacrar" : "Manter volume aberto"}
          </div>
        </div>
        <div className="rounded-md border border-border bg-card px-3 py-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Truck className="size-3.5 text-primary" />
            Expedição
          </div>
          <div className="mt-1 text-sm font-medium text-foreground">
            {isReadyToSeal ? "Pronto para staging" : "Aguardando conferência"}
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-border bg-card p-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <ShieldAlert className="size-4 text-primary" />
          Dados do volume
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor={`${task.id}-volume-label`}>Volume</Label>
            <Input
              id={`${task.id}-volume-label`}
              value={coerceText(operation.volume_label)}
              onChange={(event) =>
                updateOperation({ volume_label: event.target.value })
              }
              placeholder="Volume 1"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${task.id}-seal-code`}>Lacre</Label>
            <Input
              id={`${task.id}-seal-code`}
              value={coerceText(operation.seal_code)}
              onChange={(event) =>
                updateOperation({ seal_code: event.target.value })
              }
              placeholder="Informe o lacre"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${task.id}-package-count`}>Qtd. volumes</Label>
            <Input
              id={`${task.id}-package-count`}
              type="number"
              min="1"
              value={String(coerceNumber(Number(operation.package_count ?? 1), 1) || 1)}
              onChange={(event) =>
                updateOperation({
                  package_count: Math.max(1, Number(event.target.value) || 1),
                })
              }
            />
          </div>
        </div>
        <div className="mt-3 space-y-1.5">
          <Label htmlFor={`${task.id}-package-notes`}>Observação</Label>
          <Input
            id={`${task.id}-package-notes`}
            value={coerceText(operation.package_notes)}
            onChange={(event) =>
              updateOperation({ package_notes: event.target.value })
            }
            placeholder="Ex.: conferido com Rafael, volume íntegro"
          />
        </div>
      </div>

      {hasDivergence ? (
        <Alert className="mt-4 border-warning-soft-border bg-warning-soft text-warning-soft-foreground">
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
        {rows.map((row) => (
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
          <div className="rounded-md border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
            + {formatNumber(rows.length - 8)} volume(s) no payload.
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ExpeditionReadinessSection({
  task,
  operation,
  onOperationChange,
  lineConfirmations,
  registeringExceptionId,
  onLineConfirmationChange,
  onOpenException,
}: {
  task: WarehouseTask;
  operation: AdvanceOperationPayload;
  onOperationChange: (operation: AdvanceOperationPayload) => void;
  lineConfirmations: LineConfirmationMap;
  registeringExceptionId?: string;
  onLineConfirmationChange: (
    taskId: string,
    rowId: string,
    resolution: LineResolution,
  ) => void;
  onOpenException: (task: WarehouseTask, suggestedNote?: string) => void;
}) {
  const updateOperation = (patch: AdvanceOperationPayload) =>
    onOperationChange({ ...operation, ...patch });
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
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border bg-card">
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
              : "border-warning-soft-border bg-warning-soft text-warning-soft-foreground"
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
              "rounded-md border px-3 py-2",
              step.done
                ? "border-primary/20 bg-primary/5"
                : "border-border bg-card",
            )}
          >
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {step.done ? (
                <CheckCircle2 className="size-3.5 text-primary" />
              ) : (
                <Clock3 className="size-3.5 text-warning-soft-foreground" />
              )}
              {step.label}
            </div>
            <div className="mt-1 text-sm font-medium text-foreground">
              {step.value}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 rounded-lg border border-border bg-card p-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Truck className="size-4 text-primary" />
          Dados da expedição
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor={`${task.id}-carrier`}>Coleta / responsável</Label>
            <Input
              id={`${task.id}-carrier`}
              value={coerceText(operation.carrier)}
              onChange={(event) =>
                updateOperation({ carrier: event.target.value })
              }
              placeholder="Dutelog"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${task.id}-driver`}>Motorista</Label>
            <Input
              id={`${task.id}-driver`}
              value={coerceText(operation.driver_name)}
              onChange={(event) =>
                updateOperation({ driver_name: event.target.value })
              }
              placeholder="Nome do motorista"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${task.id}-vehicle`}>Veículo</Label>
            <Input
              id={`${task.id}-vehicle`}
              value={coerceText(operation.vehicle_plate)}
              onChange={(event) =>
                updateOperation({ vehicle_plate: event.target.value })
              }
              placeholder="Placa ou identificação"
            />
          </div>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor={`${task.id}-proof`}>Comprovante</Label>
            <Input
              id={`${task.id}-proof`}
              value={coerceText(operation.proof_reference)}
              onChange={(event) =>
                updateOperation({ proof_reference: event.target.value })
              }
              placeholder="Canhoto, protocolo ou link"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${task.id}-delivery-notes`}>Observação</Label>
            <Input
              id={`${task.id}-delivery-notes`}
              value={coerceText(operation.delivery_notes)}
              onChange={(event) =>
                updateOperation({ delivery_notes: event.target.value })
              }
              placeholder="Ex.: entregue na loja BTG"
            />
          </div>
        </div>
      </div>

      {hasIssue ? (
        <Alert className="mt-4 border-warning-soft-border bg-warning-soft text-warning-soft-foreground">
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
        {rows.map((row) => (
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

/** Sinal IA da tarefa: o primeiro alerta dela ou da fila dela. */
function taskAiSignal(task: WarehouseTask, queue: NormalizedQueue, alerts: OpsAlert[]) {
  const primaryAlert = alerts.find(
    (alert) => alert.task_id === task.id || toQueueKey(alert.queue) === queue.key,
  );
  return { primaryAlert, value: primaryAlert?.title ?? "Sem alerta direto" };
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
  const latestTimelineEvent = [...(task.timeline ?? [])].sort((a, b) => {
    const timeA = timelineDate(a) ? new Date(timelineDate(a) ?? "").getTime() : 0;
    const timeB = timelineDate(b) ? new Date(timelineDate(b) ?? "").getTime() : 0;
    return timeB - timeA;
  })[0];
  const exceptions = coerceNumber(task.exception_count);
  const { primaryAlert, value: signalValue } = taskAiSignal(task, queue, alerts);
  const evidenceItems = [
    {
      label: "Sinal IA",
      value: signalValue,
      caption:
        primaryAlert?.action ||
        primaryAlert?.message ||
        "A fila segue monitorada por prioridade, SLA e exceções.",
      className: primaryAlert
        ? alertClass(primaryAlert.severity)
        : "border-border bg-card text-muted-foreground",
    },
    {
      label: "SLA físico",
      value: isDueSoon(task.due_at) ? "risco próximo" : "sem risco 4h",
      caption: `Prazo: ${formatDate(task.due_at)}`,
      className: isDueSoon(task.due_at)
        ? "border-warning-soft-border bg-warning-soft text-warning-soft-foreground"
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
          : "border-border bg-card text-muted-foreground",
    },
  ];

  return (
    <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <Sparkles className="size-3.5 text-primary" />
        Evidências da IA
      </div>
      <div className="mt-3 grid gap-2">
        {evidenceItems.map((item) => (
          <div
            key={item.label}
            className={cn("rounded-md border px-3 py-2", item.className)}
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
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <UserRound className="size-3.5 text-primary" />
        Visão cliente-operador
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <div className="rounded-md border border-border bg-card px-3 py-2">
          <div className="text-xs text-muted-foreground">Portal cliente</div>
          <div className="mt-1 text-sm font-semibold text-foreground">
            {visibleState}
          </div>
        </div>
        <div className="rounded-md border border-border bg-card px-3 py-2">
          <div className="text-xs text-muted-foreground">Fila física</div>
          <div className="mt-1 text-sm font-semibold text-foreground">
            {queue.label}
          </div>
        </div>
        <div className="rounded-md border border-border bg-card px-3 py-2">
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
      <div className="rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
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
            className="rounded-md border border-border bg-card px-3 py-2"
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
      <div className="rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
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
          <div className="min-w-0 flex-1 rounded-md border border-border bg-card px-3 py-2">
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


export function TaskDetailPanel({
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
  onAdvance: (
    id: string,
    operation?: AdvanceOperationPayload,
    note?: string,
  ) => void;
  onOpenException: (task: WarehouseTask, suggestedNote?: string) => void;
}) {
  const activeTask = entry?.task;
  const [packingOperation, setPackingOperation] =
    useState<AdvanceOperationPayload>({
      package_count: 1,
      volume_label: "Volume 1",
      seal_code: "",
      package_notes: "",
    });
  const [shippingOperation, setShippingOperation] =
    useState<AdvanceOperationPayload>({
      carrier: "Dutelog",
      driver_name: "",
      vehicle_plate: "",
      proof_reference: "",
      delivery_notes: "",
    });
  const [putawayOperation, setPutawayOperation] =
    useState<AdvanceOperationPayload>({
      source_location_id: "RECEBIMENTO",
      destination_location_id: "",
      location_id: "",
      quantity: undefined,
    });
  const [putawayQuery, setPutawayQuery] = useState("");
  const [receivingAdvanceNote, setReceivingAdvanceNote] = useState("");
  const [guardEvidenceOpen, setGuardEvidenceOpen] = useState(false);
  const isPutawayTask = entry?.queue.key === "putaway";
  const positionsQuery = useQuery({
    queryKey: ["warehouse-positions"],
    queryFn: () => fetchJson<{ items?: GuardPosition[] }>("/api/warehouse/positions?limit=2000"),
    enabled: isPutawayTask,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!activeTask) return;
    const firstItem = activeTask.items?.[0];
    setReceivingAdvanceNote("");
    setPackingOperation({
      package_count: coerceNumber(activeTask.package_count, 1) || 1,
      volume_label: coerceText(activeTask.volume_label) || "Volume 1",
      seal_code: coerceText(activeTask.seal_code),
      package_notes: coerceText(activeTask.package_notes),
    });
    setShippingOperation({
      carrier: coerceText(activeTask.carrier) || "Dutelog",
      driver_name: coerceText(activeTask.driver_name),
      vehicle_plate: coerceText(activeTask.vehicle_plate),
      proof_reference: coerceText(activeTask.proof_reference),
      delivery_notes: coerceText(activeTask.delivery_notes),
    });
    setGuardEvidenceOpen(false);
    setPutawayOperation({
      source_location_id:
        coerceText(activeTask.source_location_id, firstItem?.source_location_id) ||
        "RECEBIMENTO",
      destination_location_id: "",
      location_id: "",
      quantity:
        coerceNumber(
          activeTask.quantity ??
            activeTask.total_units ??
            firstItem?.quantity ??
            firstItem?.expected_quantity,
        ) || undefined,
    });
    // A busca recomeça com o destino (vazio) só na troca de tarefa; digitar e apagar mantém o que o operador escreveu.
    setPutawayQuery("");
  }, [activeTask?.id]);

  // Código bipado antes de as posições chegarem vale quando elas chegam.
  useEffect(() => {
    if (!isPutawayTask || !positionsQuery.data || !putawayQuery.trim()) return;
    const code = guardQueryDestination(
      putawayQuery,
      positionsQuery.data.items ?? [],
      coerceText(activeTask?.customer) || LEGACY_CUSTOMER_CODE,
    );
    if (!code) return;
    setPutawayOperation((current) =>
      coerceText(current.destination_location_id, current.location_id) === code
        ? current
        : { ...current, destination_location_id: code, location_id: code },
    );
  }, [positionsQuery.data]);

  if (!entry) {
    return (
      <Card className="min-w-0 xl:sticky xl:top-6">
        <CardContent className="pt-6">
          <Empty className="min-h-[420px] border border-border bg-card">
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
  const isReceiving = queue.key === "receiving";
  const isPutaway = queue.key === "putaway";
  const isPicking = queue.key === "picking";
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
  const advanceGate = getAdvanceGate(queue, task, lineCounts);
  const status = normalizeStatus(task.status);
  const receivingDivergenceRows = isReceiving ? linhasDivergentesDoRecebimento(task) : [];
  const requiresReceivingJustification = isReceiving && pedeJustificativaDoRecebimento(task);
  const pickingOperation = isPicking
    ? buildPickingOperation(task, lineConfirmations)
    : undefined;
  const packingAdvanceOperation = isPacking
    ? buildPackingOperation(task, lineConfirmations, packingOperation)
    : undefined;
  const operationForAdvance = isPacking
    ? packingAdvanceOperation
    : isPutaway
      ? putawayOperation
      : isPicking
        ? pickingOperation
        : isExpedition
          ? shippingOperation
          : undefined;
  const putawaySource =
    coerceText(putawayOperation.source_location_id) || "RECEBIMENTO";
  const putawayDestination = coerceText(
    putawayOperation.destination_location_id,
    putawayOperation.location_id,
  );
  const guardPositions = positionsQuery.data?.items ?? [];
  // Mesma regra do servidor: tarefa sem cliente é do legado.
  const guardCustomer = coerceText(task.customer) || LEGACY_CUSTOMER_CODE;
  const guardDestination = isPutaway
    ? resolveGuardDestination(putawayDestination, guardPositions, guardCustomer)
    : null;
  const putawayBlockReason = !isPutaway
    ? ""
    : positionsQuery.isLoading
      ? "Carregando posições."
      : positionsQuery.isError
        ? "Não consegui consultar as posições."
        : guardDestination && "problem" in guardDestination
          ? guardDestination.problem
          : putawaySource.toUpperCase() === putawayDestination.toUpperCase()
            ? "O endereço final precisa ser diferente da origem."
            : "";
  const operationBlockReason =
    isPacking && status === "in_progress" && !coerceText(packingOperation.seal_code)
      ? "Informe o lacre do volume antes de fechar o packing."
      : isPutaway
        ? putawayBlockReason
        : isExpedition &&
              status === "ready_to_dispatch" &&
              !coerceText(shippingOperation.carrier)
            ? "Informe o responsável pela coleta antes de confirmar a saída."
            : isExpedition &&
                status === "ready_to_dispatch" &&
                !coerceText(shippingOperation.driver_name)
              ? "Informe o motorista antes de confirmar a saída."
              : isExpedition &&
                  status === "ready_to_dispatch" &&
                  !coerceText(shippingOperation.vehicle_plate)
                ? "Informe a placa ou identificação do veículo antes de confirmar a saída."
            : isExpedition &&
                status === "dispatched" &&
                !coerceText(shippingOperation.proof_reference)
              ? "Informe o comprovante de entrega antes de encerrar o pedido."
              : isExpedition &&
                  status === "dispatched" &&
                  !coerceText(shippingOperation.delivery_notes)
                ? "Informe a observação de entrega antes de encerrar o pedido."
              : requiresReceivingJustification
                ? problemaDaJustificativaDoRecebimento(receivingAdvanceNote) ?? ""
                : "";
  const canSubmitAdvance = advanceGate.canAdvance && !operationBlockReason;
  const advanceNote = requiresReceivingJustification
    ? receivingAdvanceNote.trim()
    : undefined;
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
            {isPutaway ? (
              <CardDescription className="mt-2">
                {task.reference || task.id} ·{" "}
                {typeof task.quantity === "number" ? `${formatNumber(task.quantity)} un.` : "quantidade aberta"} · origem{" "}
                {putawaySource}
              </CardDescription>
            ) : null}
            {task.notes && !isPutaway ? (
              <CardDescription className="mt-2 line-clamp-2">
                {task.notes}
              </CardDescription>
            ) : null}
          </div>
          <div className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-border bg-card">
            <queue.icon className="size-5 text-primary" />
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-5 pt-5">
        {!isPutaway ? <div className="grid gap-3 sm:grid-cols-2">
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
        </div> : null}

        {!isPutaway && (task.customer || task.customer_request_id || exceptions > 0) ? (
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

        {isPutaway ? (
          <button
            type="button"
            className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2 text-left text-sm font-semibold text-foreground"
            aria-expanded={guardEvidenceOpen}
            onClick={() => setGuardEvidenceOpen((open) => !open)}
          >
            Evidências da IA
            <span className="min-w-0 truncate font-medium text-muted-foreground">
              {guardEvidenceOpen ? "recolher" : taskAiSignal(task, queue, alerts).value}
            </span>
          </button>
        ) : (
          <TaskAiEvidencePanel task={task} queue={queue} alerts={alerts} />
        )}
        {isPutaway && guardEvidenceOpen ? (
          <TaskAiEvidencePanel task={task} queue={queue} alerts={alerts} />
        ) : null}

        {!isPutaway ? <CustomerVisibilityPanel task={task} queue={queue} counts={lineCounts} /> : null}

        {!isPutaway ? <OperatorMicrocopy queue={queue} counts={lineCounts} /> : null}

        {!isPutaway && canAdvance && advanceGate.blockedReason ? (
          <Alert className="border-warning-soft-border bg-warning-soft text-warning-soft-foreground">
            <AlertTriangle className="size-4" />
            <AlertTitle>Conferência física pendente</AlertTitle>
            <AlertDescription>{advanceGate.blockedReason}</AlertDescription>
          </Alert>
        ) : null}

        {!isPutaway && canAdvance && !advanceGate.blockedReason && operationBlockReason ? (
          <Alert className="border-warning-soft-border bg-warning-soft text-warning-soft-foreground">
            <AlertTriangle className="size-4" />
            <AlertTitle>Dados operacionais pendentes</AlertTitle>
            <AlertDescription>{operationBlockReason}</AlertDescription>
          </Alert>
        ) : null}

        {requiresReceivingJustification ? (
          <div className="rounded-lg border border-warning-soft-border bg-warning-soft/55 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-sm font-semibold text-warning-soft-foreground">
                  Justificativa para concluir com divergência
                </div>
                <p className="mt-1 text-xs leading-5 text-warning-soft-foreground">
                  {receivingDivergenceRows.length} linha(s) têm falta ou sobra. Esta nota fica na trilha operacional antes de liberar saldo.
                </p>
              </div>
              <Badge variant="outline" className="border-warning-soft-border bg-card text-warning-soft-foreground">
                obrigatório
              </Badge>
            </div>
            <Textarea
              className="mt-3 min-h-20 bg-card"
              value={receivingAdvanceNote}
              onChange={(event) => setReceivingAdvanceNote(event.target.value)}
              placeholder="Ex.: NF entregue com falta física em 2 linhas; liberar estoque apenas da quantidade conferida e manter exceção para tratativa com fornecedor."
            />
          </div>
        ) : null}

        {isReceiving ? (
          <>
            <ReceivingConferenceSection task={task} />
            <PhysicalLineChecklist
              task={task}
              lineConfirmations={lineConfirmations}
              registeringExceptionId={registeringExceptionId}
              onLineConfirmationChange={onLineConfirmationChange}
              onOpenException={onOpenException}
            />
          </>
        ) : isPacking ? (
          <PackingDetailSection
            task={task}
            operation={packingOperation}
            onOperationChange={setPackingOperation}
            lineConfirmations={lineConfirmations}
            registeringExceptionId={registeringExceptionId}
            onLineConfirmationChange={onLineConfirmationChange}
            onOpenException={onOpenException}
          />
        ) : isPutaway ? (
          <PutawayDetailSection
            task={task}
            operation={putawayOperation}
            query={putawayQuery}
            positions={guardPositions}
            positionsStatus={positionsQuery.isLoading ? "loading" : positionsQuery.isError ? "error" : "ready"}
            customerCode={guardCustomer}
            onOperationChange={setPutawayOperation}
            onQueryChange={setPutawayQuery}
          />
        ) : isPicking ? (
          <PickingDetailSection
            task={task}
            lineConfirmations={lineConfirmations}
            registeringExceptionId={registeringExceptionId}
            onLineConfirmationChange={onLineConfirmationChange}
            onOpenException={onOpenException}
          />
        ) : isExpedition ? (
          <ExpeditionReadinessSection
            task={task}
            operation={shippingOperation}
            onOperationChange={setShippingOperation}
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

        {!isPutaway ? <div className="rounded-lg border border-border bg-card px-4 py-3">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <Route className="size-3.5 text-primary" />
            Próxima ação da fila
          </div>
          <p className="mt-2 text-sm leading-6 text-foreground">
            {task.next_action || getQueueAction(queue)}
          </p>
        </div> : null}

        {canAdvance || showGenericExceptionAction || !hasVisibleAction ? (
          <div
            className={cn(
              "flex flex-col gap-3 sm:flex-row",
              isPutaway &&
                "order-last sticky bottom-0 z-10 -mx-6 border-t border-border bg-card px-6 py-3 sm:flex-col lg:order-first lg:static lg:z-auto lg:mx-0 lg:border-0 lg:bg-transparent lg:px-0 lg:py-0",
            )}
          >
            {canAdvance ? (
              <Button
                type="button"
                size={isPutaway ? "lg" : "default"}
                className="w-full sm:flex-1"
                onClick={() => onAdvance(task.id, operationForAdvance, advanceNote)}
                disabled={advancingTaskId === task.id || !canSubmitAdvance}
              >
                {advancingTaskId === task.id ? (
                  <RefreshCw data-icon="inline-start" className="animate-spin" />
                ) : (
                  <PlayCircle data-icon="inline-start" />
                )}
                {advancingTaskId === task.id ? "Avançando" : advanceGate.label}
              </Button>
            ) : null}
            {isPutaway && canAdvance && !canSubmitAdvance && operationBlockReason ? (
              <p className="text-sm font-semibold text-warning-soft-foreground sm:basis-full">{operationBlockReason}</p>
            ) : null}
            {showGenericExceptionAction ? (
              <Button
                type="button"
                variant="outline"
                size={isPutaway ? "lg" : "default"}
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
              <div className="w-full rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
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

