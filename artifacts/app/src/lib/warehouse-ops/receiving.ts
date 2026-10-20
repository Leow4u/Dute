import {
  type NormalizedQueue,
  type TaskQueueEntry,
  type WarehouseTask,
  coerceNumber,
  coerceText,
  formatDate,
  formatNumber,
  isTerminalTask,
  normalizeStatus,
  statusLabel,
} from "./model";

/**
 * Receber em três grupos, como Pedidos: o que chegou e precisa de
 * conferência, o que foi conferido e espera endereço, e o que terminou.
 */
export type ReceivingBoard = {
  check: TaskQueueEntry[];
  store: TaskQueueEntry[];
  done: TaskQueueEntry[];
};

function lastActivityTime(task: WarehouseTask) {
  const events = task.timeline ?? [];
  const last = events[events.length - 1];
  const value =
    last?.occurred_at || last?.created_at || last?.at || task.due_at || task.created_at || "";
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}

export function buildReceivingBoard(queues: NormalizedQueue[]): ReceivingBoard {
  const entriesOf = (key: "receiving" | "putaway"): TaskQueueEntry[] => {
    const queue = queues.find((candidate) => candidate.key === key);
    return queue ? queue.tasks.map((task) => ({ task, queue })) : [];
  };
  const receiving = entriesOf("receiving");
  const putaway = entriesOf("putaway");
  return {
    check: receiving.filter(({ task }) => !isTerminalTask(task)),
    store: putaway.filter(({ task }) => !isTerminalTask(task)),
    done: [...receiving, ...putaway]
      .filter(({ task }) => isTerminalTask(task))
      .sort((left, right) => lastActivityTime(right.task) - lastActivityTime(left.task)),
  };
}

export function isUnplannedReceipt(task: WarehouseTask) {
  return String(task.reference || task.id).includes("inb_avulso");
}

function unitsText(task: WarehouseTask) {
  const units = coerceNumber(task.quantity ?? task.total_units);
  return units ? `${formatNumber(units)} un.` : "qtde aberta";
}

/** "Prevista · em conferência · 1 linha · 1.000 un. · prazo 09/10/2026, 14:00" */
export function receivingRowMeta(task: WarehouseTask) {
  const lines = task.items?.length ?? 0;
  const status = normalizeStatus(task.status);
  return [
    isUnplannedReceipt(task) ? "Avulsa" : "Prevista",
    status && status !== "planned" ? statusLabel(task.status) : null,
    lines ? `${formatNumber(lines)} ${lines === 1 ? "linha" : "linhas"}` : null,
    unitsText(task),
    task.due_at ? `prazo ${formatDate(task.due_at)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** "280 un. · está em RECEBIMENTO · guardar em A-03-2" */
export function putawayRowMeta(task: WarehouseTask) {
  const firstItem = task.items?.[0];
  const source =
    coerceText(task.source_location_id, firstItem?.source_location_id) || "RECEBIMENTO";
  const destination = coerceText(
    task.destination_location_id,
    task.location,
    firstItem?.destination_location_id,
  );
  const status = normalizeStatus(task.status);
  return [
    unitsText(task),
    `está em ${source}`,
    destination && destination.toUpperCase() !== source.toUpperCase()
      ? `guardar em ${destination}`
      : null,
    status === "in_progress" ? "em execução" : null,
  ]
    .filter(Boolean)
    .join(" · ");
}
