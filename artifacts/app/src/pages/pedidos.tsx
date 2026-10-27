import { useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { collection, query, where } from "firebase/firestore";
import {
  AlertTriangle,
  Check,
  ClipboardCheck,
  MoreHorizontal,
  Package,
  RefreshCw,
  Truck,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { Link } from "wouter";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PageHeader } from "@/components/ui/page-header";
import { QueueGroup, QueueRow, type QueueTone } from "@/components/ui/queue-list";
import { Segmented } from "@/components/ui/segmented";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  OpeningInventoryNotice,
  useOpeningInventorySession,
} from "@/features/warehouse-ops/opening-inventory-status";
import {
  CancelarPedidoView,
  motivoValido,
  pedidoCancelavel,
  voltasDoPedido,
} from "@/features/warehouse-ops/cancel-order";
import { FormularioDaEntregaView } from "@/features/warehouse-ops/order-delivery";
import {
  SeparadoView,
  linhasDoSeparado,
  linhasParaSeparar,
  separadoValido,
  type LinhaDoSeparado,
} from "@/features/warehouse-ops/separado";
import { ExceptionDialog, useWarehouseTaskActions } from "@/features/warehouse-ops/task-actions";
import { TaskDetailPanel } from "@/features/warehouse-ops/task-detail";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useActiveCustomer } from "@/lib/active-customer-context";
import { useAppUser } from "@/lib/auth";
import { OPERACAO_LIBERADO } from "@/lib/liberacao";
import { chamarOperacao, novaChave } from "@/lib/operacao/api";
import { hojeIso } from "@/lib/operacao/fila";
import { useLeitura } from "@/lib/operacao/leitura";
import { buildOrderQueue, chaveDaPrincipal, ordersGroupEmpty } from "@/lib/order-queue";
import { useItemPhotos } from "@/lib/use-item-photos";
import { canDecideRequests, canOperateWarehouse, humanApiError } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import {
  type LineConfirmationMap,
  type WarehouseOpsResponse,
  type WarehouseTask,
  lineConfirmationKey,
  normalizeQueues,
  queueEntries,
} from "@/lib/warehouse-ops/model";
import {
  entregaDoPedido,
  faltaAbrirNaOperacao,
  formularioDaEntrega,
  naOperacao,
  pedidoDaEntrega,
  problemasDaEntrega,
  resumoDaEntrega,
  saidaPelaEntrega,
  type EntregaDoPedido,
  type FormularioDaEntrega,
} from "@/lib/warehouse-ops/entrega";
import { queueTasks, type OrderGroup } from "@/lib/warehouse-ops/orders";
import {
  buildBalanceValidation,
  formatRequestAge,
  requestSummary,
  requestTitle,
  type CustomerRequest,
  type StockBalance,
} from "./customer-requests";

const numberFormatter = new Intl.NumberFormat("pt-BR");

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}

/** Padrões da entrega própria lembrados entre pedidos (só conveniência). */
function remembered(key: string, fallback: string) {
  try {
    return window.localStorage.getItem(`wms-pedidos:${key}`) || fallback;
  } catch {
    return fallback;
  }
}

function remember(key: string, value: string) {
  try {
    window.localStorage.setItem(`wms-pedidos:${key}`, value);
  } catch {
    // storage indisponível não pode travar a operação
  }
}

function orderUnits(order: OrderGroup) {
  const task = order.pick ?? order.pack ?? order.ship;
  return (
    Number(task?.quantity ?? 0) ||
    (task?.items ?? []).reduce((sum, item) => sum + Number(item.quantity ?? 0), 0)
  );
}

function orderItems(order: OrderGroup) {
  return order.pick?.items ?? order.pack?.items ?? order.ship?.items ?? [];
}

/** "3 itens · 120 un. · lacre L-0098": a linha do pedido e o diálogo de cancelar. */
function orderMeta(order: OrderGroup) {
  const items = orderItems(order);
  const units = orderUnits(order);
  const seal = order.pack?.seal_code ?? order.ship?.seal_code;
  return [
    items.length ? `${items.length} ${items.length === 1 ? "item" : "itens"}` : null,
    units ? `${numberFormatter.format(units)} un.` : null,
    seal ? `lacre ${seal}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

type DialogState =
  | { kind: "reject"; request: CustomerRequest }
  | { kind: "pick"; order: OrderGroup }
  | { kind: "deliver"; order: OrderGroup }
  | { kind: "entrega"; order: OrderGroup; orderId: string }
  | { kind: "cancel"; order: OrderGroup; orderId: string }
  | null;

/** Os pedidos de saída que ainda não saíram: a entrega de cada um (parte 4.5c). */
const PEDIDOS_EM_ABERTO = ["PENDENTE", "SEPARACAO", "EM_EXPEDICAO"];

export default function Pedidos() {
  const { user } = useAppUser();
  const decider = canDecideRequests(user?.publicMetadata.role);
  // O suporte consulta: sem separar, entregar, tratar nem definir a entrega.
  const operador = canOperateWarehouse(user?.publicMetadata.role);
  const openingSession = useOpeningInventorySession();
  const { active: cliente } = useActiveCustomer();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [view, setView] = useState<"open" | "delivered">("open");
  const [dialog, setDialog] = useState<DialogState>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [seal, setSeal] = useState("");
  // Separar a menos (pergunta 59): a coordenação informa o separado de cada linha.
  const [linhasSeparadas, setLinhasSeparadas] = useState<LinhaDoSeparado[]>([]);
  const [driver, setDriver] = useState(() => remembered("motorista", "Equipe Dutelog"));
  const [plate, setPlate] = useState(() => remembered("placa", ""));
  const [receivedBy, setReceivedBy] = useState("");
  // "Tratar": a tarefa bloqueada do pedido abre aqui mesmo, num painel.
  const [treating, setTreating] = useState<OrderGroup | null>(null);
  const [lineConfirmations, setLineConfirmations] = useState<LineConfirmationMap>({});
  // A entrega do pedido (parte 4.5c): só com a Operação liberada, que abre a demanda da entrega pela Dutelog.
  const [entregaForm, setEntregaForm] = useState<FormularioDaEntrega | null>(null);
  const [entregaTentou, setEntregaTentou] = useState(false);
  const [entregaErro, setEntregaErro] = useState<string | null>(null);
  const chaveDaEntrega = useRef<string | null>(null);
  // Cancelar pedido (pergunta 59): a coordenação, com o motivo.
  const [cancelReason, setCancelReason] = useState("");
  const chaveDoCancelamento = useRef<string | null>(null);
  const entregas = useLeitura(
    OPERACAO_LIBERADO ? "orders:em_aberto" : null,
    (db) => query(collection(db, "orders"), where("status", "in", PEDIDOS_EM_ABERTO)),
    (id, data) => ({ id, entrega: entregaDoPedido(data) }),
  );
  const entregaPorPedido = useMemo(() => new Map((entregas.itens ?? []).map((item) => [item.id, item.entrega])), [entregas.itens]);
  const entregaDe = (order: OrderGroup): EntregaDoPedido | null => (order.orderId ? entregaPorPedido.get(order.orderId) ?? null : null);

  const ops = useQuery({
    queryKey: ["warehouse-ops"],
    queryFn: () => fetchJson<WarehouseOpsResponse>("/api/warehouse/ops"),
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
  });
  const requests = useQuery({
    queryKey: ["customer-requests"],
    queryFn: () =>
      fetchJson<{ items: CustomerRequest[] }>("/api/customer-requests?limit=200"),
    enabled: decider,
    refetchInterval: 60_000,
  });
  const balances = useQuery({
    queryKey: ["stock-balances", "customer-requests"],
    queryFn: () =>
      fetchJson<{ items: StockBalance[] }>("/api/stock-balances?limit=500"),
    enabled: decider,
    refetchInterval: 120_000,
    retry: 1,
  });

  const queue = useMemo(
    () => buildOrderQueue({ requests: requests.data?.items, ops: ops.data }),
    [ops.data, requests.data?.items],
  );
  const entries = useMemo(() => queueEntries(normalizeQueues(ops.data?.queues)), [ops.data?.queues]);
  const actions = useWarehouseTaskActions({
    findEntry: (taskId) => entries.find((entry) => entry.task.id === taskId),
  });
  const treatingTask = treating
    ? [treating.pick, treating.pack, treating.ship].find((task) => task?.blocked_reason) ??
      (treating.stage === "separar" ? treating.pick : treating.ship)
    : undefined;
  // Procura pelo id: depois de avançar, a tarefa vem atualizada do servidor.
  const treatingEntry = treatingTask
    ? entries.find((entry) => entry.task.id === treatingTask.id)
    : undefined;

  const refreshAll = () => {
    void queryClient.invalidateQueries({ queryKey: ["warehouse-ops"] });
    void queryClient.invalidateQueries({ queryKey: ["customer-requests"] });
    void queryClient.invalidateQueries({ queryKey: ["stock-balances"] });
  };

  const onError = (error: Error) =>
    toast({
      title: "Não consegui atualizar o pedido",
      description: humanApiError(error, "Tente novamente em instantes."),
      variant: "destructive",
    });

  const decide = useMutation({
    mutationFn: ({
      request,
      action,
      reason,
    }: {
      request: CustomerRequest;
      action: "approve" | "reject";
      reason?: string;
    }) => {
      const expected = String(request.status || "open").toLowerCase();
      return fetchJson(
        `/api/customer-requests/${encodeURIComponent(request.id)}/${action}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            expected_status: expected,
            reason,
            idempotency_key: `${request.id}:${action}:${expected}`,
          }),
        },
      );
    },
    onSuccess: (_result, variables) => {
      toast({
        title:
          variables.action === "approve"
            ? "Aprovado. O pedido foi para separação."
            : "Solicitação recusada.",
      });
      setDialog(null);
      setRejectReason("");
      refreshAll();
    },
    onError,
  });

  // Mesmas chamadas da antiga tela "Separar e enviar": cada etapa do WMS
  // continua gravada no backend; a tela só encadeia.
  const advance = async (
    taskUid: string,
    expectedStatus: string,
    operation?: Record<string, unknown>,
  ) =>
    fetchJson(`/api/warehouse/tasks/${encodeURIComponent(taskUid)}/advance`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expected_status: expectedStatus,
        operation,
        idempotency_key: `${taskUid}:${expectedStatus}`,
      }),
    });

  const salvarEntrega = useMutation({
    mutationFn: async ({ orderId, form }: { orderId: string; form: FormularioDaEntrega }) => {
      chaveDaEntrega.current ??= novaChave();
      await fetchJson(`/api/orders/${encodeURIComponent(orderId)}/delivery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pedidoDaEntrega(form, orderId, chaveDaEntrega.current)),
      });
      // A entrega pela Dutelog vira demanda e OS na Operação; a retirada pelo cliente, não.
      if (form.modo !== "dutelog") return null;
      return chamarOperacao<{ numero: string }>("openStorageDemand", { idempotency_key: chaveDaEntrega.current, order_id: orderId });
    },
    onSuccess: (aberta) => {
      chaveDaEntrega.current = null;
      setDialog(null);
      toast({ title: aberta ? `Demanda ${aberta.numero} aberta na Operação` : "Entrega salva" });
      refreshAll();
    },
    onError: (error: Error) => setEntregaErro(humanApiError(error, "Tente novamente em instantes.")),
  });

  const cancelar = useMutation({
    mutationFn: ({ orderId, reason }: { orderId: string; reason: string }) => {
      chaveDoCancelamento.current ??= novaChave();
      return fetchJson(`/api/orders/${encodeURIComponent(orderId)}/cancel`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason, idempotency_key: chaveDoCancelamento.current }),
      });
    },
    onSuccess: () => {
      chaveDoCancelamento.current = null;
      toast({ title: "Pedido cancelado" });
      setDialog(null);
      setCancelReason("");
      refreshAll();
    },
    onError,
  });

  const abrirCancelamento = (order: OrderGroup) => {
    if (!order.orderId) return;
    chaveDoCancelamento.current = null;
    setCancelReason("");
    setDialog({ kind: "cancel", order, orderId: order.orderId });
  };
  // A coordenação confere o separado de cada linha enquanto a separação não terminou.
  const conferindoLinhas = (order: OrderGroup) =>
    decider && String(order.pick?.status ?? "") !== "completed" && linhasSeparadas.length > 0;
  const resumoDoPedido = (order: OrderGroup) => {
    const entrega = entregaDe(order);
    return entrega ? resumoDaEntrega(entrega) : null;
  };
  // O "⋯" do pedido ainda no armazém, só para quem decide (owner, admin e interno).
  const menuDo = (order: OrderGroup) =>
    decider && pedidoCancelavel(order) ? (
      <MenuDoPedido order={order} disabled={busy} onCancelar={() => abrirCancelamento(order)} />
    ) : undefined;

  const abrirEntrega = (order: OrderGroup) => {
    if (!order.orderId) return;
    chaveDaEntrega.current = null;
    setEntregaForm(formularioDaEntrega(entregaDe(order), hojeIso()));
    setEntregaTentou(false);
    setEntregaErro(null);
    setDialog({ kind: "entrega", order, orderId: order.orderId });
  };

  const pick = useMutation({
    mutationFn: async ({ order, sealCode, linhas }: { order: OrderGroup; sealCode: string; linhas?: LinhaDoSeparado[] }) => {
      const pickTask = order.pick;
      if (pickTask && pickTask.status !== "completed") {
        if (String(pickTask.status) === "planned") {
          await advance(String(pickTask.id), "planned");
        }
        await advance(String(pickTask.id), "in_progress", {
          picking_lines: linhas?.length
            ? linhasParaSeparar(linhas)
            : (pickTask.items ?? []).map((item) => ({
                pick_line_id: String(item.id ?? ""),
                qty_picked: Number(item.expected_quantity ?? item.quantity ?? 0),
                status: "confirmed",
              })),
        });
      }
      // O packing nasce quando o picking termina: recarrega para achá-lo.
      const packUid = order.pack ? String(order.pack.id) : `packing:pack_${order.key}`;
      await queryClient.invalidateQueries({ queryKey: ["warehouse-ops"] });
      const fresh = await fetchJson<WarehouseOpsResponse>("/api/warehouse/ops");
      const packTask = queueTasks(fresh, "packing").find(
        (task) => String(task.id) === packUid,
      );
      if (!packTask) {
        throw new Error("A embalagem ainda não apareceu. Atualize e tente de novo.");
      }
      if (packTask.status !== "completed") {
        if (String(packTask.status) === "ready") await advance(packUid, "ready");
        await advance(packUid, "in_progress", {
          // O item que a separação a menos zerou não se embala.
          packing_lines: (packTask.items ?? [])
            .map((item) => ({
              order_item_id: String(item.id ?? ""),
              qty_packed: Number(item.picked_quantity ?? item.quantity ?? 0),
              status: "confirmed",
            }))
            .filter((line) => line.qty_packed > 0),
          package_count: 1,
          volume_label: "VOL-1",
          seal_code: sealCode,
        });
      }
    },
    onSuccess: () => {
      toast({ title: "Separado. O pedido está pronto para entrega." });
      setDialog(null);
      setSeal("");
      refreshAll();
    },
    onError,
  });

  const deliver = useMutation({
    mutationFn: async ({ order }: { order: OrderGroup }) => {
      const shipUid = String(order.ship?.id ?? "");
      if (!shipUid) throw new Error("Pedido sem expedição criada.");
      if (order.stage === "enviar") {
        remember("motorista", driver.trim());
        remember("placa", plate.trim());
        await advance(shipUid, "ready_to_dispatch", {
          carrier: "Dutelog",
          driver_name: driver.trim(),
          vehicle_plate: plate.trim(),
        });
      }
      await advance(shipUid, "dispatched", {
        proof_reference: receivedBy.trim() || "Entrega própria Dutelog",
        delivery_notes: "Recebido pelo cliente.",
      });
    },
    onSuccess: () => {
      toast({ title: "Entrega confirmada. Estoque baixado." });
      setDialog(null);
      setReceivedBy("");
      refreshAll();
    },
    onError,
  });

  const busy = decide.isPending || pick.isPending || deliver.isPending || salvarEntrega.isPending || cancelar.isPending;
  // A tabela do cancelamento e as linhas do Separado da coordenação pedem um diálogo mais largo.
  const larguraDoDialogo = cn(
    "sm:max-w-[440px]",
    dialog?.kind === "cancel" && "sm:max-w-[560px]",
    dialog?.kind === "pick" && conferindoLinhas(dialog.order) && "sm:max-w-[640px]",
  );

  /** A entrega do pedido na linha e a ação de definir (ou abrir na Operação), com a Operação liberada. */
  const daEntrega = (order: OrderGroup) => {
    if (!OPERACAO_LIBERADO || !order.orderId) return {};
    const entrega = entregaDe(order);
    const resumo = entrega ? [resumoDaEntrega(entrega), naOperacao(entrega)].filter(Boolean).join(" · ") : null;
    return {
      detail: resumo,
      secondary: operador ? (
        <Button type="button" variant="outline" disabled={busy} onClick={() => abrirEntrega(order)}>
          {faltaAbrirNaOperacao(entrega) ? "Abrir na Operação" : entrega ? "Alterar entrega" : "Entrega"}
        </Button>
      ) : undefined,
    };
  };
  // Na v3, só a primeira linha da fila tem a ação principal; as outras são secundárias.
  const principal = chaveDaPrincipal(queue, decider);
  const variante = (chave: string) => (principal === chave ? "default" : "outline");
  const openCount =
    (decider ? queue.approve.length : 0) + queue.pick.length + queue.deliver.length;
  const loading = ops.isLoading || (decider && requests.isLoading);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 pb-24">
      <PageHeader
        title="Pedidos"
        actions={
          <>
            <Segmented<"open" | "delivered">
              value={view}
              onChange={setView}
              aria-label="Pedidos em aberto ou entregues"
              options={[
                { value: "open", label: `Em aberto${openCount ? ` · ${openCount}` : ""}` },
                { value: "delivered", label: "Entregues" },
              ]}
            />
            <Button type="button" variant="outline" size="icon" onClick={refreshAll} disabled={ops.isFetching}>
              <RefreshCw className={cn("size-4", ops.isFetching && "animate-spin")} />
              <span className="sr-only">Atualizar</span>
            </Button>
          </>
        }
      />

      <OpeningInventoryNotice
        session={openingSession.data}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/wms/contagem">Continuar contagem</Link>
          </Button>
        }
      />

      {loading ? (
        <p className="text-sm text-muted-foreground">Carregando pedidos...</p>
      ) : view === "delivered" ? (
        <>
          <QueueGroup
            title="Entregues"
            count={queue.delivered.length}
            empty="Nenhuma entrega recente."
          >
            {queue.delivered.map((order) => (
              <OrderRow key={order.key} order={order} icon={Check} tone="done" />
            ))}
          </QueueGroup>
          <Link href="/orders" className="px-1 text-sm text-primary hover:underline">
            Ver histórico completo de pedidos
          </Link>
        </>
      ) : (
        <>
          {decider ? (
            <QueueGroup
              title="Para aprovar"
              count={queue.approve.length}
              empty={
                <>
                  {ordersGroupEmpty("approve")}{" "}
                  <Link href="/solicitacoes" className="font-semibold text-primary hover:underline">
                    Ver solicitações
                  </Link>
                </>
              }
            >
              {queue.approve.map((request) => {
                const validation = buildBalanceValidation(
                  request,
                  balances.data?.items,
                  balances.isLoading,
                  Boolean(balances.error),
                );
                return (
                  <QueueRow
                    key={request.id}
                    icon={ClipboardCheck}
                    tone="approve"
                    title={requestTitle(request)}
                    meta={requestSummary(request)}
                    age={formatRequestAge(request.created_at)}
                    note={
                      validation.canApprove ? undefined : (
                        <>
                          <AlertTriangle className="size-3.5" />
                          {validation.detail}
                        </>
                      )
                    }
                    actions={
                      validation.canApprove ? (
                        <>
                          <Button
                            type="button"
                            variant="outline"
                            className="text-destructive hover:text-destructive"
                            disabled={busy}
                            onClick={() => {
                              setRejectReason("");
                              setDialog({ kind: "reject", request });
                            }}
                          >
                            Recusar
                          </Button>
                          <Button
                            type="button"
                            variant={variante(`approve:${request.id}`)}
                            disabled={busy}
                            onClick={() => decide.mutate({ request, action: "approve" })}
                          >
                            <Check className="size-4" />
                            Aprovar
                          </Button>
                        </>
                      ) : (
                        <Button asChild variant="outline">
                          <Link href={`/solicitacoes?id=${encodeURIComponent(request.id)}`}>
                            Ver itens
                          </Link>
                        </Button>
                      )
                    }
                  />
                );
              })}
            </QueueGroup>
          ) : null}

          <QueueGroup
            title="Para separar"
            count={queue.pick.length}
            empty={ordersGroupEmpty("pick")}
          >
            {queue.pick.map((order) => (
              <OrderRow
                key={order.key}
                order={order}
                icon={Package}
                tone="pick"
                defaultOpen
                onTreat={operador ? () => setTreating(order) : undefined}
                {...daEntrega(order)}
                menu={menuDo(order)}
                action={
                  operador ? (
                    <Button
                      type="button"
                      variant={variante(`pick:${order.key}`)}
                      disabled={busy}
                      onClick={() => {
                        setSeal("");
                        setLinhasSeparadas(linhasDoSeparado(order));
                        setDialog({ kind: "pick", order });
                      }}
                    >
                      <Check className="size-4" />
                      Separado
                    </Button>
                  ) : undefined
                }
              />
            ))}
          </QueueGroup>

          <QueueGroup
            title="Para entregar"
            count={queue.deliver.length}
            empty={ordersGroupEmpty("deliver")}
          >
            {queue.deliver.map((order) => (
              <OrderRow
                key={order.key}
                order={order}
                icon={Truck}
                tone="deliver"
                onTreat={operador ? () => setTreating(order) : undefined}
                {...(order.stage === "enviar" ? daEntrega(order) : {})}
                menu={menuDo(order)}
                action={
                  operador ? (
                    <Button
                      type="button"
                      variant={variante(`deliver:${order.key}`)}
                      disabled={busy}
                      onClick={() => {
                        setReceivedBy("");
                        // Na retirada pelo cliente, quem leva e a placa vêm da entrega do pedido.
                        const saida = saidaPelaEntrega(entregaDe(order));
                        if (saida) {
                          setDriver(saida.motorista);
                          setPlate(saida.placa);
                        }
                        setDialog({ kind: "deliver", order });
                      }}
                    >
                      <Check className="size-4" />
                      Entregue
                    </Button>
                  ) : undefined
                }
              />
            ))}
          </QueueGroup>
        </>
      )}

      <Dialog open={dialog !== null} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent className={larguraDoDialogo} aria-describedby={undefined}>
          {dialog?.kind === "reject" ? (
            <>
              <DialogHeader>
                <DialogTitle>Recusar solicitação</DialogTitle>
              </DialogHeader>
              <div className="grid gap-2">
                <Label htmlFor="motivo-da-recusa">Motivo</Label>
                <Textarea
                  id="motivo-da-recusa"
                  value={rejectReason}
                  onChange={(event) => setRejectReason(event.target.value)}
                  rows={3}
                />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDialog(null)}>
                  Voltar
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={rejectReason.trim().length < 3 || busy}
                  onClick={() =>
                    decide.mutate({
                      request: dialog.request,
                      action: "reject",
                      reason: rejectReason.trim(),
                    })
                  }
                >
                  Recusar
                </Button>
              </DialogFooter>
            </>
          ) : dialog?.kind === "pick" ? (
            <>
              <DialogHeader>
                <DialogTitle>{dialog.order.orderNumber}: separado</DialogTitle>
                <p className="text-sm font-medium text-muted-foreground">
                  {[cliente.name, orderMeta(dialog.order), resumoDoPedido(dialog.order)].filter(Boolean).join(" · ")}
                </p>
              </DialogHeader>
              <SeparadoView
                lacre={seal}
                onLacre={setSeal}
                linhas={conferindoLinhas(dialog.order) ? linhasSeparadas : undefined}
                onLinha={(linha) =>
                  setLinhasSeparadas((atuais) => atuais.map((atual) => (atual.id === linha.id ? linha : atual)))
                }
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDialog(null)}>
                  Voltar
                </Button>
                <Button
                  type="button"
                  disabled={
                    !seal.trim() || busy || (conferindoLinhas(dialog.order) && !separadoValido(linhasSeparadas))
                  }
                  onClick={() =>
                    pick.mutate({
                      order: dialog.order,
                      sealCode: seal.trim(),
                      linhas: conferindoLinhas(dialog.order) ? linhasSeparadas : undefined,
                    })
                  }
                >
                  {pick.isPending ? "Registrando..." : "Confirmar separação"}
                </Button>
              </DialogFooter>
            </>
          ) : dialog?.kind === "deliver" ? (
            <>
              <DialogHeader>
                <DialogTitle>{dialog.order.orderNumber}: entregue</DialogTitle>
              </DialogHeader>
              <div className="grid gap-3">
                {dialog.order.stage === "enviar" ? (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="grid gap-2">
                      <Label htmlFor="motorista">Quem levou</Label>
                      <Input
                        id="motorista"
                        value={driver}
                        onChange={(event) => setDriver(event.target.value)}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="placa">Placa</Label>
                      <Input
                        id="placa"
                        value={plate}
                        onChange={(event) => setPlate(event.target.value)}
                      />
                    </div>
                  </div>
                ) : null}
                <div className="grid gap-2">
                  <Label htmlFor="recebido">Quem recebeu (opcional)</Label>
                  <Input
                    id="recebido"
                    value={receivedBy}
                    onChange={(event) => setReceivedBy(event.target.value)}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDialog(null)}>
                  Voltar
                </Button>
                <Button
                  type="button"
                  disabled={
                    busy ||
                    (dialog.order.stage === "enviar" && (!driver.trim() || !plate.trim()))
                  }
                  onClick={() => deliver.mutate({ order: dialog.order })}
                >
                  {deliver.isPending ? "Registrando..." : "Confirmar entrega"}
                </Button>
              </DialogFooter>
            </>
          ) : dialog?.kind === "cancel" ? (
            <>
              <DialogHeader>
                <DialogTitle>Cancelar pedido {dialog.order.orderNumber}</DialogTitle>
                <p className="text-sm font-medium text-muted-foreground">
                  {[cliente.name, orderMeta(dialog.order)].filter(Boolean).join(" · ")}
                </p>
              </DialogHeader>
              <CancelarPedidoView
                motivo={cancelReason}
                voltas={voltasDoPedido(dialog.order)}
                onMotivo={(motivo) => {
                  setCancelReason(motivo);
                  chaveDoCancelamento.current = null;
                }}
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDialog(null)}>
                  Voltar
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={!motivoValido(cancelReason) || busy}
                  onClick={() => cancelar.mutate({ orderId: dialog.orderId, reason: cancelReason.trim() })}
                >
                  {cancelar.isPending ? "Cancelando..." : "Cancelar pedido"}
                </Button>
              </DialogFooter>
            </>
          ) : dialog?.kind === "entrega" && entregaForm ? (
            <>
              <DialogHeader>
                <DialogTitle>{dialog.order.orderNumber}: entrega</DialogTitle>
              </DialogHeader>
              <form
                id="entrega-do-pedido"
                noValidate
                onSubmit={(event) => {
                  event.preventDefault();
                  setEntregaTentou(true);
                  if (Object.keys(problemasDaEntrega(entregaForm, new Date())).length) return;
                  setEntregaErro(null);
                  salvarEntrega.mutate({ orderId: dialog.orderId, form: entregaForm });
                }}
              >
                <FormularioDaEntregaView
                  form={entregaForm}
                  problemas={entregaTentou ? problemasDaEntrega(entregaForm, new Date()) : {}}
                  onForm={(form) => {
                    setEntregaForm(form);
                    setEntregaErro(null);
                    chaveDaEntrega.current = null;
                  }}
                />
              </form>
              {entregaErro ? (
                <p role="alert" className="text-sm text-destructive">
                  {entregaErro}
                </p>
              ) : null}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDialog(null)}>
                  Voltar
                </Button>
                <Button type="submit" form="entrega-do-pedido" disabled={busy}>
                  {salvarEntrega.isPending ? "Salvando..." : entregaForm.modo === "dutelog" ? "Salvar e abrir na Operação" : "Salvar entrega"}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <Sheet open={treating !== null} onOpenChange={(open) => !open && setTreating(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto bg-background p-4 sm:max-w-xl sm:p-5" aria-describedby={undefined}>
          <SheetHeader className="mb-3 text-left">
            <SheetTitle>{treating ? `Tratar ${treating.orderNumber}` : "Tratar pedido"}</SheetTitle>
          </SheetHeader>
          <TaskDetailPanel
            entry={treatingEntry}
            alerts={ops.data?.alerts ?? []}
            lineConfirmations={lineConfirmations}
            advancingTaskId={actions.advancingTaskId}
            registeringExceptionId={actions.registeringExceptionId}
            onLineConfirmationChange={(taskId, rowId, resolution) =>
              setLineConfirmations((current) => ({
                ...current,
                [lineConfirmationKey(taskId, rowId)]: resolution,
              }))
            }
            onAdvance={(id, operation, note) => actions.advanceTask.mutate({ id, operation, note })}
            onOpenException={actions.exception.openFor}
          />
        </SheetContent>
      </Sheet>

      <ExceptionDialog
        open={actions.exception.open}
        taskEntry={actions.exception.entry ?? treatingEntry}
        note={actions.exception.note}
        isPending={actions.registerException.isPending}
        onOpenChange={actions.exception.onOpenChange}
        onNoteChange={actions.exception.setNote}
        onSubmit={(event) => actions.exception.submit(event, treatingEntry)}
      />
    </div>
  );
}

function OrderRow({
  order,
  icon,
  tone,
  action,
  secondary,
  menu,
  detail,
  defaultOpen = false,
  onTreat,
}: {
  order: OrderGroup;
  icon: LucideIcon;
  tone: QueueTone;
  action?: ReactNode;
  /** A ação de definir a entrega (parte 4.5c), ao lado da principal. */
  secondary?: ReactNode;
  /** O "⋯" do pedido (Cancelar pedido, pergunta 59), depois das ações. */
  menu?: ReactNode;
  /** A entrega do pedido em uma linha. */
  detail?: ReactNode;
  defaultOpen?: boolean;
  onTreat?: () => void;
}) {
  const acoes = action || secondary ? (
    <>
      {secondary}
      {action}
    </>
  ) : null;
  const [open, setOpen] = useState(defaultOpen);
  const items = orderItems(order);
  const blocked = Boolean(order.blockedReason || order.exceptionCount);
  const meta = orderMeta(order);

  return (
    <div className={cn(blocked && "bg-destructive-soft/40")}>
      <QueueRow
        icon={icon}
        tone={tone}
        title={order.orderNumber}
        meta={meta || "—"}
        note={
          blocked ? (
            <span className="flex items-center gap-1.5 text-destructive-soft-foreground">
              <AlertTriangle className="size-3.5" />
              {order.blockedReason ??
                `${order.exceptionCount} ${order.exceptionCount === 1 ? "exceção" : "exceções"}`}
              {onTreat ? (
                <button type="button" onClick={onTreat} className="font-medium underline">
                  Tratar
                </button>
              ) : null}
            </span>
          ) : undefined
        }
        detail={detail}
        onToggle={items.length ? () => setOpen((value) => !value) : undefined}
        open={open}
        actions={
          acoes || menu ? (
            <>
              {acoes}
              {menu}
            </>
          ) : null
        }
        actionsClassName="hidden sm:flex"
      />
      {open && items.length ? <ItemList items={items} /> : null}
      {/* No celular os botões vêm depois da lista do que separar. */}
      {acoes || menu ? (
        <div className="flex gap-2 px-4 pb-4 pt-3 sm:hidden">
          {acoes ? <div className="flex flex-1 gap-2 [&>*]:flex-1">{acoes}</div> : null}
          {menu}
        </div>
      ) : null}
    </div>
  );
}

function MenuDoPedido({
  order,
  disabled,
  onCancelar,
}: {
  order: OrderGroup;
  disabled: boolean;
  onCancelar: () => void;
}) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="icon" disabled={disabled} aria-label={`Mais ações do pedido ${order.orderNumber}`}>
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={onCancelar}>
          <XCircle className="size-4" />
          Cancelar pedido
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ItemList({ items }: { items: NonNullable<WarehouseTask["items"]> }) {
  // Mesma foto do Estoque: quem separa confere o item pela imagem.
  const photoFor = useItemPhotos();
  return (
    <ul className="border-t border-border/50 bg-muted/30 px-4 py-2 md:px-5 md:pl-[4.6rem]">
      {items.map((item, index) => {
        const photo = photoFor(item.sku_code, item.sku, item.client_item_code);
        return (
          <li key={String(item.id ?? index)} className="flex items-center gap-3 py-1.5 text-sm">
            {photo ? (
              <img
                src={photo}
                alt=""
                loading="lazy"
                className="size-11 shrink-0 rounded-lg bg-muted object-cover"
              />
            ) : (
              <span className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-dashed border-border text-muted-foreground">
                <Package className="size-4" aria-hidden="true" />
              </span>
            )}
            <div className="grid min-w-0 flex-1 grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-0.5 sm:flex">
              <span className="rounded-md bg-info-soft px-1.5 py-0.5 font-mono text-xs text-info-soft-foreground">
                {item.location || "sem endereço"}
              </span>
              <span className="font-mono text-sm text-foreground/85">
                {item.sku_code ?? item.sku}
              </span>
              <span className="whitespace-nowrap font-semibold tabular-nums sm:order-last">
                {numberFormatter.format(Number(item.expected_quantity ?? item.quantity ?? 0))} un.
              </span>
              <span className="col-span-3 min-w-0 truncate text-foreground/60 sm:flex-1">
                {item.name ?? item.product_name}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
