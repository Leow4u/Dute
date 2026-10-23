import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HttpsError } from "firebase-functions/https";

import {
  JORNADA_MINUTOS,
  MINIMO_DO_CLIENTE,
  MINIMO_GERAL,
  baseDoItem,
  erroDaSugestao,
  historicoQueVale,
  interpretarPedido,
  interpretarResposta,
  sugerirDuracao,
  type BaseDoItem,
} from "./sugestao.js";

/**
 * A duração sugerida (parte 5.2a): a base de cada item (5 execuções no
 * cliente, senão 15 na geral), o tempo de trabalho com a equipe, o
 * arredondamento, a divisão acima da jornada e o aviso de plano otimista.
 * Dados sintéticos.
 */

const medida = (homemMinutoPorUnidade: number, execucoes: number) => ({ homemMinutoPorUnidade, execucoes, osRecentes: ["10045-01"] });
const base = (homem_minuto_por_unidade: number, escopo: "cliente" | "geral" = "cliente", execucoes = 6): BaseDoItem => ({ escopo, execucoes, homem_minuto_por_unidade, os_recentes: ["10045-01"] });

describe("a base de cada item", () => {
  it("a do cliente com 5 execuções; sem ela, a geral com 15; abaixo disso, nenhuma", () => {
    assert.deepEqual([MINIMO_DO_CLIENTE, MINIMO_GERAL], [5, 15]);
    assert.equal(baseDoItem(medida(20, 5), medida(25, 40))?.escopo, "cliente");
    assert.deepEqual(baseDoItem(medida(20, 4), medida(25, 15)), { escopo: "geral", execucoes: 15, homem_minuto_por_unidade: 25, os_recentes: ["10045-01"] });
    assert.equal(baseDoItem(medida(20, 4), medida(25, 14)), null);
    assert.equal(baseDoItem(null, null), null);
    assert.equal(baseDoItem(medida(0, 9), null), null);
  });

  it("o histórico do planejamento: o do cliente com 5, senão o geral com 15", () => {
    const doCliente = { escopo: "cliente" as const, execucoes: 5, erro_medio_pct: 22, acima_da_janela: 4 };
    const geral = { escopo: "geral" as const, execucoes: 15, erro_medio_pct: 8, acima_da_janela: 6 };
    assert.equal(historicoQueVale(doCliente, geral), doCliente);
    assert.equal(historicoQueVale({ ...doCliente, execucoes: 3 }, geral), geral);
    assert.equal(historicoQueVale({ ...doCliente, execucoes: 3 }, { ...geral, execucoes: 14 }), null);
  });
});

describe("a duração sugerida", () => {
  it("cada item com base leva o homem-minuto vezes a quantidade, dividido pela equipe; o sem base e o livre ficam de fora", () => {
    const sugestao = sugerirDuracao(
      {
        pessoas: 2,
        itens: [
          { lpu_item_id: "lpu_a", item: "Mesa", quantidade: "10" },
          { lpu_item_id: "lpu_b", item: "Cadeira", quantidade: "4" },
          { lpu_item_id: null, item: "Paletes", quantidade: "3" },
        ],
      },
      new Map([
        ["lpu_a", base(20.4)],
        ["lpu_b", null],
      ]),
      null,
    );
    assert.deepEqual(
      sugestao.itens.map((item) => [item.lpu_item_id, item.minutos, item.base?.escopo ?? null]),
      [
        ["lpu_a", 102, "cliente"],
        ["lpu_b", null, null],
        [null, null, null],
      ],
    );
    // 102 arredonda para cima, de 5 em 5.
    assert.deepEqual([sugestao.minutos_total, sugestao.completa, sugestao.divisao, sugestao.plano_otimista], [105, false, null, null]);
  });

  it("sem base em nenhum item, não há duração; acima da jornada, divide em OS", () => {
    const semBase = sugerirDuracao({ pessoas: 1, itens: [{ lpu_item_id: "lpu_b", item: "Cadeira", quantidade: "4" }] }, new Map([["lpu_b", null]]), null);
    assert.deepEqual([semBase.minutos_total, semBase.completa], [null, false]);
    const longa = sugerirDuracao({ pessoas: 2, itens: [{ lpu_item_id: "lpu_a", item: "Mesa", quantidade: "60" }] }, new Map([["lpu_a", base(20)]]), null);
    assert.equal(JORNADA_MINUTOS, 480);
    assert.deepEqual([longa.minutos_total, longa.completa, longa.divisao], [600, true, { os: 2, minutos_por_os: 300 }]);
  });

  it("o aviso de plano otimista: o erro médio do cliente a partir de 15%", () => {
    const historico = (erro_medio_pct: number) => ({ escopo: "cliente" as const, execucoes: 8, erro_medio_pct, acima_da_janela: 6 });
    const pedido = { pessoas: 1, itens: [{ lpu_item_id: "lpu_a", item: "Mesa", quantidade: "1" }] };
    assert.deepEqual(sugerirDuracao(pedido, new Map([["lpu_a", base(20)]]), historico(22)).plano_otimista, historico(22));
    assert.equal(sugerirDuracao(pedido, new Map([["lpu_a", base(20)]]), historico(10)).plano_otimista, null);
    assert.equal(erroDaSugestao(100, 125), 25);
    assert.equal(erroDaSugestao(100, 80), -20);
  });
});

describe("o pedido e a resposta", () => {
  const recusa = (fn: () => unknown, mensagem: string | RegExp) =>
    assert.throws(fn, (error: unknown) => error instanceof HttpsError && error.code === "invalid-argument" && (typeof mensagem === "string" ? error.message === mensagem : mensagem.test(error.message)));

  it("o cliente nunca vem do pedido; a quantidade, a equipe e os itens são conferidos", () => {
    const pedido = { demanda: "10045", pessoas: 2, itens: [{ lpu_item_id: "lpu_a", item: "Mesa", quantidade: "12.5" }] };
    assert.deepEqual(interpretarPedido(pedido), pedido);
    recusa(() => interpretarPedido({ ...pedido, customer_code: "SAFRA" }), /Unrecognized key/);
    recusa(() => interpretarPedido({ ...pedido, itens: [{ ...pedido.itens[0], quantidade: "0" }] }), "Quantidade inválida.");
    recusa(() => interpretarPedido({ ...pedido, pessoas: 0 }), "Informe a equipe.");
    recusa(() => interpretarPedido({ ...pedido, itens: [] }), "Informe os itens da OS.");
  });

  it("a resposta: a OS da demanda, a decisão e o escolhido", () => {
    const resposta = { idempotency_key: "resposta-1", demanda: "10045", os: "10045-01", pessoas: 2, itens: [{ lpu_item_id: "lpu_a", item: "Mesa", quantidade: "10" }], decisao: "aceitou", minutos_escolhidos: 105 };
    assert.equal(interpretarResposta(resposta).decisao, "aceitou");
    recusa(() => interpretarResposta({ ...resposta, os: "10046-01" }), "A OS 10046-01 não é da demanda 10045.");
    recusa(() => interpretarResposta({ ...resposta, decisao: "talvez" }), /Invalid enum value/);
  });
});
