/**
 * Pedidos — a fila única do operador para atender a Cristiane.
 *
 * O motor continua sendo a cadeia auditável pick → pack → ship (reserva,
 * lacre, baixa por entrega); esta tela só a percorre em três ações:
 * "Marcar separado" (conclui picking e packing), "Marcar enviado"
 * (expedição — entrega própria) e "Confirmar entrega" (baixa o estoque).
 * Exceções continuam nas telas por etapa (/wms/picking etc.), acessíveis
 * pelo link "Tratar exceção" do cartão.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Inbox,
  PackageCheck,
  RefreshCw,
  Truck,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { humanApiError } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import type {
  WarehouseOpsResponse,
  WarehouseTask,
} from "@/lib/warehouse-ops/model";
import {
  groupWarehouseOrders,
  queueTasks,
  type OrderGroup,
  type OrderStage,
} from "@/lib/warehouse-ops/orders";

const STAGE_LABEL: Record<OrderStage, string> = {
  separar: "Separar",
  enviar: "Pronto para envio",
  entregar: "Em rota de entrega",
  entregue: "Entregue",
};

const STAGE_BADGE: Record<OrderStage, string> = {
  separar: "border-amber-200 bg-amber-50 text-amber-800",
  enviar: "border-blue-200 bg-blue-50 text-blue-700",
  entregar: "border-violet-200 bg-violet-50 text-violet-700",
  entregue: "border-emerald-200 bg-emerald-50 text-emerald-700",
};

const numberFormatter = new Intl.NumberFormat("pt-BR");

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    const error = new Error(text || `HTTP ${response.status}`) as Error & {
      data?: unknown;
    };
    error.data = data;
    throw error;
  }
  return response.json() as Promise<T>;
}

function taskUnits(task?: WarehouseTask): number {
  return Number(task?.quantity ?? 0) || (task?.items ?? []).reduce(
    (sum, item) => sum + Number(item.quantity ?? 0),
    0,
  );
}

/** Persistência leve dos padrões de entrega própria entre pedidos. */
function rememberedField(key: string, fallback: string): string {
  try {
    return window.localStorage.getItem(`wms-pedidos:${key}`) || fallback;
  } catch {
    return fallback;
  }
}

function rememberField(key: string, value: string) {
  try {
    window.localStorage.setItem(`wms-pedidos:${key}`, value);
  } catch {
    // storage indisponível não pode travar a operação
  }
}

export default function WmsPedidos() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeOrder, setActiveOrder] = useState<OrderGroup | null>(null);
  const [dialogStage, setDialogStage] = useState<OrderStage | null>(null);
  const [sealCode, setSealCode] = useState(() => rememberedField("lacre", ""));
  const [driverName, setDriverName] = useState(() =>
    rememberedField("motorista", "Equipe Dutelog"),
  );
  const [vehiclePlate, setVehiclePlate] = useState(() =>
    rememberedField("placa", ""),
  );
  const [deliveryProof, setDeliveryProof] = useState("");
  const [deliveryNotes, setDeliveryNotes] = useState("");

  const ops = useQuery({
    queryKey: ["warehouse-ops"],
    queryFn: () => fetchJson<WarehouseOpsResponse>("/api/warehouse/ops"),
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
  });

  const orders = useMemo(() => groupWarehouseOrders(ops.data), [ops.data]);

  const advanceChain = useMutation({
    mutationFn: async ({
      order,
      stage,
    }: {
      order: OrderGroup;
      stage: OrderStage;
    }) => {
      const advance = async (
        taskUid: string,
        expectedStatus: string,
        operation?: Record<string, unknown>,
        note?: string,
      ) => {
        await fetchJson(
          `/api/warehouse/tasks/${encodeURIComponent(taskUid)}/advance`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              expected_status: expectedStatus,
              operation,
              note,
              idempotency_key: `${taskUid}:${expectedStatus}`,
            }),
          },
        );
      };
      const refreshOps = async () => {
        await queryClient.invalidateQueries({ queryKey: ["warehouse-ops"] });
        return fetchJson<WarehouseOpsResponse>("/api/warehouse/ops");
      };

      if (stage === "separar") {
        const seal = sealCode.trim();
        if (!seal) {
          throw new Error("Informe o lacre ou identificação do volume.");
        }
        rememberField("lacre", seal);

        // Picking: conferência linha a linha com as quantidades planejadas.
        const pick = order.pick;
        if (pick && pick.status !== "completed") {
          if (String(pick.status) === "planned") {
            await advance(String(pick.id), "planned");
          }
          const pickingLines = (pick.items ?? []).map((item) => ({
            pick_line_id: String(item.id ?? ""),
            qty_picked: Number(item.expected_quantity ?? item.quantity ?? 0),
            status: "confirmed",
          }));
          await advance(String(pick.id), "in_progress", {
            picking_lines: pickingLines,
          });
        }

        // Packing: o pack task nasce na conclusão do picking — recarrega a
        // fila para obter os order_items exigidos pela conferência.
        const packUid = order.pack
          ? String(order.pack.id)
          : `packing:pack_${order.key}`;
        const fresh = await refreshOps();
        const packTask = queueTasks(fresh, "packing").find(
          (task) => String(task.id) === packUid,
        );
        if (!packTask) {
          throw new Error(
            "Packing ainda não disponível — atualize e tente de novo.",
          );
        }
        if (packTask.status !== "completed") {
          if (String(packTask.status) === "ready") {
            await advance(packUid, "ready");
          }
          const packingLines = (packTask.items ?? []).map((item) => ({
            order_item_id: String(item.id ?? ""),
            qty_packed: Number(item.picked_quantity ?? item.quantity ?? 0),
            status: "confirmed",
          }));
          await advance(packUid, "in_progress", {
            packing_lines: packingLines,
            package_count: 1,
            volume_label: "VOL-1",
            seal_code: seal,
          });
        }
        return "Pedido separado e embalado. Pronto para envio.";
      }

      if (stage === "enviar") {
        const driver = driverName.trim();
        const plate = vehiclePlate.trim();
        if (!driver || !plate) {
          throw new Error("Informe quem leva e a placa do veículo.");
        }
        rememberField("motorista", driver);
        rememberField("placa", plate);
        await advance(String(order.ship?.id), "ready_to_dispatch", {
          carrier: "Dutelog",
          driver_name: driver,
          vehicle_plate: plate,
        });
        return "Pedido em rota — entrega própria Dutelog.";
      }

      // entrega
      const proof = deliveryProof.trim() || "Entrega própria Dutelog";
      await advance(String(order.ship?.id), "dispatched", {
        proof_reference: proof,
        delivery_notes: deliveryNotes.trim() || "Recebido pelo cliente.",
      });
      return "Entrega confirmada — estoque baixado.";
    },
    onSuccess: (message) => {
      toast({ title: message });
      setDialogStage(null);
      setActiveOrder(null);
      setDeliveryProof("");
      setDeliveryNotes("");
      void queryClient.invalidateQueries({ queryKey: ["warehouse-ops"] });
      void queryClient.invalidateQueries({ queryKey: ["customer-requests"] });
    },
    onError: (error) => {
      toast({
        title: "Não consegui avançar o pedido",
        description: humanApiError(error, "Tente novamente em instantes."),
        variant: "destructive",
      });
    },
  });

  const openDialog = (order: OrderGroup) => {
    setActiveOrder(order);
    setDialogStage(order.stage);
  };

  const pending = orders.filter((order) => order.stage !== "entregue");
  const delivered = orders.filter((order) => order.stage === "entregue");

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="border-b border-border/60">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <CardTitle className="text-base">Pedidos da Cristiane</CardTitle>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => ops.refetch()}
              disabled={ops.isFetching}
            >
              <RefreshCw
                className={cn("h-4 w-4", ops.isFetching && "animate-spin")}
              />
              Atualizar
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 pt-5">
          {ops.isLoading ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              Carregando pedidos...
            </div>
          ) : pending.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
              <Inbox className="h-6 w-6" />
              Nenhum pedido aberto. Quando a Cristiane pedir, aparece aqui.
            </div>
          ) : (
            pending.map((order) => (
              <OrderCard
                key={order.key}
                order={order}
                busy={advanceChain.isPending}
                onAction={() => openDialog(order)}
              />
            ))
          )}
        </CardContent>
      </Card>

      {delivered.length > 0 ? (
        <Card>
          <CardHeader className="border-b border-border/60">
            <CardTitle className="text-base">Entregues recentemente</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-5">
            {delivered.map((order) => (
              <OrderCard key={order.key} order={order} busy onAction={() => {}} />
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Dialog
        open={dialogStage !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDialogStage(null);
            setActiveOrder(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>
              {dialogStage === "separar"
                ? `Separar ${activeOrder?.orderNumber ?? ""}`
                : dialogStage === "enviar"
                  ? `Enviar ${activeOrder?.orderNumber ?? ""}`
                  : `Confirmar entrega de ${activeOrder?.orderNumber ?? ""}`}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {dialogStage === "separar" ? (
              <>
                <ItemsSummary task={activeOrder?.pick ?? activeOrder?.pack} />
                <div className="space-y-2">
                  <Label htmlFor="lacre">Lacre / identificação do volume *</Label>
                  <Input
                    id="lacre"
                    value={sealCode}
                    onChange={(event) => setSealCode(event.target.value)}
                    placeholder="Ex.: LACRE-0001 ou CAIXA-AZUL"
                  />
                  <p className="text-xs text-muted-foreground">
                    Confirma que as quantidades acima foram separadas e
                    embaladas num volume identificado.
                  </p>
                </div>
              </>
            ) : dialogStage === "enviar" ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="motorista">Quem leva *</Label>
                  <Input
                    id="motorista"
                    value={driverName}
                    onChange={(event) => setDriverName(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="placa">Placa do veículo *</Label>
                  <Input
                    id="placa"
                    value={vehiclePlate}
                    onChange={(event) => setVehiclePlate(event.target.value)}
                    placeholder="ABC1D23"
                  />
                </div>
              </>
            ) : (
              <>
                <div className="space-y-2">
                  <Label htmlFor="comprovante">Quem recebeu</Label>
                  <Input
                    id="comprovante"
                    value={deliveryProof}
                    onChange={(event) => setDeliveryProof(event.target.value)}
                    placeholder="Ex.: Cristiane — recepção BTG"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="obs-entrega">Observação</Label>
                  <Input
                    id="obs-entrega"
                    value={deliveryNotes}
                    onChange={(event) => setDeliveryNotes(event.target.value)}
                    placeholder="Opcional"
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Ao confirmar, o estoque é baixado definitivamente.
                </p>
              </>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setDialogStage(null);
                setActiveOrder(null);
              }}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={advanceChain.isPending}
              onClick={() => {
                if (activeOrder && dialogStage) {
                  advanceChain.mutate({ order: activeOrder, stage: dialogStage });
                }
              }}
            >
              {advanceChain.isPending
                ? "Registrando..."
                : dialogStage === "separar"
                  ? "Marcar separado"
                  : dialogStage === "enviar"
                    ? "Marcar enviado"
                    : "Confirmar entrega"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ItemsSummary({ task }: { task?: WarehouseTask }) {
  const items = task?.items ?? [];
  if (!items.length) return null;
  return (
    <div className="rounded-[16px] border border-border bg-white/70 p-3 text-sm">
      {items.map((item) => (
        <div
          key={String(item.id ?? item.sku_code)}
          className="flex items-center justify-between gap-3 py-1"
        >
          <span className="truncate text-muted-foreground">
            {String(item.name ?? item.product_name ?? item.sku_code ?? "Item")}
          </span>
          <span className="shrink-0 font-medium">
            {numberFormatter.format(
              Number(item.expected_quantity ?? item.quantity ?? 0),
            )}{" "}
            un.
          </span>
        </div>
      ))}
    </div>
  );
}

function OrderCard({
  order,
  busy,
  onAction,
}: {
  order: OrderGroup;
  busy: boolean;
  onAction: () => void;
}) {
  const stageIcon =
    order.stage === "separar" ? (
      <ClipboardCheck className="h-4 w-4" />
    ) : order.stage === "enviar" ? (
      <PackageCheck className="h-4 w-4" />
    ) : order.stage === "entregar" ? (
      <Truck className="h-4 w-4" />
    ) : (
      <CheckCircle2 className="h-4 w-4" />
    );
  const units = taskUnits(order.pick) || taskUnits(order.ship) || taskUnits(order.pack);
  const actionLabel =
    order.stage === "separar"
      ? "Marcar separado"
      : order.stage === "enviar"
        ? "Marcar enviado"
        : order.stage === "entregar"
          ? "Confirmar entrega"
          : null;
  const exceptionHref =
    order.stage === "separar" ? "/wms/picking" : "/wms/expedicao";

  return (
    <div className="soft-panel rounded-[18px] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-foreground">
              {order.orderNumber}
            </span>
            <Badge variant="outline" className={STAGE_BADGE[order.stage]}>
              <span className="mr-1">{stageIcon}</span>
              {STAGE_LABEL[order.stage]}
            </Badge>
            {order.exceptionCount > 0 ? (
              <Badge
                variant="outline"
                className="border-rose-200 bg-rose-50 text-rose-700"
              >
                <AlertTriangle className="mr-1 h-3.5 w-3.5" />
                {order.exceptionCount} exceção(ões)
              </Badge>
            ) : null}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {numberFormatter.format(units)} un. ·{" "}
            {(order.pick?.items ?? order.pack?.items ?? []).length || "—"}{" "}
            linha(s)
          </div>
          {order.blockedReason ? (
            <div className="mt-2 rounded-[12px] border border-rose-100 bg-rose-50/60 px-3 py-2 text-xs text-rose-700">
              {order.blockedReason}
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {order.exceptionCount > 0 || order.blockedReason ? (
            <Button asChild type="button" variant="outline" size="sm">
              <Link href={exceptionHref}>Tratar exceção</Link>
            </Button>
          ) : null}
          {actionLabel ? (
            <Button type="button" size="sm" disabled={busy} onClick={onAction}>
              {actionLabel}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
