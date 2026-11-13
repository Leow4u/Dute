import { describe, expect, it } from "vitest";

import { CARREGANDO, faseDaEspera, podeEsconder, relogioDaEspera } from "./tempo";

/**
 * O relógio da espera (carregamento v2, seção 3 da especificação de
 * 12/11/2026): uma regra só para a leitura, a ação, a linha, a abertura, o
 * Agent Dute e o leitor de tela.
 */

describe("o relógio da espera", () => {
  it("os tempos são os aprovados", () => {
    expect(CARREGANDO).toEqual({
      atrasoMs: 300,
      minimoMs: 500,
      objetoNaLinhaMs: 3_000,
      movimentoMaxMs: 5_000,
      demoraMs: 10_000,
      desisteMs: 70_000,
      sucessoVisivelMs: 1_000,
      erroVisivelMs: 2_000,
      dedoMs: 700,
      dedoMaxMs: 3_000,
      saiLinhaMs: 200,
      refluiMs: 240,
      chegaLinhaMs: 240,
      chegaEsperaMs: 180,
      destaqueMs: 1_000,
      // O texto da linha de estado que sai (parte 7b), no tempo da troca do rótulo do botão.
      trocaSaiMs: 80,
      contaMs: 160,
      // A conexão (momento 8): sem rede há 3 s é "Sem conexão", cada aviso fica 2 s, e a releitura sozinha vai de 2 a 30 s.
      semRedeMs: 3_000,
      avisoMinimoMs: 2_000,
      releituraMs: 2_000,
      releituraMaxMs: 30_000,
    });
  });

  it("nada aparece antes de 300 ms", () => {
    expect(faseDaEspera(0)).toBe("oculta");
    expect(faseDaEspera(299)).toBe("oculta");
    expect(faseDaEspera(300)).toBe("andamento");
    expect(faseDaEspera(2_999)).toBe("andamento");
  });

  it("aos 3 s o objeto entra na linha, aos 10 s a demora e aos 70 s a desistência", () => {
    expect(faseDaEspera(3_000)).toBe("com-objeto");
    expect(faseDaEspera(9_999)).toBe("com-objeto");
    expect(faseDaEspera(10_000)).toBe("demorando");
    expect(faseDaEspera(69_999)).toBe("demorando");
    expect(faseDaEspera(70_000)).toBe("sem-resposta");
    expect(faseDaEspera(600_000)).toBe("sem-resposta");
  });

  it("a desistência pode ser outra: 180 s no chat do Agent Dute", () => {
    expect(faseDaEspera(70_000, 180_000)).toBe("demorando");
    expect(faseDaEspera(179_999, 180_000)).toBe("demorando");
    expect(faseDaEspera(180_000, 180_000)).toBe("sem-resposta");
  });

  it("o indicador que apareceu só sai depois do mínimo de 500 ms", () => {
    expect(podeEsconder(null, 0)).toBe(true);
    expect(podeEsconder(null, 10_000)).toBe(true);
    expect(podeEsconder(1_000, 1_000)).toBe(false);
    expect(podeEsconder(1_000, 1_499)).toBe(false);
    expect(podeEsconder(1_000, 1_500)).toBe(true);
    expect(podeEsconder(1_000, 9_000)).toBe(true);
  });

  it("o relógio da demora conta minutos e segundos, sem casa decimal", () => {
    expect(relogioDaEspera(10_000)).toBe("0:10");
    expect(relogioDaEspera(12_999)).toBe("0:12");
    expect(relogioDaEspera(69_999)).toBe("1:09");
    expect(relogioDaEspera(600_000)).toBe("10:00");
    expect(relogioDaEspera(-5)).toBe("0:00");
    expect(relogioDaEspera(Number.NaN)).toBe("0:00");
  });
});
