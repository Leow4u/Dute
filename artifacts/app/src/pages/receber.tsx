import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { useToast } from "@/hooks/use-toast";
import { useIsDesktop } from "@/hooks/use-desktop";
import { useActiveCustomer } from "@/lib/active-customer-context";
import { cn } from "@/lib/utils";
import {
  type LineConfirmationMap,
  type OpsAlert,
  type TaskQueueEntry,
  type WarehouseOpsResponse,
  coerceText,
  fetchJson,
  getTaskTitle,
  lineConfirmationKey,
  normalizeQueues,
  queueEntries,
} from "@/lib/warehouse-ops/model";
import {
  buildReceivingBoard,
  isUnplannedReceipt,
  linkedShipmentNotice,
  type NoticeLinkChoice,
  noticeLinkChoice,
  openShipmentNotices,
  putawayRowMeta,
  receivingArrivalMeta,
  receivingRowMeta,
  type ShipmentNotice,
  unlinkedShipmentNotices,
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
  const { toast } = useToast();
  const { code: customerCode } = useActiveCustomer();
  const desktop = useIsDesktop();
  const [view, setView] = useState<"open" | "done">("open");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedNoticeId, setSelectedNoticeId] = useState<string | null>(null);
  const [unplannedOpen, setUnplannedOpen] = useState(false);
  const [lineConfirmations, setLineConfirmations] = useState<LineConfirmationMap>({});

  const ops = useQuery({
    queryKey: ["warehouse-ops"],
    queryFn: () => fetchJson<WarehouseOpsResponse>("/api/warehouse/ops"),
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
  });
  const requests = useQuery({
    queryKey: ["customer-requests", "receber", customerCode],
    queryFn: () =>
      fetchJson<{ items?: Array<Record<string, unknown>> }>(
        `/api/customer-requests?customer_code=${encodeURIComponent(customerCode)}&status=open&limit=200`,
      ),
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
  });
  const notices = useMemo(
    () => openShipmentNotices(requests.data?.items ?? []).filter((notice) => notice.customer_code === customerCode),
    [requests.data?.items, customerCode],
  );
  const noticeById = useMemo(() => new Map(notices.map((notice) => [notice.id, notice])), [notices]);
  const queues = useMemo(() => normalizeQueues(ops.data?.queues), [ops.data?.queues]);
  const alerts = useMemo(() => ops.data?.alerts ?? [], [ops.data?.alerts]);
  const entries = useMemo(() => queueEntries(queues), [queues]);
  const board = useMemo(() => buildReceivingBoard(queues), [queues]);
  const tasks = useMemo(() => entries.map((entry) => entry.task), [entries]);
  const pendingNotices = useMemo(() => unlinkedShipmentNotices(notices, tasks), [notices, tasks]);
  const actions = useWarehouseTaskActions({
    findEntry: (taskId) => entries.find((entry) => entry.task.id === taskId),
  });
  const selected = entries.find((entry) => entry.task.id === selectedId) ?? null;
  const selectedNotice = pendingNotices.find((notice) => notice.id === selectedNoticeId) ?? null;
  // Aviso da chegada selecionada que já saiu dos abertos (aprovado, recusado
  // ou cancelado): lido à parte para a ficha mostrar o vínculo.
  const selectedRequestId =
    selected?.queue.key === "receiving" && isUnplannedReceipt(selected.task)
      ? coerceText(selected.task.customer_request_id)
      : "";
  const linkedRequestId =
    requests.isSuccess && selectedRequestId && !noticeById.has(selectedRequestId) ? selectedRequestId : "";
  const linkedRequest = useQuery({
    queryKey: ["customer-requests", "receber", "vinculado", linkedRequestId],
    queryFn: () => fetchJson<Record<string, unknown>>(`/api/customer-requests/${encodeURIComponent(linkedRequestId)}`),
    enabled: Boolean(linkedRequestId),
    refetchOnWindowFocus: false,
  });
  const noticeChoice: NoticeLinkChoice | null =
    selected && requests.isSuccess
      ? noticeLinkChoice(
          selected.task,
          unlinkedShipmentNotices(notices, tasks, selected.task.customer_request_id),
          linkedRequest.data ? linkedShipmentNotice(linkedRequest.data) : linkedRequest.isError ? null : undefined,
          customerCode,
        )
      : null;
  const linkNotice = useMutation({
    mutationFn: (input: { receiptId: string; requestId: string | null }) =>
      fetchJson(`/api/warehouse/receipts/${encodeURIComponent(input.receiptId)}/notice`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ request_id: input.requestId, customer_code: customerCode }),
      }),
    onSuccess: (_result, input) => {
      void queryClient.invalidateQueries({ queryKey: ["warehouse-ops"] });
      void queryClient.invalidateQueries({ queryKey: ["customer-requests", "receber"] });
      toast({ title: input.requestId ? "Aviso vinculado à chegada" : "Aviso desvinculado da chegada" });
    },
    onError: (error: Error) => {
      toast({ title: "Não consegui vincular o aviso", description: error.message, variant: "destructive" });
    },
  });

  // Esc recolhe a ficha no desktop, como na lista de Estoque.
  useEffect(() => {
    if (!desktop || (!selectedId && !selectedNoticeId)) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedId(null);
        setSelectedNoticeId(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [desktop, selectedId, selectedNoticeId]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["warehouse-ops"] });
  };
  const openCount = pendingNotices.length + board.check.length + board.store.length;

  const panel = selectedNotice ? (
    <NoticeCard notice={selectedNotice} />
  ) : selected ? (
    <TaskPanel
      entry={selected}
      alerts={alerts}
      actions={actions}
      noticeChoice={noticeChoice}
      linking={linkNotice.isPending}
      onLinkNotice={
        noticeChoice?.editable
          ? (requestId) => linkNotice.mutate({ receiptId: selected.task.id, requestId })
          : undefined
      }
      lineConfirmations={lineConfirmations}
      onLineConfirmationChange={(taskId, rowId, resolution) =>
        setLineConfirmations((current) => ({
          ...current,
          [lineConfirmationKey(taskId, rowId)]: resolution,
        }))
      }
    />
  ) : null;

  const selectEntry = (entry: TaskQueueEntry) => {
    setSelectedNoticeId(null);
    setSelectedId(entry.task.id);
  };

  const rowAction = (entry: TaskQueueEntry, label: string) => (
    <Button
      type="button"
      variant={selected?.task.id === entry.task.id ? "secondary" : "default"}
      onClick={() => selectEntry(entry)}
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
              onChange={(next) => {
                setView(next);
                setSelectedNoticeId(null);
              }}
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
            desktop && (selected || selectedNotice) && "lg:grid-cols-[minmax(0,1fr)_480px]",
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
                        onClick={() => selectEntry(entry)}
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
                  count={pendingNotices.length + board.check.length}
                  empty="Nenhuma chegada esperando conferência. Registre uma chegada avulsa ou aguarde o aviso do portal."
                >
                  {pendingNotices.map((notice) => (
                    <QueueRow
                      key={notice.id}
                      icon={Inbox}
                      tone="check"
                      title={[notice.number, notice.supplier].filter(Boolean).join(" · ") || "Aviso de envio"}
                      meta={[notice.invoice ? `NF ${notice.invoice}` : null, notice.units ? `${notice.units} un.` : null]
                        .filter(Boolean)
                        .join(" · ")}
                      note={
                        <span className="text-warning-soft-foreground">Aguardando aprovação da coordenação</span>
                      }
                      className={cn(selectedNoticeId === notice.id && "bg-muted/60")}
                      actions={
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => {
                            setSelectedId(null);
                            setSelectedNoticeId(notice.id);
                          }}
                        >
                          Ver
                        </Button>
                      }
                    />
                  ))}
                  {board.check.map((entry) => (
                    <QueueRow
                      key={entry.task.id}
                      icon={Inbox}
                      tone="check"
                      title={getTaskTitle(entry.task)}
                      meta={receivingArrivalMeta(entry.task, noticeById.get(entry.task.customer_request_id ?? "") ?? null)}
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

          {desktop && (selected || selectedNotice) ? (
            <aside className="min-w-0 lg:sticky lg:top-0 lg:max-h-[calc(100dvh-160px)] lg:overflow-y-auto">
              <div className="mb-2 flex justify-end">
                <Button type="button" variant="ghost" size="sm" onClick={() => { setSelectedId(null); setSelectedNoticeId(null); }} title="Recolher (Esc)">
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
        <Sheet open={Boolean(selected || selectedNotice)} onOpenChange={(open) => { if (!open) { setSelectedId(null); setSelectedNoticeId(null); } }}>
          <SheetContent side="bottom" className="max-h-[88dvh] overflow-y-auto rounded-t-lg bg-card p-0">
            <SheetHeader className="sr-only">
              <SheetTitle>{selected ? getTaskTitle(selected.task) : selectedNotice?.number || "Aviso"}</SheetTitle>
              <SheetDescription>Ficha da chegada selecionada.</SheetDescription>
            </SheetHeader>
            {panel}
          </SheetContent>
        </Sheet>
      ) : null}

      <UnplannedReceiptDialog
        open={unplannedOpen}
        isPending={actions.createUnplannedReceipt.isPending}
        onOpenChange={setUnplannedOpen}
        onCreate={(payload) => {
          actions.createUnplannedReceipt.mutate(payload);
          setUnplannedOpen(false);
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

function NoticeCard({ notice }: { notice: ShipmentNotice }) {
  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="text-sm font-semibold text-primary">Aviso de envio</div>
      <h2 className="mt-2 text-lg font-semibold">{[notice.number, notice.supplier].filter(Boolean).join(" · ")}</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {[notice.invoice ? `NF ${notice.invoice}` : null, notice.units ? `${notice.units} un.` : null]
          .filter(Boolean)
          .join(" · ")}
      </p>
      <p className="mt-4 text-sm font-semibold text-warning-soft-foreground">Aguardando aprovação da coordenação</p>
    </div>
  );
}

function TaskPanel({
  entry,
  alerts,
  actions,
  noticeChoice,
  linking,
  onLinkNotice,
  lineConfirmations,
  onLineConfirmationChange,
}: {
  entry: TaskQueueEntry;
  alerts: OpsAlert[];
  actions: ReturnType<typeof useWarehouseTaskActions>;
  noticeChoice: NoticeLinkChoice | null;
  linking: boolean;
  onLinkNotice?: (requestId: string | null) => void;
  lineConfirmations: LineConfirmationMap;
  onLineConfirmationChange: Parameters<typeof TaskDetailPanel>[0]["onLineConfirmationChange"];
}) {
  if (entry.queue.key === "receiving") {
    return (
      <ReceivingTaskDetailCard
        entry={entry}
        alerts={alerts}
        noticeChoice={noticeChoice}
        linking={linking}
        advancingTaskId={actions.advancingTaskId}
        registeringExceptionId={actions.registeringExceptionId}
        onAdvance={(id) => actions.advanceTask.mutate({ id })}
        onOpenException={actions.exception.openFor}
        onLinkNotice={onLinkNotice}
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
