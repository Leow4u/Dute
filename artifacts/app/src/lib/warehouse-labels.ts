/**
 * Etiquetas de caixa e de posição (docs/mapa-do-armazem-enderecamento-
 * dirigido.md, seção 6). O conteúdo é definido aqui, uma vez; o desenho fica
 * em components/labels e a impressão é do navegador (Imprimir → Salvar PDF),
 * como a fatura. A etiqueta tem 101,6 × 50,8 mm, o rolo padrão da Zebra: na
 * folha A4 cabem dez; na Zebra sai uma por etiqueta, com o mesmo conteúdo.
 */

import { nomeComTamanho } from "@workspace/dominio";

import type { WarehouseBox } from "@/lib/warehouse-boxes";
import { boxBalanceUnits, boxOriginLabel, formatBoxDimensions } from "@/lib/warehouse-boxes";
import { type WarehousePosition, formatKilos, formatMeters } from "@/lib/warehouse-positions";

export const LABEL_MM = { width: 101.6, height: 50.8 } as const;

/** Folha A4 com dez etiquetas: duas colunas por cinco linhas, sem vão; margens centram o bloco. */
export const SHEET_MM = {
  width: 210,
  height: 297,
  columns: 2,
  rows: 5,
  gapX: 0,
  gapY: 0,
} as const;

export const LABELS_PER_SHEET = SHEET_MM.columns * SHEET_MM.rows;

export function sheetMargins() {
  const blockWidth = SHEET_MM.columns * LABEL_MM.width + (SHEET_MM.columns - 1) * SHEET_MM.gapX;
  const blockHeight = SHEET_MM.rows * LABEL_MM.height + (SHEET_MM.rows - 1) * SHEET_MM.gapY;
  return {
    left: Math.round(((SHEET_MM.width - blockWidth) / 2) * 100) / 100,
    top: Math.round(((SHEET_MM.height - blockHeight) / 2) * 100) / 100,
  };
}

export type LabelMode = "a4" | "zebra";

/** Uma linha da etiqueta: o código do cliente, o SKU, o nome com o tamanho (decisão 32) e a quantidade. */
export type LabelContentLine = { code: string; sku: string; name: string; qty: number };

export type BoxLabelData = {
  kind: "box";
  code: string;
  position: string;
  customer: string;
  dimensions: string;
  /** As unidades da caixa inteira, iguais em todas as etiquetas dela. */
  units: number;
  /** Os produtos desta etiqueta: os primeiros na primeira, os outros nas de continuação. */
  lines: LabelContentLine[];
  /** A etiqueta entre as da mesma caixa ("etiqueta 2 de 3"); com tudo na primeira, 1 de 1. */
  part: number;
  parts: number;
  origin: string;
  /** A data de entrada da caixa (a da guarda), que é a do FIFO; antes da guarda, a da impressão. */
  date: string;
  /** Na caixa aberta, de quando é o saldo ("saldo em 12/11/2026"); null na caixa intacta. */
  balanceAt: string | null;
};

export type PositionLabelData = {
  kind: "position";
  code: string;
  aisle: string;
  shelf: number;
  zone: string | null;
  dimensions: string;
  maxWeight: string;
};

export type LabelData = BoxLabelData | PositionLabelData;

/** O que a etiqueta precisa de uma linha da abertura. */
export type BoxContentSource = {
  box_code?: string;
  sku_code?: string;
  client_item_code?: string;
  product_name?: string;
  counted_qty?: number;
};

/**
 * Toda etiqueta mostra todos os produtos (separação com caixas, decisão 13 de
 * 10/11/2026; docs/mockups/WmsEtiquetaTodosCaixa.dc.html): a primeira leva
 * até cinco e os outros saem em etiquetas de continuação do mesmo tamanho.
 * Os dois números são o que cabe no desenho de components/labels.
 */
export const FIRST_LABEL_LINES = 5;
export const CONTINUATION_LABEL_LINES = 11;

const dateFormatter = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" });

function sortedContent(grouped: Map<string, LabelContentLine>) {
  return [...grouped.values()].sort((left, right) => right.qty - left.qty || left.name.localeCompare(right.name, "pt-BR"));
}

/** O nome na etiqueta segue o padrão do produto: o mesmo nome e o tamanho ao lado ("Polo Masculino Piquet Preto · G"). */
function labelName(product: { product_name?: unknown; client_item_code?: unknown; size?: unknown }, fallback: string) {
  const nome = String(product.product_name ?? "").trim() || fallback;
  return nomeComTamanho({ nome, codigo: product.client_item_code, tamanho: product.size }) || nome;
}

/** Agrupa as linhas da abertura por produto, maior quantidade primeiro. */
export function boxContent(lines: BoxContentSource[], boxCode: string): LabelContentLine[] {
  const code = boxCode.trim().toUpperCase();
  const grouped = new Map<string, LabelContentLine>();
  for (const line of lines) {
    if (String(line.box_code ?? "").trim().toUpperCase() !== code) continue;
    const key = String(line.sku_code || line.client_item_code || "").trim();
    if (!key) continue;
    const qty = Number(line.counted_qty ?? 0) || 0;
    const current = grouped.get(key);
    if (current) {
      current.qty += qty;
    } else {
      grouped.set(key, {
        code: String(line.client_item_code || line.sku_code || key).trim(),
        sku: String(line.sku_code ?? "").trim(),
        name: labelName(line, key),
        qty,
      });
    }
  }
  return sortedContent(grouped);
}

/** O conteúdo que a caixa do recebimento guarda nela (parte 6): por produto, maior quantidade primeiro. */
export function ownBoxContent(box: Pick<WarehouseBox, "lines">): LabelContentLine[] {
  const grouped = new Map<string, LabelContentLine>();
  for (const line of box.lines) {
    const key = (line.sku_code || line.client_item_code).toUpperCase();
    const current = grouped.get(key);
    if (current) {
      current.qty += line.counted_qty;
    } else {
      grouped.set(key, {
        code: line.client_item_code || line.sku_code,
        sku: line.sku_code,
        name: labelName(line, line.sku_code || line.client_item_code),
        qty: line.counted_qty,
      });
    }
  }
  return sortedContent(grouped);
}

/**
 * O saldo da caixa (separação com caixas, parte 3): o conteúdo de entrada
 * menos o que as separações tiraram de cada SKU, sem as linhas zeradas.
 */
export function balanceContent(content: LabelContentLine[], taken: ReadonlyArray<{ sku_code: string; qty: number }>): LabelContentLine[] {
  if (!taken.length) return content;
  const saiu = new Map<string, number>();
  for (const line of taken) saiu.set(line.sku_code.toUpperCase(), (saiu.get(line.sku_code.toUpperCase()) ?? 0) + line.qty);
  return content
    .map((line) => ({ ...line, qty: line.qty - (saiu.get(line.sku.toUpperCase()) ?? 0) }))
    .filter((line) => line.qty > 0)
    .sort((left, right) => right.qty - left.qty || left.name.localeCompare(right.name, "pt-BR"));
}

function labelDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : dateFormatter.format(date);
}

export type ImpressaoParaRegistrar = { receipt_id: string; box_code: string; location_id: string };

/**
 * As caixas do recebimento da folha, para registrar a impressão (decisão 29):
 * a chegada, a caixa e a posição impressa. A caixa da abertura e a manual
 * não registram.
 */
export function impressoesParaRegistrar(
  boxes: Array<Pick<WarehouseBox, "code" | "status" | "location_id" | "origin">>,
): ImpressaoParaRegistrar[] {
  return boxes.flatMap((box) =>
    box.origin.kind === "receipt" && box.origin.receipt_id && boxLabelAvailability(box).ready
      ? [{ receipt_id: box.origin.receipt_id, box_code: box.code, location_id: box.location_id }]
      : [],
  );
}

export type LabelAvailability = { ready: true; reason: null } | { ready: false; reason: string };

/**
 * A etiqueta sai da caixa guardada ou com o destino confirmado (decisão 30):
 * a caixa do recebimento ainda em conferência ou sem prateleira espera o
 * destino; a da abertura, a guarda.
 */
export function boxLabelAvailability(box: Pick<WarehouseBox, "code" | "status" | "location_id" | "origin">): LabelAvailability {
  if (box.status === "stored" || (box.status === "committing" && box.location_id)) return { ready: true, reason: null };
  // A caixa de que a separação tirou tudo saiu da prateleira (separação com caixas, parte 3c).
  if (box.status === "emptied") return { ready: false, reason: `${box.code} está vazia: saiu da prateleira.` };
  if (box.origin.kind === "receipt") {
    const state = box.status === "counting" ? "em conferência" : "sem prateleira";
    return { ready: false, reason: `${box.code} ${state}: sem etiqueta até confirmar o destino.` };
  }
  return { ready: false, reason: `${box.code} aguarda a guarda.` };
}

/**
 * As etiquetas de uma caixa: a primeira, com a posição, o código de barras e
 * até cinco produtos, e as de continuação com os outros, na mesma ordem (a
 * maior quantidade primeiro). Todas levam as unidades da caixa inteira.
 *
 * A caixa aberta (docs/mockups/WmsSepararEtiquetaCaixa.dc.html) sai com o
 * saldo e "saldo em", sem o peso de entrada. A data é sempre a de entrada da
 * caixa, que é a do FIFO.
 */
export function boxLabels(box: WarehouseBox, lines: BoxContentSource[], options: { printedAt?: Date } = {}): BoxLabelData[] {
  // A caixa do recebimento traz o conteúdo nela; a da abertura, nas linhas da sessão.
  const entrada = box.lines.length ? ownBoxContent(box) : boxContent(lines, box.code);
  const aberta = (box.taken_units ?? 0) > 0;
  const content = balanceContent(entrada, box.taken_lines ?? []);
  const pages = [content.slice(0, FIRST_LABEL_LINES)];
  for (let start = FIRST_LABEL_LINES; start < content.length; start += CONTINUATION_LABEL_LINES) {
    pages.push(content.slice(start, start + CONTINUATION_LABEL_LINES));
  }
  const units = content.reduce((sum, line) => sum + line.qty, 0);
  const base = {
    kind: "box" as const,
    code: box.code,
    position: box.location_id,
    customer: box.customer_code,
    dimensions: formatBoxDimensions(aberta ? { ...box, gross_weight_kg: null } : box),
    // Sem o conteúdo lido, vale o que a caixa diz ter.
    units: units || (entrada.length ? 0 : boxBalanceUnits(box)),
    origin: boxOriginLabel(box),
    date: labelDate(box.stored_at) ?? dateFormatter.format(options.printedAt ?? new Date()),
    balanceAt: aberta ? labelDate(box.balance_at) : null,
  };
  return pages.map((page, index) => ({ ...base, lines: page, part: index + 1, parts: pages.length }));
}

export function positionLabel(position: WarehousePosition): PositionLabelData {
  return {
    kind: "position",
    code: position.code,
    aisle: position.aisle,
    shelf: Number(position.shelf),
    zone: position.customer_code?.trim() || null,
    dimensions: `${formatMeters(position.length_m)} × ${formatMeters(position.depth_m)} × ${formatMeters(position.height_m)}`,
    maxWeight: formatKilos(position.max_weight_kg),
  };
}

/**
 * Distribui as etiquetas em folhas de dez. `skip` pula as primeiras vagas da
 * primeira folha, para aproveitar uma folha adesiva já usada em parte; a
 * vaga pulada vem como null.
 */
export function paginate<T>(labels: T[], perSheet = LABELS_PER_SHEET, skip = 0): Array<Array<T | null>> {
  const slots: Array<T | null> = [...Array<null>(Math.max(0, Math.min(skip, perSheet - 1))).fill(null), ...labels];
  const sheets: Array<Array<T | null>> = [];
  for (let start = 0; start < slots.length; start += perSheet) {
    sheets.push(slots.slice(start, start + perSheet));
  }
  return sheets;
}

export const LABELS_PATH = "/estoque/etiquetas";

export type LabelsQuery = {
  boxes: string[];
  positions: string[];
  /** Todas as caixas da sessão de abertura em curso. */
  session: boolean;
  /** A chegada (número) de onde as caixas vieram: a volta é ao Receber e a tela diz a chegada. */
  receipt: string | null;
  skip: number;
  mode: LabelMode;
};

function codes(value: string | null) {
  return [...new Set((value ?? "").split(",").map((code) => code.trim().toUpperCase()).filter(Boolean))];
}

export function parseLabelsQuery(search: string): LabelsQuery {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const skip = Number(params.get("pular") ?? 0);
  return {
    boxes: codes(params.get("caixas")),
    positions: codes(params.get("posicoes")),
    session: params.get("sessao") === "atual",
    receipt: (params.get("chegada") ?? "").trim() || null,
    skip: Number.isFinite(skip) && skip > 0 ? Math.min(Math.floor(skip), LABELS_PER_SHEET - 1) : 0,
    mode: params.get("modo") === "zebra" ? "zebra" : "a4",
  };
}

export function labelsUrl(query: Partial<LabelsQuery>): string {
  const params = new URLSearchParams();
  if (query.session) params.set("sessao", "atual");
  if (query.boxes?.length) params.set("caixas", query.boxes.join(","));
  if (query.positions?.length) params.set("posicoes", query.positions.join(","));
  if (query.receipt) params.set("chegada", query.receipt);
  if (query.skip) params.set("pular", String(query.skip));
  if (query.mode === "zebra") params.set("modo", "zebra");
  const text = params.toString();
  return text ? `${LABELS_PATH}?${text}` : LABELS_PATH;
}
