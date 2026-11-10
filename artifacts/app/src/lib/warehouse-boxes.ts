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

/** Uma linha da NF dentro da caixa do recebimento, como a caixa grava (`lines[]`, parte 3). */
export type BoxLine = {
  sku_code: string;
  client_item_code: string;
  product_name: string;
  size: string | null;
  counted_qty: number;
};

/** O que saiu de um SKU da caixa nas separações. */
export type BoxTakenLine = { sku_code: string; qty: number };

/** De onde a caixa veio: a abertura (a sessão), a chegada (o recebimento) ou o cadastro manual. */
export type BoxOrigin = {
  kind: "opening_inventory" | "receipt" | "manual";
  session_id: string | null;
  receipt_id: string | null;
  receipt_number: string | null;
  invoice_number: string | null;
};

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
  origin: BoxOrigin;
  /** O conteúdo que a caixa do recebimento guarda nela; vazio na caixa da abertura, cujo conteúdo mora na sessão. */
  lines: BoxLine[];
  /** O que as separações já tiraram da caixa, por SKU (separação com caixas, parte 3): o saldo é a entrada menos isto. */
  taken_lines?: BoxTakenLine[];
  taken_units?: number;
  /** Quando o saldo mudou pela última vez; null na caixa intacta. */
  balance_at?: string | null;
  /** O `balance_at` do saldo que saiu na última etiqueta impressa (parte 3d); null sem etiqueta de saldo. */
  balance_label_printed_for?: string | null;
  /** A caixa vazia (`status: "emptied"`): quando saiu, em qual pedido e se saiu inteira. */
  emptied_at?: string | null;
  emptied_order_number?: string | null;
  emptied_whole?: boolean;
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

function boxOriginFromRecord(origin: AnyRecord): BoxOrigin {
  const kind = text(origin.kind);
  const session_id = text(origin.session_id) || null;
  return {
    kind: kind === "receipt" ? "receipt" : session_id || kind === "opening_inventory" ? "opening_inventory" : "manual",
    session_id,
    receipt_id: text(origin.receipt_id) || null,
    receipt_number: text(origin.receipt_number) || null,
    invoice_number: text(origin.invoice_number) || null,
  };
}

function boxLinesFromRecord(value: unknown): BoxLine[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const line = item && typeof item === "object" ? (item as AnyRecord) : null;
    const counted_qty = line ? number(line.counted_qty) : 0;
    if (!line || counted_qty <= 0) return [];
    const sku_code = text(line.sku_code);
    const client_item_code = text(line.client_item_code);
    if (!sku_code && !client_item_code) return [];
    return [{ sku_code, client_item_code, product_name: text(line.product_name), size: text(line.size) || null, counted_qty }];
  });
}

function boxTakenFromRecord(value: unknown): BoxTakenLine[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const line = item && typeof item === "object" ? (item as AnyRecord) : null;
    const sku_code = line ? text(line.sku_code) : "";
    const qty = line ? number(line.qty) : 0;
    return sku_code && qty > 0 ? [{ sku_code, qty }] : [];
  });
}

/** A caixa aberta: guardada, com saída registrada e ainda com saldo. */
export function boxIsOpen(box: Pick<WarehouseBox, "status" | "taken_units">) {
  return box.status === "stored" && (box.taken_units ?? 0) > 0;
}

/**
 * A caixa aberta cuja etiqueta não é a do saldo de agora: entra em "Etiquetas
 * para trocar" até a impressão ser registrada (separação com caixas, parte 3d).
 */
export function boxNeedsRelabel(box: Pick<WarehouseBox, "status" | "taken_units" | "balance_at" | "balance_label_printed_for">) {
  return boxIsOpen(box) && (box.balance_label_printed_for ?? "") !== (box.balance_at ?? "");
}

/** As unidades que a caixa tem agora: a entrada menos o que as separações tiraram. */
export function boxBalanceUnits(box: Pick<WarehouseBox, "unit_count" | "taken_units">) {
  return Math.max(0, box.unit_count - (box.taken_units ?? 0));
}

/**
 * A origem como a etiqueta e o Mapa dizem (recebimento com caixas, parte 6,
 * decisão 31): "Abertura", "Manual" ou "Recebimento · NF 48.377"; a chegada
 * sem NF leva o número dela.
 */
export function boxOriginLabel(box: Pick<WarehouseBox, "origin">): string {
  const { origin } = box;
  if (origin.kind === "receipt") {
    const reference = origin.invoice_number ? `NF ${origin.invoice_number}` : origin.receipt_number;
    return reference ? `Recebimento · ${reference}` : "Recebimento";
  }
  return origin.kind === "opening_inventory" ? "Abertura" : "Manual";
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
    origin: boxOriginFromRecord(origin),
    lines: boxLinesFromRecord(record.lines),
    taken_lines: boxTakenFromRecord(record.taken_lines),
    taken_units: number(record.taken_units),
    balance_at: text(record.balance_at) || null,
    balance_label_printed_for: text(record.balance_label_printed_for) || null,
    emptied_at: text(record.emptied_at) || null,
    emptied_order_number: text(record.emptied_order_number) || null,
    emptied_whole: record.emptied_whole === true,
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

/** Quantas prateleiras têm ao menos uma caixa guardada: a base da cobrança por posição. A caixa vazia (`emptied`) não conta. */
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
