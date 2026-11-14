// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O cliente ativo na abertura (carregamento v2, momento 2): até a lista dos
 * clientes chegar, o provedor só confirma o cliente padrão, e o provável é o
 * escolhido neste aparelho. Quem dimensiona as linhas-fantasma lê o provável,
 * para elas não mudarem de tamanho quando a lista chega. Dados sintéticos.
 */

vi.mock("./auth", () => ({ useAppUser: () => ({ user: { uid: "pessoa_1", publicMetadata: { role: "admin" } } }) }));

import { ActiveCustomerProvider, useActiveCustomer, type ActiveCustomerState } from "./active-customer-context";
import { LEGACY_CUSTOMER_CODE, activeCustomerStorageKey } from "./active-customer";

let raiz: Root | null = null;
let container: HTMLDivElement;
let visto: ActiveCustomerState[] = [];

function Quem() {
  visto.push(useActiveCustomer());
  return null;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  visto = [];
  window.localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      await new Promise((pronto) => setTimeout(pronto, 600));
      const corpo = {
        items: [
          { customer_code: LEGACY_CUSTOMER_CODE, name: "BTG Pactual", operation_template: "uniformes", sku_prefix: "BTG" },
          { customer_code: "ACME", name: "Acme Uniformes", operation_template: "uniformes", sku_prefix: "ACM" },
        ],
      };
      return { ok: true, status: 200, json: async () => corpo, text: async () => JSON.stringify(corpo) };
    }),
  );
});

afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  container.remove();
  window.localStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("o cliente provável na abertura", () => {
  it("antes da lista dos clientes, o guardado no aparelho; depois, o ativo confirmado", async () => {
    window.localStorage.setItem(activeCustomerStorageKey("pessoa_1"), "ACME");
    const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    raiz = createRoot(container);
    await act(async () => {
      raiz!.render(
        <QueryClientProvider client={cliente}>
          <ActiveCustomerProvider>
            <Quem />
          </ActiveCustomerProvider>
        </QueryClientProvider>,
      );
    });
    const antes = visto[visto.length - 1]!;
    expect(antes.isLoading).toBe(true);
    expect(antes.code).toBe(LEGACY_CUSTOMER_CODE);
    expect(antes.codeProvavel).toBe("ACME");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });
    const depois = visto[visto.length - 1]!;
    expect(depois.isLoading).toBe(false);
    expect(depois.code).toBe("ACME");
    expect(depois.codeProvavel).toBe("ACME");
  });

  it("sem escolha guardada, o provável é o padrão desde o início", async () => {
    const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    raiz = createRoot(container);
    await act(async () => {
      raiz!.render(
        <QueryClientProvider client={cliente}>
          <ActiveCustomerProvider>
            <Quem />
          </ActiveCustomerProvider>
        </QueryClientProvider>,
      );
    });
    expect(visto[visto.length - 1]!.codeProvavel).toBe(LEGACY_CUSTOMER_CODE);
  });
});

describe("o \"Tentar de novo\" da tela que espera o cliente ativo", () => {
  it("lê de novo a lista dos clientes que ficou presa, e o ativo chega", async () => {
    window.localStorage.setItem(activeCustomerStorageKey("pessoa_1"), "ACME");
    let chamadas = 0;
    const responder = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (...args: Parameters<typeof fetch>) => {
        chamadas += 1;
        // A primeira leitura fica presa: nunca responde.
        if (chamadas === 1) return new Promise<Response>(() => undefined);
        return responder(...args);
      }),
    );
    const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    raiz = createRoot(container);
    await act(async () => {
      raiz!.render(
        <QueryClientProvider client={cliente}>
          <ActiveCustomerProvider>
            <Quem />
          </ActiveCustomerProvider>
        </QueryClientProvider>,
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(12_000);
    });
    expect(visto[visto.length - 1]!.isLoading).toBe(true);
    await act(async () => {
      void visto[visto.length - 1]!.tentar();
      await vi.advanceTimersByTimeAsync(700);
    });
    expect(chamadas).toBe(2);
    const depois = visto[visto.length - 1]!;
    expect(depois.isLoading).toBe(false);
    expect(depois.code).toBe("ACME");
  });
});
