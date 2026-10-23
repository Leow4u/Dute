import type { WarehouseOpsResponse } from "./warehouse-ops/model";
import { groupWarehouseOrders, type OrderGroup } from "./warehouse-ops/orders";

/**
 * A operação tem três passos: a coordenação aprova, o armazém separa, e o
 * pedido é entregue no mesmo dia. As etapas internas do WMS (picking,
 * packing, expedição, em rota) continuam no backend; aqui viram grupos.
 */
export type QueueRequest = {
  id: string;
  status?: string | null;
  created_at?: unknown;
  priority?: string | null;
};

export type OrderQueue<R extends QueueRequest> = {
  approve: R[];
  pick: OrderGroup[];
  deliver: OrderGroup[];
  delivered: OrderGroup[];
};

const AWAITING_DECISION = new Set([
  "open",
  "aberta",
  "aberto",
  "submitted",
  "enviada",
  "enviado",
  "pending",
  "pendente",
  "em-analise",
  "em analise",
]);

export function isAwaitingDecision(status: unknown) {
  const normalized = String(status || "open")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
  return AWAITING_DECISION.has(normalized);
}

function priorityWeight(priority?: string | null) {
  const normalized = String(priority ?? "").toLowerCase();
  if (["critica", "crítica", "critical", "urgente"].includes(normalized)) return 0;
  if (["alta", "high"].includes(normalized)) return 1;
  return 2;
}

function requestTime(value: unknown) {
  if (!value) return 0;
  if (typeof value === "object") {
    const seconds = Number(
      (value as { seconds?: unknown; _seconds?: unknown }).seconds ??
        (value as { _seconds?: unknown })._seconds,
    );
    return Number.isFinite(seconds) ? seconds * 1000 : 0;
  }
  const time = new Date(String(value)).getTime();
  return Number.isFinite(time) ? time : 0;
}

export function buildOrderQueue<R extends QueueRequest>({
  requests,
  ops,
}: {
  requests?: R[];
  ops?: WarehouseOpsResponse;
}): OrderQueue<R> {
  const orders = groupWarehouseOrders(ops);
  // Exceções primeiro: são as que travam o armazém.
  const blockedFirst = (left: OrderGroup, right: OrderGroup) =>
    Number(Boolean(right.blockedReason || right.exceptionCount)) -
    Number(Boolean(left.blockedReason || left.exceptionCount));

  return {
    approve: (requests ?? [])
      .filter((request) => isAwaitingDecision(request.status))
      .sort(
        (left, right) =>
          priorityWeight(left.priority) - priorityWeight(right.priority) ||
          requestTime(left.created_at) - requestTime(right.created_at),
      ),
    pick: orders.filter((order) => order.stage === "separar").sort(blockedFirst),
    // "Pronto para envio" e "em rota" são a mesma coisa para quem entrega no
    // mesmo dia: falta confirmar a entrega.
    deliver: orders
      .filter((order) => order.stage === "enviar" || order.stage === "entregar")
      .sort(blockedFirst),
    delivered: orders.filter((order) => order.stage === "entregue"),
  };
}

/** O grupo vazio diz o dado, sem ensinar o fluxo (sem legenda, parte 4.7c). */
export function ordersGroupEmpty(group: "approve" | "pick" | "deliver") {
  if (group === "approve") return "Nenhum pedido para aprovar.";
  if (group === "pick") return "Nenhum pedido para separar.";
  return "Nenhum pedido para entregar.";
}

/**
 * A linha da ação principal da tela (v3, parte 4.7c): a primeira da fila, na
 * ordem aprovar (para quem decide), separar e entregar. As outras ações da
 * fila são secundárias. "approve:<id>", "pick:<pedido>" ou "deliver:<pedido>".
 */
export function chaveDaPrincipal<R extends QueueRequest>(queue: Pick<OrderQueue<R>, "approve" | "pick" | "deliver">, decider: boolean): string | null {
  if (decider && queue.approve[0]) return `approve:${queue.approve[0].id}`;
  if (queue.pick[0]) return `pick:${queue.pick[0].key}`;
  if (queue.deliver[0]) return `deliver:${queue.deliver[0].key}`;
  return null;
}
