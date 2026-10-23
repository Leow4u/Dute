import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HttpsError } from "firebase-functions/https";

import { vetorDosItens } from "./lembrancas.js";
import { interpretarPedidoDeParecidos, parecidosDoPedido, vetorDoPedido, type CasoLido } from "./parecidos.js";

/**
 * Os orçamentos parecidos (parte 5.3b), num caso resolvido à mão. O pedido da
 * demanda 10050 do Itaú tem 12 mesas e 40 cadeiras. No Itaú, a 10045 fez 14
 * mesas e 40 cadeiras (quase o mesmo), a 10046 só 40 cadeiras (a metade) e a
 * 10047 só armários (nada em comum). No Safra, a 20001 fez exatamente o mesmo
 * pedido, e nunca aparece para o Itaú. Dados sintéticos.
 */

function caso(demanda: string, customer: string, itens: Record<string, number>, extra: Partial<CasoLido> = {}): CasoLido {
  return {
    demanda,
    customer_code: customer,
    titulo: null,
    itens: Object.entries(itens).map(([lpu, quantidade]) => ({ lpu_item_id: lpu, item: lpu, unidade: "UN", orcado: String(quantidade), realizado: String(quantidade) })),
    vetor: vetorDosItens(Object.entries(itens).map(([lpu, quantidade]) => ({ lpuItemId: lpu, milesimos: quantidade * 1000 }))),
    orcado_cents: 100000,
    realizado_cents: 110000,
    executado_de: null,
    executado_ate: null,
    os: ["x-01", "x-02"],
    minutos_de_trabalho: 180,
    fechada_em: "2026-10-20T00:00:00.000Z",
    ...extra,
  };
}

const PEDIDO = {
  demanda: "10050",
  itens: [
    { lpu_item_id: "lpu_mesa", quantidade: "12" },
    { lpu_item_id: "lpu_cadeira", quantidade: "40" },
  ],
};

const CASOS = [
  caso("10045", "ITAU", { lpu_mesa: 14, lpu_cadeira: 40 }),
  caso("10046", "ITAU", { lpu_cadeira: 40 }),
  caso("10047", "ITAU", { lpu_armario: 6 }),
  caso("20001", "SAFRA", { lpu_mesa: 12, lpu_cadeira: 40 }),
];

describe("os orçamentos parecidos", () => {
  it("o mais parecido primeiro, a partir de 50%; o de outro cliente nunca aparece", () => {
    const { casos, lembrancas } = parecidosDoPedido(PEDIDO, "ITAU", CASOS);
    // A 10045 dá 98%: 14 mesas no lugar de 12. A 10046, só as cadeiras: o cosseno 3,714 ÷ 4,514 = 0,823,
    // vezes a razão dos tamanhos, a mesma conta: 68%.
    assert.deepEqual(
      casos.map((item) => [item.demanda, item.semelhanca_pct, item.itens_em_comum]),
      [
        ["10045", 98, 2],
        ["10046", 68, 1],
      ],
    );
    assert.equal(lembrancas, 3);
    assert.ok(!casos.some((item) => item.demanda === "20001"));
  });

  it("devolve o que a tela mostra, sem o vetor nem o cliente, e as OS contadas", () => {
    const [primeiro] = parecidosDoPedido(PEDIDO, "ITAU", CASOS).casos;
    assert.deepEqual(Object.keys(primeiro).sort(), [
      "demanda",
      "executado_ate",
      "executado_de",
      "fechada_em",
      "itens",
      "itens_em_comum",
      "minutos_de_trabalho",
      "orcado_cents",
      "os",
      "realizado_cents",
      "semelhanca_pct",
      "titulo",
    ]);
    assert.deepEqual([primeiro.os, primeiro.orcado_cents, primeiro.realizado_cents], [2, 100000, 110000]);
  });

  it("a própria demanda não aparece; empatados, o fechado mais recente; no máximo três", () => {
    const iguais = ["10041", "10042", "10043", "10044"].map((demanda, indice) => caso(demanda, "ITAU", { lpu_mesa: 12 }, { fechada_em: `2026-10-0${indice + 1}T00:00:00.000Z` }));
    const pedido = { demanda: "10044", itens: [{ lpu_item_id: "lpu_mesa", quantidade: "12" }] };
    assert.deepEqual(
      parecidosDoPedido(pedido, "ITAU", iguais).casos.map((item) => item.demanda),
      ["10043", "10042", "10041"],
    );
  });

  it("o vetor do pedido soma o mesmo item em mais de uma linha", () => {
    assert.deepEqual(
      vetorDoPedido({
        itens: [
          { lpu_item_id: "lpu_mesa", quantidade: "6" },
          { lpu_item_id: "lpu_mesa", quantidade: "6" },
        ],
      }),
      vetorDosItens([{ lpuItemId: "lpu_mesa", milesimos: 12000 }]),
    );
  });

  it("o pedido: a demanda, os itens da LPU e as quantidades são conferidos; o cliente nunca vem do pedido", () => {
    assert.deepEqual(interpretarPedidoDeParecidos(PEDIDO), PEDIDO);
    for (const errado of [
      { ...PEDIDO, demanda: "abc" },
      { ...PEDIDO, itens: [] },
      { ...PEDIDO, itens: [{ lpu_item_id: "lpu_mesa", quantidade: "0" }] },
      { ...PEDIDO, itens: [{ lpu_item_id: "", quantidade: "1" }] },
      { ...PEDIDO, customer_code: "SAFRA" },
    ]) {
      assert.throws(() => interpretarPedidoDeParecidos(errado), (error: unknown) => error instanceof HttpsError && error.code === "invalid-argument");
    }
  });
});
