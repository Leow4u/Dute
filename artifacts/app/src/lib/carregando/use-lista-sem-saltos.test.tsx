// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CARREGANDO } from "./tempo";
import { useListaSemSaltos } from "./use-lista-sem-saltos";

/**
 * A lista sem saltos (carregamento v2, seção 9 e momento 4): a linha que sai
 * esmaece e as de baixo sobem por FLIP, só com transform; nada se mexe sob o
 * dedo (a saída espera até 3 s); o foco que estava na linha vai para a
 * seguinte ou para o título; no reduzido, sem deslocamento. O jsdom não tem
 * layout: cada linha mede 80 px, na ordem em que está na lista.
 */

const ALTURA = 80;
const TOPO_DA_LISTA = 120;

let raiz: Root | null = null;
let container: HTMLDivElement | null = null;

function Fila({ chaves, pronta = true }: { chaves: string[]; pronta?: boolean }) {
  const lista = useListaSemSaltos(chaves, { pronta });
  return (
    <section>
      <h2 ref={lista.titulo} tabIndex={-1}>
        Para aprovar
      </h2>
      <div ref={lista.ref} data-lista="">
        {lista.chaves.map((chave) => (
          <div key={chave} {...lista.linha(chave)}>
            <button type="button">Recusar {chave}</button>
            <button type="button" data-foco-da-linha="">
              Aprovar {chave}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

async function desenhar(chaves: string[], pronta = true) {
  await act(async () => {
    raiz!.render(<Fila chaves={chaves} pronta={pronta} />);
  });
}

async function passar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function lista(): HTMLElement {
  return container!.querySelector<HTMLElement>("[data-lista]")!;
}

function linha(chave: string): HTMLElement | null {
  return container!.querySelector<HTMLElement>(`[data-chave="${chave}"]`);
}

function naTela(): string[] {
  return Array.from(lista().querySelectorAll<HTMLElement>("[data-chave]")).map((item) => item.dataset.chave!);
}

function botao(rotulo: string): HTMLButtonElement {
  return Array.from(container!.querySelectorAll("button")).find((item) => item.textContent === rotulo)!;
}

async function tocarNaLista() {
  await act(async () => {
    lista().dispatchEvent(new Event("pointerdown", { bubbles: true }));
  });
}

/** Cada transform que o elemento teve, na ordem, até agora. */
function observarTransform(alvo: HTMLElement) {
  // O valor de antes de cada mudança; o primeiro é o de quando começou a observar.
  const valores: string[] = [];
  const guardar = (registros: MutationRecord[]) => {
    for (const registro of registros) valores.push(registro.oldValue ?? "");
  };
  const observador = new MutationObserver(guardar);
  observador.observe(alvo, { attributes: true, attributeFilter: ["style"], attributeOldValue: true });
  return () => {
    guardar(observador.takeRecords());
    observador.disconnect();
    return [...valores.slice(1), alvo.getAttribute("style") ?? ""].filter((valor) => valor.includes("transform"));
  };
}

function reduzido(ligado: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((consulta: string) => ({
      matches: ligado && consulta.includes("prefers-reduced-motion"),
      media: consulta,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })),
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // A linha mede 80 px e fica no lugar dela na lista; o transform não conta (o layout).
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const pai = this.parentElement;
    const irmas = pai ? Array.from(pai.children).filter((filho) => filho.hasAttribute("data-chave")) : [];
    const topo = this.hasAttribute("data-chave") ? TOPO_DA_LISTA + irmas.indexOf(this) * ALTURA : TOPO_DA_LISTA;
    return { top: topo, bottom: topo + ALTURA, left: 0, right: 600, width: 600, height: ALTURA, x: 0, y: topo, toJSON: () => ({}) } as DOMRect;
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
});

afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  container?.remove();
  container = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("a linha que sai", () => {
  it("esmaece no lugar, sem toque e fora da árvore, e depois deixa a lista", async () => {
    await desenhar(["1042", "1043", "1045"]);
    await desenhar(["1043", "1045"]);

    expect(naTela()).toEqual(["1042", "1043", "1045"]);
    expect(linha("1042")?.dataset.naLista).toBe("saindo");
    expect(linha("1042")?.hasAttribute("inert")).toBe(true);
    expect(linha("1043")?.dataset.naLista).toBe("parada");

    await passar(CARREGANDO.saiLinhaMs - 1);
    expect(naTela()).toEqual(["1042", "1043", "1045"]);
    await passar(1);
    expect(naTela()).toEqual(["1043", "1045"]);
  });

  it("as de baixo sobem por FLIP: partem de onde estavam, só com transform, e as de cima não se mexem", async () => {
    await desenhar(["1040", "1042", "1043", "1045"]);
    await desenhar(["1040", "1043", "1045"]);
    const transformsDa1043 = observarTransform(linha("1043")!);
    const transformsDa1040 = observarTransform(linha("1040")!);

    await passar(CARREGANDO.saiLinhaMs);
    expect(naTela()).toEqual(["1040", "1043", "1045"]);
    // A 1043 subiu 80 px: partiu de +80 px e anda para o lugar novo com a transição do data-reflui.
    expect(transformsDa1043()).toEqual([expect.stringContaining("transform: translateY(80px)")]);
    expect(linha("1043")!.style.transform).toBe("");
    expect(linha("1043")!.hasAttribute("data-reflui")).toBe(true);
    expect(linha("1045")!.hasAttribute("data-reflui")).toBe(true);
    // A de cima ficou onde estava.
    expect(transformsDa1040()).toEqual([]);
    expect(linha("1040")!.hasAttribute("data-reflui")).toBe(false);

    await passar(CARREGANDO.refluiMs);
    expect(linha("1043")!.hasAttribute("data-reflui")).toBe(false);
  });

  it("a que volta às chaves antes de sair fica na lista", async () => {
    await desenhar(["1042", "1043"]);
    await desenhar(["1043"]);
    expect(linha("1042")?.dataset.naLista).toBe("saindo");
    await desenhar(["1042", "1043"]);
    expect(linha("1042")?.dataset.naLista).toBe("parada");
    expect(linha("1042")?.hasAttribute("inert")).toBe(false);
    await passar(CARREGANDO.saiLinhaMs + CARREGANDO.refluiMs);
    expect(naTela()).toEqual(["1042", "1043"]);
  });

  it("duas saídas seguidas: o fim do primeiro refluxo não corta o segundo, que começou depois", async () => {
    await desenhar(["1040", "1042", "1043", "1045", "1046"]);
    await desenhar(["1040", "1043", "1045", "1046"]);
    await passar(100);
    await desenhar(["1040", "1045", "1046"]);
    // Aos 200 ms a 1042 sai e as de baixo sobem até os 440 ms.
    await passar(100);
    expect(naTela()).toEqual(["1040", "1043", "1045", "1046"]);
    expect(linha("1045")!.hasAttribute("data-reflui")).toBe(true);
    // Aos 300 ms a 1043 sai, e a 1045 e a 1046 sobem de novo, até os 540 ms.
    await passar(100);
    expect(naTela()).toEqual(["1040", "1045", "1046"]);
    await passar(CARREGANDO.refluiMs - 100 + 1);
    expect(linha("1045")!.hasAttribute("data-reflui")).toBe(true);
    expect(linha("1046")!.hasAttribute("data-reflui")).toBe(true);
    await passar(100);
    expect(linha("1045")!.hasAttribute("data-reflui")).toBe(false);
    expect(linha("1046")!.hasAttribute("data-reflui")).toBe(false);
  });

  it("a tela que sai no meio da saída não deixa relógio nem erro", async () => {
    await desenhar(["1042", "1043"]);
    await desenhar(["1043"]);
    act(() => raiz?.unmount());
    raiz = null;
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("a lista não se mexe sob o dedo", () => {
  it("com um toque nos últimos 700 ms, a linha espera, congelada, e sai quando o dedo sai", async () => {
    await desenhar(["1042", "1043", "1045"]);
    await tocarNaLista();
    await desenhar(["1043", "1045"]);

    expect(linha("1042")?.dataset.naLista).toBe("esperando");
    expect(linha("1042")?.hasAttribute("inert")).toBe(false);
    await passar(CARREGANDO.dedoMs - 1);
    expect(linha("1042")?.dataset.naLista).toBe("esperando");
    await passar(1);
    expect(linha("1042")?.dataset.naLista).toBe("saindo");
    await passar(CARREGANDO.saiLinhaMs);
    expect(naTela()).toEqual(["1043", "1045"]);
  });

  it("o toque que continua segura a saída até 3 s, e não mais", async () => {
    await desenhar(["1042", "1043", "1045"]);
    await tocarNaLista();
    await desenhar(["1043", "1045"]);
    // Um toque a cada 600 ms: o último, aos 2 400 ms, seguraria até os 3 100 ms.
    for (let vez = 0; vez < 4; vez += 1) {
      await passar(600);
      await tocarNaLista();
    }
    await passar(CARREGANDO.dedoMaxMs - 2_400 - 1);
    expect(linha("1042")?.dataset.naLista).toBe("esperando");
    await passar(1);
    expect(linha("1042")?.dataset.naLista).toBe("saindo");
  });

  it("também a linha que chega espera o dedo", async () => {
    await desenhar(["1043"]);
    await tocarNaLista();
    await desenhar(["1042", "1043"]);
    expect(naTela()).toEqual(["1043"]);
    await passar(CARREGANDO.dedoMs);
    expect(naTela()).toEqual(["1042", "1043"]);
  });

  it("a linha que voltou às chaves enquanto esperava o dedo, se sair de novo, espera o dedo do zero", async () => {
    await desenhar(["1042", "1043", "1045"]);
    await tocarNaLista();
    await desenhar(["1043", "1045"]);
    expect(linha("1042")?.dataset.naLista).toBe("esperando");
    await desenhar(["1042", "1043", "1045"]);
    expect(linha("1042")?.dataset.naLista).toBe("parada");
    await passar(10_000);

    // Sai de novo, e o dedo toca no meio do esmaecimento: o fim dele espera.
    await desenhar(["1043", "1045"]);
    expect(linha("1042")?.dataset.naLista).toBe("saindo");
    await passar(100);
    await tocarNaLista();
    await passar(CARREGANDO.saiLinhaMs - 100);
    expect(naTela()).toEqual(["1042", "1043", "1045"]);
    await passar(CARREGANDO.dedoMs - CARREGANDO.saiLinhaMs + 100);
    expect(naTela()).toEqual(["1043", "1045"]);
  });

  it("a linha que volta às chaves enquanto o dedo segura o fim do esmaecimento não deixa a lista", async () => {
    await desenhar(["1042", "1043", "1045"]);
    await desenhar(["1043", "1045"]);
    // Um toque a cada 600 ms, dos 100 aos 2 500 ms: o fim do esmaecimento espera até os 3 s.
    await passar(100);
    for (let vez = 0; vez < 4; vez += 1) {
      await tocarNaLista();
      await passar(600);
    }
    await tocarNaLista();
    await passar(400);
    // Aos 2 900 ms ela volta, e o dedo ainda segura a lista até os 3 200 ms.
    await desenhar(["1042", "1043", "1045"]);
    await passar(101);
    expect(naTela()).toEqual(["1042", "1043", "1045"]);
    await passar(200);
    expect(naTela()).toEqual(["1042", "1043", "1045"]);
    expect(linha("1042")?.dataset.naLista).toBe("parada");
  });
});

describe("o foco na linha que sai", () => {
  it("vai para a ação da linha seguinte", async () => {
    await desenhar(["1042", "1043", "1045"]);
    botao("Recusar 1042").focus();
    await desenhar(["1043", "1045"]);
    expect(document.activeElement).toBe(botao("Aprovar 1043"));
  });

  it("sem linha seguinte, vai para o título do grupo", async () => {
    await desenhar(["1043", "1045"]);
    botao("Aprovar 1045").focus();
    await desenhar(["1043"]);
    expect(document.activeElement).toBe(container!.querySelector("h2"));
  });

  it("o foco em outra linha fica onde está", async () => {
    await desenhar(["1042", "1043", "1045"]);
    botao("Aprovar 1045").focus();
    await desenhar(["1043", "1045"]);
    expect(document.activeElement).toBe(botao("Aprovar 1045"));
  });
});

describe("a linha que chega", () => {
  it("fica chegando por 1 s (o realce), sem empurrar as outras por transform", async () => {
    await desenhar(["1043", "1045"]);
    const transformsDa1043 = observarTransform(linha("1043")!);
    await desenhar(["1042", "1043", "1045"]);
    expect(naTela()).toEqual(["1042", "1043", "1045"]);
    expect(linha("1042")?.dataset.naLista).toBe("chegando");
    expect(linha("1043")?.dataset.naLista).toBe("parada");
    await passar(CARREGANDO.destaqueMs - 1);
    expect(linha("1042")?.dataset.naLista).toBe("chegando");
    await passar(1);
    expect(linha("1042")?.dataset.naLista).toBe("parada");
    expect(transformsDa1043()).toEqual([]);
  });

  it("a primeira leitura entra de uma vez: nem realce, nem saída", async () => {
    await desenhar([], false);
    await desenhar(["1042", "1043"], false);
    await desenhar(["1042", "1043", "1045"], true);
    expect(naTela()).toEqual(["1042", "1043", "1045"]);
    for (const chave of naTela()) expect(linha(chave)?.dataset.naLista, chave).toBe("parada");
  });
});

describe("no movimento reduzido", () => {
  it("a linha some no lugar e as de baixo pulam para o lugar, sem transform", async () => {
    reduzido(true);
    await desenhar(["1042", "1043", "1045"]);
    await desenhar(["1043", "1045"]);
    expect(linha("1042")?.dataset.naLista).toBe("saindo");
    const transformsDa1043 = observarTransform(linha("1043")!);
    await passar(CARREGANDO.saiLinhaMs);
    expect(naTela()).toEqual(["1043", "1045"]);
    expect(transformsDa1043()).toEqual([]);
    expect(linha("1043")!.hasAttribute("data-reflui")).toBe(false);
  });
});
