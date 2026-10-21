import { FieldValue, type DocumentReference, type Firestore, type Transaction } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";
import { z } from "genkit";
import { createHash } from "node:crypto";

import { WAREHOUSE_POSITIONS_COLLECTION } from "./warehouse-positions.js";

/**
 * A caixa como unidade de manuseio e o endereçamento dirigido.
 *
 * O que vai para a prateleira é a caixa, não o SKU. Cada caixa recebe um
 * código sequencial (CX-000001), tem medidas, peso e uma posição; o saldo do
 * estoque continua por cliente × SKU × posição (stock_balances), e cada linha
 * da abertura que entra numa caixa referencia o código dela (box_code).
 *
 * A posição é escolhida por regra, não por IA, nesta ordem (docs/mapa-do-
 * armazem-enderecamento-dirigido.md, seção 4): prateleira que já tem o mesmo
 * SKU e ainda cabe; senão a mais próxima dessas pela sequência de caminhada;
 * senão a primeira da zona com espaço; desempate pela menor sobra de frente.
 * Só prateleiras da zona do cliente entram; zona cheia bloqueia e avisa.
 *
 * Capacidade: uma fileira na profundidade, com empilhamento somente mediante
 * allow_stacking explícito e apoio integral sobre uma caixa já guardada.
 * O padrão preserva a altura; apoiar de lado exige allow_tilt. A orientação,
 * a caixa de apoio e a altura da base são guardadas com a posição física.
 *
 * Na abertura, a prateleira escolhida manualmente entra mesmo quando esse
 * cálculo não confirma. A sugestão automática continua por ele. A caixa fica
 * com opening_model_fit false para a capacidade real ser lida depois do que
 * foi guardado, não do volume estimado na tela.
 */

export const WAREHOUSE_BOXES_COLLECTION = "warehouse_boxes";
export const WAREHOUSE_COUNTERS_COLLECTION = "warehouse_counters";
export const BOX_COUNTER_DOC = "boxes";
export const BOX_EDITOR_ROLES = ["owner", "admin", "interno", "wms"] as const;
const OPERATIONS_COLLECTION = "operational_operations";
const TOLERANCE_M = 0.001;
const MAX_METERS = 50;

export type WarehouseBoxActor = {
  uid: string;
  role: string;
  email?: string;
  name?: string;
  customer_code?: string;
};

export type BoxDimensions = {
  length_m: number;
  width_m: number;
  height_m: number;
  gross_weight_kg?: number | null;
};

export type SlottingPosition = {
  code: string;
  length_m: number;
  depth_m: number;
  height_m: number;
  max_weight_kg?: number | null;
  sequence?: number | null;
  customer_code?: string | null;
  status?: string | null;
};

export type PositionOccupancy = {
  front_used_m: number;
  weight_used_kg: number;
  box_count: number;
  sku_codes: Set<string>;
  /** Topos livres de caixas guardadas; reservas não servem de apoio. */
  supports?: Array<{ code: string; customer_code?: string | null; front_m: number; depth_m: number; top_m: number }>;
};

export const BOX_ORIENTATIONS = [
  "length_width_height",
  "width_length_height",
  "length_height_width",
  "height_length_width",
  "width_height_length",
  "height_width_length",
] as const;

/** Eixos originais usados, nesta ordem: frente, profundidade e altura. */
export type BoxOrientation = (typeof BOX_ORIENTATIONS)[number];

export type BoxPlacementOptions = {
  /** Só true permite apoiar a caixa num lado diferente da base original. */
  allow_tilt?: boolean;
  /** Quando informada, valida esta orientação sem trocar por outra. */
  orientation?: BoxOrientation;
  /** Permite apoiar sobre outra caixa, separadamente da permissão para tombar. */
  allow_stacking?: boolean;
  /** undefined busca apoio; null confirma a base da prateleira; string fixa a caixa de apoio. */
  support_box_code?: string | null;
};

export type Placement = {
  /** Lado da caixa paralelo à frente da prateleira. */
  front_m: number;
  /** Lado da caixa que entra na profundidade. */
  depth_m: number;
  /** Altura efetiva depois de orientar a caixa. */
  height_m: number;
  orientation: BoxOrientation;
  support_box_code?: string;
  base_height_m?: number;
};

export type SlottingCandidate = {
  code: string;
  reason: string;
  tier: 1 | 2 | 3;
  leftover_m: number;
  sequence: number;
  placement: Placement;
  /** false quando a abertura aceitou a prateleira sem o encaixe calculado. */
  model_fit?: boolean;
};

export type SlottingResult = {
  position: SlottingCandidate | null;
  alternatives: SlottingCandidate[];
  /** Por que nenhuma prateleira serviu; null quando há sugestão. */
  rejected: string | null;
  checked: number;
};

// ------------------------------------------------------------------ schemas

function optionalNumber(min: number, max: number, label: string) {
  return z.preprocess(
    (value) => (value === null || value === undefined || value === "" ? null : Number(value)),
    z.number({ invalid_type_error: `${label} inválido.` }).min(min, `${label} inválido.`).max(max, `${label} inválido.`).nullable(),
  );
}

const meters = (problem: string) =>
  z.coerce
    .number({ invalid_type_error: `${problem}: informe em metros.` })
    .positive(`${problem}: informe em metros.`)
    .max(MAX_METERS, `${problem}: informe em metros.`);

const dimensionFields = {
  length_m: meters("Comprimento da caixa inválido"),
  width_m: meters("Largura da caixa inválida"),
  height_m: meters("Altura da caixa inválida"),
  gross_weight_kg: optionalNumber(0, 100_000, "Peso bruto").optional(),
};

const placementFields = {
  allow_tilt: z.boolean().optional(),
  allow_stacking: z.boolean().optional(),
  support_box_code: z.string().trim().toUpperCase().regex(/^CX-\d{6,}$/, "Caixa de apoio inválida.").nullable().optional(),
  orientation: z.enum(BOX_ORIENTATIONS).optional(),
};

const positionCodeField = z.string().trim().min(1, "Informe a posição.").max(12, "Posição inválida.");

export const SuggestWarehousePositionSchema = z.object({
  customer_code: z.string().trim().optional(),
  // Prévia de uma prateleira cadastrada, sem escolher outra como alternativa.
  location_id: positionCodeField
    .refine((code) => !code.includes("/"), "Posição inválida.")
    .transform((code) => code.toUpperCase())
    .optional(),
  ...dimensionFields,
  ...placementFields,
  sku_codes: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
  exclude: z.array(positionCodeField).max(20).optional(),
  // Só libera a prévia manual enquanto a sessão de abertura desse cliente está aberta.
  opening_inventory: z.boolean().optional(),
});

export const CreateWarehouseBoxSchema = z.object({
  customer_code: z.string().trim().optional(),
  session_id: z.string().trim().max(160).optional(),
  ...dimensionFields,
  ...placementFields,
  location_id: positionCodeField,
  suggestion: z
    .object({
      position: positionCodeField.nullable().optional(),
      reason: z.string().trim().max(300).nullable().optional(),
      alternatives: z.array(positionCodeField).max(5).optional(),
    })
    .optional(),
  refusal: z
    .object({
      position: positionCodeField,
      reason: z.string().trim().min(1, "Informe o motivo da recusa.").max(300),
    })
    .optional(),
  notes: z.string().trim().max(500).nullable().optional(),
  idempotency_key: z.string().trim().min(1),
});

export const RemoveWarehouseBoxSchema = z.object({
  customer_code: z.string().trim().optional(),
  code: z.string().trim().min(1, "Informe a caixa.").max(12),
});

export type SuggestWarehousePositionInput = z.infer<typeof SuggestWarehousePositionSchema> & { customer_code: string };
export type CreateWarehouseBoxInput = z.infer<typeof CreateWarehouseBoxSchema> & { customer_code: string };

// ------------------------------------------------------------------ helpers

export function formatBoxCode(sequence: number) {
  return `CX-${String(Math.max(1, Math.trunc(sequence))).padStart(6, "0")}`;
}

function digest(value: unknown, length = 32) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, length);
}

function round(value: number, decimals: number) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function centimeters(value: number) {
  return `${Math.round(value * 100)}`;
}

function describeBox(box: BoxDimensions) {
  const size = `${centimeters(box.length_m)} × ${centimeters(box.width_m)} × ${centimeters(box.height_m)} cm`;
  return box.gross_weight_kg != null ? `${size}, ${round(box.gross_weight_kg, 1)} kg` : size;
}

function requireEditor(actor: WarehouseBoxActor) {
  if (!(BOX_EDITOR_ROLES as readonly string[]).includes(actor.role)) {
    throw new HttpsError("permission-denied", "Caixas do armazém: somente administração ou operação de armazém.");
  }
}

function actorFields(actor: WarehouseBoxActor) {
  return {
    uid: actor.uid,
    role: actor.role,
    email: actor.email ?? null,
    name: actor.name ?? null,
    customer_code: actor.customer_code ?? null,
  };
}

export function requireDimensions(raw: BoxDimensions): BoxDimensions {
  const read = (value: unknown, problem: string) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > MAX_METERS) {
      throw new HttpsError("invalid-argument", `${problem}: informe em metros.`);
    }
    return round(parsed, 3);
  };
  const dimensions: BoxDimensions = {
    length_m: read(raw.length_m, "Comprimento da caixa inválido"),
    width_m: read(raw.width_m, "Largura da caixa inválida"),
    height_m: read(raw.height_m, "Altura da caixa inválida"),
    gross_weight_kg: null,
  };
  if (raw.gross_weight_kg !== undefined && raw.gross_weight_kg !== null) {
    const weight = Number(raw.gross_weight_kg);
    if (!Number.isFinite(weight) || weight < 0) {
      throw new HttpsError("invalid-argument", "Peso bruto inválido: informe em quilos.");
    }
    dimensions.gross_weight_kg = round(weight, 2);
  }
  return dimensions;
}

export function emptyOccupancy(): PositionOccupancy {
  return { front_used_m: 0, weight_used_kg: 0, box_count: 0, sku_codes: new Set(), supports: [] };
}

type OccupiedBox = {
  code?: string | null;
  id?: string | null;
  customer_code?: string | null;
  status?: string | null;
  location_id?: string | null;
  front_m?: number | null;
  depth_m?: number | null;
  height_m?: number | null;
  placed_height_m?: number | null;
  support_box_code?: string | null;
  gross_weight_kg?: number | null;
};

/** Ocupação por posição a partir das caixas guardadas e dos saldos por posição. */
export function buildOccupancy(
  boxes: OccupiedBox[],
  balances: Array<{ location_id?: string | null; sku_code?: string | null; qty_on_hand?: number | null }>,
): Map<string, PositionOccupancy> {
  const occupancy = new Map<string, PositionOccupancy>();
  const at = (code: string) => {
    const existing = occupancy.get(code);
    if (existing) return existing;
    const created = emptyOccupancy();
    occupancy.set(code, created);
    return created;
  };
  const normalized = (value: unknown) => String(value ?? "").trim().toUpperCase();
  const byCode = new Map(boxes.map((box) => [normalized(box.code ?? box.id), box]));
  const children = new Map<string, number>();
  for (const box of boxes) {
    const support = normalized(box.support_box_code);
    if (support) children.set(support, (children.get(support) ?? 0) + 1);
  }
  // Reconstitui a altura pela cadeia real de apoios, sem confiar numa altura
  // enviada pelo cliente. Documentos incompletos/órfãos não liberam capacidade.
  const topOf = (box: OccupiedBox, visiting = new Set<OccupiedBox>()): number | null => {
    if (visiting.has(box)) return null;
    const height = Number(box.placed_height_m ?? box.height_m);
    if (![box.front_m, box.depth_m, height].every((value) => Number.isFinite(value) && Number(value) > 0)) return null;
    const supportCode = normalized(box.support_box_code);
    if (!supportCode) return height;
    const support = byCode.get(supportCode);
    if (!support || children.get(supportCode) !== 1 ||
        support.status !== "stored" ||
        normalized(support.location_id) !== normalized(box.location_id) ||
        support.customer_code !== box.customer_code ||
        Number(box.front_m) > Number(support.front_m) + TOLERANCE_M ||
        Number(box.depth_m) > Number(support.depth_m) + TOLERANCE_M) return null;
    const next = new Set(visiting);
    next.add(box);
    const below = topOf(support, next);
    return below == null ? null : round(below + height, 3);
  };
  for (const box of boxes) {
    const code = normalized(box.location_id);
    if (!code) continue;
    const entry = at(code);
    const top = topOf(box);
    const supported = Boolean(normalized(box.support_box_code)) && top != null;
    if (!supported) entry.front_used_m += Number(box.front_m ?? 0) || 0;
    const boxCode = normalized(box.code ?? box.id);
    if (boxCode && box.status === "stored" && !children.has(boxCode) && top != null) {
      entry.supports!.push({ code: boxCode, customer_code: box.customer_code, front_m: Number(box.front_m), depth_m: Number(box.depth_m), top_m: top });
    }
    entry.weight_used_kg += Number(box.gross_weight_kg ?? 0) || 0;
    entry.box_count += 1;
  }
  for (const balance of balances) {
    const code = String(balance.location_id ?? "").trim().toUpperCase();
    const sku = String(balance.sku_code ?? "").trim();
    if (!code || !sku || Number(balance.qty_on_hand ?? 0) <= 0) continue;
    at(code).sku_codes.add(sku);
  }
  return occupancy;
}

/**
 * Como a caixa entra na prateleira. Sem orientação explícita escolhe a menor
 * frente; só considera tombar a caixa com allow_tilt. A mesma função valida
 * a sugestão e a guarda, incluindo a orientação confirmada pela pessoa.
 */
export function placementFor(
  position: Pick<SlottingPosition, "length_m" | "depth_m" | "height_m" | "max_weight_kg" | "customer_code">,
  box: BoxDimensions,
  occupancy: PositionOccupancy = emptyOccupancy(),
  options: BoxPlacementOptions = {},
): Placement | null {
  if (
    position.max_weight_kg != null &&
    box.gross_weight_kg != null &&
    occupancy.weight_used_kg + box.gross_weight_kg > position.max_weight_kg + TOLERANCE_M
  ) {
    return null;
  }
  const freeFront = position.length_m - occupancy.front_used_m;
  const axes = { length: box.length_m, width: box.width_m, height: box.height_m };
  const orientations = options.allow_tilt === true ? BOX_ORIENTATIONS : BOX_ORIENTATIONS.slice(0, 2);
  const placements: Placement[] = orientations
    .filter((orientation) => !options.orientation || orientation === options.orientation)
    .map((orientation) => {
      type Axis = keyof typeof axes;
      const [front, depth, height] = orientation.split("_") as [Axis, Axis, Axis];
      return { front_m: axes[front]!, depth_m: axes[depth]!, height_m: axes[height]!, orientation };
    })
    .filter((placement) =>
      placement.depth_m <= position.depth_m + TOLERANCE_M &&
      placement.height_m <= position.height_m + TOLERANCE_M)
    .sort((left, right) => left.front_m - right.front_m || left.height_m - right.height_m);

  // Prefere a base da prateleira quando há frente. Na confirmação, o apoio
  // escolhido é fixo: nunca troca silenciosamente piso, orientação ou caixa.
  if (options.support_box_code == null) {
    const floor = placements.find((placement) => placement.front_m <= freeFront + TOLERANCE_M);
    if (floor) return floor;
  }
  if (options.allow_stacking !== true || options.support_box_code === null) return null;
  const supports = [...(occupancy.supports ?? [])]
    .filter((support) =>
      (!position.customer_code || support.customer_code === position.customer_code) &&
      (!options.support_box_code || support.code === options.support_box_code))
    .sort((left, right) => left.top_m - right.top_m || left.code.localeCompare(right.code));
  for (const support of supports) {
    const placement = placements.find((candidate) =>
      candidate.front_m <= support.front_m + TOLERANCE_M &&
      candidate.front_m <= position.length_m + TOLERANCE_M &&
      candidate.depth_m <= support.depth_m + TOLERANCE_M &&
      support.top_m + candidate.height_m <= position.height_m + TOLERANCE_M);
    if (placement) return { ...placement, support_box_code: support.code, base_height_m: support.top_m };
  }
  return null;
}

type BoxAxis = "length" | "width" | "height";

function placementOn(box: BoxDimensions, orientation: BoxOrientation): Placement {
  const axes: Record<BoxAxis, number> = { length: box.length_m, width: box.width_m, height: box.height_m };
  const [front, depth, height] = orientation.split("_") as [BoxAxis, BoxAxis, BoxAxis];
  return { front_m: axes[front], depth_m: axes[depth], height_m: axes[height], orientation };
}

function orientationsFor(options: BoxPlacementOptions): BoxOrientation[] {
  const orientations = options.allow_tilt === true ? [...BOX_ORIENTATIONS] : BOX_ORIENTATIONS.slice(0, 2);
  const filtered = orientations.filter((orientation) => !options.orientation || orientation === options.orientation);
  if (filtered.length) return filtered;
  return [options.orientation ?? "length_width_height"];
}

/**
 * Encaixe da abertura. Quando o cálculo confirma, devolve essa posição.
 * Quando não confirma, registra a menor frente que cabe no vão cadastrado,
 * ou a orientação pedida se nenhuma couber. Não inventa caixa de apoio:
 * a frente pode passar do comprimento, e opening_model_fit marca o registro.
 */
export function resolveOpeningPlacement(
  position: Pick<SlottingPosition, "length_m" | "depth_m" | "height_m" | "max_weight_kg" | "customer_code">,
  box: BoxDimensions,
  occupancy: PositionOccupancy = emptyOccupancy(),
  options: BoxPlacementOptions = {},
): Placement & { model_fit: boolean } {
  const verified = placementFor(position, box, occupancy, options);
  if (verified) return { ...verified, model_fit: true };
  const placements = orientationsFor(options).map((orientation) => placementOn(box, orientation));
  const fitsOpening = placements.filter((placement) =>
    placement.depth_m <= position.depth_m + TOLERANCE_M &&
    placement.height_m <= position.height_m + TOLERANCE_M);
  const [chosen] = (fitsOpening.length ? fitsOpening : placements)
    .slice()
    .sort((left, right) => left.front_m - right.front_m || left.height_m - right.height_m);
  return { ...chosen!, model_fit: false };
}

/** Cópia de operations.openingInventorySessionDocumentId. O teste de integração trava as duas. */
export function openingSessionDocId(customerCode: string) {
  return `opening_${customerCode}`.replace(/[^\w.-]/g, "_").slice(0, 900);
}

async function openingInventoryIsOpen(db: Firestore, customerCode: string) {
  const snapshot = await db.collection("opening_inventory_sessions").doc(openingSessionDocId(customerCode)).get();
  return snapshot.exists && snapshot.get("status") === "open" && snapshot.get("customer_code") === customerCode;
}

/**
 * Escolhe a prateleira para uma caixa. Determinístico: a mesma entrada dá a
 * mesma resposta. Devolve também as alternativas e, sem resposta, o motivo.
 */
export function suggestPosition(
  box: BoxDimensions & BoxPlacementOptions & { customer_code: string; sku_codes?: string[] },
  positions: SlottingPosition[],
  occupancy: Map<string, PositionOccupancy>,
  options: { exclude?: string[] } = {},
): SlottingResult {
  const customer = box.customer_code.trim();
  const excluded = new Set((options.exclude ?? []).map((code) => code.trim().toUpperCase()));
  const skus = new Set((box.sku_codes ?? []).map((sku) => sku.trim()).filter(Boolean));
  const zone = positions.filter((position) => String(position.customer_code ?? "").trim() === customer);
  if (!zone.length) {
    return {
      position: null,
      alternatives: [],
      rejected: `Nenhuma prateleira está na zona de ${customer}. Atribua uma rua a esse cliente em Estoque › Posições.`,
      checked: 0,
    };
  }
  const sequenceOf = (position: SlottingPosition) => Number(position.sequence ?? Number.MAX_SAFE_INTEGER);
  const sameSkuPositions = zone
    .filter((position) => {
      const present = occupancy.get(position.code)?.sku_codes;
      return present ? [...skus].some((sku) => present.has(sku)) : false;
    })
    .sort((left, right) => sequenceOf(left) - sequenceOf(right) || left.code.localeCompare(right.code));
  const sameSkuSequences = sameSkuPositions.map(sequenceOf);
  const active = zone.filter(
    (position) => (position.status ?? "active") === "active" && !excluded.has(position.code.toUpperCase()),
  );

  const candidates: Array<SlottingCandidate & { distance: number }> = [];
  for (const position of active) {
    const current = occupancy.get(position.code) ?? emptyOccupancy();
    const placement = placementFor(position, box, current, box);
    if (!placement) continue;
    const freeFront = position.length_m - current.front_used_m;
    const leftover = round(freeFront - (placement.support_box_code ? 0 : placement.front_m), 3);
    const sequence = sequenceOf(position);
    const sharedSku = [...skus].find((sku) => current.sku_codes.has(sku));
    if (sharedSku) {
      candidates.push({
        code: position.code,
        tier: 1,
        reason: `Já tem ${sharedSku} nesta prateleira e ainda cabe.`,
        leftover_m: leftover,
        sequence,
        placement,
        distance: 0,
      });
    } else if (sameSkuSequences.length) {
      const distance = Math.min(...sameSkuSequences.map((other) => Math.abs(sequence - other)));
      // A prateleira do produto mais perto desta; em empate, a primeira na caminhada.
      const anchor = sameSkuPositions.find((other) => Math.abs(sequenceOf(other) - sequence) === distance);
      candidates.push({
        code: position.code,
        tier: 2,
        reason: `A mais próxima de ${anchor?.code ?? "onde o produto já está"}, que já tem o mesmo produto.`,
        leftover_m: leftover,
        sequence,
        placement,
        distance,
      });
    } else {
      candidates.push({
        code: position.code,
        tier: 3,
        reason: "Primeira prateleira da zona com espaço, na ordem de caminhada.",
        leftover_m: leftover,
        sequence,
        placement,
        distance: 0,
      });
    }
  }

  candidates.sort(
    (left, right) =>
      left.tier - right.tier ||
      left.distance - right.distance ||
      (left.tier === 3 ? left.sequence - right.sequence : left.leftover_m - right.leftover_m) ||
      left.sequence - right.sequence,
  );
  const strip = ({ distance: _distance, ...candidate }: SlottingCandidate & { distance: number }) => candidate;
  const [first, ...rest] = candidates;
  if (!first) {
    const rejected = !active.length
      ? `A zona de ${customer} não tem prateleira ativa disponível.`
      : `Nenhuma prateleira da zona de ${customer} tem espaço para uma caixa de ${describeBox(box)}. Coordenação precisa ampliar a zona ou liberar espaço.`;
    return { position: null, alternatives: [], rejected, checked: active.length };
  }
  return {
    position: strip(first),
    alternatives: rest.slice(0, 2).map(strip),
    rejected: null,
    checked: active.length,
  };
}

// ----------------------------------------------------------- leitura Firestore

type Row = Record<string, unknown>;

export function asPosition(data: Row): SlottingPosition {
  return {
    code: String(data.code ?? data.id ?? ""),
    length_m: Number(data.length_m ?? 0),
    depth_m: Number(data.depth_m ?? 0),
    height_m: Number(data.height_m ?? 0),
    max_weight_kg: data.max_weight_kg == null ? null : Number(data.max_weight_kg),
    sequence: data.sequence == null ? null : Number(data.sequence),
    customer_code: data.customer_code == null ? null : String(data.customer_code),
    status: data.status == null ? "active" : String(data.status),
  };
}

/** Prateleiras da zona, caixas guardadas/reservadas e SKUs por posição do cliente. */
export async function readSlottingContext(db: Firestore, customerCode: string) {
  const [positionsSnapshot, boxesSnapshot, balancesSnapshot] = await Promise.all([
    db.collection(WAREHOUSE_POSITIONS_COLLECTION).where("customer_code", "==", customerCode).get(),
    db.collection(WAREHOUSE_BOXES_COLLECTION).where("customer_code", "==", customerCode).where("status", "in", ["stored", "committing"]).get(),
    db.collection("stock_balances").where("customer_code", "==", customerCode).get(),
  ]);
  const positions = positionsSnapshot.docs.map((document) => asPosition(document.data()));
  const occupancy = buildOccupancy(
    boxesSnapshot.docs.map((document) => document.data()),
    balancesSnapshot.docs.map((document) => document.data()),
  );
  return { positions, occupancy };
}

export async function suggestWarehousePosition(
  db: Firestore,
  input: SuggestWarehousePositionInput,
  actor: WarehouseBoxActor,
) {
  requireEditor(actor);
  const customerCode = String(input.customer_code ?? "").trim();
  if (!customerCode) throw new HttpsError("invalid-argument", "Informe o cliente.");
  const box = requireDimensions(input);
  const { positions, occupancy } = await readSlottingContext(db, customerCode);
  const locationCode = String(input.location_id ?? "").trim().toUpperCase();
  let candidates = positions;
  let selected: SlottingPosition | undefined;
  if (locationCode) {
    // A leitura já é limitada ao cliente: uma posição de outra zona não é
    // exposta nem aceita pela prévia manual.
    selected = positions.find((position) => position.code === locationCode);
    if (!selected) throw new HttpsError("not-found", "Prateleira não cadastrada na zona deste cliente.");
    if ((selected.status ?? "active") !== "active") {
      throw new HttpsError("failed-precondition", "Escolha uma prateleira ativa da zona do cliente.");
    }
    candidates = [selected];
  }
  const openingChoice = input.opening_inventory === true && selected != null && await openingInventoryIsOpen(db, customerCode);
  const result = suggestPosition(
    { ...box, allow_tilt: input.allow_tilt, allow_stacking: input.allow_stacking, support_box_code: input.support_box_code, orientation: input.orientation, customer_code: customerCode, sku_codes: input.sku_codes ?? [] },
    candidates,
    occupancy,
    { exclude: (input.exclude ?? []).filter((code) => !(openingChoice && code.trim().toUpperCase() === locationCode)) },
  );
  if (locationCode && selected) {
    if (!result.position && openingChoice) {
      const current = occupancy.get(selected.code) ?? emptyOccupancy();
      const resolved = resolveOpeningPlacement(selected, box, current, {
        allow_tilt: input.allow_tilt,
        allow_stacking: input.allow_stacking,
        support_box_code: input.support_box_code,
        orientation: input.orientation,
      });
      if (!resolved.model_fit) {
        const { model_fit: _fit, ...placement } = resolved;
        const freeFront = selected.length_m - current.front_used_m;
        result.position = {
          code: selected.code,
          tier: 3,
          reason: "Posição escolhida na abertura. O cálculo de encaixe não confirmou.",
          leftover_m: round(freeFront - placement.front_m, 3),
          sequence: Number(selected.sequence ?? Number.MAX_SAFE_INTEGER),
          placement,
          model_fit: false,
        };
        result.rejected = null;
      }
    }
    if (!result.position) {
      throw new HttpsError("failed-precondition", "A caixa não cabe nesta prateleira ou ela foi excluída da escolha. Selecione outra.");
    }
    if (result.position.model_fit !== false) result.position.reason = "Prateleira selecionada manualmente.";
  }
  return {
    ok: true,
    customer_code: customerCode,
    box,
    zone_positions: positions.length,
    ...result,
  };
}

// --------------------------------------------------------------- criar caixa

export type WarehouseBoxRecord = {
  code: string;
  customer_code: string;
  status: "stored";
  location_id: string;
  length_m: number;
  width_m: number;
  height_m: number;
  front_m: number;
  depth_m: number;
  placed_height_m: number;
  orientation: BoxOrientation;
  allow_tilt: boolean;
  allow_stacking: boolean;
  support_box_code: string | null;
  base_height_m: number;
  gross_weight_kg: number | null;
  line_count: number;
  unit_count: number;
  total_cost: number;
  /** Presente só quando a abertura guardou sem o encaixe calculado. */
  opening_model_fit?: false;
};

export type CreateWarehouseBoxResult = { ok: true; box: WarehouseBoxRecord; replayed?: boolean };

async function readReceipt(transaction: Transaction, ref: DocumentReference, inputHash: string) {
  const snapshot = await transaction.get(ref);
  if (!snapshot.exists) return undefined;
  const data = snapshot.data() ?? {};
  if (data.input_hash !== inputHash) {
    throw new HttpsError("already-exists", "A chave de idempotência já foi usada com outro conteúdo.");
  }
  return data.result as Record<string, unknown>;
}

/**
 * Cria a caixa já guardada na posição informada (a sugerida, ou outra que o
 * motor ofereceu). Reconfere na transação que a posição é da zona do cliente
 * e está ativa. Fora da abertura, também exige o encaixe calculado. Com a
 * sessão de abertura aberta, a posição escolhida entra mesmo sem esse encaixe
 * e fica marcada. A recusa vale só para a caixa atual e fica no evento, sem
 * mudar o cadastro da prateleira.
 */
export async function createWarehouseBox(
  db: Firestore,
  input: CreateWarehouseBoxInput,
  actor: WarehouseBoxActor,
): Promise<CreateWarehouseBoxResult> {
  requireEditor(actor);
  const customerCode = String(input.customer_code ?? "").trim();
  if (!customerCode) throw new HttpsError("invalid-argument", "Informe o cliente.");
  const box = requireDimensions(input);
  const locationCode = String(input.location_id ?? "").trim().toUpperCase();
  if (!locationCode || locationCode.includes("/")) throw new HttpsError("invalid-argument", "Informe a posição da caixa.");
  const refusalCode = input.refusal ? String(input.refusal.position).trim().toUpperCase() : "";
  if (refusalCode && refusalCode === locationCode) {
    throw new HttpsError("invalid-argument", "A posição recusada não pode ser a mesma da guarda.");
  }
  const nonce = String(input.idempotency_key ?? "").trim();
  if (!nonce) throw new HttpsError("invalid-argument", "Chave de idempotência obrigatória.");
  const sessionId = String(input.session_id ?? "").trim();
  const sessionRef = sessionId ? db.collection("opening_inventory_sessions").doc(sessionId) : null;
  const inputHash = digest(input, 64);
  const receiptRef = db.collection(OPERATIONS_COLLECTION).doc(`op_warehouse_box_${digest({ customerCode, nonce })}`);
  const counterRef = db.collection(WAREHOUSE_COUNTERS_COLLECTION).doc(BOX_COUNTER_DOC);
  const positionRef = db.collection(WAREHOUSE_POSITIONS_COLLECTION).doc(locationCode);
  const refusedRef = refusalCode ? db.collection(WAREHOUSE_POSITIONS_COLLECTION).doc(refusalCode) : null;

  return db.runTransaction(async (transaction) => {
    const replay = await readReceipt(transaction, receiptRef, inputHash);
    if (replay) return { ...(replay as CreateWarehouseBoxResult), replayed: true };

    const [counterSnapshot, positionSnapshot, boxesSnapshot, refusedSnapshot, sessionSnapshot] = await Promise.all([
      transaction.get(counterRef),
      transaction.get(positionRef),
      transaction.get(
        db.collection(WAREHOUSE_BOXES_COLLECTION).where("location_id", "==", locationCode).where("status", "in", ["stored", "committing"]),
      ),
      refusedRef ? transaction.get(refusedRef) : Promise.resolve(null),
      sessionRef ? transaction.get(sessionRef) : Promise.resolve(null),
    ]);
    if (!positionSnapshot.exists) {
      throw new HttpsError("not-found", `Posição ${locationCode} não está cadastrada em Estoque › Posições.`);
    }
    const position = asPosition(positionSnapshot.data() ?? {});
    if ((position.status ?? "active") !== "active") {
      throw new HttpsError(
        "failed-precondition",
        `A prateleira ${locationCode} está ${position.status === "blocked" ? "bloqueada" : "em verificação"}; escolha outra.`,
      );
    }
    if (String(position.customer_code ?? "") !== customerCode) {
      throw new HttpsError(
        "failed-precondition",
        `A prateleira ${locationCode} não é da zona de ${customerCode}. Atribua a rua ao cliente em Estoque › Posições.`,
      );
    }
    const occupancy = buildOccupancy(
      boxesSnapshot.docs.map((document) => document.data()),
      [],
    ).get(locationCode) ?? emptyOccupancy();
    const verified = placementFor(position, box, occupancy, input);
    const sessionOpen = Boolean(
      sessionSnapshot?.exists &&
      sessionId === openingSessionDocId(customerCode) &&
      sessionSnapshot.get("status") === "open" &&
      sessionSnapshot.get("customer_code") === customerCode,
    );
    if (!verified && !sessionOpen) {
      throw new HttpsError(
        "failed-precondition",
        `A caixa de ${describeBox(box)} não cabe na prateleira ${locationCode}: frente livre de ${centimeters(Math.max(0, position.length_m - occupancy.front_used_m))} cm, profundidade ${centimeters(position.depth_m)} cm, altura ${centimeters(position.height_m)} cm${position.max_weight_kg != null ? `, peso máximo ${position.max_weight_kg} kg` : ""}. Peça outra sugestão.`,
      );
    }
    const resolved = verified
      ? { ...verified, model_fit: true as const }
      : resolveOpeningPlacement(position, box, occupancy, input);
    const { model_fit: openingModelFit, ...placement } = resolved;
    if (refusedRef && !refusedSnapshot?.exists) {
      throw new HttpsError("not-found", `Posição recusada ${refusalCode} não está cadastrada.`);
    }

    const sequence = Number(counterSnapshot.data()?.last ?? 0) + 1;
    const code = formatBoxCode(sequence);
    const boxRef = db.collection(WAREHOUSE_BOXES_COLLECTION).doc(code);
    const now = new Date().toISOString();
    const suggestion = input.suggestion
      ? {
          position: input.suggestion.position ? String(input.suggestion.position).trim().toUpperCase() : null,
          reason: input.suggestion.reason ?? null,
          alternatives: (input.suggestion.alternatives ?? []).map((item) => String(item).trim().toUpperCase()),
          followed: input.suggestion.position
            ? String(input.suggestion.position).trim().toUpperCase() === locationCode
            : null,
        }
      : null;
    const refusal = input.refusal ? { position: refusalCode, reason: input.refusal.reason } : null;

    // Serializa a capacidade com a confirmação das caixas em conferência,
    // que também lê e atualiza esta posição antes de reservar espaço.
    transaction.update(positionRef, { occupancy_revision: FieldValue.increment(1) });
    transaction.set(
      counterRef,
      { last: sequence, prefix: "CX", updated_at: FieldValue.serverTimestamp() },
      { merge: true },
    );
    const record: WarehouseBoxRecord = {
      code,
      customer_code: customerCode,
      status: "stored",
      location_id: locationCode,
      length_m: box.length_m,
      width_m: box.width_m,
      height_m: box.height_m,
      front_m: placement.front_m,
      depth_m: placement.depth_m,
      placed_height_m: placement.height_m,
      orientation: placement.orientation,
      allow_tilt: input.allow_tilt === true,
      allow_stacking: input.allow_stacking === true,
      support_box_code: placement.support_box_code ?? null,
      base_height_m: placement.base_height_m ?? 0,
      gross_weight_kg: box.gross_weight_kg ?? null,
      line_count: 0,
      unit_count: 0,
      total_cost: 0,
      ...(openingModelFit ? {} : { opening_model_fit: false as const }),
    };
    transaction.create(boxRef, {
      id: code,
      ...record,
      sku_codes: [],
      origin: sessionId ? { kind: "opening_inventory", session_id: sessionId } : { kind: "manual" },
      suggestion,
      refusal,
      notes: input.notes ?? null,
      stored_at: now,
      stored_by: actorFields(actor),
      created_at: FieldValue.serverTimestamp(),
      created_by: actor.uid,
      updated_at: FieldValue.serverTimestamp(),
    });

    const events: string[] = [];
    const boxEventRef = db.collection("events").doc();
    events.push(boxEventRef.id);
    transaction.create(boxEventRef, {
      id: boxEventRef.id,
      type: "warehouse.box_stored",
      title: `Caixa ${code} guardada em ${locationCode}`,
      description: `${describeBox(box)} · ${
        suggestion?.followed === false
          ? `posição diferente da sugerida (${suggestion.position})`
          : suggestion?.position
            ? "na posição sugerida pelo sistema"
            : "posição informada sem sugestão"
      }${refusal ? ` · recusou ${refusal.position}: ${refusal.reason}` : ""}${openingModelFit ? "" : " · encaixe calculado não confirmou; posição registrada na abertura"}`,
      severity: "info",
      entity_type: "warehouse_box",
      entity_id: code,
      customer_code: customerCode,
      payload: {
        box: record,
        suggestion,
        refusal,
        session_id: sessionId || null,
        occupancy_before: { front_used_m: occupancy.front_used_m, box_count: occupancy.box_count },
      },
      occurred_at: now,
      source: "functions_warehouse_boxes",
      actor: actorFields(actor),
      created_at: FieldValue.serverTimestamp(),
    });

    if (refusedRef && refusal) {
      const refusalEventRef = db.collection("events").doc();
      events.push(refusalEventRef.id);
      transaction.create(refusalEventRef, {
        id: refusalEventRef.id,
        type: "warehouse.position_refused",
        title: `Posição ${refusal.position} recusada na guarda da ${code}`,
        description: `${refusal.reason}. Recusa desta sugestão para esta caixa; o estado da prateleira não foi alterado.`,
        severity: "warning",
        entity_type: "warehouse_position",
        entity_id: refusal.position,
        customer_code: customerCode,
        payload: { box_code: code, stored_at: locationCode, reason: refusal.reason },
        occurred_at: now,
        source: "functions_warehouse_boxes",
        actor: actorFields(actor),
        created_at: FieldValue.serverTimestamp(),
      });
    }

    const result: CreateWarehouseBoxResult = { ok: true, box: record };
    transaction.create(receiptRef, {
      id: receiptRef.id,
      kind: "warehouse.box.create",
      target_id: code,
      input_hash: inputHash,
      status: "completed",
      actor: actorFields(actor),
      result,
      events,
      created_at: FieldValue.serverTimestamp(),
      completed_at: FieldValue.serverTimestamp(),
    });
    return result;
  });
}

// -------------------------------------------------------------- remover caixa

export async function removeWarehouseBox(
  db: Firestore,
  input: { code: string; customer_code?: string },
  actor: WarehouseBoxActor,
): Promise<{ ok: true; code: string }> {
  requireEditor(actor);
  const code = String(input.code ?? "").trim().toUpperCase();
  if (!code || code.includes("/")) throw new HttpsError("invalid-argument", "Caixa inválida.");
  const ref = db.collection(WAREHOUSE_BOXES_COLLECTION).doc(code);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw new HttpsError("not-found", `Caixa ${code} não encontrada.`);
    const data = snapshot.data() ?? {};
    const customerCode = String(input.customer_code ?? "").trim();
    if (customerCode && String(data.customer_code ?? "") !== customerCode) {
      throw new HttpsError("permission-denied", "Caixa de outro cliente.");
    }
    if (data.status === "committing") {
      throw new HttpsError("failed-precondition", `A caixa ${code} está sendo guardada. Aguarde a conclusão antes de removê-la.`);
    }
    if (
      (data.status === "counting" || data.status === "reviewed") &&
      Number(data.draft_line_count ?? 0) > 0
    ) {
      throw new HttpsError("failed-precondition", `A caixa ${code} ainda tem produtos em conferência. Remova as linhas dela antes de removê-la.`);
    }
    if (Number(data.line_count ?? 0) > 0 || Number(data.unit_count ?? 0) > 0) {
      throw new HttpsError(
        "failed-precondition",
        `A caixa ${code} ainda tem ${Number(data.line_count ?? 0)} produto(s) lançados. Remova as linhas dela antes de removê-la.`,
      );
    }
    const location = String(data.location_id ?? "");
    const positionRef = location ? db.collection(WAREHOUSE_POSITIONS_COLLECTION).doc(location) : null;
    const [positionSnapshot, supportedBoxes] = await Promise.all([
      positionRef ? transaction.get(positionRef) : Promise.resolve(null),
      transaction.get(db.collection(WAREHOUSE_BOXES_COLLECTION).where("support_box_code", "==", code)),
    ]);
    if (supportedBoxes.docs.some((box) => ["stored", "committing"].includes(String(box.get("status"))))) {
      throw new HttpsError("failed-precondition", `A caixa ${code} serve de apoio para outra caixa. Retire a caixa de cima antes de removê-la.`);
    }
    // Disputa a mesma revisão da guarda: não remove um apoio entre sugestão
    // e confirmação, nem durante uma reserva concorrente.
    if (positionRef && positionSnapshot?.exists) {
      transaction.update(positionRef, { occupancy_revision: FieldValue.increment(1) });
    }
    transaction.delete(ref);
    const eventRef = db.collection("events").doc();
    transaction.create(eventRef, {
      id: eventRef.id,
      type: "warehouse.box_removed",
      title: `Caixa ${code} removida`,
      description: `Estava em ${String(data.location_id ?? "")}, sem produtos lançados.`,
      severity: "warning",
      entity_type: "warehouse_box",
      entity_id: code,
      customer_code: data.customer_code ?? null,
      payload: { box: data },
      occurred_at: new Date().toISOString(),
      source: "functions_warehouse_boxes",
      actor: actorFields(actor),
      created_at: FieldValue.serverTimestamp(),
    });
    return { ok: true, code };
  });
}

/** Caixas de um cliente, mais novas primeiro (uso em testes e rotinas). */
export async function listWarehouseBoxes(db: Firestore, customerCode: string) {
  const snapshot = await db
    .collection(WAREHOUSE_BOXES_COLLECTION)
    .where("customer_code", "==", customerCode)
    .get();
  return snapshot.docs
    .map((document) => document.data())
    .sort((left, right) => String(right.code).localeCompare(String(left.code)));
}
