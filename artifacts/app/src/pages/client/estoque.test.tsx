import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CartPanel } from "./estoque";

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
