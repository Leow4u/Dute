import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { groupFamilies } from "@/lib/stock-variants";

import { CartPanel, FamilyCard, StockList, groupInventoryProducts } from "./estoque";
import type { InventoryItem } from "./shared";

function renderCart(outboundBlocked: boolean, cartKey = "") {
  const noop = () => undefined;
  return renderToStaticMarkup(
    <CartPanel
      cartKey={cartKey}
      seed={0}
      lines={[]}
      isSubmitting={false}
      isSavingEvent={false}
      outboundBlocked={outboundBlocked}
      expanded={false}
      onToggleExpanded={noop}
      onClose={noop}
      onSaveEvent={noop}
      onIncrement={noop}
      onDecrement={noop}
      onQuantityChange={noop}
      onRemove={noop}
      onSubmit={noop}
    />,
  );
}

describe("pedido do portal durante a abertura", () => {
  it("mostra a faixa uma vez, sem repetir o aviso embaixo do botão", () => {
    const html = renderCart(true);
    expect(html.match(/Inventário inicial em andamento/g)).toHaveLength(1);
    expect(html).toContain("O envio espera o fim da contagem.");
    expect(html).not.toContain("A abertura do estoque ainda não terminou.");
  });

  it("sem a trava, não mostra a faixa", () => {
    expect(renderCart(false)).not.toContain("Inventário inicial em andamento");
  });
});

describe("pedido do portal neste aparelho", () => {
  it("sem saber de quem é o pedido, não diz que está salvo", () => {
    expect(renderCart(false)).not.toContain("Salvo neste aparelho");
  });

  it("antes de gravar no storage, não diz que está salvo", () => {
    expect(renderCart(false, "dute.portal.pedido.BTG Pactual.uid-ana")).not.toContain("Salvo neste aparelho");
  });
});


// Como a projeção do portal chega: nome é a descrição, categoria é o tipo.
const estoque: InventoryItem[] = [
  {
    sku_code: "BTG-000101",
    client_item_code: "A.01.0805.002.PP",
    product_name: "Polo feminina piquet azul marinho PP",
    category: "Polo",
    qty_on_hand: 12,
    qty_available: 12,
    primary_photo_url: "https://fotos.exemplo/polo-feminina.jpg",
  },
  {
    sku_code: "BTG-000102",
    client_item_code: "A.01.0809.002.PP",
    product_name: "Polo masculino piquet arpoador PP",
    category: "Polo",
    qty_on_hand: 18,
    qty_available: 18,
  },
  {
    sku_code: "BTG-000103",
    client_item_code: "C.0659.001.U",
    product_name: "Toalha de academia",
    category: "Toalha",
    qty_on_hand: 672,
    qty_available: 672,
    primary_photo_url: "https://fotos.exemplo/toalha.jpg",
  },
];

const noop = () => undefined;

function renderCard(item: InventoryItem) {
  const products = groupInventoryProducts([item]);
  const [family] = groupFamilies(
    products,
    (product) => product.clientItemCode ?? product.clientCode,
    (product) => product.key,
  );
  return renderToStaticMarkup(
    <FamilyCard
      family={family!}
      cart={{}}
      draftQuantities={{}}
      onDraftQuantityChange={noop}
      onAdd={noop}
      onDetails={noop}
      onReplenish={noop}
      onArchive={noop}
    />,
  );
}

describe("gênero no estoque do portal", () => {
  it("o cartão com foto leva FEM sobre a foto, em cor, e diz Feminino ao leitor de tela", () => {
    const html = renderCard(estoque[0]!);
    expect(html.match(/>FEM</g)).toHaveLength(1);
    expect(html).toContain("bg-gender-fem-soft");
    expect(html).toContain('<span class="sr-only">Feminino</span>');
    // Sobre a foto: antes da linha do tipo, que abre o corpo do cartão.
    expect(html.indexOf(">FEM<")).toBeLessThan(html.indexOf("Polo · A.01.0805.002"));
  });

  it("sem foto, o chip vai na linha do tipo", () => {
    const html = renderCard(estoque[1]!);
    expect(html.match(/>MASC</g)).toHaveLength(1);
    expect(html).toContain("bg-gender-masc-soft");
    expect(html.indexOf(">MASC<")).toBeGreaterThan(html.indexOf("Polo · A.01.0809.002"));
  });

  it("produto sem gênero no nome não leva chip", () => {
    expect(renderCard(estoque[2]!)).not.toContain("bg-gender-");
  });

  it("a lista leva o mesmo chip ao lado do nome", () => {
    const html = renderToStaticMarkup(
      <StockList
        products={groupInventoryProducts(estoque)}
        cart={{}}
        draftQuantities={{}}
        onDraftQuantityChange={noop}
        onAdd={noop}
        onDetails={noop}
        onReplenish={noop}
        onArchive={noop}
      />,
    );
    expect(html.match(/>FEM</g)).toHaveLength(1);
    expect(html.match(/>MASC</g)).toHaveLength(1);
    expect(html.match(/bg-gender-/g)).toHaveLength(2);
  });
});
