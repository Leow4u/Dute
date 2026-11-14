// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";

import type { ClientEvent } from "@/lib/client-events";

/**
 * Excluir evento, no portal (carregamento v2, parte 13a): quem fecha a
 * confirmação é o sucesso. Na falha, ela fica, com o aviso, e a pessoa tenta
 * de novo ou cancela; antes, ela fechava também na falha e só ficava o
 * toast. Dados sintéticos.
 */

const estado = vi.hoisted(() => ({
  toasts: [] as unknown[],
  exclusoes: [] as Array<{ responder: (corpo: unknown, status?: number) => void }>,
}));

const EVENTO: ClientEvent = {
  id: "ev_1",
  name: "Feira de Investimentos",
  description: null,
  venue: "Expo Center Norte",
  address: null,
  next_date: "2026-12-10",
  schedule: null,
  logistics: null,
  items: [],
};

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: (aviso: unknown) => estado.toasts.push(aviso) }) }));
vi.mock("./shared", async (importOriginal) => {
  const original = await importOriginal<typeof import("./shared")>();
  return {
    ...original,
    ClientDataBoundary: ({ children }: { children: (overview: Record<string, unknown>) => React.ReactNode }) => <>{children({})}</>,
    ClientModuleShell: ({ children }: { children: React.ReactNode }) => (
      <main>
        <h1>Eventos</h1>
        {children}
      </main>
    ),
  };
});
vi.mock("./events-api", async (importOriginal) => {
  const original = await importOriginal<typeof import("./events-api")>();
  return { ...original, useClientEvents: () => ({ isLoading: false, isError: false, data: [EVENTO] }) };
});

import { ClienteEventos } from "./eventos";

let raiz: Root | null = null;
let container: HTMLDivElement | null = null;

const confirmacao = () => document.querySelector<HTMLElement>('[role="alertdialog"]');

function botao(rotulo: string, dentro: ParentNode = document): HTMLButtonElement | undefined {
  return Array.from(dentro.querySelectorAll<HTMLButtonElement>("button")).find(
    (item) =>
      item.textContent?.trim() === rotulo ||
      item.getAttribute("aria-label") === rotulo ||
      item.querySelector(".botao-acao-camada[data-atual]")?.textContent?.trim() === rotulo,
  );
}

async function esperar(condicao: () => boolean, oQue: string) {
  for (let volta = 0; volta < 200; volta += 1) {
    if (condicao()) return;
    await act(async () => {
      await new Promise((pronto) => setTimeout(pronto, 10));
    });
  }
  throw new Error(`Não aconteceu: ${oQue}`);
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_entrada: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? "GET").toUpperCase() !== "POST") return new Response("{}", { status: 200 });
      return new Promise<Response>((resolver) =>
        estado.exclusoes.push({
          responder: (corpo, status = 200) => resolver(new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } })),
        }),
      );
    }),
  );
  estado.toasts = [];
  estado.exclusoes = [];
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
  await act(async () =>
    raiz!.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } })}>
        <Router>
          <ClienteEventos />
        </Router>
      </QueryClientProvider>,
    ),
  );
});

afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  container?.remove();
  container = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("Excluir evento", () => {
  it("na falha, a confirmação fica, com o aviso, e a nova tentativa sai dela", async () => {
    await act(async () => botao("Excluir Feira de Investimentos")!.click());
    await esperar(() => Boolean(confirmacao()), "a confirmação aberta");
    await act(async () => botao("Excluir", confirmacao()!)!.click());
    await esperar(() => estado.exclusoes.length === 1, "a exclusão enviada");
    await act(async () => estado.exclusoes[0].responder({ message: "Sem conexão." }, 503));
    await esperar(() => estado.toasts.length === 1, "o aviso da falha");
    expect(estado.toasts[0]).toMatchObject({ title: "Não foi possível excluir", variant: "destructive" });
    // Um pouco depois do aviso, a confirmação continua na tela, pronta para a nova tentativa.
    await act(async () => new Promise((pronto) => setTimeout(pronto, 50)));
    expect(confirmacao()).not.toBeNull();
    await esperar(() => !botao("Cancelar", confirmacao()!)?.hasAttribute("aria-disabled"), "o Cancelar livre");
    await act(async () => new Promise((pronto) => setTimeout(pronto, 1_050)));
    await act(async () => botao("Excluir", confirmacao()!)!.click());
    await esperar(() => estado.exclusoes.length === 2, "a nova tentativa");
    await act(async () => estado.exclusoes[1].responder({ id: "ev_1", changed: true }));
    await esperar(() => confirmacao() === null, "a confirmação fechada no sucesso");
    expect(estado.toasts).toContainEqual({ title: "Evento excluído", description: "Feira de Investimentos" });
  });
});
