// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

import type { ChatResponse } from "@/components/agent/chat";
import type { ClienteDoAgente, PedidoDaConversa } from "@/lib/agente/cliente";
import { ProvedorDoAgente } from "@/lib/agente/contexto";
import { Anunciador, INTERVALO_DO_ANUNCIO_MS } from "@/lib/carregando/anunciador";
import { CARREGANDO } from "@/lib/carregando/tempo";
import { PRAZO_ESGOTADO } from "@/lib/conexao";
import type { AgentDuteStreamChunk } from "@/lib/functions-api";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";

/**
 * A conversa com o Agent Dute enquanto a resposta chega (carregamento v2,
 * momento 9): a trilha no lugar do "Pensando…" e das etiquetas soltas das
 * consultas; o Parar aos 10 s sem texto, que corta a espera neste aparelho;
 * "Sem resposta do Agent Dute" no prazo do chat (180 s), com o "Tentar de
 * novo"; e "De onde tirei" no fim da resposta.
 */

const toast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));
vi.mock("@/lib/auth", () => ({
  useAppUser: () => ({ user: { uid: "uid-ana", fullName: "Ana Souza", publicMetadata: { role: "interno" } }, isLoaded: true }),
}));

import { AgentScreen } from "./agent-screen";

type Conversa = {
  pedido: PedidoDaConversa;
  aoPedaco: (pedaco: AgentDuteStreamChunk) => void;
  sinal?: AbortSignal;
  responder: (resposta: ChatResponse) => void;
  falhar: (erro: unknown) => void;
};

let conversas: Conversa[] = [];

function agenteFalso(): ClienteDoAgente {
  return {
    alvo: { tipo: "wms" },
    chave: ["teste"],
    conversas: async () => ({ conversations: [] }),
    mensagens: async () => ({ messages: [] }),
    conversar: (pedido, aoPedaco, sinal) =>
      new Promise<ChatResponse>((responder, falhar) => {
        conversas.push({ pedido, aoPedaco, sinal, responder, falhar });
        sinal?.addEventListener("abort", () => falhar(Object.assign(new Error("cancelled"), { code: "cancelled" })));
      }),
    rotinas: { listar: async () => ({ routines: [] }), salvar: async () => ({}), excluir: async () => ({}), rodar: async () => ({ conversation_id: "x" }) },
    anotacoes: { listar: async () => ({ notes: [] }), decidir: async () => ({}), sugerir: null, escrever: null },
    playbooks: { listar: async () => ({ playbooks: [] }), salvar: async () => ({ id: "x" }), decidir: async () => ({}), carregar: async () => ({ created: 0 }) },
  };
}

let raiz: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  conversas = [];
  toast.mockReset();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance", "Date", "requestAnimationFrame", "cancelAnimationFrame"] });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Element.prototype.scrollTo = () => undefined;
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
  const local = memoryLocation({ path: "/agente" });
  const consulta = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () =>
    raiz!.render(
      <QueryClientProvider client={consulta}>
        <Router hook={local.hook} searchHook={local.searchHook}>
          <ProvedorDoAgente cliente={agenteFalso()}>
            <div className="v3">
              <AgentScreen basePath="/agente" suggestions={[{ prompt: "Quais itens estão parados há mais de 60 dias?", hint: "" }]} placeholder="Pergunte" />
            </div>
          </ProvedorDoAgente>
        </Router>
        <Anunciador />
      </QueryClientProvider>,
    ),
  );
}

async function perguntar(texto: string) {
  const campo = container!.querySelector<HTMLTextAreaElement>("[data-agent-input]")!;
  await act(async () => {
    const definir = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    definir.call(campo, texto);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    campo.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
}

async function passar(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

async function chegar(pedaco: AgentDuteStreamChunk) {
  await act(async () => conversas[conversas.length - 1].aoPedaco(pedaco));
}

const passos = () => [...container!.querySelectorAll<HTMLElement>("[data-passo]")].map((linha) => linha.textContent);
const botao = (texto: string) => [...container!.querySelectorAll("button")].find((item) => item.textContent?.trim() === texto);
const anuncio = () => document.querySelector("[data-anunciador]")?.textContent ?? "";
const texto = () => container!.textContent ?? "";
/** A frase está na conversa (fora do campo e da região do anúncio). */
const naConversa = (frase: string) =>
  [...container!.querySelectorAll<HTMLElement>("div, p")].some((no) => !no.closest("[data-anunciador]") && no.childElementCount === 0 && no.textContent === frase);

const RESPOSTA: ChatResponse = {
  conversation: { id: "c1" },
  messages: [
    { id: "m1", role: "user", content: "Quais itens estão parados há mais de 60 dias?", created_at: "2026-11-13T12:00:00.000Z" },
    {
      id: "m2",
      role: "assistant",
      content: "Encontrei 12 itens parados há mais de 60 dias.",
      created_at: "2026-11-13T12:00:05.000Z",
      tools_used: ["resumo_estoque", "movimentacoes"],
    },
  ],
};

describe("a resposta do Agent Dute chegando", () => {
  it("a trilha diz cada consulta, recolhe quando o texto começa, e a resposta termina com \"De onde tirei\"", async () => {
    await abrir();
    await perguntar("Quais itens estão parados há mais de 60 dias?");
    expect(conversas).toHaveLength(1);
    expect(passos()).toEqual([]);
    await passar(CARREGANDO.atrasoMs);
    expect(passos()).toEqual(["Lendo a pergunta…"]);
    await chegar({ type: "tool", name: "resumo_estoque" });
    expect(passos()).toEqual(["Consultando o estoque…"]);
    await chegar({ type: "tool", name: "movimentacoes" });
    expect(passos()).toEqual(["Estoque", "Consultando o razão de movimentos…"]);
    expect(anuncio()).toBe("Consultando o estoque");
    await chegar({ type: "text", index: 1, text: "Encontrei 12 itens" });
    expect(passos()).toEqual([]);
    expect(container!.querySelector("[data-trilha-recolhida]")?.textContent).toBe("Leu o estoque e o razão de movimentos");
    expect(texto()).toContain("Encontrei 12 itens");
    expect(texto()).not.toMatch(/Pensando|Organizando a resposta|\.\.\./);

    await passar(INTERVALO_DO_ANUNCIO_MS);
    await act(async () => conversas[0].responder(RESPOSTA));
    expect(anuncio()).toBe("Resposta pronta");
    const resposta = container!.querySelector<HTMLElement>("[data-fontes]")!;
    expect(resposta.textContent).toBe("De onde tirei:EstoqueRazão de movimentos");
    // Os chips ficam no fim da resposta, depois do texto; a linha do que leu continua em cima.
    const conteudo = [...container!.querySelectorAll("p")].find((p) => p.textContent === "Encontrei 12 itens parados há mais de 60 dias.")!;
    expect(conteudo.compareDocumentPosition(resposta) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container!.querySelector("[data-trilha-recolhida]")!.compareDocumentPosition(conteudo) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container!.querySelector("[data-trilha-do-agente]")).toBeNull();
    expect(texto()).not.toContain("Pensando");
    expect(toast).not.toHaveBeenCalled();
  });

  it("aos 10 s sem texto, \"Demorando mais que o normal\" e o Parar: corta a espera neste aparelho e a pergunta volta ao campo", async () => {
    await abrir();
    await perguntar("Quais pedidos estão atrasados?");
    await chegar({ type: "tool", name: "listar_pedidos" });
    await passar(CARREGANDO.demoraMs - 1);
    expect(botao("Parar")).toBeUndefined();
    expect(texto()).not.toContain("Demorando mais que o normal");
    await passar(1);
    expect(texto()).toContain("Demorando mais que o normal");
    const parar = botao("Parar")!;
    expect(parar.className).toContain("min-h-11");
    // A caixa da vez continua, mais calma.
    expect(container!.querySelector("[data-trilha-do-agente] [data-spinner]")!.hasAttribute("data-calmo")).toBe(true);
    expect(await violacoesDeAcessibilidadeNoRelogioDeVerdade(container!.innerHTML)).toEqual([]);

    parar.focus();
    await act(async () => parar.click());
    await passar(16);
    expect(conversas[0].sinal?.aborted).toBe(true);
    expect(container!.querySelector("[data-trilha-do-agente]")).toBeNull();
    // A pergunta saiu da conversa e voltou ao campo.
    expect(naConversa("Quais pedidos estão atrasados?")).toBe(false);
    const campo = container!.querySelector<HTMLTextAreaElement>("[data-agent-input]")!;
    expect(campo.value).toBe("Quais pedidos estão atrasados?");
    expect(document.activeElement).toBe(campo);
    // Parar não é erro: nada de toast.
    expect(toast).not.toHaveBeenCalled();
  });

  it("depois que o texto começa, nem a demora nem o Parar", async () => {
    await abrir();
    await perguntar("Qual o saldo do polo?");
    await chegar({ type: "tool", name: "buscar_itens" });
    await chegar({ type: "text", index: 1, text: "O polo tem" });
    await passar(CARREGANDO.demoraMs + 1_000);
    expect(botao("Parar")).toBeUndefined();
    expect(texto()).not.toContain("Demorando mais que o normal");
  });

  it("no prazo do chat (180 s), \"Sem resposta do Agent Dute\" e o \"Tentar de novo\", que pergunta de novo", async () => {
    await abrir();
    await perguntar("Quais pedidos estão atrasados?");
    await chegar({ type: "tool", name: "listar_pedidos" });
    await passar(CARREGANDO.desisteDoAgenteMs - 1);
    expect(texto()).not.toContain("Sem resposta do Agent Dute");
    await passar(1);
    expect(conversas[0].sinal?.aborted).toBe(true);
    expect(texto()).toContain("Sem resposta do Agent Dute");
    expect(container!.querySelector("[data-trilha-do-agente]")).toBeNull();
    expect(botao("Parar")).toBeUndefined();
    // A pergunta fica na conversa, e o campo está livre.
    expect(naConversa("Quais pedidos estão atrasados?")).toBe(true);
    expect(toast).not.toHaveBeenCalled();
    expect(await violacoesDeAcessibilidadeNoRelogioDeVerdade(container!.innerHTML)).toEqual([]);

    await act(async () => botao("Tentar de novo")!.click());
    expect(conversas).toHaveLength(2);
    expect(conversas[1].pedido.message).toBe("Quais pedidos estão atrasados?");
    expect(conversas[1].pedido.conversation_id).toBe(conversas[0].pedido.conversation_id);
    expect(texto()).not.toContain("Sem resposta do Agent Dute");
  });

  it("o prazo da callable também vira \"Sem resposta do Agent Dute\", sem o toast em inglês", async () => {
    await abrir();
    await perguntar("Quais pedidos estão atrasados?");
    await act(async () => conversas[0].falhar(new Error(PRAZO_ESGOTADO)));
    expect(texto()).toContain("Sem resposta do Agent Dute");
    expect(botao("Tentar de novo")).toBeDefined();
    expect(toast).not.toHaveBeenCalled();
  });

  it("a falha de agora continua no toast, e a pergunta volta ao campo", async () => {
    await abrir();
    await perguntar("Quais pedidos estão atrasados?");
    await act(async () => conversas[0].falhar(new Error("O Agent Dute não respondeu agora. Tente de novo em instantes.")));
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Não consegui enviar agora", variant: "destructive" }));
    expect(container!.querySelector<HTMLTextAreaElement>("[data-agent-input]")!.value).toBe("Quais pedidos estão atrasados?");
  });
});

/** O axe usa o relógio de verdade; os relógios falsos voltam depois. */
async function violacoesDeAcessibilidadeNoRelogioDeVerdade(html: string) {
  vi.useRealTimers();
  try {
    return await violacoesDeAcessibilidade(html);
  } finally {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance", "Date", "requestAnimationFrame", "cancelAnimationFrame"] });
  }
}
