/**
 * Caixas do armazém (unidade de manuseio) vistas pelas telas internas.
 *
 * O que vai para a prateleira é a caixa: código sequencial (CX-000001),
 * medidas, peso, posição e o que tem dentro. A pessoa mede em centímetros;
 * o backend guarda em metros. Quem decide a prateleira é o motor em
 * functions/wms/src/domain/warehouse-boxes.ts; aqui só leitura, formato e a
 * conversão do que a tela digita para o que a callable espera.
 */

import type { AnyRecord } from "@/lib/warehouse-ops/model";
import { parseDecimal } from "@/lib/warehouse-positions";

const MAX_CENTIMETERS = 5000;

export type BoxOrientation = "length_width_height" | "width_length_height" | "length_height_width" | "height_length_width" | "width_height_length" | "height_width_length";

export type WarehouseBox = {
  code: string;
  customer_code: string;
  status: string;
  location_id: string;
  length_m: number;
  width_m: number;
  height_m: number;
  front_m: number | null;
  depth_m: number | null;
  placed_height_m?: number | null;
  orientation?: BoxOrientation | null;
  allow_tilt?: boolean;
  allow_stacking?: boolean;
  support_box_code?: string | null;
  base_height_m?: number | null;
  conference_revision?: number;
  opening_closed?: boolean;
  draft_line_count?: number;
  draft_unit_count?: number;
  draft_total_cost?: number;
  gross_weight_kg: number | null;
  line_count: number;
  unit_count: number;
  total_cost: number;
  sku_codes: string[];
  /** Quando a caixa foi guardada na posição; null antes da guarda. */
  stored_at: string | null;
  session_id: string | null;
  suggestion: {
    position: string | null;
    reason: string | null;
    alternatives: string[];
    followed: boolean | null;
  } | null;
  refusal: { position: string; reason: string } | null;
};

export type SlottingCandidate = {
  code: string;
  reason: string;
  tier: 1 | 2 | 3;
  leftover_m: number;
  sequence: number;
  placement: { front_m: number; depth_m: number; height_m?: number; orientation?: BoxOrientation; support_box_code?: string; base_height_m?: number };
  /** false quando a abertura aceitou a prateleira sem o encaixe calculado. */
  model_fit?: boolean;
};

/** Resposta de suggestWarehousePosition: a posição, as alternativas ou o motivo. */
export type SuggestionResult = {
  ok?: boolean;
  customer_code?: string;
  zone_positions?: number;
  position: SlottingCandidate | null;
  alternatives: SlottingCandidate[];
  rejected: string | null;
  checked: number;
};

export type CreateBoxResult = { ok?: boolean; box: AnyRecord; replayed?: boolean };

export type BoxRefusal = { position: string; reason: string };

/** O que a tela digita: centímetros, quilos e o conteúdo (opcional). */
export type BoxDraft = {
  length_cm: string;
  width_cm: string;
  height_cm: string;
  weight_kg: string;
  content: string;
};

export type BoxPayload = {
  length_m: number;
  width_m: number;
  height_m: number;
  gross_weight_kg: number | null;
};

export function emptyBoxDraft(): BoxDraft {
  return { length_cm: "", width_cm: "", height_cm: "", weight_kg: "", content: "" };
}

function number(value: unknown, fallback = 0) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nullableNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function text(value: unknown) {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

/** "50" e "50,5" (centímetros) viram 0,5 e 0,505 (metros); vazio, zero ou lixo viram null. */
export function parseCentimeters(value: string | number | null | undefined) {
  const centimeters = parseDecimal(value);
  if (centimeters === null || centimeters <= 0 || centimeters > MAX_CENTIMETERS) return null;
  return Math.round(centimeters * 10) / 1000;
}

/** Peso opcional: vazio vira null; zero ou negativo também (não é peso). */
export function parseKilos(value: string | number | null | undefined) {
  const kilos = parseDecimal(value);
  return kilos === null || kilos <= 0 ? null : kilos;
}

/** Converte o rascunho para o que a callable espera, ou null quando falta medida. */
export function boxDraftToPayload(draft: BoxDraft): BoxPayload | null {
  const length_m = parseCentimeters(draft.length_cm);
  const width_m = parseCentimeters(draft.width_cm);
  const height_m = parseCentimeters(draft.height_cm);
  if (length_m === null || width_m === null || height_m === null) return null;
  return { length_m, width_m, height_m, gross_weight_kg: parseKilos(draft.weight_kg) };
}

const kilosFormatter = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

/** "50 × 50 × 35 cm" e, com peso, "50 × 50 × 35 cm · 12,4 kg". */
export function formatBoxDimensions(box: {
  length_m: number;
  width_m: number;
  height_m: number;
  gross_weight_kg?: number | null;
}) {
  const sides = [box.length_m, box.width_m, box.height_m].map((side) => Math.round(side * 100)).join(" × ");
  const weight = box.gross_weight_kg != null && box.gross_weight_kg > 0 ? ` · ${kilosFormatter.format(box.gross_weight_kg)} kg` : "";
  return `${sides} cm${weight}`;
}

export const TIER_LABELS: Record<1 | 2 | 3, string> = {
  1: "mesmo produto",
  2: "perto do produto",
  3: "primeira livre",
};

export function tierLabel(tier: number | null | undefined) {
  return TIER_LABELS[tier as 1 | 2 | 3] ?? "sugerida";
}

export function warehouseBoxFromRecord(record: AnyRecord): WarehouseBox {
  const origin = record.origin && typeof record.origin === "object" ? (record.origin as AnyRecord) : {};
  const suggestion =
    record.suggestion && typeof record.suggestion === "object" ? (record.suggestion as AnyRecord) : null;
  const refusal = record.refusal && typeof record.refusal === "object" ? (record.refusal as AnyRecord) : null;
  return {
    code: text(record.code || record.id).toUpperCase(),
    customer_code: text(record.customer_code),
    status: text(record.status) || "stored",
    location_id: text(record.location_id).toUpperCase(),
    length_m: number(record.length_m),
    width_m: number(record.width_m),
    height_m: number(record.height_m),
    front_m: nullableNumber(record.front_m),
    depth_m: nullableNumber(record.depth_m),
    placed_height_m: nullableNumber(record.placed_height_m),
    orientation: (text(record.orientation) || null) as BoxOrientation | null,
    allow_tilt: record.allow_tilt === true,
    allow_stacking: record.allow_stacking === true,
    support_box_code: text(record.support_box_code).toUpperCase() || null,
    base_height_m: nullableNumber(record.base_height_m),
    conference_revision: number(record.conference_revision),
    opening_closed: record.opening_closed === true,
    draft_line_count: number(record.draft_line_count),
    draft_unit_count: number(record.draft_unit_count),
    draft_total_cost: number(record.draft_total_cost),
    gross_weight_kg: nullableNumber(record.gross_weight_kg),
    line_count: number(record.line_count),
    unit_count: number(record.unit_count),
    total_cost: number(record.total_cost),
    sku_codes: Array.isArray(record.sku_codes) ? record.sku_codes.map((sku) => text(sku)).filter(Boolean) : [],
    stored_at: text(record.stored_at) || null,
    session_id: text(origin.session_id) || null,
    suggestion: suggestion
      ? {
          position: text(suggestion.position) || null,
          reason: text(suggestion.reason) || null,
          alternatives: Array.isArray(suggestion.alternatives)
            ? suggestion.alternatives.map((code) => text(code)).filter(Boolean)
            : [],
          followed: typeof suggestion.followed === "boolean" ? suggestion.followed : null,
        }
      : null,
    refusal: refusal && text(refusal.position) ? { position: text(refusal.position), reason: text(refusal.reason) } : null,
  };
}

/** Mais recente primeiro: o código é sequencial. */
export function sortBoxes<T extends Pick<WarehouseBox, "code">>(boxes: T[]): T[] {
  return [...boxes].sort((left, right) => right.code.localeCompare(left.code));
}

/** As caixas criadas numa sessão de abertura. */
export function sessionBoxes<T extends Pick<WarehouseBox, "session_id">>(boxes: T[], sessionId: string | null | undefined): T[] {
  if (!sessionId) return [];
  return boxes.filter((box) => box.session_id === sessionId);
}

/** Quantas prateleiras têm ao menos uma caixa guardada: a base da cobrança por posição. */
export function occupiedPositions(boxes: Array<Pick<WarehouseBox, "location_id" | "status">>) {
  const positions = new Set<string>();
  for (const box of boxes) {
    if (box.status === "stored" && box.location_id) positions.add(box.location_id.toUpperCase());
  }
  return positions.size;
}

/**
 * O conteúdo digitado ("A.01.0802.007.G, SKU-123") vira SKUs para a regra do
 * mesmo produto: cód. cliente conhecido vira o SKU dele; o resto segue como
 * foi digitado, em maiúsculas, sem repetir.
 */
export function resolveContentSkus(
  content: string,
  products: Array<{ clientCode: string; skuCode: string }>,
) {
  const byCode = new Map<string, string>();
  for (const product of products) {
    const sku = product.skuCode.trim();
    if (!sku) continue;
    if (product.clientCode.trim()) byCode.set(product.clientCode.trim().toUpperCase(), sku);
    byCode.set(sku.toUpperCase(), sku);
  }
  const skus: string[] = [];
  for (const token of content.split(/[\s,;]+/)) {
    const key = token.trim().toUpperCase();
    if (!key) continue;
    const sku = byCode.get(key) ?? key;
    if (!skus.includes(sku)) skus.push(sku);
  }
  return skus.slice(0, 50);
}

/** Placement dimensions are ordered by the actual shelf, unlike measured box sides. */
export function formatBoxPlacement(placement: SlottingCandidate["placement"]) {
  const cm = (value: number) => new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(value * 100);
  const support = placement.support_box_code
    ? `Sobre a caixa ${placement.support_box_code} · base a ${cm(placement.base_height_m ?? 0)} cm · `
    : "";
  return `${support}Frente ${cm(placement.front_m)} × profundidade ${cm(placement.depth_m)}${placement.height_m == null ? "" : ` × altura ${cm(placement.height_m)}`} cm`;
}
