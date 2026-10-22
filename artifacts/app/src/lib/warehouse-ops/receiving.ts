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

export type ShipmentNotice = {
  id: string;
  customer_code: string;
  number: string;
  supplier: string;
  invoice: string;
  units: number;
};

function noticeUnits(request: Record<string, unknown>) {
  const items = Array.isArray(request.items) ? request.items : [];
  const fromItems = items.reduce<number>((sum, item) => {
    const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const quantity = Number(row.quantity ?? row.qty ?? 0);
    return sum + (Number.isFinite(quantity) ? quantity : 0);
  }, 0);
  if (fromItems > 0) return fromItems;
  const total = Number(request.quantity_total ?? request.quantity ?? 0);
  return Number.isFinite(total) ? total : 0;
}

/** Avisos de envio que a coordenação ainda não aprovou. Saída e aviso já decidido ficam de fora. */
export function openShipmentNotices(requests: Array<Record<string, unknown>>): ShipmentNotice[] {
  return requests.flatMap((request) => {
    const id = coerceText(request.id);
    const type = coerceText(request.type);
    if (!id || !/receb|inbound/i.test(type) || coerceText(request.status) !== "open") return [];
    return [{
      id,
      customer_code: coerceText(request.customer_code),
      number: coerceText(request.request_number),
      supplier: coerceText(request.supplier),
      invoice: coerceText(request.invoice_number),
      units: noticeUnits(request),
    }];
  });
}

/**
 * Aviso já vinculado a uma chegada do quadro sai da lista: a chegada o
 * representa até a aprovação. `keepRequestId` mantém o aviso da própria
 * chegada na ficha dela.
 */
export function unlinkedShipmentNotices(
  notices: ShipmentNotice[],
  tasks: WarehouseTask[],
  keepRequestId?: string | null,
) {
  const linked = new Set(tasks.map((task) => coerceText(task.customer_request_id)).filter(Boolean));
  if (keepRequestId) linked.delete(keepRequestId);
  return notices.filter((notice) => !linked.has(notice.id));
}

/** "ENV-0001 · Camisaria Alfa · NF 1842 · Avulsa · 10 un." */
export function receivingArrivalMeta(
  task: WarehouseTask,
  notice?: Pick<ShipmentNotice, "number" | "supplier" | "invoice"> | null,
) {
  const base = receivingRowMeta(task);
  if (!notice) return base;
  return [notice.number, notice.supplier, notice.invoice ? `NF ${notice.invoice}` : null, base]
    .filter(Boolean)
    .join(" · ");
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
