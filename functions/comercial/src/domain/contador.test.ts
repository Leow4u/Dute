import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ULTIMO_MINIMO, acaoDoContador, maiorNumero, problemaDoUltimo, problemaDoValor } from "./contador.js";

/** Regra do ponto de partida do contador das demandas (parte 6.21). */

describe("valor do contador", () => {
  it("de 10000 (a próxima é a 10001) até antes do fim da faixa, e inteiro", () => {
    assert.equal(ULTIMO_MINIMO, 10_000);
    assert.equal(problemaDoValor(10_000), null);
    assert.equal(problemaDoValor(10_872), null);
    assert.match(problemaDoValor(9_999) ?? "", /10000 ou mais/);
    assert.match(problemaDoValor(99_999_999) ?? "", /fim da faixa/);
    assert.match(problemaDoValor(10_500.5) ?? "", /inteiro/);
  });
});

describe("conferência contra o banco", () => {
  it("recusa ficar abaixo da maior demanda que existe", () => {
    assert.match(problemaDoUltimo(10_040, { atual: null, maiorDemanda: 10_045 }) ?? "", /A demanda 10045 já existe/);
    assert.equal(problemaDoUltimo(10_045, { atual: null, maiorDemanda: 10_045 }), null);
  });

  it("recusa andar para trás, mesmo sem demanda no número", () => {
    assert.match(problemaDoUltimo(10_100, { atual: 10_200, maiorDemanda: 10_050 }) ?? "", /já está em 10200/);
  });

  it("o mesmo valor não grava; outro valor válido grava", () => {
    assert.equal(acaoDoContador(10_200, { atual: 10_200, maiorDemanda: null }), "sem_mudanca");
    assert.equal(acaoDoContador(10_500, { atual: 10_200, maiorDemanda: null }), "gravar");
    assert.equal(acaoDoContador(10_500, { atual: null, maiorDemanda: null }), "gravar");
  });
});

describe("maior número de demanda", () => {
  it("compara como número, não como texto, e ignora id fora do formato", () => {
    assert.equal(maiorNumero(["99999", "100001", "10045"]), 100_001);
    assert.equal(maiorNumero(["10045", "rascunho", ""]), 10_045);
    assert.equal(maiorNumero([]), null);
  });
});
