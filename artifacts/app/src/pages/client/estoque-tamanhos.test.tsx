// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";

vi.mock("@/lib/auth", () => ({
  useAppUser: () => ({ user: { uid: "uid-ana", publicMetadata: { role: "cliente", customer_code: "BTG Pactual" } }, isLoaded: true }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: () => undefined }) }));

import { ClienteEstoque } from "./estoque";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const ITENS = ["P", "M", "G"].map((tamanho) => ({
  sku_code: `SKU-${tamanho}`,
  client_item_code: `A.01.0805.002.${tamanho}`,
  product_name: `Polo ${tamanho}`,
  category: "Polo",
  qty_on_hand: 1,
  qty_available: 1,
  estoque_minimo: 2,
  client_archived: false,
}));
const ARQUIVADO = {
  ...ITENS[0]!,
  sku_code: "SKU-PP",
  client_item_code: "A.01.0805.002.PP",
  product_name: "Polo PP",
  qty_on_hand: 0,
  qty_available: 0,
  client_archived: true,
};

let raiz: Root | null = null;
let container: HTMLDivElement | null = null;
let consultas: QueryClient;

function botao(texto: string, escopo: ParentNode = document) {
  const encontrado = [...escopo.querySelectorAll("button")].find((item) => item.textContent?.trim() === texto);
  expect(encontrado, `botão ${texto}`).toBeDefined();
  return encontrado!;
}

function detalhe() {
  const painel = document.querySelector<HTMLElement>('[role="dialog"]');
  expect(painel, "detalhe aberto").not.toBeNull();
  return painel!;
}

function tamanhos() {
  return [...detalhe().querySelectorAll('[role="group"] button')].map((item) => item.firstElementChild?.textContent);
}

async function clicar(elemento: HTMLElement) {
  await act(async () => elemento.click());
}

async function abrir(filtro = "Com saldo", itens = [...ITENS, ARQUIVADO]) {
  vi.stubGlobal("fetch", vi.fn(async (entrada: RequestInfo | URL) => {
    const url = new URL(String(entrada), window.location.origin);
    const corpo = url.pathname === "/api/client/overview"
      ? { customer: { code: "BTG Pactual", name: "BTG Pactual" }, inventory: { items: itens } }
      : {};
    return new Response(JSON.stringify(corpo), { status: 200, headers: { "content-type": "application/json" } });
  }));
  consultas = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
  await act(async () => raiz!.render(
    <QueryClientProvider client={consultas}>
      <Router ssrPath="/portal/estoque"><ClienteEstoque /></Router>
    </QueryClientProvider>,
  ));
  for (let tentativa = 0; tentativa < 100 && !document.querySelector('[data-testid="stock-card"]'); tentativa += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
  expect(document.querySelector('[data-testid="stock-card"]'), "catálogo carregado").not.toBeNull();
  const situacao = [...document.querySelectorAll("button")].find((item) => item.textContent?.trim().startsWith(filtro));
  expect(situacao, `filtro ${filtro}`).toBeDefined();
  await clicar(situacao!);
  await clicar(botao("Polo P"));
}

beforeEach(() => window.localStorage.clear());

afterEach(async () => {
  await act(async () => raiz?.unmount());
  consultas?.clear();
  container?.remove();
  raiz = null;
  container = null;
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe("pedir outro tamanho sem fechar o detalhe", () => {
  it.each(["Todos", "Com saldo", "Abaixo do mínimo"])(
    "mantém os próximos tamanhos ao esgotar P e M com o filtro %s",
    async (filtro) => {
      await abrir(filtro);
      expect(tamanhos()).toEqual(["P", "M", "G"]);
      await clicar(botao("Adicionar ao pedido", detalhe()));
      expect(detalhe().querySelector('[role="status"]')?.textContent).toBe("1 peça adicionada ao pedido");
      expect(tamanhos()).toEqual(["P", "M", "G"]);

      await clicar(botao("M1 disp.", detalhe()));
      expect(detalhe().querySelector("h2")?.textContent).toBe("Polo M");
      await clicar(botao("Adicionar ao pedido", detalhe()));
      expect(tamanhos()).toContain("G");
      expect(tamanhos()).not.toContain("PP");

      await clicar(botao("G1 disp.", detalhe()));
      await clicar(botao("Adicionar ao pedido", detalhe()));
      await clicar(botao("Ver pedido", detalhe()));
      for (const tamanho of ["P", "M", "G"]) {
        expect(detalhe().querySelector<HTMLInputElement>(`input[aria-label="Quantidade de Polo ${tamanho}"]`)?.value).toBe("1");
      }
      expect(detalhe().querySelectorAll("li")).toHaveLength(3);
      if (filtro !== "Todos") {
        expect(document.querySelectorAll('[data-testid="stock-card"]')).toHaveLength(0);
      }
    },
  );

  it("não traz tamanhos arquivados ou acima do mínimo para o detalhe filtrado", async () => {
    const acimaDoMinimo = {
      ...ITENS[0]!,
      sku_code: "SKU-GG",
      client_item_code: "A.01.0805.002.GG",
      product_name: "Polo GG",
      qty_on_hand: 5,
      qty_available: 5,
    };
    await abrir("Abaixo do mínimo", [...ITENS, ARQUIVADO, acimaDoMinimo]);
    await clicar(botao("Adicionar ao pedido", detalhe()));
    expect(tamanhos()).toEqual(["P", "M", "G"]);
  });

  it("respeita a preferência de não agrupar tamanhos ao esgotar o selecionado", async () => {
    window.localStorage.setItem("dute.portal.agrupar-tamanhos", "nao");
    await abrir();
    await clicar(botao("Adicionar ao pedido", detalhe()));
    expect(tamanhos()).toEqual([]);
    expect(detalhe().querySelector("h2")?.textContent).toBe("Polo P");
    expect(document.querySelectorAll('[data-testid="stock-card"]')).toHaveLength(2);
  });
});
