// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { gravarRefluxos, type RefluxosGravados } from "@/test/refluxo";

import { criarPalco, CURVA_DO_REFLUXO, progressoDoRefluxo } from "./palco-sem-saltos";
import { CARREGANDO } from "./tempo";

/**
 * O meio do cartão (data-palco="estica") quando dois refluxos se cruzam: o
 * topo e a base somam os deslocamentos (composite "add"), e o meio precisa
 * somar as alturas, o que a escala, que multiplica, não faz sozinha. O jsdom
 * não tem layout: o meio mede a altura que o teste dá a ele.
 */

let refluxos: RefluxosGravados;
let altura = 100;

beforeEach(() => {
  vi.useFakeTimers();
  refluxos = gravarRefluxos();
  altura = 100;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const alto = this.dataset.palco === "estica" ? altura : 0;
    return { top: 0, bottom: alto, left: 0, right: 600, width: 600, height: alto, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
  });
});

afterEach(() => {
  refluxos.restaurar();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/** O palco com só o meio do cartão. */
function palcoComMeio() {
  const elemento = document.createElement("div");
  const meio = document.createElement("span");
  meio.dataset.palco = "estica";
  elemento.appendChild(meio);
  const palco = criarPalco();
  palco.ref(elemento);
  return { palco, meio };
}

/** O cartão cresce (ou encolhe) para `nova` altura, numa rodada do palco. */
function mudar(palco: ReturnType<typeof criarPalco>, nova: number) {
  palco.antes();
  altura = nova;
  palco.depois();
}

const escalaDo = (quadro: Keyframe) => Number(String(quadro.scale).split(" ")[1]);

describe("a curva do refluxo em JS", () => {
  it("é a do CSS: parte de 0, chega a 1 e só sobe", () => {
    expect(CURVA_DO_REFLUXO).toBe("cubic-bezier(0.4, 0, 0.2, 1)");
    expect(progressoDoRefluxo(0)).toBe(0);
    expect(progressoDoRefluxo(1)).toBe(1);
    let anterior = 0;
    for (let passo = 1; passo <= 100; passo += 1) {
      const agora = progressoDoRefluxo(passo / 100);
      expect(agora).toBeGreaterThanOrEqual(anterior);
      anterior = agora;
    }
    // Começa devagar e chega devagar (a padrão do Material): no meio do tempo, mais da metade do caminho.
    expect(progressoDoRefluxo(0.1)).toBeLessThan(0.1);
    expect(progressoDoRefluxo(0.5)).toBeGreaterThan(0.6);
  });
});

describe("o meio do cartão", () => {
  it("sozinho, encolhe ou estica por uma escala de antes para 1, na curva do refluxo", async () => {
    const { palco, meio } = palcoComMeio();
    mudar(palco, 200);
    const [refluxo] = refluxos.de(meio);
    expect(refluxo.quadros).toEqual([{ scale: "1 0.5" }, { scale: "1 1" }]);
    expect(refluxo).toMatchObject({ composicao: "replace", curva: CURVA_DO_REFLUXO, duracao: CARREGANDO.refluiMs });
    await vi.advanceTimersByTimeAsync(0);
    expect(refluxos.de(meio)).toHaveLength(1);
    palco.encerrar();
  });

  it("dois refluxos que se cruzam: o primeiro quadro multiplica (certo seja quando for) e depois a altura vira a soma das duas, no relógio de cada uma", async () => {
    const { palco, meio } = palcoComMeio();
    const inicio = performance.now();
    mudar(palco, 200);
    await vi.advanceTimersByTimeAsync(50);
    mudar(palco, 300);
    // O primeiro quadro: a escala nova multiplica a que corre, e a altura na tela é a de antes desta mudança.
    const [primeiro, segundo] = refluxos.de(meio);
    expect(segundo.quadros).toEqual([{ scale: `1 ${200 / 300}` }, { scale: "1 1" }]);
    expect(segundo.composicao).toBe("add");

    // Quando a segunda começa, as duas viram uma, no relógio dela.
    await vi.advanceTimersByTimeAsync(0);
    expect(primeiro.cancelado).toBe(true);
    expect(segundo.cancelado).toBe(true);
    const composta = refluxos.de(meio).at(-1)!;
    expect(composta.cancelado).toBe(false);
    expect(composta).toMatchObject({ composicao: "replace", curva: "linear", duracao: CARREGANDO.refluiMs });
    expect(composta.inicio).toBe(inicio + 50);
    // A altura em cada quadro: a do layout mais o que falta de cada refluxo (100 px cada), na curva de cada um.
    const esperada = (desde: number) =>
      (300 + -100 * (1 - progressoDoRefluxo((50 + desde) / CARREGANDO.refluiMs)) + -100 * (1 - progressoDoRefluxo(desde / CARREGANDO.refluiMs))) / 300;
    for (const quadro of composta.quadros) {
      const desde = Number(quadro.offset) * CARREGANDO.refluiMs;
      expect(escalaDo(quadro), `aos ${desde} ms`).toBeCloseTo(esperada(desde), 6);
    }
    // No começo, a mesma altura que o primeiro quadro mostrava; no fim, a do layout.
    expect(escalaDo(composta.quadros[0]) * 300).toBeCloseTo(100 + 100 * progressoDoRefluxo(50 / CARREGANDO.refluiMs), 6);
    expect(escalaDo(composta.quadros.at(-1)!)).toBe(1);

    // Uma terceira mudança, com a composta correndo, entra do mesmo jeito e compõe as três.
    await vi.advanceTimersByTimeAsync(30);
    mudar(palco, 250);
    await vi.advanceTimersByTimeAsync(0);
    const ultima = refluxos.de(meio).at(-1)!;
    expect(composta.cancelado).toBe(true);
    expect(ultima.inicio).toBe(inicio + 80);
    const tres = (desde: number) =>
      (250 +
        -100 * (1 - progressoDoRefluxo((80 + desde) / CARREGANDO.refluiMs)) +
        -100 * (1 - progressoDoRefluxo((30 + desde) / CARREGANDO.refluiMs)) +
        50 * (1 - progressoDoRefluxo(desde / CARREGANDO.refluiMs))) /
      250;
    for (const quadro of ultima.quadros) expect(escalaDo(quadro)).toBeCloseTo(tres(Number(quadro.offset) * CARREGANDO.refluiMs), 6);
    palco.encerrar();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("depois que o primeiro termina, o seguinte volta a ser uma escala só", async () => {
    const { palco, meio } = palcoComMeio();
    mudar(palco, 200);
    await vi.advanceTimersByTimeAsync(CARREGANDO.refluiMs);
    mudar(palco, 300);
    await vi.advanceTimersByTimeAsync(0);
    const ultimo = refluxos.de(meio).at(-1)!;
    expect(ultimo).toMatchObject({ composicao: "replace", cancelado: false });
    expect(ultimo.quadros).toEqual([{ scale: `1 ${200 / 300}` }, { scale: "1 1" }]);
    palco.encerrar();
  });
});
