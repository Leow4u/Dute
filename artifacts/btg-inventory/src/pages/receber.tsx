import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Forklift, Inbox, PackageOpen, RefreshCw, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { QueueGroup, QueueRow } from "@/components/ui/queue-list";
import { Segmented } from "@/components/ui/segmented";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ReceivingTaskDetailCard, UnplannedReceiptDialog } from "@/features/warehouse-ops/receiving";
import { ExceptionDialog, useWarehouseTaskActions } from "@/features/warehouse-ops/task-actions";
import { TaskDetailPanel } from "@/features/warehouse-ops/task-detail";
import { useIsDesktop } from "@/hooks/use-desktop";
import { cn } from "@/lib/utils";
import {
  type LineConfirmationMap,
  type OpsAlert,
  type TaskQueueEntry,
  type WarehouseOpsResponse,
  fetchJson,
  getTaskTitle,
  lineConfirmationKey,
  normalizeQueues,
  queueEntries,
} from "@/lib/warehouse-ops/model";
import {
  buildReceivingBoard,
  putawayRowMeta,
  receivingRowMeta,
} from "@/lib/warehouse-ops/receiving";
import { formatRequestAge } from "./customer-requests";

/**
 * Receber no padrão de Pedidos: uma lista em grupos (Para conferir, Para
 * guardar, Recebidos) e a ficha da chegada ao lado (no celular, um sheet).
 * Conferir e concluir a entrada continuam nas mesmas chamadas de sempre;
 * guardar é a tarefa de putaway que antes vivia numa tela própria.
 */
export default function Receber() {
  const queryClient = useQueryClient();
  const desktop = useIsDesktop();
  const [view, setView] = useState<"open" | "done">("open");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [unplannedOpen, setUnplannedOpen] = useState(false);
  // Cada chegada criada zera o formulário: a nota anexada numa não vai para a próxima.
  const [unplannedKey, setUnplannedKey] = useState(0);
  const [lineConfirmations, setLineConfirmations] = useState<LineConfirmationMap>({});

  const ops = useQuery({
    queryKey: ["warehouse-ops"],
    queryFn: () => fetchJson<WarehouseOpsResponse>("/api/warehouse/ops"),
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
  });
  const queues = useMemo(() => normalizeQueues(ops.data?.queues), [ops.data?.queues]);
  const alerts = useMemo(() => ops.data?.alerts ?? [], [ops.data?.alerts]);
  const entries = useMemo(() => queueEntries(queues), [queues]);
  const board = useMemo(() => buildReceivingBoard(queues), [queues]);
  const actions = useWarehouseTaskActions({
    findEntry: (taskId) => entries.find((entry) => entry.task.id === taskId),
  });
  const selected = entries.find((entry) => entry.task.id === selectedId) ?? null;

  // Esc recolhe a ficha no desktop, como na lista de Estoque.
  useEffect(() => {
    if (!desktop || !selectedId) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [desktop, selectedId]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["warehouse-ops"] });
  };
  const openCount = board.check.length + board.store.length;

  const panel = selected ? (
    <TaskPanel
      entry={selected}
      alerts={alerts}
      actions={actions}
      lineConfirmations={lineConfirmations}
      onLineConfirmationChange={(taskId, rowId, resolution) =>
        setLineConfirmations((current) => ({
          ...current,
          [lineConfirmationKey(taskId, rowId)]: resolution,
        }))
      }
    />
  ) : null;

  const rowAction = (entry: TaskQueueEntry, label: string) => (
    <Button
      type="button"
      variant={selected?.task.id === entry.task.id ? "secondary" : "default"}
      onClick={() => setSelectedId(entry.task.id)}
    >
      {label}
    </Button>
  );

  const blockedNote = (entry: TaskQueueEntry) =>
    entry.task.blocked_reason ? (
      <span className="flex items-center gap-1.5 text-destructive-soft-foreground">
        <AlertTriangle className="size-3.5" />
        {entry.task.blocked_reason}
      </span>
    ) : undefined;

  return (
    <div className="flex flex-col gap-6 pb-24">
      <PageHeader
        title="Receber"
        actions={
          <>
            <Segmented<"open" | "done">
              value={view}
              onChange={setView}
              aria-label="Chegadas em aberto ou recebidas"
              options={[
                { value: "open", label: `Em aberto${openCount ? ` · ${openCount}` : ""}` },
                { value: "done", label: "Recebidos" },
              ]}
            />
            <Button type="button" onClick={() => setUnplannedOpen(true)}>
              <PackageOpen className="size-4" />
              Chegada avulsa
            </Button>
            <Button type="button" variant="outline" size="icon" onClick={refresh} disabled={ops.isFetching}>
              <RefreshCw className={cn("size-4", ops.isFetching && "animate-spin")} />
              <span className="sr-only">Atualizar</span>
            </Button>
          </>
        }
      />

      {ops.isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando chegadas...</p>
      ) : ops.error ? (
        <p className="text-sm text-destructive">
          Não consegui carregar as chegadas.{" "}
          <button type="button" className="font-medium underline" onClick={() => ops.refetch()}>
            Tentar de novo
          </button>
        </p>
      ) : (
        <div
          className={cn(
            "grid grid-cols-1 gap-4",
            desktop && selected && "lg:grid-cols-[minmax(0,1fr)_480px]",
          )}
        >
          <div className="flex min-w-0 flex-col gap-6">
            {view === "done" ? (
              <QueueGroup
                title="Recebidos"
                hint="recentes"
                count={board.done.length}
                empty="Nenhuma chegada concluída ainda."
              >
                {board.done.map((entry) => (
                  <QueueRow
                    key={`${entry.queue.key}:${entry.task.id}`}
                    icon={Check}
                    tone="done"
                    title={getTaskTitle(entry.task)}
                    meta={
                      entry.queue.key === "receiving"
                        ? receivingRowMeta(entry.task)
                        : putawayRowMeta(entry.task)
                    }
                    className={cn(selected?.task.id === entry.task.id && "bg-muted/60")}
                    actions={
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setSelectedId(entry.task.id)}
                      >
                        Ver
                      </Button>
                    }
                  />
                ))}
              </QueueGroup>
            ) : (
              <>
                <QueueGroup
                  title="Para conferir"
                  hint="chegadas"
                  count={board.check.length}
                  empty="Nenhuma chegada esperando conferência. Registre uma chegada avulsa ou aguarde o aviso do portal."
                >
                  {board.check.map((entry) => (
                    <QueueRow
                      key={entry.task.id}
                      icon={Inbox}
                      tone="check"
                      title={getTaskTitle(entry.task)}
                      meta={receivingRowMeta(entry.task)}
                      age={formatRequestAge(entry.task.created_at)}
                      note={blockedNote(entry)}
                      className={cn(
                        entry.task.blocked_reason && "bg-destructive-soft/40",
                        selected?.task.id === entry.task.id && "bg-muted/60",
                      )}
                      actions={rowAction(entry, "Conferir")}
                    />
                  ))}
                </QueueGroup>

                <QueueGroup
                  title="Para guardar"
                  hint="endereçar"
                  count={board.store.length}
                  empty="Nada esperando guarda. O que foi conferido já está no endereço."
                >
                  {board.store.map((entry) => (
                    <QueueRow
                      key={entry.task.id}
                      icon={Forklift}
                      tone="store"
                      title={getTaskTitle(entry.task)}
                      meta={putawayRowMeta(entry.task)}
                      age={formatRequestAge(entry.task.created_at)}
                      note={blockedNote(entry)}
                      className={cn(
                        entry.task.blocked_reason && "bg-destructive-soft/40",
                        selected?.task.id === entry.task.id && "bg-muted/60",
                      )}
                      actions={rowAction(entry, "Guardar")}
                    />
                  ))}
                </QueueGroup>
              </>
            )}
          </div>

          {desktop && selected ? (
            <aside className="min-w-0 lg:sticky lg:top-0 lg:max-h-[calc(100dvh-160px)] lg:overflow-y-auto">
              <div className="mb-2 flex justify-end">
                <Button type="button" variant="ghost" size="sm" onClick={() => setSelectedId(null)} title="Recolher (Esc)">
                  <X className="size-4" />
                  Fechar
                </Button>
              </div>
              {panel}
            </aside>
          ) : null}
        </div>
      )}

      {!desktop ? (
        <Sheet open={Boolean(selected)} onOpenChange={(open) => !open && setSelectedId(null)}>
          <SheetContent side="bottom" className="max-h-[88dvh] overflow-y-auto rounded-t-lg bg-card p-0">
            <SheetHeader className="sr-only">
              <SheetTitle>{selected ? getTaskTitle(selected.task) : "Chegada"}</SheetTitle>
              <SheetDescription>Ficha da chegada selecionada.</SheetDescription>
            </SheetHeader>
            {panel}
          </SheetContent>
        </Sheet>
      ) : null}

      <UnplannedReceiptDialog
        key={unplannedKey}
        open={unplannedOpen}
        isPending={actions.createUnplannedReceipt.isPending}
        onOpenChange={setUnplannedOpen}
        onCreate={(payload) => {
          actions.createUnplannedReceipt.mutate(payload);
          setUnplannedOpen(false);
          setUnplannedKey((current) => current + 1);
        }}
      />

      <ExceptionDialog
        open={actions.exception.open}
        taskEntry={actions.exception.entry ?? selected ?? undefined}
        note={actions.exception.note}
        isPending={actions.registerException.isPending}
        onOpenChange={actions.exception.onOpenChange}
        onNoteChange={actions.exception.setNote}
        onSubmit={(event) => actions.exception.submit(event, selected ?? undefined)}
      />
    </div>
  );
}

function TaskPanel({
  entry,
  alerts,
  actions,
  lineConfirmations,
  onLineConfirmationChange,
}: {
  entry: TaskQueueEntry;
  alerts: OpsAlert[];
  actions: ReturnType<typeof useWarehouseTaskActions>;
  lineConfirmations: LineConfirmationMap;
  onLineConfirmationChange: Parameters<typeof TaskDetailPanel>[0]["onLineConfirmationChange"];
}) {
  if (entry.queue.key === "receiving") {
    return (
      <ReceivingTaskDetailCard
        entry={entry}
        alerts={alerts}
        advancingTaskId={actions.advancingTaskId}
        registeringExceptionId={actions.registeringExceptionId}
        onAdvance={(id) => actions.advanceTask.mutate({ id })}
        onOpenException={actions.exception.openFor}
      />
    );
  }
  return (
    <TaskDetailPanel
      entry={entry}
      alerts={alerts}
      lineConfirmations={lineConfirmations}
      advancingTaskId={actions.advancingTaskId}
      registeringExceptionId={actions.registeringExceptionId}
      onLineConfirmationChange={onLineConfirmationChange}
      onAdvance={(id, operation, note) => actions.advanceTask.mutate({ id, operation, note })}
      onOpenException={actions.exception.openFor}
    />
  );
}
