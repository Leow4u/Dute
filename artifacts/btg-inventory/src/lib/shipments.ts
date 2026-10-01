/**
 * "Envios para a Dutelog": mercadoria que um fornecedor da BTG vai entregar
 * no armazém da Dutelog. A BTG avisa para a equipe se programar; a Dutelog
 * confirma e, na chegada, confere. Tudo vem de client_request_status.
 */

import { parseDate, sortByCreatedDesc } from "./client-home";

type AnyRecord = Record<string, unknown>;

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

export const SHIPMENT_STEPS = ["Avisado", "Confirmado pela Dutelog", "Chegou no armazém"] as const;

export type ShipmentStage = "notified" | "confirmed" | "arrived" | "rejected" | "cancelled";

export function isShipment(request: AnyRecord) {
  const type = slug(request.type);
  return type.includes("receb") || type.includes("inbound");
}

export function shipmentStage(request: AnyRecord): ShipmentStage {
  const status = slug(request.status);
  const operational = slug(request.operational_status);
  if (status === "cancelled" || operational === "cancelled") return "cancelled";
  if (["rejected", "rejeitado", "rejeitada"].includes(status)) return "rejected";
  if (operational === "received" || status === "closed") return "arrived";
  if (status === "approved" || status === "aprovado" || operational === "checking") return "confirmed";
  return "notified";
}

export function stageIndex(stage: ShipmentStage) {
  return stage === "arrived" ? 2 : stage === "confirmed" ? 1 : 0;
}

export function shipmentTitle(request: AnyRecord) {
  const supplier = text(request.supplier) || "Fornecedor";
  const invoice = text(request.invoice_number);
  return invoice ? `${supplier} · NF ${invoice}` : supplier;
}

const weekday = new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" });
const shortDate = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" });
const integer = new Intl.NumberFormat("pt-BR");

export function formatArrival(value: unknown) {
  const date = parseDate(value);
  return date ? weekday.format(date).replace(".", "").replace(",", ",") : "";
}

export type ReceivedView = { label: string; tone: "ok" | "short" | "over"; differences: string[] };

/** "118 de 120 peças", com as linhas que vieram diferentes. */
export function receivedView(request: AnyRecord): ReceivedView | null {
  if (request.qty_received === undefined || request.qty_expected === undefined) return null;
  const received = num(request.qty_received);
  const expected = num(request.qty_expected);
  const differences = (Array.isArray(request.received_differences) ? request.received_differences : [])
    .map((entry) => entry as AnyRecord)
    .map((entry) => {
      const diff = num(entry.received) - num(entry.expected);
      const amount = integer.format(Math.abs(diff));
      return `${amount} ${Math.abs(diff) === 1 ? "peça" : "peças"} a ${diff < 0 ? "menos" : "mais"} em ${text(entry.code) || text(entry.name)}`;
    });
  return {
    label: `${integer.format(received)} de ${integer.format(expected)} peças`,
    tone: received === expected ? "ok" : received < expected ? "short" : "over",
    differences,
  };
}

export type ShipmentView = {
  id: string;
  /** ENV-0012; aviso antigo sem número fica vazio. */
  number: string;
  title: string;
  stage: ShipmentStage;
  arrival: string;
  summary: string;
  attachments: number;
  detail: string;
  received: ReceivedView | null;
  canCancel: boolean;
};

export function shipmentView(request: AnyRecord): ShipmentView {
  const stage = shipmentStage(request);
  const items = num(request.item_count);
  const pieces = num(request.quantity_total);
  const created = parseDate(request.created_at);
  const updated = parseDate(request.updated_at);
  const by = text(request.requested_by_name);
  const received = receivedView(request);
  const detail =
    stage === "rejected"
      ? `recusado${updated ? ` em ${shortDate.format(updated)}` : ""}${text(request.decision_reason) ? `: ${text(request.decision_reason)}` : ""}`
      : stage === "cancelled"
        ? `cancelado por você${updated ? ` em ${shortDate.format(updated)}` : ""}`
        : stage === "arrived"
          ? `chegou e foi conferido${parseDate(request.received_at ?? request.updated_at) ? ` em ${shortDate.format(parseDate(request.received_at ?? request.updated_at)!)}` : ""}${received?.differences.length ? ` · ${received.differences.join(" · ")}` : ""}`
          : `avisado${by ? ` por ${by.split(/\s+/)[0]}` : ""}${created ? ` em ${shortDate.format(created)}` : ""}`;
  return {
    id: text(request.id),
    number: text(request.request_number),
    title: shipmentTitle(request),
    stage,
    arrival: formatArrival(request.due_at),
    summary: [items ? `${integer.format(items)} ${items === 1 ? "item" : "itens"}` : "", pieces ? `${integer.format(pieces)} peças` : ""]
      .filter(Boolean)
      .join(" · "),
    attachments: num(request.attachment_count) || (Array.isArray(request.attachments) ? request.attachments.length : 0),
    detail,
    received,
    canCancel: stage === "notified" && slug(request.status) === "open",
  };
}

/** A caminho (mais próximos primeiro) e o histórico (mais recentes primeiro). */
export function splitShipments(requests: AnyRecord[]) {
  const views = sortByCreatedDesc(requests.filter(isShipment)).map((request) => ({ request, view: shipmentView(request) }));
  const onTheWay = views
    .filter(({ view }) => view.stage === "notified" || view.stage === "confirmed")
    .sort(
      (left, right) =>
        (parseDate(left.request.due_at)?.getTime() ?? Number.MAX_SAFE_INTEGER) -
        (parseDate(right.request.due_at)?.getTime() ?? Number.MAX_SAFE_INTEGER),
    )
    .map(({ view }) => view);
  const history = views.filter(({ view }) => !(view.stage === "notified" || view.stage === "confirmed")).map(({ view }) => view);
  return { onTheWay, history };
}

// ------------------------------------------------------- colar da planilha

export type PastedLine = { code: string; quantity: number };

/**
 * Linhas copiadas do Excel ou da nota: código e quantidade, separados por
 * tab, ponto e vírgula ou espaços. Cabeçalho e linhas sem quantidade são
 * ignorados; o mesmo código repetido soma.
 */
export function parsePastedItems(source: string): { lines: PastedLine[]; ignored: number } {
  const totals = new Map<string, PastedLine>();
  let ignored = 0;
  for (const raw of source.replace(/\r/g, "").split("\n")) {
    const row = raw.trim();
    if (!row) continue;
    const parts = row.split(/\t|;|\s{2,}|\s+(?=[\d.,]+\s*$)/).map((part) => part.trim()).filter(Boolean);
    const code = parts[0] ?? "";
    const quantityText = (parts[parts.length - 1] ?? "").replace(/\./g, "").replace(",", ".");
    const quantity = Number(quantityText);
    if (parts.length < 2 || !code || !Number.isFinite(quantity) || quantity <= 0) {
      ignored += 1;
      continue;
    }
    const key = code.toUpperCase();
    const current = totals.get(key);
    if (current) current.quantity += quantity;
    else totals.set(key, { code, quantity });
  }
  return { lines: [...totals.values()], ignored };
}

// ------------------------------------------------------- ler itens da nota

export type InvoiceMatch = { client_item_code: string; sku_code: string; product_name: string; by: "codigo" | "nome" };
export type InvoiceItem = { supplier_code: string; description: string; quantity: number; unit: string; match: InvoiceMatch | null };
export type InvoiceReading = {
  supplier: string;
  invoice_number: string;
  issue_date: string;
  /** Volumes, transporte e emissão, prontos para "Observações". */
  notes?: string;
  items: InvoiceItem[];
};

/**
 * Logo depois de ler a nota, fornecedor, número e observações entram no
 * formulário, mas só onde a pessoa ainda não escreveu nada.
 */
export function fillIfEmpty(typed: string, read: unknown) {
  return typed.trim() ? typed : text(read);
}

export type InvoiceDraftLine = {
  key: string;
  include: boolean;
  /** Como está na nota, para a pessoa comparar. */
  invoiceText: string;
  code: string;
  name: string;
  quantity: string;
  matchedBy: "codigo" | "nome" | null;
  /** Código do produto na nota do fornecedor, para a conferência. */
  supplierCode: string;
};

/** Itens lidos da nota viram linhas para a pessoa conferir antes de usar. */
export function invoiceDraft(reading: InvoiceReading): InvoiceDraftLine[] {
  return reading.items.map((item, index) => ({
    key: `nf${index}`,
    include: true,
    invoiceText: [item.supplier_code, item.description].filter(Boolean).join(" · "),
    code: item.match?.client_item_code ?? "",
    name: item.match ? item.match.product_name : item.description,
    quantity: String(item.quantity),
    matchedBy: item.match?.by ?? null,
    supplierCode: item.supplier_code,
  }));
}

// ------------------------------------------------------- código a definir

/**
 * O código da BTG muitas vezes só vem na etiqueta. Item sem código segue no
 * aviso como "código a definir": a Dutelog lê a etiqueta na conferência.
 * Sem código, o nome do produto é obrigatório.
 */
export function shipmentLineProblem(
  index: number,
  line: { code: string; name: string; quantity: number; inStock: boolean },
) {
  if (!line.code.trim() && !line.name.trim()) return `Item ${index + 1}: informe o código ou o nome do produto.`;
  if (line.code.trim() && !line.inStock && !line.name.trim()) return `Item ${index + 1}: produto novo, informe o nome.`;
  if (line.quantity <= 0) return `Item ${index + 1}: informe quantas peças vêm.`;
  return null;
}

/** Linha sem código vira item "código a definir", com o código do fornecedor anotado. */
export function pendingCodeItem(line: { name: string; quantity: number; supplierCode?: string }) {
  return {
    product_name: line.name.trim(),
    product_registration: "unknown" as const,
    location_id: null,
    quantity: line.quantity,
    notes: line.supplierCode?.trim() ? `Código do fornecedor: ${line.supplierCode.trim()}` : undefined,
  };
}
