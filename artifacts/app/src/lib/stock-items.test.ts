import { describe, expect, it } from "vitest";

import { buildStockItems, matchesFilter, matchesSearch } from "./stock-items";

const skus = [
  { id: 1, cod_btg: "SKU-A", cod_cliente: "A.01.M", produto: "Tricô", cor: "Marinho", tamanho: "M", estoque_atual: 29, estoque_reservado: 0, estoque_minimo: 30, preco_unit: 100, photo_urls: ["https://x/sku-a.jpg"] },
  { id: 2, cod_btg: "MAT-009", cod_cliente: "MAT-009", produto: "Cesto", estoque_atual: 2 },
  { id: 3, cod_btg: "SKU-P", cod_cliente: "A.01.P", produto: "Tricô", estoque_atual: 15, estoque_reservado: 10, estoque_disponivel: 5, estoque_minimo: 10 },
  { id: 4, cod_btg: "SKU-ARQ", cod_cliente: "ARQ", produto: "Arquivado", estoque_atual: 0, archived: true },
  { id: 5, cod_btg: "SKU-Z", cod_cliente: "Z", produto: "Zerado", estoque_atual: 0, rua: "A", prateleira: "1", caixa: "2" },
];
const balances = [
  { sku_code: "SKU-A", location_id: "RUA-A/P02/CX-012", qty_on_hand: 25 },
  { sku_code: "SKU-A", location_id: "RUA-A/P03/CX-001", qty_on_hand: 4 },
  // Foto gravada só no saldo (contagem) ainda aparece no item.
  { sku_code: "SKU-P", location_id: "RUA-A/P02/CX-011", qty_on_hand: 15, primary_photo_url: "https://x/saldo-p.jpg" },
];
const products = [
  // Foto gravada só no produto (importação) também vale.
  { cod_cliente: "Z", produto: "Zerado", photo_urls: ["https://x/produto-z.jpg"] },
];

describe("itens do estoque", () => {
  const items = buildStockItems({ skus, balances, products });
  const byCode = (code: string) => items.find((item) => item.skuCode === code)!;

  it("junta cadastro, saldo por endereço e foto, sem os arquivados", () => {
    expect(items.map((item) => item.skuCode)).not.toContain("SKU-ARQ");
    const tricot = byCode("SKU-A");
    expect(tricot.locations).toEqual([
      { id: "RUA-A/P02/CX-012", qty: 25 },
      { id: "RUA-A/P03/CX-001", qty: 4 },
    ]);
    expect(tricot.detail).toBe("Marinho · M");
    expect(tricot.unitCost).toBe(100);
    expect(tricot.photos).toEqual(["https://x/sku-a.jpg"]);
  });

  it("acha a foto no sku, no produto ou no saldo", () => {
    expect(byCode("SKU-P").photos).toEqual(["https://x/saldo-p.jpg"]);
    expect(byCode("SKU-Z").photos).toEqual(["https://x/produto-z.jpg"]);
    expect(byCode("MAT-009").photos).toEqual([]);
  });

  it("exibe primeiro a foto principal aprovada, preservando as originais", () => {
    const [item] = buildStockItems({ skus: [{ cod_btg: "SKU-STUDIO", photo_urls: ["https://x/original.jpg", "https://x/generated.png"], primary_photo_url: "https://x/generated.png" }] });
    expect(item?.photos).toEqual(["https://x/generated.png", "https://x/original.jpg"]);
  });

  it("usa o endereço antigo do catálogo quando não há saldo por endereço", () => {
    expect(byCode("SKU-Z").locations).toEqual([{ id: "RA P1 C2", qty: 0 }]);
  });

  it("filtra baixo, reservados, sem foto e zerados", () => {
    const codes = (filter: Parameters<typeof matchesFilter>[1]) =>
      items.filter((item) => matchesFilter(item, filter)).map((item) => item.skuCode).sort();
    expect(codes("low")).toEqual(["SKU-A"]);
    expect(codes("reserved")).toEqual(["SKU-P"]);
    expect(codes("no-photo")).toEqual(["MAT-009"]);
    expect(codes("zero")).toEqual(["SKU-Z"]);
    expect(byCode("SKU-P").available).toBe(5);
  });

  it("só marca baixo quem tem mínimo cadastrado", () => {
    // 2 unidades, mas sem mínimo: não é "baixo" só por ser pouco.
    expect(byCode("MAT-009").minimum).toBeUndefined();
    expect(byCode("MAT-009").low).toBe(false);
    // 29 com mínimo 30: baixo. 15 com mínimo 10: ok.
    expect(byCode("SKU-A")).toMatchObject({ minimum: 30, low: true });
    expect(byCode("SKU-P")).toMatchObject({ minimum: 10, low: false });
    // Zerado continua "Zerado", não "Baixo".
    expect(byCode("SKU-Z").low).toBe(false);
  });

  it("busca por código, nome ou endereço", () => {
    const find = (text: string) =>
      items.filter((item) => matchesSearch(item, text)).map((item) => item.skuCode);
    expect(find("a.01.m")).toEqual(["SKU-A"]);
    expect(find("cesto")).toEqual(["MAT-009"]);
    expect(find("P03/CX-001")).toEqual(["SKU-A"]);
  });
});
