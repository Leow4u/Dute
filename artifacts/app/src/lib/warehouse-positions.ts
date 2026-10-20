/**
 * Posições do armazém (mapa do galpão) vistas pelas telas internas: cada
 * prateleira com medidas úteis, sequência de caminhada e zona (cliente dona).
 *
 * Vocabulário da planilha de medidas, mantido na tela: comprimento é a
 * frente da prateleira, largura é a profundidade, altura é a altura livre.
 * As regras de quem altera e a validação vivem no backend
 * (functions/wms/src/domain/warehouse-positions.ts); aqui só leitura, formato e
 * a conta de quantas caixas cabem, para a prévia do cadastro.
 */

export type PositionStatus = "active" | "blocked" | "review";

export type WarehousePosition = {
  id: string;
  code: string;
  aisle: string;
  shelf: number;
  length_m: number;
  depth_m: number;
  height_m: number;
  max_weight_kg?: number | null;
  sequence?: number | null;
  customer_code?: string | null;
  status?: PositionStatus | string;
  notes?: string | null;
  source?: string;
};

export type BoxDimensions = {
  length_m: number;
  width_m: number;
  height_m: number;
};

/** Caixa de referência do levantamento de 16/10/2026: 50 × 50 × 35 cm. */
export const REFERENCE_BOX: BoxDimensions = { length_m: 0.5, width_m: 0.5, height_m: 0.35 };

export const POSITION_STATUS_LABELS: Record<PositionStatus, string> = {
  active: "ativa",
  blocked: "bloqueada",
  review: "em verificação",
};

export const POSITION_EDITOR_ROLES = ["owner", "admin", "interno"] as const;

export function canEditPositions(role: string | null | undefined) {
  return (POSITION_EDITOR_ROLES as readonly string[]).includes(String(role ?? ""));
}

/** O mesmo código que o backend monta: rua em maiúscula e prateleira com dois dígitos. */
export function positionCode(aisle: string, shelf: number | string) {
  const number = Number(shelf);
  const padded = Number.isFinite(number) ? String(number).padStart(2, "0") : String(shelf);
  return `${String(aisle).trim().toUpperCase()}-${padded}`;
}

/** "1,80" e "1.80" viram 1.8; vazio ou lixo viram null. */
export function parseDecimal(text: string | number | null | undefined) {
  if (typeof text === "number") return Number.isFinite(text) ? text : null;
  const cleaned = String(text ?? "").trim().replace(",", ".");
  if (!cleaned) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

const metersFormatter = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const kilosFormatter = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

export function formatMeters(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? "—" : `${metersFormatter.format(value)} m`;
}

export function formatKilos(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? "sem limite" : `${kilosFormatter.format(value)} kg`;
}

export function formatCentimeters(value: number) {
  return `${Math.round(value * 100)}`;
}

export type BoxCapacity = {
  /** Quantas caixas cabem na prateleira, na melhor orientação. */
  total: number;
  /** Lado a lado na frente. */
  columns: number;
  /** Uma atrás da outra, na profundidade. */
  rows: number;
  /** Uma em cima da outra, na altura livre. */
  layers: number;
};

function fits(space: number, size: number) {
  // Tolerância de 1 mm para medidas como 1,80 / 0,60 não perderem uma caixa por arredondamento.
  return Math.floor((space + 0.001) / size);
}

/**
 * Quantas caixas iguais cabem numa prateleira, sem empilhar sobre caixa de
 * outro tamanho. Testa as duas orientações horizontais (o lado maior na
 * frente ou na profundidade) e fica com a que leva mais caixas.
 */
export function boxCapacity(
  position: Pick<WarehousePosition, "length_m" | "depth_m" | "height_m">,
  box: BoxDimensions,
): BoxCapacity {
  const dims = [position.length_m, position.depth_m, position.height_m, box.length_m, box.width_m, box.height_m];
  if (dims.some((value) => !Number.isFinite(value) || value <= 0)) {
    return { total: 0, columns: 0, rows: 0, layers: 0 };
  }
  const layers = fits(position.height_m, box.height_m);
  const orientations: BoxCapacity[] = [
    { columns: fits(position.length_m, box.length_m), rows: fits(position.depth_m, box.width_m), layers, total: 0 },
    { columns: fits(position.length_m, box.width_m), rows: fits(position.depth_m, box.length_m), layers, total: 0 },
  ].map((option) => ({ ...option, total: option.columns * option.rows * option.layers }));
  return orientations.reduce((best, option) => (option.total > best.total ? option : best));
}

/** Sequência de caminhada primeiro; sem sequência, rua e prateleira. */
export function sortPositions<T extends Pick<WarehousePosition, "aisle" | "shelf" | "sequence">>(positions: T[]): T[] {
  return [...positions].sort((left, right) => {
    const bySequence = (left.sequence ?? Number.MAX_SAFE_INTEGER) - (right.sequence ?? Number.MAX_SAFE_INTEGER);
    if (bySequence) return bySequence;
    return left.aisle.localeCompare(right.aisle, "pt-BR") || Number(left.shelf) - Number(right.shelf);
  });
}

export type ZoneSummary = {
  customer_code: string | null;
  positions: number;
  aisles: string[];
};

/** Prateleiras por zona: cada cliente, e as sem dono ("livres"). Livres por último. */
export function summarizeZones(positions: Array<Pick<WarehousePosition, "aisle" | "customer_code">>): ZoneSummary[] {
  const zones = new Map<string | null, ZoneSummary>();
  for (const position of positions) {
    const key = position.customer_code?.trim() || null;
    const zone = zones.get(key) ?? { customer_code: key, positions: 0, aisles: [] };
    zone.positions += 1;
    if (!zone.aisles.includes(position.aisle)) zone.aisles.push(position.aisle);
    zones.set(key, zone);
  }
  return [...zones.values()]
    .map((zone) => ({ ...zone, aisles: [...zone.aisles].sort((a, b) => a.localeCompare(b, "pt-BR")) }))
    .sort((left, right) => {
      if (left.customer_code === null) return 1;
      if (right.customer_code === null) return -1;
      return left.customer_code.localeCompare(right.customer_code, "pt-BR");
    });
}

export function aislesOf(positions: Array<Pick<WarehousePosition, "aisle">>) {
  return [...new Set(positions.map((position) => position.aisle))].sort((a, b) => a.localeCompare(b, "pt-BR"));
}
