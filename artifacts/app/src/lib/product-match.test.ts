import { describe, expect, it } from "vitest";

import {
  barcodeKey,
  findProductByAnyCode,
  findProductByBarcode,
  generatedSkuNote,
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

describe("identidade do produto", () => {
  it("não identifica pelo nome mesmo quando descrição, marca e cor coincidem", () => {
    expect(findProductByAnyCode(catalog, polo.productName)).toBeUndefined();
    expect(findProductByAnyCode(catalog, "F-POLO-AZ-GG")).toBeUndefined();
    expect(findProductByAnyCode(catalog, poloG.clientCode)?.product).toBe(poloG);
    expect(findProductByAnyCode([polo], poloG.clientCode)).toBeUndefined();
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

  it("o cadastro arquivado que voltou é reativado, não gerado", () => {
    expect(
      generatedSkuNote([{ sku_code: "BTG-000090", product_registration: "new", catalog_reactivated: true }]),
    ).toBe("SKU reativado: BTG-000090.");
    expect(
      generatedSkuNote([
        { sku_code: "BTG-000120", product_registration: "new" },
        { sku_code: "BTG-000090", product_registration: "new", catalog_reactivated: true },
        { sku_code: "BTG-000091", product_registration: "new", catalog_reactivated: true },
      ]),
    ).toBe("SKU gerado: BTG-000120. SKUs reativados: BTG-000090, BTG-000091.");
  });
});
