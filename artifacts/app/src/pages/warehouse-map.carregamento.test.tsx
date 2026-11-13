// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Anunciador } from "@/lib/carregando/anunciador";
import { ProvedorDaConexao } from "@/lib/carregando/estado-da-conexao";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { conexaoEm } from "@/test/conexao";

/**
 * O Mapa na migração do carregamento v2 (parte 13b; diagnóstico, 4.7 e
 * necessidades 2, 3 e 8). A linha de estado sob o título diz "Carregando o
 * mapa…", "Atualizado às" e a falta, no lugar da faixa que empurrava o mapa.
 * Os saldos e o catálogo entram no que o mapa espera: a busca não diz
 * "Nenhuma prateleira" antes de ler. A releitura do intervalo que falha não
 * apaga o mapa (antes, ele sumia e ficava só o alerta); a primeira que falha
 * mostra o aviso com "Tentar de novo". "Verificando inventário" não é região
 * viva solta: quem fala é o Anunciador. Dados sintéticos.
 */

const estado = vi.hoisted(() => ({
  atrasoMs: 30,
  atrasoPorCaminho: {} as Record<string, number>,
  falhaPorCaminho: {} as Record<string, boolean>,
}));

vi.mock("@/lib/active-customer-context", async () => {
  const { activeCustomerOptions } = await vi.importActual<typeof import("@/lib/active-customer")>("@/lib/active-customer");
  const options = activeCustomerOptions([{ customer_code: "BTG", name: "BTG Pactual", operation_template: "uniformes", sku_prefix: "BTG" }] as never);
  return { useActiveCustomer: () => ({ active: options[0], code: "BTG", options, setCode: () => undefined, isLoading: false, codeProvavel: "BTG" }) };
});
vi.mock("@/hooks/use-desktop", () => ({ useIsDesktop: () => true }));
vi.mock("wouter", async (original) => ({ ...(await original<typeof import("wouter")>()), useLocation: () => ["/estoque/mapa", () => undefined] }));

import WarehouseMapPage from "./warehouse-map";

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
  const atraso = estado.atrasoPorCaminho[url.pathname] ?? Object.entries(estado.atrasoPorCaminho).find(([prefixo]) => url.pathname.startsWith(prefixo))?.[1] ?? estado.atrasoMs;
  await new Promise((pronto) => setTimeout(pronto, atraso));
  if (estado.falhaPorCaminho[url.pathname]) return new Response(JSON.stringify({ error: "Falha no servidor" }), { status: 500 });
  return new Response(JSON.stringify(dados(url.pathname)), { status: 200, headers: { "content-type": "application/json" } });
}

let raiz: Root | null = null;
let container: HTMLDivElement;
let cliente: QueryClient;

async function esperar(condicao: () => boolean, oQue: string) {
  for (let volta = 0; volta < 600; volta += 1) {
    if (condicao()) return;
    await act(async () => {
      await new Promise((pronto) => setTimeout(pronto, 10));
    });
  }
  throw new Error(`Não aconteceu: ${oQue}`);
}

const naTela = () => {
  const copia = container.cloneNode(true) as HTMLElement;
  copia.querySelector("[data-anunciador]")?.remove();
  return (copia.textContent ?? "").replace(/\s+/g, " ");
};
const linha = () => container.querySelector("[data-linha-de-estado]");
const botao = (rotulo: string) =>
  Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
    (item) => item.textContent?.trim() === rotulo || item.querySelector('[data-camada="repouso"]')?.textContent?.trim() === rotulo,
  );
const mapaNaTela = () => naTela().includes("Prateleiras cadastradas");

beforeEach(async () => {
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
  container = document.createElement("div");
  document.body.appendChild(container);
  cliente = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
});

afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  cliente.clear();
  container.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

async function montar() {
  raiz = createRoot(container);
  await act(async () => {
    raiz!.render(
      <ProvedorDaConexao value={conexaoEm("conectado")}>
        <QueryClientProvider client={cliente}>
          <Anunciador />
          <WarehouseMapPage />
        </QueryClientProvider>
      </ProvedorDaConexao>,
    );
  });
}

describe("o Mapa, a primeira leitura", () => {
  it("a linha de estado diz \"Carregando o mapa…\" aos 300 ms, sem região viva solta, e o mapa só entra com os saldos e o catálogo", async () => {
    estado.atrasoPorCaminho = { "/api/warehouse/positions": 2_500, "/api/stock-balances": 3_200, "/api/warehouse/opening-inventory/session/": 6_000 };
    await montar();
    expect(linha()).not.toBeNull();
    await esperar(() => /Carregando o mapa…/.test(linha()?.textContent ?? ""), "o rótulo na linha de estado");
    expect(container.querySelectorAll('[role="status"]:not([data-anunciador])')).toHaveLength(0);
    // Enquanto o mapa lê, uma caixa só: a da linha de estado.
    expect(container.querySelectorAll("[data-carregando-na-regiao]")).toHaveLength(0);
    await esperar(() => (container.querySelector("[data-anunciador]")?.textContent ?? "").length > 0, "o anúncio");
    // As posições e as caixas chegaram; os saldos, ainda não: o mapa espera.
    await esperar(() => !cliente.isFetching({ queryKey: ["warehouse-positions"] }), "as posições lidas");
    expect(mapaNaTela()).toBe(false);
    expect(naTela()).not.toMatch(/Nenhuma prateleira|Nenhuma posição/);
    await esperar(mapaNaTela, "o mapa com os saldos");
    // O mapa lido e o inventário ainda lendo: a verificação com a caixa, sem região viva solta.
    await esperar(() => naTela().includes("Verificando inventário de BTG Pactual…"), "a verificação do inventário com a caixa");
    expect(container.querySelectorAll('[role="status"]:not([data-anunciador])')).toHaveLength(0);
    // A espera sai em 180 ms e a hora entra em seguida (a troca em sequência da linha).
    await esperar(() => /^Atualizado às \d{2}:\d{2}$/.test(linha()?.textContent ?? ""), "a hora da leitura");
    expect(await violacoesDeAcessibilidade(container.innerHTML)).toEqual([]);
  });

  it("a primeira leitura que falha: o aviso com Tentar de novo; a nova tentativa traz o mapa", async () => {
    estado.falhaPorCaminho = { "/api/warehouse/positions": true };
    // Os saldos ainda chegam quando a falha aparece: o botão diz "Tentar de novo", e não "Tentando de novo…".
    estado.atrasoPorCaminho = { "/api/stock-balances": 1_500 };
    await montar();
    await esperar(() => naTela().includes("Não consegui carregar o mapa."), "o aviso da falha");
    expect(botao("Tentar de novo")).toBeTruthy();
    expect(naTela()).not.toContain("Tentando de novo…");
    expect(await violacoesDeAcessibilidade(container.innerHTML)).toEqual([]);
    estado.falhaPorCaminho = {};
    await act(async () => botao("Tentar de novo")!.click());
    await esperar(mapaNaTela, "o mapa depois da nova tentativa");
  });
});

describe("o Mapa, a releitura", () => {
  it("a releitura do intervalo que falha não apaga o mapa: a linha diz \"Não consegui atualizar\"", async () => {
    await montar();
    await esperar(mapaNaTela, "o mapa");
    estado.falhaPorCaminho = { "/api/warehouse/positions": true };
    await act(async () => {
      await cliente.invalidateQueries({ queryKey: ["warehouse-positions"] });
    });
    await esperar(() => /Não consegui atualizar/.test(linha()?.textContent ?? ""), "a falha na linha");
    expect(mapaNaTela()).toBe(true);
    expect(naTela()).not.toContain("Não foi possível carregar o mapa");
  });
});
