import type { WarehouseOpsResponse, WarehouseTask } from "./model";

// Pedido de saída = trio picking → packing → expedição da mesma ordem. A tela
// "Separar e enviar" e o Início contam a partir do mesmo agrupamento.

export type OrderStage = "separar" | "enviar" | "entregar" | "entregue";

export type OrderGroup = {
  key: string;
  orderNumber: string;
  requestId?: string;
  /** O pedido de saída (orders/{id}), quando a tarefa o traz. */
  orderId?: string;
  pick?: WarehouseTask;
  pack?: WarehouseTask;
  ship?: WarehouseTask;
  stage: OrderStage;
  blockedReason?: string;
  exceptionCount: number;
};

export function queueTasks(
  ops: WarehouseOpsResponse | undefined,
  key: string,
): WarehouseTask[] {
  const queues = ops?.queues;
  if (!queues) return [];
  if (Array.isArray(queues)) {
    const queue = queues.find((entry) => entry.key === key);
    return (queue?.tasks ?? queue?.items ?? []) as WarehouseTask[];
  }
  const queue = (queues as Record<string, { tasks?: WarehouseTask[]; items?: WarehouseTask[] }>)[
    key
  ];
  return (queue?.tasks ?? queue?.items ?? []) as WarehouseTask[];
}

function orderKeyForTask(task: WarehouseTask): string {
  // pick_ord_X / pack_ord_X / ship_ord_X compartilham o sufixo ord_X.
  const reference = String(task.reference ?? "");
  const match = reference.match(/^(?:pick|pack|ship)_(ord_.+)$/);
  if (match) return match[1];
  if (task.customer_request_id) return `ord_${task.customer_request_id}`;
  return reference || String(task.id);
}

function stageForGroup(group: Omit<OrderGroup, "stage">): OrderStage {
  const shipStatus = String(group.ship?.status ?? "");
  if (shipStatus === "delivered") return "entregue";
  if (shipStatus === "dispatched") return "entregar";
  if (shipStatus === "ready_to_dispatch") return "enviar";
  return "separar";
}

export function groupWarehouseOrders(
  ops: WarehouseOpsResponse | undefined,
): OrderGroup[] {
  const groups = new Map<string, Omit<OrderGroup, "stage">>();
  const attach = (task: WarehouseTask, slot: "pick" | "pack" | "ship") => {
    // Tarefas derivadas de dados legados não podem avançar (can_advance
    // false com status inicial); ficam fora da fila simples.
    if (task.can_advance === false && String(task.status) !== "completed"
      && String(task.status) !== "delivered") return;
    const key = orderKeyForTask(task);
    const group = groups.get(key) ?? {
      key,
      orderNumber: String(task.title ?? key),
      requestId: task.customer_request_id
        ? String(task.customer_request_id)
        : undefined,
      exceptionCount: 0,
    };
    group[slot] = task;
    group.orderNumber = String(task.title ?? group.orderNumber);
    if (task.order_id) group.orderId = String(task.order_id);
    if (task.customer_request_id) {
      group.requestId = String(task.customer_request_id);
    }
    group.exceptionCount += Number(task.exception_count ?? 0);
    if (task.blocked_reason && !group.blockedReason) {
      group.blockedReason = String(task.blocked_reason);
    }
    groups.set(key, group);
  };
  queueTasks(ops, "picking").forEach((task) => attach(task, "pick"));
  queueTasks(ops, "packing").forEach((task) => attach(task, "pack"));
  queueTasks(ops, "expedition").forEach((task) => attach(task, "ship"));

  const weight: Record<OrderStage, number> = {
    separar: 0,
    enviar: 1,
    entregar: 2,
    entregue: 3,
  };
  return [...groups.values()]
    .map((group) => ({ ...group, stage: stageForGroup(group) }))
    .sort((left, right) => weight[left.stage] - weight[right.stage]);
}
