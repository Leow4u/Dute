// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Anunciador } from "@/lib/carregando/anunciador";
import { ProvedorDaConexao } from "@/lib/carregando/estado-da-conexao";
import { conexaoEm } from "@/test/conexao";

/**
 * A tela da abertura e da cíclica (as abas), em /wms/contagem/abertura desde
 * 18/11/2026: com a sessão concluída, ela manda para a entrada da Contagem
 * (também logo depois de "Confirmar encerramento"); com a abertura pendente
 * ou em curso, mostra as abas; com a sessão que falha, mostra a falha e não
 * redireciona. Dados sintéticos.
 */

const estado = vi.hoisted(() => ({
  sessao: {} as Record<string, unknown>,
  falhaDaSessao: false,
  navegar: vi.fn(),
}));

vi.mock("@/lib/warehouse-ops/model", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/warehouse-ops/model")>();
  return {
    ...original,
    fetchJson: async (url: string, init?: { method?: string }) => {
      const { pathname } = new URL(url, "http://dute.local");
      await new Promise((pronto) => setTimeout(pronto, 5));
      if (pathname.startsWith("/api/warehouse/opening-inventory/session/")) {
        if (estado.falhaDaSessao) throw new Error("Falha no servidor");
        return estado.sessao;
      }
      if (pathname === "/api/skus" || pathname === "/api/products") return { items: [] };
      if (pathname === "/api/warehouse/boxes") return { items: [], has_more: false };
      if (pathname === "/api/warehouse/positions") return { items: [], has_more: false };
      throw new Error(`Chamada inesperada: ${init?.method ?? "GET"} ${url}`);
    },
  };
});
vi.mock("@/lib/active-customer-context", () => ({
  useActiveCustomer: () => ({
    code: "BTG Pactual",
    active: { code: "BTG Pactual", name: "BTG", profile: { skuPrefix: "BTG", source: "published", template: "uniformes" } },
    isLoading: false,
    falhou: false,
  }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: () => undefined }) }));
vi.mock("wouter", async (original) => ({ ...(await original<typeof import("wouter")>()), useLocation: () => ["/wms/contagem/abertura", estado.navegar] }));

import WmsInventoryPage from "./wms-inventory";

const SESSAO_ABERTA = { session_id: "opening_BTG", customer_code: "BTG Pactual", status: "open", lines: [], line_count: 3, unit_count: 12, total_cost: 0 };
const SESSAO_CONCLUIDA = { ...SESSAO_ABERTA, status: "completed", line_count: 249, unit_count: 7314, completed_at: "2026-10-20T21:40:00Z", completed_by: { name: "Leonardo" } };

let raiz: Root | null = null;
let container: HTMLDivElement;

const naTela = () => (document.body.textContent ?? "").replace(/\s+/g, " ");

async function esperar(condicao: () => boolean, oQue: string) {
  for (let volta = 0; volta < 300; volta += 1) {
    if (condicao()) return;
    await act(async () => {
      await new Promise((pronto) => setTimeout(pronto, 10));
    });
  }
  throw new Error(`Não aconteceu: ${oQue}`);
}

async function montar() {
  raiz = createRoot(container);
  await act(async () => {
    raiz!.render(
      <ProvedorDaConexao value={conexaoEm("conectado")}>
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, networkMode: "always" } } })}>
          <Anunciador />
          <WmsInventoryPage />
        </QueryClientProvider>
      </ProvedorDaConexao>,
    );
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  estado.navegar.mockReset();
  estado.sessao = SESSAO_ABERTA;
  estado.falhaDaSessao = false;
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

describe("a tela da abertura e da cíclica", () => {
  it("a sessão concluída: vai para a entrada da Contagem, uma vez", async () => {
    estado.sessao = SESSAO_CONCLUIDA;
    await montar();
    await esperar(() => estado.navegar.mock.calls.length > 0, "o redirecionamento");
    expect(estado.navegar).toHaveBeenCalledTimes(1);
    expect(estado.navegar).toHaveBeenCalledWith("/wms/contagem", { replace: true });
  });

  it("a sessão aberta: as abas, sem redirecionar", async () => {
    await montar();
    await esperar(() => Boolean(document.querySelector('[role="tablist"]')) && naTela().includes("sessão em andamento"), "as abas com a sessão lida");
    expect(estado.navegar).not.toHaveBeenCalled();
  });

  it("a sessão que falha: a falha com Tentar de novo, sem redirecionar", async () => {
    estado.falhaDaSessao = true;
    await montar();
    await esperar(() => naTela().includes("Não consegui carregar o inventário."), "a falha");
    expect(naTela()).toContain("Tentar de novo");
    expect(estado.navegar).not.toHaveBeenCalled();
  });
});
