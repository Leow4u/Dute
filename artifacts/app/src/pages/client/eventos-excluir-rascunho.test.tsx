// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

import { EDICOES, EVENTOS, PRECOS, RASCUNHO } from "@/test/eventos-lista";

/**
 * Excluir o rascunho, na lista do portal (carregamento v2, parte 13a): quem
 * fecha a confirmação é o sucesso. Na falha, ela fica, com o aviso, e a nova
 * tentativa repete a mesma chave. Relógio falso; dados sintéticos.
 */

const estado = vi.hoisted(() => ({
  toasts: [] as Array<Record<string, unknown>>,
  exclusoes: [] as Array<{ entrada: Record<string, unknown>; resolver: (resultado: unknown) => void; rejeitar: (erro: unknown) => void }>,
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: (aviso: Record<string, unknown>) => estado.toasts.push(aviso) }) }));
vi.mock("@/lib/auth", () => ({ useAppUser: () => ({ user: { publicMetadata: { customer_code: "BTG", role: "cliente" } }, isLoaded: true }) }));
vi.mock("@/lib/operation-profile", () => ({ useOperationProfile: () => ({ profile: { modules: ["wms"] } }) }));
vi.mock("@/lib/wms/eventos", () => ({
  cancelarEdicao: (entrada: Record<string, unknown>) => new Promise((resolver, rejeitar) => estado.exclusoes.push({ entrada, resolver, rejeitar })),
}));
vi.mock("@/lib/eventos/use-eventos", async () => {
  const lista = await import("@/test/eventos-lista");
  const aoVivo = { erro: false, tentando: false, tentar: () => undefined, falta: null, lidaEm: null };
  return {
    useEventosDoCliente: () => ({ ...aoVivo, itens: lista.EVENTOS }),
    useEdicoesDoCliente: () => ({ ...aoVivo, itens: lista.EDICOES }),
    usePrecosDoCliente: () => ({ ...aoVivo, itens: lista.PRECOS }),
    useEdicaoDoEvento: () => ({ ...aoVivo, edicao: undefined }),
  };
});
vi.mock("./shared", async (importOriginal) => {
  const original = await importOriginal<typeof import("./shared")>();
  return {
    ...original,
    ClientDataBoundary: ({ children }: { children: (overview: Record<string, unknown>) => React.ReactNode }) => <>{children({})}</>,
  };
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

async function avancar(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  estado.toasts = [];
  estado.exclusoes = [];
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
  const memoria = memoryLocation({ path: "/portal/eventos" });
  await act(async () =>
    raiz!.render(
      <Router hook={memoria.hook} searchHook={memoria.searchHook}>
        <ClienteEventos />
      </Router>,
    ),
  );
});

afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  container?.remove();
  container = null;
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Excluir rascunho", () => {
  it("na falha, a confirmação fica, com o aviso, e a nova tentativa sai dela com a mesma chave; no sucesso, fecha", async () => {
    expect(EVENTOS.length && EDICOES.length && PRECOS.length).toBeTruthy();
    await act(async () => botao("Excluir rascunho")!.click());
    expect(confirmacao()?.textContent).toContain("Excluir o rascunho de Encontro de Parceiros?");
    await act(async () => botao("Excluir", confirmacao()!)!.click());
    expect(estado.exclusoes).toHaveLength(1);
    expect(estado.exclusoes[0].entrada).toMatchObject({ id: RASCUNHO.id });
    await act(async () => estado.exclusoes[0].rejeitar(new Error("Sem conexão.")));
    expect(estado.toasts.at(-1)).toMatchObject({ title: "Não foi possível excluir", variant: "destructive" });
    await avancar(1_100);
    expect(confirmacao()).not.toBeNull();
    await act(async () => botao("Excluir", confirmacao()!)!.click());
    expect(estado.exclusoes).toHaveLength(2);
    expect(estado.exclusoes[1].entrada.idempotency_key).toBe(estado.exclusoes[0].entrada.idempotency_key);
    await act(async () => estado.exclusoes[1].resolver({ id: RASCUNHO.id, resultado: "excluida" }));
    await avancar(400);
    expect(confirmacao()).toBeNull();
    expect(estado.toasts.at(-1)).toEqual({ title: "Rascunho excluído", description: "Encontro de Parceiros" });
  });
});
