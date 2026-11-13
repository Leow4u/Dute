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
import { PRAZO_ESGOTADO, SemConexao, SemResposta } from "@/lib/conexao";
import type { AgentDuteStreamChunk } from "@/lib/functions-api";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosForaDaLista } from "@/test/textos";

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

function agenteFalso(sobre: Partial<Pick<ClienteDoAgente, "conversas" | "mensagens">> = {}): ClienteDoAgente {
  return {
    alvo: { tipo: "wms" },
    chave: ["teste"],
    conversas: sobre.conversas ?? (async () => ({ conversations: [] })),
    mensagens: sobre.mensagens ?? (async () => ({ messages: [] })),
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

async function abrir(cliente: ClienteDoAgente = agenteFalso(), caminho = "/agente") {
  const local = memoryLocation({ path: caminho });
  const consulta = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () =>
    raiz!.render(
      <QueryClientProvider client={consulta}>
        <Router hook={local.hook} searchHook={local.searchHook}>
          <ProvedorDoAgente cliente={cliente}>
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

async function digitar(texto: string) {
  const campo = container!.querySelector<HTMLTextAreaElement>("[data-agent-input]")!;
  await act(async () => {
    const definir = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    definir.call(campo, texto);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const campo = () => container!.querySelector<HTMLTextAreaElement>("[data-agent-input]")!;

async function perguntar(texto: string) {
  await digitar(texto);
  const campo = container!.querySelector<HTMLTextAreaElement>("[data-agent-input]")!;
  await act(async () => {
    campo.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
}

async function passar(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

/** O relógio anda e as promessas que ele soltou terminam (a leitura que falha depois de um tempo). */
async function passarAteAssentar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
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

  it("depois que o texto começa, a demora e o Parar saem, e o foco que estava no Parar vai ao campo", async () => {
    await abrir();
    await perguntar("Qual o saldo do polo?");
    await chegar({ type: "tool", name: "buscar_itens" });
    await passar(CARREGANDO.demoraMs);
    const parar = botao("Parar")!;
    expect(texto()).toContain("Demorando mais que o normal");
    parar.focus();
    await chegar({ type: "text", index: 1, text: "O polo tem" });
    await passar(1_000);
    expect(botao("Parar")).toBeUndefined();
    expect(texto()).not.toContain("Demorando mais que o normal");
    expect(document.activeElement).toBe(campo());
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

  it("o stream que fecha sem o resultado (a function caiu ou passou do prazo dela) vira \"Sem resposta do Agent Dute\", sem toast", async () => {
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

describe("as leituras da conversa que não chegaram", () => {
  it("a lista de conversas que falhou diz que falhou, com o Tentar de novo, e nunca \"Suas conversas aparecem aqui\"", async () => {
    const conversas = vi.fn(() => Promise.reject(new Error("Falha interna no servidor.")));
    await abrir(agenteFalso({ conversas }));
    await passar(0);
    expect(texto()).not.toContain("Suas conversas aparecem aqui.");
    expect(texto()).toContain("Não consegui carregar as conversas.");
    await act(async () => botao("Tentar de novo")!.click());
    expect(conversas).toHaveBeenCalledTimes(2);
  });

  it("a conversa que não chegou do servidor mostra a falta, e não a tela de boas-vindas", async () => {
    await abrir(agenteFalso({ mensagens: () => Promise.reject(new SemConexao()) }), "/agente?c=dute_1");
    await passar(0);
    expect(texto()).not.toContain("Como posso ajudar?");
    expect(container!.querySelector("[data-falta]")).not.toBeNull();
    expect(botao("Tentar de novo")).toBeDefined();
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

/** Os textos que a conversa pode mostrar nos estados da espera e da falta (a trava contra legenda). */
const TEXTOS_DA_CONVERSA = [
  "Nova conversa",
  "Rotinas",
  "WhatsApp",
  "em breve",
  "Buscar conversas",
  "Suas conversas aparecem aqui.",
  "Não consegui carregar as conversas.",
  "Não consegui carregar a conversa.",
  "Reconectando…",
  "Sem conexão.",
  "Tentar de novo",
  "Tentando de novo…",
  "Carregando a conversa…",
  // O que o Anunciador fala (a região viva, só para o leitor de tela).
  "Carregando a conversa",
  "Agent Dute",
  "Conversa",
  "Olá, Ana. Como posso ajudar?",
  "Quais itens estão parados há mais de 60 dias?",
  "O Agent Dute monta pedidos para você conferir; quem envia é você. Confira as informações importantes.",
];

describe("a espera da resposta, depois da revisão", () => {
  it("o texto de abertura antes de uma consulta (\"Vou verificar…\") não desliga a demora nem o Parar, e sai da tela enquanto a consulta roda", async () => {
    await abrir();
    await perguntar("Quais pedidos estão atrasados?");
    await chegar({ type: "text", index: 0, text: "Vou verificar os pedidos." });
    await chegar({ type: "tool", name: "listar_pedidos" });
    await passar(CARREGANDO.atrasoMs);
    expect(passos()).toEqual(["Consultando os pedidos…"]);
    expect(texto()).not.toContain("Vou verificar os pedidos.");
    await passar(CARREGANDO.demoraMs);
    expect(texto()).toContain("Demorando mais que o normal");
    expect(botao("Parar")).toBeDefined();
  });

  it("a mesma consulta de novo entra como linha nova, por último: as feitas em cima, a da vez embaixo", async () => {
    await abrir();
    await perguntar("Abra os pedidos 1042 e 1043");
    await chegar({ type: "tool", name: "ver_pedido" });
    await chegar({ type: "tool", name: "resumo_estoque" });
    await chegar({ type: "tool", name: "ver_pedido" });
    await passar(CARREGANDO.atrasoMs);
    expect(passos()).toEqual(["Pedido", "Estoque", "Abrindo o pedido…"]);
  });

  it("o Parar não apaga o que a pessoa escreveu durante a espera; com o campo vazio, a pergunta volta", async () => {
    await abrir();
    await perguntar("Quais pedidos estão atrasados?");
    await chegar({ type: "tool", name: "listar_pedidos" });
    await digitar("E quantas chegadas temos hoje?");
    await passar(CARREGANDO.demoraMs);
    await act(async () => botao("Parar")!.click());
    await passar(16);
    expect(campo().value).toBe("E quantas chegadas temos hoje?");
    expect(conversas[0].sinal?.aborted).toBe(true);

    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(campo(), "");
      campo().dispatchEvent(new Event("input", { bubbles: true }));
    });
    await perguntar("Quais pedidos estão atrasados?");
    await chegar({ type: "tool", name: "listar_pedidos" });
    await passar(CARREGANDO.demoraMs);
    await act(async () => botao("Parar")!.click());
    await passar(16);
    expect(campo().value).toBe("Quais pedidos estão atrasados?");
  });

  it("o \"Tentar de novo\" do prazo relê a conversa e não apaga o que a pessoa escreveu", async () => {
    const mensagens = vi.fn(async () => ({ messages: [] }));
    await abrir(agenteFalso({ mensagens }));
    await perguntar("Quais pedidos estão atrasados?");
    await passar(CARREGANDO.desisteDoAgenteMs);
    expect(texto()).toContain("Sem resposta do Agent Dute");
    await digitar("E as chegadas de hoje?");
    const leiturasAntes = mensagens.mock.calls.length;
    await act(async () => botao("Tentar de novo")!.click());
    await passar(0);
    expect(mensagens.mock.calls.length).toBe(leiturasAntes + 1);
    expect(conversas).toHaveLength(2);
    expect(conversas[1].pedido.message).toBe("Quais pedidos estão atrasados?");
    expect(campo().value).toBe("E as chegadas de hoje?");
  });

  it("o \"Tentar de novo\" não pergunta de novo quando a resposta já foi gravada depois do corte: mostra a que chegou", async () => {
    let gravada = false;
    const mensagens = vi.fn(async (): Promise<ChatResponse> => (gravada ? RESPOSTA : { messages: [] }));
    await abrir(agenteFalso({ mensagens }));
    await perguntar("Quais itens estão parados há mais de 60 dias?");
    await passar(CARREGANDO.desisteDoAgenteMs);
    expect(texto()).toContain("Sem resposta do Agent Dute");
    gravada = true;
    await act(async () => botao("Tentar de novo")!.click());
    await passar(0);
    expect(conversas).toHaveLength(1);
    expect(texto()).not.toContain("Sem resposta do Agent Dute");
    expect(texto()).toContain("Encontrei 12 itens parados há mais de 60 dias.");
    // A pergunta aparece uma vez só: a gravada, sem a da espera.
    expect([...container!.querySelectorAll("div")].filter((no) => no.childElementCount === 0 && no.textContent === "Quais itens estão parados há mais de 60 dias?")).toHaveLength(1);
    expect(toast).not.toHaveBeenCalled();
  });

  it("o prazo conta da última notícia do servidor: a resposta que ainda chega aos 179 s não vira \"Sem resposta\"", async () => {
    await abrir();
    await perguntar("Faça o relatório do mês");
    await chegar({ type: "tool", name: "resumo_estoque" });
    await passar(170_000);
    await chegar({ type: "text", index: 1, text: "O relatório do mês: " });
    for (let i = 0; i < 9; i += 1) {
      await passar(1_000);
      await chegar({ type: "text", index: 1, text: `linha ${i}. ` });
    }
    await passar(1_000);
    expect(texto()).not.toContain("Sem resposta do Agent Dute");
    expect(texto()).toContain("O relatório do mês");
    expect(conversas[0].sinal?.aborted).toBe(false);
    await passar(CARREGANDO.desisteDoAgenteMs - 1_000);
    expect(texto()).toContain("Sem resposta do Agent Dute");
    expect(conversas[0].sinal?.aborted).toBe(true);
  });

  it("sair da tela no meio da resposta não vira toast", async () => {
    await abrir();
    await perguntar("Quais pedidos estão atrasados?");
    await chegar({ type: "tool", name: "listar_pedidos" });
    await act(async () => raiz!.unmount());
    raiz = null;
    await act(async () => undefined);
    expect(conversas[0].sinal?.aborted).toBe(true);
    expect(toast).not.toHaveBeenCalled();
  });

  it("a conversa rola até o fim quando chegam a demora e o \"Sem resposta\": o Parar e o \"Tentar de novo\" ficam à vista", async () => {
    const rolagens = vi.fn();
    Element.prototype.scrollTo = rolagens;
    await abrir();
    await perguntar("Quais pedidos estão atrasados?");
    await chegar({ type: "tool", name: "listar_pedidos" });
    await passar(CARREGANDO.demoraMs - 1);
    const antesDaDemora = rolagens.mock.calls.length;
    await passar(1);
    expect(botao("Parar")).toBeDefined();
    expect(rolagens.mock.calls.length).toBeGreaterThan(antesDaDemora);
    const antesDoPrazo = rolagens.mock.calls.length;
    await passar(CARREGANDO.desisteDoAgenteMs);
    expect(botao("Tentar de novo")).toBeDefined();
    expect(rolagens.mock.calls.length).toBeGreaterThan(antesDoPrazo);
  });

  it("o Enviar nunca fica desabilitado: o foco que estava nele continua lá quando a resposta chega", async () => {
    const anterior: ChatResponse = {
      messages: [
        { id: "m0", role: "user", content: "Bom dia", created_at: "2026-11-13T11:00:00.000Z" },
        { id: "m0r", role: "assistant", content: "Bom dia! Em que posso ajudar?", created_at: "2026-11-13T11:00:01.000Z", tools_used: [] },
      ],
    };
    await abrir(agenteFalso({ mensagens: async () => anterior }), "/agente?c=c1");
    await passar(0);
    await digitar("Quais itens estão parados há mais de 60 dias?");
    const enviar = container!.querySelector<HTMLButtonElement>('button[aria-label="Enviar"]')!;
    enviar.focus();
    await act(async () => enviar.click());
    expect(enviar.disabled).toBe(false);
    expect(enviar.getAttribute("aria-disabled")).toBe("true");
    await act(async () => conversas[0].responder(RESPOSTA));
    const depois = container!.querySelector<HTMLButtonElement>('button[aria-label="Enviar"]')!;
    expect(depois.disabled).toBe(false);
    expect(depois.getAttribute("aria-disabled")).toBe("true");
    expect(document.activeElement).toBe(depois);
  });

  it("a primeira pergunta de uma conversa nova, pelo campo das boas-vindas, deixa o foco no campo da conversa, e não no body", async () => {
    await abrir();
    expect(texto()).toContain("Como posso ajudar?");
    campo().focus();
    await perguntar("Quais itens estão parados há mais de 60 dias?");
    await passar(50);
    // A tela trocou das boas-vindas para a conversa: o campo é outro, e o foco foi com a pessoa.
    expect(texto()).not.toContain("Como posso ajudar?");
    expect(document.activeElement).toBe(campo());
    await act(async () => conversas[0].responder(RESPOSTA));
    await passar(50);
    expect(document.activeElement).toBe(campo());
  });

  it("o foco no Parar vai ao campo quando a resposta chega inteira, sem texto antes", async () => {
    await abrir();
    await perguntar("Quais itens?");
    await chegar({ type: "tool", name: "resumo_estoque" });
    await passar(CARREGANDO.demoraMs + 500);
    botao("Parar")!.focus();
    await chegar({ type: "reset" });
    await act(async () => conversas[0].responder(RESPOSTA));
    await passar(50);
    expect(document.activeElement).toBe(campo());
  });
});

describe("as leituras da conversa que falharam, depois da revisão", () => {
  it("a lista de conversas sem conexão diz a falta como a conversa, e não \"Não consegui carregar\"", async () => {
    await abrir(agenteFalso({ conversas: () => Promise.reject(new SemResposta()) }));
    await passar(0);
    const barra = container!.querySelector('nav[aria-label="Conversas recentes"]')!;
    expect(barra.textContent).toContain("Reconectando…");
    expect(barra.textContent).not.toContain("Não consegui carregar as conversas.");
    expect(textosForaDaLista(container!.innerHTML, TEXTOS_DA_CONVERSA)).toEqual([]);
    expect(await violacoesDeAcessibilidadeNoRelogioDeVerdade(container!.innerHTML)).toEqual([]);
  });

  it("o \"Tentar de novo\" da lista de conversas fica na tela enquanto tenta, com o foco nele", async () => {
    let falhar = true;
    const conversas = vi.fn(async () => {
      await new Promise((ok) => setTimeout(ok, 400));
      if (falhar) throw new Error("Falha interna no servidor.");
      return { conversations: [] };
    });
    await abrir(agenteFalso({ conversas }));
    await passarAteAssentar(500);
    expect(textosForaDaLista(container!.innerHTML, TEXTOS_DA_CONVERSA)).toEqual([]);
    expect(await violacoesDeAcessibilidadeNoRelogioDeVerdade(container!.innerHTML)).toEqual([]);
    const tentar = botao("Tentar de novo")!;
    tentar.focus();
    falhar = false;
    await act(async () => tentar.click());
    await passarAteAssentar(50);
    const tentando = botao("Tentando de novo…")!;
    expect(tentando).toBeDefined();
    expect(tentando.getAttribute("aria-busy")).toBe("true");
    expect(document.activeElement).toBe(tentando);
    expect(textosForaDaLista(container!.innerHTML, TEXTOS_DA_CONVERSA)).toEqual([]);
    await passarAteAssentar(400);
    expect(texto()).toContain("Suas conversas aparecem aqui.");
  });

  it("o \"Tentar de novo\" da conversa que falhou fica na tela enquanto tenta, e os estados passam no axe e na lista de textos", async () => {
    let falhar = true;
    const mensagens = vi.fn(async (): Promise<ChatResponse> => {
      await new Promise((ok) => setTimeout(ok, 400));
      if (falhar) throw new Error("Falha interna no servidor.");
      return RESPOSTA;
    });
    await abrir(agenteFalso({ mensagens }), "/agente?c=dute_1");
    await passarAteAssentar(CARREGANDO.atrasoMs);
    expect(texto()).toContain("Carregando a conversa…");
    expect(textosForaDaLista(container!.innerHTML, TEXTOS_DA_CONVERSA)).toEqual([]);
    await passarAteAssentar(200);
    expect(texto()).toContain("Não consegui carregar a conversa.");
    expect(textosForaDaLista(container!.innerHTML, TEXTOS_DA_CONVERSA)).toEqual([]);
    expect(await violacoesDeAcessibilidadeNoRelogioDeVerdade(container!.innerHTML)).toEqual([]);
    const tentar = [...container!.querySelectorAll<HTMLElement>("[role=alert] button")].find((b) => b.textContent?.trim() === "Tentar de novo")!;
    tentar.focus();
    falhar = false;
    await act(async () => tentar.click());
    await passarAteAssentar(50);
    const tentando = botao("Tentando de novo…")!;
    expect(document.activeElement).toBe(tentando);
    expect(texto()).toContain("Não consegui carregar a conversa.");
    expect(textosForaDaLista(container!.innerHTML, TEXTOS_DA_CONVERSA)).toEqual([]);
    await passarAteAssentar(400);
    expect(texto()).toContain("Encontrei 12 itens parados há mais de 60 dias.");
  });
});
