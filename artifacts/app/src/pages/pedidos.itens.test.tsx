import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { JSDOM } from "jsdom";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { WarehouseTaskItem } from "@/lib/warehouse-ops/model";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosDaTela } from "@/test/textos";

import { ItemList, codigosDoItem } from "./pedidos";

/**
 * Os itens de cada pedido em Pedidos, por prateleira
 * (docs/mockups/WmsSepararLista.dc.html, parte 1a da separação com caixas; o
 * nome vem de NomeWmsPedidos.dc.html, padrão de 06/11/2026): o cabeçalho da
 * prateleira com os itens e as unidades e, em cada linha, a foto, o nome com
 * o tamanho em negrito, o código do cliente e o SKU, a caixa onde o item está
 * (parte 1c) e a quantidade à direita. Dados sintéticos.
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

function lista(items: WarehouseTaskItem[], cliente = new QueryClient(), dono?: string) {
  return renderToStaticMarkup(
    <QueryClientProvider client={cliente}>
      <ItemList items={items} cliente={dono} />
    </QueryClientProvider>,
  );
}

/** A caixa como a tela a lê (lib/warehouse-boxes.ts), só com o que a lista usa. */
function caixa(code: string, location: string, skus: string[], guardadaEm: string) {
  return { code, customer_code: "BTG", status: "stored", location_id: location, sku_codes: skus, stored_at: guardadaEm };
}

describe("os itens do pedido em Pedidos", () => {
  it("a prateleira no cabeçalho, com os itens e as unidades; na linha, o nome com o tamanho, os códigos e a quantidade", () => {
    expect(textosDaTela(lista([POLO_GG, CALCA_42]))).toEqual([
      "A-05",
      "1 item · 6 un.",
      "Calça Social Masculino Preta · 42",
      "A.01.0712.001.42 · BTG-000084",
      "6 un.",
      "B-02",
      "1 item · 20 un.",
      "Polo Masculino Piquet Preto · GG",
      "A.01.0806.005.GG · BTG-000125",
      "20 un.",
    ]);
  });

  it("as prateleiras seguem a ordem de caminhada do cadastro de Posições, não a do pedido", () => {
    const cliente = new QueryClient();
    cliente.setQueryData(["warehouse-positions", "all-pages"], {
      items: [
        { code: "C-02-4", sequence: 1 },
        { code: "B-02", sequence: 2 },
        { code: "A-05", sequence: 3 },
      ],
    });
    const textos = textosDaTela(lista([POLO_GG, CALCA_42, TOALHA_U], cliente));
    expect(textos.filter((texto) => ["A-05", "B-02", "C-02-4"].includes(texto))).toEqual(["C-02-4", "B-02", "A-05"]);
  });

  it("a linha mostra a caixa onde o item está: as guardadas na prateleira, a mais antiga primeiro", () => {
    const cliente = new QueryClient();
    cliente.setQueryData(
      ["warehouse-boxes", "BTG", "all-pages"],
      [
        caixa("CX-000015", "B-02", ["BTG-000125"], "2026-10-21T10:00:00.000Z"),
        caixa("CX-000014", "B-02", ["BTG-000125", "BTG-000124"], "2026-10-20T10:00:00.000Z"),
        caixa("CX-000027", "A-05", ["BTG-000084"], "2026-10-20T10:00:00.000Z"),
        // Outra prateleira e outro produto não entram na linha.
        caixa("CX-000099", "C-01", ["BTG-000125"], "2026-10-19T10:00:00.000Z"),
        caixa("CX-000098", "B-02", ["BTG-000001"], "2026-10-19T10:00:00.000Z"),
      ],
    );
    expect(textosDaTela(lista([POLO_GG, CALCA_42], cliente, "BTG"))).toEqual([
      "A-05",
      "1 item · 6 un.",
      "Calça Social Masculino Preta · 42",
      "A.01.0712.001.42 · BTG-000084",
      "CX-000027",
      "6 un.",
      "B-02",
      "1 item · 20 un.",
      "Polo Masculino Piquet Preto · GG",
      "A.01.0806.005.GG · BTG-000125",
      "CX-000014",
      "CX-000015",
      "20 un.",
    ]);
  });

  it("sem o cliente do pedido, as caixas não são lidas e a linha sai sem caixa", () => {
    const cliente = new QueryClient();
    cliente.setQueryData(["warehouse-boxes", "BTG", "all-pages"], [caixa("CX-000014", "B-02", ["BTG-000125"], "2026-10-20T10:00:00.000Z")]);
    expect(textosDaTela(lista([POLO_GG], cliente)).join(" ")).not.toContain("CX-");
  });

  it("o nome gravado hoje só perde o tamanho do fim; as letras ficam para a planilha do passo 3", () => {
    const hoje = { ...POLO_GG, product_name: "Polo masculino piquet preto GG" };
    expect(textosDaTela(lista([hoje]))).toEqual(["B-02", "1 item · 20 un.", "Polo masculino piquet preto · GG", "A.01.0806.005.GG · BTG-000125", "20 un."]);
    const comHifen = { ...POLO_GG, product_name: "Polo masculino piquet preto - GG" };
    expect(textosDaTela(lista([comHifen]))).toContain("Polo masculino piquet preto · GG");
  });

  it("o tamanho único fica só com o nome, sem · U", () => {
    const textos = textosDaTela(lista([TOALHA_U]));
    expect(textos).toEqual(["C-02-4", "1 item · 10 un.", "Toalha de Academia", "C.0659.001.U · BTG-000301", "10 un."]);
    expect(textos.join(" ")).not.toContain("· U");
  });

  it("sem o código do cliente, o SKU; sem posição, sem endereço", () => {
    const semCodigo: WarehouseTaskItem = { id: "pli_4", sku: "BTG-000400", product_name: "Caneca Térmica 500 ml", quantity: 3 };
    expect(textosDaTela(lista([semCodigo]))).toEqual(["sem endereço", "1 item · 3 un.", "Caneca Térmica 500 ml", "BTG-000400", "3 un."]);
  });

  it("os códigos: o do cliente e o SKU, o que existir, sem repetir", () => {
    expect(codigosDoItem(POLO_GG)).toBe("A.01.0806.005.GG · BTG-000125");
    expect(codigosDoItem({ sku_code: "BTG-000125", client_item_code: "BTG-000125" })).toBe("BTG-000125");
    expect(codigosDoItem({ client_item_code: " A.01.0806.005.GG " })).toBe("A.01.0806.005.GG");
    expect(codigosDoItem({})).toBe("");
  });

  it("mantém a foto do Estoque e, no celular, a grade: o nome e os códigos à esquerda, a quantidade no alto à direita", () => {
    const cliente = new QueryClient();
    cliente.setQueryData(["estoque", "skus"], {
      items: [{ cod_btg: "BTG-000125", cod_cliente: "A.01.0806.005.GG", primary_photo_url: "https://fotos.exemplo/polo-gg.jpg" }],
    });
    cliente.setQueryData(["stock-balances", "estoque"], { items: [] });
    cliente.setQueryData(["estoque", "products"], { items: [] });
    const dom = new JSDOM(`<!doctype html><body>${lista([POLO_GG], cliente)}</body>`);
    const { document } = dom.window;
    expect(document.querySelector("img")?.getAttribute("src")).toBe("https://fotos.exemplo/polo-gg.jpg");
    const spans = [...document.querySelectorAll("span")];
    const nome = spans.find((span) => span.textContent === "Polo Masculino Piquet Preto · GG");
    const codigos = spans.find((span) => span.textContent === "A.01.0806.005.GG · BTG-000125");
    const quantidade = spans.find((span) => span.textContent === "20 un.");
    expect(nome?.className).toContain("font-semibold");
    // O nome vem antes dos códigos, os dois na coluna da esquerda (docs/mockups/WmsSepararListaCelular.dc.html).
    expect(spans.indexOf(nome!)).toBeLessThan(spans.indexOf(codigos!));
    expect(nome?.className.split(" ")).toContain("col-start-1");
    expect(codigos?.className.split(" ")).toContain("col-start-1");
    expect(quantidade?.className).toMatch(/\bcol-start-2\b.*\brow-start-1\b/);
    // No celular o nome quebra a linha: o tamanho, no fim, não some nas reticências.
    expect(nome?.className.split(" ")).not.toContain("truncate");
    expect(nome?.className.split(" ")).toContain("sm:truncate");
    expect(codigos?.className.split(" ")).toContain("truncate");
    expect(nome?.closest(".grid")?.className).toContain("sm:flex");
    dom.window.close();
  });

  it("passa nas regras WCAG 2.1 A e AA do axe", async () => {
    expect(await violacoesDeAcessibilidade(lista([POLO_GG, CALCA_42, TOALHA_U]))).toEqual([]);
    const cliente = new QueryClient();
    cliente.setQueryData(["warehouse-boxes", "BTG", "all-pages"], [caixa("CX-000014", "B-02", ["BTG-000125"], "2026-10-20T10:00:00.000Z")]);
    expect(await violacoesDeAcessibilidade(lista([POLO_GG, CALCA_42], cliente, "BTG"))).toEqual([]);
  });
});
