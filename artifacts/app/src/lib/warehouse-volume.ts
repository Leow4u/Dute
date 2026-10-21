import type { WarehouseBox } from "@/lib/warehouse-boxes";

export type VolumeDimensions = Pick<WarehouseBox, "length_m" | "width_m" | "height_m">;
export type VolumePosition = { code: string; length_m: number; depth_m: number; height_m: number };
export type VolumeBox = VolumeDimensions & Pick<WarehouseBox, "status" | "location_id">;

export type ShelfVolume = {
  totalM3: number | null;
  occupiedM3: number | null;
  freeM3: number | null;
  occupiedPercent: number | null;
  boxCount: number;
  pendingCount: number;
  projectedFreeM3: number | null;
  projectedOccupiedPercent: number | null;
};

const roundVolume = (value: number) => Math.round(value * 1e9) / 1e9;
const percent = (occupied: number, total: number) => Math.round((occupied / total) * 10_000) / 100;
const codeKey = (code: string) => code.trim().toUpperCase();

function volume(sides: number[]): number | null {
  if (sides.some((side) => !Number.isFinite(side) || side <= 0)) return null;
  const result = sides.reduce((product, side) => product * side, 1);
  return Number.isFinite(result) && result > 0 ? result : null;
}

/** Volume geométrico medido, independente da orientação e do empilhamento. */
export function boxVolumeM3(box: VolumeDimensions): number | null {
  const result = volume([box.length_m, box.width_m, box.height_m]);
  return result === null ? null : roundVolume(result);
}

/**
 * Estimativa das caixas já guardadas na posição, sem reservas ou rascunhos.
 * Guarda em andamento deixa o volume livre indisponível até a confirmação.
 * Não determina encaixe: as verificações físicas continuam nas Functions.
 * Caixa com medida desconhecida torna a ocupação desconhecida, nunca zero.
 * incomingBox é a caixa ainda não guardada, incluída somente na projeção.
 */
export function calculateShelfVolume(
  position: VolumePosition,
  boxes: readonly VolumeBox[],
  incomingBox?: VolumeDimensions,
): ShelfVolume {
  const capacity = volume([position.length_m, position.depth_m, position.height_m]);
  const totalM3 = capacity === null ? null : roundVolume(capacity);
  const key = codeKey(position.code);
  const registered = boxes.filter((box) => key && codeKey(box.location_id) === key);
  const stored = registered.filter((box) => box.status === "stored");
  const pendingCount = registered.filter((box) => box.status === "committing").length;
  const volumes = stored.map((box) => volume([box.length_m, box.width_m, box.height_m]));
  const sum = volumes.reduce<number>((result, value) => result + (value ?? 0), 0);
  const occupiedM3 = volumes.some((value) => value === null) || !Number.isFinite(sum) ? null : roundVolume(sum);
  const known = totalM3 !== null && totalM3 > 0 && occupiedM3 !== null;
  const freeKnown = known && pendingCount === 0;
  const incoming = incomingBox ? volume([incomingBox.length_m, incomingBox.width_m, incomingBox.height_m]) : null;
  const projected = freeKnown && incoming !== null ? roundVolume(occupiedM3 + incoming) : null;
  return {
    totalM3,
    occupiedM3,
    freeM3: freeKnown ? roundVolume(Math.max(0, totalM3 - occupiedM3)) : null,
    occupiedPercent: known ? percent(occupiedM3, totalM3) : null,
    boxCount: stored.length,
    pendingCount,
    projectedFreeM3: known && projected !== null ? roundVolume(Math.max(0, totalM3 - projected)) : null,
    projectedOccupiedPercent: known && projected !== null ? percent(projected, totalM3) : null,
  };
}

const volumeFormatter = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 });

export function formatVolumeM3(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  if (value > 0 && value < 0.0005) return "< 0,001 m³";
  return `${volumeFormatter.format(value)} m³`;
}
