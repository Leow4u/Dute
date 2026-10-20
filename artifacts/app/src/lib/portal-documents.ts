/**
 * Documentos do portal: o que a Dutelog publicou para a BTG
 * (client_documents), as notas fiscais que a BTG anexou nos avisos de envio
 * e as faturas fechadas, numa lista só com busca e filtro por tipo.
 */

import { monthLabel, type ClosedInvoice } from "./billing-insights";
import { parseDocumentDate } from "./document-rows";

type AnyRecord = Record<string, unknown>;

export type PortalDocumentKind = "contrato" | "comprovante" | "nf" | "fatura" | "outros";
export type PortalDocumentGroup = "dutelog" | "nf" | "fatura";

export type PortalDocument = {
  key: string;
  group: PortalDocumentGroup;
  kind: PortalDocumentKind;
  title: string;
  typeLabel: string;
  /** PED-0042, ENV-0012: o número que liga o documento a um pedido ou envio. */
  reference: string;
  /** "02/10/2026 · 340 KB", "enviada por Leonardo em 01/10/2026". */
  detail: string;
  /** PDF, JPG, XLSX... para o ícone. */
  format: string;
  date?: Date;
  /** Arquivo para abrir; vazio quando não há (fatura abre a página dela). */
  href: string;
  /** Página do portal relacionada (envio, fatura). */
  link?: { href: string; label: string };
  searchText: string;
};

export const PORTAL_DOCUMENT_KINDS: Array<{ kind: PortalDocumentKind; label: string }> = [
  { kind: "contrato", label: "Contratos" },
  { kind: "comprovante", label: "Comprovantes de entrega" },
  { kind: "nf", label: "Notas fiscais" },
  { kind: "fatura", label: "Faturas" },
  { kind: "outros", label: "Outros" },
];

const TYPE_LABELS: Record<string, string> = {
  nf_entrada: "Nota fiscal",
  aviso_recebimento: "Nota fiscal",
  comprovante_entrega: "Comprovante de entrega",
  romaneio: "Romaneio",
  fatura: "Fatura",
  foto_avaria: "Foto de avaria",
  contrato: "Contrato",
  operacional: "Documento",
  outro: "Documento",
};

const dateBr = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Sao_Paulo" });
const dayMonth = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" });
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function text(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function kindOf(type: string): PortalDocumentKind {
  if (type === "nf_entrada" || type === "aviso_recebimento") return "nf";
  if (type === "comprovante_entrega") return "comprovante";
  if (type === "contrato") return "contrato";
  if (type === "fatura") return "fatura";
  return "outros";
}

export function fileFormat(fileName: string, contentType = "") {
  const extension = fileName.includes(".") ? fileName.split(".").pop()!.toUpperCase() : "";
  if (extension && extension.length <= 4) return extension === "JPEG" ? "JPG" : extension;
  const type = contentType.toLowerCase();
  if (type.includes("pdf")) return "PDF";
  if (type.includes("png")) return "PNG";
  if (type.includes("jpeg") || type.includes("jpg")) return "JPG";
  if (type.includes("sheet") || type.includes("excel")) return "XLSX";
  return "ARQ";
}

export function fileSize(bytes: unknown) {
  const size = Number(bytes);
  if (!Number.isFinite(size) || size <= 0) return "";
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;
}

/** Número de pedido ou envio citado no "Vinculado a" (PED-0042, ENV-0012). */
function referenceOf(document: AnyRecord) {
  const reference = text(document.reference);
  const number = reference.match(/\b(PED|ENV|SOL)-\d+\b/i)?.[0];
  return number ? number.toUpperCase() : "";
}

function publishedDocument(document: AnyRecord): PortalDocument {
  const id = text(document.id) || text(document.document_id);
  const fileName = text(document.file_name);
  const title = text(document.title) || fileName || "Documento";
  const type = text(document.document_type);
  const date =
    parseDocumentDate(document.signed_at) ??
    parseDocumentDate(document.issued_at) ??
    parseDocumentDate(document.received_at) ??
    parseDocumentDate(document.created_at) ??
    parseDocumentDate(document.published_at);
  const reference = referenceOf(document);
  return {
    key: `doc:${id}`,
    group: "dutelog",
    kind: kindOf(type),
    title,
    typeLabel: TYPE_LABELS[type] ?? "Documento",
    reference,
    detail: [date ? dateBr.format(date) : "", fileSize(document.size_bytes)].filter(Boolean).join(" · "),
    format: fileFormat(fileName, text(document.content_type)),
    date,
    href: text(document.file_url) || text(document.external_url),
    searchText: [title, fileName, text(document.reference), text(document.notes), reference].join(" ").toLowerCase(),
  };
}

function requestAttachments(request: AnyRecord, publishedPaths: Set<string>): PortalDocument[] {
  const attachments = Array.isArray(request.attachments) ? (request.attachments as AnyRecord[]) : [];
  const status = text(request.status).toLowerCase();
  if (!attachments.length || status === "cancelled") return [];
  const invoice = text(request.invoice_number);
  const supplier = text(request.supplier);
  const number = text(request.request_number);
  const who = text(request.requested_by_name).split(/\s+/)[0];
  const date = parseDocumentDate(request.created_at);
  const sent = ["enviada", who ? `por ${who}` : "", date ? `em ${dateBr.format(date)}` : ""].filter(Boolean).join(" ");
  const base = [invoice ? `NF ${invoice}` : "", supplier].filter(Boolean).join(" · ");
  return attachments.flatMap((attachment, index) => {
    const path = text(attachment.storage_path);
    if (path && publishedPaths.has(path)) return [];
    const fileName = text(attachment.file_name) || `Anexo ${index + 1}`;
    const title = base ? (attachments.length > 1 ? `${base} · ${fileName}` : base) : fileName;
    return [
      {
        key: `req:${text(request.id)}:${index}`,
        group: "nf" as const,
        kind: "nf" as const,
        title,
        typeLabel: "Nota fiscal",
        reference: number,
        detail: sent,
        format: fileFormat(fileName, text(attachment.content_type)),
        date,
        href: text(attachment.file_url),
        link: { href: "/portal/recebimentos", label: "Ver envio" },
        searchText: [title, fileName, invoice, supplier, number, who].join(" ").toLowerCase(),
      },
    ];
  });
}

function invoiceDocument(invoice: ClosedInvoice): PortalDocument {
  const paid = parseDocumentDate(invoice.paidAt);
  const issued = parseDocumentDate(invoice.issuedAt);
  const title = `Fatura ${monthLabel(invoice.competencia, true)}`;
  return {
    key: `fat:${invoice.competencia}`,
    group: "fatura",
    kind: "fatura",
    title,
    typeLabel: "Fatura",
    reference: "",
    detail: [money.format(invoice.total), invoice.status === "paga" ? `paga${paid ? ` em ${dayMonth.format(paid)}` : ""}` : "a pagar"].join(" · "),
    format: "PDF",
    date: issued,
    href: "",
    link: { href: `/portal/faturas/fatura?competencia=${invoice.competencia}`, label: "Ver fatura" },
    searchText: [title, monthLabel(invoice.competencia), invoice.competencia].join(" ").toLowerCase(),
  };
}

const byDateDesc = (left: PortalDocument, right: PortalDocument) => (right.date?.getTime() ?? 0) - (left.date?.getTime() ?? 0);

export function portalDocuments(documents: AnyRecord[], requests: AnyRecord[], invoices: ClosedInvoice[]): PortalDocument[] {
  const visible = documents.filter((document) => document.customer_visible !== false && text(document.status) !== "archived");
  const publishedPaths = new Set(visible.map((document) => text(document.storage_path)).filter(Boolean));
  return [
    ...visible.map(publishedDocument).sort(byDateDesc),
    ...requests.flatMap((request) => requestAttachments(request, publishedPaths)).sort(byDateDesc),
    ...invoices.map(invoiceDocument),
  ];
}

export function filterPortalDocuments(rows: PortalDocument[], filters: { search: string; kind: PortalDocumentKind | "all" }) {
  const search = filters.search.trim().toLowerCase();
  return rows.filter(
    (row) => (filters.kind === "all" || row.kind === filters.kind) && (!search || row.searchText.includes(search)),
  );
}

export function countByKind(rows: PortalDocument[]) {
  const counts = new Map<PortalDocumentKind, number>();
  for (const row of rows) counts.set(row.kind, (counts.get(row.kind) ?? 0) + 1);
  return counts;
}

/** Comprovantes de entrega publicados para um pedido (pelo PED- no "Vinculado a" ou pelo id). */
export function orderProofs(documents: AnyRecord[], order: { id: string; number: string }) {
  const number = order.number.toUpperCase();
  return portalDocuments(
    documents.filter((document) => {
      if (kindOf(text(document.document_type)) !== "comprovante") return false;
      const reference = text(document.reference);
      const entity = text(document.entity_id);
      return (
        (!!order.id && (entity === order.id || reference === order.id)) ||
        (/^(PED|ENV|SOL)-\d+$/.test(number) && referenceOf(document) === number)
      );
    }),
    [],
    [],
  );
}
