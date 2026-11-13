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
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosForaDaLista } from "@/test/textos";

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

/** O que a tela de anotações pode mostrar, nos estados da leitura e da decisão (a trava contra legenda). */
const TEXTOS_DAS_ANOTACOES: Array<string | RegExp> = [
  "Anotações do Agent Dute",
  "O que o agente sugeriu lembrar nas conversas. Só passa a valer depois de aprovado.",
  "Carregando anotações…",
  "Carregando anotações",
  /^Para aprovar( · \d+)?$/,
  /^Valendo( · \d+)?$/,
  "Nenhuma sugestão esperando.",
  "Nenhuma anotação valendo ainda.",
  "A BTG pede a entrega na portaria até as 10h.",
  "Nas NFs de uniformes, contar por tamanho.",
  /^Sugerida por /,
  /^Na conversa d/,
  "Quem o agente considera",
  "Cliente e equipe",
  "Só equipe",
  "Recusar",
  "Recusando…",
  "Recusada",
  "Não recusada",
  "Aprovar",
  "Aprovando…",
  "Aprovada",
  "Não aprovada",
  "Conferir",
  "Conferindo…",
  "Sem conexão.",
  "Reconectando…",
  "Tentar de novo",
  "Tentando de novo…",
  "Não foi possível carregar as anotações.",
];

/** O axe usa o relógio de verdade; os relógios falsos voltam depois. */
async function violacoesNoRelogioDeVerdade(html: string) {
  vi.useRealTimers();
  try {
    return await violacoesDeAcessibilidade(html);
  } finally {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance", "Date"] });
  }
}

describe("as anotações nos estados da leitura e da decisão, depois da revisão", () => {
  it("as linhas-fantasma entram aos 300 ms, com o rótulo: antes, o lugar fica guardado e vazio", async () => {
    await mostrar(agenteFalso({ listarNotas: () => new Promise(() => undefined) }), <AgentNotes />);
    expect(container!.querySelector("[data-brilho]")).toBeNull();
    expect(container!.querySelector("[data-fantasmas-guardados]")?.className).toContain("invisible");
    await passar(CARREGANDO.atrasoMs);
    expect(container!.querySelector("[data-brilho]")).not.toBeNull();
    expect(container!.querySelector("[data-fantasmas-guardados]")).toBeNull();
    expect(textosForaDaLista(container!.innerHTML, TEXTOS_DAS_ANOTACOES)).toEqual([]);
    expect(await violacoesNoRelogioDeVerdade(container!.innerHTML)).toEqual([]);
  });

  it("o \"Tentar de novo\" da lista que falhou fica na tela enquanto tenta, com o foco nele", async () => {
    let falhar = true;
    const listarNotas = vi.fn(async () => {
      await new Promise((ok) => setTimeout(ok, 400));
      if (falhar) throw new Error("Não foi possível carregar as anotações.");
      return { notes: NOTAS };
    });
    await mostrar(agenteFalso({ listarNotas }), <AgentNotes />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(textosForaDaLista(container!.innerHTML, TEXTOS_DAS_ANOTACOES)).toEqual([]);
    expect(await violacoesNoRelogioDeVerdade(container!.innerHTML)).toEqual([]);
    const tentar = [...container!.querySelectorAll<HTMLButtonElement>("button")].find((botao) => botao.textContent?.trim() === "Tentar de novo")!;
    tentar.focus();
    falhar = false;
    await act(async () => tentar.click());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    const tentando = [...container!.querySelectorAll<HTMLButtonElement>("button")].find((botao) => botao.textContent?.trim() === "Tentando de novo…")!;
    expect(tentando).toBeDefined();
    expect(tentando.getAttribute("aria-busy")).toBe("true");
    expect(document.activeElement).toBe(tentando);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(container!.textContent).toContain("A BTG pede a entrega");
  });

  it("a decisão em andamento e a falta de conexão passam na lista de textos e no axe", async () => {
    const decidir = vi.fn(() => new Promise(() => undefined));
    await mostrar(agenteFalso({ decidirNota: decidir }), <AgentNotes />);
    await act(async () => botoes("Aprovar")[0].click());
    await passar(CARREGANDO.atrasoMs);
    expect(textosForaDaLista(container!.innerHTML, TEXTOS_DAS_ANOTACOES)).toEqual([]);
    expect(await violacoesNoRelogioDeVerdade(container!.innerHTML)).toEqual([]);

    act(() => raiz!.unmount());
    raiz = createRoot(container!);
    await mostrar(agenteFalso({ listarNotas: () => Promise.reject(new SemConexao()) }), <AgentNotes />);
    await passar(0);
    expect(textosForaDaLista(container!.innerHTML, TEXTOS_DAS_ANOTACOES)).toEqual([]);
    expect(await violacoesNoRelogioDeVerdade(container!.innerHTML)).toEqual([]);
  });

  it("no celular, as ações da linha têm 48 px, com 8 px entre Recusar e Aprovar (seção 7)", async () => {
    await mostrar(agenteFalso(), <AgentNotes />);
    for (const botao of [...botoes("Recusar"), ...botoes("Aprovar")]) expect(botao.className).toMatch(/\bmax-md:min-h-12\b/);
    expect(botoes("Aprovar")[0].parentElement!.className).toMatch(/\bgap-2\b/);
  });
});

describe("os playbooks nos estados da leitura, depois da revisão", () => {
  it("no celular, as ações da linha têm 48 px", async () => {
    await mostrar(agenteFalso(), <AgentPlaybooks />);
    for (const botao of [...botoes("Recusar"), ...botoes("Aprovar")]) expect(botao.className).toMatch(/\bmax-md:min-h-12\b/);
  });
});
