import { describe, expect, it } from "vitest";

import {
  REFERENCE_BOX,
  boxCapacity,
  canEditPositions,
  formatKilos,
  formatMeters,
  parseDecimal,
  positionCode,
  sortPositions,
  summarizeZones,
} from "./warehouse-positions";

describe("quantas caixas cabem numa prateleira", () => {
  const shelf = { length_m: 1.8, depth_m: 0.75, height_m: 0.65 };

  it("exemplo do levantamento: 1,80 × 0,75 × 0,65 recebe 3 caixas de 50 × 50 × 35", () => {
    expect(boxCapacity(shelf, REFERENCE_BOX)).toEqual({ total: 3, columns: 3, rows: 1, layers: 1 });
  });

  it("caixa menor empilha e vai em duas fileiras", () => {
    expect(boxCapacity(shelf, { length_m: 0.3, width_m: 0.3, height_m: 0.25 })).toEqual({
      total: 24,
      columns: 6,
      rows: 2,
      layers: 2,
    });
  });

  it("vira a caixa quando o lado menor na frente leva mais caixas", () => {
    const result = boxCapacity({ length_m: 1.78, depth_m: 0.75, height_m: 0.65 }, { length_m: 0.6, width_m: 0.4, height_m: 0.3 });
    expect(result).toEqual({ total: 8, columns: 4, rows: 1, layers: 2 });
  });

  it("não perde uma caixa por arredondamento de ponto flutuante", () => {
    expect(boxCapacity({ length_m: 1.8, depth_m: 0.6, height_m: 0.9 }, { length_m: 0.6, width_m: 0.6, height_m: 0.3 }).total).toBe(9);
  });

  it("zero quando a caixa não cabe ou a medida é inválida", () => {
    expect(boxCapacity(shelf, { length_m: 2, width_m: 0.5, height_m: 0.3 }).total).toBe(0);
    expect(boxCapacity(shelf, { length_m: 0.5, width_m: 0.5, height_m: 0.7 }).total).toBe(0);
    expect(boxCapacity({ length_m: 0, depth_m: 0.75, height_m: 0.65 }, REFERENCE_BOX).total).toBe(0);
  });
});

describe("código, números e formatos", () => {
  it("monta o código como o backend", () => {
    expect(positionCode("a", 3)).toBe("A-03");
    expect(positionCode("C", "12")).toBe("C-12");
  });

  it("aceita vírgula decimal do formulário", () => {
    expect(parseDecimal("1,80")).toBe(1.8);
    expect(parseDecimal("0.75")).toBe(0.75);
    expect(parseDecimal("")).toBeNull();
    expect(parseDecimal("abc")).toBeNull();
    expect(parseDecimal(2)).toBe(2);
  });

  it("formata metros e quilos em pt-BR", () => {
    expect(formatMeters(1.8)).toBe("1,80 m");
    expect(formatMeters(null)).toBe("—");
    expect(formatKilos(80)).toBe("80 kg");
    expect(formatKilos(null)).toBe("sem limite");
  });

  it("só administração e coordenação editam", () => {
    expect(canEditPositions("owner")).toBe(true);
    expect(canEditPositions("interno")).toBe(true);
    expect(canEditPositions("wms")).toBe(false);
    expect(canEditPositions(undefined)).toBe(false);
  });
});

describe("ordem e zonas", () => {
  const positions = [
    { code: "B-01", aisle: "B", shelf: 1, sequence: 16, customer_code: "BTG Pactual" },
    { code: "A-02", aisle: "A", shelf: 2, sequence: 2, customer_code: "BTG Pactual" },
    { code: "C-01", aisle: "C", shelf: 1, sequence: null, customer_code: null },
    { code: "A-01", aisle: "A", shelf: 1, sequence: 1, customer_code: "" },
  ];

  it("ordena pela sequência de caminhada; sem sequência vai para o fim, por rua e prateleira", () => {
    expect(sortPositions(positions).map((position) => position.code)).toEqual(["A-01", "A-02", "B-01", "C-01"]);
  });

  it("resume as zonas por cliente, com as livres por último", () => {
    expect(summarizeZones(positions)).toEqual([
      { customer_code: "BTG Pactual", positions: 2, aisles: ["A", "B"] },
      { customer_code: null, positions: 2, aisles: ["A", "C"] },
    ]);
  });
});
