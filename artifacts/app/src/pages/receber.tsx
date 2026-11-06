import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Ban, Check, Forklift, Inbox, PackageOpen, RefreshCw, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
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
import { FichaDaChegadaPorCaixa } from "@/features/warehouse-ops/chegada-por-caixa";
import { CancelarRecebimentoDialog } from "@/features/warehouse-ops/cancelar-recebimento";
import { podeCancelarRecebimento } from "@/lib/wms/cancelar-recebimento";
import { GuardaDaCaixa } from "@/features/warehouse-ops/guarda-da-caixa";
import { ReceivingTaskDetailCard, UnplannedReceiptDialog } from "@/features/warehouse-ops/receiving";
import { ExceptionDialog, useWarehouseTaskActions } from "@/features/warehouse-ops/task-actions";
import { TaskDetailPanel } from "@/features/warehouse-ops/task-detail";
import { useToast } from "@/hooks/use-toast";
import { useIsDesktop } from "@/hooks/use-desktop";
import { useActiveCustomer } from "@/lib/active-customer-context";
import { caixasGuardadas, chegadaPorCaixa } from "@/lib/wms/caixas-do-recebimento";
import { useAppUser } from "@/lib/auth";
import { canOperateWarehouse } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { generatedSkuNote } from "@/lib/product-match";
import {
  type LineConfirmationMap,
  type OpsAlert,
  type TaskQueueEntry,
  type WarehouseOpsResponse,
  type WarehouseTask,
  formatDate,
  coerceText,
  fetchJson,
  getTaskTitle,
  getErrorMessage,
  lineConfirmationKey,
  normalizeQueues,
  queueEntries,
  somenteConsulta,
} from "@/lib/warehouse-ops/model";
import {
  buildReceivingBoard,
  guardaSemPrateleira,
  guardandoRowMeta,
  isUnplannedReceipt,
  isCancelledReceipt,
  linkedShipmentNotice,
  type NoticeLinkChoice,
  noticeLinkChoice,
  openShipmentNotices,
  putawayRowMeta,
  receivingArrivalMeta,
  receivingRowMeta,
  type ShipmentNotice,
  tarefaPrincipal,
  tituloDaGuarda,
  unlinkedShipmentNotices,
} from "@/lib/warehouse-ops/receiving";
import { formatRequestAge } from "./customer-requests";

/**
 * Receber: fila em grupos e bancada inteira para a conferência por caixa.
 * Avisos, chegadas por linha e guardas usam a ficha lateral ou o sheet.
 * Conferir e concluir a entrada continuam nas mesmas chamadas de sempre;
 * guardar é a tarefa de putaway que antes vivia numa tela própria.
 */
export default function Receber() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { code: customerCode } = useActiveCustomer();
  // O suporte consulta: sem chegada avulsa, sem conferir, concluir ou guardar.
  const { user } = useAppUser();
  const operador = canOperateWarehouse(user?.publicMetadata.role);
  const desktop = useIsDesktop();
  const [view, setView] = useState<"open" | "done" | "cancelled">("open");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedNoticeId, setSelectedNoticeId] = useState<string | null>(null);
  const [unplannedOpen, setUnplannedOpen] = useState(false);
  const [cancelTask, setCancelTask] = useState<WarehouseTask | null>(null);
  const [lineConfirmations, setLineConfirmations] = useState<LineConfirmationMap>({});
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const activeCustomerSession = useRef({ customerCode });
  if (activeCustomerSession.current.customerCode !== customerCode) {
    activeCustomerSession.current = { customerCode };
  }
  const originReceiptId = useRef<string | null>(null);
  const restoreFocus = useRef(false);
  useEffect(() => {
    setSelectedId(null);
    setSelectedNoticeId(null);
    setCancelTask(null);
    setUnplannedOpen(false);
    setLineConfirmations({});
    setView("open");
  }, [customerCode]);
  useEffect(() => {
    if (!selectedId && restoreFocus.current) {
      restoreFocus.current = false;
      Array.from(document.querySelectorAll<HTMLElement>("[data-receipt-id]")).find((button) => button.dataset.receiptId === originReceiptId.current)?.focus();
    }
  }, [selectedId]);
  const backToQueue = () => {
    restoreFocus.current = true;
    setSelectedId(null);
    setSelectedNoticeId(null);
  };

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
  // A conferência ocupa a bancada inteira em qualquer tamanho de tela.
  const fichaLarga = Boolean(!selectedNotice && selected && selected.queue.key === "receiving" && chegadaPorCaixa(selected.task));
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
    if (!desktop || fichaLarga || (!selectedId && !selectedNoticeId)) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented && !document.querySelector("[role=dialog]")) {
        setSelectedId(null);
        setSelectedNoticeId(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [desktop, fichaLarga, selectedId, selectedNoticeId]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["warehouse-ops"] });
  };
  const openCount = pendingNotices.length + board.check.length + board.guardando.length + board.store.length;

  const taskPanel = selectedNotice ? (
    <NoticeCard notice={selectedNotice} />
  ) : selected ? (
    <TaskPanel
      entry={operador && !isCancelledReceipt(selected.task) ? selected : somenteConsulta(selected)}
      onBack={backToQueue}
      alerts={alerts}
      actions={actions}
      noticeChoice={noticeChoice}
      linking={linkNotice.isPending}
      onLinkNotice={
        operador && noticeChoice?.editable
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
    originReceiptId.current = entry.task.id;
    setSelectedNoticeId(null);
    setSelectedId(entry.task.id);
  };

  const panel = selected ? (
    <div className="space-y-4">
      {operador && selected.queue.key === "receiving" && podeCancelarRecebimento(selected.task) ? (
        <div className="flex justify-end"><Button type="button" variant="outline" onClick={() => setCancelTask(selected.task)}>Cancelar recebimento</Button></div>
      ) : null}
      {isCancelledReceipt(selected.task) ? <CancelledReceiptHistory task={selected.task} onOpenOriginal={(id) => {
        const original = entries.find((entry) => entry.queue.key === "receiving" && (entry.task.id === id || entry.task.reference === id));
        if (original) selectEntry(original);
      }} hasOriginal={entries.some((entry) => entry.task.id === selected.task.duplicate_of_receipt_id || entry.task.reference === selected.task.duplicate_of_receipt_id)} /> : null}
      {taskPanel}
    </div>
  ) : taskPanel;

  // Na v3, só a primeira tarefa da fila tem a ação principal; as outras são secundárias.
  const principal = tarefaPrincipal(board);
  const rowAction = (entry: TaskQueueEntry, label: string) => (
    <>
    <Button
      type="button"
      variant={selected?.task.id === entry.task.id ? "secondary" : principal === entry.task.id ? "default" : "outline"}
      onClick={() => selectEntry(entry)}
      data-receipt-id={entry.task.id}
    >
      {operador ? label : "Ver"}
    </Button>
    {operador && entry.queue.key === "receiving" && podeCancelarRecebimento(entry.task) ? (
      <Button type="button" variant="outline" onClick={() => setCancelTask(entry.task)}>Cancelar recebimento</Button>
    ) : null}
    </>
  );

  // Recebidos, em dois grupos: a chegada e a guarda da caixa dela encerram
  // juntas e, numa lista só, pareciam o mesmo registro repetido.
  const rowDone = (entry: TaskQueueEntry, meta: string) => (
    <QueueRow
      key={entry.task.id}
      icon={Check}
      tone="done"
      title={getTaskTitle(entry.task)}
      meta={meta}
      className={cn(selected?.task.id === entry.task.id && "bg-muted/60")}
      actions={
        <Button type="button" variant="outline" data-receipt-id={entry.task.id} onClick={() => selectEntry(entry)}>
          Ver
        </Button>
      }
    />
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
      {!fichaLarga ? <PageHeader
        title="Receber"
        actions={
          <>
            <Segmented<"open" | "done" | "cancelled">
              value={view}
              onChange={(next) => {
                setView(next);
                setSelectedId(null);
                setSelectedNoticeId(null);
              }}
              aria-label="Situação das chegadas"
              options={[
                { value: "open", label: `Em aberto${openCount ? ` · ${openCount}` : ""}` },
                { value: "done", label: "Recebidos" },
                { value: "cancelled", label: "Cancelados" },
              ]}
            />
            {operador ? (
              <Button type="button" variant="outline" onClick={() => setUnplannedOpen(true)}>
                <PackageOpen className="size-4" />
                Chegada avulsa
              </Button>
            ) : null}
            <Button type="button" variant="outline" size="icon" onClick={refresh} disabled={ops.isFetching}>
              <RefreshCw className={cn("size-4", ops.isFetching && "animate-spin")} />
              <span className="sr-only">Atualizar</span>
            </Button>
          </>
        }
      /> : null}

      {fichaLarga ? <section aria-label="Bancada de conferência" className="min-w-0">{panel}</section> : ops.isLoading ? (
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
            {view !== "open" ? <p className="text-sm text-muted-foreground">Até 12 registros recentes por fila</p> : null}
            {view === "cancelled" ? (
              <QueueGroup title="Cancelados" count={board.cancelled.length} empty="Nenhum recebimento cancelado.">
                {board.cancelled.map((entry) => (
                  <QueueRow key={entry.task.id} icon={Ban} tone="done" title={getTaskTitle(entry.task)}
                    meta={entry.queue.key === "receiving" ? receivingRowMeta(entry.task) : putawayRowMeta(entry.task)}
                    note={entry.task.duplicate_of_receipt_number ? `Original: ${entry.task.duplicate_of_receipt_number}` : undefined}
                    actions={<Button type="button" variant="outline" data-receipt-id={entry.task.id} onClick={() => selectEntry(entry)}>Ver</Button>} />
                ))}
              </QueueGroup>
            ) : view === "done" ? (
              <>
                <QueueGroup title="Chegadas" count={board.chegadas.length} empty="Nenhuma chegada recebida.">
                  {board.chegadas.map((entry) => rowDone(entry, receivingRowMeta(entry.task)))}
                </QueueGroup>
                <QueueGroup title="Guardas" count={board.guardas.length} empty="Nenhuma guarda concluída.">
                  {board.guardas.map((entry) => rowDone(entry, putawayRowMeta(entry.task)))}
                </QueueGroup>
              </>
            ) : (
              <>
                <QueueGroup
                  title="Para conferir"
                  count={pendingNotices.length + board.check.length}
                  empty="Nenhuma chegada para conferir."
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

                {board.guardando.length ? (
                  <QueueGroup title="Recebidas, por guardar" count={board.guardando.length} empty={null}>
                    {board.guardando.map((entry) => (
                      <QueueRow
                        key={entry.task.id}
                        icon={Inbox}
                        tone="check"
                        title={getTaskTitle(entry.task)}
                        badge={
                          <Badge variant="outline" className="border-warning-soft-border bg-warning-soft text-warning-soft-foreground">
                            {caixasGuardadas(entry.task)}
                          </Badge>
                        }
                        meta={guardandoRowMeta(entry.task)}
                        className={cn(selected?.task.id === entry.task.id && "bg-muted/60")}
                        actions={
                          <Button type="button" variant="outline" data-receipt-id={entry.task.id} onClick={() => selectEntry(entry)}>
                            Ver
                          </Button>
                        }
                      />
                    ))}
                  </QueueGroup>
                ) : null}

                <QueueGroup
                  title="Para guardar"
                  count={board.store.length}
                  empty="Nada para guardar."
                >
                  {board.store.map((entry) => (
                    <QueueRow
                      key={entry.task.id}
                      icon={Forklift}
                      tone="store"
                      title={tituloDaGuarda(entry.task) ?? getTaskTitle(entry.task)}
                      badge={
                        guardaSemPrateleira(entry.task) ? (
                          <Badge variant="outline" className="border-warning-soft-border bg-warning-soft text-warning-soft-foreground">
                            sem prateleira
                          </Badge>
                        ) : undefined
                      }
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

      {!desktop && !fichaLarga ? (
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
        key={customerCode}
        open={unplannedOpen}
        isPending={actions.createUnplannedReceipt.isPending}
        onOpenChange={setUnplannedOpen}
        receipts={entries.filter((entry) => entry.queue.key === "receiving").map((entry) => entry.task)}
        onOpenReceipt={(task) => { const entry = entries.find((entry) => entry.task.id === task.id); if (entry) selectEntry(entry); }}
        onCreate={async (payload) => {
          const session = activeCustomerSession.current;
          try {
            const result = await actions.createUnplannedReceipt.mutateAsync(payload);
            if (!mounted.current || activeCustomerSession.current !== session || session.customerCode !== payload.customer_code) return;
            const receiptId = result.receipt_id || result.id;
            if (receiptId) {
              setView("open");
              setSelectedNoticeId(null);
              originReceiptId.current = `receiving:${receiptId}`;
              setSelectedId(`receiving:${receiptId}`);
            }
            toast({
              title: "Chegada avulsa registrada",
              description: ["A conferência foi criada no WMS sem lançar estoque ainda.", generatedSkuNote(result.items)].filter(Boolean).join(" "),
            });
          } catch (error) {
            if (mounted.current && activeCustomerSession.current === session) {
              toast({ title: "Não consegui registrar a chegada", description: getErrorMessage(error), variant: "destructive" });
            }
            throw error;
          }
        }}
      />
      <CancelarRecebimentoDialog
        key={`${customerCode}:${cancelTask?.id ?? "closed"}`}
        task={cancelTask}
        receipts={entries.filter((entry) => entry.queue.key === "receiving").map((entry) => entry.task)}
        customerCode={cancelTask?.customer_code ?? cancelTask?.customer ?? customerCode}
        onOpenChange={(open) => { if (!open) setCancelTask(null); }}
        onCancelled={() => { setCancelTask(null); setSelectedId(null); setSelectedNoticeId(null); setView("cancelled"); }}
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

export function CancelledReceiptHistory({
  task,
  hasOriginal = false,
  onOpenOriginal,
}: {
  task: WarehouseTask;
  hasOriginal?: boolean;
  onOpenOriginal?: (id: string) => void;
}) {
  const reasons = { duplicate: "Duplicado", mistake: "Lançado por engano", other: "Outro motivo" };
  const actor = task.cancelled_by?.name || task.cancelled_by?.email || task.cancelled_by?.uid;
  return (
    <section aria-label="Histórico do cancelamento" className="space-y-2 rounded-lg border border-border bg-card p-4">
      <h2 className="font-semibold">Recebimento cancelado</h2>
      {task.cancellation_reason ? <p>{reasons[task.cancellation_reason]}</p> : null}
      {task.cancellation_note ? <p>{task.cancellation_note}</p> : null}
      {task.cancelled_at ? <p>Cancelado em {formatDate(task.cancelled_at)}</p> : null}
      {actor ? <p>Por {actor}</p> : null}
      {task.duplicate_of_receipt_id ? (
        <div className="flex flex-wrap items-center gap-2">
          <span>Original: {task.duplicate_of_receipt_number || task.duplicate_of_receipt_id}</span>
          {hasOriginal && onOpenOriginal ? (
            <Button type="button" variant="outline" size="sm" onClick={() => onOpenOriginal(task.duplicate_of_receipt_id!)}>
              Abrir original
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export function NoticeCard({ notice }: { notice: ShipmentNotice }) {
  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Aviso de envio</div>
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
  onBack,
}: {
  entry: TaskQueueEntry;
  onBack?: () => void;
  alerts: OpsAlert[];
  actions: ReturnType<typeof useWarehouseTaskActions>;
  noticeChoice: NoticeLinkChoice | null;
  linking: boolean;
  onLinkNotice?: (requestId: string | null) => void;
  lineConfirmations: LineConfirmationMap;
  onLineConfirmationChange: Parameters<typeof TaskDetailPanel>[0]["onLineConfirmationChange"];
}) {
  // A guarda da caixa do recebimento é da caixa inteira (recebimento com caixas, parte 5f).
  if (entry.queue.key === "putaway" && entry.task.box_code) {
    return <GuardaDaCaixa key={entry.task.id} entry={entry} />;
  }
  // A chegada por caixa tem a ficha dela (recebimento com caixas, parte 5).
  if (entry.queue.key === "receiving" && chegadaPorCaixa(entry.task)) {
    return (
      <FichaDaChegadaPorCaixa
        key={entry.task.id}
        entry={entry}
        registeringExceptionId={actions.registeringExceptionId}
        onOpenException={actions.exception.openFor}
        onBack={onBack}
      />
    );
  }
  if (entry.queue.key === "receiving") {
    return (
      <ReceivingTaskDetailCard
        key={entry.task.id}
        entry={entry}
        alerts={alerts}
        noticeChoice={noticeChoice}
        linking={linking}
        advancingTaskId={actions.advancingTaskId}
        registeringExceptionId={actions.registeringExceptionId}
        onAdvance={(id, note) => actions.advanceTask.mutate({ id, note })}
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
