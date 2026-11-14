// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SaiComOFoco } from "./use-foco-que-segue";

/**
 * O pedaço da tela que sai com o foco dentro (carregamento v2, seção 7; a
 * junção das partes 10 e 13): o foco vai ao alvo que entrou no lugar e, sem
 * ele, ao título da seção, nunca ao `body`. O alvo que está na tela mas não
 * pode receber o foco (o "Entrega" travado enquanto outra ação grava, o que
 * está numa lista inerte ou escondida) conta como ausente: o título da seção,
 * e não o da página, longe de onde a pessoa estava.
 */

let raiz: Root | null = null;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
});

afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

type Alvo = "livre" | "disabled" | "inert" | "escondido" | "ausente";

function Tela({ chegou, alvo, segundo = false }: { chegou: boolean; alvo: Alvo; segundo?: boolean }) {
  const entrega =
    alvo === "ausente" ? null : alvo === "inert" ? (
      <div inert>
        <button id="entrega-1">Entrega</button>
      </div>
    ) : alvo === "escondido" ? (
      <div aria-hidden="true">
        <button id="entrega-1">Entrega</button>
      </div>
    ) : (
      <button id="entrega-1" disabled={alvo === "disabled"}>
        Entrega
      </button>
    );
  return (
    <main>
      <h1>Pedidos</h1>
      <section>
        <h2>Para entregar</h2>
        {chegou ? (
          <>
            {entrega}
            {segundo ? <button id="entrega-2">Alterar entrega</button> : null}
          </>
        ) : (
          <SaiComOFoco alvo={segundo ? ["entrega-1", "entrega-2"] : "entrega-1"}>
            <button>Tentar de novo</button>
          </SaiComOFoco>
        )}
      </section>
    </main>
  );
}

async function focoDepoisDaSaida(alvo: Alvo, segundo = false) {
  act(() => raiz!.render(<Tela chegou={false} alvo={alvo} segundo={segundo} />));
  container.querySelector<HTMLButtonElement>("button")!.focus();
  act(() => raiz!.render(<Tela chegou alvo={alvo} segundo={segundo} />));
  // A saída é lida numa microtarefa, depois do commit.
  await act(async () => {
    await Promise.resolve();
  });
  const ativo = document.activeElement as HTMLElement | null;
  return `${ativo?.tagName}:${ativo?.textContent}`;
}

describe("a SaiComOFoco", () => {
  it("leva o foco ao alvo que entrou no lugar", async () => {
    expect(await focoDepoisDaSaida("livre")).toBe("BUTTON:Entrega");
  });

  it("sem o alvo na tela, ao título da seção", async () => {
    expect(await focoDepoisDaSaida("ausente")).toBe("H2:Para entregar");
  });

  it.each<Alvo>(["disabled", "inert", "escondido"])("com o alvo na tela que não pode receber o foco (%s), ao título da seção, não ao da página", async (alvo) => {
    expect(await focoDepoisDaSaida(alvo)).toBe("H2:Para entregar");
  });

  it("com vários alvos, o primeiro que pode receber o foco", async () => {
    act(() => raiz!.render(<Tela chegou={false} alvo="disabled" segundo />));
    container.querySelector<HTMLButtonElement>("button")!.focus();
    act(() => raiz!.render(<Tela chegou alvo="disabled" segundo />));
    await act(async () => {
      await Promise.resolve();
    });
    expect(document.activeElement?.id).toBe("entrega-2");
  });
});
