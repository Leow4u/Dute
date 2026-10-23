import { describe, expect, it } from "vitest";

import { fonteDoPreco, ligadoAoComercial, payloadDoItem } from "./preco-da-cobranca";

/** De onde vem o preço na Tabela de preços do WMS (parte 7.3c). Dados sintéticos. */

describe("o preço da cobrança", () => {
  it("o item ligado tira o preço do Comercial; o resto, do WMS", () => {
    expect(fonteDoPreco({ valor_unit: 1.25, lpu_item_id: "lpu_entrada" })).toEqual({ tipo: "comercial" });
    expect(fonteDoPreco({ valor_unit: 1.25 })).toEqual({ tipo: "wms", valor: 1.25 });
    expect(fonteDoPreco({ valor_unit: 1.25, lpu_item_id: " " })).toEqual({ tipo: "wms", valor: 1.25 });
    expect(fonteDoPreco({ valor_unit: 0, lpu_item_id: "lpu_ad", auto_source: "ad_valorem" })).toEqual({ tipo: "wms", valor: 0 });
    expect(ligadoAoComercial({ lpu_item_id: "lpu_entrada" })).toBe(true);
  });

  it("o item ligado não manda o valor unitário ao salvar", () => {
    const payload = { item: "Entrada por peça", valor_unit: 1.25, ativo: true };
    expect(payloadDoItem(payload, true)).toEqual({ item: "Entrada por peça", ativo: true });
    expect(payloadDoItem(payload, false)).toEqual(payload);
  });
});
