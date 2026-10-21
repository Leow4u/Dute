import { describe, expect, it } from "vitest";

import { warehouseBoxFromRecord } from "./warehouse-boxes";
import {
  boxContents,
  boxFront,
  buildShelves,
  groupByAisle,
  referenceBoxesThatFit,
  shelfMatches,
  skuIndexFromRows,
  summarizeZone,
  zonesOf,
} from "./warehouse-map";
import type { WarehousePosition } from "./warehouse-positions";

const BTG = "BTG Pactual";
const shelf = (code: string, sequence: number, overrides: Partial<WarehousePosition> = {}): WarehousePosition => ({
  id: code,
  code,
  aisle: code.split("-")[0]!,
  shelf: Number(code.split("-")[1]),
  length_m: 1.8,
  depth_m: 0.75,
  height_m: 0.65,
  max_weight_kg: null,
  sequence,
  customer_code: BTG,
  status: "active",
  ...overrides,
});
const box = (code: string, location: string, overrides: Record<string, unknown> = {}) =>
  warehouseBoxFromRecord({
    code,
    customer_code: BTG,
    status: "stored",
    location_id: location,
    length_m: 0.5,
    width_m: 0.5,
    height_m: 0.35,
    front_m: 0.5,
    gross_weight_kg: 10,
    unit_count: 12,
    sku_codes: ["SKU-1"],
    ...overrides,
  });

describe("prateleira com caixas", () => {
  it("caixa empilhada não ocupa outra frente, mas conta no peso, nas unidades e no total", () => {
    const result = buildShelves([shelf("A-02", 2)], [
      box("CX-000001", "A-02", { height_m: 0.3 }),
      box("CX-000002", "A-02", { height_m: 0.3, support_box_code: "CX-000001", base_height_m: 0.3 }),
    ])[0]!;
    expect(result.front_used_m).toBe(0.5);
    expect(result.free_front_m).toBe(1.3);
    expect(result.weight_used_kg).toBe(20);
    expect(result.unit_count).toBe(24);
    expect(result.boxes).toHaveLength(2);
    expect(result.remaining_reference_boxes).toBe(2);
  });

  it("soma a frente usada e diz quantas caixas de referência ainda cabem", () => {
    const shelves = buildShelves([shelf("A-01", 1)], [box("CX-000001", "a-01"), box("CX-000002", "A-01")]);
    expect(shelves).toHaveLength(1);
    const first = shelves[0]!;
    expect(first.boxes.map((item) => item.code)).toEqual(["CX-000001", "CX-000002"]);
    expect(first.front_used_m).toBe(1);
    expect(first.free_front_m).toBe(0.8);
    expect(first.remaining_reference_boxes).toBe(1);
    expect(first.weight_used_kg).toBe(20);
    expect(first.unit_count).toBe(24);
    expect(first.sku_codes).toEqual(["SKU-1"]);
    expect(first.state).toBe("partial");
    expect(first.fill).toBeCloseTo(1 / 1.8, 5);
  });

  it("cheia quando não cabe mais uma caixa de referência, também por peso", () => {
    const full = buildShelves([shelf("A-01", 1)], [box("CX-1", "A-01"), box("CX-2", "A-01"), box("CX-3", "A-01")])[0]!;
    expect(full.state).toBe("full");
    expect(full.remaining_reference_boxes).toBe(0);
    const heavy = buildShelves([shelf("A-02", 2, { max_weight_kg: 20 })], [box("CX-4", "A-02"), box("CX-5", "A-02")])[0]!;
    expect(heavy.state).toBe("full");
    expect(heavy.free_front_m).toBe(0.8);
  });

  it("livre, bloqueada e em verificação vêm da situação, não das caixas", () => {
    const shelves = buildShelves(
      [shelf("A-03", 3, { status: "blocked" }), shelf("A-02", 2, { status: "review" }), shelf("A-01", 1)],
      [box("CX-1", "A-02")],
    );
    expect(shelves.map((item) => [item.code, item.state])).toEqual([
      ["A-01", "free"],
      ["A-02", "review"],
      ["A-03", "blocked"],
    ]);
  });

  it("caixa fora da prateleira cadastrada não conta, caixa removida também não", () => {
    const shelves = buildShelves([shelf("A-01", 1)], [box("CX-1", "Z-99"), box("CX-2", "A-01", { status: "removed" })]);
    expect(shelves[0]!.boxes).toEqual([]);
    expect(shelves[0]!.state).toBe("free");
  });

  it("frente da caixa: a gravada, ou o menor lado", () => {
    expect(boxFront({ front_m: 0.4, length_m: 0.6, width_m: 0.4 })).toBe(0.4);
    expect(boxFront({ front_m: null, length_m: 0.6, width_m: 0.4 })).toBe(0.4);
    expect(referenceBoxesThatFit({ depth_m: 0.75, height_m: 0.65 }, 1.8)).toBe(3);
    expect(referenceBoxesThatFit({ depth_m: 0.75, height_m: 0.3 }, 1.8)).toBe(0);
    expect(referenceBoxesThatFit({ depth_m: 0.4, height_m: 0.65 }, 1.8)).toBe(0);
  });
});

describe("volume registrado no mapa", () => {
  it("conta o volume de cada caixa empilhada sem duplicar a frente ocupada", () => {
    const result = buildShelves(
      [shelf("A-03", 3, { length_m: 1.2, depth_m: 0.7, height_m: 1 })],
      [
        box("CX-1", "A-03", { length_m: 0.6, width_m: 0.35, height_m: 0.2, front_m: 0.2 }),
        box("CX-2", "A-03", { length_m: 0.6, width_m: 0.35, height_m: 0.2, front_m: 0.2, support_box_code: "CX-1", base_height_m: 0.35 }),
      ],
    )[0]!;
    expect(result.front_used_m).toBe(0.2);
    expect(result.volume.totalM3).toBeCloseTo(0.84);
    expect(result.volume.occupiedM3).toBeCloseTo(0.084);
    expect(result.volume.freeM3).toBeCloseTo(0.756);
    expect(result.volume.occupiedPercent).toBeCloseTo(10);
    expect(result.volume.boxCount).toBe(2);
  });

  it("usa somente caixas guardadas na prateleira, sem rascunhos ou caixas removidas", () => {
    const result = buildShelves([shelf("A-01", 1)], [
      box("CX-1", "A-01"),
      box("CX-2", "A-01", { status: "counting" }),
      box("CX-3", "A-01", { status: "removed" }),
      box("CX-4", "A-02"),
    ])[0]!;
    expect(result.volume.boxCount).toBe(1);
    expect(result.volume.occupiedM3).toBeCloseTo(0.0875);
  });

  it("guarda em andamento impede estimar espaço livre sem entrar no total de caixas guardadas", () => {
    const shelves = buildShelves([shelf("A-01", 1)], [
      box("CX-1", "A-01"),
      box("CX-2", "A-01", { status: "committing" }),
    ]);
    const result = shelves[0]!;
    expect(result.boxes.map((item) => item.code)).toEqual(["CX-1"]);
    expect(result.volumeBoxes.map((item) => item.code)).toEqual(["CX-1", "CX-2"]);
    expect(result.front_used_m).toBe(0.5);
    expect(result.volume.boxCount).toBe(1);
    expect(result.volume.pendingCount).toBe(1);
    expect(result.volume.occupiedM3).toBeCloseTo(0.0875);
    expect(result.volume.freeM3).toBeNull();
    expect(result.volume.projectedFreeM3).toBeNull();
    expect(summarizeZone(shelves, BTG)).toMatchObject({ boxes: 1, occupied: 1 });
  });

  it("não apresenta volume parcial como total quando faltam medidas de uma caixa", () => {
    const shelves = buildShelves([shelf("A-01", 1)], [
      box("CX-1", "A-01"),
      box("CX-2", "A-01", { height_m: 0 }),
    ]);
    expect(shelves[0]!.volume.occupiedM3).toBeNull();
    expect(shelves[0]!.volume.freeM3).toBeNull();
    expect(summarizeZone(shelves, BTG).occupied_volume_m3).toBeNull();
  });

  it("restringe o volume agregado à zona selecionada", () => {
    const shelves = buildShelves(
      [shelf("A-01", 1), shelf("B-01", 2, { customer_code: "Outro cliente" })],
      [box("CX-1", "A-01"), box("CX-2", "B-01", { customer_code: "Outro cliente", length_m: 1 })],
    );
    expect(summarizeZone(shelves, BTG).occupied_volume_m3).toBeCloseTo(0.0875);
    expect(summarizeZone(shelves, "Outro cliente").occupied_volume_m3).toBeCloseTo(0.175);
    expect(summarizeZone(shelves, "all").occupied_volume_m3).toBeCloseTo(0.2625);
  });
});

describe("zona", () => {
  const positions = [
    shelf("A-01", 1),
    shelf("A-02", 2),
    shelf("A-03", 3, { status: "blocked" }),
    shelf("B-01", 4, { customer_code: null }),
  ];
  const boxes = [box("CX-1", "A-01"), box("CX-2", "A-01", { sku_codes: ["SKU-2"] }), box("CX-3", "A-02", { gross_weight_kg: null })];
  const shelves = buildShelves(positions, boxes);

  it("resume posições ocupadas, vazias, indisponíveis, caixas e o que ainda cabe", () => {
    expect(summarizeZone(shelves, BTG)).toEqual({
      zone: BTG,
      positions: 3,
      occupied: 2,
      empty: 0,
      unavailable: 1,
      boxes: 3,
      occupied_volume_m3: expect.closeTo(0.2625, 8),
      units: 36,
      products: 2,
      remaining_reference_boxes: 1 + 2,
      fill: 1.5 / 3.6,
    });
    expect(summarizeZone(shelves, "all").positions).toBe(4);
    expect(summarizeZone(shelves, "all").empty).toBe(1);
    expect(summarizeZone(shelves, null)).toMatchObject({ positions: 1, occupied: 0, empty: 1, remaining_reference_boxes: 3 });
  });

  it("lista as zonas com a sem cliente por último e agrupa por rua na ordem de caminhada", () => {
    expect(zonesOf(shelves)).toEqual([BTG, null]);
    expect(groupByAisle(shelves).map((group) => [group.aisle, group.shelves.map((item) => item.code)])).toEqual([
      ["A", ["A-01", "A-02", "A-03"]],
      ["B", ["B-01"]],
    ]);
  });
});

describe("busca e conteúdo", () => {
  const index = skuIndexFromRows([
    { cod_btg: "SKU-1", cod_cliente: "A.01.0802.007.G", produto: "Camisa social branca" },
    { sku_code: "sku-2", client_item_code: "B.02", product_name: "Calça preta" },
    { produto: "sem código" },
  ]);
  const shelves = buildShelves([shelf("A-01", 1), shelf("A-02", 2)], [box("CX-000007", "A-01"), box("CX-000008", "A-02", { sku_codes: ["SKU-2"] })]);

  it("acha por prateleira, caixa, SKU, código do cliente e nome, sem acento", () => {
    expect(index.size).toBe(2);
    expect(shelfMatches(shelves[0]!, "", index)).toBe(true);
    expect(shelfMatches(shelves[0]!, "a-01", index)).toBe(true);
    expect(shelfMatches(shelves[0]!, "000007", index)).toBe(true);
    expect(shelfMatches(shelves[0]!, "0802", index)).toBe(true);
    expect(shelfMatches(shelves[0]!, "camisa", index)).toBe(true);
    expect(shelfMatches(shelves[1]!, "calça", index)).toBe(true);
    expect(shelfMatches(shelves[1]!, "calca", index)).toBe(true);
    expect(shelfMatches(shelves[0]!, "calça", index)).toBe(false);
  });

  it("conteúdo da caixa: linhas da abertura com quantidade; sem elas, os SKUs com nome do catálogo", () => {
    const withLines = boxContents(
      box("CX-000007", "A-01", { sku_codes: ["SKU-1", "SKU-2"] }),
      [
        { box_code: "cx-000007", sku_code: "SKU-1", client_item_code: "A.01.0802.007.G", product_name: "Camisa social branca", counted_qty: 5 },
        { box_code: "CX-000007", sku_code: "SKU-1", counted_qty: 7 },
        { box_code: "CX-000009", sku_code: "SKU-3", counted_qty: 1 },
      ],
      index,
    );
    expect(withLines).toEqual([
      { code: "A.01.0802.007.G", name: "Camisa social branca", qty: 12 },
      { code: "B.02", name: "Calça preta", qty: null },
    ]);
    expect(boxContents(box("CX-000010", "A-01", { sku_codes: ["SKU-9"] }), [], index)).toEqual([{ code: "SKU-9", name: "SKU-9", qty: null }]);
  });
});
