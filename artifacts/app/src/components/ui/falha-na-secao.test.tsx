// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CARREGANDO } from "@/lib/carregando/tempo";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosForaDaLista } from "@/test/textos";

import { FalhaNaSecao } from "./falha-na-secao";

/**
 * A falha de uma parte da tela (carregamento v2, parte 13e): o "Tentando de
 * novo…" só na tentativa que a pessoa pediu (a releitura do intervalo não muda
 * o botão), a frase que não fala quando o que estava lido fica na tela, e o
 * foco que não cai no body quando a nova tentativa dá certo.
 */

let raiz: Root | null = null;
let container: HTMLDivElement;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance", "Date"] });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  raiz = createRoot(container);
});

afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function passar(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

const botao = () => container.querySelector<HTMLButtonElement>("[data-falha-na-secao] button")!;

describe("a falha na seção", () => {
  it("a releitura automática (tentando sem o toque) não vira Tentando de novo…", () => {
    act(() => raiz!.render(<FalhaNaSecao mensagem="Não foi possível ler a ocupação." tentando onTentar={() => undefined} />));
    passar(CARREGANDO.atrasoMs + 200);
    expect(botao().textContent).toBe("Tentar de novo");
    expect(botao().hasAttribute("aria-busy")).toBe(false);
    expect(botao().hasAttribute("aria-disabled")).toBe(false);
  });

  it("o toque: Tentando de novo… aos 300 ms, até a promessa da releitura acabar (e o mínimo de 500 ms)", async () => {
    let acabar: () => void = () => undefined;
    const onTentar = vi.fn(() => new Promise<void>((pronto) => (acabar = pronto)));
    act(() => raiz!.render(<FalhaNaSecao mensagem="Não foi possível ler a ocupação." tentando={false} onTentar={onTentar} />));
    act(() => botao().click());
    expect(onTentar).toHaveBeenCalledTimes(1);
    passar(CARREGANDO.atrasoMs);
    expect(botao().textContent).toBe("Tentando de novo…");
    expect(botao().getAttribute("aria-disabled")).toBe("true");
    expect(botao().disabled).toBe(false);
    // O toque repetido enquanto tenta não relê de novo.
    act(() => botao().click());
    expect(onTentar).toHaveBeenCalledTimes(1);
    await act(async () => acabar());
    passar(CARREGANDO.minimoMs);
    expect(botao().textContent).toBe("Tentar de novo");
    expect(
      textosForaDaLista(container.innerHTML, ["Não foi possível ler a ocupação.", "Tentar de novo", "Tentando de novo…"]),
    ).toEqual([]);
  });

  it("a frase é alerta sem nada lido; com o que já estava lido na tela, fica escrita, sem falar", async () => {
    act(() =>
      raiz!.render(
        <>
          <FalhaNaSecao mensagem="Não foi possível ler as pessoas." tentando={false} onTentar={() => undefined} />
          <FalhaNaSecao mensagem="Não foi possível atualizar as pessoas." alerta={false} tentando={false} onTentar={() => undefined} />
        </>,
      ),
    );
    const [semNada, relida] = [...container.querySelectorAll("[data-falha-na-secao] p")];
    expect(semNada!.getAttribute("role")).toBe("alert");
    expect(relida!.hasAttribute("role")).toBe(false);
    const html = container.innerHTML;
    vi.useRealTimers();
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });

  it("a nova tentativa que deu certo: o aviso sai, e o foco vai ao título da seção, nunca ao body", async () => {
    function Secao() {
      const [lida, setLida] = useState(false);
      return (
        <section>
          <h2>Armazém</h2>
          {lida ? (
            <p>Rua A: 3 de 10 ocupadas</p>
          ) : (
            <FalhaNaSecao mensagem="Não foi possível ler a ocupação." tentando={false} onTentar={() => setLida(true)} />
          )}
        </section>
      );
    }
    act(() => raiz!.render(<Secao />));
    botao().focus();
    await act(async () => botao().click());
    expect(container.querySelector("[data-falha-na-secao]")).toBeNull();
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement?.textContent).toBe("Armazém");
  });

  it("no celular, o Tentar de novo tem 44 px", () => {
    act(() => raiz!.render(<FalhaNaSecao mensagem="Falhou." tentando={false} onTentar={() => undefined} />));
    expect(botao().className).toContain("max-md:min-h-11");
  });
});
