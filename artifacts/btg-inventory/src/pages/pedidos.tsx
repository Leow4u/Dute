import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Check,
  ClipboardCheck,
  Package,
  RefreshCw,
  Truck,
  type LucideIcon,
} from "lucide-react";
import { Link } from "wouter";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { QueueGroup, QueueRow, type QueueTone } from "@/components/ui/queue-list";
import { Segmented } from "@/components/ui/segmented";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ExceptionDialog, useWarehouseTaskActions } from "@/features/warehouse-ops/task-actions";
import { TaskDetailPanel } from "@/features/warehouse-ops/task-detail";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAppUser } from "@/lib/auth";
import { buildOrderQueue } from "@/lib/order-queue";
import { useItemPhotos } from "@/lib/use-item-photos";
import { canDecideRequests, humanApiError } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import {
  type LineConfirmationMap,
  type WarehouseOpsResponse,
  type WarehouseTask,
  lineConfirmationKey,
  normalizeQueues,
  queueEntries,
} from "@/lib/warehouse-ops/model";
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

type DialogState =
  | { kind: "reject"; request: CustomerRequest }
  | { kind: "pick"; order: OrderGroup }
  | { kind: "deliver"; order: OrderGroup }
  | null;

export default function Pedidos() {
  const { user } = useAppUser();
  const decider = canDecideRequests(user?.publicMetadata.role);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [view, setView] = useState<"open" | "delivered">("open");
  const [dialog, setDialog] = useState<DialogState>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [seal, setSeal] = useState("");
  const [driver, setDriver] = useState(() => remembered("motorista", "Equipe Dutelog"));
  const [plate, setPlate] = useState(() => remembered("placa", ""));
  const [receivedBy, setReceivedBy] = useState("");
  // "Tratar": a tarefa bloqueada do pedido abre aqui mesmo, num painel.
  const [treating, setTreating] = useState<OrderGroup | null>(null);
  const [lineConfirmations, setLineConfirmations] = useState<LineConfirmationMap>({});

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

  const pick = useMutation({
    mutationFn: async ({ order, sealCode }: { order: OrderGroup; sealCode: string }) => {
      const pickTask = order.pick;
      if (pickTask && pickTask.status !== "completed") {
        if (String(pickTask.status) === "planned") {
          await advance(String(pickTask.id), "planned");
        }
        await advance(String(pickTask.id), "in_progress", {
          picking_lines: (pickTask.items ?? []).map((item) => ({
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
          packing_lines: (packTask.items ?? []).map((item) => ({
            order_item_id: String(item.id ?? ""),
            qty_packed: Number(item.picked_quantity ?? item.quantity ?? 0),
            status: "confirmed",
          })),
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

  const busy = decide.isPending || pick.isPending || deliver.isPending;
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

      {loading ? (
        <p className="text-sm text-muted-foreground">Carregando pedidos...</p>
      ) : view === "delivered" ? (
        <>
          <QueueGroup
            title="Entregues"
            hint="recentes"
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
              hint="coordenação"
              count={queue.approve.length}
              empty="Nenhuma solicitação esperando aprovação."
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
                          {validation.detail} Confira antes de aprovar.
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
            hint="armazém"
            count={queue.pick.length}
            empty="Nada para separar agora."
          >
            {queue.pick.map((order) => (
              <OrderRow
                key={order.key}
                order={order}
                icon={Package}
                tone="pick"
                defaultOpen
                onTreat={() => setTreating(order)}
                action={
                  <Button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setSeal("");
                      setDialog({ kind: "pick", order });
                    }}
                  >
                    <Check className="size-4" />
                    Separado
                  </Button>
                }
              />
            ))}
          </QueueGroup>

          <QueueGroup
            title="Para entregar"
            hint="hoje"
            count={queue.deliver.length}
            empty="Nenhum pedido esperando entrega."
          >
            {queue.deliver.map((order) => (
              <OrderRow
                key={order.key}
                order={order}
                icon={Truck}
                tone="deliver"
                onTreat={() => setTreating(order)}
                action={
                  <Button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setReceivedBy("");
                      setDialog({ kind: "deliver", order });
                    }}
                  >
                    <Check className="size-4" />
                    Entregue
                  </Button>
                }
              />
            ))}
          </QueueGroup>
        </>
      )}

      <Dialog open={dialog !== null} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent className="sm:max-w-[440px]">
          {dialog?.kind === "reject" ? (
            <>
              <DialogHeader>
                <DialogTitle>Recusar solicitação</DialogTitle>
                <DialogDescription>
                  O motivo fica registrado e aparece para o cliente.
                </DialogDescription>
              </DialogHeader>
              <Textarea
                value={rejectReason}
                onChange={(event) => setRejectReason(event.target.value)}
                placeholder="Ex.: sem saldo de 2 itens. Confirme os códigos e envie de novo."
                rows={3}
              />
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
                <DialogDescription>
                  Anote o lacre do volume para conferir na entrega.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-2">
                <Label htmlFor="lacre">Número do lacre</Label>
                <Input
                  id="lacre"
                  value={seal}
                  onChange={(event) => setSeal(event.target.value)}
                  autoFocus
                />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDialog(null)}>
                  Voltar
                </Button>
                <Button
                  type="button"
                  disabled={!seal.trim() || busy}
                  onClick={() => pick.mutate({ order: dialog.order, sealCode: seal.trim() })}
                >
                  {pick.isPending ? "Registrando..." : "Confirmar"}
                </Button>
              </DialogFooter>
            </>
          ) : dialog?.kind === "deliver" ? (
            <>
              <DialogHeader>
                <DialogTitle>{dialog.order.orderNumber}: entregue</DialogTitle>
                <DialogDescription>
                  Confirma a saída e a entrega de uma vez. O estoque é baixado.
                </DialogDescription>
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
                    placeholder="Nome de quem assinou"
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
          ) : null}
        </DialogContent>
      </Dialog>

      <Sheet open={treating !== null} onOpenChange={(open) => !open && setTreating(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto bg-background p-4 sm:max-w-xl sm:p-5">
          <SheetHeader className="mb-3 text-left">
            <SheetTitle>{treating ? `Tratar ${treating.orderNumber}` : "Tratar pedido"}</SheetTitle>
            <SheetDescription>
              Marque o que faltou ou avariou por item, registre a exceção ou avance a etapa. Tudo fica na trilha do pedido.
            </SheetDescription>
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
  defaultOpen = false,
  onTreat,
}: {
  order: OrderGroup;
  icon: LucideIcon;
  tone: QueueTone;
  action?: ReactNode;
  defaultOpen?: boolean;
  onTreat?: () => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const items = orderItems(order);
  const units = orderUnits(order);
  const seal = order.pack?.seal_code ?? order.ship?.seal_code;
  const blocked = Boolean(order.blockedReason || order.exceptionCount);
  const meta = [
    items.length ? `${items.length} ${items.length === 1 ? "item" : "itens"}` : null,
    units ? `${numberFormatter.format(units)} un.` : null,
    seal ? `lacre ${seal}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

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
        onToggle={items.length ? () => setOpen((value) => !value) : undefined}
        open={open}
        actions={action}
        actionsClassName="hidden sm:flex"
      />
      {open && items.length ? <ItemList items={items} /> : null}
      {/* No celular o botão vem depois da lista do que separar. */}
      {action ? (
        <div className="flex px-4 pb-4 pt-3 sm:hidden [&>*]:flex-1">{action}</div>
      ) : null}
    </div>
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
