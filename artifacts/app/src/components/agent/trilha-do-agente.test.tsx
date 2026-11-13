// @vitest-environment jsdom
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Anunciador, INTERVALO_DO_ANUNCIO_MS } from "@/lib/carregando/anunciador";
import { CARREGANDO } from "@/lib/carregando/tempo";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosForaDaLista } from "@/test/textos";

import { FontesDaResposta, TrilhaDoAgente, TrilhaRecolhida, linhasDaTrilha, type ConsultaDoAgente } from "./trilha-do-agente";

/**
 * A trilha do Agent Dute (carregamento v2, momento 9): a caixa violeta e o que
 * o agente está lendo, no lugar do "Pensando…" e das etiquetas soltas; e o
 * "De onde tirei" no fim da resposta (invariante 3).
 */

const TEXTOS = [
  "Lendo a pergunta…",
  "Consultando o estoque…",
  "Estoque",
  "Consultando o razão de movimentos…",
  "Razão de movimentos",
  "Pedidos",
  "Chegadas",
  "Consultando os itens parados…",
  /^\+\d+ consultas$/,
  "Leu o estoque e o razão de movimentos",
  "Demorando mais que o normal",
  "Parar",
  "De onde tirei:",
];

let raiz: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
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

function mostrar(no: ReactElement) {
  act(() => raiz!.render(<>{no}<Anunciador /></>));
}

function passar(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

const trilha = () => container!.querySelector<HTMLElement>("[data-trilha-do-agente]");
const passos = () => [...container!.querySelectorAll<HTMLElement>("[data-passo]")].map((linha) => [linha.dataset.passo, linha.textContent]);
const anuncio = () => document.querySelector("[data-anunciador]")?.textContent ?? "";
const html = () => container!.innerHTML;

const lendo = (nome: string): ConsultaDoAgente => ({ nome, estado: "lendo" });
const lida = (nome: string): ConsultaDoAgente => ({ nome, estado: "lida" });

describe("a trilha do Agent Dute", () => {
  it("antes de 300 ms nada; aos 300 ms, a caixa violeta de 20 px e \"Lendo a pergunta…\"", () => {
    mostrar(<TrilhaDoAgente consultas={[]} escrevendo={false} demorando={false} />);
    expect(trilha()).toBeNull();
    passar(CARREGANDO.atrasoMs - 1);
    expect(trilha()).toBeNull();
    passar(1);
    expect(passos()).toEqual([["vez", "Lendo a pergunta…"]]);
    const caixa = trilha()!.querySelector<HTMLElement>("[data-spinner]")!;
    expect(caixa.dataset.tamanho).toBe("20");
    expect(caixa.dataset.forma).toBe("caixa");
    expect(caixa.getAttribute("aria-hidden")).toBe("true");
    expect(caixa.parentElement!.className).toContain("text-carregando-agente");
  });

  it("cada consulta vira uma linha: a da vez no gerúndio, com a caixa; as feitas pelo nome, com o check violeta", () => {
    mostrar(<TrilhaDoAgente consultas={[lida("resumo_estoque"), lendo("movimentacoes")]} escrevendo={false} demorando={false} />);
    passar(CARREGANDO.atrasoMs);
    expect(passos()).toEqual([
      ["feita", "Estoque"],
      ["vez", "Consultando o razão de movimentos…"],
    ]);
    const [feita, vez] = [...trilha()!.querySelectorAll<HTMLElement>("[data-passo]")];
    expect(feita.querySelector("[data-check]")).not.toBeNull();
    expect(feita.querySelector("[data-spinner]")).toBeNull();
    expect(vez.querySelector("[data-spinner]")).not.toBeNull();
    // Sem o "Pensando…", os três pontinhos e o texto com brilho.
    expect(html()).not.toMatch(/Pensando|\.\.\.|animate-pulse|animate-spin/);
  });

  it("até 4 linhas; as mais antigas recolhem em \"+2 consultas\"", () => {
    const cinco = [lida("resumo_estoque"), lida("movimentacoes"), lida("listar_pedidos"), lida("recebimentos"), lendo("itens_parados")];
    expect(linhasDaTrilha(cinco.slice(0, 4)).map((linha) => linha.texto)).toEqual(["Estoque", "Razão de movimentos", "Pedidos", "Chegadas"]);
    mostrar(<TrilhaDoAgente consultas={cinco} escrevendo={false} demorando={false} />);
    passar(CARREGANDO.atrasoMs);
    expect(passos()).toEqual([
      ["recolhido", "+2 consultas"],
      ["feita", "Pedidos"],
      ["feita", "Chegadas"],
      ["vez", "Consultando os itens parados…"],
    ]);
  });

  it("quando o texto começa, recolhe numa linha com o que leu", () => {
    mostrar(<TrilhaDoAgente consultas={[lida("resumo_estoque"), lida("movimentacoes")]} escrevendo demorando={false} />);
    expect(trilha()).toBeNull();
    expect(container!.querySelector("[data-trilha-recolhida]")?.textContent).toBe("Leu o estoque e o razão de movimentos");
    // Sem leitura, a trilha some: o rascunho não é de onde ele tirou.
    mostrar(<TrilhaDoAgente consultas={[lida("rascunho_pedido")]} escrevendo demorando={false} />);
    expect(container!.querySelector("[data-trilha-recolhida]")).toBeNull();
  });

  it("anima só nos primeiros 5 s; a caixa da vez continua, calma com a demora", () => {
    mostrar(<TrilhaDoAgente consultas={[lendo("resumo_estoque")]} escrevendo={false} demorando={false} />);
    passar(CARREGANDO.atrasoMs);
    expect(trilha()!.hasAttribute("data-movimento")).toBe(true);
    passar(CARREGANDO.movimentoMaxMs - CARREGANDO.atrasoMs);
    expect(trilha()!.hasAttribute("data-movimento")).toBe(false);
    expect(trilha()!.querySelector("[data-spinner]")).not.toBeNull();
    expect(trilha()!.querySelector("[data-spinner]")!.hasAttribute("data-calmo")).toBe(false);
    mostrar(<TrilhaDoAgente consultas={[lendo("resumo_estoque")]} escrevendo={false} demorando />);
    expect(trilha()!.querySelector("[data-spinner]")!.hasAttribute("data-calmo")).toBe(true);
  });

  it("aos 10 s sem texto: \"Demorando mais que o normal\" e o Parar, com 44 px, que corta a espera", () => {
    const onParar = vi.fn();
    mostrar(<TrilhaDoAgente consultas={[lendo("resumo_estoque")]} escrevendo={false} demorando={false} onParar={onParar} />);
    passar(CARREGANDO.atrasoMs);
    expect(html()).not.toContain("Parar");
    mostrar(<TrilhaDoAgente consultas={[lendo("resumo_estoque")]} escrevendo={false} demorando onParar={onParar} />);
    expect(trilha()!.textContent).toContain("Demorando mais que o normal");
    const parar = [...container!.querySelectorAll("button")].find((botao) => botao.textContent === "Parar")!;
    expect(parar.className).toContain("min-h-11");
    expect(parar.hasAttribute("disabled")).toBe(false);
    act(() => parar.click());
    expect(onParar).toHaveBeenCalledTimes(1);
  });

  it("o leitor de tela ouve o primeiro passo e a demora, uma vez; a trilha não é região viva", () => {
    mostrar(<TrilhaDoAgente consultas={[]} escrevendo={false} demorando={false} />);
    passar(CARREGANDO.atrasoMs);
    // "Lendo a pergunta" não é falado: o primeiro passo é a primeira consulta.
    expect(anuncio()).toBe("");
    mostrar(<TrilhaDoAgente consultas={[lendo("resumo_estoque")]} escrevendo={false} demorando={false} />);
    expect(anuncio()).toBe("Consultando o estoque");
    passar(INTERVALO_DO_ANUNCIO_MS);
    mostrar(<TrilhaDoAgente consultas={[lida("resumo_estoque"), lendo("movimentacoes")]} escrevendo={false} demorando={false} />);
    passar(INTERVALO_DO_ANUNCIO_MS);
    expect(anuncio()).toBe("Consultando o estoque");
    mostrar(<TrilhaDoAgente consultas={[lida("resumo_estoque"), lendo("movimentacoes")]} escrevendo={false} demorando />);
    expect(anuncio()).toBe("Demorando mais que o normal");
    expect(trilha()!.closest("[aria-live]")).toBeNull();
    expect(trilha()!.querySelector("[aria-live], [role='status'], [role='alert']")).toBeNull();
  });

  it("os textos da tela e o axe, na espera, na demora e recolhida", async () => {
    mostrar(<TrilhaDoAgente consultas={[lida("resumo_estoque"), lendo("movimentacoes")]} escrevendo={false} demorando onParar={() => undefined} />);
    passar(CARREGANDO.atrasoMs);
    const naDemora = trilha()!.outerHTML;
    mostrar(<TrilhaRecolhida nomes={["resumo_estoque", "movimentacoes"]} />);
    const recolhida = container!.querySelector("[data-trilha-recolhida]")!.outerHTML;
    // O axe usa o relógio de verdade.
    vi.useRealTimers();
    for (const estado of [naDemora, recolhida]) {
      expect(textosForaDaLista(estado, TEXTOS)).toEqual([]);
      expect(await violacoesDeAcessibilidade(estado)).toEqual([]);
    }
  });
});

describe("De onde tirei", () => {
  it("os chips no fim da resposta, numa lista com o rótulo", async () => {
    mostrar(<FontesDaResposta fontes={["Estoque", "Razão de movimentos"]} />);
    const fontes = container!.querySelector<HTMLElement>("[data-fontes]")!;
    expect(fontes.textContent).toBe("De onde tirei:EstoqueRazão de movimentos");
    const lista = fontes.querySelector("ul")!;
    expect([...lista.querySelectorAll("li")].map((chip) => chip.textContent)).toEqual(["Estoque", "Razão de movimentos"]);
    expect(document.getElementById(lista.getAttribute("aria-labelledby")!)?.textContent).toBe("De onde tirei:");
    expect(textosForaDaLista(fontes.outerHTML, TEXTOS)).toEqual([]);
    vi.useRealTimers();
    expect(await violacoesDeAcessibilidade(fontes.outerHTML)).toEqual([]);
  });

  it("sem fonte, nada", () => {
    mostrar(<FontesDaResposta fontes={[]} />);
    expect(container!.querySelector("[data-fontes]")).toBeNull();
  });
});
