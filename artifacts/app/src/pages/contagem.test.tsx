// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Anunciador } from "@/lib/carregando/anunciador";
import { ProvedorDaConexao } from "@/lib/carregando/estado-da-conexao";
import { conexaoEm } from "@/test/conexao";

/**
 * Estoque › Contagem, a page da entrada (desenho de 18/11/2026): a sessão
 * concluída abre a entrada com a abertura em "Anteriores"; a pendente ou em
 * curso manda para a tela de hoje (/wms/contagem/abertura); a que ainda lê não
 * redireciona nem afirma; a que falha mostra a falha, nunca redireciona. As
 * leituras da rodada vêm vazias e prontas; a sessão é o que cada teste diz.
 */

type Sessao = {
  data: Record<string, unknown> | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
};

const estado = vi.hoisted(() => ({
  sessao: { data: undefined, isLoading: true, isError: false, error: null } as Sessao,
  navegar: vi.fn(),
}));

vi.mock("@/features/warehouse-ops/opening-inventory-status", () => ({
  useOpeningInventorySession: () => ({
    ...estado.sessao,
    isFetching: estado.sessao.isLoading,
    dataUpdatedAt: estado.sessao.data ? 1 : 0,
    errorUpdatedAt: estado.sessao.isError ? 1 : 0,
    errorUpdateCount: estado.sessao.isError ? 1 : 0,
    refetch: async () => undefined,
  }),
}));
vi.mock("@/lib/active-customer-context", () => ({
  useActiveCustomer: () => ({ code: "BTG Pactual", active: { code: "BTG Pactual", name: "BTG" }, isLoading: false, falhou: false }),
}));
vi.mock("@/lib/warehouse-ops/use-contagem-por-caixa", () => ({
  useContagemPorCaixa: () => ({ prateleiras: [], carregando: false, falha: null, catalogoFalhou: false, leituras: [], tentar: async () => undefined }),
}));
vi.mock("@/lib/warehouse-ops/use-lista-de-separacao", () => ({
  useCaixasDoCliente: () => ({ data: [], isLoading: false, isError: false, error: null }),
}));
vi.mock("@/lib/warehouse-ops/use-recontagem", () => ({
  useLeiturasDaRodada: () => ({
    recontagens: [],
    guardas: [],
    separadas: [],
    carregando: false,
    falhou: false,
    leitura: { tentando: false, tentar: () => undefined, falta: null, lidaEm: 1 },
  }),
}));
vi.mock("wouter", async (original) => ({ ...(await original<typeof import("wouter")>()), useLocation: () => ["/wms/contagem", estado.navegar] }));

import PaginaDaContagem from "./contagem";

const CONCLUIDA = { session_id: "opening_BTG", status: "completed", line_count: 249, unit_count: 7314, completed_at: "2026-10-20T21:40:00Z", completed_by: { name: "Leonardo" } };

let raiz: Root | null = null;
let container: HTMLDivElement;

const naTela = () => {
  const copia = document.body.cloneNode(true) as HTMLElement;
  copia.querySelector("[data-anunciador]")?.remove();
  return (copia.textContent ?? "").replace(/\s+/g, " ");
};

async function montar() {
  raiz = createRoot(container);
  await act(async () => {
    raiz!.render(
      <ProvedorDaConexao value={conexaoEm("conectado")}>
        <QueryClientProvider client={new QueryClient()}>
          <Anunciador />
          <PaginaDaContagem />
        </QueryClientProvider>
      </ProvedorDaConexao>,
    );
  });
  await act(async () => {
    await new Promise((pronto) => setTimeout(pronto, 20));
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  estado.navegar.mockReset();
  estado.sessao = { data: undefined, isLoading: true, isError: false, error: null };
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  container.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("Estoque › Contagem, a page da entrada", () => {
  it("a sessão concluída: a entrada com a abertura em Anteriores, sem redirecionar", async () => {
    estado.sessao = { data: CONCLUIDA, isLoading: false, isError: false, error: null };
    await montar();
    expect(naTela()).toContain("Contagem · BTG");
    expect(naTela()).toContain("Anteriores");
    expect(naTela()).toContain("Inventário de abertura");
    expect(naTela()).toContain("20/10/2026 às 18:40 · Leonardo");
    expect(naTela()).toContain("249 lançamentos · 7.314 unidades");
    expect(estado.navegar).not.toHaveBeenCalled();
  });

  it("a sessão aberta ou pendente: vai para a tela da abertura, uma vez", async () => {
    estado.sessao = { data: { ...CONCLUIDA, status: "open" }, isLoading: false, isError: false, error: null };
    await montar();
    expect(estado.navegar).toHaveBeenCalledTimes(1);
    expect(estado.navegar).toHaveBeenCalledWith("/wms/contagem/abertura", { replace: true });
    act(() => raiz?.unmount());
    raiz = null;
    estado.navegar.mockReset();
    estado.sessao = { data: { status: "not_started", opening_required: true }, isLoading: false, isError: false, error: null };
    await montar();
    expect(estado.navegar).toHaveBeenCalledWith("/wms/contagem/abertura", { replace: true });
  });

  it("a sessão ainda lendo: nem redireciona nem afirma", async () => {
    await montar();
    expect(naTela()).toContain("Contagem · BTG");
    expect(naTela()).not.toContain("Anteriores");
    expect(estado.navegar).not.toHaveBeenCalled();
  });

  it("a sessão que falha: Tentar de novo, sem redirecionar", async () => {
    estado.sessao = { data: undefined, isLoading: false, isError: true, error: new Error("Falha no servidor") };
    await montar();
    expect(naTela()).toContain("Não consegui carregar as contagens.");
    expect(naTela()).toContain("Tentar de novo");
    expect(estado.navegar).not.toHaveBeenCalled();
  });
});
