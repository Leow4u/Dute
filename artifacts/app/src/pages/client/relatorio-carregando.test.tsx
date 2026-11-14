// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";

import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosDaTela } from "@/test/textos";

/**
 * O extrato do portal enquanto a planilha é gerada (carregamento v2, parte
 * 13f; necessidade 5). Antes: o "Baixar planilha" girava o Loader2 e ficava
 * `disabled` (o foco caía no `body`), sem dizer o que acontecia. Agora o
 * `BotaoDeAcao` diz "Gerando a planilha…" aos 300 ms, com `aria-busy`, e o
 * segundo toque não pede outra. Dados sintéticos.
 */

const estado = vi.hoisted(() => ({ pedidos: 0 }));

vi.mock("./shared", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./shared")>()),
  ClientDataBoundary: ({ children }: { children: (overview: Record<string, unknown>) => ReactNode }) =>
    children({
      customer: { code: "ACME", name: "ACME" },
      invoice_history: [
        { id: "ACME__2026-09", competencia: "2026-09", status: "emitido", total: 1000, issued_at: "2026-10-01T12:00:00Z" },
        { id: "ACME__2026-10", competencia: "2026-10", status: "emitido", total: 1200, issued_at: "2026-11-01T12:00:00Z" },
      ],
      order_tracking: [],
    }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/auth", () => ({ useAppUser: () => ({ user: { uid: "c1", fullName: "Ana Lima", publicMetadata: { role: "cliente" } } }) }));

import { ClienteRelatorio } from "./relatorio";

let raiz: Root | null = null;
let container: HTMLDivElement;

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  estado.pedidos = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      estado.pedidos += 1;
      return new Promise<Response>(() => undefined);
    }),
  );
  container = document.createElement("div");
  document.body.append(container);
  raiz = createRoot(container);
  await act(async () =>
    raiz!.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
        <Router>
          <ClienteRelatorio />
        </Router>
      </QueryClientProvider>,
    ),
  );
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

function botao(rotulo: string) {
  return [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => item.textContent?.trim() === rotulo || item.querySelector(".botao-acao-camada[data-atual]")?.textContent?.trim() === rotulo,
  );
}

describe("Baixar planilha do extrato", () => {
  it("diz 'Gerando a planilha…' aos 300 ms, sem desabilitar, e o segundo toque não pede outra", async () => {
    const baixar = botao("Baixar planilha")!;
    baixar.focus();
    await act(async () => baixar.click());
    expect(estado.pedidos).toBe(1);
    await ate(() => botao("Gerando a planilha…"));
    const andando = botao("Gerando a planilha…")!;
    expect(andando.hasAttribute("disabled")).toBe(false);
    expect(andando.getAttribute("aria-busy")).toBe("true");
    expect(document.activeElement).toBe(andando);
    expect(andando.querySelector("[data-spinner]")?.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelector(".animate-spin")).toBeNull();
    await act(async () => andando.click());
    expect(estado.pedidos).toBe(1);
    const barra = container.querySelector(".no-print")!.outerHTML;
    expect(textosDaTela(barra)).toEqual(["Faturas", "De", "Setembro/2026", "Outubro/2026", "até", "Baixar planilha", "Gerando a planilha…", "Conferir", "Salvar PDF"]);
    expect(await violacoesDeAcessibilidade(barra)).toEqual([]);
  });
});
