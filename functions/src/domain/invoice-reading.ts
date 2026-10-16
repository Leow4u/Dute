import { HttpsError } from "firebase-functions/https";

/**
 * "Ler itens da nota" em Envios para a Dutelog e em Receber > Chegada avulsa:
 * o Agent Dute lê a NF anexada e sugere fornecedor, número e itens. A IA só
 * sugere; a pessoa confere, e o estoque continua mudando só na conferência
 * física.
 */

function text(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

export function normalized(value: unknown) {
  return text(value)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function safeSegment(value: string) {
  return value.replace(/[^\w.-]/g, "_").slice(0, 900);
}

/**
 * Quem pode pedir a leitura: a cliente no portal (Envios) e a operação de
 * armazém no Receber (chegada que o fornecedor entregou sem aviso). Financeiro
 * e suporte não registram chegada, então não leem nota.
 */
export const INVOICE_READER_ROLES = ["cliente", "owner", "admin", "interno", "wms"] as const;

export function assertInvoiceReader(profile: { role: string }) {
  if (!(INVOICE_READER_ROLES as readonly string[]).includes(profile.role)) {
    throw new HttpsError("permission-denied", "Leitura de nota disponível no portal do cliente e no Receber da operação.");
  }
}

/**
 * Origem gravada em agent_usage. Configuração > Sistema agrupa tudo que começa
 * com "leitura_nota" em "Leitura de NF"; o sufixo separa portal, chat e
 * Receber quando alguém precisar saber de onde veio o custo.
 */
export type InvoiceReadingSource = "leitura_nota" | "leitura_nota_chat" | "leitura_nota_recebimento";

export function invoiceReadingSource(role: string): InvoiceReadingSource {
  return role === "cliente" ? "leitura_nota" : "leitura_nota_recebimento";
}

/** O arquivo precisa estar na pasta do cliente dono da chegada no Storage. */
export function assertOwnInvoicePath(storagePath: string, customerCode: string) {
  const path = text(storagePath);
  const prefix = `operational-documents/${safeSegment(customerCode)}/`;
  if (!path.startsWith(prefix) || path.includes("..") || path.includes("//")) {
    throw new HttpsError("permission-denied", "Este arquivo não pertence ao seu cliente.");
  }
  return path;
}

export type InvoiceItem = { supplier_code: string; description: string; quantity: number; unit: string };

export type InvoiceReading = {
  supplier: string;
  invoice_number: string;
  issue_date: string;
  /** Texto pronto para "Observações": volumes, transporte e emissão. */
  notes: string;
  items: InvoiceItem[];
};

/** "000.002.471" → "2471"; números com letras ficam como estão. */
export function invoiceNumber(value: unknown) {
  const raw = text(value).replace(/^n[ºo°.\s]*/i, "").trim();
  if (/^[\d.\s-]+$/.test(raw)) return raw.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  return raw.slice(0, 40);
}

function invoiceNotes(data: Record<string, unknown>, issueDate: string) {
  const volumes = text(data.volumes).slice(0, 80);
  // A DANFE traz a modalidade com código ("3 - Transporte próprio..."): só o texto interessa.
  const carrier = text(data.carrier).replace(/^\d+\s*[-–]\s*/, "").slice(0, 120);
  const issued = issueDate ? issueDate.split("-").reverse().join("/") : "";
  return [
    volumes ? `Volumes: ${volumes}` : "",
    carrier ? `Transporte: ${carrier}` : "",
    issued ? `NF emitida em ${issued}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

const MAX_ITEMS = 300;

function quantityOf(value: unknown) {
  if (typeof value === "number") return value;
  const raw = text(value);
  // "1.200,00" (nota brasileira) e "1200.5" (já numérico).
  const normalizedNumber = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw;
  return Number(normalizedNumber);
}

/** Aceita só o que faz sentido: item com descrição e quantidade positiva. */
export function sanitizeInvoiceReading(raw: unknown): InvoiceReading {
  const data = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const items = (Array.isArray(data.items) ? data.items : [])
    .map((entry) => (entry && typeof entry === "object" ? entry : {}) as Record<string, unknown>)
    .map((entry) => ({
      supplier_code: text(entry.supplier_code ?? entry.code).slice(0, 80),
      description: text(entry.description).slice(0, 200),
      quantity: quantityOf(entry.quantity),
      unit: text(entry.unit).slice(0, 10),
    }))
    .filter((entry) => entry.description && Number.isFinite(entry.quantity) && entry.quantity > 0)
    .slice(0, MAX_ITEMS);
  const issue = text(data.issue_date);
  const issueDate = /^\d{4}-\d{2}-\d{2}$/.test(issue) ? issue : "";
  return {
    supplier: text(data.supplier).slice(0, 160),
    invoice_number: invoiceNumber(data.invoice_number),
    issue_date: issueDate,
    notes: invoiceNotes(data, issueDate),
    items,
  };
}

export type CatalogEntry = { client_item_code: string; sku_code: string; product_name: string };

export type MatchedItem = InvoiceItem & {
  match: { client_item_code: string; sku_code: string; product_name: string; by: "codigo" | "nome" } | null;
};

function words(value: string) {
  return new Set(
    normalized(value)
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length >= 2),
  );
}

function similarity(left: string, right: string) {
  const a = words(left);
  const b = words(right);
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  return shared / Math.max(a.size, b.size);
}

/**
 * Casa cada item da nota com o estoque: primeiro pelo código (o fornecedor
 * às vezes usa o código da BTG), depois pelo nome, só quando a semelhança é
 * alta e sem empate. Sem casamento, a pessoa decide.
 */
export function matchInvoiceItems(items: InvoiceItem[], catalog: CatalogEntry[]): MatchedItem[] {
  const byCode = new Map<string, CatalogEntry>();
  for (const entry of catalog) {
    for (const code of [entry.client_item_code, entry.sku_code]) {
      const key = normalized(code);
      if (key && !byCode.has(key)) byCode.set(key, entry);
    }
  }
  return items.map((item) => {
    const coded = item.supplier_code ? byCode.get(normalized(item.supplier_code)) : undefined;
    if (coded) return { ...item, match: { ...coded, by: "codigo" as const } };
    let best: CatalogEntry | null = null;
    let bestScore = 0;
    let tie = false;
    for (const entry of catalog) {
      const score = similarity(item.description, entry.product_name);
      if (score > bestScore) {
        best = entry;
        bestScore = score;
        tie = false;
      } else if (score === bestScore && score > 0 && best && best.client_item_code !== entry.client_item_code) {
        // Tamanhos dividem o nome (CAMISETA .G, .GG): sem o código não dá
        // para saber qual é. Melhor a pessoa escolher do que errar o tamanho.
        tie = true;
      }
    }
    if (best && bestScore >= 0.75 && !tie) return { ...item, match: { ...best, by: "nome" as const } };
    return { ...item, match: null };
  });
}

export const INVOICE_PROMPT = `
Você lê notas fiscais (DANFE) e pedidos de compra brasileiros.
Extraia do documento:
- supplier: razão social ou nome do EMITENTE (quem vendeu e envia), nunca o destinatário;
- invoice_number: número da nota ou do pedido, só os dígitos/letras do número;
- issue_date: data de emissão no formato AAAA-MM-DD (vazio se não houver);
- volumes: quantidade e espécie dos volumes transportados, ex.: "2 CAIXA" (vazio se não houver);
- carrier: transportadora ou modalidade do frete, ex.: "Transporte próprio por conta do remetente" (vazio se não houver);
- items: cada produto listado, com supplier_code (código do produto na nota), description (descrição como está escrita), quantity (quantidade, número) e unit (unidade, ex.: UN, PC, CX).
Não invente itens nem números. Se algo não estiver legível, deixe vazio. Ignore impostos, frete e totais.
`.trim();
