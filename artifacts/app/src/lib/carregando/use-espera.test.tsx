// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useEspera, type Espera, type OpcoesDaEspera } from "./use-espera";

/**
 * O useEspera com o relógio falso (carregamento v2, seção 3): nada antes de
 * 300 ms, o mínimo de 500 ms quando pedido, o objeto aos 3 s, o movimento
 * decorativo até 5 s, a demora e a volta calma aos 10 s, a desistência aos
 * 70 s.
 */

let raiz: Root | null = null;
let container: HTMLDivElement | null = null;
let vistos: Espera[] = [];

function Sonda({ ativa, opcoes }: { ativa: boolean; opcoes?: OpcoesDaEspera }) {
  vistos.push(useEspera(ativa, opcoes));
  return null;
}

function atual(): Espera {
  return vistos[vistos.length - 1];
}

function montar(ativa: boolean, opcoes?: OpcoesDaEspera) {
  act(() => raiz!.render(<Sonda ativa={ativa} opcoes={opcoes} />));
}

function passar(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vistos = [];
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
});

afterEach(() => {
  act(() => raiz?.unmount());
  container?.remove();
  raiz = null;
  container = null;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** A tela que demora a rodar: a primeira renderização segura a thread por `ms` (o relógio anda junto). */
function SondaLenta({ ms }: { ms: number }) {
  const espera = useEspera(true);
  vistos.push(espera);
  if (vistos.length === 1) vi.advanceTimersByTime(ms);
  return null;
}

describe("a espera no relógio", () => {
  it("com a thread ocupada no começo (a foto sendo compactada), o indicador entra assim que ela solta, não só aos 3 s", () => {
    act(() => raiz!.render(<SondaLenta ms={450} />));
    expect(atual().visivel).toBe(true);
    expect(atual().fase).toBe("andamento");
    passar(3_000);
    expect(atual().fase).toBe("com-objeto");
  });

  it("o tique que dispara um décimo de milissegundo antes do marco (o atraso fracionário truncado) não perde os 300 ms nem os 10 s", () => {
    // O relógio do navegador: o tique lê 299,9 e, logo depois, quem arma o
    // seguinte já lê 300,0. Só as leituras do useEspera passam pela fila.
    let relogio = 0;
    const fila: number[] = [];
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.spyOn(performance, "now").mockImplementation(() =>
      fila.length && (new Error().stack ?? "").includes("use-espera") ? fila.shift()! : relogio,
    );
    montar(true);
    expect(atual().visivel).toBe(false);
    relogio = 300;
    fila.push(299.9, 300);
    passar(300);
    expect(atual().visivel).toBe(true);
    expect(atual().fase).toBe("andamento");
    // Os marcos seguintes continuam: o objeto aos 3 s e a demora aos 10 s.
    relogio = 3_000;
    passar(2_700);
    expect(atual().fase).toBe("com-objeto");
    relogio = 5_000;
    passar(2_000);
    relogio = 10_000;
    fila.push(9_999.9, 10_000);
    passar(5_000);
    expect(atual().fase).toBe("demorando");
    expect(atual().calmo).toBe(true);
    vi.restoreAllMocks();
  });

  it("parada, não mostra nada", () => {
    montar(false);
    passar(20_000);
    expect(atual()).toEqual({ visivel: false, fase: "oculta", decorridoMs: 0, calmo: false, movimento: false });
  });

  it("nada antes de 300 ms; aos 300 ms o indicador entra, com movimento", () => {
    montar(true);
    expect(atual().visivel).toBe(false);
    expect(atual().fase).toBe("oculta");
    passar(299);
    expect(atual().visivel).toBe(false);
    expect(atual().fase).toBe("oculta");
    passar(1);
    expect(atual()).toEqual({ visivel: true, fase: "andamento", decorridoMs: 300, calmo: false, movimento: true });
  });

  it("a espera que acaba antes de 300 ms não pisca", () => {
    montar(true, { segurarMinimo: true });
    passar(250);
    montar(false, { segurarMinimo: true });
    passar(5_000);
    expect(vistos.some((espera) => espera.visivel)).toBe(false);
    expect(atual().fase).toBe("oculta");
  });

  it("com o mínimo pedido, o indicador que apareceu fica 500 ms na tela", () => {
    montar(true, { segurarMinimo: true });
    passar(400); // apareceu aos 300 ms
    expect(atual().visivel).toBe(true);
    montar(false, { segurarMinimo: true });
    expect(atual().visivel).toBe(true);
    expect(atual().fase).toBe("andamento");
    passar(399); // 799 ms: 499 ms na tela
    expect(atual().visivel).toBe(true);
    passar(1); // 800 ms: 500 ms na tela
    expect(atual().visivel).toBe(false);
    expect(atual().fase).toBe("oculta");
  });

  it("sem o mínimo, o dado não espera: o indicador sai na hora", () => {
    montar(true);
    passar(400);
    expect(atual().visivel).toBe(true);
    montar(false);
    expect(atual().visivel).toBe(false);
    expect(atual().fase).toBe("oculta");
  });

  it("o indicador que já ficou 500 ms sai na hora, mesmo com o mínimo", () => {
    montar(true, { segurarMinimo: true });
    passar(900);
    montar(false, { segurarMinimo: true });
    expect(atual().visivel).toBe(false);
  });

  it("voltar a esperar durante o mínimo não faz o indicador piscar", () => {
    montar(true, { segurarMinimo: true });
    passar(400);
    montar(false, { segurarMinimo: true });
    passar(100);
    montar(true, { segurarMinimo: true });
    expect(atual().visivel).toBe(true);
    expect(atual().fase).toBe("andamento");
    passar(2_000);
    expect(vistos.slice(vistos.findIndex((espera) => espera.visivel)).every((espera) => espera.visivel)).toBe(true);
  });

  it("aos 3 s o objeto, aos 5 s o fim do movimento, aos 10 s a demora calma e aos 70 s a desistência", () => {
    montar(true);
    passar(2_999);
    expect(atual().fase).toBe("andamento");
    passar(1);
    expect(atual()).toMatchObject({ fase: "com-objeto", movimento: true, calmo: false });
    passar(1_999);
    expect(atual().movimento).toBe(true);
    passar(1);
    expect(atual()).toMatchObject({ fase: "com-objeto", movimento: false, calmo: false, decorridoMs: 5_000 });
    passar(4_999);
    expect(atual()).toMatchObject({ fase: "com-objeto", calmo: false });
    passar(1);
    expect(atual()).toMatchObject({ visivel: true, fase: "demorando", calmo: true, movimento: false, decorridoMs: 10_000 });
    passar(59_999);
    expect(atual().fase).toBe("demorando");
    passar(1);
    expect(atual()).toMatchObject({ visivel: true, fase: "sem-resposta", calmo: true, decorridoMs: 70_000 });
  });

  it("depois de 10 s, o decorrido anda a cada segundo (o 0:12 da linha)", () => {
    montar(true);
    passar(10_000);
    expect(atual().decorridoMs).toBe(10_000);
    passar(999);
    expect(atual().decorridoMs).toBe(10_000);
    passar(1);
    expect(atual().decorridoMs).toBe(11_000);
    passar(1_000);
    expect(atual().decorridoMs).toBe(12_000);
  });

  it("a desistência pode ser outra: 180 s no chat do Agent Dute", () => {
    montar(true, { desisteMs: 180_000 });
    passar(70_000);
    expect(atual().fase).toBe("demorando");
    passar(110_000);
    expect(atual().fase).toBe("sem-resposta");
  });

  it("cada espera começa do zero", () => {
    montar(true);
    passar(12_000);
    expect(atual().fase).toBe("demorando");
    montar(false);
    passar(1_000);
    montar(true);
    expect(atual().visivel).toBe(false);
    passar(300);
    expect(atual()).toMatchObject({ visivel: true, fase: "andamento", calmo: false, movimento: true, decorridoMs: 300 });
  });

  it("a que continua outra (desde) segue o relógio dela: o que já tinha aparecido aparece na hora", () => {
    passar(20_000);
    montar(true, { desde: performance.now() - 6_000 });
    expect(atual()).toMatchObject({ visivel: true, fase: "com-objeto", decorridoMs: 6_000, movimento: false });
    passar(4_000);
    expect(atual()).toMatchObject({ fase: "demorando", calmo: true });
    // O que ainda não tinha passado de 300 ms espera o resto, e não o atraso inteiro.
    act(() => raiz!.unmount());
    raiz = createRoot(container!);
    montar(true, { desde: performance.now() - 200 });
    expect(atual().visivel).toBe(false);
    passar(100);
    expect(atual()).toMatchObject({ visivel: true, fase: "andamento", decorridoMs: 300 });
  });
});

/**
 * O timer e o relógio do performance não batem no navegador: medido no
 * Chromium (parte 8), o timer dos 300 ms disparou com o performance em 299,8
 * ms, e a leitura seguinte, já depois dos 300, armou o próximo marco nos 3 s.
 * A linha de estado ficava sem "Carregando pedidos…" (e sem o anúncio) até os
 * 3 s, enquanto as linhas-fantasma, no mesmo relógio, já tinham entrado. O
 * marco para o qual o timer foi armado vale como alcançado.
 */
describe("o timer que dispara um pouco antes do marco", () => {
  /** A primeira leitura do performance dentro de cada timer vem `antesMs` atrás do relógio, como no Chromium. */
  function timersAdiantados(antesMs: number) {
    const agoraFalso = performance.now.bind(performance);
    const setTimeoutFalso = globalThis.setTimeout;
    let atraso = 0;
    vi.spyOn(performance, "now").mockImplementation(() => {
      const instante = agoraFalso() - atraso;
      atraso = 0;
      return instante;
    });
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((fazer: (...argumentos: unknown[]) => void, ms?: number, ...argumentos: unknown[]) =>
      setTimeoutFalso(() => {
        atraso = antesMs;
        fazer(...argumentos);
      }, ms)) as typeof setTimeout);
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("o marco alcançado conta inteiro, mesmo quando a conta do relógio arredonda para baixo (o 300 virando 299,99…)", () => {
    // Com o começo em 7909,879733812541, (começo + 300) − começo dá 299,9999999999991 em ponto flutuante. O tique que
    // dispara uma fração antes do marco usava esse instante, não marcava, e o indicador só entrava aos 3 s.
    const comeco = 7_909.879733812541;
    expect(comeco + 300 - comeco).toBeLessThan(300);
    let relogio = comeco;
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.spyOn(performance, "now").mockImplementation(() => relogio);
    montar(true);
    expect(atual().visivel).toBe(false);
    relogio = comeco + 299.9;
    passar(300);
    expect(atual()).toMatchObject({ visivel: true, fase: "andamento" });
    relogio = comeco + 2_999.9;
    passar(2_700);
    expect(atual().fase).toBe("com-objeto");
    relogio = comeco + 9_999.9;
    passar(7_000);
    expect(atual()).toMatchObject({ fase: "demorando", calmo: true });
    vi.restoreAllMocks();
  });

  it("aos 300 ms o indicador entra, mesmo com o timer 0,2 ms adiantado; e os marcos seguintes também", () => {
    timersAdiantados(0.2);
    montar(true);
    passar(299);
    expect(atual().visivel).toBe(false);
    passar(1);
    expect(atual()).toMatchObject({ visivel: true, fase: "andamento" });
    passar(2_700);
    expect(atual().fase).toBe("com-objeto");
    passar(7_000);
    expect(atual()).toMatchObject({ fase: "demorando", calmo: true });
  });
});
