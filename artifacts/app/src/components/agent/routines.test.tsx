// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ClienteDoAgente } from "@/lib/agente/cliente";
import { ProvedorDoAgente } from "@/lib/agente/contexto";
import { Anunciador } from "@/lib/carregando/anunciador";
import { CARREGANDO } from "@/lib/carregando/tempo";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosForaDaLista } from "@/test/textos";

/**
 * As rotinas do Agent Dute no carregamento v2 (parte 12): a lista que ainda
 * lê diz "Carregando rotinas…" depois de 300 ms, com as linhas-fantasma; a
 * que falhou diz o motivo, com o "Tentar de novo", que fica na tela enquanto
 * tenta. Dados sintéticos.
 */

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: () => undefined }) }));

import { RoutinesPage } from "./routines";

/** O que a tela das rotinas pode mostrar lendo e na falha (a trava contra legenda; os modelos são do código). */
const TEXTOS: Array<string | RegExp> = [
  "Rotinas",
  'Perguntas que o Agent Dute responde sozinho no horário marcado. As respostas ficam em "Histórico das rotinas", na barra ao lado.',
  "Nova rotina",
  "Minhas rotinas",
  "Modelos",
  "Carregando rotinas…",
  "Carregando rotinas",
  "Não consegui carregar as rotinas.",
  "Tentar de novo",
  "Tentando de novo…",
];

let raiz: Root | null = null;
let container: HTMLDivElement | null = null;
let falhar = true;
let leituras = 0;

function agenteFalso(): ClienteDoAgente {
  return {
    alvo: { tipo: "wms" },
    chave: ["teste"],
    conversas: async () => ({ conversations: [] }),
    mensagens: async () => ({ messages: [] }),
    conversar: async () => ({ messages: [] }),
    rotinas: {
      listar: async () => {
        leituras += 1;
        await new Promise((ok) => setTimeout(ok, 400));
        if (falhar) throw new Error("Não consegui carregar as rotinas.");
        return { routines: [] };
      },
      salvar: async () => ({}),
      excluir: async () => ({}),
      rodar: async () => ({ conversation_id: "x" }),
    },
    anotacoes: { listar: async () => ({ notes: [] }), decidir: async () => ({}), sugerir: null, escrever: null },
    playbooks: { listar: async () => ({ playbooks: [] }), salvar: async () => ({ id: "x" }), decidir: async () => ({}), carregar: async () => ({ created: 0 }) },
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance", "Date"] });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  falhar = true;
  leituras = 0;
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
});

afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  document.body.innerHTML = "";
  container = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function abrir() {
  const consulta = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () =>
    raiz!.render(
      <QueryClientProvider client={consulta}>
        <ProvedorDoAgente cliente={agenteFalso()}>
          <RoutinesPage role="interno" onOpenConversation={() => undefined} />
        </ProvedorDoAgente>
        <Anunciador />
      </QueryClientProvider>,
    ),
  );
}

async function passar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function violacoes(html: string) {
  vi.useRealTimers();
  try {
    return await violacoesDeAcessibilidade(html);
  } finally {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance", "Date"] });
  }
}

/** Os textos da lista, sem a grade dos modelos (que só aparece com a lista lida e vazia). */
const html = () => container!.innerHTML;
const botao = (rotulo: string) => [...container!.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.trim() === rotulo);

describe("as rotinas lendo e na falha", () => {
  it("lendo: nada antes de 300 ms; depois, \"Carregando rotinas…\" e as linhas-fantasma, na lista de textos e no axe", async () => {
    await abrir();
    expect(container!.textContent).not.toContain("Carregando rotinas…");
    expect(container!.querySelector("[data-brilho]")).toBeNull();
    await passar(CARREGANDO.atrasoMs);
    expect(container!.textContent).toContain("Carregando rotinas…");
    expect(container!.querySelector("[data-brilho]")).not.toBeNull();
    expect(textosForaDaLista(html(), TEXTOS)).toEqual([]);
    expect(await violacoes(html())).toEqual([]);
  });

  it("a falha diz o motivo, e o \"Tentar de novo\" fica na tela enquanto tenta, com o foco nele", async () => {
    await abrir();
    await passar(500);
    expect(container!.textContent).toContain("Não consegui carregar as rotinas.");
    expect(textosForaDaLista(html(), TEXTOS)).toEqual([]);
    expect(await violacoes(html())).toEqual([]);
    const tentar = botao("Tentar de novo")!;
    tentar.focus();
    falhar = false;
    await act(async () => tentar.click());
    await passar(50);
    const tentando = botao("Tentando de novo…")!;
    expect(tentando).toBeDefined();
    expect(document.activeElement).toBe(tentando);
    await passar(400);
    expect(container!.textContent).not.toContain("Não consegui carregar as rotinas.");
    expect(leituras).toBe(2);
  });
});
