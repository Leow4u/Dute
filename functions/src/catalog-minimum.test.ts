import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MAX_MINIMUM_STOCK,
  MinimumStockError,
  normalizeMinimumStock,
} from "./catalog-minimum.js";

describe("normalizeMinimumStock", () => {
  it("não mexe no campo quando ele não vem na edição", () => {
    assert.equal(normalizeMinimumStock(undefined), undefined);
  });

  it("vazio ou null limpa o mínimo", () => {
    assert.equal(normalizeMinimumStock(null), null);
    assert.equal(normalizeMinimumStock(""), null);
    assert.equal(normalizeMinimumStock("   "), null);
  });

  it("aceita inteiro em número ou texto do formulário", () => {
    assert.equal(normalizeMinimumStock(0), 0);
    assert.equal(normalizeMinimumStock(12), 12);
    assert.equal(normalizeMinimumStock(" 30 "), 30);
    assert.equal(normalizeMinimumStock(MAX_MINIMUM_STOCK), MAX_MINIMUM_STOCK);
  });

  it("recusa negativo, fração, texto e valor absurdo", () => {
    for (const value of [-1, 2.5, "2,5", "abc", MAX_MINIMUM_STOCK + 1, true, {}]) {
      assert.throws(() => normalizeMinimumStock(value), MinimumStockError, String(value));
    }
  });
});
