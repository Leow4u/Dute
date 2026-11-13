import { useEffect, useId, useMemo, useRef, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Ban, Check, Forklift, Inbox, PackageOpen, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BlocoSemConexao, useFocoAoSair } from "@/components/ui/erro-na-leitura";
import { BotaoAtualizar, LinhaDeEstado } from "@/components/ui/linha-de-estado";
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
import { useContagemLembrada, type ContagensDaLista } from "@/lib/carregando/contagem-lembrada";
import { marcarPedidoDaPessoa } from "@/lib/carregando/pedido-da-pessoa";
import { resumoDaLista } from "@/lib/carregando/resumo-da-lista";
import { useAtualizarLista } from "@/lib/carregando/use-atualizar-lista";
import { BarraDaLista, ConteudoEmTroca, useListaComFiltro, useListaEmTroca } from "@/lib/carregando/use-lista-em-troca";
import { semConexaoNaLeitura } from "@/lib/conexao";
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
  const { code: customerCode, isLoading: clienteCarregando, codeProvavel } = useActiveCustomer();
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
  // Trocar o cliente lê os avisos dele no servidor: a lista anterior fica, a 50% e inert, com a barra no topo do
  // primeiro cartão, até os avisos do novo chegarem (carregamento v2, momento 7, caso 4).
  const requests = useQuery({
    queryKey: ["customer-requests", "receber", customerCode],
    queryFn: () =>
      fetchJson<{ items?: Array<Record<string, unknown>> }>(
        `/api/customer-requests?customer_code=${encodeURIComponent(customerCode)}&status=open&limit=200`,
      ),
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
    placeholderData: keepPreviousData,
  });
  // A troca de cliente que falha (os avisos do novo não vieram) mostra o aviso no lugar da lista, também na nova
  // tentativa (o react-query voltaria os avisos do cliente anterior por baixo): erro nunca vira vazio. Sem as filas
  // lidas, a nova tentativa volta à primeira leitura, com as linhas-fantasma, como sempre.
  const avisos = useListaComFiltro(requests);
  const trocandoDeCliente = avisos.trocando;
  const requestsNaTela = avisos.falhou && ops.data !== undefined
    ? { ...requests, data: undefined, error: avisos.erro as Error, isError: true, isLoading: false, isPlaceholderData: false, dataUpdatedAt: 0 }
    : requests;
  // Os avisos na tela são do cliente da leitura: na troca, ainda os do anterior, que somem com a lista dele.
  const clienteDosAvisos = useRef(customerCode);
  if (!trocandoDeCliente) clienteDosAvisos.current = customerCode;
  const codigoDosAvisos = clienteDosAvisos.current;
  const notices = useMemo(
    () => openShipmentNotices(requests.data?.items ?? []).filter((notice) => notice.customer_code === codigoDosAvisos),
    [requests.data?.items, codigoDosAvisos],
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
  // Sem rede, a lista que já estava fica, com a hora da leitura; sem nada
  // lido, o aviso. A falta de conexão não troca a lista pelo erro
  // (decisão 2 do celular).
  const semRede = semConexaoNaLeitura(ops, requestsNaTela);
  const recarregar = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["warehouse-ops"] }),
      queryClient.invalidateQueries({ queryKey: ["customer-requests", "receber"] }),
    ]);
  const openCount = pendingNotices.length + board.check.length + board.guardando.length + board.store.length;
  // A linha de estado sob o título e o Atualizar (carregamento v2, parte 7b):
  // a releitura automática de 60 s não mostra nada; o Atualizar só mostra a
  // espera quando a pessoa toca nele; a volta do app ao primeiro plano relê
  // com a barra no topo do primeiro cartão.
  const leiturasDaLista = [ops, requestsNaTela];
  const atualizarLista = useAtualizarLista(leiturasDaLista);
  const troca = useListaEmTroca(trocandoDeCliente);
  const barraDoTopo = <BarraDaLista ativa={atualizarLista.voltando || trocandoDeCliente} />;

  // A lista com a forma final na primeira leitura (carregamento v2, momento 2, decisão P3): os títulos reais
  // desde 0 ms, com o bloco no lugar do número; as linhas-fantasma na altura da última contagem lida deste
  // cliente; o contêiner aria-busy, descrito pela linha de estado. Os avisos de envio entram em "Para
  // conferir": a lista espera as duas leituras. Na chegada, as linhas reais entram em cascata, e o Anunciador
  // diz o resumo (só se disse "Carregando chegadas"). Só a primeira leitura da tela: trocar o cliente com a
  // lista lida relê os avisos dele com a lista na tela (a lista nunca some). A falha das filas não espera os
  // avisos: o aviso entra no lugar da lista na hora.
  const [listaJaLida, setListaJaLida] = useState(false);
  if (!listaJaLida && ops.data && (requests.data || requests.isError)) setListaJaLida(true);
  const lendo = !listaJaLida && !ops.isError && (ops.isLoading || requests.isLoading);
  const idDaLinha = useId();
  // O aviso no lugar da lista: sem nada lido das filas, ou sem os avisos do cliente (a troca que falhou). A contagem
  // do "Em aberto" fica com o bloco: sem a lista, ela seria um falso número.
  const falhaNaTela = !lendo && !semRede && ((Boolean(ops.error) && !ops.data) || avisos.falhou);
  const semAListaNaTela = falhaNaTela || (!lendo && semRede !== null && semRede.lidaEm === null);
  // A contagem lembrada é do cliente que a tela vai operar: na abertura, antes de a lista dos clientes chegar, o
  // escolhido neste aparelho. Só grava com o cliente confirmado e os avisos dele lidos.
  const contagensLidas: ContagensDaLista | null =
    ops.data && requests.data && !requests.isPlaceholderData && !clienteCarregando
      ? {
          conferir: pendingNotices.length + board.check.length,
          guardando: board.guardando.length,
          guardar: board.store.length,
          chegadas: board.chegadas.length,
          guardas: board.guardas.length,
          cancelados: board.cancelled.length,
        }
      : null;
  const contagem = useContagemLembrada("receber", codeProvavel ?? customerCode, contagensLidas);
  const fantasmas = (grupo: string, ordem: number) => (lendo ? { linhas: contagem.linhas(grupo), acoes: 1 as const, ordem } : undefined);
  // "Recebidas, por guardar" só aparece com linha: na primeira leitura, se a última leitura deste cliente tinha.
  const comGuardando = lendo ? (contagem.lembrada("guardando") ?? 0) > 0 : board.guardando.length > 0;
  const paraConferir = pendingNotices.length + board.check.length;
  const resumo =
    view === "cancelled"
      ? resumoDaLista([{ quantos: board.cancelled.length, um: "recebimento cancelado", varios: "recebimentos cancelados" }], "Nenhum recebimento cancelado")
      : view === "done"
        ? resumoDaLista(
            [
              { quantos: board.chegadas.length, um: "chegada recebida", varios: "chegadas recebidas" },
              { quantos: board.guardas.length, um: "guarda concluída", varios: "guardas concluídas" },
            ],
            "Nenhuma chegada recebida",
          )
        : resumoDaLista(
            [
              { quantos: paraConferir, um: "para conferir" },
              { quantos: board.guardando.length, um: "recebida por guardar", varios: "recebidas por guardar" },
              { quantos: board.store.length, um: "para guardar" },
            ],
            "Nenhuma chegada em aberto",
          );
  // Na troca de cliente, só os avisos são do cliente anterior: eles ficam a 50% e inert, e as chegadas e guardas do
  // armazém, que a troca não relê, seguem com o toque.
  const listaOcupada = lendo ? { "aria-busy": true, "aria-describedby": idDaLinha } : {};

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
        estado={<LinhaDeEstado id={idDaLinha} leitura={leiturasDaLista} objeto="chegadas" pedidaPelaPessoa={atualizarLista.voltando || trocandoDeCliente} resumo={resumo} />}
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
              cheioNoCelular
              options={[
                { value: "open", label: "Em aberto", count: lendo || semAListaNaTela ? null : openCount },
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
            <BotaoAtualizar atualizando={atualizarLista.atualizando} travado={lendo} onAtualizar={atualizarLista.atualizar} />
          </>
        }
      /> : null}

      {/* A falta com a lista lida fica na linha de estado, sob o título; a primeira leitura, também, com a lista
          na forma final, com as linhas-fantasma. */}
      {fichaLarga ? <section aria-label="Bancada de conferência" className="min-w-0">{panel}</section> : !lendo && semRede && semRede.lidaEm === null ? (
        <BlocoSemConexao tentando={ops.isFetching || requests.isFetching} onTentar={recarregar} focoAoSair={idDaLinha} />
      ) : falhaNaTela ? (
        <FalhaDasChegadas focoAoSair={idDaLinha} onTentar={recarregar} />
      ) : (
        <div
          className={cn(
            "grid grid-cols-1 gap-4",
            desktop && (selected || selectedNotice) && "lg:grid-cols-[minmax(0,1fr)_480px]",
          )}
        >
          <div className="flex min-w-0 flex-col gap-6" {...listaOcupada}>
            {view !== "open" ? <p className="text-sm text-muted-foreground">Até 12 registros recentes por fila</p> : null}
            {view === "cancelled" ? (
              <QueueGroup title="Cancelados" count={lendo ? null : board.cancelled.length} empty="Nenhum recebimento cancelado." barraDoTopo={barraDoTopo} carregando={fantasmas("cancelados", 0)}>
                {board.cancelled.map((entry) => (
                  <QueueRow key={entry.task.id} icon={Ban} tone="done" title={getTaskTitle(entry.task)}
                    meta={entry.queue.key === "receiving" ? receivingRowMeta(entry.task) : putawayRowMeta(entry.task)}
                    note={entry.task.duplicate_of_receipt_number ? `Original: ${entry.task.duplicate_of_receipt_number}` : undefined}
                    actions={<Button type="button" variant="outline" data-receipt-id={entry.task.id} onClick={() => selectEntry(entry)}>Ver</Button>} />
                ))}
              </QueueGroup>
            ) : view === "done" ? (
              <>
                <QueueGroup title="Chegadas" count={lendo ? null : board.chegadas.length} empty="Nenhuma chegada recebida." barraDoTopo={barraDoTopo} carregando={fantasmas("chegadas", 0)}>
                  {board.chegadas.map((entry) => rowDone(entry, receivingRowMeta(entry.task)))}
                </QueueGroup>
                <QueueGroup title="Guardas" count={lendo ? null : board.guardas.length} empty="Nenhuma guarda concluída." carregando={fantasmas("guardas", 1)} cascata={board.chegadas.length}>
                  {board.guardas.map((entry) => rowDone(entry, putawayRowMeta(entry.task)))}
                </QueueGroup>
              </>
            ) : (
              <>
                <QueueGroup
                  title="Para conferir"
                  count={lendo ? null : paraConferir}
                  empty="Nenhuma chegada para conferir."
                  barraDoTopo={barraDoTopo}
                  carregando={fantasmas("conferir", 0)}
                >
                  {pendingNotices.length ? (
                  <div className="divide-y divide-border/60" {...troca.props}>
                  <ConteudoEmTroca trocando={trocandoDeCliente}>
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
                  </ConteudoEmTroca>
                  </div>
                  ) : null}
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

                {comGuardando ? (
                  <QueueGroup title="Recebidas, por guardar" count={lendo ? null : board.guardando.length} empty={null} carregando={fantasmas("guardando", 1)} cascata={paraConferir}>
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
                  count={lendo ? null : board.store.length}
                  empty="Nada para guardar."
                  carregando={fantasmas("guardar", comGuardando ? 2 : 1)}
                  cascata={paraConferir + board.guardando.length}
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

/**
 * As chegadas que a tela não conseguiu ler: o motivo e "Tentar de novo". A
 * nova tentativa é pedida pela pessoa (a linha de estado fala de novo), e o
 * foco vai à linha de estado quando o aviso sai da tela.
 */
/**
 * As chegadas não vieram (as filas, ou os avisos do cliente): o aviso no lugar
 * da lista, com "Tentar de novo". Na nova tentativa que não tira o aviso da
 * tela (os avisos do cliente), o botão diz "Tentando de novo…", ocupado e não
 * desabilitado; quando o aviso sai com o foco nele, o foco vai à linha de
 * estado.
 */
function FalhaDasChegadas({ focoAoSair, onTentar }: { focoAoSair: string; onTentar: () => Promise<unknown> }) {
  const raiz = useRef<HTMLParagraphElement>(null);
  useFocoAoSair(raiz, focoAoSair);
  const [tentando, setTentando] = useState(false);
  const montada = useRef(true);
  useEffect(() => {
    montada.current = true;
    return () => {
      montada.current = false;
    };
  }, []);
  return (
    <p ref={raiz} className="text-sm text-destructive">
      Não consegui carregar as chegadas.{" "}
      <button
        type="button"
        className="font-medium underline aria-disabled:no-underline"
        aria-disabled={tentando || undefined}
        aria-busy={tentando || undefined}
        onClick={() => {
          if (tentando) return;
          marcarPedidoDaPessoa();
          setTentando(true);
          void onTentar().finally(() => {
            if (montada.current) setTentando(false);
          });
        }}
      >
        {tentando ? "Tentando de novo…" : "Tentar de novo"}
      </button>
    </p>
  );
}
