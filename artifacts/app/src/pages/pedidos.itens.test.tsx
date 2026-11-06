import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { JSDOM } from "jsdom";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { WarehouseTaskItem } from "@/lib/warehouse-ops/model";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosDaTela } from "@/test/textos";

import { ItemList, codigosDoItem } from "./pedidos";

/**
 * Os itens de cada pedido em Pedidos (docs/mockups/NomeWmsPedidos.dc.html,
 * padrão do nome de 06/11/2026): a foto, a posição, o nome com o tamanho em
 * negrito e, embaixo, o código do cliente e o SKU; a quantidade à direita. O
 * nome é o mesmo em todos os tamanhos, então a linha diz o tamanho depois do
 * ponto. Dados sintéticos.
 */

const POLO_GG: WarehouseTaskItem = {
  id: "pli_1",
  sku: "BTG-000125",
  sku_code: "BTG-000125",
  client_item_code: "A.01.0806.005.GG",
  product_name: "Polo Masculino Piquet Preto GG",
  expected_quantity: 20,
  location: "B-02",
};
const CALCA_42: WarehouseTaskItem = {
  id: "pli_2",
  sku_code: "BTG-000084",
  client_item_code: "A.01.0712.001.42",
  name: "Calça Social Masculino Preta 42",
  product_name: "CALÇA SOCIAL MASCULINA 42",
  quantity: 6,
  location: "A-05",
};
const TOALHA_U: WarehouseTaskItem = {
  id: "pli_3",
  sku_code: "BTG-000301",
  client_item_code: "C.0659.001.U",
  product_name: "Toalha de Academia",
  expected_quantity: 10,
  location: "C-02-4",
};

function lista(items: WarehouseTaskItem[], cliente = new QueryClient()) {
  return renderToStaticMarkup(
    <QueryClientProvider client={cliente}>
      <ItemList items={items} />
    </QueryClientProvider>,
  );
}

describe("os itens do pedido em Pedidos", () => {
  it("o nome com o tamanho e, embaixo, o código do cliente e o SKU (NomeWmsPedidos)", () => {
    expect(textosDaTela(lista([POLO_GG, CALCA_42]))).toEqual([
      "B-02",
      "Polo Masculino Piquet Preto · GG",
      "A.01.0806.005.GG · BTG-000125",
      "20 un.",
      "A-05",
      "Calça Social Masculino Preta · 42",
      "A.01.0712.001.42 · BTG-000084",
      "6 un.",
    ]);
  });

  it("o nome gravado hoje só perde o tamanho do fim; as letras ficam para a planilha do passo 3", () => {
    const hoje = { ...POLO_GG, product_name: "Polo masculino piquet preto GG" };
    expect(textosDaTela(lista([hoje]))).toEqual(["B-02", "Polo masculino piquet preto · GG", "A.01.0806.005.GG · BTG-000125", "20 un."]);
    const comHifen = { ...POLO_GG, product_name: "Polo masculino piquet preto - GG" };
    expect(textosDaTela(lista([comHifen]))).toContain("Polo masculino piquet preto · GG");
  });

  it("o tamanho único fica só com o nome, sem · U", () => {
    const textos = textosDaTela(lista([TOALHA_U]));
    expect(textos).toEqual(["C-02-4", "Toalha de Academia", "C.0659.001.U · BTG-000301", "10 un."]);
    expect(textos.join(" ")).not.toContain("· U");
  });

  it("sem o código do cliente, o SKU; sem posição, sem endereço", () => {
    const semCodigo: WarehouseTaskItem = { id: "pli_4", sku: "BTG-000400", product_name: "Caneca Térmica 500 ml", quantity: 3 };
    expect(textosDaTela(lista([semCodigo]))).toEqual(["sem endereço", "Caneca Térmica 500 ml", "BTG-000400", "3 un."]);
  });

  it("os códigos: o do cliente e o SKU, o que existir, sem repetir", () => {
    expect(codigosDoItem(POLO_GG)).toBe("A.01.0806.005.GG · BTG-000125");
    expect(codigosDoItem({ sku_code: "BTG-000125", client_item_code: "BTG-000125" })).toBe("BTG-000125");
    expect(codigosDoItem({ client_item_code: " A.01.0806.005.GG " })).toBe("A.01.0806.005.GG");
    expect(codigosDoItem({})).toBe("");
  });

  it("mantém a foto do Estoque e, no celular, a grade: posição, códigos e quantidade em cima, o nome embaixo", () => {
    const cliente = new QueryClient();
    cliente.setQueryData(["estoque", "skus"], {
      items: [{ cod_btg: "BTG-000125", cod_cliente: "A.01.0806.005.GG", primary_photo_url: "https://fotos.exemplo/polo-gg.jpg" }],
    });
    cliente.setQueryData(["stock-balances", "estoque"], { items: [] });
    cliente.setQueryData(["estoque", "products"], { items: [] });
    const dom = new JSDOM(`<!doctype html><body>${lista([POLO_GG], cliente)}</body>`);
    const { document } = dom.window;
    expect(document.querySelector("img")?.getAttribute("src")).toBe("https://fotos.exemplo/polo-gg.jpg");
    const nome = [...document.querySelectorAll("span")].find((span) => span.textContent === "Polo Masculino Piquet Preto · GG");
    const codigos = [...document.querySelectorAll("span")].find((span) => span.textContent === "A.01.0806.005.GG · BTG-000125");
    expect(nome?.className).toContain("font-semibold");
    expect(nome?.className).toMatch(/\bcol-span-3\b.*\brow-start-2\b/);
    // No celular o nome quebra a linha: o tamanho, no fim, não some nas reticências.
    expect(nome?.className.split(" ")).not.toContain("truncate");
    expect(nome?.className.split(" ")).toContain("sm:truncate");
    expect(codigos?.className).toMatch(/\bcol-start-2\b.*\brow-start-1\b/);
    expect(nome?.closest(".grid")?.className).toContain("sm:flex");
    dom.window.close();
  });

  it("passa nas regras WCAG 2.1 A e AA do axe", async () => {
    expect(await violacoesDeAcessibilidade(lista([POLO_GG, CALCA_42, TOALHA_U]))).toEqual([]);
  });
});
