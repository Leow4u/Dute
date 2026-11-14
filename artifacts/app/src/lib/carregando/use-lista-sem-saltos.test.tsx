// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";

import { gravarRefluxos, type RefluxosGravados } from "@/test/refluxo";

import { CURVA_DO_REFLUXO, usePalcoSemSaltos } from "./palco-sem-saltos";
import { CARREGANDO } from "./tempo";
import { useListaSemSaltos } from "./use-lista-sem-saltos";

/**
 * A lista sem saltos (carregamento v2, seção 9 e momento 4): a linha que sai
 * esmaece e as de baixo sobem por FLIP, só com transform; nada se mexe sob o
 * dedo (a saída espera até 3 s); o foco que estava na linha vai para a
 * seguinte ou para o título; no reduzido, sem deslocamento. O jsdom não tem
 * layout: cada linha mede 80 px, na ordem em que está na lista, e o refluxo
 * que corre soma o que falta dele (linear), como o navegador mede a peça no
 * meio do caminho.
 */

const ALTURA = 80;
const TOPO_DA_LISTA = 120;

let raiz: Root | null = null;
let container: HTMLDivElement | null = null;
let refluxos: RefluxosGravados;

/** O deslocamento que os refluxos que correm na peça ainda dão agora (lineares, para o teste). */
function noMeioDoRefluxo(peca: Element): number {
  return refluxos.noMeio(peca);
}

function Fila({ chaves, pronta = true, realcar, celular = false }: { chaves: string[]; pronta?: boolean; realcar?: (chave: string) => boolean; celular?: boolean }) {
  const lista = useListaSemSaltos(chaves, { pronta, realcar });
  return (
    <section>
      <h2 ref={lista.titulo} tabIndex={-1}>
        Para aprovar
      </h2>
      <div ref={lista.ref} data-lista="">
        {lista.chaves.map((chave) => (
          <div key={chave} {...lista.linha(chave)}>
            {/* Como a linha do pedido: a ação do computador e, no celular, a mesma de novo, depois dos itens. */}
            <div className={celular ? "hidden sm:flex" : undefined}>
              <button type="button">Recusar {chave}</button>
              <button type="button" data-foco-da-linha="">
                Aprovar {chave}
              </button>
            </div>
            {celular ? (
              <div className="sm:hidden">
                <button type="button" data-foco-da-linha="" data-celular="">
                  Aprovar {chave}
                </button>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}

async function desenhar(chaves: string[], pronta = true, realcar?: (chave: string) => boolean, celular = false) {
  await act(async () => {
    raiz!.render(<Fila chaves={chaves} pronta={pronta} realcar={realcar} celular={celular} />);
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

/** De onde cada refluxo da peça partiu, na ordem. */
function partidas(alvo: Element): number[] {
  return refluxos.de(alvo).map((refluxo) => refluxo.anda);
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
  refluxos = gravarRefluxos();
  // A linha mede 80 px e fica no lugar dela na lista, mais o que falta do refluxo que corre nela.
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const pai = this.parentElement;
    const irmas = pai ? Array.from(pai.children).filter((filho) => filho.hasAttribute("data-chave")) : [];
    const topo = (this.hasAttribute("data-chave") ? TOPO_DA_LISTA + irmas.indexOf(this) * ALTURA : TOPO_DA_LISTA) + noMeioDoRefluxo(this);
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
  refluxos.restaurar();
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

    await passar(CARREGANDO.saiLinhaMs);
    expect(naTela()).toEqual(["1040", "1043", "1045"]);
    // A 1043 subiu 80 px: parte de +80 px e anda para o lugar novo em 240 ms, na curva padrão, só pelo translate.
    expect(partidas(linha("1043")!)).toEqual([80]);
    expect(partidas(linha("1045")!)).toEqual([80]);
    const [refluxo] = refluxos.de(linha("1043")!);
    expect(refluxo.duracao).toBe(CARREGANDO.refluiMs);
    expect(refluxo.curva).toBe(CURVA_DO_REFLUXO);
    expect(refluxo.quadros).toEqual([{ translate: "0 80px" }, { translate: "0 0" }]);
    expect(linha("1043")!.getAttribute("style")).toBeNull();
    // A de cima ficou onde estava.
    expect(partidas(linha("1040")!)).toEqual([]);

    await passar(CARREGANDO.refluiMs);
    expect(refluxos.correndo(linha("1043")!)).toEqual([]);
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

  it("duas saídas seguidas: o segundo refluxo soma com o primeiro, que segue no relógio dele, e a peça não pula nem para", async () => {
    await desenhar(["1040", "1042", "1043", "1045", "1046"]);
    await desenhar(["1040", "1043", "1045", "1046"]);
    await passar(100);
    await desenhar(["1040", "1045", "1046"]);
    // Aos 200 ms a 1042 sai e as de baixo sobem até os 440 ms, também a 1043, que ainda esmaece.
    await passar(100);
    expect(naTela()).toEqual(["1040", "1043", "1045", "1046"]);
    expect(linha("1043")?.dataset.naLista).toBe("saindo");
    expect(partidas(linha("1043")!)).toEqual([80]);
    expect(partidas(linha("1045")!)).toEqual([80]);
    // Aos 300 ms a 1043 sai: a 1045 ainda estava a 80 × 140/240 px do lugar. O primeiro refluxo segue, e o
    // segundo soma os 80 px da mudança: a peça fica onde estava, sem cancelar nem recomeçar do zero.
    await passar(100);
    expect(naTela()).toEqual(["1040", "1045", "1046"]);
    const [primeiro, segundo] = refluxos.de(linha("1045")!);
    expect(primeiro).toMatchObject({ anda: 80, composicao: "replace", cancelado: false });
    expect(segundo).toMatchObject({ composicao: "add", cancelado: false });
    expect(segundo.anda).toBeCloseTo(80, 5);
    expect(linha("1045")!.getBoundingClientRect().top).toBeCloseTo(TOPO_DA_LISTA + ALTURA + 80 + (80 * 140) / 240, 5);
    expect(refluxos.correndo(linha("1046")!).map((refluxo) => Math.round(refluxo.anda))).toEqual([80, 80]);
    // O primeiro termina aos 440 ms; o segundo, aos 540.
    await passar(CARREGANDO.refluiMs - 100);
    expect(refluxos.correndo(linha("1045")!)).toEqual([segundo]);
    await passar(99);
    expect(refluxos.correndo(linha("1045")!)).toEqual([segundo]);
    await passar(1);
    expect(refluxos.correndo(linha("1045")!)).toEqual([]);
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
  it("no celular, vai para a ação da linha seguinte que se vê, não para a do computador, escondida", async () => {
    // No celular (abaixo do sm), o que está dentro de um .hidden não se vê.
    Object.defineProperty(HTMLElement.prototype, "checkVisibility", {
      configurable: true,
      writable: true,
      value: function checkVisibility(this: HTMLElement) {
        return this.closest(".hidden") === null;
      },
    });
    onTestFinished(() => {
      delete (HTMLElement.prototype as { checkVisibility?: unknown }).checkVisibility;
    });
    await desenhar(["1042", "1043", "1045"], true, undefined, true);
    const doCelular = (chave: string) => linha(chave)!.querySelector<HTMLButtonElement>("[data-celular]")!;
    doCelular("1042").focus();
    await desenhar(["1043", "1045"], true, undefined, true);
    expect(document.activeElement).toBe(doCelular("1043"));
  });

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
  it("fica chegando enquanto espera o cartão e entra, sem realce, e as de baixo descem por FLIP, sem pular", async () => {
    await desenhar(["1043", "1045"]);
    await desenhar(["1042", "1043", "1045"]);
    expect(naTela()).toEqual(["1042", "1043", "1045"]);
    expect(linha("1042")?.dataset.naLista).toBe("chegando");
    // A releitura e o tempo real não dão sinal: sem a ação nesta tela, nada de realce.
    expect(linha("1042")?.hasAttribute("data-realce")).toBe(false);
    expect(linha("1043")?.dataset.naLista).toBe("parada");
    // A 1043 desceu 80 px: parte de onde estava e anda para o lugar novo, só por transform; a que chega, não.
    expect(partidas(linha("1043")!)).toEqual([-80]);
    expect(partidas(linha("1042")!)).toEqual([]);
    await passar(CARREGANDO.chegaEsperaMs + CARREGANDO.destaqueMs - 1);
    expect(linha("1042")?.dataset.naLista).toBe("chegando");
    await passar(1);
    expect(linha("1042")?.dataset.naLista).toBe("parada");
  });

  it("só a que chegou por uma ação nesta tela tem o realce", async () => {
    await desenhar(["1043"], true, (chave) => chave === "1042");
    await desenhar(["1042", "1043", "1046"], true, (chave) => chave === "1042");
    expect(linha("1042")?.dataset.naLista).toBe("chegando");
    expect(linha("1042")?.hasAttribute("data-realce")).toBe(true);
    expect(linha("1046")?.dataset.naLista).toBe("chegando");
    expect(linha("1046")?.hasAttribute("data-realce")).toBe(false);
    await passar(CARREGANDO.chegaEsperaMs + CARREGANDO.destaqueMs);
    expect(linha("1042")?.dataset.naLista).toBe("parada");
    expect(linha("1042")?.hasAttribute("data-realce")).toBe(false);
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
    await passar(CARREGANDO.saiLinhaMs);
    expect(naTela()).toEqual(["1043", "1045"]);
    expect(refluxos.todos()).toEqual([]);
  });
});

/**
 * O palco da tela: a saída de uma fila e a chegada na outra refluem de uma
 * vez, com o título e as linhas do grupo de baixo, da foto de antes da
 * mudança. O layout falso empilha a fila A (80 px por linha), o título da B
 * (40 px) e a fila B, nessa ordem.
 */
describe("com o palco da tela", () => {
  function DuasFilas({ a, b }: { a: string[]; b: string[] }) {
    const palco = usePalcoSemSaltos();
    const filaA = useListaSemSaltos(a, { palco });
    // Como em Pedidos: o que ainda está na tela da A não entra na B.
    const naA = new Set(filaA.chaves);
    const filaB = useListaSemSaltos(
      b.filter((chave) => !naA.has(chave)),
      { palco },
    );
    return (
      <div ref={palco.ref} data-palco-de-teste="">
        <div ref={filaA.ref} data-lista="a">
          {filaA.chaves.map((chave) => (
            <div key={chave} {...filaA.linha(chave)}>
              {chave}
            </div>
          ))}
        </div>
        <h2 data-palco="bloco">B</h2>
        <div ref={filaB.ref} data-lista="b">
          {filaB.chaves.map((chave) => (
            <div key={chave} {...filaB.linha(chave)}>
              {chave}
            </div>
          ))}
        </div>
      </div>
    );
  }

  /** A posição no layout falso: as linhas e o título empilhados na ordem do palco, mais o refluxo que corre. */
  function noPalco(alvo: HTMLElement): DOMRect {
    const palco = container!.querySelector("[data-palco-de-teste]")!;
    let topo = 0;
    let achado: [number, number] | null = null;
    for (const peca of Array.from(palco.querySelectorAll<HTMLElement>("[data-chave], h2"))) {
      const altura = peca.tagName === "H2" ? 40 : ALTURA;
      if (peca === alvo) achado = [topo, altura];
      topo += altura;
    }
    const [lugar, height] = achado ?? [0, 0];
    const top = lugar + noMeioDoRefluxo(alvo);
    return { top, bottom: top + height, left: 0, right: 600, width: 600, height, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
  }

  async function desenharDuas(a: string[], b: string[]) {
    await act(async () => {
      raiz!.render(<DuasFilas a={a} b={b} />);
    });
  }

  function emB(chave: string): HTMLElement | null {
    return container!.querySelector<HTMLElement>(`[data-lista="b"] [data-chave="${chave}"]`);
  }

  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return noPalco(this);
    });
  });

  it("a saída da A leva junto o título e as linhas da B, só por transform", async () => {
    await desenharDuas(["1042", "1043"], ["2001"]);
    await desenharDuas(["1043"], ["2001"]);
    const titulo = container!.querySelector<HTMLElement>("h2")!;

    await passar(CARREGANDO.saiLinhaMs);
    expect(partidas(titulo)).toEqual([80]);
    expect(partidas(emB("2001")!)).toEqual([80]);
    await passar(CARREGANDO.refluiMs);
    expect(refluxos.correndo(titulo)).toEqual([]);
  });

  it("o palco lê todas as peças antes de mexer em qualquer uma: um layout só no quadro do soltar", async () => {
    await desenharDuas(["1042", "1043"], ["2001", "2002"]);
    await desenharDuas(["1043"], ["2001", "2002"]);
    // Quantos refluxos já tinham começado em cada leitura de posição.
    const leituras: number[] = [];
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      leituras.push(refluxos.todos().length);
      return noPalco(this);
    });

    await passar(CARREGANDO.saiLinhaMs);
    expect(refluxos.todos().length).toBeGreaterThanOrEqual(3);
    expect(leituras.length).toBeGreaterThan(0);
    expect(leituras.every((quantos) => quantos === 0)).toBe(true);
  });

  it("o refluxo leva a linha que chega e a que sai, somando com o transform delas: só translate, nunca transform", async () => {
    await desenharDuas(["1042", "1043"], ["2001"]);
    // Chega a 2000 no topo da B, e logo a 1043 começa a sair da A.
    await desenharDuas(["1042", "1043"], ["2000", "2001"]);
    expect(emB("2000")?.dataset.naLista).toBe("chegando");
    await desenharDuas(["1042"], ["2000", "2001"]);
    await passar(50);
    // A 1042 sai da A enquanto a 1043 esmaece embaixo dela.
    await desenharDuas([], ["2000", "2001"]);
    await passar(CARREGANDO.saiLinhaMs - 50);
    // Aos 200 ms a 1043 deixa a A: a 1042, que esmaece, não se mexe (está em cima); a 2000, que chega, sobe 80.
    expect(emB("2000")?.dataset.naLista).toBe("chegando");
    expect(partidas(emB("2000")!).at(-1)).toBe(80);
    await passar(50);
    // Aos 250 ms a 1042 deixa a A: tudo abaixo sobe mais 80, também a que chega, somado ao que ela ainda subia.
    expect(refluxos.correndo(emB("2000")!).map((refluxo) => [Math.round(refluxo.anda), refluxo.composicao])).toEqual([
      [80, "replace"],
      [80, "add"],
    ]);
    for (const refluxo of refluxos.todos()) {
      for (const quadro of refluxo.quadros) expect(Object.keys(quadro).every((nome) => nome === "translate" || nome === "scale")).toBe(true);
    }
  });

  it("um toque numa fila segura a outra: nada no palco se mexe sob o dedo", async () => {
    await desenharDuas(["1042", "1043"], ["2001"]);
    await act(async () => {
      container!.querySelector('[data-lista="b"]')!.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    await desenharDuas(["1043"], ["2001"]);
    const saiDaA = () => container!.querySelector<HTMLElement>('[data-lista="a"] [data-chave="1042"]');
    expect(saiDaA()?.dataset.naLista).toBe("esperando");
    await passar(CARREGANDO.dedoMs - 1);
    expect(saiDaA()?.dataset.naLista).toBe("esperando");
    expect(refluxos.todos()).toEqual([]);
    await passar(1);
    expect(saiDaA()?.dataset.naLista).toBe("saindo");
  });

  it("a linha que sai da A e entra na B reflui de uma vez, da foto de antes: quem fica no mesmo lugar não se mexe", async () => {
    await desenharDuas(["1042"], ["2001"]);
    await desenharDuas([], ["1042", "2001"]);
    // Enquanto esmaece na A, ela não entra na B.
    expect(emB("1042")).toBeNull();
    const titulo = container!.querySelector<HTMLElement>("h2")!;

    await passar(CARREGANDO.saiLinhaMs);
    expect(emB("1042")?.dataset.naLista).toBe("chegando");
    // O título sobe 80 px; a 2001, que tinha a 1042 em cima e agora tem a 1042 em cima de novo, fica onde estava.
    expect(partidas(titulo)).toEqual([80]);
    expect(partidas(emB("2001")!)).toEqual([]);
    // A que chega não reflui: ela entra.
    expect(partidas(emB("1042")!)).toEqual([]);
  });

  it("no movimento reduzido nada desliza: o título e as linhas pulam para o lugar", async () => {
    reduzido(true);
    await desenharDuas(["1042", "1043"], ["2001"]);
    await desenharDuas(["1043"], ["2001"]);
    await passar(CARREGANDO.saiLinhaMs);
    expect(refluxos.todos()).toEqual([]);
  });

  it("a tela que sai no meio do refluxo não deixa relógio", async () => {
    await desenharDuas(["1042", "1043"], ["2001"]);
    await desenharDuas(["1043"], ["2001"]);
    await passar(CARREGANDO.saiLinhaMs + 10);
    act(() => raiz?.unmount());
    raiz = null;
    expect(vi.getTimerCount()).toBe(0);
  });
});
