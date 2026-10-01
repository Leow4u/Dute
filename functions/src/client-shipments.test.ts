import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { receivedSummary } from "./domain/client-shipments.js";

describe("quanto chegou de verdade", () => {
  it("soma avisado e conferido e lista só as linhas que divergiram", () => {
    const summary = receivedSummary([
      { client_item_code: "A.01.0594.005.P", product_name: "POLO", expected_qty: 100, received_qty: 100 },
      { client_item_code: "A.01.0594.005.M", product_name: "POLO", expected_qty: 20, received_qty: 18 },
      { sku_code: "SKU-9", product_name: "CANECA", expected_qty: 5, received_qty: 6 },
    ]);
    assert.deepEqual(summary, {
      qty_expected: 125,
      qty_received: 124,
      received_differences: [
        { code: "A.01.0594.005.M", name: "POLO", expected: 20, received: 18 },
        { code: "SKU-9", name: "CANECA", expected: 5, received: 6 },
      ],
    });
  });

  it("não publica nada interno da linha", () => {
    const summary = receivedSummary([
      { client_item_code: "X", expected_qty: 1, received_qty: 0, ...({ location_id: "R1", unit_cost: 9 } as object) },
    ]);
    assert.deepEqual(Object.keys(summary.received_differences[0]).sort(), ["code", "expected", "name", "received"]);
  });
});
