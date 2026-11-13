// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ClienteDoAgente, NotaDoAgente } from "@/lib/agente/cliente";
import { ProvedorDoAgente } from "@/lib/agente/contexto";
import type { Playbook } from "@/lib/agent-playbooks";
import { Anunciador } from "@/lib/carregando/anunciador";
import { CARREGANDO } from "@/lib/carregando/tempo";
import { SemConexao } from "@/lib/conexao";

/**
 * As anotações e os playbooks do Agent Dute no carregamento v2: a decisão é
 * por linha (o useAcaoNaLinha da parte 6), no lugar do isPending que travava
 * todas; a lista que ainda lê diz "Carregando anotações…" depois de 300 ms; e
 * a falta de conexão mostra o aviso (parte 7a), nunca o texto cru em
 * vermelho.
 */

const toast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

import { AgentNotes } from "./agent-notes";
import { AgentPlaybooks } from "./agent-playbooks";

const NOTAS: NotaDoAgente[] = [
  { id: "n1", text: "A BTG pede a entrega na portaria até as 10h.", reason: null, visibility: "todos", status: "pending", suggested_by_name: "Guilherme", suggested_by_role: "interno", created_at: null },
  { id: "n2", text: "Nas NFs de uniformes, contar por tamanho.", reason: null, visibility: "equipe", status: "pending", suggested_by_name: "Renata", suggested_by_role: "cliente", created_at: null },
];

const PLAYBOOKS: Playbook[] = [
  { id: "p1", title: "Receber", when: "A mercadoria chegou", steps: ["Conte"], open_points: [], audience: "equipe", status: "pending", source: "inicial", use_count: 0 } as unknown as Playbook,
  { id: "p2", title: "Separar", when: "O pedido foi aprovado", steps: ["Separe"], open_points: [], audience: "equipe", status: "pending", source: "inicial", use_count: 0 } as unknown as Playbook,
];

type Pendente = { resolver: (valor?: unknown) => void; rejeitar: (erro: unknown) => void };

function agenteFalso(sobre: Partial<{ listarNotas: () => Promise<{ notes: NotaDoAgente[] }>; decidirNota: () => Promise<unknown>; decidirPlaybook: () => Promise<unknown> }> = {}): ClienteDoAgente {
  return {
    alvo: { tipo: "wms" },
    chave: ["teste"],
    conversas: async () => ({ conversations: [] }),
    mensagens: async () => ({ messages: [] }),
    conversar: async () => ({ messages: [] }),
    rotinas: { listar: async () => ({ routines: [] }), salvar: async () => ({}), excluir: async () => ({}), rodar: async () => ({ conversation_id: "x" }) },
    anotacoes: {
      listar: sobre.listarNotas ?? (async () => ({ notes: NOTAS })),
      decidir: sobre.decidirNota ?? (async () => ({})),
      sugerir: null,
      escrever: null,
    },
    playbooks: {
      listar: async () => ({ playbooks: PLAYBOOKS }),
      salvar: async () => ({ id: "x" }),
      decidir: sobre.decidirPlaybook ?? (async () => ({})),
      carregar: async () => ({ created: 0 }),
    },
  };
}

let raiz: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  toast.mockReset();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance", "Date"] });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
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

async function mostrar(cliente: ClienteDoAgente, tela: ReactNode) {
  const consulta = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () =>
    raiz!.render(
      <QueryClientProvider client={consulta}>
        <ProvedorDoAgente cliente={cliente}>{tela}</ProvedorDoAgente>
        <Anunciador />
      </QueryClientProvider>,
    ),
  );
  // O react-query avisa a tela pelo relógio (setTimeout 0).
  await passar(0);
}

async function passar(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

/** Os botões de ação de cada linha, pelo rótulo atual. */
function botoes(rotulo: string) {
  return [...container!.querySelectorAll<HTMLButtonElement>("button.botao-acao")].filter(
    (botao) => botao.querySelector(".botao-acao-camada[data-atual]")?.textContent === rotulo,
  );
}

const ocupado = (botao: HTMLButtonElement) => botao.getAttribute("aria-disabled") === "true";

describe("as anotações do Agent Dute", () => {
  it("a lista que ainda lê: nada antes de 300 ms; depois, \"Carregando anotações…\" com a caixa, sem o ícone girando", async () => {
    let chegar: (valor: { notes: NotaDoAgente[] }) => void = () => undefined;
    await mostrar(agenteFalso({ listarNotas: () => new Promise((resolver) => (chegar = resolver)) }), <AgentNotes />);
    expect(container!.textContent).not.toContain("Carregando");
    await passar(CARREGANDO.atrasoMs);
    expect(container!.textContent).toContain("Carregando anotações…");
    expect(container!.querySelector("[data-carregando-na-regiao] [data-spinner]")?.getAttribute("data-tamanho")).toBe("24");
    expect(container!.innerHTML).not.toMatch(/animate-spin|animate-pulse|Carregando\.\.\./);
    expect(container!.querySelectorAll("[data-esqueleto]").length).toBeGreaterThan(0);
    await act(async () => chegar({ notes: NOTAS }));
    await passar(0);
    expect(container!.textContent).not.toContain("Carregando anotações…");
    expect(container!.textContent).toContain("A BTG pede a entrega");
  });

  it("aprovar uma anotação deixa a outra livre; na que aprova, o Recusar fica travado, sem disabled", async () => {
    const decisoes: Pendente[] = [];
    const decidir = vi.fn(() => new Promise((resolver, rejeitar) => decisoes.push({ resolver, rejeitar })));
    await mostrar(agenteFalso({ decidirNota: decidir }), <AgentNotes />);
    const [aprovarA, aprovarB] = botoes("Aprovar");
    const [recusarA, recusarB] = botoes("Recusar");
    await act(async () => aprovarA.click());
    expect(decidir).toHaveBeenCalledTimes(1);
    expect(decidir).toHaveBeenCalledWith("n1", "approve", expect.anything());
    // O segundo toque na linha ocupada não decide de novo.
    await act(async () => recusarA.click());
    await act(async () => aprovarA.click());
    expect(decidir).toHaveBeenCalledTimes(1);
    expect(ocupado(aprovarA)).toBe(true);
    expect(ocupado(recusarA)).toBe(true);
    expect(ocupado(aprovarB)).toBe(false);
    expect(ocupado(recusarB)).toBe(false);
    expect(container!.querySelectorAll("button[disabled]")).toHaveLength(0);
    // Aos 300 ms, o gerúndio na linha tocada.
    await passar(CARREGANDO.atrasoMs);
    expect(aprovarA.getAttribute("aria-busy")).toBe("true");
    expect(aprovarA.querySelector(".botao-acao-camada[data-atual]")?.textContent).toBe("Aprovando…");
    // A outra decide ao mesmo tempo.
    await act(async () => recusarB.click());
    expect(decidir).toHaveBeenCalledTimes(2);
    expect(decidir).toHaveBeenLastCalledWith("n2", "reject", expect.anything());
    await act(async () => decisoes[0].resolver({}));
    await passar(0);
    expect(toast).toHaveBeenCalledWith({ title: "Anotação aprovada: o Agent Dute passa a considerar" });
  });

  it("sem conexão e sem nada lido, o aviso da falta no lugar da lista, com o Tentar de novo", async () => {
    await mostrar(agenteFalso({ listarNotas: () => Promise.reject(new SemConexao()) }), <AgentNotes />);
    await passar(0);
    const falta = container!.querySelector<HTMLElement>("[data-falta]");
    expect(falta).not.toBeNull();
    expect(falta!.textContent).toContain("Tentar de novo");
    expect(container!.querySelector(".text-destructive")).toBeNull();
  });
});

describe("os playbooks do Agent Dute", () => {
  it("aprovar um playbook deixa o outro livre", async () => {
    const decidir = vi.fn(() => new Promise(() => undefined));
    await mostrar(agenteFalso({ decidirPlaybook: decidir }), <AgentPlaybooks />);
    const [aprovarA, aprovarB] = botoes("Aprovar");
    const [recusarA, recusarB] = botoes("Recusar");
    await act(async () => aprovarA.click());
    expect(decidir).toHaveBeenCalledWith("p1", "approve");
    expect(ocupado(recusarA)).toBe(true);
    expect(ocupado(aprovarB)).toBe(false);
    expect(ocupado(recusarB)).toBe(false);
    expect(container!.querySelectorAll("button[disabled]")).toHaveLength(0);
    await act(async () => aprovarB.click());
    expect(decidir).toHaveBeenCalledTimes(2);
  });
});
