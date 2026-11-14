// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ClientEvent } from "@/lib/client-events";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";

/**
 * Editar evento, no portal (carregamento v2, parte 13a; diagnóstico, 4.13):
 * a janela só fecha depois do retorno. Antes, o Esc e o Cancelar fechavam
 * enquanto salvava, a janela desmontava e o aviso do mutate não chegava:
 * ninguém sabia se tinha salvado. Dados sintéticos.
 */

const estado = vi.hoisted(() => ({
  toasts: [] as unknown[],
  salvamentos: [] as Array<{ corpo: Record<string, unknown>; responder: (corpo: unknown, status?: number) => void }>,
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: (aviso: unknown) => estado.toasts.push(aviso) }) }));

import { EventEditDialog } from "./eventos";

const EVENTO: ClientEvent = {
  id: "ev_1",
  name: "Feira de Investimentos",
  description: null,
  venue: "Expo Center Norte",
  address: null,
  next_date: "2026-12-10",
  schedule: null,
  logistics: null,
  items: [{ sku_code: "BTG-000001", client_item_code: "A.01.0806.005.GG", product_name: "Polo Masculino Piquet Preto", quantity: 20 }],
};

let raiz: Root | null = null;
let container: HTMLDivElement | null = null;
let fechou = 0;

const dialogo = () => document.querySelector<HTMLElement>('[role="dialog"][data-state="open"]');

function botao(rotulo: string): HTMLButtonElement | undefined {
  return Array.from(dialogo()?.querySelectorAll<HTMLButtonElement>("button") ?? []).find(
    (item) => item.textContent?.trim() === rotulo || item.querySelector(".botao-acao-camada[data-atual]")?.textContent?.trim() === rotulo,
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

async function montar() {
  await act(async () =>
    raiz!.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
        {fechou === 0 ? <EventEditDialog event={EVENTO} onClose={() => (fechou += 1)} /> : null}
      </QueryClientProvider>,
    ),
  );
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_entrada: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? "GET").toUpperCase() !== "POST") return new Response("{}", { status: 200 });
      return new Promise<Response>((resolver) =>
        estado.salvamentos.push({
          corpo: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
          responder: (corpo, status = 200) => resolver(new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } })),
        }),
      );
    }),
  );
  estado.toasts = [];
  estado.salvamentos = [];
  fechou = 0;
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
  await montar();
});

afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  container?.remove();
  container = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("Editar evento, salvando", () => {
  it("o Esc, o toque fora, o X e o Cancelar não fecham; a janela fecha depois do retorno, com o aviso", async () => {
    await act(async () => botao("Salvar")!.click());
    await esperar(() => estado.salvamentos.length === 1 && Boolean(dialogo()?.hasAttribute("data-ocupado")), "o evento salvando");

    await act(async () => {
      (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    await act(async () => {
      document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 }));
    });
    for (const rotulo of ["Fechar", "Cancelar"]) {
      const elemento = botao(rotulo)!;
      expect(elemento.getAttribute("aria-disabled"), rotulo).toBe("true");
      expect(elemento.disabled, rotulo).toBe(false);
      await act(async () => elemento.click());
    }
    expect(fechou).toBe(0);
    expect(dialogo()).not.toBeNull();
    const html = dialogo()!.outerHTML;
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);

    await act(async () => estado.salvamentos[0].responder({ id: "ev_1", created: false, event: EVENTO }));
    await esperar(() => fechou === 1, "a janela fechada no retorno");
    expect(estado.toasts).toContainEqual({ title: "Evento salvo", description: "Feira de Investimentos" });
  });

  it("na falha, a janela fica, com o aviso, e o Cancelar volta a fechar", async () => {
    await act(async () => botao("Salvar")!.click());
    await esperar(() => estado.salvamentos.length === 1, "o evento salvando");
    await act(async () => estado.salvamentos[0].responder({ message: "Sem conexão." }, 503));
    await esperar(() => estado.toasts.length === 1, "o aviso da falha");
    expect(estado.toasts[0]).toMatchObject({ title: "Evento não salvo", variant: "destructive" });
    expect(fechou).toBe(0);
    await esperar(() => !botao("Cancelar")?.hasAttribute("aria-disabled"), "o Cancelar livre");
    await act(async () => botao("Cancelar")!.click());
    expect(fechou).toBe(1);
  });
});
