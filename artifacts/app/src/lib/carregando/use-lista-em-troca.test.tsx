// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as troca from "./use-lista-em-troca";

/**
 * As peças da troca de filtro (carregamento v2, momento 7, caso 4; a revisão
 * da parte 10): a lista anterior não se redesenha enquanto a nova não chega
 * (o toque responde sem refazer a tabela inteira), e a lista nova volta da
 * opacidade em que a anterior estava, sem passar por 0.
 */

const CSS = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../index.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

describe("a chegada da lista que trocou (index.css)", () => {
  it("a subida da chegada só mexe no transform: a opacidade não volta a 0, e o cartão nunca fica vazio", () => {
    const animacao = CSS.match(/\[data-lista-em-troca\]\[data-chegou\]\s*\{\s*animation:\s*([\w-]+)/);
    expect(animacao?.[1]).toBe("carregando-chega-troca");
    const quadros = CSS.match(/@keyframes carregando-chega-troca\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
    expect(quadros).toContain("transform: translateY(var(--carregando-subida))");
    expect(quadros).not.toContain("opacity");
  });

  it("na chegada, o que esmaeceu volta a 1 por uma transição, que parte de onde está (a troca rápida não pisca)", () => {
    expect(CSS).toMatch(
      /:is\(\[data-lista-em-troca\]\[data-chegou\], \[data-lista-em-troca\]\[data-chegou\] :has\(\[data-barra-da-lista\]\)\)\s*> :not\(\[data-barra-da-lista\], :has\(\[data-barra-da-lista\]\)\) \{\s*transition: opacity var\(--carregando-t-chegada\) var\(--ease-carregando-entrada\);/,
    );
  });
});

describe("o conteúdo da lista que troca", () => {
  let raiz: Root | null = null;
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
  });

  afterEach(() => {
    act(() => raiz?.unmount());
    raiz = null;
    container.remove();
    vi.unstubAllGlobals();
  });

  it("não se redesenha enquanto a nova não chega, nem no toque que começa a troca; na chegada, desenha a nova", () => {
    const { ConteudoEmTroca } = troca;
    expect(ConteudoEmTroca, "a peça existe").toBeDefined();
    const desenhos: string[] = [];
    function Linha({ texto }: { texto: string }) {
      desenhos.push(texto);
      return <p>{texto}</p>;
    }
    let mudar: (proximo: { trocando: boolean; texto: string }) => void = () => undefined;
    function Tela() {
      const [estado, setEstado] = useState({ trocando: false, texto: "lista 1" });
      mudar = setEstado;
      return (
        <ConteudoEmTroca trocando={estado.trocando}>
          <Linha texto={estado.texto} />
        </ConteudoEmTroca>
      );
    }
    raiz = createRoot(container);
    act(() => raiz!.render(<Tela />));
    expect(desenhos).toEqual(["lista 1"]);
    // O toque troca o filtro: a lista na tela é a anterior, e ela não se redesenha.
    act(() => mudar({ trocando: true, texto: "lista 1" }));
    act(() => mudar({ trocando: true, texto: "lista 1" }));
    expect(desenhos).toEqual(["lista 1"]);
    expect(container.textContent).toBe("lista 1");
    // A nova chega.
    act(() => mudar({ trocando: false, texto: "lista 2" }));
    expect(desenhos).toEqual(["lista 1", "lista 2"]);
    expect(container.textContent).toBe("lista 2");
  });
});
