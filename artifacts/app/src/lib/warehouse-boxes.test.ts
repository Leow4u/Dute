import { describe, expect, it } from "vitest";

import {
  boxDraftToPayload,
  emptyBoxDraft,
  formatBoxDimensions,
  occupiedPositions,
  parseCentimeters,
  parseKilos,
  resolveContentSkus,
  sessionBoxes,
  sortBoxes,
  tierLabel,
  warehouseBoxFromRecord,
} from "./warehouse-boxes";

describe("medidas da caixa digitadas em centímetros", () => {
  it("vira metros, aceitando vírgula", () => {
    expect(parseCentimeters("50")).toBe(0.5);
    expect(parseCentimeters("50,5")).toBe(0.505);
    expect(parseCentimeters(35)).toBe(0.35);
  });

  it("vazio, zero, negativo e lixo não são medida", () => {
    expect(parseCentimeters("")).toBeNull();
    expect(parseCentimeters("0")).toBeNull();
    expect(parseCentimeters("-10")).toBeNull();
    expect(parseCentimeters("abc")).toBeNull();
    expect(parseCentimeters("99999")).toBeNull();
  });

  it("peso é opcional: vazio vira null, '12,4' vira 12.4", () => {
    expect(parseKilos("")).toBeNull();
    expect(parseKilos("0")).toBeNull();
    expect(parseKilos("12,4")).toBe(12.4);
  });

  it("monta o que a callable espera, ou null quando falta lado", () => {
    expect(boxDraftToPayload({ ...emptyBoxDraft(), length_cm: "50", width_cm: "50", height_cm: "35" })).toEqual({
      length_m: 0.5,
      width_m: 0.5,
      height_m: 0.35,
      gross_weight_kg: null,
    });
    expect(boxDraftToPayload({ ...emptyBoxDraft(), length_cm: "60", width_cm: "40", height_cm: "30", weight_kg: "8,5" })?.gross_weight_kg).toBe(8.5);
    expect(boxDraftToPayload({ ...emptyBoxDraft(), length_cm: "50", width_cm: "", height_cm: "35" })).toBeNull();
  });

  it("formata em centímetros, com peso quando houver", () => {
    expect(formatBoxDimensions({ length_m: 0.5, width_m: 0.5, height_m: 0.35 })).toBe("50 × 50 × 35 cm");
    expect(formatBoxDimensions({ length_m: 0.6, width_m: 0.4, height_m: 0.3, gross_weight_kg: 12.4 })).toBe("60 × 40 × 30 cm · 12,4 kg");
  });
});

describe("caixas guardadas", () => {
  const record = (code: string, location: string, extra: Record<string, unknown> = {}) => ({
    code,
    customer_code: "BTG Pactual",
    status: "stored",
    location_id: location,
    length_m: 0.5,
    width_m: 0.5,
    height_m: 0.35,
    line_count: 1,
    unit_count: 12,
    origin: { kind: "opening_inventory", session_id: "sessao-1" },
    ...extra,
  });

  it("lê o documento com valores padrão seguros", () => {
    const box = warehouseBoxFromRecord({ id: "cx-000007", location_id: "a-01" });
    expect(box.code).toBe("CX-000007");
    expect(box.location_id).toBe("A-01");
    expect(box.status).toBe("stored");
    expect(box.line_count).toBe(0);
    expect(box.gross_weight_kg).toBeNull();
    expect(box.session_id).toBeNull();
    expect(box.suggestion).toBeNull();
    const full = warehouseBoxFromRecord(
      record("CX-000001", "A-01", {
        gross_weight_kg: "12.4",
        sku_codes: ["SKU-1"],
        suggestion: { position: "A-01", reason: "Primeira livre", alternatives: ["A-02"], followed: true },
        refusal: { position: "A-03", reason: "Ocupada" },
      }),
    );
    expect(full.gross_weight_kg).toBe(12.4);
    expect(full.sku_codes).toEqual(["SKU-1"]);
    expect(full.session_id).toBe("sessao-1");
    expect(full.suggestion).toEqual({ position: "A-01", reason: "Primeira livre", alternatives: ["A-02"], followed: true });
    expect(full.refusal).toEqual({ position: "A-03", reason: "Ocupada" });
  });

  it("ordena pela mais recente e separa as da sessão", () => {
    const boxes = [record("CX-000001", "A-01"), record("CX-000003", "A-02", { origin: { session_id: "outra" } }), record("CX-000002", "A-01")].map(
      warehouseBoxFromRecord,
    );
    expect(sortBoxes(boxes).map((box) => box.code)).toEqual(["CX-000003", "CX-000002", "CX-000001"]);
    expect(sessionBoxes(boxes, "sessao-1").map((box) => box.code)).toEqual(["CX-000001", "CX-000002"]);
    expect(sessionBoxes(boxes, undefined)).toEqual([]);
  });

  it("conta posições ocupadas por prateleira, não por caixa", () => {
    const boxes = [record("CX-000001", "A-01"), record("CX-000002", "a-01"), record("CX-000003", "A-02"), record("CX-000004", "A-03", { status: "removed" })].map(
      warehouseBoxFromRecord,
    );
    expect(occupiedPositions(boxes)).toBe(2);
  });

  it("nomeia a regra da sugestão", () => {
    expect(tierLabel(1)).toBe("mesmo produto");
    expect(tierLabel(2)).toBe("perto do produto");
    expect(tierLabel(3)).toBe("primeira livre");
    expect(tierLabel(undefined)).toBe("sugerida");
  });
});

describe("conteúdo da caixa para a regra do mesmo produto", () => {
  const products = [
    { clientCode: "A.01.0802.007.G", skuCode: "SKU-CAMISA-G" },
    { clientCode: "", skuCode: "SKU-SEM-CODIGO" },
  ];

  it("troca cód. cliente pelo SKU, mantém o resto e não repete", () => {
    expect(resolveContentSkus("a.01.0802.007.g, sku-camisa-g\nNOVO-1 novo-1", products)).toEqual(["SKU-CAMISA-G", "NOVO-1"]);
    expect(resolveContentSkus("sku-sem-codigo", products)).toEqual(["SKU-SEM-CODIGO"]);
    expect(resolveContentSkus("   ", products)).toEqual([]);
  });
});
