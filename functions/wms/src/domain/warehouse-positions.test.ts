import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CreateWarehouseAisleSchema,
  DEFAULT_WAREHOUSE_LAYOUT,
  SaveWarehousePositionsSchema,
  normalizePosition,
  positionCode,
  putawayAdvanceStatus,
  resolveGuardDestination,
} from "./warehouse-positions.js";

describe("destino da guarda", () => {
  const positions = [
    { code: "A-01", status: "active" },
    { code: "A-02", status: "blocked" },
    { code: "B-01", status: "review" },
  ];

  it("aceita o código da prateleira ativa, mesmo bipado em minúsculas", () => {
    assert.deepEqual(resolveGuardDestination("a-01", positions), { code: "A-01" });
  });

  it("com posição, a guarda planejada conclui de uma vez", () => {
    assert.equal(putawayAdvanceStatus("planned", "A-01"), "completed");
    assert.equal(putawayAdvanceStatus("planned", "  "), "in_progress");
    assert.equal(putawayAdvanceStatus("in_progress", "A-01"), "completed");
  });

  it("recusa vazio, desconhecido, bloqueado e em verificação", () => {
    assert.deepEqual(resolveGuardDestination("  ", positions), { problem: "Escolha uma posição cadastrada." });
    assert.deepEqual(resolveGuardDestination("Z-99", positions), { problem: "Escolha uma posição cadastrada." });
    assert.deepEqual(resolveGuardDestination("A-02", positions), { problem: "Esta posição está bloqueada." });
    assert.deepEqual(resolveGuardDestination("B-01", positions), { problem: "Esta posição está em verificação." });
  });
});

describe("mapa inicial do galpão (planilha de 16/10/2026)", () => {
  const codes = DEFAULT_WAREHOUSE_LAYOUT.map((position) => positionCode(position.aisle, position.shelf));

  it("tem as 43 prateleiras das ruas A, B e C, sem código repetido", () => {
    assert.equal(DEFAULT_WAREHOUSE_LAYOUT.length, 43);
    assert.equal(new Set(codes).size, 43);
    const byAisle = (aisle: string) => DEFAULT_WAREHOUSE_LAYOUT.filter((position) => position.aisle === aisle).length;
    assert.deepEqual([byAisle("A"), byAisle("B"), byAisle("C")], [15, 16, 12]);
  });

  it("rua A não tem a prateleira 8, como na planilha", () => {
    assert.ok(!codes.includes("A-08"));
    assert.ok(codes.includes("A-07"));
    assert.ok(codes.includes("A-09"));
  });

  it("segue as medidas da planilha: frente, largura e altura em metros", () => {
    const find = (code: string) => DEFAULT_WAREHOUSE_LAYOUT.find((position) => positionCode(position.aisle, position.shelf) === code)!;
    assert.deepEqual([find("A-04").length_m, find("A-04").depth_m, find("A-04").height_m], [1.8, 0.75, 1.9]);
    assert.deepEqual([find("B-05").length_m, find("B-05").depth_m, find("B-05").height_m], [1.78, 0.75, 0.88]);
    assert.deepEqual([find("C-01").length_m, find("C-01").depth_m, find("C-01").height_m], [1.78, 0.88, 0.9]);
    assert.equal(find("C-12").height_m, 1.5);
  });

  it("marca a A-16 para conferência da altura", () => {
    const a16 = DEFAULT_WAREHOUSE_LAYOUT.find((position) => position.aisle === "A" && position.shelf === 16)!;
    assert.equal(a16.height_m, 0.9);
    assert.match(String(a16.notes), /confirmar/i);
    assert.equal(DEFAULT_WAREHOUSE_LAYOUT.filter((position) => position.notes).length, 1);
  });

  it("toda prateleira do mapa inicial passa na validação", () => {
    for (const position of DEFAULT_WAREHOUSE_LAYOUT) {
      assert.doesNotThrow(() => normalizePosition(position));
    }
  });
});

describe("validação de uma posição", () => {
  const base = { aisle: "a", shelf: 3, length_m: 1.8, depth_m: 0.75, height_m: 0.65 };

  it("monta o código com a rua em maiúscula e a prateleira com dois dígitos", () => {
    assert.equal(positionCode("a", 3), "A-03");
    assert.equal(positionCode("C", 12), "C-12");
    assert.equal(normalizePosition(base).code, "A-03");
  });

  it("campo ausente continua ausente; vazio vira null", () => {
    const minimal = normalizePosition(base);
    assert.equal("customer_code" in minimal, false);
    assert.equal("max_weight_kg" in minimal, false);
    assert.equal("notes" in minimal, false);
    const cleared = normalizePosition({ ...base, customer_code: "", max_weight_kg: null, notes: "  " });
    assert.equal(cleared.customer_code, null);
    assert.equal(cleared.max_weight_kg, null);
    assert.equal(cleared.notes, null);
    const filled = normalizePosition({ ...base, customer_code: " BTG Pactual ", max_weight_kg: 80, sequence: 11, status: "blocked", notes: "avariada" });
    assert.equal(filled.customer_code, "BTG Pactual");
    assert.equal(filled.max_weight_kg, 80);
    assert.equal(filled.sequence, 11);
    assert.equal(filled.status, "blocked");
    assert.equal(filled.notes, "avariada");
  });

  it("recusa rua, prateleira e medidas inválidas", () => {
    assert.throws(() => normalizePosition({ ...base, aisle: "RUA A" }), /Rua inválida/);
    assert.throws(() => normalizePosition({ ...base, shelf: 0 }), /Prateleira inválida/);
    assert.throws(() => normalizePosition({ ...base, shelf: 2.5 }), /Prateleira inválida/);
    assert.throws(() => normalizePosition({ ...base, length_m: 0 }), /Comprimento inválido/);
    assert.throws(() => normalizePosition({ ...base, depth_m: -1 }), /Largura inválida/);
    assert.throws(() => normalizePosition({ ...base, height_m: Number.NaN }), /Altura inválida/);
    assert.throws(() => normalizePosition({ ...base, max_weight_kg: -5 }), /Peso máximo inválido/);
    assert.throws(() => normalizePosition({ ...base, sequence: 0 }), /Sequência inválida/);
    assert.throws(() => normalizePosition({ ...base, status: "x" as never }), /Situação inválida/);
  });

  it("schema do callable aceita número como texto e não transforma vazio em zero", () => {
    const parsed = SaveWarehousePositionsSchema.parse({
      positions: [{ ...base, length_m: "1,8".replace(",", "."), max_weight_kg: "", sequence: null }],
    });
    assert.equal(parsed.positions[0]!.length_m, 1.8);
    assert.equal(parsed.positions[0]!.max_weight_kg, null);
    assert.equal(parsed.positions[0]!.sequence, null);
    assert.throws(() => SaveWarehousePositionsSchema.parse({ positions: [] }));
    const aisle = CreateWarehouseAisleSchema.parse({ aisle: "d", shelves: "4", length_m: 1.8, depth_m: 0.75, height_m: 0.9 });
    assert.equal(aisle.shelves, 4);
  });
});
