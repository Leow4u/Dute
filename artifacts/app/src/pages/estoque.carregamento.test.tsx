// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Anunciador } from "@/lib/carregando/anunciador";
import { ProvedorDaConexao } from "@/lib/carregando/estado-da-conexao";
import { CARREGANDO } from "@/lib/carregando/tempo";
import type { StockItem } from "@/lib/stock-items";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { conexaoEm } from "@/test/conexao";
import { textosForaDaLista } from "@/test/textos";

/**
 * O Estoque na migração do carregamento v2 (parte 13b; diagnóstico, 4.4 e
 * necessidades 2 e 3). A lista só entra com o catálogo, os saldos e as fotos
 * lidos: antes, os itens apareciam com "Sem endereço" e "Sem foto" até os
 * saldos e as fotos chegarem. A leitura que falha mostra o aviso com "Tentar
 * de novo", e nunca a lista sem endereço. Parados e Sem giro ficam sem número
 * até os dias parado chegarem. Na ficha, os últimos movimentos esperam com a
 * caixa e o rótulo aos 300 ms, e a falha nunca vira "Nenhum movimento
 * registrado.". Dados sintéticos.
 */

const estado = vi.hoisted(() => ({
  atrasoMs: 100,
  atrasoPorCaminho: {} as Record<string, number>,
  falhaPorCaminho: {} as Record<string, boolean>,
}));

vi.mock("@/lib/auth", () => ({ useAppUser: () => ({ user: { uid: "u1", publicMetadata: { role: "admin" } }, isLoaded: true }) }));
vi.mock("@/lib/active-customer-context", async () => {
  const { activeCustomerOptions } = await vi.importActual<typeof import("@/lib/active-customer")>("@/lib/active-customer");
  const options = activeCustomerOptions([{ customer_code: "BTG", name: "BTG Pactual", operation_template: "uniformes", sku_prefix: "BTG" }] as never);
  return { useActiveCustomer: () => ({ active: options[0], code: "BTG", options, setCode: () => undefined, isLoading: false, codeProvavel: "BTG" }) };
});
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: () => undefined }) }));
vi.mock("@/hooks/use-desktop", () => ({ useIsDesktop: () => true }));
vi.mock("@/lib/liberacao", async (original) => ({ ...(await original<typeof import("@/lib/liberacao")>()), MEMORIA_LIBERADA: true }));
vi.mock("@/features/warehouse-ops/opening-inventory-status", () => ({
  useOpeningInventorySession: () => ({ data: undefined }),
  OpeningInventoryNotice: () => null,
}));

import Estoque, { ItemCard } from "./estoque";

const FOTO = "https://example.com/polo.jpg";

function dados(caminho: string): unknown {
  switch (caminho) {
    case "/api/skus":
      return { items: [{ sku_code: "BTG-000001", cod_cliente: "A.01.0806.005.GG", produto: "Polo Masculino Piquet Preto", tamanho: "GG", estoque_atual: 12, customer_code: "BTG" }] };
    case "/api/stock-balances":
      return { items: [{ sku_code: "BTG-000001", location_id: "B-02", qty_on_hand: 12, customer_code: "BTG" }] };
    case "/api/products":
      return { items: [{ cod_cliente: "A.01.0806.005.GG", produto: "Polo Masculino Piquet Preto", customer_code: "BTG", photo_urls: [FOTO], foto_url: FOTO }] };
    case "/api/movements":
      return { items: [{ id: "m1", tipo_mov: "ENTRADA", qtde: 12, sinal: 1, data: "2026-11-12T12:00:00.000Z", responsavel: "Ana" }] };
    default:
      return caminho.startsWith("/api/warehouse/stock-dates/") ? { locais: [] } : { items: [], has_more: false };
  }
}

async function servir(entrada: RequestInfo | URL) {
  const url = new URL(String(entrada), "http://localhost");
  await new Promise((pronto) => setTimeout(pronto, estado.atrasoPorCaminho[url.pathname] ?? estado.atrasoMs));
  if (estado.falhaPorCaminho[url.pathname]) {
    const erro = { error: "Falha no servidor" };
    return { ok: false, status: 500, json: async () => erro, text: async () => JSON.stringify(erro) };
  }
  const corpo = dados(url.pathname);
  return { ok: true, status: 200, json: async () => corpo, text: async () => JSON.stringify(corpo) };
}

let raiz: Root | null = null;
let container: HTMLDivElement;
let cliente: QueryClient;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse("2026-11-13T13:42:00Z"));
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(servir));
  estado.atrasoMs = 100;
  estado.atrasoPorCaminho = {};
  estado.falhaPorCaminho = {};
  container = document.createElement("div");
  document.body.append(container);
  cliente = new QueryClient({ defaultOptions: { queries: { retry: false, networkMode: "always", refetchOnWindowFocus: false } } });
});

afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  cliente.clear();
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function passar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function montar(conteudo: ReactNode) {
  raiz = createRoot(container);
  await act(async () => {
    raiz!.render(
      <ProvedorDaConexao value={conexaoEm("conectado")}>
        <QueryClientProvider client={cliente}>
          <Anunciador />
          {conteudo}
        </QueryClientProvider>
      </ProvedorDaConexao>,
    );
  });
}

/** O que se vê, sem a região viva. */
function naTela(): string {
  const copia = container.cloneNode(true) as HTMLElement;
  copia.querySelector("[data-anunciador]")?.remove();
  return (copia.textContent ?? "").replace(/\s+/g, " ");
}

/** A seção dos últimos movimentos da ficha, a parte que a espera muda (o axe olha só ela). */
function secaoDosMovimentos(): string {
  const titulo = Array.from(container.querySelectorAll("h2, h3, p, span")).find((no) => no.textContent === "Últimos movimentos");
  return titulo!.parentElement!.outerHTML;
}

/** As linhas da lista de itens, cada uma com o texto dela. */
const linhasDaLista = () => Array.from(container.querySelectorAll("button.grid")).map((linha) => (linha.textContent ?? "").replace(/\s+/g, " "));
const botaoPorTexto = (texto: string) => Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((botao) => botao.textContent?.trim() === texto);
/** A contagem do filtro, pelo rótulo do chip; nula sem número. */
function contagemDoFiltro(rotulo: string): string | null {
  const chip = Array.from(container.querySelectorAll<HTMLButtonElement>("button[aria-pressed]")).find((botao) => botao.textContent?.startsWith(rotulo));
  return chip?.querySelector(".tabular-nums")?.textContent ?? null;
}

describe("a lista do Estoque só entra lida", () => {
  it("com os saldos e as fotos ainda chegando, nunca \"Sem endereço\" nem \"Sem foto\"; depois, o endereço", async () => {
    estado.atrasoPorCaminho = { "/api/stock-balances": 3_000, "/api/products": 3_000 };
    await montar(<Estoque />);
    let antes = 0;
    for (const instante of [200, 400, 1_500, 2_800]) {
      await passar(instante - antes);
      antes = instante;
      // O catálogo já chegou; a lista espera os saldos e as fotos.
      expect(linhasDaLista(), `aos ${instante} ms`).toEqual([]);
      expect(naTela(), `aos ${instante} ms`).not.toMatch(/Sem endereço|Nenhum item/);
    }
    await passar(400);
    const [linha] = linhasDaLista();
    expect(linha).toContain("A.01.0806.005.GG");
    expect(linha).toContain("B-02");
    expect(linha).not.toMatch(/Sem endereço|Sem foto/);
  });

  it("os saldos que falham sem nada lido: o aviso com Tentar de novo, nunca a lista sem endereço", async () => {
    estado.falhaPorCaminho = { "/api/stock-balances": true };
    // As fotos ainda chegam quando a falha aparece: o botão diz "Tentar de novo", e não "Tentando de novo…".
    estado.atrasoPorCaminho = { "/api/products": 2_000 };
    await montar(<Estoque />);
    await passar(500);
    expect(naTela()).toContain("Não consegui carregar o estoque.");
    expect(botaoPorTexto("Tentar de novo")).toBeTruthy();
    expect(naTela()).not.toContain("Tentando de novo…");
    expect(linhasDaLista()).toEqual([]);
    // O axe olha a tela sem as abas: o aria-controls delas acusa desde antes desta parte (registro da parte 7b).
    const semAsAbas = container.cloneNode(true) as HTMLElement;
    semAsAbas.querySelector('[role="tablist"]')?.remove();
    const comOAviso = semAsAbas.innerHTML;

    // A nova tentativa que dá certo troca o aviso pela lista.
    estado.falhaPorCaminho = {};
    await act(async () => botaoPorTexto("Tentar de novo")!.click());
    await passar(2_000);
    expect(linhasDaLista()[0]).toContain("B-02");
    expect(naTela()).not.toContain("Não consegui carregar o estoque.");
    vi.useRealTimers();
    expect(await violacoesDeAcessibilidade(comOAviso)).toEqual([]);
  });

  it("Parados e Sem giro sem número até os dias parado chegarem", async () => {
    estado.atrasoPorCaminho = { "/api/stock-age": 3_000 };
    await montar(<Estoque />);
    await passar(800);
    expect(contagemDoFiltro("Todos")).toBe("1");
    expect(contagemDoFiltro("Parados")).toBeNull();
    expect(contagemDoFiltro("Sem giro")).toBeNull();
    await passar(2_500);
    expect(contagemDoFiltro("Parados")).toBe("0");
  });
});

const ITEM = {
  key: "000001",
  skuCode: "BTG-000001",
  clientCode: "A.01.0806.005.GG",
  name: "Polo Masculino Piquet Preto",
  detail: "GG",
  onHand: 12,
  reserved: 0,
  available: 12,
  locations: [{ id: "B-02", qty: 12 }],
  photos: [FOTO],
  low: false,
  zero: false,
  sku: {},
} as unknown as StockItem;

const TEXTOS_DA_FICHA = [
  "A.01.0806.005.GG",
  "Polo Masculino Piquet Preto",
  "GG · SKU interno BTG-000001",
  "Mais fotos",
  "Foto profissional com Agent Dute",
  "Gerenciar fotos",
  "12",
  "em estoque",
  "disponível",
  "—",
  "sem custo",
  "Onde está",
  "B-02",
  "12 un.",
  "Últimos movimentos",
  "Contar este item",
  "Editar cadastro",
  "Ajustar saldo",
];

describe("os últimos movimentos na ficha", () => {
  it("lendo: nada antes de 300 ms; depois, a caixa e \"Carregando movimentos…\", nunca o texto seco", async () => {
    estado.atrasoPorCaminho = { "/api/movements": 2_000 };
    await montar(<ItemCard item={ITEM} caixas={[]} rotuloDaCaixaParada="Parado" />);
    expect(naTela()).not.toMatch(/Carregando/);
    await passar(CARREGANDO.atrasoMs + 50);
    expect(naTela()).toContain("Carregando movimentos…");
    expect(naTela()).not.toContain("Carregando...");
    const caixa = container.querySelector("[data-carregando-na-regiao] [data-spinner]");
    expect(caixa?.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelector("[data-anunciador]")?.textContent).toContain("Carregando movimentos");
    expect(textosForaDaLista(container.innerHTML, [...TEXTOS_DA_FICHA, "Carregando movimentos…", "Carregando movimentos"])).toEqual([]);
    const lendo = secaoDosMovimentos();
    await passar(2_000);
    expect(naTela()).toMatch(/entrada · |entrada/i);
    vi.useRealTimers();
    expect(await violacoesDeAcessibilidade(lendo)).toEqual([]);
  });

  it("a leitura que falha: o aviso com Tentar de novo, nunca \"Nenhum movimento registrado.\"", async () => {
    estado.falhaPorCaminho = { "/api/movements": true };
    await montar(<ItemCard item={ITEM} caixas={[]} rotuloDaCaixaParada="Parado" />);
    await passar(500);
    expect(naTela()).not.toContain("Nenhum movimento registrado.");
    expect(naTela()).toContain("Não consegui carregar os movimentos.");
    expect(botaoPorTexto("Tentar de novo")).toBeTruthy();
    expect(textosForaDaLista(container.innerHTML, [...TEXTOS_DA_FICHA, "Não consegui carregar os movimentos.", "Tentar de novo"])).toEqual([]);
    const comOAviso = secaoDosMovimentos();
    estado.falhaPorCaminho = {};
    await act(async () => botaoPorTexto("Tentar de novo")!.click());
    await passar(500);
    expect(naTela()).toMatch(/entrada · |entrada/i);
    vi.useRealTimers();
    expect(await violacoesDeAcessibilidade(comOAviso)).toEqual([]);
  });
});
