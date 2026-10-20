import { describe, expect, it } from "vitest";
import { warehouseBoxFromRecord } from "./warehouse-boxes";
import { openingLineTargets } from "./opening-line-correction";

const box = (code: string, extra: Record<string, unknown> = {}) => warehouseBoxFromRecord({
  code, status: "stored", customer_code: "Cliente A", location_id: "A-01",
  origin: { session_id: "sessao-1" }, ...extra,
});
const line = { id: "linha-1", box_code: "CX-000001", sku_code: "SKU-01", counted_qty: 8 };

describe("destino da correção de caixa", () => {
  it("só oferece outra caixa guardada do mesmo cliente e sessão", () => {
    const targets = openingLineTargets([
      box("CX-000001"), box("CX-000002"),
      box("CX-000003", { customer_code: "Cliente B" }),
      box("CX-000004", { origin: { session_id: "sessao-2" } }),
      box("CX-000005", { status: "counting" }),
    ], line, "Cliente A", "sessao-1", [line]);
    expect(targets.map((target) => target.box.code)).toEqual(["CX-000002"]);
  });
  it("explica o conflito de SKU sem impedir tamanhos diferentes na mesma caixa", () => {
    const lines = [line, { id: "linha-2", box_code: "CX-000002", sku_code: "SKU-01" },
      { id: "linha-3", box_code: "CX-000003", sku_code: "SKU-02" }];
    const targets = openingLineTargets([box("CX-000002"), box("CX-000003")], line, "Cliente A", "sessao-1", lines);
    expect(targets.map((target) => target.duplicateSku)).toEqual([true, false]);
    expect(line).toEqual({ id: "linha-1", box_code: "CX-000001", sku_code: "SKU-01", counted_qty: 8 });
  });
});
