// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { atrasoDoCompasso, useCompasso } from "./use-compasso";

/**
 * O compasso do giro (carregamento v2, seção 5.1): quem monta em horas
 * diferentes gira no mesmo passo. O hook põe no elemento o atraso negativo
 * tirado do relógio (`--compasso`), que o CSS de quem gira lê em
 * `animation-delay`.
 */

let raiz: Root | null = null;
let container: HTMLDivElement | null = null;
let agora = 0;

function Indicador({ duracaoMs }: { duracaoMs: number }) {
  const ref = useCompasso<HTMLSpanElement>(duracaoMs);
  return <span ref={ref} data-indicador="" />;
}

function montar(itens: number[]) {
  act(() =>
    raiz!.render(
      <>
        {itens.map((duracaoMs, indice) => (
          <Indicador key={indice} duracaoMs={duracaoMs} />
        ))}
      </>,
    ),
  );
}

function compassos(): string[] {
  return Array.from(container!.querySelectorAll<HTMLElement>("[data-indicador]")).map((elemento) =>
    elemento.style.getPropertyValue("--compasso"),
  );
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(performance, "now").mockImplementation(() => agora);
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
});

afterEach(() => {
  act(() => raiz?.unmount());
  container?.remove();
  raiz = null;
  container = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("o compasso do giro", () => {
  it("o atraso é o quanto da volta o relógio já andou, para trás", () => {
    expect(atrasoDoCompasso(0, 1_200)).toBe(0);
    expect(atrasoDoCompasso(5_300, 1_200)).toBe(-500);
    expect(atrasoDoCompasso(6_500, 1_200)).toBe(-500);
    expect(atrasoDoCompasso(7_000, 1_200)).toBe(-1_000);
    expect(atrasoDoCompasso(7_000, 2_000)).toBe(-1_000);
    expect(atrasoDoCompasso(5_300, 0)).toBe(0);
  });

  it("quem monta em horas diferentes gira no mesmo passo", () => {
    agora = 5_300;
    montar([1_200]);
    agora = 6_500;
    montar([1_200, 1_200]);
    agora = 7_250;
    montar([1_200, 1_200, 1_200]);
    expect(compassos()).toEqual(["-500ms", "-500ms", "-50ms"]);
    // A volta de cada um, no mesmo instante: (instante - montagem - atraso) % 1200.
    const montagens = [5_300, 6_500, 7_250];
    const atrasos = compassos().map((valor) => Number.parseFloat(valor));
    const fases = montagens.map((montagem, indice) => (9_999 - montagem - atrasos[indice]) % 1_200);
    expect(new Set(fases).size).toBe(1);
  });

  it("na volta calma, o atraso é refeito a partir da mesma montagem", () => {
    agora = 5_300;
    montar([1_200]);
    expect(compassos()).toEqual(["-500ms"]);
    agora = 16_000;
    montar([2_000]);
    expect(compassos()).toEqual(["-1300ms"]);
  });
});
