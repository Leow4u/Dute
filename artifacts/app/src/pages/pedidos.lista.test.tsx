import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { JSDOM } from "jsdom";
import { Package, Truck } from "lucide-react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Router } from "wouter";

import { hrefDaListaDeSeparacao } from "@/lib/warehouse-ops/lista-de-separacao";
import type { OrderGroup } from "@/lib/warehouse-ops/orders";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosDaTela } from "@/test/textos";

import { OrderRow } from "./pedidos";

/**
 * "Imprimir lista" na fila de Pedidos (separação com caixas, parte 1b;
 * docs/mockups/WmsSepararLista.dc.html e WmsSepararListaCelular.dc.html): no
 * computador, o botão antes de "Separado"; no celular, o atalho ao lado de
 * "Esconder itens", porque os botões vêm depois dos itens. Dados sintéticos.
 */

const PEDIDO: OrderGroup = {
  key: "ord_req_1",
  orderNumber: "PED-0001",
  requestId: "req_1",
  stage: "separar",
  exceptionCount: 0,
  pick: {
    id: "pick_ord_req_1",
    title: "PED-0001",
    status: "planned",
    customer_code: "BTG",
    items: [
      {
        id: "pli_ord_req_1_01",
        line_number: 1,
        sku_code: "BTG-000125",
        client_item_code: "A.01.0806.005.GG",
        product_name: "Polo Masculino Piquet Preto GG",
        quantity: 20,
        expected_quantity: 20,
        location: "B-02",
      },
    ],
  },
};

function linha(props: Partial<Parameters<typeof OrderRow>[0]> = {}) {
  return renderToStaticMarkup(
    <Router ssrPath="/pedidos">
      <QueryClientProvider client={new QueryClient()}>
        <OrderRow order={PEDIDO} icon={Package} tone="pick" defaultOpen action={<button type="button">Separado</button>} {...props} />
      </QueryClientProvider>
    </Router>,
  );
}

describe("Imprimir lista na fila de Pedidos", () => {
  const href = hrefDaListaDeSeparacao(PEDIDO.key);

  it("o pedido para separar tem o atalho da lista, e os textos da linha não mudam", () => {
    expect(href).toBe("/pedidos/lista?pedido=ord_req_1");
    expect(textosDaTela(linha({ listaHref: href }))).toEqual([
      "PED-0001",
      "1 item · 20 un.",
      "Esconder itens",
      "Imprimir lista",
      "Separado",
      "B-02",
      "Polo Masculino Piquet Preto · GG",
      "A.01.0806.005.GG · BTG-000125",
      "20 un.",
    ]);
  });

  it("no computador, o botão vem antes de Separado; no celular, o atalho fica ao lado de Esconder itens", () => {
    const dom = new JSDOM(`<!doctype html><body>${linha({ listaHref: href })}</body>`);
    const { document } = dom.window;
    const links = [...document.querySelectorAll("a")].filter((link) => link.textContent === "Imprimir lista");
    expect(links.map((link) => link.getAttribute("href"))).toEqual([href, href]);
    const [noCelular, noComputador] = links;
    // O atalho do celular some no computador, e fica na mesma linha de "Esconder itens".
    expect(noCelular.className.split(" ")).toContain("sm:hidden");
    expect(noCelular.parentElement?.querySelector("button")?.textContent).toBe("Esconder itens");
    // O botão do computador fica nas ações da linha, que somem no celular, antes de "Separado".
    const acoes = noComputador.parentElement;
    expect(acoes?.className).toMatch(/\bhidden\b.*\bsm:flex\b/);
    expect([...(acoes?.children ?? [])].map((filho) => filho.textContent)).toEqual(["Imprimir lista", "Separado"]);
    // No celular, depois dos itens, ficam só as ações do pedido.
    const depoisDosItens = [...document.querySelectorAll("div")].find((div) => div.className.split(" ").includes("sm:hidden"));
    expect(depoisDosItens?.textContent).toBe("Separado");
    dom.window.close();
  });

  it("sem o endereço da lista (o pedido para entregar), a linha fica como era", () => {
    const html = linha({ icon: Truck, tone: "deliver", action: <button type="button">Entregue</button> });
    expect(html).not.toContain("Imprimir lista");
    expect(textosDaTela(html).slice(0, 4)).toEqual(["PED-0001", "1 item · 20 un.", "Esconder itens", "Entregue"]);
  });

  it("o pedido sem linhas não tem o que imprimir", () => {
    const semLinhas: OrderGroup = { ...PEDIDO, pick: { ...PEDIDO.pick!, items: [] } };
    expect(linha({ order: semLinhas, listaHref: href })).not.toContain("Imprimir lista");
  });

  it("passa nas regras WCAG 2.1 A e AA do axe", async () => {
    expect(await violacoesDeAcessibilidade(linha({ listaHref: href }))).toEqual([]);
  });
});
