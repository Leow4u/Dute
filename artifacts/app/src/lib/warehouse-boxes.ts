/**
 * Caixas do armazém (unidade de manuseio) vistas pelas telas internas.
 *
 * O que vai para a prateleira é a caixa: código sequencial (CX-000001),
 * medidas, peso, posição e o que tem dentro. A pessoa mede em centímetros;
 * o backend guarda em metros. Quem decide a prateleira é o motor em
 * functions/wms/src/domain/warehouse-boxes.ts; aqui só leitura, formato e a
 * conversão do que a tela digita para o que a callable espera.
 */

import { unidadesAjustadas } from "@workspace/dominio";

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

/**
 * Um ajuste da recontagem gravado na caixa (`count_adjustments`): quanto um
 * SKU ganhou (positivo) ou perdeu (negativo), com o id da contagem e, para o
 * item que a entrada da caixa não tem, o nome que a etiqueta e o Mapa mostram.
 */
export type BoxCountAdjustment = {
  sku_code: string;
  qty: number;
  recount_id: string | null;
  client_item_code: string | null;
  product_name: string | null;
  size: string | null;
};

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
  /** O que as recontagens acertaram, por SKU e com sinal: o saldo é a entrada menos o retirado mais isto. */
  count_adjustments?: BoxCountAdjustment[];
  /** Quando o saldo mudou pela última vez; null na caixa intacta. */
  balance_at?: string | null;
  /** O `balance_at` do saldo que saiu na última etiqueta impressa (parte 3d); null sem etiqueta de saldo. */
  balance_label_printed_for?: string | null;
  /** A caixa vazia (`status: "emptied"`): quando saiu, em qual pedido e se saiu inteira. */
  emptied_at?: string | null;
  emptied_order_number?: string | null;
  emptied_whole?: boolean;
  /** Na caixa que saiu inteira e virou volume ("Levar a caixa"): o número do volume. */
  emptied_volume_number?: number | null;
  /**
   * A última recontagem da caixa (`recountWarehouseBox`, contagem por caixa):
   * o id, quando, quem (o nome, ou o e-mail) e a rodada; null na caixa nunca
   * recontada. A caixa contada vazia com a lista vazia só tem este registro:
   * a recontagem dela não grava linha em `cycle_counts`.
   */
  last_recount_id?: string | null;
  last_recounted_at?: string | null;
  last_recounted_by?: string | null;
  last_recount_round_id?: string | null;
  /**
   * O último mover da caixa (`moveWarehouseBox`, Mover caixa, 19/11/2026):
   * quando e de onde; null na caixa que nunca mudou de prateleira.
   */
  moved_at?: string | null;
  moved_from_location_id?: string | null;
  /** O `moved_at` da última etiqueta impressa depois do mover; null sem ela. */
  location_label_printed_for?: string | null;
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

/** Quem gravou, como a caixa guarda (`{ uid, name, email }`): o nome, ou o e-mail; null sem nenhum. */
function quemGravou(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const ator = value as AnyRecord;
  return text(ator.name).trim() || text(ator.email).trim() || null;
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

function boxAdjustmentsFromRecord(value: unknown): BoxCountAdjustment[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const line = item && typeof item === "object" ? (item as AnyRecord) : null;
    const sku_code = line ? text(line.sku_code) : "";
    const qty = line ? number(line.qty) : 0;
    if (!line || !sku_code || !qty) return [];
    return [
      {
        sku_code,
        qty,
        recount_id: text(line.recount_id) || null,
        client_item_code: text(line.client_item_code) || null,
        product_name: text(line.product_name) || null,
        size: text(line.size) || null,
      },
    ];
  });
}

/** O conteúdo não é mais o de entrada: a separação tirou peça ou a recontagem acertou. */
export function boxBalanceChanged(box: Pick<WarehouseBox, "taken_units" | "count_adjustments">) {
  return (box.taken_units ?? 0) > 0 || (box.count_adjustments?.length ?? 0) > 0;
}

/** A caixa aberta: guardada, com saída registrada ou ajustada pela recontagem. */
export function boxIsOpen(box: Pick<WarehouseBox, "status" | "taken_units" | "count_adjustments">) {
  return box.status === "stored" && boxBalanceChanged(box);
}

/**
 * A caixa movida cuja etiqueta ainda diz a prateleira antiga (Mover caixa,
 * 19/11/2026): guardada, com `moved_at` e sem a impressão registrada depois
 * do mover. A regra é a do servidor (functions/wms, box-relabel.ts).
 */
export function boxMovedWithoutLabel(box: Pick<WarehouseBox, "status" | "moved_at" | "location_label_printed_for">) {
  return box.status === "stored" && Boolean(box.moved_at) && (box.location_label_printed_for ?? "") !== (box.moved_at ?? "");
}

/**
 * A caixa cuja etiqueta não vale mais: a aberta, sem a etiqueta do saldo de
 * agora (separação com caixas, parte 3d), e a movida, sem a etiqueta da
 * prateleira nova. Entra em "Etiquetas para trocar" até a impressão ser
 * registrada.
 */
export function boxNeedsRelabel(
  box: Pick<WarehouseBox, "status" | "taken_units" | "count_adjustments" | "balance_at" | "balance_label_printed_for" | "moved_at" | "location_label_printed_for">,
) {
  return (boxIsOpen(box) && (box.balance_label_printed_for ?? "") !== (box.balance_at ?? "")) || boxMovedWithoutLabel(box);
}

/** As unidades que a caixa tem agora: a entrada menos o que as separações tiraram mais o que as recontagens acertaram. */
export function boxBalanceUnits(box: Pick<WarehouseBox, "unit_count" | "taken_units" | "count_adjustments">) {
  return Math.max(0, box.unit_count - (box.taken_units ?? 0) + unidadesAjustadas(box.count_adjustments ?? []));
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
    count_adjustments: boxAdjustmentsFromRecord(record.count_adjustments),
    balance_at: text(record.balance_at) || null,
    balance_label_printed_for: text(record.balance_label_printed_for) || null,
    emptied_at: text(record.emptied_at) || null,
    emptied_order_number: text(record.emptied_order_number) || null,
    emptied_whole: record.emptied_whole === true,
    emptied_volume_number: Number(record.emptied_volume_number) > 0 ? Number(record.emptied_volume_number) : null,
    last_recount_id: text(record.last_recount_id) || null,
    last_recounted_at: text(record.last_recounted_at) || null,
    last_recounted_by: quemGravou(record.last_recounted_by),
    last_recount_round_id: text(record.last_recount_round_id) || null,
    moved_at: text(record.moved_at) || null,
    moved_from_location_id: text(record.moved_from_location_id).toUpperCase() || null,
    location_label_printed_for: text(record.location_label_printed_for) || null,
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
