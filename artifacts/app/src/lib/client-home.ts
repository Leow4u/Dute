/**
 * Início do portal: o que a BTG quer saber ao abrir o sistema. Tudo vem das
 * projeções do cliente (client_request_status, client_inventory,
 * client_invoices), que o backend atualiza a cada etapa da operação.
 */

type AnyRecord = Record<string, unknown>;

export const ORDER_STEPS = ["Enviado", "Aprovado", "Separando", "Saiu", "Entregue"] as const;

export type OrderProgress = {
  /** 0 = Enviado … 4 = Entregue. */
  step: number;
  rejected: boolean;
  reason: string;
};

export type RequestKind = "pedido" | "aviso" | "outro";

function text(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function slug(value: unknown) {
  return text(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

function num(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Datas do Firestore chegam como Timestamp, {seconds} ou texto ISO. */
export function parseDate(value: unknown): Date | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value;
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }
  if (typeof value === "object") {
    const record = value as { toDate?: () => Date; seconds?: unknown; _seconds?: unknown };
    if (typeof record.toDate === "function") return record.toDate();
    const seconds = Number(record.seconds ?? record._seconds);
    if (Number.isFinite(seconds)) return new Date(seconds * 1000);
  }
  return undefined;
}

export function requestKind(request: AnyRecord): RequestKind {
  const type = slug(request.type);
  if (type.includes("receb") || type.includes("inbound")) return "aviso";
  if (type.includes("retirada") || type.includes("saida") || type.includes("outbound") || type.includes("pedido")) {
    return "pedido";
  }
  return "outro";
}

const SEPARATING = new Set(["separating", "separated", "checking", "ready_to_dispatch", "picking", "packing"]);

/** Onde o pedido está, pelo status e pelo andamento que o backend publica. */
export function orderProgress(request: AnyRecord): OrderProgress {
  const status = slug(request.status);
  const operational = slug(request.operational_status);
  const reason = text(request.decision_reason);
  if (["rejected", "rejeitado", "rejeitada", "cancelled", "canceled", "cancelado"].includes(status)) {
    return { step: 0, rejected: true, reason };
  }
  if (operational === "delivered" || status === "closed" || status === "delivered") {
    return { step: 4, rejected: false, reason };
  }
  if (operational === "dispatched") return { step: 3, rejected: false, reason };
  if (SEPARATING.has(operational)) return { step: 2, rejected: false, reason };
  if (status === "approved" || status === "aprovado" || operational === "picking_planned") {
    return { step: 1, rejected: false, reason };
  }
  return { step: 0, rejected: false, reason };
}

const shortDate = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" });
const integer = new Intl.NumberFormat("pt-BR");

export function formatShortDate(date: Date | undefined) {
  return date ? shortDate.format(date) : "";
}

const GENERIC_TITLES = new Set(["retirada", "recebimento", "pedido", "solicitacao", "ajuste", "suporte", ""]);

/** Título que a cliente deu; sem ele, a data do pedido. */
export function orderTitle(request: AnyRecord) {
  const title = text(request.title);
  if (!GENERIC_TITLES.has(slug(title))) return title;
  const created = parseDate(request.created_at);
  return created ? `Pedido de ${formatShortDate(created)}` : "Pedido";
}

export function orderSummary(request: AnyRecord, progress: OrderProgress) {
  const items = num(request.item_count);
  const units = num(request.quantity_total);
  const created = parseDate(request.created_at);
  const updated = parseDate(request.updated_at);
  const when =
    progress.step === 4 && !progress.rejected && updated
      ? `entregue em ${formatShortDate(updated)}`
      : created
        ? `pedido em ${formatShortDate(created)}`
        : "";
  return [
    when,
    items ? `${integer.format(items)} ${items === 1 ? "item" : "itens"}` : "",
    units ? `${integer.format(units)} peças` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

export type NoticeView = { title: string; detail: string; label: string; tone: "waiting" | "done" | "rejected" };

/** Envio para a Dutelog no Início: avisado, confirmado, chegou ou recusado. */
export function noticeView(request: AnyRecord): NoticeView {
  const status = slug(request.status);
  const operational = slug(request.operational_status);
  const supplier = text(request.supplier) || "Fornecedor";
  const invoice = text(request.invoice_number);
  const title = invoice ? `${supplier} · NF ${invoice}` : supplier;
  if (["rejected", "rejeitado", "rejeitada"].includes(status)) {
    return { title, detail: text(request.decision_reason) || "Recusado pela Dutelog", label: "Recusado", tone: "rejected" };
  }
  if (operational === "received" || status === "closed") {
    const arrived = parseDate(request.received_at ?? request.updated_at);
    const counted =
      request.qty_received !== undefined && request.qty_expected !== undefined
        ? ` · ${integer.format(num(request.qty_received))} de ${integer.format(num(request.qty_expected))} peças`
        : "";
    return {
      title,
      detail: `${arrived ? `chegou em ${formatShortDate(arrived)}` : "chegou e foi conferido"}${counted}`,
      label: "Chegou",
      tone: "done",
    };
  }
  const due = parseDate(request.due_at);
  const confirmed = status === "approved" || status === "aprovado";
  return {
    title,
    detail: due ? `chega ${formatShortDate(due)}` : confirmed ? "confirmado pela Dutelog" : "aguardando confirmação da Dutelog",
    label: confirmed ? "Confirmado" : "Avisado",
    tone: "waiting",
  };
}

export function sortByCreatedDesc(requests: AnyRecord[]) {
  return [...requests].sort(
    (left, right) => (parseDate(right.created_at)?.getTime() ?? 0) - (parseDate(left.created_at)?.getTime() ?? 0),
  );
}

/**
 * Pedidos para o Início: os em andamento primeiro (mais recentes), depois os
 * concluídos ou recusados mais recentes, até `limit`.
 */
export function homeOrders(requests: AnyRecord[], limit = 4) {
  const orders = sortByCreatedDesc(requests.filter((request) => requestKind(request) === "pedido")).map(
    (request) => ({ request, progress: orderProgress(request) }),
  );
  const active = orders.filter(({ progress }) => !progress.rejected && progress.step < 4);
  const finished = orders.filter(({ progress }) => progress.rejected || progress.step === 4);
  return [...active, ...finished].slice(0, limit);
}

export function homeNotices(requests: AnyRecord[], limit = 3) {
  const notices = sortByCreatedDesc(
    requests.filter((request) => requestKind(request) === "aviso" && slug(request.status) !== "cancelled"),
  ).map(noticeView);
  const waiting = notices.filter((notice) => notice.tone === "waiting");
  const rest = notices.filter((notice) => notice.tone !== "waiting");
  return [...waiting, ...rest].slice(0, limit);
}

const monthName = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });

export function competenciaLabel(competencia: string) {
  const label = monthName.format(new Date(`${competencia}-15T12:00:00Z`));
  return label.charAt(0).toUpperCase() + label.slice(1).replace(" de ", "/");
}

function competenciaOf(date: Date) {
  const local = new Date(date.getTime() - 3 * 3_600_000);
  return `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, "0")}`;
}

function previousCompetencia(competencia: string) {
  const [year, month] = competencia.split("-").map(Number);
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, "0")}`;
}

export type InvoiceLine = { competencia: string; label: string; detail: string; amount?: number; state: "running" | "closing" | "issued" | "paid" };

/**
 * Mês corrente (em andamento), mês anterior (emitido, pago ou ainda em
 * fechamento) e a fatura anterior a ele, se houver.
 */
export function invoiceLines(invoices: AnyRecord[], now: Date, options: { includeCurrent?: boolean } = {}): InvoiceLine[] {
  const byMonth = new Map(invoices.map((invoice) => [text(invoice.competencia), invoice]));
  const current = competenciaOf(now);
  const previous = previousCompetencia(current);
  const line = (competencia: string, fallback: InvoiceLine["state"]): InvoiceLine => {
    const invoice = byMonth.get(competencia);
    const paid = invoice && (slug(invoice.status) === "pago" || slug(invoice.payment_status) === "paid");
    const state: InvoiceLine["state"] = invoice ? (paid ? "paid" : "issued") : fallback;
    const detail =
      state === "running"
        ? "mês em andamento"
        : state === "closing"
          ? "em fechamento pela Dutelog"
          : state === "paid"
            ? "paga"
            : "emitida";
    return {
      competencia,
      label: competenciaLabel(competencia),
      detail,
      amount: invoice ? num(invoice.total) : undefined,
      state,
    };
  };
  // O Início trabalha só com mês fechado (ou em fechamento), como Faturas.
  const lines = options.includeCurrent === false ? [line(previous, "closing")] : [line(current, "running"), line(previous, "closing")];
  const older = invoices
    .map((invoice) => text(invoice.competencia))
    .filter((competencia) => competencia && competencia < previous)
    .sort()
    .reverse()[0];
  if (older) lines.push(line(older, "issued"));
  return lines;
}
