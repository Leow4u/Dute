// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";

import { Anunciador } from "@/lib/carregando/anunciador";
import { ProvedorDaConexao } from "@/lib/carregando/estado-da-conexao";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { conexaoEm } from "@/test/conexao";
import { textosForaDaLista } from "@/test/textos";

/**
 * O Catálogo (Produtos e SKUs) no carregamento v2 (parte 13d; diagnóstico,
 * seção 4.11 e necessidades 2, 3, 9 e 10). Antes:
 * - a primeira leitura dizia "Carregando produtos..." e "Carregando SKUs..."
 *   numa célula, com "Produtos cadastrados 0", "0 produto(s) nesta página",
 *   "Exibindo 0 de 0" e os cartões dos SKUs em 0 durante toda a leitura;
 * - nos SKUs, cada linha dizia "Sem endereço" até os saldos chegarem (e para
 *   sempre, sem aviso, quando eles falhavam);
 * - os botões de editar e de excluir de cada linha não tinham nome.
 * Relógio simulado. Dados sintéticos.
 */

const estado = vi.hoisted(() => ({
  atrasos: {} as Record<string, number>,
  falhas: new Set<string>(),
}));

vi.mock("@/lib/auth", () => ({ useAppUser: () => ({ user: { uid: "u-1", publicMetadata: { role: "admin" } }, isLoaded: true }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: () => undefined }) }));
vi.mock("@/features/warehouse-ops/opening-inventory-status", () => ({ useOpeningInventorySession: () => ({ data: { status: "completed" } }) }));

import Products from "./products";
import Skus from "./skus";

const AGORA = Date.parse("2026-11-13T13:42:00Z");
const ITENS = Array.from({ length: 4 }, (_, i) => ({
  id: i + 1,
  cod_cliente: `A.01.0806.00${i + 1}.M`,
  cod_btg: `BTG-00000${i + 1}`,
  produto: "Polo Masculino Piquet Preto",
  genero: "Masculino",
  categoria: "Uniforme",
  cor: "Preto",
  tamanho: "M",
  preco_unit: 52,
  estoque_btg: 5 + i,
  estoque_atual: 5 + i,
  custo_total: (5 + i) * 52,
}));
// Só os dois primeiros têm endereço no saldo.
const SALDOS = ITENS.slice(0, 2).map((item, i) => ({ sku_code: item.cod_btg, client_item_code: item.cod_cliente, location_id: `A-0${i + 1}` }));

async function servir(entrada: RequestInfo | URL) {
  const url = new URL(String(entrada instanceof Request ? entrada.url : entrada), "http://localhost");
  await new Promise((pronto) => setTimeout(pronto, estado.atrasos[url.pathname] ?? 30));
  const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });
  if (estado.falhas.has(url.pathname)) return json({ message: "Falha interna no servidor." }, 500);
  if (url.pathname === "/api/products" || url.pathname === "/api/skus") return json({ items: ITENS, total: ITENS.length });
  if (url.pathname === "/api/stock-balances") return json({ items: SALDOS });
  return json({ items: [] });
}

let raiz: Root | null = null;
let container: HTMLDivElement;
let cliente: QueryClient;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(AGORA);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(servir));
  estado.atrasos = {};
  estado.falhas = new Set();
  window.localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  cliente = new QueryClient({ defaultOptions: { queries: { retry: false, networkMode: "always", refetchOnWindowFocus: false } } });
});

afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  container.remove();
  cliente.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function passar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function montar(Tela: ComponentType) {
  raiz = createRoot(container);
  await act(async () => {
    raiz!.render(
      <ProvedorDaConexao value={conexaoEm("conectado")}>
        <QueryClientProvider client={cliente}>
          <Router>
            <Anunciador />
            <Tela />
          </Router>
        </QueryClientProvider>
      </ProvedorDaConexao>,
    );
  });
}

const semAnunciador = () => {
  const copia = container.cloneNode(true) as HTMLElement;
  copia.querySelector("[data-anunciador]")?.remove();
  return copia.innerHTML;
};
const texto = () => {
  const copia = container.cloneNode(true) as HTMLElement;
  copia.querySelector("[data-anunciador]")?.remove();
  return (copia.textContent ?? "").replace(/\s+/g, " ");
};
const linha = () => container.querySelector("[data-linha-de-estado]");
/** O número de cada cartão, pelo rótulo. */
const numeroDo = (rotulo: string) =>
  Array.from(container.querySelectorAll("p")).find((p) => p.textContent === rotulo)?.nextElementSibling;
const celulasSemEndereco = () => Array.from(container.querySelectorAll("td")).filter((td) => td.textContent?.trim() === "Sem endereço").length;

/** O HTML visto em cada estado, para o axe no fim do teste, com o relógio de verdade (o do jsdom dele). */
const paraOAxe: string[] = [];
async function axeDoQueVimos() {
  vi.useRealTimers();
  for (const html of paraOAxe.splice(0)) expect(await violacoesDeAcessibilidade(html)).toEqual([]);
}

describe("Produtos, antes de ler", () => {
  it("nenhum zero nem \"Carregando produtos...\": os cartões com o bloco, as linhas-fantasma aos 300 ms e \"Carregando produtos…\" na linha", async () => {
    estado.atrasos = { "/api/products": 2_000 };
    await montar(Products);
    expect(texto()).not.toMatch(/Carregando produtos\.\.\.|Produtos cadastrados ?0|0 produto\(s\) nesta página|Exibindo 0/);
    for (const rotulo of ["Produtos cadastrados", "Valor carregado", "Sem custo válido"]) {
      expect(numeroDo(rotulo)?.textContent, rotulo).toBe("");
      expect(numeroDo(rotulo)?.querySelector('[data-forma="contagem"]'), rotulo).not.toBeNull();
    }
    await passar(350);
    expect(linha()?.textContent).toContain("Carregando produtos…");
    expect(container.querySelectorAll("tr[data-fantasmas][data-visivel]").length).toBeGreaterThan(0);
    expect(container.querySelector('tbody[aria-busy="true"]')?.getAttribute("aria-describedby")).toBe(linha()?.id);
    expect(
      textosForaDaLista(semAnunciador(), [
        "Estoque", "Produtos", "Carregando produtos…", "Adicionar Produto", "Produtos cadastrados", "Valor carregado", "Sem custo válido",
        "Buscar por cod. cliente, produto, categoria, cor ou tamanho", "Filtros", "Mostrar", "Todas categorias", "Cod. cliente", "Produto",
        "Gênero", "Categoria / Grupo", "Cor / Tamanho", "Preço Unit.", "Saldo físico", "Custo Total", "Ações", "Anterior", "Próximo",
      ]),
    ).toEqual([]);
    paraOAxe.push(semAnunciador());
    await passar(2_000);
    expect(numeroDo("Produtos cadastrados")?.textContent).toBe("4");
    expect(container.querySelector("[data-fantasmas]")).toBeNull();
    await axeDoQueVimos();
  });

  it("lidos, os botões de cada linha têm nome, e o axe não acusa nada", async () => {
    await montar(Products);
    await passar(300);
    expect(container.querySelector('button[aria-label="Editar A.01.0806.001.M"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label="Excluir A.01.0806.001.M"]')).not.toBeNull();
    paraOAxe.push(semAnunciador());
    await axeDoQueVimos();
  });

  it("a leitura que falha: os cartões dizem \"—\", nunca 0", async () => {
    estado.falhas = new Set(["/api/products"]);
    await montar(Products);
    await passar(300);
    expect(texto()).toContain("Não consegui carregar os produtos.");
    expect(numeroDo("Produtos cadastrados")?.textContent).toBe("—");
  });
});

describe("SKUs e saldos", () => {
  it("antes de ler: os cartões com o bloco, \"Carregando SKUs…\" na linha e as linhas-fantasma", async () => {
    estado.atrasos = { "/api/skus": 2_000 };
    await montar(Skus);
    expect(texto()).not.toMatch(/Carregando SKUs\.\.\.|Saldo físico ?0|0 SKU\(s\)|Exibindo 0/);
    expect(numeroDo("Saldo físico")?.querySelector('[data-forma="contagem"]')).not.toBeNull();
    await passar(350);
    expect(linha()?.textContent).toContain("Carregando SKUs…");
    expect(container.querySelectorAll("tr[data-fantasmas][data-visivel]").length).toBeGreaterThan(0);
    paraOAxe.push(semAnunciador());
    await axeDoQueVimos();
  });

  it("com os saldos ainda chegando, nenhuma linha diz \"Sem endereço\": o lugar do endereço fica neutro, e \"Atenção\" com o bloco", async () => {
    estado.atrasos = { "/api/stock-balances": 2_000 };
    await montar(Skus);
    await passar(300);
    expect(texto()).toContain("BTG-000003");
    expect(celulasSemEndereco()).toBe(0);
    expect(numeroDo("Atenção")?.querySelector('[data-forma="contagem"]')).not.toBeNull();
    await passar(2_000);
    expect(celulasSemEndereco()).toBe(2);
    // Os quatro estão com o saldo baixo, e dois sem endereço.
    expect(numeroDo("Atenção")?.textContent).toBe("6");
  });

  it("os saldos que falham: o aviso diz que os endereços não vieram, com \"Tentar de novo\", e nenhuma linha afirma \"Sem endereço\"", async () => {
    estado.falhas = new Set(["/api/stock-balances"]);
    await montar(Skus);
    await passar(300);
    expect(texto()).toContain("BTG-000003");
    expect(texto()).toContain("Não consegui carregar os endereços.");
    expect(Array.from(container.querySelectorAll("button")).some((b) => b.textContent?.trim() === "Tentar de novo")).toBe(true);
    expect(celulasSemEndereco()).toBe(0);
    expect(numeroDo("Atenção")?.textContent).toBe("—");
    expect(container.querySelector('button[aria-label="Arquivar BTG-000001"]')).not.toBeNull();
    paraOAxe.push(semAnunciador());
    await axeDoQueVimos();
  });
});
