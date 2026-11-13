// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Anunciador } from "@/lib/carregando/anunciador";
import { CARREGANDO } from "@/lib/carregando/tempo";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosForaDaLista } from "@/test/textos";

/**
 * O painel antigo do Agent Dute (ai-control) no carregamento v2 (parte 12):
 * lendo, o título e "Carregando o painel…" com os blocos; a leitura que
 * falhou mostra o motivo com o "Tentar de novo", que fica na tela enquanto
 * tenta, com o foco nele. Dados sintéticos.
 */

vi.mock("@/lib/auth", () => ({
  useAppUser: () => ({ user: { uid: "u1", publicMetadata: { role: "admin" } }, isLoaded: true }),
}));
vi.mock("@/lib/active-customer-context", () => ({
  useActiveCustomer: () => ({ code: "BTG Pactual", active: { code: "BTG Pactual", name: "BTG Pactual" }, options: [], isLoading: false }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: () => undefined }) }));

import AiControl from "./ai-control";

const respostas = vi.hoisted(() => ({ overview: "falha" as "falha" | "espera" | "ok", leituras: 0 }));

const OVERVIEW = {
  snapshot: { total_events: 0, derived_events: 0, open_insights: 0, inventory_value: null, total_pieces: 0, missing_costs: 0, open_orders: 0, last_event_at: null },
  inbox: [],
  events: [],
  memory: [],
  sources: [],
};

/** O que a tela pode mostrar lendo e na falha (a trava contra legenda). */
const TEXTOS = [
  "Painel do Agent Dute",
  "Carregando o painel…",
  "Carregando o painel",
  "Não consegui carregar a central da IA agora.",
  "Tentar de novo",
  "Tentando de novo…",
];

/** O painel lido e vazio, com as camadas dos botões de ação (a trava contra legenda). */
const TEXTOS_LIDO = [
  "Painel do Agent Dute",
  "O que o agente observou e sugere; nada aqui executa sozinho.",
  "Monitorando",
  "Atualizar",
  "Atualizando…",
  "Conferir",
  "Eventos no ledger",
  "0",
  "Radar aberto",
  "Pendências críticas",
  "Decisões sugeridas",
  "Nenhuma decisão sugerida agora.",
  "Eventos recentes por entidade",
  "Nenhuma entidade com eventos recentes.",
  "Memória por cliente",
  "Nenhuma memória de cliente criada ainda.",
  "Próximos riscos operacionais",
  "0 tarefa(s) WMS",
  "0 solicitação(ões)",
  "Nenhum risco operacional próximo encontrado.",
  "Risco de WMS físico",
  "0 risco(s)",
  "Nenhum risco físico destacado agora.",
  "Linha do tempo operacional",
  "Ainda não há eventos registrados.",
  "Notificações do Agent Dute",
  "Sincronizar",
  "Sincronizando…",
  "Nenhuma mensagem pendente",
  "Sincronize o ledger para o Agent Dute preparar rascunhos quando houver eventos comunicáveis.",
  "Radar do Agent Dute",
  "Nenhum alerta aberto agora.",
  "Ensinar o Agent Dute",
  "Anotação operacional",
  "Informação",
  "Registrar",
  "Registrando…",
  "Rastreabilidade por evento",
  "Sem eventos rastreáveis no ledger.",
  "Memória operacional",
  "Fontes observadas: .",
  "Carregando notificações…",
  "Carregando notificações",
];

let raiz: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance", "Date"] });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  respostas.overview = "falha";
  respostas.leituras = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (entrada: RequestInfo | URL) => {
      const url = String(entrada);
      if (url.includes("/api/ai/overview")) {
        respostas.leituras += 1;
        await new Promise((ok) => setTimeout(ok, 400));
        if (respostas.overview === "falha") return new Response(JSON.stringify({ message: "Falha interna." }), { status: 500 });
        return new Response(JSON.stringify(OVERVIEW), { status: 200 });
      }
      if (url.includes("/api/warehouse/ops")) return new Response(JSON.stringify({ queues: [] }), { status: 200 });
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    }),
  );
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
        <AiControl />
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

/** O axe usa o relógio de verdade; os relógios falsos voltam depois. */
async function violacoes(html: string) {
  vi.useRealTimers();
  try {
    return await violacoesDeAcessibilidade(html);
  } finally {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance", "Date"] });
  }
}

const botao = (rotulo: string) => [...container!.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.trim() === rotulo);

describe("o painel antigo do Agent Dute lendo e na falha", () => {
  it("lendo: nada antes de 300 ms; depois, \"Carregando o painel…\" com os blocos, na lista de textos e no axe", async () => {
    respostas.overview = "espera";
    await abrir();
    expect(container!.textContent).not.toContain("Carregando o painel…");
    await passar(CARREGANDO.atrasoMs);
    expect(container!.textContent).toContain("Carregando o painel…");
    expect(container!.querySelectorAll("[data-esqueleto]").length).toBeGreaterThan(0);
    expect(container!.innerHTML).not.toMatch(/animate-spin|animate-pulse/);
    expect(textosForaDaLista(container!.innerHTML, TEXTOS)).toEqual([]);
    expect(await violacoes(container!.innerHTML)).toEqual([]);
  });

  it("a falha diz o motivo, e o \"Tentar de novo\" fica na tela enquanto tenta, com o foco nele", async () => {
    await abrir();
    await passar(500);
    expect(container!.textContent).toContain("Não consegui carregar a central da IA agora.");
    expect(textosForaDaLista(container!.innerHTML, TEXTOS)).toEqual([]);
    expect(await violacoes(container!.innerHTML)).toEqual([]);
    const tentar = botao("Tentar de novo")!;
    tentar.focus();
    respostas.overview = "ok";
    await act(async () => tentar.click());
    await passar(50);
    const tentando = botao("Tentando de novo…")!;
    expect(tentando).toBeDefined();
    expect(tentando.getAttribute("aria-busy")).toBe("true");
    expect(document.activeElement).toBe(tentando);
    expect(textosForaDaLista(container!.innerHTML, TEXTOS)).toEqual([]);
    await passar(400);
    expect(container!.textContent).not.toContain("Não consegui carregar a central da IA agora.");
    expect(respostas.leituras).toBe(2);
  });

  it("lido, o painel passa no axe, e o Atualizar tem 44 px", async () => {
    respostas.overview = "ok";
    await abrir();
    await passar(500);
    expect(container!.textContent).toContain("Monitorando");
    const atualizar = [...container!.querySelectorAll<HTMLButtonElement>("button.botao-acao")].find((item) => item.querySelector(".botao-acao-camada[data-atual]")?.textContent === "Atualizar")!;
    expect(atualizar.className).toMatch(/\bmin-h-11\b/);
    expect(textosForaDaLista(container!.innerHTML, [...TEXTOS, ...TEXTOS_LIDO])).toEqual([]);
    expect(await violacoes(container!.innerHTML)).toEqual([]);
  });
});
