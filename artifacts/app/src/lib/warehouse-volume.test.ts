import { describe, expect, it } from "vitest";
import { boxVolumeM3, calculateShelfVolume, formatVolumeM3, type VolumeBox } from "./warehouse-volume";

const position = { code: "A-03", length_m: 1.2, depth_m: 0.7, height_m: 1 };
const dimensions = { length_m: 0.6, width_m: 0.35, height_m: 0.2 };
const box = (patch: Partial<VolumeBox> = {}): VolumeBox => ({
  ...dimensions, status: "stored", location_id: "A-03", ...patch,
});

describe("volume registrado da prateleira", () => {
  it("usa m³, inclui todas as caixas guardadas e projeta a caixa pendente uma única vez", () => {
    const boxes = Array.from({ length: 12 }, () => box());
    const result = calculateShelfVolume(position, [...boxes, box({ status: "reviewed" })], dimensions);
    expect(result).toEqual({
      totalM3: 0.84, occupiedM3: 0.504, freeM3: 0.336, occupiedPercent: 60, boxCount: 12, pendingCount: 0,
      projectedFreeM3: 0.294, projectedOccupiedPercent: 65,
    });
    expect(calculateShelfVolume(position, boxes).projectedFreeM3).toBeNull();
  });

  it("ignora outras posições e caixas que ainda não foram guardadas", () => {
    const result = calculateShelfVolume(position, [
      box({ location_id: " a-03 " }),
      box({ location_id: "A-04" }),
      box({ status: "counting" }), box({ status: "reviewed" }),
      box({ status: "committing", location_id: "A-04" }), box({ status: "removed" }),
    ]);
    expect(result.boxCount).toBe(1);
    expect(result.occupiedM3).toBe(0.042);
    expect(result.freeM3).toBe(0.798);
  });

  it("não oferece espaço livre enquanto uma guarda está em andamento", () => {
    const result = calculateShelfVolume(position, [box(), box({ status: "committing" })], dimensions);
    expect(result.boxCount).toBe(1);
    expect(result.pendingCount).toBe(1);
    expect(result.occupiedM3).toBe(0.042);
    expect(result.freeM3).toBeNull();
    expect(result.projectedFreeM3).toBeNull();
    expect(result.projectedOccupiedPercent).toBeNull();
  });

  it("a orientação não muda o volume e medidas não são arredondadas antes da soma", () => {
    expect(boxVolumeM3(dimensions)).toBe(boxVolumeM3({ length_m: 0.2, width_m: 0.6, height_m: 0.35 }));
    const tiny = { length_m: 0.1, width_m: 0.1, height_m: 0.014 };
    expect(calculateShelfVolume(position, Array.from({ length: 10 }, () => box(tiny))).occupiedM3).toBe(0.0014);
  });

  it.each([0, -1, NaN, Infinity])("medida de caixa inválida (%s) deixa a ocupação desconhecida", (length_m) => {
    const result = calculateShelfVolume(position, [box(), box({ length_m })], dimensions);
    expect(result.totalM3).toBe(0.84);
    expect(result.occupiedM3).toBeNull();
    expect(result.freeM3).toBeNull();
    expect(result.occupiedPercent).toBeNull();
    expect(result.projectedFreeM3).toBeNull();
    expect(result.boxCount).toBe(2);
  });

  it("sem medida da prateleira, preserva o volume das caixas e não calcula capacidade livre", () => {
    const result = calculateShelfVolume({ ...position, height_m: 0 }, [box()]);
    expect(result.totalM3).toBeNull();
    expect(result.occupiedM3).toBe(0.042);
    expect(result.freeM3).toBeNull();
    expect(result.occupiedPercent).toBeNull();
  });

  it("volume acima da capacidade não produz espaço livre negativo nem esconde o excesso", () => {
    const result = calculateShelfVolume({ ...position, length_m: 0.1, depth_m: 0.1, height_m: 0.1 }, [box()]);
    expect(result.freeM3).toBe(0);
    expect(result.occupiedPercent).toBe(4200);
  });

  it("caixa pendente sem medidas não vira uma projeção de volume zero", () => {
    const result = calculateShelfVolume(position, [box()], { ...dimensions, width_m: 0 });
    expect(result.freeM3).toBe(0.798);
    expect(result.projectedFreeM3).toBeNull();
    expect(result.projectedOccupiedPercent).toBeNull();
  });

  it("formata em português, sem tratar medida ausente como zero", () => {
    expect(formatVolumeM3(0.336)).toBe("0,336 m³");
    expect(formatVolumeM3(0)).toBe("0,000 m³");
    expect(formatVolumeM3(null)).toBe("—");
    expect(formatVolumeM3(0.00014)).toBe("< 0,001 m³");
  });
});
