// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProductDetailPanel, SideDrawer, groupInventoryProducts } from "./estoque";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

/** O foco de volta sai num setTimeout da Radix: um tique do relógio deixa terminar. */
const tique = () => act(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
});

const toalha = groupInventoryProducts([
  {
    sku_code: "BTG-000103",
    client_item_code: "C.0659.001.U",
    product_name: "Toalha de academia",
    category: "Toalha",
    qty_on_hand: 672,
    qty_available: 672,
  },
])[0]!;

const noop = () => undefined;

let limpar: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  for (const passo of limpar.reverse()) await passo();
  limpar = [];
});

async function montar(elemento: ReactNode): Promise<Root> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(elemento));
  limpar.push(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
  return root;
}

function detalheNaGaveta(onClose: () => void) {
  return (
    <SideDrawer title="Toalha de academia" onClose={onClose} bottomSheetOnMobile>
      <ProductDetailPanel
        product={toalha}
        cart={{}}
        draftQuantity={1}
        isPending={false}
        onClose={onClose}
        onDraftQuantityChange={noop}
        onAdd={noop}
        onReplenish={noop}
        onArchive={noop}
      />
    </SideDrawer>
  );
}

describe("o painel lateral do estoque é um diálogo (diagnóstico, item 7)", () => {
  it("tem o nome do produto, leva o foco ao Fechar, fecha no Esc e devolve o foco a quem abriu", async () => {
    const abrir = document.createElement("button");
    abrir.textContent = "Ver detalhes de Toalha de academia";
    document.body.appendChild(abrir);
    limpar.push(() => abrir.remove());
    abrir.focus();
    const fechar = vi.fn();

    const root = await montar(detalheNaGaveta(fechar));
    const dialogo = document.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialogo).not.toBeNull();
    expect(document.getElementById(dialogo!.getAttribute("aria-labelledby") ?? "")?.textContent).toBe("Toalha de academia");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Fechar detalhe");
    expect(dialogo!.contains(document.activeElement)).toBe(true);

    await act(async () => {
      document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(fechar).toHaveBeenCalledTimes(1);

    // Quem usa a gaveta a tira da tela ao fechar; o foco volta ao card que abriu.
    await act(async () => root.render(null));
    await tique();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(abrir);
  });

  it("o detalhe sobe de baixo no celular e fica ao lado, com 440px, a partir do md; o pedido segue como era", async () => {
    const root = await montar(detalheNaGaveta(noop));
    const detalhe = document.querySelector('[role="dialog"]')!.className.split(/\s+/);
    expect(detalhe).toEqual(expect.arrayContaining(["max-h-[88dvh]", "rounded-t-xl", "md:max-w-[440px]", "md:rounded-xl", "flex", "flex-col"]));

    await act(async () => root.render(
      <SideDrawer title="Seu pedido" onClose={noop}>
        <button type="button">Enviar pedido para a Dutelog</button>
      </SideDrawer>,
    ));
    const pedido = document.querySelector('[role="dialog"]')!.className.split(/\s+/);
    expect(pedido).toEqual(expect.arrayContaining(["h-full", "max-w-[440px]"]));
    expect(pedido).not.toContain("rounded-t-xl");

    await act(async () => root.render(
      <SideDrawer title="Seu pedido" onClose={noop} wide>
        <button type="button">Enviar pedido para a Dutelog</button>
      </SideDrawer>,
    ));
    expect(document.querySelector('[role="dialog"]')!.className.split(/\s+/)).toContain("max-w-[1200px]");
  });
});
