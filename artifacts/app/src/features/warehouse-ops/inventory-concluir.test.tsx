// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Concluir o inventário de abertura (carregamento v2, parte 13a): quem fecha o
 * diálogo é o sucesso. Antes, ele só sumia porque a aba virava "Contagem
 * cíclica" com a sessão concluída; com a aba escolhida à mão, ele ficava
 * aberto depois do sucesso, com "Confirmar encerramento" ativo de novo.
 * Aqui a área de abertura está sozinha, sem as abas. Dados sintéticos.
 */

const estado = vi.hoisted(() => ({ concluida: false, conclusoes: 0 }));

vi.mock("@/lib/warehouse-ops/model", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/warehouse-ops/model")>();
  return {
    ...original,
    fetchJson: async (url: string, init?: { method?: string }) => {
      const { pathname } = new URL(url, "http://dute.local");
      if (pathname === "/api/warehouse/opening-inventory/session/complete" && init?.method === "POST") {
        estado.conclusoes += 1;
        estado.concluida = true;
        return { session_id: "abertura-1", customer_code: "BTG Pactual", status: "completed", lines: [], line_count: 2, unit_count: 30, total_cost: 0 };
      }
      if (pathname.startsWith("/api/warehouse/opening-inventory/session/")) {
        return {
          session_id: "abertura-1",
          customer_code: "BTG Pactual",
          status: estado.concluida ? "completed" : "open",
          lines: [],
          line_count: 2,
          unit_count: 30,
          total_cost: 0,
        };
      }
      if (pathname === "/api/skus") return { items: [] };
      if (pathname === "/api/products") return { items: [] };
      if (pathname === "/api/warehouse/boxes" || pathname === "/api/warehouse/positions") return { items: [], has_more: false };
      throw new Error(`Chamada inesperada: ${init?.method ?? "GET"} ${url}`);
    },
  };
});

vi.mock("@/lib/active-customer-context", () => ({
  useActiveCustomer: () => ({
    code: "BTG Pactual",
    active: { code: "BTG Pactual", name: "BTG Pactual", profile: { skuPrefix: "BTG", source: "published", template: "uniformes" } },
    isLoading: false,
  }),
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: () => undefined }) }));

import { OpeningInventoryWorkspace } from "./inventory";

let raiz: Root | null = null;
let container: HTMLDivElement | null = null;
let client: QueryClient;

async function esperar(condicao: () => boolean, oQue: string) {
  for (let volta = 0; volta < 200; volta += 1) {
    if (condicao()) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
  throw new Error(`Não aconteceu: ${oQue}`);
}

function botao(texto: string, dentro: ParentNode = document) {
  return Array.from(dentro.querySelectorAll<HTMLButtonElement>("button")).find(
    (elemento) => elemento.textContent?.trim() === texto || elemento.querySelector(".botao-acao-camada[data-atual]")?.textContent?.trim() === texto,
  );
}

const dialogo = () => document.querySelector<HTMLElement>('[role="dialog"]');

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  estado.concluida = false;
  estado.conclusoes = 0;
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
  await act(async () => raiz!.render(<QueryClientProvider client={client}><OpeningInventoryWorkspace /></QueryClientProvider>));
});

afterEach(() => {
  act(() => raiz?.unmount());
  client.clear();
  vi.unstubAllGlobals();
  container?.remove();
  raiz = null;
  container = null;
  document.body.innerHTML = "";
});

describe("Concluir o inventário de abertura", () => {
  it("o sucesso fecha o diálogo, também sem a troca da aba", async () => {
    await esperar(() => Boolean(botao("Concluir inventário")) && !botao("Concluir inventário")!.disabled, "o Concluir inventário livre");
    await act(async () => botao("Concluir inventário")!.click());
    await esperar(() => Boolean(dialogo()), "o diálogo aberto");
    await act(async () => botao("Confirmar encerramento", dialogo()!)!.click());
    await esperar(() => estado.conclusoes === 1, "a conclusão enviada");
    await esperar(() => dialogo() === null, "o diálogo fechado no sucesso");
    expect(estado.conclusoes).toBe(1);
  });
});
