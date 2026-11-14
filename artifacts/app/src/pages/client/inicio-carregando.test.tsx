// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";

import { resolveOperationProfile } from "@/lib/operations";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";

/**
 * O Início do portal com as rotinas do Agent Dute que não vieram (carregamento
 * v2, parte 13f; necessidade 2). Antes: a falha da leitura das conversas
 * sumia (o aviso das rotinas devolvia nada), e a pessoa não sabia que havia o
 * que ver. Agora a falha fica dita, com "Tentar de novo". Dados sintéticos.
 */

const estado = vi.hoisted(() => ({ leituras: 0, falha: true }));

vi.mock("@/lib/auth", () => ({
  useAppUser: () => ({ user: { uid: "c1", fullName: "Cliente Teste", publicMetadata: { role: "cliente", customer_code: "ACME" } } }),
}));
vi.mock("@/lib/operation-profile", () => ({
  useOperationProfile: () => ({
    profile: resolveOperationProfile({ customer_code: "ACME", operation_template: "uniformes", modules: ["wms", "financeiro"] }),
    isLoading: false,
  }),
}));
vi.mock("./shared", async (original) => ({
  ...(await original<typeof import("./shared")>()),
  ClientDataBoundary: ({ children }: { children: (overview: object) => React.ReactNode }) => <>{children({})}</>,
}));

import { ClienteInicio } from "./inicio";

let raiz: Root | null = null;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  estado.leituras = 0;
  estado.falha = true;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      estado.leituras += 1;
      return estado.falha
        ? new Response(JSON.stringify({ message: "Falha interna" }), { status: 500 })
        : new Response(JSON.stringify({ conversations: [] }), { status: 200 });
    }),
  );
  container = document.createElement("div");
  document.body.append(container);
  raiz = createRoot(container);
});

afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  container.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

const espera = (ms: number) => act(async () => new Promise((pronto) => setTimeout(pronto, ms)));

async function ate(condicao: () => unknown, limiteMs = 3_000) {
  const fim = Date.now() + limiteMs;
  while (!condicao()) {
    if (Date.now() > fim) throw new Error("A tela não chegou ao estado esperado em 3 s.");
    await espera(20);
  }
}

describe("as rotinas do Agent Dute no Início do portal", () => {
  it("a falha fica dita, com 'Tentar de novo', e some quando a nova tentativa dá certo", async () => {
    await act(async () =>
      raiz!.render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <Router ssrPath="/portal">
            <ClienteInicio />
          </Router>
        </QueryClientProvider>,
      ),
    );
    await ate(() => container.textContent?.includes("Não foi possível carregar as rotinas do Agent Dute."));
    const aviso = [...container.querySelectorAll('[role="alert"]')].find((item) => item.textContent === "Não foi possível carregar as rotinas do Agent Dute.");
    expect(aviso).toBeTruthy();
    const tentar = [...container.querySelectorAll<HTMLButtonElement>("button")].find((botao) => botao.textContent?.trim() === "Tentar de novo")!;
    expect(await violacoesDeAcessibilidade(aviso!.parentElement!.outerHTML)).toEqual([]);
    estado.falha = false;
    const antes = estado.leituras;
    await act(async () => tentar.click());
    await ate(() => !container.textContent?.includes("Não foi possível carregar as rotinas do Agent Dute."));
    expect(estado.leituras).toBe(antes + 1);
  });
});
