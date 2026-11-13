// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Anunciador } from "@/lib/carregando/anunciador";
import { ProvedorDaConexao } from "@/lib/carregando/estado-da-conexao";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { conexaoEm } from "@/test/conexao";
import { textosForaDaLista } from "@/test/textos";

/**
 * As Etiquetas na revisão da parte 13b (carregamento v2; necessidade 2 e
 * seção 7). A caixa da abertura não tem o conteúdo próprio e lê a sessão: a
 * sessão que falha mostra o aviso, que fica na tela com o foco no "Tentar de
 * novo" enquanto tenta, e o foco vai ao resumo da impressão quando ele sai.
 * Sem rede, "Sem conexão." ou "Reconectando…", nunca o erro genérico. Os
 * textos de cada estado entram na trava contra legenda. Dados sintéticos.
 */

const estado = vi.hoisted(() => ({
  atrasoSessao: 0,
  falhaSessao: false,
  /** A sessão sem resposta: a falta de conexão. */
  faltaSessao: false,
}));

vi.mock("wouter", async (original) => ({
  ...(await original<typeof import("wouter")>()),
  useSearch: () => "caixas=CX-000001",
  useLocation: () => ["/estoque/etiquetas", () => undefined],
}));
vi.mock("@/lib/active-customer-context", () => ({ useActiveCustomer: () => ({ code: "BTG", options: [{ code: "BTG", name: "BTG Pactual" }] }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/warehouse-ops/use-volumes-do-pedido", () => ({ useVolumesDoPedido: () => ({ estado: "pronto", pedido: null, volumes: [] }) }));
vi.mock("@/lib/warehouse-ops/model", async (original) => ({
  ...(await original<typeof import("@/lib/warehouse-ops/model")>()),
  fetchJson: async (url: string) => {
    if (url.startsWith("/api/warehouse/opening-inventory/session/")) {
      await new Promise((pronto) => setTimeout(pronto, estado.atrasoSessao));
      if (estado.faltaSessao) {
        const { SemResposta } = await import("@/lib/conexao");
        throw new SemResposta();
      }
      if (estado.falhaSessao) throw new Error("Falha no servidor");
      return { session_id: "sessao-1", status: "in_progress", lines: [{ id: "l1", box_code: "CX-000001", sku_code: "BTG-000001", client_item_code: "A.01", product_name: "Polo", counted_qty: 5 }] };
    }
    if (url.startsWith("/api/warehouse/boxes?")) return { items: [CAIXA] };
    throw new Error(`API inesperada: ${url}`);
  },
}));

import WarehouseLabelsPage from "@/pages/warehouse-labels";

// A caixa da abertura: guardada, sem o conteúdo próprio (lê a sessão).
const CAIXA = {
  code: "CX-000001",
  customer_code: "BTG",
  status: "stored",
  location_id: "B-09",
  session_id: "sessao-1",
  length_m: 0.4,
  width_m: 0.6,
  height_m: 0.35,
  unit_count: 5,
};

let root: Root;
let container: HTMLDivElement;
let client: QueryClient;

const naTela = () => {
  const copia = container.cloneNode(true) as HTMLElement;
  copia.querySelector("[data-anunciador]")?.remove();
  return (copia.textContent ?? "").replace(/\s+/g, " ");
};
const botao = (rotulo: string) => Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((item) => item.textContent?.trim() === rotulo);

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  estado.atrasoSessao = 0;
  estado.falhaSessao = false;
  estado.faltaSessao = false;
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  client.clear();
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function passar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function abrir(conexao: "conectado" | "reconectando" = "conectado") {
  await act(async () =>
    root.render(
      <ProvedorDaConexao value={conexaoEm(conexao)}>
        <QueryClientProvider client={client}>
          <Anunciador />
          <WarehouseLabelsPage />
        </QueryClientProvider>
      </ProvedorDaConexao>,
    ),
  );
}

/** O que a tela das etiquetas pode mostrar fora da prévia, em cada estado da leitura (a trava contra legenda). */
const TEXTOS = ["Contagem", "Etiquetas", "Imprimir / Salvar PDF", "Saída", "Folha A4"];

describe("Etiquetas, a sessão que falha", () => {
  it("o aviso fica com o foco no Tentar de novo enquanto tenta, e o foco vai ao resumo quando a prévia chega", async () => {
    estado.falhaSessao = true;
    await abrir();
    await passar(100);
    expect(naTela()).toContain("Não consegui carregar as etiquetas.");
    expect(textosForaDaLista(container.innerHTML, [...TEXTOS, "Não consegui carregar as etiquetas.", "Tentar de novo"])).toEqual([]);
    const tentar = botao("Tentar de novo")!;
    tentar.focus();
    estado.falhaSessao = false;
    estado.atrasoSessao = 3_000;
    await act(async () => tentar.click());
    let antes = 0;
    for (const instante of [50, 500, 1_500, 2_900]) {
      await passar(instante - antes);
      antes = instante;
      expect(naTela(), `aos ${instante} ms`).toContain("Não consegui carregar as etiquetas.");
      expect(naTela(), `aos ${instante} ms`).not.toContain("Carregando etiquetas…");
      expect(document.activeElement, `aos ${instante} ms`).not.toBe(document.body);
    }
    expect(naTela()).toContain("Tentando de novo…");
    await passar(500);
    expect(container.querySelector(".lbl-print")).not.toBeNull();
    // O aviso saiu com o foco nele: o foco vai ao resumo da impressão, nunca ao body (2.4.3).
    expect(document.activeElement?.id).toBe("etiquetas-resumo");
    expect(document.activeElement?.textContent).toBe("1 etiqueta · 1 folha · 1 caixa");
  });

  it("sem rede e sem nada lido: \"Reconectando…\", nunca o erro genérico", async () => {
    estado.faltaSessao = true;
    await abrir("reconectando");
    await passar(100);
    expect(naTela()).toContain("Reconectando…");
    expect(naTela()).not.toContain("Não consegui carregar as etiquetas.");
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(0);
    expect(textosForaDaLista(container.innerHTML, [...TEXTOS, "Reconectando…", "Tentar de novo"])).toEqual([]);
    vi.useRealTimers();
    expect(await violacoesDeAcessibilidade(container.innerHTML)).toEqual([]);
  });

  it("lendo: \"Carregando etiquetas…\" aos 300 ms, só com os textos da lista", async () => {
    estado.atrasoSessao = 2_000;
    await abrir();
    await passar(400);
    expect(textosForaDaLista(container.innerHTML, [...TEXTOS, "Carregando etiquetas…", "Carregando etiquetas"])).toEqual([]);
    expect(naTela()).toContain("Carregando etiquetas…");
  });
});
