// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosForaDaLista } from "@/test/textos";

/**
 * Os itens do pedido em Meus pedidos (docs/mockups/NomePortalMeusPedidos.dc.html,
 * padrão do nome de 06/11/2026): Código, Produto, Tamanho e Peças. O nome é o
 * mesmo em todos os tamanhos, e o tamanho sai do fim do código do cliente; o
 * nome gravado com o tamanho no fim (antes da planilha do passo 3) perde o
 * tamanho repetido. Dados sintéticos.
 */

const dados = vi.hoisted(() => ({ overview: {} as Record<string, unknown> }));
vi.mock("./shared", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./shared")>()),
  ClientDataBoundary: ({ children }: { children: (overview: Record<string, unknown>) => ReactNode }) => children(dados.overview),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

import { ClientePedidos } from "./pedidos";

const ITENS = [
  { client_item_code: "A.01.0806.005.GG", product_name: "Polo masculino piquet preto - GG", quantity: 20 },
  { client_item_code: "A.01.0806.005.XG", product_name: "Polo Masculino Piquet Preto", quantity: 15 },
  { client_item_code: "A.01.0712.001.42", product_name: "Calça Social Masculino Preta 42", quantity: 6 },
  { client_item_code: "C.0659.001.U", product_name: "Toalha de academia", quantity: 2 },
  { sku_code: "BTG-000301", product_name: "Sacola quadrada", quantity: 1 },
  { product_name: "Mochila nova", quantity: 4, code_pending: true },
];

let root: Root;
let container: HTMLDivElement;
let queryClient: QueryClient;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
});

afterEach(async () => {
  await act(async () => root.unmount());
  queryClient.clear();
  container.remove();
});

async function abrirOPedido() {
  dados.overview = {
    request_history: [
      {
        id: "creq_tamanhos",
        type: "retirada",
        request_number: "PED-0142",
        title: "Uniformes para a agência Faria Lima",
        status: "approved",
        destination: "BTG Faria Lima",
        created_at: "2026-11-05T12:10:00Z",
        updated_at: "2026-11-05T12:12:00Z",
        items: ITENS,
      },
    ],
    order_tracking: [],
    document_history: [],
  };
  await act(async () =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <ClientePedidos />
      </QueryClientProvider>,
    ),
  );
  const abrir = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("PED-0142"));
  expect(abrir, "abrir o pedido da lista").toBeDefined();
  await act(async () => abrir!.click());
  const tabela = container.querySelector("table");
  expect(tabela, "a tabela de itens do detalhe").not.toBeNull();
  return tabela!;
}

describe("os itens do pedido no portal", () => {
  it("as colunas Código, Produto, Tamanho e Peças; o nome sem o tamanho repetido e o tamanho pelo código", async () => {
    const tabela = await abrirOPedido();
    expect([...tabela.querySelectorAll("th")].map((celula) => celula.textContent)).toEqual(["Código", "Produto", "Tamanho", "Peças"]);
    expect([...tabela.querySelectorAll("tbody tr")].map((linha) => [...linha.querySelectorAll("td")].map((celula) => celula.textContent))).toEqual([
      ["A.01.0806.005.GG", "Polo masculino piquet preto", "GG", "20"],
      ["A.01.0806.005.XG", "Polo Masculino Piquet Preto", "XG", "15"],
      ["A.01.0712.001.42", "Calça Social Masculino Preta", "42", "6"],
      ["C.0659.001.U", "Toalha de academia", "Único", "2"],
      ["BTG-000301", "Sacola quadrada", "—", "1"],
      ["código a definir", "Mochila nova", "—", "4"],
    ]);
  });

  it("mostra só rótulos e dados e passa no axe", async () => {
    const tabela = await abrirOPedido();
    expect(
      textosForaDaLista(tabela.outerHTML, [
        "Código", "Produto", "Tamanho", "Peças",
        "A.01.0806.005.GG", "Polo masculino piquet preto", "GG", "20",
        "A.01.0806.005.XG", "Polo Masculino Piquet Preto", "XG", "15",
        "A.01.0712.001.42", "Calça Social Masculino Preta", "42", "6",
        "C.0659.001.U", "Toalha de academia", "Único", "2",
        "BTG-000301", "Sacola quadrada", "—", "1",
        "código a definir", "Mochila nova", "4",
      ]),
    ).toEqual([]);
    expect(await violacoesDeAcessibilidade(container.innerHTML)).toEqual([]);
  });
});
