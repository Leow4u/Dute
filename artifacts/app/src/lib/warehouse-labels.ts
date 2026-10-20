/**
 * Etiquetas de caixa e de posição (docs/mapa-do-armazem-enderecamento-
 * dirigido.md, seção 6). O conteúdo é definido aqui, uma vez; o desenho fica
 * em components/labels e a impressão é do navegador (Imprimir → Salvar PDF),
 * como a fatura. A etiqueta tem 101,6 × 50,8 mm, o rolo padrão da Zebra: na
 * folha A4 cabem dez; na Zebra sai uma por etiqueta, com o mesmo conteúdo.
 */

import type { WarehouseBox } from "@/lib/warehouse-boxes";
import { formatBoxDimensions } from "@/lib/warehouse-boxes";
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

export type LabelContentLine = { code: string; name: string; qty: number };

export type BoxLabelData = {
  kind: "box";
  code: string;
  position: string;
  customer: string;
  dimensions: string;
  units: number;
  lines: LabelContentLine[];
  /** Produtos que não couberam na etiqueta. */
  hiddenLines: number;
  origin: string;
  printedAt: string;
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

export const MAX_CONTENT_LINES = 4;

const dateFormatter = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" });

/** Agrupa as linhas da caixa por produto, maior quantidade primeiro. */
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
        name: String(line.product_name || "").trim() || key,
        qty,
      });
    }
  }
  return [...grouped.values()].sort((left, right) => right.qty - left.qty || left.name.localeCompare(right.name, "pt-BR"));
}

export function boxLabel(
  box: WarehouseBox,
  lines: BoxContentSource[],
  options: { printedAt?: Date; maxLines?: number } = {},
): BoxLabelData {
  const content = boxContent(lines, box.code);
  const maxLines = options.maxLines ?? MAX_CONTENT_LINES;
  const shown = content.slice(0, maxLines);
  const units = content.reduce((sum, line) => sum + line.qty, 0) || box.unit_count;
  return {
    kind: "box",
    code: box.code,
    position: box.location_id,
    customer: box.customer_code,
    dimensions: formatBoxDimensions(box),
    units,
    lines: shown,
    hiddenLines: content.length - shown.length,
    origin: box.session_id ? "Abertura" : "Manual",
    printedAt: dateFormatter.format(options.printedAt ?? new Date()),
  };
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
    skip: Number.isFinite(skip) && skip > 0 ? Math.min(Math.floor(skip), LABELS_PER_SHEET - 1) : 0,
    mode: params.get("modo") === "zebra" ? "zebra" : "a4",
  };
}

export function labelsUrl(query: Partial<LabelsQuery>): string {
  const params = new URLSearchParams();
  if (query.session) params.set("sessao", "atual");
  if (query.boxes?.length) params.set("caixas", query.boxes.join(","));
  if (query.positions?.length) params.set("posicoes", query.positions.join(","));
  if (query.skip) params.set("pular", String(query.skip));
  if (query.mode === "zebra") params.set("modo", "zebra");
  const text = params.toString();
  return text ? `${LABELS_PATH}?${text}` : LABELS_PATH;
}
