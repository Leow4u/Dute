// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { faturaDoFinanceiro } from "@/lib/financeiro/faturas";

/**
 * As releituras do Financeiro (carregamento v2, revisão da parte 13g): a nova
 * tentativa das fontes da via da NF, lidas por consulta, fica na falha até
 * elas responderem; o react-query volta a consulta sem dado a "pending" e
 * zerava o erro, e o aviso saía da tela com o foco nele, de volta à espera.
 * Dados sintéticos; nada fala com a nuvem.
 */

const NF = "fat_000000000000000000000001";
const estado = vi.hoisted(() => ({ lidas: 0, falhar: true, responder: null as null | ((dados: unknown) => void) }));

vi.mock("@/lib/operacao/leitura", async (original) => {
  const real = await original<typeof import("@/lib/operacao/leitura")>();
  return {
    ...real,
    useDocumento: () => ({ item: (globalThis as unknown as { __nf: unknown }).__nf, erro: false, tentando: false, tentar: () => undefined }),
  };
});
vi.mock("@/lib/financeiro/ler-documento", () => ({
  lerDocumento: () => {
    estado.lidas += 1;
    if (estado.falhar) return Promise.reject(new Error("permission-denied"));
    return new Promise((pronto) => (estado.responder = pronto));
  },
}));

import FinanceiroNfPage from "@/pages/financeiro/nf";

let raiz: Root | null = null;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  estado.lidas = 0;
  estado.falhar = true;
  estado.responder = null;
  window.history.replaceState({}, "", `/financeiro/nf?nf=${NF}`);
  (globalThis as unknown as { __nf: unknown }).__nf = faturaDoFinanceiro(NF, {
    customer_code: "ITAU",
    customer_name: "Itaú",
    status: "emitida",
    valor_cents: 1000,
    recebido_cents: 0,
    nf: { numero: "1234", serie: "1", emitida_em: "2026-10-01" },
    vencimento: "2026-11-30",
    forma: "boleto",
    demandas: [{ numero: "10045", valor_cents: 1000 }],
  });
  container = document.createElement("div");
  document.body.append(container);
  raiz = createRoot(container);
});

afterEach(() => {
  act(() => raiz?.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const espera = (ms: number) => act(async () => new Promise((pronto) => setTimeout(pronto, ms)));
const alerta = () => container.querySelector('[role="alert"]')?.textContent ?? null;

describe("a via comercial da NF: a nova tentativa das fontes", () => {
  it("a falha fica na tela, com o botão e o foco nele, até a nova leitura responder; a resposta traz a via", async () => {
    const cliente = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });
    await act(async () =>
      raiz!.render(
        <QueryClientProvider client={cliente}>
          <FinanceiroNfPage />
        </QueryClientProvider>,
      ),
    );
    for (let i = 0; i < 30 && !alerta(); i += 1) await espera(20);
    expect(alerta()).toBe("Não foi possível carregar a NF.");
    const botao = [...container.querySelectorAll("button")].find((item) => item.textContent?.includes("Tentar de novo"))!;
    botao.focus();
    estado.falhar = false;
    await act(async () => botao.click());
    await espera(10);
    expect(alerta()).toBe("Não foi possível carregar a NF.");
    expect(container.querySelector("[data-carregando-na-regiao]")).toBeNull();
    expect(document.body.contains(botao)).toBe(true);
    expect(document.activeElement).toBe(botao);

    await act(async () => estado.responder?.({ numero: "10045" }));
    for (let i = 0; i < 30 && alerta(); i += 1) await espera(20);
    expect(alerta()).toBeNull();
    expect(document.activeElement).not.toBe(document.body);
  });
});
