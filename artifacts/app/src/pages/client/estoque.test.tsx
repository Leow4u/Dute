import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CartPanel } from "./estoque";

function renderCart(outboundBlocked: boolean) {
  const noop = () => undefined;
  return renderToStaticMarkup(
    <CartPanel
      customerCode=""
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
