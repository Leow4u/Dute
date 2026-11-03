import {
  type NormalizedQueue,
  type TaskQueueEntry,
  type WarehouseTask,
  type WarehouseTaskItem,
  coerceNumber,
  coerceText,
  formatDate,
  formatNumber,
  isTerminalTask,
  normalizeStatus,
  statusLabel,
} from "./model";
import { chegadaPorCaixa, totaisDaChegada } from "../wms/caixas-do-recebimento";

/**
 * Receber em grupos, como Pedidos: o que chegou e precisa de conferência, o
 * que foi conferido e espera endereço, e o que terminou. A chegada por caixa
 * recebida fica em aberto até a última guarda (decisão 5): "Recebidas, por
 * guardar".
 */
export type ReceivingBoard = {
  check: TaskQueueEntry[];
  /** A chegada por caixa com a entrada concluída e caixa ainda por guardar. */
  guardando: TaskQueueEntry[];
  store: TaskQueueEntry[];
  done: TaskQueueEntry[];
};

/** A chegada por caixa recebida e ainda com caixa por guardar. */
export function recebidaPorGuardar(task: WarehouseTask) {
  return chegadaPorCaixa(task) && normalizeStatus(task.status) === "received" && task.putaway_status === "pending";
}

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
    guardando: receiving.filter(({ task }) => recebidaPorGuardar(task)),
    store: putaway.filter(({ task }) => !isTerminalTask(task)),
    done: [...receiving, ...putaway]
      .filter(({ task }) => isTerminalTask(task) && !recebidaPorGuardar(task))
      .sort((left, right) => lastActivityTime(right.task) - lastActivityTime(left.task)),
  };
}

/**
 * A tarefa da ação principal da tela (v3, parte 4.7e): a primeira a conferir,
 * senão a primeira a guardar. As outras ações da fila são secundárias.
 */
export function tarefaPrincipal(board: Pick<ReceivingBoard, "check" | "store">): string | null {
  return (board.check[0] ?? board.store[0])?.task.id ?? null;
}

export function isUnplannedReceipt(task: WarehouseTask) {
  return String(task.reference || task.id).includes("inb_avulso");
}

/**
 * Linhas da chegada com falta, sobra ou divergência na conferência salva. Com
 * alguma delas, o servidor só conclui a entrada com a justificativa
 * (advanceWarehouseTaskTransaction). Vale para o Receber e para o painel da
 * tarefa.
 */
export function linhasDivergentesDoRecebimento(task: WarehouseTask): WarehouseTaskItem[] {
  return (task.items ?? []).filter((item) => {
    const difference =
      typeof item.difference_qty === "number"
        ? item.difference_qty
        : typeof item.received_qty === "number" || typeof item.picked_quantity === "number"
          ? coerceNumber(item.received_qty ?? item.picked_quantity) - coerceNumber(item.expected_quantity ?? item.quantity)
          : 0;
    return (
      difference !== 0 ||
      normalizeStatus(item.status) === "divergence" ||
      ["short", "over", "divergent"].includes(normalizeStatus(item.conference_status))
    );
  });
}

/** Concluir a chegada em conferência com divergência pede a justificativa. */
export function pedeJustificativaDoRecebimento(task: WarehouseTask): boolean {
  return normalizeStatus(task.status) === "checking" && linhasDivergentesDoRecebimento(task).length > 0;
}

export const MINIMO_DA_JUSTIFICATIVA_DO_RECEBIMENTO = 12;

export function problemaDaJustificativaDoRecebimento(nota: string): string | null {
  return nota.trim().length < MINIMO_DA_JUSTIFICATIVA_DO_RECEBIMENTO
    ? "Justifique a divergência física antes de concluir o recebimento."
    : null;
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

/** Aviso vinculado à chegada que já saiu de "open", lido à parte. */
export type LinkedShipmentNotice = {
  id: string;
  number: string;
  status: string;
  inbound_id: string;
};

export function linkedShipmentNotice(request: Record<string, unknown>): LinkedShipmentNotice {
  const created =
    request.created_entities && typeof request.created_entities === "object"
      ? (request.created_entities as Record<string, unknown>)
      : {};
  return {
    id: coerceText(request.id),
    number: coerceText(request.request_number),
    status: normalizeStatus(coerceText(request.status)),
    inbound_id: coerceText(created.inbound_id),
  };
}

export type NoticeOption = { id: string; title: string; detail: string };

export type NoticeLinkChoice = {
  editable: boolean;
  selectedId: string;
  options: NoticeOption[];
};

const DECIDED_NOTICE_LABEL: Record<string, string> = {
  approved: "aprovado",
  rejected: "recusado",
  cancelled: "cancelado",
};

function openNoticeOption(notice: ShipmentNotice): NoticeOption {
  return {
    id: notice.id,
    title: [notice.number, notice.supplier].filter(Boolean).join(" · "),
    detail: [notice.invoice ? `NF ${notice.invoice}` : null, "aguardando aprovação"].filter(Boolean).join(" · "),
  };
}

/**
 * Aviso do cliente na ficha da chegada avulsa, com as travas de
 * linkInboundNotice (functions/wms/src/domain/inbound-notice.ts): só a
 * chegada ainda aberta do cliente ativo troca de aviso, e não a que já foi
 * aprovada com ele. Fora disso a ficha só mostra o aviso vinculado. `linked` é o aviso
 * vinculado que não está entre os abertos: `undefined` enquanto carrega,
 * `null` se não deu para ler.
 */
export function noticeLinkChoice(
  task: WarehouseTask,
  notices: ShipmentNotice[],
  linked?: LinkedShipmentNotice | null,
  activeCustomer?: string,
): NoticeLinkChoice | null {
  if (!isUnplannedReceipt(task)) return null;
  const requestId = coerceText(task.customer_request_id);
  const openNotice = notices.find((notice) => notice.id === requestId);
  if (requestId && !openNotice && linked === undefined) return null;
  const linkedOption: NoticeOption | null = !requestId
    ? null
    : openNotice
      ? openNoticeOption(openNotice)
      : {
          id: requestId,
          title: linked?.number || requestId,
          detail: DECIDED_NOTICE_LABEL[linked?.status ?? ""] ?? "",
        };
  // A ficha recebe o id da fila ("receiving:<id>"); a aprovação grava o do recebimento.
  const receiptId = coerceText(task.reference) || task.id.replace(/^receiving:/, "");
  const approvedWithArrival = Boolean(linked && linked.id === requestId && linked.inbound_id === receiptId);
  const taskCustomer = coerceText(task.customer);
  const otherCustomer = Boolean(activeCustomer && taskCustomer && taskCustomer !== activeCustomer);
  if (isTerminalTask(task) || approvedWithArrival || otherCustomer) {
    return linkedOption ? { editable: false, selectedId: requestId, options: [linkedOption] } : null;
  }
  return {
    editable: true,
    selectedId: requestId,
    options: [
      { id: "", title: "Sem aviso", detail: "" },
      ...(linkedOption && !openNotice ? [linkedOption] : []),
      ...notices.map(openNoticeOption),
    ],
  };
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

/**
 * A situação da chegada por caixa: com caixa iniciada, ela já está em
 * conferência, embora o servidor só mude a chegada na conclusão.
 */
export function situacaoDaChegada(task: WarehouseTask) {
  if (chegadaPorCaixa(task) && normalizeStatus(task.status) === "created" && (task.boxes?.length ?? 0) > 0) {
    return statusLabel("checking");
  }
  return statusLabel(task.status);
}

function caixasText(count: number) {
  return count ? `${formatNumber(count)} ${count === 1 ? "caixa" : "caixas"}` : null;
}

/** "Prevista · em conferência · 1 linha · 1.000 un. · prazo 09/10/2026, 14:00" */
export function receivingRowMeta(task: WarehouseTask) {
  const lines = task.items?.length ?? 0;
  const status = normalizeStatus(task.status);
  // A chegada por caixa: o modo, a NF e as caixas (mockups WmsReceberFila e WmsRecebimentoCaixa).
  if (chegadaPorCaixa(task)) {
    return [
      isUnplannedReceipt(task) ? "Avulsa" : "Prevista",
      situacaoDaChegada(task),
      "por caixa",
      task.invoice_number ? `NF ${task.invoice_number}` : null,
      unitsText(task),
      caixasText(task.boxes?.length ?? 0),
    ]
      .filter(Boolean)
      .join(" · ");
  }
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

/** "Avulsa · recebida · NF 48.230 · 59 un. · falta marcada 12 un. · entrada concluída 03/11/2026, 16:14" */
export function guardandoRowMeta(task: WarehouseTask) {
  const linhas = (task.items ?? []).map((item) => ({ ...item, id: item.id ?? "" }));
  const totais = totaisDaChegada(linhas);
  return [
    isUnplannedReceipt(task) ? "Avulsa" : "Prevista",
    statusLabel(task.status),
    task.invoice_number ? `NF ${task.invoice_number}` : null,
    `${formatNumber(totais.emCaixas)} un.`,
    totais.faltaMarcada ? `falta marcada ${formatNumber(totais.faltaMarcada)} un.` : null,
    task.received_at ? `entrada concluída ${formatDate(task.received_at)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** O destino da guarda; o "local" igual à origem (a fila preenche assim a guarda sem prateleira) não é destino. */
function destinoDaGuarda(task: WarehouseTask) {
  const firstItem = task.items?.[0];
  const origem = coerceText(task.source_location_id, firstItem?.source_location_id) || "RECEBIMENTO";
  const destino = coerceText(task.destination_location_id, task.location, firstItem?.destination_location_id);
  return destino && destino.toUpperCase() !== origem.toUpperCase() ? destino : "";
}

/** "Guardar caixa CX-000131 em B-02"; sem destino, só a caixa. */
export function tituloDaGuarda(task: WarehouseTask) {
  if (!task.box_code) return null;
  const destino = destinoDaGuarda(task);
  return destino ? `Guardar caixa ${task.box_code} em ${destino}` : `Guardar caixa ${task.box_code}`;
}

/** A guarda da caixa que ainda não tem prateleira (decisão 14): o selo "sem prateleira". */
export function guardaSemPrateleira(task: WarehouseTask) {
  return Boolean(task.box_code) && !destinoDaGuarda(task);
}

/**
 * O conteúdo da caixa na fila: o produto e o tamanho com a quantidade, e o
 * total. "POLO MASCULINO PIQUET PRETO XG 29 · GG 12 · 41 un." quando os
 * produtos têm o nome em comum; "POLO MASCULINO PIQUET PRETO GG · 18 un."
 * com um só.
 */
export function conteudoDaGuarda(lines: WarehouseTask["box_lines"]) {
  const linhas = (lines ?? []).filter((linha) => linha && coerceNumber(linha.counted_qty) > 0);
  if (!linhas.length) return null;
  const total = linhas.reduce((soma, linha) => soma + coerceNumber(linha.counted_qty), 0);
  const nome = (linha: (typeof linhas)[number]) => coerceText(linha.product_name, linha.client_item_code, linha.sku_code);
  if (linhas.length === 1) return `${nome(linhas[0]!)} · ${formatNumber(total)} un.`;
  const palavras = linhas.map((linha) => nome(linha).split(/\s+/).filter(Boolean));
  const comum: string[] = [];
  for (const [indice, palavra] of palavras[0]!.entries()) {
    if (palavras.every((outra) => outra[indice] === palavra)) comum.push(palavra);
    else break;
  }
  const partes = linhas.map((linha, indice) => {
    const resto = palavras[indice]!.slice(comum.length).join(" ") || coerceText(linha.size, linha.client_item_code, linha.sku_code);
    return `${resto} ${formatNumber(coerceNumber(linha.counted_qty))}`;
  });
  const prefixo = comum.length ? `${comum.join(" ")} ` : "";
  return `${prefixo}${partes.join(" · ")} · ${formatNumber(total)} un.`;
}

/** "280 un. · está em RECEBIMENTO · guardar em A-03-2" */
export function putawayRowMeta(task: WarehouseTask) {
  const firstItem = task.items?.[0];
  const source =
    coerceText(task.source_location_id, firstItem?.source_location_id) || "RECEBIMENTO";
  // A guarda da caixa: o conteúdo e onde ela está; o destino vai no título.
  if (task.box_code) {
    return [conteudoDaGuarda(task.box_lines) ?? unitsText(task), `está em ${source}`, normalizeStatus(task.status) === "in_progress" ? "em execução" : null]
      .filter(Boolean)
      .join(" · ");
  }
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
    // A guarda aberta no Estoque (parte 7e, decisão 16).
    task.source === "wms_area_putaway" ? "aberta no Estoque" : null,
  ]
    .filter(Boolean)
    .join(" · ");
}
