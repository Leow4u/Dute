import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { buildShelves, skuIndexFromRows } from "@/lib/warehouse-map";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosForaDaLista } from "@/test/textos";
import { SaldoSemCaixa } from "./warehouse-map";

const [b02] = buildShelves(
  [
    {
      id: "B-02",
      code: "B-02",
      aisle: "B",
      shelf: 2,
      length_m: 1.78,
      depth_m: 0.75,
      height_m: 0.65,
      max_weight_kg: null,
      sequence: 17,
      customer_code: "BTG Pactual",
      status: "active",
    },
  ],
  [],
  [
    { location_id: "B-02", sku_code: "BTG-000001", qty_on_hand: 30 },
    { location_id: "B-02", sku_code: "BTG-000002", qty_on_hand: 41 },
  ],
);
const index = skuIndexFromRows([
  { id: "BTG-000001", produto: "POLO MASCULINO PIQUET PRETO GG", cod_cliente: "A.01.0806.005.GG" },
]);

describe("Mapa › saldo sem caixa registrada", () => {
  it("mostra o produto e a quantidade da prateleira sem caixa, só com rótulos e dados", async () => {
    const html = renderToStaticMarkup(<SaldoSemCaixa shelf={b02!} skuIndex={index} />);
    expect(html).toContain("POLO MASCULINO PIQUET PRETO GG · A.01.0806.005.GG");
    // Sem nome no catálogo, fica o SKU.
    expect(html).toContain("41 × BTG-000002");
    expect(
      textosForaDaLista(html, ["Saldo sem caixa registrada", "71 un.", /^\d+ × .+$/]),
    ).toEqual([]);
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });
});
