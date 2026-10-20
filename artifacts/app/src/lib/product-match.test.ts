import { describe, expect, it } from "vitest";

import {
  barcodeKey,
  findProductByAnyCode,
  findProductByBarcode,
  generatedSkuNote,
  similarProducts,
  type MatchableProduct,
} from "./product-match";

const polo: MatchableProduct = {
  id: "polo",
  skuCode: "BTG-000001",
  clientCode: "F-POLO-AZ-M",
  productName: "Polo piquet azul marinho",
  barcode: "7891000000011",
  brand: "Dutelog",
  size: "M",
  color: "Azul",
};
const poloG: MatchableProduct = {
  ...polo,
  id: "polo-g",
  skuCode: "BTG-000002",
  clientCode: "F-POLO-AZ-G",
  barcode: "7891000000028",
  size: "G",
};
const camiseta: MatchableProduct = {
  id: "camiseta",
  skuCode: "BTG-000003",
  clientCode: "F-CAM-BR-M",
  productName: "Camiseta institucional branca",
  barcode: "",
};
const mochila: MatchableProduct = {
  id: "mochila",
  skuCode: "BTG-000004",
  clientCode: "MOCH-01",
  productName: "Mochila executiva",
};
const catalog = [polo, poloG, camiseta, mochila];

describe("busca por qualquer código", () => {
  it("acha pelo código do cliente, pelo SKU ou pelo código de barras", () => {
    expect(findProductByAnyCode(catalog, " f-polo-az-m ")).toEqual({ product: polo, field: "clientCode" });
    expect(findProductByAnyCode(catalog, "btg-000003")).toEqual({ product: camiseta, field: "skuCode" });
    expect(findProductByAnyCode(catalog, "789 1000 000028")).toEqual({ product: poloG, field: "barcode" });
    expect(findProductByAnyCode(catalog, "NAO-EXISTE")).toBeUndefined();
    expect(findProductByAnyCode(catalog, "  ")).toBeUndefined();
  });

  it("o código do cliente vence o SKU de outro produto", () => {
    const legado = { ...mochila, id: "legado", clientCode: "BTG-000001", skuCode: "SKU-ANTIGO" };
    expect(findProductByAnyCode([polo, legado], "BTG-000001")?.product).toBe(legado);
  });

  it("código de barras vazio não casa com produto sem código de barras", () => {
    expect(findProductByBarcode(catalog, "")).toBeUndefined();
    expect(findProductByBarcode(catalog, " 7891000000011 ")).toBe(polo);
    expect(barcodeKey(" 789 100 abc ")).toBe("789100ABC");
  });
});

describe("produtos parecidos", () => {
  it("pede duas palavras em comum e ignora acento, caixa e preposição", () => {
    expect(similarProducts({ name: "POLO PIQUÊT de manga" }, catalog)).toEqual([polo, poloG]);
    expect(similarProducts({ name: "Polo de algodão" }, catalog)).toEqual([]);
  });

  it("descrição de uma palavra só precisa de quatro letras", () => {
    expect(similarProducts({ name: "mochila" }, catalog)).toEqual([mochila]);
    expect(similarProducts({ name: "mo" }, catalog)).toEqual([]);
    expect(similarProducts({ name: "de" }, catalog)).toEqual([]);
  });

  it("tamanho e cor iguais sobem o parecido na lista", () => {
    expect(similarProducts({ name: "Polo piquet", size: "g" }, catalog)).toEqual([poloG, polo]);
    expect(similarProducts({ name: "Polo piquet", size: "M", color: "azul" }, catalog)[0]).toBe(polo);
  });

  it("respeita o limite", () => {
    expect(similarProducts({ name: "Polo piquet" }, catalog, 1)).toHaveLength(1);
  });
});

describe("aviso do SKU gerado", () => {
  it("lista só as linhas novas", () => {
    expect(
      generatedSkuNote([
        { sku_code: "BTG-000010", product_registration: "new" },
        { sku_code: "BTG-000001", product_registration: "existing" },
        { sku_code: "BTG-000011", product_registration: "new" },
      ]),
    ).toBe("SKUs gerados: BTG-000010, BTG-000011.");
    expect(generatedSkuNote([{ sku_code: "ITAU-000001", product_registration: "new" }])).toBe(
      "SKU gerado: ITAU-000001.",
    );
    expect(generatedSkuNote([{ sku_code: "BTG-000001", product_registration: "existing" }])).toBeNull();
    expect(generatedSkuNote(undefined)).toBeNull();
  });
});
