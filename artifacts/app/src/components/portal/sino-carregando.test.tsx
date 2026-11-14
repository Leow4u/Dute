// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";

import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosForaDaLista } from "@/test/textos";

import { ListaDeAvisos } from "./sino";

/**
 * O sino do portal no carregamento v2 (parte 13f). Antes: "Carregando..." em
 * texto seco, com três pontos, e a falha "Não foi possível carregar." sem
 * "Tentar de novo" (o `onSnapshot` que falha não volta sozinho).
 */

let raiz: Root | null = null;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  raiz = createRoot(container);
});

afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  container.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

const espera = (ms: number) => act(async () => new Promise((pronto) => setTimeout(pronto, ms)));

async function ate(condicao: () => unknown, limiteMs = 3_000) {
  const fim = Date.now() + limiteMs;
  while (!condicao()) {
    if (Date.now() > fim) throw new Error("A tela não chegou ao estado esperado em 3 s.");
    await espera(20);
  }
}

describe("o sino lendo e na falha", () => {
  it("lendo, a caixa e 'Carregando os avisos…' aos 300 ms", async () => {
    await act(async () =>
      raiz!.render(
        <Router ssrPath="/portal">
          <ListaDeAvisos avisos={null} erro={false} vistosAte={null} agora={new Date()} onTentar={() => undefined} />
        </Router>,
      ),
    );
    expect(container.textContent).toBe("Avisos");
    await ate(() => container.textContent?.includes("Carregando os avisos…"));
    expect(container.querySelector("[data-carregando-na-regiao] [data-spinner]")?.getAttribute("aria-hidden")).toBe("true");
    expect(textosForaDaLista(container.innerHTML, ["Avisos", "Carregando os avisos…"])).toEqual([]);
    expect(await violacoesDeAcessibilidade(container.innerHTML)).toEqual([]);
  });

  it("na falha, 'Tentar de novo' assina de novo", async () => {
    let tentativas = 0;
    await act(async () =>
      raiz!.render(
        <Router ssrPath="/portal">
          <ListaDeAvisos avisos={null} erro vistosAte={null} agora={new Date()} onTentar={() => (tentativas += 1)} />
        </Router>,
      ),
    );
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Não foi possível carregar os avisos.");
    const tentar = [...container.querySelectorAll<HTMLButtonElement>("button")].find((botao) => botao.textContent?.trim() === "Tentar de novo")!;
    await act(async () => tentar.click());
    expect(tentativas).toBe(1);
    expect(await violacoesDeAcessibilidade(container.innerHTML)).toEqual([]);
  });
});
