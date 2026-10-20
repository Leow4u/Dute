import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BOX_ORIENTATIONS,
  CreateWarehouseBoxSchema,
  SuggestWarehousePositionSchema,
  buildOccupancy,
  emptyOccupancy,
  formatBoxCode,
  placementFor,
  suggestPosition,
  type SlottingPosition,
} from "./warehouse-boxes.js";

const BTG = "BTG Pactual";
const shelf = (code: string, sequence: number, overrides: Partial<SlottingPosition> = {}): SlottingPosition => ({
  code,
  length_m: 1.8,
  depth_m: 0.75,
  height_m: 0.65,
  max_weight_kg: null,
  sequence,
  customer_code: BTG,
  status: "active",
  ...overrides,
});
const box = { customer_code: BTG, length_m: 0.5, width_m: 0.5, height_m: 0.35, gross_weight_kg: 12 };

describe("como a caixa entra na prateleira", () => {
  it("cabe pela frente livre, profundidade, altura e peso", () => {
    assert.deepEqual(placementFor(shelf("A-01", 1), box), { front_m: 0.5, depth_m: 0.5, height_m: 0.35, orientation: "length_width_height" });
    assert.equal(placementFor(shelf("A-01", 1), { ...box, height_m: 0.7 }), null);
    assert.equal(placementFor(shelf("A-01", 1), { ...box, length_m: 0.9, width_m: 0.9 }), null);
    assert.equal(placementFor(shelf("A-01", 1, { max_weight_kg: 20 }), box, { ...emptyOccupancy(), weight_used_kg: 10 }), null);
    assert.equal(placementFor(shelf("A-01", 1), box, { ...emptyOccupancy(), front_used_m: 1.5 }), null);
  });

  it("vira a caixa para gastar menos frente quando a profundidade permite", () => {
    assert.deepEqual(placementFor(shelf("A-01", 1), { ...box, length_m: 0.6, width_m: 0.4 }), { front_m: 0.4, depth_m: 0.6, height_m: 0.35, orientation: "width_length_height" });
    // 0,80 m não entra na profundidade de 0,75: só cabe com os 0,80 na frente.
    assert.deepEqual(placementFor(shelf("A-01", 1), { ...box, length_m: 0.8, width_m: 0.4 }), { front_m: 0.8, depth_m: 0.4, height_m: 0.35, orientation: "length_width_height" });
  });

  it("só considera apoiar em outro lado quando a pessoa permite", () => {
    const dimensions = { ...box, length_m: 0.6, width_m: 0.4, height_m: 0.35 };
    const occupancy = { ...emptyOccupancy(), front_used_m: 1.42 };
    assert.equal(placementFor(shelf("A-01", 1), dimensions, occupancy), null);
    assert.equal(placementFor(shelf("A-01", 1), dimensions, occupancy, { allow_tilt: false }), null);
    assert.deepEqual(placementFor(shelf("A-01", 1), dimensions, occupancy, { allow_tilt: true }), {
      front_m: 0.35, depth_m: 0.6, height_m: 0.4, orientation: "height_length_width",
    });
  });

  it("respeita a orientação escolhida, mesmo quando outra gastaria menos frente", () => {
    const dimensions = { ...box, length_m: 0.6, width_m: 0.4, height_m: 0.35 };
    assert.deepEqual(placementFor(shelf("A-01", 1), dimensions, emptyOccupancy(), {
      orientation: "length_width_height",
    }), { front_m: 0.6, depth_m: 0.4, height_m: 0.35, orientation: "length_width_height" });
    // Não substitui silenciosamente uma orientação que não cabe por outra que cabe.
    assert.equal(placementFor(shelf("A-01", 1), dimensions, { ...emptyOccupancy(), front_used_m: 1.3 }, {
      orientation: "length_width_height",
    }), null);
  });

  it("valida as seis orientações com altura efetiva e opt-in para tombar", () => {
    const dimensions = { ...box, length_m: 0.6, width_m: 0.4, height_m: 0.35 };
    const axis = { length: 0.6, width: 0.4, height: 0.35 };
    for (const orientation of BOX_ORIENTATIONS) {
      const [front, depth, height] = orientation.split("_") as Array<keyof typeof axis>;
      const actual = placementFor(shelf("A-01", 1), dimensions, emptyOccupancy(), { allow_tilt: true, orientation });
      assert.deepEqual(actual, { front_m: axis[front!], depth_m: axis[depth!], height_m: axis[height!], orientation });
      if (!orientation.endsWith("_height")) {
        assert.equal(placementFor(shelf("A-01", 1), dimensions, emptyOccupancy(), { orientation }), null);
      }
    }
    assert.equal(placementFor(shelf("A-01", 1, { height_m: 0.55 }), dimensions, emptyOccupancy(), {
      allow_tilt: true, orientation: "height_width_length",
    }), null);
    assert.equal(placementFor(shelf("A-01", 1, { max_weight_kg: 10 }), dimensions, emptyOccupancy(), {
      allow_tilt: true, orientation: "height_width_length",
    }), null);
  });

  it("sugestão considera a mesma orientação que a guarda validará", () => {
    const dimensions = { ...box, length_m: 0.6, width_m: 0.4, height_m: 0.35 };
    const occupancy = new Map([["A-01", { ...emptyOccupancy(), front_used_m: 1.42 }]]);
    assert.equal(suggestPosition(dimensions, [shelf("A-01", 1)], occupancy).position, null);
    const chosen = suggestPosition({ ...dimensions, allow_tilt: true }, [shelf("A-01", 1)], occupancy).position!;
    assert.deepEqual(chosen.placement, placementFor(shelf("A-01", 1), dimensions, occupancy.get("A-01"), {
      allow_tilt: true, orientation: chosen.placement.orientation,
    }));
  });

  it("não perde uma caixa por arredondamento: três de 0,60 numa frente de 1,80", () => {
    const occupancy = { ...emptyOccupancy(), front_used_m: 1.2 };
    assert.deepEqual(placementFor(shelf("A-01", 1), { ...box, length_m: 0.6, width_m: 0.6 }, occupancy), { front_m: 0.6, depth_m: 0.6, height_m: 0.35, orientation: "length_width_height" });
  });
});

describe("escolha da prateleira (endereçamento dirigido)", () => {
  const zone = [shelf("A-01", 1), shelf("A-02", 2), shelf("A-03", 3), shelf("A-04", 4), shelf("B-01", 5, { customer_code: null })];
  const stored = (location: string, front: number) => ({ location_id: location, front_m: front, gross_weight_kg: 10 });
  const balance = (location: string, sku: string) => ({ location_id: location, sku_code: sku, qty_on_hand: 5 });

  it("regra 1: junta com o mesmo SKU quando ainda cabe", () => {
    const occupancy = buildOccupancy([stored("A-03", 0.5)], [balance("A-03", "CAMISA-1")]);
    const result = suggestPosition({ ...box, sku_codes: ["CAMISA-1"] }, zone, occupancy);
    assert.equal(result.position?.code, "A-03");
    assert.equal(result.position?.tier, 1);
    assert.match(result.position!.reason, /Já tem CAMISA-1/);
    // Se A-03 não servir, as alternativas são as vizinhas dela, não o começo da rua.
    assert.deepEqual(result.alternatives.map((item) => item.code), ["A-02", "A-04"]);
    assert.match(result.alternatives[0]!.reason, /A mais próxima de A-03/);
    assert.equal(result.rejected, null);
  });

  it("regra 2: com a prateleira do SKU cheia, vai para a mais próxima na caminhada", () => {
    const occupancy = buildOccupancy(
      [stored("A-03", 0.6), stored("A-03", 0.6), stored("A-03", 0.6)],
      [balance("A-03", "CAMISA-1")],
    );
    const result = suggestPosition({ ...box, sku_codes: ["CAMISA-1"] }, zone, occupancy);
    assert.equal(result.position?.code, "A-02");
    assert.equal(result.position?.tier, 2);
    assert.match(result.position!.reason, /A-03/);
    assert.deepEqual(result.alternatives.map((item) => item.code), ["A-04", "A-01"]);
  });

  it("regra 3: produto novo vai para a primeira prateleira da zona com espaço", () => {
    const occupancy = buildOccupancy([stored("A-01", 0.5), stored("A-01", 0.5)], [balance("A-01", "OUTRO")]);
    const result = suggestPosition({ ...box, sku_codes: ["CAMISA-9"] }, zone, occupancy);
    assert.equal(result.position?.code, "A-01");
    assert.equal(result.position?.tier, 3);
    assert.deepEqual(result.alternatives.map((item) => item.code), ["A-02", "A-03"]);
  });

  it("só prateleiras da zona do cliente e ativas; em verificação e bloqueadas ficam de fora", () => {
    const positions = [shelf("A-01", 1, { status: "review" }), shelf("A-02", 2, { status: "blocked" }), shelf("A-03", 3), shelf("B-01", 4, { customer_code: "Outro" })];
    const result = suggestPosition({ ...box, sku_codes: [] }, positions, new Map());
    assert.equal(result.position?.code, "A-03");
    assert.equal(result.checked, 1);
    const excluded = suggestPosition({ ...box, sku_codes: [] }, positions, new Map(), { exclude: ["a-03"] });
    assert.equal(excluded.position, null);
    assert.match(String(excluded.rejected), /não tem prateleira ativa/);
  });

  it("sem zona, ou zona cheia, explica o motivo em vez de inventar posição", () => {
    const noZone = suggestPosition({ ...box, customer_code: "Cliente X", sku_codes: [] }, zone, new Map());
    assert.equal(noZone.position, null);
    assert.match(String(noZone.rejected), /zona de Cliente X/);
    const full = buildOccupancy(
      ["A-01", "A-02", "A-03", "A-04"].flatMap((code) => [stored(code, 0.9), stored(code, 0.9)]),
      [],
    );
    const result = suggestPosition({ ...box, sku_codes: [] }, zone, full);
    assert.equal(result.position, null);
    assert.match(String(result.rejected), /50 × 50 × 35 cm, 12 kg/);
    assert.equal(result.checked, 4);
  });

  it("é determinístico: a mesma entrada dá a mesma resposta", () => {
    const occupancy = buildOccupancy([stored("A-02", 0.5)], [balance("A-02", "CAMISA-1")]);
    const first = suggestPosition({ ...box, sku_codes: ["CAMISA-1"] }, zone, occupancy);
    const second = suggestPosition({ ...box, sku_codes: ["CAMISA-1"] }, [...zone].reverse(), occupancy);
    assert.deepEqual(first, second);
  });
});

describe("código e schema da caixa", () => {
  it("numera as caixas com seis dígitos", () => {
    assert.equal(formatBoxCode(1), "CX-000001");
    assert.equal(formatBoxCode(123), "CX-000123");
  });

  it("aceita medidas como texto e peso vazio", () => {
    const parsed = CreateWarehouseBoxSchema.parse({
      length_m: "0.5",
      width_m: 0.5,
      height_m: "0.35",
      gross_weight_kg: "",
      location_id: "a-03",
      idempotency_key: "k1",
    });
    assert.equal(parsed.length_m, 0.5);
    assert.equal(parsed.gross_weight_kg, null);
    assert.throws(() => CreateWarehouseBoxSchema.parse({ length_m: 0, width_m: 0.5, height_m: 0.3, location_id: "A-01", idempotency_key: "k" }));
  });
  it("suggest e create aceitam o mesmo contrato de orientação, sem habilitar tombamento por padrão", () => {
    const input = {
      customer_code: BTG, length_m: 0.6, width_m: 0.4, height_m: 0.35,
      location_id: "A-01", idempotency_key: "orientation",
    };
    assert.equal(CreateWarehouseBoxSchema.parse(input).allow_tilt, undefined);
    assert.equal(SuggestWarehousePositionSchema.parse(input).allow_tilt, undefined);
    for (const orientation of BOX_ORIENTATIONS) {
      for (const schema of [CreateWarehouseBoxSchema, SuggestWarehousePositionSchema]) {
        const parsed = schema.parse({ ...input, allow_tilt: true, orientation });
        assert.equal(parsed.allow_tilt, true);
        assert.equal(parsed.orientation, orientation);
        assert.throws(() => schema.parse({ ...input, orientation: "qualquer" }));
        assert.throws(() => schema.parse({ ...input, allow_tilt: "true" }));
      }
    }
  });

});
