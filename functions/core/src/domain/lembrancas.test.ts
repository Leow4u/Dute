import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { demandaDoEvento } from "./lembrancas-gravacao.js";
import { fechamentoDaDemanda, lembrancaDaDemanda, osDoCaso, revisaoLida, rvsDaDemanda, semelhanca, type RevisaoLida } from "./lembrancas.js";

/**
 * A lembrança da demanda fechada (parte 5.3a), num caso resolvido à mão. A
 * demanda 10045 do Itaú fechou o escopo na RV 1 (12 mesas e 40 cadeiras, R$
 * 5.000,00) e o cliente validou a RV 2 (14 mesas, 40 cadeiras e 3 caixas
 * avulsas, R$ 5.600,00). Duas OS revisadas: 120 minutos com 2 pessoas e 60
 * com 3, 3 horas e 420 homem-minutos. Dados sintéticos.
 */

const linha = (extra: Record<string, unknown>) => ({ origem: "tabela", unidade: "UN", servico: "Montagem", ...extra });

const RV1 = {
  linhas: [
    linha({ lpu_item_id: "lpu_mesa", item: "Mesa", quantidade: "12" }),
    linha({ lpu_item_id: "lpu_cadeira", item: "Cadeira", quantidade: "40" }),
    { origem: "ajuste", item: "Desconto", quantidade: "1", total_cents: -10000 },
  ],
  total_cents: 500000,
};

const RV2 = {
  linhas: [
    linha({ lpu_item_id: "lpu_mesa", item: "Mesa", quantidade: "14" }),
    linha({ lpu_item_id: "lpu_cadeira", item: "Cadeira", quantidade: "40" }),
    { origem: "avulso", lpu_item_id: null, item: "Caixa extra", unidade: null, servico: null, quantidade: "3" },
  ],
  total_cents: 560000,
};

const DEMANDA = {
  numero: "10045",
  customer_code: "ITAU",
  customer_name: "Itaú Unibanco",
  titulo: "Mudança do 3º andar",
  entrada: "proposta",
  etapa: "a_faturar",
  escopo_rv: 1,
  validacao: { rv: 2, etapa: "a_faturar", em: "2026-10-20T15:00:00.000Z" },
  executado_de: "2026-10-15",
  executado_ate: "2026-10-16",
  marcos: [
    { etapa: "para_planejar", em: "2026-10-10T12:00:00.000Z" },
    { etapa: "a_faturar", em: "2026-10-20T15:00:00.000Z" },
    { etapa: "faturada", em: "2026-10-22T10:00:00.000Z" },
  ],
};

const ORDENS = [
  { numero: "10045-02", minutos: 60, pessoas: 3 },
  { numero: "10045-01", minutos: 120, pessoas: 2 },
];

function caso(demanda: Record<string, unknown> = DEMANDA, orcada: RevisaoLida | null = revisaoLida(1, RV1), realizada: RevisaoLida | null = revisaoLida(2, RV2)) {
  return lembrancaDaDemanda("10045", demanda, orcada, realizada, ORDENS);
}

describe("a lembrança da demanda fechada", () => {
  it("junta o orçado e o realizado por item, sem o ajuste, com o valor dos dois", () => {
    const lembranca = caso();
    assert.ok(lembranca);
    assert.deepEqual(lembranca.itens, [
      { lpu_item_id: "lpu_cadeira", item: "Cadeira", unidade: "UN", orcado: "40", realizado: "40" },
      { lpu_item_id: null, item: "Caixa extra", unidade: null, orcado: "0", realizado: "3" },
      { lpu_item_id: "lpu_mesa", item: "Mesa", unidade: "UN", orcado: "12", realizado: "14" },
    ]);
    assert.deepEqual(
      [lembranca.customer_code, lembranca.rv_orcada, lembranca.rv_realizada, lembranca.orcado_cents, lembranca.realizado_cents, lembranca.servicos],
      ["ITAU", 1, 2, 500000, 560000, ["Montagem"]],
    );
  });

  it("o vetor é o dos itens da LPU feitos, pelo log da quantidade; o item avulso fica de fora", () => {
    // log(1 + 40) = 3,714 e log(1 + 14) = 2,708.
    assert.deepEqual(caso()?.vetor, { lpu_cadeira: 3.714, lpu_mesa: 2.708 });
  });

  it("o tempo de trabalho e o homem-minuto das OS, e o resumo em texto", () => {
    const lembranca = caso();
    assert.deepEqual([lembranca?.os, lembranca?.minutos_de_trabalho, lembranca?.homem_minutos], [["10045-01", "10045-02"], 180, 420]);
    assert.equal(
      lembranca?.resumo,
      "Demanda 10045 · Itaú Unibanco · Mudança do 3º andar · Montagem · 40 un de Cadeira, 3 un de Caixa extra, 14 un de Mesa · orçado R$ 5.000,00 · realizado R$ 5.600,00 · 2 OS, 3h de trabalho",
    );
    assert.equal(lembranca?.fechada_em, "2026-10-20T15:00:00.000Z");
  });

  it("validada a mesma RV do escopo, o realizado é o orçado", () => {
    const rv1 = revisaoLida(1, RV1);
    const lembranca = caso({ ...DEMANDA, validacao: { rv: 1, etapa: "a_faturar" } }, rv1, rv1);
    assert.deepEqual(
      lembranca?.itens.map((item) => [item.item, item.orcado, item.realizado]),
      [
        ["Cadeira", "40", "40"],
        ["Mesa", "12", "12"],
      ],
    );
    assert.deepEqual([lembranca?.orcado_cents, lembranca?.realizado_cents], [500000, 500000]);
  });

  it("a demanda direta não tem orçado: o feito é o da RV validada", () => {
    const lembranca = caso({ ...DEMANDA, entrada: "direta", escopo_rv: null }, null);
    assert.deepEqual([lembranca?.rv_orcada, lembranca?.orcado_cents, lembranca?.itens[0].orcado, lembranca?.itens[0].realizado], [null, null, null, "40"]);
    assert.doesNotMatch(lembranca?.resumo ?? "", /orçado/);
  });

  it("a demanda que não fechou, ou sem cliente, não vira lembrança", () => {
    for (const etapa of ["para_planejar", "execucao_a_orcar", "aguardando_autorizacao", "perdida", "cancelada"]) assert.equal(caso({ ...DEMANDA, etapa }), null);
    for (const etapa of ["a_faturar", "faturada", "paga"]) assert.ok(caso({ ...DEMANDA, etapa }));
    assert.equal(caso({ ...DEMANDA, customer_code: " " }), null);
  });
});

describe("as leituras da lembrança", () => {
  it("a RV lida deixa de fora o ajuste e a linha sem quantidade; o item avulso tem chave própria", () => {
    const lida = revisaoLida(3, { linhas: [...RV2.linhas, linha({ lpu_item_id: "lpu_x", item: "Zerada", quantidade: "0" })], total_cents: 1 });
    assert.deepEqual(
      lida?.linhas.map((item) => [item.chave, item.milesimos]),
      [
        ["lpu_mesa", 14000],
        ["lpu_cadeira", 40000],
        ["livre:caixa extra", 3000],
      ],
    );
    assert.equal(revisaoLida(3, null), null);
  });

  it("só a OS revisada de serviço entra, com a equipe da revisão", () => {
    const etapas = [
      { etapa: "chegada_origem", instante: "2026-10-15T12:00:00.000Z" },
      { etapa: "fim", instante: "2026-10-15T14:00:00.000Z" },
    ];
    assert.deepEqual(osDoCaso("10045-01", { status: "revisada", tipo: "servico", etapas, revisao: { pessoas: 2 } }), { numero: "10045-01", minutos: 120, pessoas: 2 });
    assert.equal(osDoCaso("10045-01", { status: "concluida", tipo: "servico", etapas }), null);
    assert.equal(osDoCaso("10045-01", { status: "revisada", tipo: "vistoria", etapas }), null);
  });

  it("as RVs da demanda: a do escopo e a validada", () => {
    assert.deepEqual(rvsDaDemanda(DEMANDA), { orcada: 1, realizada: 2 });
    assert.deepEqual(rvsDaDemanda({}), { orcada: null, realizada: null });
  });

  it("o fechamento é a entrada na etapa fechada depois da última reabertura; sem marco, a validação", () => {
    const reaberta = {
      marcos: [
        { etapa: "a_faturar", em: "2026-10-10T00:00:00.000Z" },
        { etapa: "execucao_a_orcar", em: "2026-10-11T00:00:00.000Z" },
        { etapa: "aguardando_autorizacao", em: "2026-10-12T00:00:00.000Z" },
        { etapa: "a_faturar", em: "2026-10-13T00:00:00.000Z" },
        { etapa: "faturada", em: "2026-10-14T00:00:00.000Z" },
      ],
    };
    assert.equal(fechamentoDaDemanda(reaberta), "2026-10-13T00:00:00.000Z");
    assert.equal(fechamentoDaDemanda({ validacao: { em: "2026-10-09T00:00:00.000Z" } }), "2026-10-09T00:00:00.000Z");
    assert.equal(fechamentoDaDemanda({}), null);
  });
});

describe("a semelhança e os eventos", () => {
  it("o cosseno vezes a razão dos tamanhos: o mesmo pedido é 1; sem item em comum, 0; 12 mesas não são 30", () => {
    const vetor = { lpu_mesa: 2.708, lpu_cadeira: 3.714 };
    const tresCasas = (valor: number) => Math.round(valor * 1000) / 1000;
    assert.equal(tresCasas(semelhanca(vetor, vetor)), 1);
    assert.equal(semelhanca(vetor, { lpu_armario: 1 }), 0);
    assert.equal(semelhanca(vetor, {}), 0);
    // Só a mesa em comum: o cosseno 2,708 ÷ √(2,708² + 3,714²) = 0,589, vezes a razão 1 ÷ 4,596.
    assert.equal(tresCasas(semelhanca(vetor, { lpu_mesa: 1 })), 0.128);
    // O mesmo item: o cosseno é 1 e vale a escala, log(13) ÷ log(31) para 12 e 30 mesas.
    assert.equal(tresCasas(semelhanca({ lpu_mesa: 2.565 }, { lpu_mesa: 3.434 })), 0.747);
  });

  it("a mudança de etapa só conta quando entra ou sai das fechadas; a OS revisada e a reaberta contam pela demanda", () => {
    assert.equal(demandaDoEvento("demand.stage_changed", { numero: "10045", etapa_antes: "execucao_a_orcar", etapa_depois: "a_faturar" }), "10045");
    assert.equal(demandaDoEvento("demand.stage_changed", { numero: "10045", etapa_antes: "a_faturar", etapa_depois: "execucao_a_orcar" }), "10045");
    assert.equal(demandaDoEvento("demand.stage_changed", { numero: "10045", etapa_antes: "para_aprovar", etapa_depois: "para_enviar" }), null);
    assert.equal(demandaDoEvento("os.reviewed", { id: "10045-01", demanda: "10045" }), "10045");
    assert.equal(demandaDoEvento("os.reopened", { id: "10046-02" }), "10046");
    assert.equal(demandaDoEvento("demand.won", { numero: "10045" }), null);
  });
});
