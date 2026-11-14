// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Anunciador } from "@/lib/carregando/anunciador";
import { ProvedorDaConexao } from "@/lib/carregando/estado-da-conexao";
import { conexaoEm } from "@/test/conexao";
import { textosForaDaLista } from "@/test/textos";

/**
 * O Mapa na revisão da parte 13b (carregamento v2; necessidades 2 e 3). O
 * mapa são as posições e as caixas: os saldos esperam a primeira leitura, mas
 * a falha deles não tira o mapa, e o catálogo (os nomes da busca e do painel)
 * nem espera. A falta de conexão sem nada lido não vira o erro genérico na
 * releitura, e a releitura do intervalo (2 min) não muda o aviso, que é um
 * alerta. A situação do inventário que falha é o aviso da falha, sem botão
 * que troca de rótulo dentro de um alerta, e o foco vai à linha de estado
 * quando ele sai. Dados sintéticos.
 */

const estado = vi.hoisted(() => ({
  atrasoMs: 30,
  atrasoPorCaminho: {} as Record<string, number>,
  falhaPorCaminho: {} as Record<string, boolean>,
  faltaPorCaminho: {} as Record<string, boolean>,
}));

vi.mock("@/lib/active-customer-context", async () => {
  const { activeCustomerOptions } = await vi.importActual<typeof import("@/lib/active-customer")>("@/lib/active-customer");
  const options = activeCustomerOptions([{ customer_code: "BTG", name: "BTG Pactual", operation_template: "uniformes", sku_prefix: "BTG" }] as never);
  return { useActiveCustomer: () => ({ active: options[0], code: "BTG", options, setCode: () => undefined, isLoading: false, codeProvavel: "BTG" }) };
});
vi.mock("@/hooks/use-desktop", () => ({ useIsDesktop: () => true }));
vi.mock("wouter", async (original) => ({ ...(await original<typeof import("wouter")>()), useLocation: () => ["/estoque/mapa", () => undefined] }));

import WarehouseMapPage from "@/pages/warehouse-map";

function posicao(rua: string, n: number) {
  return { code: `${rua}-0${n}`, aisle: rua, shelf: n, length_m: 1.8, depth_m: 0.75, height_m: 0.65, capacity_boxes: 3, status: "active", customer_code: "BTG", sequence: n };
}

function dados(caminho: string): unknown {
  if (caminho === "/api/warehouse/positions") return { items: [posicao("A", 1), posicao("A", 2)], has_more: false };
  if (caminho === "/api/warehouse/boxes") {
    return { items: [{ code: "CX-000001", customer_code: "BTG", status: "stored", location_id: "A-01", length_m: 0.6, width_m: 0.4, height_m: 0.4, line_count: 1, unit_count: 12 }], has_more: false };
  }
  if (caminho === "/api/stock-balances") return { items: [{ sku_code: "BTG-000001", location_id: "A-01", qty_on_hand: 12, customer_code: "BTG" }] };
  if (caminho === "/api/skus") return { items: [{ sku_code: "BTG-000001", cod_cliente: "A.01", produto: "Polo", customer_code: "BTG" }] };
  if (caminho.startsWith("/api/warehouse/opening-inventory/session/")) return { status: "completed", session_id: "s1", lines: [] };
  return { items: [] };
}

async function servir(entrada: RequestInfo | URL) {
  const url = new URL(String(entrada), "http://localhost");
  await new Promise((pronto) => setTimeout(pronto, estado.atrasoPorCaminho[url.pathname] ?? estado.atrasoMs));
  if (estado.faltaPorCaminho[url.pathname]) {
    return new Response(JSON.stringify({ error: "Sem resposta do servidor.", code: "sem_resposta" }), { status: 503 });
  }
  const falhaPorPrefixo = Object.entries(estado.falhaPorCaminho).some(([prefixo, falha]) => falha && url.pathname.startsWith(prefixo));
  if (falhaPorPrefixo) return new Response(JSON.stringify({ error: "Falha no servidor" }), { status: 500 });
  return new Response(JSON.stringify(dados(url.pathname)), { status: 200, headers: { "content-type": "application/json" } });
}

let raiz: Root | null = null;
let container: HTMLDivElement;
let cliente: QueryClient;

const naTela = () => {
  const copia = container.cloneNode(true) as HTMLElement;
  copia.querySelector("[data-anunciador]")?.remove();
  return (copia.textContent ?? "").replace(/\s+/g, " ");
};
const alertas = () => Array.from(container.querySelectorAll('[role="alert"]')).map((no) => (no.textContent ?? "").replace(/\s+/g, " ").trim());
const mapaNaTela = () => naTela().includes("Prateleiras cadastradas");
const botaoPorTexto = (texto: string) => Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((botao) => botao.textContent?.trim() === texto);
const linha = () => container.querySelector<HTMLElement>("[data-linha-de-estado]");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse("2026-11-13T13:42:00Z"));
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(servir));
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  estado.atrasoMs = 30;
  estado.atrasoPorCaminho = {};
  estado.falhaPorCaminho = {};
  estado.faltaPorCaminho = {};
  container = document.createElement("div");
  document.body.appendChild(container);
  cliente = new QueryClient({ defaultOptions: { queries: { retry: false, networkMode: "always", refetchOnWindowFocus: false } } });
});

afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  cliente.clear();
  container.remove();
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function passar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function montar(conexao: "conectado" | "reconectando") {
  raiz = createRoot(container);
  await act(async () => {
    raiz!.render(
      <ProvedorDaConexao value={conexaoEm(conexao)}>
        <QueryClientProvider client={cliente}>
          <Anunciador />
          <WarehouseMapPage />
        </QueryClientProvider>
      </ProvedorDaConexao>,
    );
  });
}

describe("o Mapa e as leituras de apoio", () => {
  it("o catálogo que falha não tira o mapa: as prateleiras e as caixas ficam, com o aviso do catálogo", async () => {
    estado.falhaPorCaminho = { "/api/skus": true };
    await montar("conectado");
    await passar(1_000);
    expect(mapaNaTela()).toBe(true);
    expect(naTela()).toContain("A-011 cx");
    expect(naTela()).not.toContain("Não consegui carregar o mapa.");
    expect(alertas()).toEqual(["Não consegui carregar o catálogo.Tentar de novo"]);
  });

  it("os saldos que falham não tiram o mapa: o aviso dos saldos fica acima dele", async () => {
    estado.falhaPorCaminho = { "/api/stock-balances": true };
    await montar("conectado");
    await passar(1_000);
    expect(mapaNaTela()).toBe(true);
    expect(alertas()).toEqual(["Não consegui carregar os saldos das prateleiras.Tentar de novo"]);
    expect(textosForaDaLista(container.querySelector('[role="alert"]')!.outerHTML, ["Não consegui carregar os saldos das prateleiras.", "Tentar de novo"])).toEqual([]);
  });

  it("o catálogo lento não segura o mapa; a busca por nome espera o catálogo, sem dizer que nada tem", async () => {
    estado.atrasoPorCaminho = { "/api/skus": 5_000 };
    await montar("conectado");
    await passar(1_000);
    expect(mapaNaTela()).toBe(true);
    const busca = container.querySelector<HTMLInputElement>("#map-search")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(busca, "Polo");
      busca.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await passar(400);
    expect(naTela()).not.toContain("Nenhuma prateleira tem o que você buscou.");
    expect(naTela()).toContain("Carregando o catálogo…");
    await passar(4_000);
    // O catálogo chegou: a busca pelo nome acha a prateleira com o produto.
    expect(naTela()).toContain("A-01");
    expect(naTela()).not.toContain("Carregando o catálogo…");
  });
});

describe("a falha do Mapa", () => {
  it("sem conexão e sem nada lido: a releitura sozinha não troca o Reconectando pelo erro genérico", async () => {
    estado.faltaPorCaminho = { "/api/warehouse/positions": true };
    await montar("reconectando");
    await passar(500);
    expect(naTela()).toContain("Reconectando…");
    estado.atrasoPorCaminho = { "/api/warehouse/positions": 3_000 };
    await act(async () => {
      void cliente.refetchQueries({ queryKey: ["warehouse-positions", "all-pages"] }, { cancelRefetch: false });
    });
    let antes = 0;
    for (const instante of [50, 500, 1_000, 2_000, 2_900]) {
      await passar(instante - antes);
      antes = instante;
      expect(naTela(), `aos ${instante} ms`).toContain("Reconectando…");
      expect(naTela(), `aos ${instante} ms`).not.toContain("Não consegui carregar o mapa.");
      expect(alertas(), `aos ${instante} ms`).toEqual([]);
    }
  });

  it("sem ninguém tocar, a releitura do intervalo (2 min) não muda o aviso da falha", async () => {
    estado.falhaPorCaminho = { "/api/warehouse/positions": true };
    await montar("conectado");
    await passar(800);
    expect(alertas()).toEqual(["Não consegui carregar o mapa.Tentar de novo"]);
    estado.atrasoPorCaminho = { "/api/warehouse/positions": 2_000 };
    await passar(120_000 - 800 + 300);
    expect(alertas()).toEqual(["Não consegui carregar o mapa.Tentar de novo"]);
    await passar(1_000);
    expect(alertas()).toEqual(["Não consegui carregar o mapa.Tentar de novo"]);
  });

  it("a situação do inventário que falha: o aviso da falha, e o foco vai à linha de estado quando a nova tentativa dá certo", async () => {
    estado.falhaPorCaminho = { "/api/warehouse/opening-inventory/session/": true };
    await montar("conectado");
    await passar(1_000);
    expect(mapaNaTela()).toBe(true);
    const aviso = Array.from(container.querySelectorAll<HTMLElement>('[role="alert"]')).find((no) => no.textContent?.includes("inventário"))!;
    expect(textosForaDaLista(aviso.outerHTML, ["Não consegui confirmar o inventário de abertura de BTG Pactual.", "Tentar de novo"])).toEqual([]);
    // Dentro do alerta, nenhum botão de ação com as camadas que trocam de rótulo (o leitor de tela releria o alerta).
    expect(aviso.querySelector("[data-camada]")).toBeNull();
    estado.falhaPorCaminho = {};
    estado.atrasoPorCaminho = { "/api/warehouse/opening-inventory/session/BTG": 700 };
    const tentar = Array.from(aviso.querySelectorAll<HTMLButtonElement>("button")).find((botao) => botao.textContent?.trim() === "Tentar de novo")!;
    tentar.focus();
    await act(async () => tentar.click());
    await passar(400);
    // A nova tentativa da pessoa: o aviso fica, com "Tentando de novo…" e o foco no botão.
    expect(naTela()).toContain("Tentando de novo…");
    expect(document.activeElement?.textContent?.trim()).toBe("Tentando de novo…");
    await passar(1_000);
    expect(naTela()).not.toContain("Não consegui confirmar o inventário");
    expect(document.activeElement).toBe(linha());
  });

  it("a linha de estado diz \"Carregando prateleiras…\" na primeira leitura", async () => {
    estado.atrasoPorCaminho = { "/api/warehouse/positions": 2_000 };
    await montar("conectado");
    await passar(400);
    expect(linha()?.textContent).toContain("Carregando prateleiras…");
    expect(textosForaDaLista(linha()!.outerHTML, ["Carregando prateleiras…"])).toEqual([]);
  });
});
