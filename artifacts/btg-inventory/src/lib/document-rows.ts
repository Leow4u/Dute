/**
 * Uma linha por documento da operação, juntando duas fontes: a coleção
 * `documents` (o que a Dutelog adicionou) e os anexos que a BTG manda no
 * "Avisar chegada" (gravados no próprio `customer_requests.attachments`).
 */

type AnyRecord = Record<string, unknown>;

export type DocumentKind = "nf" | "comprovante" | "contrato" | "outros";
export type DocumentAudience = "btg" | "internal" | "archived";
/** Situação na base do Agent Dute (Conhecimento). */
export type KnowledgeState = "none" | "reading" | "pending" | "active" | "rejected";

export type DocumentRow = {
  key: string;
  source: "document" | "request";
  /** Só documentos da coleção `documents` podem ser alterados. */
  documentId?: string;
  title: string;
  origin: string;
  typeLabel: string;
  kind: DocumentKind;
  linkedTo: string;
  audience: DocumentAudience;
  date?: Date;
  href: string;
  knowledge: KnowledgeState;
  searchText: string;
};

export const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  nf_entrada: "NF de entrada",
  comprovante_entrega: "Comprovante de entrega",
  romaneio: "Romaneio",
  fatura: "Fatura",
  foto_avaria: "Foto de avaria",
  contrato: "Contrato",
  operacional: "Operacional",
  outro: "Outro",
};

const ENTITY_LABELS: Record<string, string> = {
  recebimento: "Recebimento",
  pedido: "Pedido",
  expedicao: "Expedição",
  fatura: "Fatura",
  excecao: "Exceção",
  produto: "Produto",
  sku: "SKU",
};

function text(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

export function parseDocumentDate(value: unknown): Date | undefined {
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

export function documentKind(type: string): DocumentKind {
  if (type === "nf_entrada" || type === "aviso_recebimento") return "nf";
  if (type === "comprovante_entrega") return "comprovante";
  if (type === "contrato") return "contrato";
  return "outros";
}

function audienceOf(document: AnyRecord): DocumentAudience {
  if (document.archived === true || text(document.status) === "archived") return "archived";
  if (document.customer_visible === false || text(document.visibility) === "internal") return "internal";
  return "btg";
}

export function knowledgeStateOf(document: AnyRecord): KnowledgeState {
  const status = text(document.knowledge_status);
  if (status === "pending_approval") return "pending";
  if (status === "rejected") return "rejected";
  if (status === "active" && text(document.knowledge_id)) return "active";
  const extraction = text(document.content_extraction_status);
  if (extraction === "pending_ocr" || extraction === "pending_visual_ocr") return "reading";
  return "none";
}

function linkedToOf(document: AnyRecord) {
  const reference = text(document.reference);
  if (reference) return reference;
  const entityType = text(document.entity_type);
  const entityId = text(document.entity_id);
  const label = ENTITY_LABELS[entityType];
  return label && entityId ? `${label} ${entityId}` : "";
}

export function buildDocumentRows(documents: AnyRecord[], requests: AnyRecord[]): DocumentRow[] {
  const rows: DocumentRow[] = [];
  const storedPaths = new Set<string>();

  for (const document of documents) {
    const id = text(document._docId) || text(document.id);
    const title = text(document.title) || text(document.file_name) || id;
    const fileName = text(document.file_name);
    const type = text(document.document_type);
    const path = text(document.storage_path);
    if (path) storedPaths.add(path);
    const linkedTo = linkedToOf(document);
    rows.push({
      key: `doc:${id}`,
      source: "document",
      documentId: id,
      title,
      origin: fileName && fileName !== title ? fileName : "Adicionado pela Dutelog",
      typeLabel: DOCUMENT_TYPE_LABELS[type] ?? (type || "Outro"),
      kind: documentKind(type),
      linkedTo,
      audience: audienceOf(document),
      date: parseDocumentDate(document.created_at) ?? parseDocumentDate(document.updated_at),
      href: text(document.file_url) || text(document.external_url),
      knowledge: knowledgeStateOf(document),
      searchText: [title, fileName, linkedTo, text(document.notes)].join(" ").toLowerCase(),
    });
  }

  for (const request of requests) {
    const attachments = Array.isArray(request.attachments) ? (request.attachments as AnyRecord[]) : [];
    if (!attachments.length) continue;
    const by = (request.requested_by ?? {}) as AnyRecord;
    const who = text(by.name) || text(by.email) || "BTG";
    const invoice = text(request.invoice_number);
    const supplier = text(request.supplier);
    const linkedTo = ["Aviso de chegada", supplier, invoice && `NF ${invoice}`].filter(Boolean).join(" · ");
    attachments.forEach((attachment, index) => {
      const path = text(attachment.storage_path);
      if (path && storedPaths.has(path)) return;
      const title = text(attachment.file_name) || `Anexo ${index + 1}`;
      rows.push({
        key: `req:${text(request.id)}:${index}`,
        source: "request",
        title,
        origin: `Enviado por ${who} no aviso de chegada`,
        typeLabel: "NF / aviso de chegada",
        kind: "nf",
        linkedTo,
        audience: "btg",
        date: parseDocumentDate(request.created_at),
        href: text(attachment.file_url),
        knowledge: "none",
        searchText: [title, linkedTo, who].join(" ").toLowerCase(),
      });
    });
  }

  return rows.sort((left, right) => (right.date?.getTime() ?? 0) - (left.date?.getTime() ?? 0));
}

export function matchesDocumentFilters(
  row: DocumentRow,
  filters: { search: string; kind: DocumentKind | "all"; audience: DocumentAudience | "all" },
) {
  // Arquivado só aparece quando pedido.
  if (filters.audience === "all" ? row.audience === "archived" : row.audience !== filters.audience) {
    return false;
  }
  if (filters.kind !== "all" && row.kind !== filters.kind) return false;
  const search = filters.search.trim().toLowerCase();
  return !search || row.searchText.includes(search);
}
