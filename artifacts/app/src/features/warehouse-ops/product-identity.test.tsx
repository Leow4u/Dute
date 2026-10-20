import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ProductLookupItem } from "./shared";
import { NewProductNotice, ProductIdentityCard } from "./product-identity";

const product: ProductLookupItem = {
  id: "tricot-gg",
  skuCode: "BTG-000041",
  clientCode: "A.01.0536.004.GG",
  productName: "TRICOT MEIO ZÍPER CINZA GG",
  barcode: "7891000000011",
  brand: "TRICOT",
  size: "GG",
  color: "CINZA",
  photoUrl: "https://example.com/tricot.jpg",
  unitCost: 100,
  hasSku: true,
  source: {},
};

describe("identificação do cadastro encontrado", () => {
  it("exibe o cadastro completo, foto e variantes antes da seleção", () => {
    const html = renderToStaticMarkup(
      <ProductIdentityCard product={product} matchLabel="pelo código do cliente" onSelect={() => undefined} />,
    );
    for (const value of [product.productName, product.clientCode, product.skuCode, product.barcode, product.brand, product.size, product.color]) {
      expect(html).toContain(value);
    }
    expect(html).toContain('src="https://example.com/tricot.jpg"');
    expect(html).toContain("Cadastro encontrado pelo código do cliente");
    expect(html).toContain("Usar este cadastro");
    expect(html).not.toContain("truncate");
    expect(html).not.toContain("line-clamp");
    expect(html).not.toContain("Parecidos");
  });

  it("indica cadastro selecionado e impede a seleção repetida", () => {
    const html = renderToStaticMarkup(
      <ProductIdentityCard product={product} selected onSelect={() => undefined} />,
    );
    expect(html).toContain("Cadastro selecionado");
    expect(html).toMatch(/<button[^>]*disabled=""/);
    expect(html).not.toContain("Usar este cadastro");
  });

  it("identifica ausência de foto e atributos sem inventar dados", () => {
    const html = renderToStaticMarkup(
      <ProductIdentityCard product={{ ...product, photoUrl: "", size: "", color: "" }} onSelect={() => undefined} />,
    );
    expect(html).toContain("Sem foto");
    expect(html).toContain("Não informado");
    expect(html).not.toContain("<img");
  });
});

describe("identificação de produto novo", () => {
  it("permite confirmar um código não localizado sem oferecer outro produto", () => {
    const html = renderToStaticMarkup(
      <NewProductNotice confirmed={false} note="SKU gerado ao guardar a caixa." onToggle={() => undefined} />,
    );
    expect(html).toContain("Produto não localizado pelo código informado");
    expect(html).toContain("Cadastrar como novo");
    expect(html).not.toContain("Usar este cadastro");
    expect(html).not.toContain("Parecidos");
  });

  it("mostra a confirmação e permite rever a identificação", () => {
    const html = renderToStaticMarkup(
      <NewProductNotice confirmed note="SKU gerado ao guardar a caixa." onToggle={() => undefined} />,
    );
    expect(html).toContain("Produto novo confirmado");
    expect(html).toContain("Rever identificação");
    expect(html).toContain("SKU gerado ao guardar a caixa.");
    expect(html).not.toContain("Produto não localizado");
  });

  it("preserva o bloqueio informado pela tela", () => {
    const html = renderToStaticMarkup(
      <NewProductNotice confirmed={false} disabled note="Cadastre a sigla do SKU." onToggle={() => undefined} />,
    );
    expect(html).toMatch(/<button[^>]*disabled=""/);
    expect(html).toContain("Cadastre a sigla do SKU.");
  });
});
