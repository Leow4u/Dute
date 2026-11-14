// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Anunciador } from "@/lib/carregando/anunciador";
import { CARREGANDO } from "@/lib/carregando/tempo";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosForaDaLista } from "@/test/textos";

import { CarregandoNaRegiao } from "./carregando-na-regiao";

/**
 * A região que ainda lê (carregamento v2, parte 12), no lugar do
 * "Carregando..." solto e do ícone girando das telas do Agent Dute: nada antes
 * de 300 ms; depois, a caixa de 24 px e o rótulo, anunciado; aos 10 s, a volta
 * calma e "Demorando mais que o normal".
 */

const TEXTOS = ["Carregando anotações…", "Demorando mais que o normal"];

let raiz: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance", "Date"] });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
  act(() =>
    raiz!.render(
      <>
        <CarregandoNaRegiao rotulo="Carregando anotações…" />
        <Anunciador />
      </>,
    ),
  );
});

afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  document.body.innerHTML = "";
  container = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function passar(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

const regiao = () => container!.querySelector<HTMLElement>("[data-carregando-na-regiao]")!;
const anuncio = () => document.querySelector("[data-anunciador]")?.textContent ?? "";

describe("a região que ainda lê", () => {
  it("antes de 300 ms nada, com a altura reservada; aos 300 ms, a caixa de 24 px e o rótulo, anunciado", () => {
    expect(regiao().textContent).toBe("");
    expect(regiao().className).toContain("min-h-6");
    passar(CARREGANDO.atrasoMs - 1);
    expect(regiao().querySelector("[data-spinner]")).toBeNull();
    passar(1);
    const caixa = regiao().querySelector<HTMLElement>("[data-spinner]")!;
    expect(caixa.dataset.tamanho).toBe("24");
    expect(caixa.getAttribute("aria-hidden")).toBe("true");
    expect(regiao().textContent).toBe("Carregando anotações…");
    expect(anuncio()).toBe("Carregando anotações");
    expect(regiao().closest("[aria-live]")).toBeNull();
  });

  it("aos 10 s, a volta calma e a demora, anunciada uma vez", async () => {
    passar(CARREGANDO.demoraMs);
    expect(regiao().textContent).toContain("Demorando mais que o normal");
    expect(regiao().querySelector("[data-spinner]")!.hasAttribute("data-calmo")).toBe(true);
    expect(anuncio()).toBe("Demorando mais que o normal");
    const html = regiao().outerHTML;
    expect(textosForaDaLista(html, TEXTOS)).toEqual([]);
    vi.useRealTimers();
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });
});

describe("a região que ainda lê, com outras na mesma tela", () => {
  it("o rótulo que esperava a vez no anunciador não é falado se a leitura acabou antes", () => {
    act(() =>
      raiz!.render(
        <>
          <CarregandoNaRegiao key="anotacoes" rotulo="Carregando anotações…" />
          <CarregandoNaRegiao key="playbooks" rotulo="Carregando playbooks…" />
          <Anunciador key="anunciador" />
        </>,
      ),
    );
    const falados: string[] = [];
    const anotar = () => {
      const texto = anuncio();
      if (texto && texto !== falados[falados.length - 1]) falados.push(texto);
    };
    passar(CARREGANDO.atrasoMs);
    anotar();
    // Os playbooks chegaram antes de o anunciador estar livre: a região deles sai.
    act(() =>
      raiz!.render(
        <>
          <CarregandoNaRegiao key="anotacoes" rotulo="Carregando anotações…" />
          <Anunciador key="anunciador" />
        </>,
      ),
    );
    passar(2_500);
    anotar();
    expect(falados).toEqual(["Carregando anotações"]);
  });
});

describe("a região que ainda lê, com a nova tentativa (parte 13e)", () => {
  function montarComTentar(onTentar: () => void) {
    act(() =>
      raiz!.render(
        <>
          <section>
            <h2>Incidentes</h2>
            <CarregandoNaRegiao id="lendo" rotulo="Carregando incidentes…" onTentar={onTentar} />
          </section>
          <Anunciador />
        </>,
      ),
    );
  }
  const tentar = () => [...regiao().querySelectorAll<HTMLButtonElement>("button")].find((botao) => botao.textContent?.includes("Tentar de novo"));

  it("sem a nova tentativa, a demora não oferece Tentar de novo (a de quem não sabe repetir a leitura)", () => {
    passar(CARREGANDO.demoraMs);
    expect(regiao().textContent).toContain("Demorando mais que o normal");
    expect(tentar()).toBeUndefined();
  });

  it("aos 10 s, Tentar de novo ao lado da demora; o toque relê, recomeça o relógio e o foco fica na região", () => {
    const onTentar = vi.fn();
    montarComTentar(onTentar);
    expect(regiao().id).toBe("lendo");
    passar(CARREGANDO.demoraMs - 1);
    expect(tentar()).toBeUndefined();
    passar(1);
    expect(regiao().textContent).toContain("Demorando mais que o normal");
    expect(tentar()).toBeTruthy();
    expect(textosForaDaLista(regiao().outerHTML, ["Carregando incidentes…", "Demorando mais que o normal", "Tentar de novo"])).toEqual([]);
    tentar()!.focus();
    act(() => tentar()!.click());
    expect(onTentar).toHaveBeenCalledTimes(1);
    // A espera recomeça do zero: nada antes de 300 ms, e o foco na região, nunca no body.
    expect(regiao().textContent).toBe("");
    expect(document.activeElement).toBe(regiao());
    passar(CARREGANDO.atrasoMs);
    expect(regiao().textContent).toBe("Carregando incidentes…");
  });

  it("aos 70 s, a desistência: Sem resposta do servidor. com Tentar de novo, que relê e recomeça", async () => {
    const onTentar = vi.fn();
    montarComTentar(onTentar);
    passar(CARREGANDO.desisteMs);
    const erro = regiao().querySelector('[role="alert"]');
    expect(erro?.textContent).toContain("Sem resposta do servidor.");
    expect(regiao().textContent).not.toContain("Demorando mais que o normal");
    expect(textosForaDaLista(regiao().outerHTML, ["Sem resposta do servidor.", "Tentar de novo"])).toEqual([]);
    tentar()!.focus();
    act(() => tentar()!.click());
    expect(onTentar).toHaveBeenCalledTimes(1);
    expect(regiao().querySelector('[role="alert"]')).toBeNull();
    expect(document.activeElement).toBe(regiao());
    const html = container!.innerHTML;
    vi.useRealTimers();
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });
});
