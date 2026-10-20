import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ProductLookupItem } from "./shared";
import { SimilarProductList } from "./similar-products";

const product = (overrides: Partial<ProductLookupItem>): ProductLookupItem => ({
  id: "polo",
  skuCode: "BTG-000001",
  clientCode: "F-POLO-AZ-M",
  productName: "Polo piquet azul",
  barcode: "",
  brand: "",
  size: "M",
  color: "Azul",
  photoUrl: "https://storage.googleapis.com/demo/product-photos/polo.jpg",
  unitCost: 39.9,
  hasSku: true,
  source: {},
  ...overrides,
});

describe("parecidos com foto", () => {
  it("mostra foto, códigos, tamanho e cor e o botão para usar o cadastro", () => {
    const html = renderToStaticMarkup(
      <SimilarProductList
        products={[product({}), product({ id: "camisa", productName: "Camisa social", photoUrl: "" })]}
        onPick={() => undefined}
        pickLabel="Usar este"
      />,
    );
    expect(html).toContain('src="https://storage.googleapis.com/demo/product-photos/polo.jpg"');
    expect(html).toContain("F-POLO-AZ-M · BTG-000001");
    expect(html).toContain("M · Azul");
    expect(html).toContain('title="Sem foto"');
    expect(html.match(/Usar este/g)).toHaveLength(2);
  });

  it("sem parecidos, não ocupa espaço", () => {
    expect(renderToStaticMarkup(<SimilarProductList products={[]} />)).toBe("");
  });
});
