import { describe, expect, it } from "vitest";

import { warehouseBoxFromRecord } from "./warehouse-boxes";
import {
  LABELS_PER_SHEET,
  boxContent,
  boxLabel,
  labelsUrl,
  paginate,
  parseLabelsQuery,
  positionLabel,
  sheetMargins,
} from "./warehouse-labels";

const box = warehouseBoxFromRecord({
  code: "CX-000012",
  customer_code: "BTG Pactual",
  status: "stored",
  location_id: "A-03",
  length_m: 0.5,
  width_m: 0.5,
  height_m: 0.35,
  gross_weight_kg: 12.4,
  unit_count: 30,
  origin: { kind: "opening_inventory", session_id: "sessao-1" },
});
const line = (sku: string, qty: number, extra: Record<string, unknown> = {}) => ({
  box_code: "cx-000012",
  sku_code: sku,
  client_item_code: `C-${sku}`,
  product_name: `Produto ${sku}`,
  counted_qty: qty,
  ...extra,
});

describe("etiqueta da caixa", () => {
  it("lista o conteúdo por produto, somando linhas repetidas, da maior quantidade para a menor", () => {
    const content = boxContent([line("A", 5), line("B", 13), line("A", 7), line("C", 1, { box_code: "CX-000099" })], "CX-000012");
    expect(content).toEqual([
      { code: "C-B", name: "Produto B", qty: 13 },
      { code: "C-A", name: "Produto A", qty: 12 },
    ]);
    // Empate na quantidade: ordem alfabética, para a etiqueta sair sempre igual.
    expect(boxContent([line("Z", 4), line("A", 4)], "CX-000012").map((item) => item.code)).toEqual(["C-A", "C-Z"]);
  });

  it("monta a etiqueta com posição, medidas, total e o que não coube", () => {
    const lines = ["A", "B", "C", "D", "E", "F"].map((sku, index) => line(sku, 10 - index));
    const label = boxLabel(box, lines, { printedAt: new Date("2026-10-17T12:00:00Z"), maxLines: 4 });
    expect(label.kind).toBe("box");
    expect(label.code).toBe("CX-000012");
    expect(label.position).toBe("A-03");
    expect(label.dimensions).toBe("50 × 50 × 35 cm · 12,4 kg");
    expect(label.units).toBe(10 + 9 + 8 + 7 + 6 + 5);
    expect(label.lines).toHaveLength(4);
    expect(label.hiddenLines).toBe(2);
    expect(label.origin).toBe("Abertura");
    expect(label.printedAt).toBe("17/10/2026");
  });

  it("sem linhas conhecidas, usa o contador da caixa", () => {
    const label = boxLabel(box, []);
    expect(label.units).toBe(30);
    expect(label.lines).toEqual([]);
    expect(label.hiddenLines).toBe(0);
  });
});

describe("etiqueta da posição", () => {
  it("traz código, rua, zona e medidas", () => {
    const label = positionLabel({
      id: "A-01",
      code: "A-01",
      aisle: "A",
      shelf: 1,
      length_m: 1.8,
      depth_m: 0.75,
      height_m: 0.65,
      max_weight_kg: null,
      customer_code: "BTG Pactual",
    });
    expect(label).toEqual({
      kind: "position",
      code: "A-01",
      aisle: "A",
      shelf: 1,
      zone: "BTG Pactual",
      dimensions: "1,80 m × 0,75 m × 0,65 m",
      maxWeight: "sem limite",
    });
    expect(positionLabel({ id: "B-02", code: "B-02", aisle: "B", shelf: 2, length_m: 1, depth_m: 1, height_m: 1, customer_code: "  " }).zone).toBeNull();
  });
});

describe("folhas de dez", () => {
  it("centra o bloco de duas colunas por cinco linhas na folha A4", () => {
    expect(sheetMargins()).toEqual({ left: 3.4, top: 21.5 });
    expect(LABELS_PER_SHEET).toBe(10);
  });

  it("quebra em folhas e pula as vagas já usadas da primeira", () => {
    const labels = Array.from({ length: 12 }, (_, index) => `L${index + 1}`);
    const sheets = paginate(labels, 10, 3);
    expect(sheets).toHaveLength(2);
    expect(sheets[0]!.slice(0, 4)).toEqual([null, null, null, "L1"]);
    expect(sheets[0]).toHaveLength(10);
    expect(sheets[1]).toEqual(["L8", "L9", "L10", "L11", "L12"]);
    expect(paginate([], 10, 0)).toEqual([]);
    expect(paginate(["L1"], 10, 99)[0]!.filter(Boolean)).toEqual(["L1"]);
  });
});

describe("endereço da tela de etiquetas", () => {
  it("vai e volta sem perder nada", () => {
    const url = labelsUrl({ boxes: ["CX-000001", "CX-000002"], skip: 3, mode: "zebra" });
    expect(url).toBe("/estoque/etiquetas?caixas=CX-000001%2CCX-000002&pular=3&modo=zebra");
    expect(parseLabelsQuery(url.split("?")[1]!)).toEqual({
      boxes: ["CX-000001", "CX-000002"],
      positions: [],
      session: false,
      skip: 3,
      mode: "zebra",
    });
    expect(parseLabelsQuery("?sessao=atual&posicoes=a-01,A-01,,b-02&pular=abc")).toEqual({
      boxes: [],
      positions: ["A-01", "B-02"],
      session: true,
      skip: 0,
      mode: "a4",
    });
    expect(labelsUrl({})).toBe("/estoque/etiquetas");
  });
});
