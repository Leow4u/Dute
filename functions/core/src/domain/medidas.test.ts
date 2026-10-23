import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ajustarTempos,
  amostraDaOs,
  aprovacaoDoEvento,
  idDaMedida,
  linhasDaOs,
  medidasDeDuracao,
  medidasDoPlanejado,
  medidasDoPlanejamento,
  medidasDoPrazo,
  milesimos,
  minutosDeTrabalho,
  planejamentoDaOs,
  type AmostraDaOs,
} from "./medidas.js";

/**
 * O tempo por item da LPU (parte 5.1a), num caso resolvido à mão:
 * - no Itaú, a 10045-01 fez só 10 do item A, com 2 pessoas em 100 minutos
 *   (200 homem-minutos): A leva 20 por unidade;
 * - a 10046-01 fez 5 de A e 10 de B, com 2 pessoas em 150 minutos (300): com
 *   A em 20, B também dá 20;
 * - no Safra, a 20001-01 fez 10 de A com 1 pessoa em 300 minutos: 30.
 * Na geral, A e B se ajustam com as três: A em 25 e B em 17,5. A medida do
 * Itaú nunca usa a OS do Safra. Dados sintéticos.
 */

const DIA = "2026-10-20";
const as = (hora: string) => `${DIA}T${hora}:00.000Z`;

function etapas(chegada: string, fim: string, trajeto?: [string, string]) {
  return [
    { etapa: "saida_patio", instante: as("07:00") },
    { etapa: "chegada_origem", instante: as(chegada) },
    ...(trajeto ? [{ etapa: "saida_origem", instante: as(trajeto[0]) }, { etapa: "chegada_destino", instante: as(trajeto[1]) }] : []),
    { etapa: "fim", instante: as(fim) },
  ];
}

function os(extra: Record<string, unknown>, linhas: Array<Record<string, unknown>>, pessoas: number, revisadaEm: string) {
  return {
    status: "revisada",
    tipo: "servico",
    customer_code: "ITAU",
    revisao: { instante: revisadaEm, pessoas, minutos_planejados: 480, minutos_reais: 300, linhas },
    ...extra,
  };
}

const linha = (id: string, lpu: string | null, executado: string, corrigido: string | null = null) => ({ linha: id, lpu_item_id: lpu, item: lpu ? `Item ${lpu}` : "Paletes", unidade: "UN", planejado: executado, executado, corrigido });

const OS_1 = amostraDaOs("10045-01", os({ etapas: etapas("09:00", "10:40") }, [linha("ln_1", "lpu_a", "10")], 2, "2026-10-20T20:00:00.000Z"))!;
// 09:00 a 12:00, menos o trajeto de 30 minutos: 150.
const OS_2 = amostraDaOs("10046-01", os({ etapas: etapas("09:00", "12:00", ["10:00", "10:30"]) }, [linha("ln_1", "lpu_a", "5"), linha("ln_2", "lpu_b", "10")], 2, "2026-10-21T20:00:00.000Z"))!;
const OS_3 = amostraDaOs("20001-01", os({ customer_code: "SAFRA", etapas: etapas("08:00", "13:00") }, [linha("ln_1", "lpu_a", "10")], 1, "2026-10-22T20:00:00.000Z"))!;

describe("o tempo de trabalho da OS", () => {
  it("da chegada na origem ao fim, menos o trajeto até o destino; sem as etapas, nada", () => {
    assert.equal(minutosDeTrabalho(etapas("09:00", "12:00", ["10:00", "10:30"])), 150);
    assert.equal(minutosDeTrabalho(etapas("09:00", "12:00")), 180);
    assert.equal(minutosDeTrabalho([{ etapa: "fim", instante: as("12:00") }]), null);
    assert.equal(minutosDeTrabalho(etapas("12:00", "09:00")), null);
    assert.equal(milesimos("12.5"), 12_500);
    assert.equal(milesimos("x"), 0);
  });

  it("a amostra: a OS revisada de serviço, com a equipe e o feito (o corrigido vale mais que o registrado)", () => {
    assert.deepEqual([OS_1.homemMinutos, OS_2.minutosDeTrabalho, OS_2.homemMinutos, OS_3.homemMinutos], [200, 150, 300, 300]);
    const corrigida = amostraDaOs("10047-01", os({ etapas: etapas("09:00", "10:00") }, [linha("ln_1", "lpu_a", "10", "8")], 1, as("20:00")));
    assert.equal(corrigida?.itens[0].milesimos, 8_000);
    for (const [caso, dados] of [
      ["vistoria", os({ tipo: "vistoria", etapas: etapas("09:00", "10:00") }, [linha("ln_1", "lpu_a", "1")], 1, as("20:00"))],
      ["em revisão", os({ status: "em_revisao", etapas: etapas("09:00", "10:00") }, [linha("ln_1", "lpu_a", "1")], 1, as("20:00"))],
      ["sem equipe", os({ etapas: etapas("09:00", "10:00") }, [linha("ln_1", "lpu_a", "1")], 0, as("20:00"))],
      ["sem etapas", os({ etapas: [] }, [linha("ln_1", "lpu_a", "1")], 1, as("20:00"))],
      ["nada feito", os({ etapas: etapas("09:00", "10:00") }, [linha("ln_1", "lpu_a", "0")], 1, as("20:00"))],
    ] as const) {
      assert.equal(amostraDaOs("10048-01", dados), null, caso);
    }
  });
});

describe("o homem-minuto por unidade", () => {
  it("o caso resolvido à mão: no Itaú, A e B em 20; no Safra, A em 30; na geral, A em 25 e B em 17,5", () => {
    const itau = ajustarTempos([OS_1, OS_2]);
    assert.deepEqual([itau.get("lpu_a")?.porUnidade, itau.get("lpu_b")?.porUnidade].map((valor) => Math.round((valor ?? 0) * 1000) / 1000), [20, 20]);
    const geral = ajustarTempos([OS_1, OS_2, OS_3]);
    assert.deepEqual([geral.get("lpu_a")?.porUnidade, geral.get("lpu_b")?.porUnidade].map((valor) => Math.round((valor ?? 0) * 1000) / 1000), [25, 17.5]);
    // O tempo repartido soma o das OS.
    const total = [...geral.values()].reduce((soma, tempo) => soma + tempo.homemMinutos, 0);
    assert.equal(Math.round(total), 800);
  });

  it("as medidas: uma por item e cliente, só com as OS dele, e a geral; a origem são as OS mais recentes", () => {
    const medidas = medidasDeDuracao([OS_3, OS_1, OS_2], "2026-10-23T12:00:00.000Z");
    assert.deepEqual(
      medidas.map((medida) => [medida.escopo, medida.customer_code, medida.lpu_item_id, medida.homem_minuto_por_unidade, medida.execucoes, medida.unidades, medida.os_recentes]),
      [
        ["cliente", "ITAU", "lpu_a", 20, 2, "15", ["10046-01", "10045-01"]],
        ["cliente", "ITAU", "lpu_b", 20, 1, "10", ["10046-01"]],
        ["cliente", "SAFRA", "lpu_a", 30, 1, "10", ["20001-01"]],
        ["geral", null, "lpu_a", 25, 3, "25", ["20001-01", "10046-01", "10045-01"]],
        ["geral", null, "lpu_b", 17.5, 1, "10", ["10046-01"]],
      ],
    );
    assert.equal(medidas[0].id, idDaMedida("duracao_item", "ITAU", "lpu_a"));
    assert.notEqual(idDaMedida("duracao_item", "ITAU", "lpu_a"), idDaMedida("duracao_item", null, "lpu_a"));
    // Nenhuma medida do Itaú cita a OS do Safra.
    assert.ok(medidas.filter((medida) => medida.customer_code === "ITAU").every((medida) => !medida.os_recentes.includes("20001-01")));
    assert.doesNotMatch(JSON.stringify(medidas), /valor|preco|cents|R\$/);
  });

  it("a ordem das OS não muda nada; o item livre ocupa tempo, mas não vira medida", () => {
    const amostras: AmostraDaOs[] = [OS_1, OS_2, OS_3];
    assert.deepEqual(medidasDeDuracao([...amostras].reverse(), "x"), medidasDeDuracao(amostras, "x"));
    const comLivre = amostraDaOs("10049-01", os({ etapas: etapas("09:00", "14:00") }, [linha("ln_1", "lpu_a", "10"), linha("ln_9", null, "10")], 1, as("20:00")))!;
    const medidas = medidasDeDuracao([comLivre], "x");
    assert.deepEqual(medidas.map((medida) => [medida.escopo, medida.lpu_item_id, medida.homem_minuto_por_unidade]), [
      ["cliente", "lpu_a", 15],
      ["geral", "lpu_a", 15],
    ]);
  });
});

describe("o erro do planejamento (parte 5.1b)", () => {
  const revisada = (customer: string, planejados: number | null, reais: number | null, revisadaEm: string, extra: Record<string, unknown> = {}) => ({
    status: "revisada",
    tipo: "servico",
    customer_code: customer,
    revisao: { instante: revisadaEm, pessoas: 2, minutos_planejados: planejados, minutos_reais: reais, linhas: [] },
    ...extra,
  });

  it("no Itaú, +25%, −25% e +50% dão 17% de erro médio, duas acima da janela; no Safra, 0; na geral, 13%", () => {
    const lista = [
      planejamentoDaOs("10045-01", revisada("ITAU", 240, 300, "2026-10-20T20:00:00.000Z")),
      planejamentoDaOs("10046-01", revisada("ITAU", 240, 180, "2026-10-21T20:00:00.000Z")),
      planejamentoDaOs("10047-01", revisada("ITAU", 120, 180, "2026-10-22T20:00:00.000Z")),
      planejamentoDaOs("20001-01", revisada("SAFRA", 60, 60, "2026-10-22T20:00:00.000Z")),
    ].filter((item) => item !== null);
    assert.deepEqual(
      medidasDoPlanejamento(lista, "x").map((medida) => [medida.escopo, medida.customer_code, medida.execucoes, medida.erro_medio_pct, medida.acima_da_janela, medida.os_recentes]),
      [
        ["cliente", "ITAU", 3, 17, 2, ["10047-01", "10046-01", "10045-01"]],
        ["cliente", "SAFRA", 1, 0, 0, ["20001-01"]],
        ["geral", null, 4, 13, 2, ["20001-01", "10047-01", "10046-01", "10045-01"]],
      ],
    );
  });

  it("sem a janela ou sem o tempo real, a vistoria e a OS não revisada ficam de fora", () => {
    assert.equal(planejamentoDaOs("1", revisada("ITAU", null, 300, "x")), null);
    assert.equal(planejamentoDaOs("1", revisada("ITAU", 240, null, "x")), null);
    assert.equal(planejamentoDaOs("1", revisada("ITAU", 240, 300, "x", { tipo: "vistoria" })), null);
    assert.equal(planejamentoDaOs("1", revisada("ITAU", 240, 300, "x", { status: "em_revisao" })), null);
    assert.deepEqual(medidasDoPlanejamento([], "x"), []);
  });
});

describe("os itens que passam do planejado (parte 5.1b)", () => {
  const comLinhas = (customer: string, revisadaEm: string, linhas: Array<Record<string, unknown>>) => ({
    status: "revisada",
    tipo: "servico",
    customer_code: customer,
    revisao: { instante: revisadaEm, pessoas: 1, linhas },
  });
  const planejada = (lpu: string | null, planejado: string, executado: string, corrigido: string | null = null) => ({ linha: "ln", lpu_item_id: lpu, item: "Cadeira", unidade: "UN", planejado, executado, corrigido });

  it("A passou em duas de três OS (+20% e +60%): excesso médio de 40%; o corrigido vale; o item livre fica de fora", () => {
    const lista = [
      linhasDaOs("10045-01", comLinhas("ITAU", "2026-10-20T20:00:00.000Z", [planejada("lpu_a", "10", "12"), planejada(null, "5", "9")])),
      linhasDaOs("10046-01", comLinhas("ITAU", "2026-10-21T20:00:00.000Z", [planejada("lpu_a", "10", "12", "10")])),
      linhasDaOs("10047-01", comLinhas("ITAU", "2026-10-22T20:00:00.000Z", [planejada("lpu_a", "5", "8")])),
    ].filter((item) => item !== null);
    assert.deepEqual(
      medidasDoPlanejado(lista, "x").map((medida) => [medida.escopo, medida.lpu_item_id, medida.execucoes, medida.passaram, medida.excesso_medio_pct, medida.os_recentes]),
      [
        ["cliente", "lpu_a", 3, 2, 40, ["10047-01", "10045-01"]],
        ["geral", "lpu_a", 3, 2, 40, ["10047-01", "10045-01"]],
      ],
    );
    assert.equal(linhasDaOs("1", comLinhas("ITAU", "x", [planejada("lpu_a", "0", "3")])), null);
  });
});

describe("o prazo de aprovação do orçamento (parte 5.1b)", () => {
  const ganha = (numero: string, customer: string, dias: number, occurredAt: string, extra: Record<string, unknown> = {}) => ({
    type: "demand.won",
    source: "functions_comercial",
    customer_code: customer,
    occurred_at: occurredAt,
    payload: { numero, rv: 1, segundos_desde_anterior: dias * 86_400 },
    ...extra,
  });

  it("no Itaú, 2, 6 e 9 dias dão mediana 6 e média 5,7; a demanda reaberta conta o último fechamento; o evento de outra codebase não conta", () => {
    const eventos = [
      ganha("10045", "ITAU", 2, "2026-10-01T12:00:00.000Z"),
      ganha("10046", "ITAU", 4, "2026-10-02T12:00:00.000Z"),
      ganha("10046", "ITAU", 6, "2026-10-10T12:00:00.000Z"),
      ganha("10047", "ITAU", 9, "2026-10-11T12:00:00.000Z"),
      ganha("20001", "SAFRA", 1, "2026-10-05T12:00:00.000Z"),
      ganha("10048", "ITAU", 30, "2026-10-12T12:00:00.000Z", { source: "functions_operacao" }),
      ganha("10049", "ITAU", 30, "2026-10-12T12:00:00.000Z", { payload: { numero: "10049" } }),
    ].map(aprovacaoDoEvento).filter((item) => item !== null);
    assert.deepEqual(
      medidasDoPrazo(eventos, "x").map((medida) => [medida.escopo, medida.customer_code, medida.execucoes, medida.mediana_dias, medida.media_dias, medida.demandas_recentes]),
      [
        ["cliente", "ITAU", 3, 6, 5.7, ["10047", "10046", "10045"]],
        ["cliente", "SAFRA", 1, 1, 1, ["20001"]],
        ["geral", null, 4, 4, 4.5, ["10047", "10046", "20001", "10045"]],
      ],
    );
    assert.deepEqual(medidasDoPrazo([], "x"), []);
  });
});
