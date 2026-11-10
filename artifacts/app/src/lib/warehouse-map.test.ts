import { describe, expect, it } from "vitest";

import { warehouseBoxFromRecord } from "./warehouse-boxes";
import {
  boxContents,
  boxFront,
  buildShelves,
  estadoDaCaixa,
  groupByAisle,
  referenceBoxesThatFit,
  saldoPorPrateleira,
  shelfMatches,
  skuIndexFromRows,
  summarizeZone,
  textoDaSaida,
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

describe("saldo da prateleira sem caixa registrada", () => {
  const balances = [
    { location_id: "b-02", sku_code: "BTG-000002", qty_on_hand: 41 },
    { location_id: "B-02", sku_code: "BTG-000001", qty_on_hand: 30 },
    { location_id: "B-02", sku_code: "BTG-000003", qty_on_hand: 0 },
    { location_id: "RECEBIMENTO", sku_code: "BTG-000001", qty_on_hand: 5 },
    { location_id: "", sku_code: "BTG-000009", qty_on_hand: 9 },
  ];

  it("soma o saldo positivo por prateleira, sem diferenciar maiúscula", () => {
    const saldos = saldoPorPrateleira(balances);
    expect(saldos.get("B-02")).toEqual({
      unidades: 71,
      itens: [
        { sku: "BTG-000001", qty: 30 },
        { sku: "BTG-000002", qty: 41 },
      ],
    });
    expect(saldos.has("")).toBe(false);
  });

  it("a guarda por linha aparece na prateleira sem caixa, e a busca acha pelo produto", () => {
    const [b02, b03] = buildShelves([shelf("B-02", 1), shelf("B-03", 2)], [], balances);
    expect(b02!.boxes).toEqual([]);
    expect(b02!.saldo.unidades).toBe(71);
    expect(b03!.saldo).toEqual({ unidades: 0, itens: [] });
    const index = skuIndexFromRows([{ id: "BTG-000002", produto: "POLO MASCULINO PIQUET PRETO - XG" }]);
    expect(shelfMatches(b02!, "polo", index)).toBe(true);
    expect(shelfMatches(b03!, "polo", index)).toBe(false);
  });
});

/** A caixa do recebimento traz o conteúdo nela (recebimento com caixas, parte 6). */
describe("conteúdo da caixa do recebimento", () => {
  it("vem das linhas da própria caixa, com o nome e o tamanho, somando o mesmo produto; as linhas da abertura não entram", () => {
    const receipt = box("CX-000225", "B-09", {
      sku_codes: ["BTG-000112", "BTG-000113"],
      origin: { kind: "receipt", receipt_number: "AVL-7C21A9F0", invoice_number: "48.377" },
      lines: [
        { sku_code: "BTG-000112", client_item_code: "A.01.0713.005.G", product_name: "Polo Masculino Piquet Preto", size: "G", counted_qty: 12 },
        { sku_code: "BTG-000113", client_item_code: "A.01.0713.005.GG", product_name: "Polo Masculino Piquet Preto", size: "GG", counted_qty: 7 },
        { sku_code: "BTG-000112", client_item_code: "A.01.0713.005.G", product_name: "Polo Masculino Piquet Preto", size: "G", counted_qty: 1 },
      ],
    });
    const index = skuIndexFromRows([{ id: "BTG-000112", produto: "Outro nome", cod_cliente: "X" }]);
    expect(boxContents(receipt, [{ box_code: "CX-000225", sku_code: "SKU-9", product_name: "Da abertura", counted_qty: 99 }], index)).toEqual([
      { code: "A.01.0713.005.G", name: "Polo Masculino Piquet Preto · G", qty: 13 },
      { code: "A.01.0713.005.GG", name: "Polo Masculino Piquet Preto · GG", qty: 7 },
    ]);
  });
});

/** A prateleira depois do pedido (separação com caixas, parte 3). */
describe("a caixa na separação", () => {
  const aberta = { taken_lines: [{ sku_code: "SKU-1", qty: 5 }], taken_units: 5, balance_at: "2026-11-12T17:40:00.000Z" };

  it("as unidades da prateleira são o saldo das caixas, e a caixa vazia não ocupa a prateleira", () => {
    // Antes da parte 3, a caixa de onde saíram as 12 peças continuava guardada: contava como posição ocupada.
    const result = buildShelves([shelf("A-05", 5), shelf("A-06", 6)], [
      box("CX-000028", "A-05", aberta),
      box("CX-000030", "A-05"),
      box("CX-000027", "A-06", { status: "emptied", taken_units: 12, emptied_at: "2026-11-12T13:00:00.000Z", emptied_order_number: "PED-0001" }),
    ]);
    const [a05, a06] = result;
    expect(a05!.unit_count).toBe(19);
    expect(a05!.boxes.map((item) => item.code)).toEqual(["CX-000028", "CX-000030"]);
    expect(a05!.saidas).toEqual([]);
    // A A-06 só tinha a caixa que esvaziou: fica sem caixa, sem frente usada, e guarda o registro.
    expect([a06!.boxes.length, a06!.front_used_m, a06!.state, a06!.unit_count]).toEqual([0, 0, "free", 0]);
    expect(a06!.saidas.map((item) => item.code)).toEqual(["CX-000027"]);
    expect(summarizeZone(result, "all").occupied).toBe(1);
  });

  it("Saíram desta prateleira: a mais recente primeiro, e só as dez últimas", () => {
    const saidas = Array.from({ length: 12 }, (_, index) =>
      box(`CX-0000${String(index + 10)}`, "A-05", { status: "emptied", emptied_at: `2026-11-${String(index + 1).padStart(2, "0")}T12:00:00.000Z` }),
    );
    const [a05] = buildShelves([shelf("A-05", 5)], saidas);
    expect(a05!.saidas).toHaveLength(10);
    expect(a05!.saidas[0]!.code).toBe("CX-000021");
    expect(a05!.saidas.at(-1)!.code).toBe("CX-000012");
  });

  it("a caixa diz aberta quando já saiu peça dela, e a saída diz como e em qual pedido", () => {
    expect(estadoDaCaixa(box("CX-000028", "A-05", aberta))).toBe("aberta");
    expect(estadoDaCaixa(box("CX-000030", "A-05"))).toBe("guardada");
    expect(textoDaSaida({ emptied_at: "2026-11-11T16:00:00.000Z", emptied_whole: true, emptied_order_number: "PED-0001" })).toBe("inteira em 11/11/2026 · PED-0001");
    expect(textoDaSaida({ emptied_at: "2026-11-12T13:00:00.000Z", emptied_whole: false, emptied_order_number: "PED-0001" })).toBe("vazia em 12/11/2026 · PED-0001");
    expect(textoDaSaida({ emptied_at: null, emptied_whole: false, emptied_order_number: null })).toBe("vazia");
  });

  it("o conteúdo da caixa aberta é o saldo: a entrada menos o que saiu, sem o produto que zerou", () => {
    const entrada = [
      { box_code: "CX-000028", sku_code: "SKU-1", client_item_code: "A.01", product_name: "Calça 42", counted_qty: 7 },
      { box_code: "CX-000028", sku_code: "SKU-2", client_item_code: "A.02", product_name: "Calça 44", counted_qty: 9 },
    ];
    const caixa = box("CX-000028", "A-05", { sku_codes: ["SKU-1", "SKU-2"], taken_lines: [{ sku_code: "SKU-1", qty: 5 }, { sku_code: "SKU-2", qty: 9 }], taken_units: 14 });
    expect(boxContents(caixa, entrada, new Map())).toEqual([{ code: "A.01", name: "Calça 42", qty: 2 }]);
    // Sem as linhas de entrada, ficam os SKUs que a caixa conhece, sem quantidade.
    expect(boxContents(caixa, [], new Map()).map((line) => line.qty)).toEqual([null, null]);
  });
});
