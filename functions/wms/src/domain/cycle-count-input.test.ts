import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CycleCountSchema } from "./cycle-count-input.js";

const openingNew = {
  mode: "opening",
  session_id: "opening_BTG_Pactual",
  customer_code: "BTG Pactual",
  client_item_code: "F-POLO-AZ-M",
  product_name: "Polo piquet azul",
  product_registration: "new",
  location_id: "A-01-01",
  counted_qty: 4,
  unit_cost: 39.9,
  reason: "Inventário físico de abertura do estoque",
  idempotency_key: "count-1",
};

describe("entrada de recordCycleCount", () => {
  it("produto novo na abertura vem sem SKU: ele é gerado na transação", () => {
    const parsed = CycleCountSchema.parse(openingNew);
    assert.equal(parsed.sku_code, undefined);
    assert.equal(parsed.product_registration, "new");
  });

  it("local, quantidade, motivo e chave de idempotência continuam obrigatórios", () => {
    for (const field of ["location_id", "counted_qty", "reason", "idempotency_key"]) {
      const input: Record<string, unknown> = { ...openingNew };
      delete input[field];
      assert.equal(CycleCountSchema.safeParse(input).success, false, field);
    }
  });
});
