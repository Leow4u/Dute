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

// ------------------------------------------------- chegada avulsa pela nota

const THOUSANDS = /^\d{1,3}(\.\d{3})+$/;

/** Quantidade digitada na conferência da nota: "1.200", "1.200,5" e "1200.5" valem o que parecem. */
export function parseQuantity(value: string | number) {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : 0;
  const raw = value.trim();
  const plain = raw.includes(",")
    ? raw.replace(/\./g, "").replace(",", ".")
    : THOUSANDS.test(raw)
      ? raw.replace(/\./g, "")
      : raw;
  const parsed = Number(plain);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export type InvoiceLineInput = { code: string; name: string; quantity: string | number };

/** O que o cadastro sabe do código: entra na linha como "Usar cadastro". */
export type CatalogFill = { skuCode: string; clientCode: string; productName: string; unitCost: number };

type DraftLine = {
  sku: string;
  clientCode: string;
  product: string;
  quantity: string;
  unitCost: string;
  createNew: boolean;
};

/**
 * Itens lidos da nota viram linhas da chegada avulsa. Item com código já no
 * cadastro entra com SKU, nome e custo do cadastro, como "Usar cadastro".
 * Item sem código entra só com nome e quantidade: o operador lê a etiqueta
 * da peça e informa o código. O mesmo código em duas linhas soma, e a linha
 * vazia inicial some.
 */
export function receiptLinesFromInvoice<Line extends DraftLine>(
  current: Line[],
  selected: InvoiceLineInput[],
  options: { emptyLine: () => Line; lookup: (code: string) => CatalogFill | undefined },
): Line[] {
  const key = (value: string) => value.trim().toUpperCase();
  const next = current
    .filter((line) => line.clientCode.trim() || line.sku.trim() || line.product.trim())
    .map((line) => ({ ...line }));
  for (const item of selected) {
    const code = item.code.trim();
    const name = item.name.trim();
    if (!code && !name) continue;
    const quantity = parseQuantity(item.quantity);
    const same = code ? next.find((line) => key(line.clientCode || line.sku) === key(code)) : undefined;
    if (same) {
      same.quantity = String(parseQuantity(same.quantity) + quantity);
      continue;
    }
    const fill = code ? options.lookup(code) : undefined;
    next.push({
      ...options.emptyLine(),
      clientCode: fill?.clientCode || code,
      sku: fill?.skuCode ?? "",
      product: fill?.productName || name,
      unitCost: fill && fill.unitCost > 0 ? String(fill.unitCost) : "",
      quantity: String(quantity),
      createNew: false,
    });
  }
  return next.length ? next : [options.emptyLine()];
}
