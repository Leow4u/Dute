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
import type { InventoryItem } from "./shared";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function item(sku: string, code: string, name: string, category: string, available: number, archived = false): InventoryItem & { estoque_minimo: number; client_archived: boolean } {
  return { sku_code: sku, client_item_code: code, product_name: name, category, qty_on_hand: available, qty_available: available, estoque_minimo: 5, client_archived: archived };
}

const ITENS = [
  item("POLO-P", "A.01.0805.002.P", "Polo azul P", "Polo", 4),
  item("POLO-M", "A.01.0805.002.M", "Polo azul M", "Polo", 8),
  item("POLO-VERMELHA", "A.01.0806.001.P", "Polo vermelha P", "Polo", 12),
  item("TOALHA", "C.0659.001.U", "Toalha azul", "Toalha", 2),
  item("BOLSA", "C.0660.001.U", "Bolsa azul", "Bolsa", 0),
  item("CANECA", "C.0661.001.U", "Caneca azul", "Caneca", 10),
  item("BONE", "C.0662.001.U", "Boné preto", "Boné", 1),
  item("CINTO", "C.0663.001.U", "Cinto preto", "Cinto", 3),
  item("MEIA", "C.0664.001.U", "Meia branca", "Meia", 6),
  item("SACOLA", "C.0665.001.U", "Sacola branca", "Sacola", 7),
  item("ARQUIVADO", "A.01.0807.002.P", "Polo azul antiga", "Polo", 0, true),
];

let raiz: Root | undefined;
let container: HTMLDivElement | undefined;
let consultas: QueryClient | undefined;

async function abrir() {
  vi.stubGlobal("fetch", vi.fn(async (entrada: RequestInfo | URL) => {
    const url = new URL(String(entrada), window.location.origin);
    const corpo = url.pathname === "/api/client/overview"
      ? { customer: { code: "BTG Pactual", name: "BTG Pactual" }, inventory: { items: ITENS } }
      : {};
    return new Response(JSON.stringify(corpo), { status: 200, headers: { "content-type": "application/json" } });
  }));
  consultas = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
  await act(async () => raiz!.render(
    <QueryClientProvider client={consultas!}>
      <Router ssrPath="/portal/estoque"><ClienteEstoque /></Router>
    </QueryClientProvider>,
  ));
  for (let tentativa = 0; tentativa < 100 && !document.querySelector('[data-testid="stock-card"]'); tentativa += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  }
  expect(document.querySelector('[data-testid="stock-card"]'), "catálogo carregado").not.toBeNull();
}

function botao(texto: string, escopo: ParentNode = document) {
  const encontrado = [...escopo.querySelectorAll("button")].find((elemento) => elemento.textContent?.trim() === texto);
  expect(encontrado, `botão ${texto}`).toBeDefined();
  return encontrado!;
}

function porNome<T extends HTMLElement = HTMLElement>(nome: string, escopo: ParentNode = document) {
  const encontrado = escopo.querySelector<T>(`[aria-label="${nome}"]`);
  expect(encontrado, nome).not.toBeNull();
  return encontrado!;
}

function controleDoRotulo(nome: string, escopo: ParentNode = document) {
  const label = [...escopo.querySelectorAll("label")].find((elemento) => elemento.textContent?.trim() === nome);
  const controle = label && document.getElementById(label.htmlFor);
  expect(controle, nome).toBeTruthy();
  return controle!;
}

async function clicar(elemento: HTMLElement) {
  await act(async () => elemento.click());
}

async function preencher(nome: string, valor: string, escopo: ParentNode = document) {
  const input = porNome<HTMLInputElement>(nome, escopo);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, valor);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function selecionar(nome: string, valor: string, escopo: ParentNode = document) {
  const select = porNome<HTMLSelectElement>(nome, escopo);
  await act(async () => {
    select.value = valor;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function resultado() {
  return document.querySelector('[data-testid="stock-results-toolbar"] [role="status"]')?.textContent;
}

function cards() {
  return [...document.querySelectorAll('[data-testid="stock-card"]')];
}

function abrirFiltros(mobile = false) {
  const trigger = [...document.querySelectorAll<HTMLButtonElement>('button[aria-label^="Filtros"]')]
    .find((elemento) => elemento.classList.contains("md:hidden") === mobile);
  expect(trigger, "abrir filtros").toBeDefined();
  return clicar(trigger!);
}

function painel() {
  const dialogo = document.querySelector<HTMLElement>('[role="dialog"]');
  expect(dialogo, "painel de filtros aberto").not.toBeNull();
  return dialogo!;
}

beforeEach(() => window.localStorage.clear());

afterEach(async () => {
  await act(async () => raiz?.unmount());
  consultas?.clear();
  container?.remove();
  raiz = undefined;
  consultas = undefined;
  container = undefined;
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe("filtros do catálogo do portal", () => {
  it("combina a busca e o saldo com qualquer um dos tipos marcados; cada etiqueta remove só seu tipo", async () => {
    await abrir();
    await preencher("Buscar por nome ou código", "azul");
    await selecionar("Filtrar por saldo", "disponiveis");
    expect(resultado()).toBe("4 itens com saldo");
    await abrirFiltros();
    await clicar(controleDoRotulo("Polo", painel()));
    await clicar(botao("Ver mais tipos", painel()));
    await clicar(controleDoRotulo("Toalha", painel()));
    expect(resultado()).toBe("3 itens com saldo");
    expect(cards()).toHaveLength(2);
    expect(cards().map((card) => card.textContent).join(" ")).toContain("Polo azul");
    expect(cards().map((card) => card.textContent).join(" ")).toContain("Toalha azul");
    expect(cards().map((card) => card.textContent).join(" ")).not.toMatch(/Caneca|Bolsa|vermelha|antiga/);
    await clicar(porNome("Fechar filtros", painel()));

    await clicar(porNome("Tirar o filtro Polo"));
    expect(resultado()).toBe("1 item com saldo");
    expect(cards()[0]?.textContent).toContain("Toalha azul");
    await clicar(porNome("Tirar o filtro Toalha"));
    expect(resultado()).toBe("4 itens com saldo");
    expect(porNome<HTMLInputElement>("Buscar por nome ou código").value).toBe("azul");
    expect(porNome<HTMLSelectElement>("Filtrar por saldo").value).toBe("disponiveis");
  });

  it("trocar para arquivados substitui o saldo; voltar a ativos não restaura um saldo oculto", async () => {
    await abrir();
    await preencher("Buscar por nome ou código", "azul");
    await selecionar("Filtrar por saldo", "baixo");
    await abrirFiltros();
    await clicar(controleDoRotulo("Polo", painel()));
    expect(resultado()).toBe("1 item abaixo do mínimo");
    await clicar(painel().querySelector<HTMLElement>('[role="radio"][value="arquivados"]')!);

    const saldo = porNome<HTMLSelectElement>("Filtrar por saldo");
    expect(saldo.disabled).toBe(true);
    expect(saldo.selectedOptions[0]?.textContent).toBe("Todos os saldos");
    expect(resultado()).toBe("1 item arquivado");
    expect(cards()[0]?.textContent).toContain("Polo azul antiga");
    expect(document.querySelector('[aria-label="Tirar o filtro Abaixo do mínimo"]')).toBeNull();

    await clicar(painel().querySelector<HTMLElement>('[role="radio"][value="ativos"]')!);
    expect(porNome<HTMLSelectElement>("Filtrar por saldo").disabled).toBe(false);
    expect(porNome<HTMLSelectElement>("Filtrar por saldo").value).toBe("todos");
    expect(resultado()).toBe("2 itens encontrados");
    expect(cards()[0]?.textContent).not.toContain("antiga");
  });

  it("limpar reinicia busca, saldo, tipos e a busca de tipos, preservando ordem, lista e preferência de tamanhos", async () => {
    await abrir();
    await selecionar("Ordenar produtos", "nome");
    await clicar(document.querySelector<HTMLElement>('[role="switch"]')!);
    await clicar(botao("Lista"));
    await preencher("Buscar por nome ou código", "azul");
    await selecionar("Filtrar por saldo", "baixo");
    await abrirFiltros();
    await clicar(controleDoRotulo("Polo", painel()));
    await clicar(botao("Ver mais tipos", painel()));
    await preencher("Buscar tipo de produto", "polo", painel());
    await clicar(botao("Limpar filtros", painel()));

    expect(porNome<HTMLInputElement>("Buscar por nome ou código").value).toBe("");
    expect(porNome<HTMLSelectElement>("Filtrar por saldo").value).toBe("todos");
    expect(porNome<HTMLInputElement>("Buscar tipo de produto", painel()).value).toBe("");
    expect(controleDoRotulo("Todos os tipos", painel()).getAttribute("aria-checked")).toBe("true");
    expect(botao("Ver mais tipos", painel()).getAttribute("aria-expanded")).toBe("false");
    expect(porNome<HTMLSelectElement>("Ordenar produtos").value).toBe("nome");
    expect(botao("Lista").getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelectorAll("tbody tr")).toHaveLength(10);
    expect(resultado()).toBe("10 itens encontrados");
    expect(document.querySelector('[aria-label^="Tirar o filtro"]')).toBeNull();
    await clicar(porNome("Fechar filtros", painel()));
    await clicar(botao("Grade"));
    expect(document.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("false");
    expect(cards()).toHaveLength(10);
  });

  it("a contagem é de itens mesmo com tamanhos agrupados, e ordem ou formato não contam como filtros", async () => {
    await abrir();
    expect(resultado()).toBe("10 itens encontrados");
    expect(cards()).toHaveLength(9);
    expect(porNome<HTMLSelectElement>("Ordenar produtos").value).toBe("maior-saldo");
    await selecionar("Ordenar produtos", "menor-saldo");
    await clicar(document.querySelector<HTMLElement>('[role="switch"]')!);
    expect(cards()).toHaveLength(10);
    expect(resultado()).toBe("10 itens encontrados");
    await clicar(botao("Lista"));
    expect(document.querySelectorAll("tbody tr")).toHaveLength(10);
    expect(document.querySelector('[aria-label^="Filtros,"]')).toBeNull();
    await abrirFiltros();
    expect(botao("Limpar filtros", painel()).disabled).toBe(true);
  });

  it("o painel do celular compartilha saldo e tipos com a barra e mantém o resultado ao fechar", async () => {
    await abrir();
    await abrirFiltros(true);
    await selecionar("Filtrar por saldo", "baixo", painel());
    await clicar(controleDoRotulo("Polo", painel()));
    await clicar(botao("Nome: A-Z", painel()));
    await clicar(botao("Ver resultados", painel()));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(resultado()).toBe("1 item abaixo do mínimo");
    expect(porNome<HTMLSelectElement>("Filtrar por saldo").value).toBe("baixo");
    expect(porNome<HTMLSelectElement>("Ordenar produtos").value).toBe("nome");
    expect(cards()).toHaveLength(1);
    expect(cards()[0]?.textContent).toContain("Polo azul P");
  });

  it("o pedido abre pelo cabeçalho, separado das ferramentas de resultado e de filtro", async () => {
    await abrir();
    const abrirPedido = document.querySelector<HTMLButtonElement>('[aria-label^="Abrir pedido de abastecimento"]')!;
    expect(abrirPedido).not.toBeNull();
    expect(abrirPedido.closest('[data-testid="stock-toolbar"], [data-testid="stock-results-toolbar"]')).toBeNull();
    await clicar(abrirPedido);
    expect(painel().textContent).toContain("Seu pedido");
  });
});
