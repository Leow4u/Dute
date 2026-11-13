// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";

/**
 * A leitura leve no celular (carregamento v2, parte 10; o PR 5 do celular,
 * docs/plataforma/diagnostico-carregamento.md, seções 9.1, item 5, e 9.3):
 * o shell da Armazenagem lia o armazém inteiro (`/api/warehouse/ops`, até
 * cerca de 9.900 documentos) ao abrir e a cada 60 s, em qualquer tela, só
 * para os contadores do menu lateral, que a barra do celular não mostra. No
 * celular, ele não lê nem relê; no computador, segue igual.
 */

vi.mock("@/lib/auth", () => ({
  useAppUser: () => ({ user: { uid: "u-1", publicMetadata: { role: "interno" } }, isLoaded: true }),
  useAppAuth: () => ({ signOut: () => undefined }),
}));
vi.mock("@/lib/operation-profile", () => ({ useOperationProfile: () => ({ profile: null, isLoading: false }) }));
vi.mock("@/hooks/use-atalho-do-agente", () => ({ useAtalhoDoAgente: () => undefined }));
vi.mock("@/components/layout/active-customer-switcher", () => ({ ActiveCustomerSwitcher: () => null }));
vi.mock("@/components/layout/account-menu", () => ({ AccountMenu: () => null }));
vi.mock("@/lib/active-customer-context", () => ({ useActiveCustomer: () => ({ code: "BTG", isLoading: false }) }));

import WmsLayout from "./wms-layout";

const leituras: string[] = [];
let raiz: Root | null = null;
let container: HTMLDivElement;
let cliente: QueryClient;

/** A largura da tela, para o matchMedia do jsdom (que não existe). */
function naLargura(largura: number) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((consulta: string) => {
      const minimo = Number(consulta.match(/min-width:\s*(\d+)px/)?.[1] ?? 0);
      const maximo = Number(consulta.match(/max-width:\s*(\d+)px/)?.[1] ?? Number.POSITIVE_INFINITY);
      return {
        matches: largura >= minimo && largura <= maximo,
        media: consulta,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        onchange: null,
        dispatchEvent: () => false,
      };
    }),
  );
  Object.defineProperty(window, "innerWidth", { configurable: true, value: largura });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  leituras.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (entrada: RequestInfo | URL) => {
      const url = new URL(String(entrada), "http://localhost");
      leituras.push(url.pathname);
      const corpo = url.pathname === "/api/warehouse/ops" ? { alerts: [], queues: {} } : { items: [] };
      return new Response(JSON.stringify(corpo), { status: 200, headers: { "content-type": "application/json" } });
    }),
  );
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

async function montar() {
  raiz = createRoot(container);
  await act(async () => {
    raiz!.render(
      <QueryClientProvider client={cliente}>
        <Router ssrPath="/wms/catalogo">
          <WmsLayout>
            <p>Tela que não lê o armazém</p>
          </WmsLayout>
        </Router>
      </QueryClientProvider>,
    );
  });
}

const doArmazem = () => leituras.filter((caminho) => caminho === "/api/warehouse/ops").length;

describe("o shell da Armazenagem e a leitura do armazém", () => {
  it("no celular (390 px), o shell não lê o armazém ao abrir nem a cada 60 s: a barra do celular não mostra os contadores", async () => {
    naLargura(390);
    await montar();
    await passar(1_000);
    expect(doArmazem()).toBe(0);
    await passar(3 * 60_000);
    expect(doArmazem()).toBe(0);
  });

  it("no computador, o menu lateral mostra os contadores: o shell lê o armazém ao abrir e relê a cada 60 s", async () => {
    naLargura(1440);
    await montar();
    await passar(1_000);
    expect(doArmazem()).toBe(1);
    await passar(60_000);
    expect(doArmazem()).toBe(2);
  });
});
