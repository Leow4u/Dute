import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEMAND_COUNTER_ID,
  DEMAND_COUNTERS_COLLECTION,
  ETAPAS_DEMANDA,
  ETAPAS_QUE_PERDEM,
  MOTIVOS_PERDA,
  MOTIVOS_REVISAO,
  PRIMEIRO_NUMERO,
  dataDeHoje,
  destinoDaValidacao,
  escopoDasLinhas,
  etapaDaDemanda,
  problemaDaPerda,
  problemaDaRevisao,
  problemaDaValidacao,
  proximoNumero,
  reaberturaAbreRv,
  rotuloDoOrcamento,
  segundosDesde,
  tipoDaRevisao,
  type EtapaDemanda,
} from "./demanda.js";

/**
 * A Demanda no domínio (docs/plataforma/fase-6-comercial.md, "Etapas da
 * demanda"; parte 9): um número só para demanda e orçamento, a partir de
 * 10001; "10045" e "10045 – RV02"; a etapa sai da situação do orçamento; a
 * data-base é o dia em São Paulo.
 */

describe("numeração única", () => {
  it("contador em demand_counters/geral, começando em 10001", () => {
    assert.equal(DEMAND_COUNTERS_COLLECTION, "demand_counters");
    assert.equal(DEMAND_COUNTER_ID, "geral");
    assert.equal(PRIMEIRO_NUMERO, 10001);
    assert.equal(proximoNumero(undefined), "10001");
    assert.equal(proximoNumero(null), "10001");
    assert.equal(proximoNumero(10001), "10002");
    assert.equal(proximoNumero(10044), "10045");
  });

  it("contador abaixo da faixa nova pula para 10001: as séries antigas vão até 4 dígitos ou 105xxx", () => {
    assert.equal(proximoNumero(0), "10001");
    assert.equal(proximoNumero(1001), "10001");
  });

  it("contador quebrado não vira número: para a criação", () => {
    for (const quebrado of ["10044", 10044.5, -1, Number.NaN, 99_999_999, {}]) {
      assert.throws(() => proximoNumero(quebrado), /contador/i, String(quebrado));
    }
  });

  it("RV 0 é o número; RV n é \"10045 – RV0n\"", () => {
    assert.equal(rotuloDoOrcamento("10045", 0), "10045");
    assert.equal(rotuloDoOrcamento("10045", 1), "10045 – RV01");
    assert.equal(rotuloDoOrcamento("10045", 2), "10045 – RV02");
    assert.equal(rotuloDoOrcamento("10045", 12), "10045 – RV12");
  });
});

describe("etapa da demanda", () => {
  const sem = {};

  it("a lista tem as etapas do desenho, inclusive cancelada", () => {
    assert.deepEqual(
      [...ETAPAS_DEMANDA],
      [
        "em_montagem",
        "para_aprovar",
        "para_enviar",
        "aguardando_cliente",
        "para_planejar",
        "execucao_a_orcar",
        "aguardando_autorizacao",
        "a_faturar",
        "perdida",
        "cancelada",
      ],
    );
  });

  it("proposta: rascunho, para aprovar, aprovado e enviado", () => {
    const casos: Array<[string, string]> = [
      ["rascunho", "em_montagem"],
      ["para_aprovar", "para_aprovar"],
      ["aprovado", "para_enviar"],
      ["enviado", "aguardando_cliente"],
    ];
    for (const [status, etapa] of casos) {
      assert.equal(etapaDaDemanda(sem, { status, tipo_rv: "proposta" }), etapa, status);
    }
  });

  it("RV de aditivo ou de execução enviada espera a validação do cliente (aguardando cliente); a de execução em montagem é execução a orçar", () => {
    assert.equal(etapaDaDemanda(sem, { status: "enviado", tipo_rv: "aditivo", rv: 2 }), "aguardando_cliente");
    assert.equal(etapaDaDemanda(sem, { status: "enviado", tipo_rv: "execucao", rv: 1 }), "aguardando_cliente");
    assert.equal(etapaDaDemanda(sem, { status: "rascunho", tipo_rv: "execucao" }), "execucao_a_orcar");
    assert.equal(etapaDaDemanda(sem, { status: "rascunho", tipo_rv: "aditivo" }), "em_montagem");
    assert.equal(etapaDaDemanda(sem, { status: "para_aprovar", tipo_rv: "execucao" }), "para_aprovar");
    assert.equal(etapaDaDemanda(sem, { status: "aprovado", tipo_rv: "aditivo" }), "para_enviar");
  });

  it("perda e cancelamento valem sobre a situação do orçamento", () => {
    const orcamento = { status: "enviado", tipo_rv: "proposta" };
    assert.equal(etapaDaDemanda({ perda: { motivo: "preco" } }, orcamento), "perdida");
    assert.equal(etapaDaDemanda({ cancelamento: { motivo: "cliente" } }, orcamento), "cancelada");
    assert.equal(etapaDaDemanda({ perda: null, cancelamento: null }, orcamento), "aguardando_cliente");
  });

  it("demanda ainda sem orçamento está em montagem; situação desconhecida é recusada", () => {
    assert.equal(etapaDaDemanda(sem, null), "em_montagem");
    assert.throws(() => etapaDaDemanda(sem, { status: "fechado", tipo_rv: "proposta" }), /situação/i);
    assert.throws(() => etapaDaDemanda(sem, { status: "rascunho", tipo_rv: "medicao" }), /tipo/i);
  });

  it("depois do envio (parte 10): fechada é para planejar; executada, execução a orçar; validada, a etapa da validação", () => {
    const enviada = { status: "enviado", tipo_rv: "proposta", rv: 0 };
    assert.equal(etapaDaDemanda({ escopo_rv: null }, enviada), "aguardando_cliente");
    assert.equal(etapaDaDemanda({ escopo_rv: 0 }, enviada), "para_planejar");
    assert.equal(etapaDaDemanda({ escopo_rv: 0, executado_de: "2026-10-16" }, enviada), "execucao_a_orcar");
    // A RV de execução aberta sobre a fechada: rascunho é execução a orçar; enviada espera a validação.
    const fechadaExecutada = { escopo_rv: 0, executado_de: "2026-10-16" };
    assert.equal(etapaDaDemanda(fechadaExecutada, { status: "rascunho", tipo_rv: "execucao", rv: 1 }), "execucao_a_orcar");
    assert.equal(etapaDaDemanda(fechadaExecutada, { status: "para_aprovar", tipo_rv: "execucao", rv: 1 }), "para_aprovar");
    assert.equal(etapaDaDemanda(fechadaExecutada, { status: "enviado", tipo_rv: "execucao", rv: 1 }), "aguardando_cliente");
    for (const etapa of ["aguardando_autorizacao", "a_faturar"] as const) {
      assert.equal(
        etapaDaDemanda({ ...fechadaExecutada, validacao: { rv: 1, etapa } }, { status: "enviado", tipo_rv: "execucao", rv: 1 }),
        etapa,
      );
    }
    // Sem desvio: a RV fechada validada.
    assert.equal(etapaDaDemanda({ ...fechadaExecutada, validacao: { rv: 0, etapa: "a_faturar" } }, enviada), "a_faturar");
    // Aditivo aberto na demanda fechada: em montagem até ser enviado.
    assert.equal(etapaDaDemanda({ escopo_rv: 0 }, { status: "rascunho", tipo_rv: "aditivo", rv: 1 }), "em_montagem");
    // Perda vale sobre tudo.
    assert.equal(etapaDaDemanda({ ...fechadaExecutada, perda: { motivo: "cancelado_cliente" } }, enviada), "perdida");
  });
});

describe("perda e reabertura", () => {
  it("lista de motivos e as etapas antes de faturar", () => {
    assert.deepEqual([...MOTIVOS_PERDA], ["preco", "prazo", "desistencia", "sem_resposta", "cancelado_cliente", "outro"]);
    assert.deepEqual(
      [...ETAPAS_QUE_PERDEM],
      ["em_montagem", "para_aprovar", "para_enviar", "aguardando_cliente", "para_planejar", "execucao_a_orcar", "aguardando_autorizacao"],
    );
  });

  it("motivo × etapa: qualquer motivo antes do fechamento; depois, só cancelado_cliente; a faturar e perdida, nenhum", () => {
    type Caso = { etapa: EtapaDemanda; demanda: Record<string, unknown> };
    const antes: Caso[] = ["em_montagem", "para_aprovar", "para_enviar", "aguardando_cliente"].map((etapa) => ({
      etapa: etapa as EtapaDemanda,
      demanda: {},
    }));
    const depois: Caso[] = [
      { etapa: "para_planejar", demanda: { escopo_rv: 0 } },
      { etapa: "execucao_a_orcar", demanda: { escopo_rv: 0, executado_de: "2026-10-16" } },
      { etapa: "aguardando_cliente", demanda: { escopo_rv: 0, executado_de: "2026-10-16" } },
      { etapa: "aguardando_autorizacao", demanda: { escopo_rv: 0, executado_de: "2026-10-16", validacao: { rv: 1, etapa: "aguardando_autorizacao" } } },
      // A demanda direta nasce executada: já tem o sim do cliente.
      { etapa: "execucao_a_orcar", demanda: { escopo_rv: null, executado_de: "2026-10-16" } },
    ];
    const nunca: Caso[] = [
      { etapa: "a_faturar", demanda: { escopo_rv: 0, validacao: { rv: 1, etapa: "a_faturar" } } },
      { etapa: "perdida", demanda: { perda: { motivo: "preco" } } },
      { etapa: "cancelada", demanda: {} },
    ];
    for (const motivo of MOTIVOS_PERDA) {
      const nota = motivo === "outro" ? "Cliente fechou o andar." : null;
      for (const caso of antes) assert.equal(problemaDaPerda(motivo, { ...caso.demanda, etapa: caso.etapa }, nota), null, `${motivo} em ${caso.etapa}`);
      for (const caso of depois) {
        const problema = problemaDaPerda(motivo, { ...caso.demanda, etapa: caso.etapa }, nota);
        if (motivo === "cancelado_cliente") assert.equal(problema, null, `${motivo} em ${caso.etapa}`);
        else assert.match(String(problema), /cancelamento do cliente/, `${motivo} em ${caso.etapa}`);
      }
      for (const caso of nunca) assert.match(String(problemaDaPerda(motivo, { ...caso.demanda, etapa: caso.etapa }, nota)), /antes de faturar/);
    }
    assert.match(String(problemaDaPerda("outro", { etapa: "em_montagem" }, "  ")), /nota/);
  });

  it("reabrir abre RV nova só quando a RV enviada ainda não tinha o sim do cliente", () => {
    assert.equal(reaberturaAbreRv({}, { status: "enviado" }), true);
    assert.equal(reaberturaAbreRv({ executado_de: "2026-10-16" }, { status: "enviado" }), true);
    for (const status of ["rascunho", "para_aprovar", "aprovado"]) assert.equal(reaberturaAbreRv({}, { status }), false, status);
    assert.equal(reaberturaAbreRv({ escopo_rv: 0 }, { status: "enviado" }), false);
    assert.equal(reaberturaAbreRv({ validacao: { rv: 0, etapa: "aguardando_autorizacao" } }, { status: "enviado" }), false);
  });
});

describe("revisão (RV+1) e validação", () => {
  it("o tipo da RV seguinte: execução e aditivo pelo motivo; pedido do cliente, correção e reabertura seguem a RV revisada", () => {
    assert.deepEqual([...MOTIVOS_REVISAO], ["pedido_cliente", "correcao", "execucao", "aditivo"]);
    assert.equal(tipoDaRevisao("pedido_cliente", "proposta"), "proposta");
    assert.equal(tipoDaRevisao("correcao", "proposta"), "proposta");
    assert.equal(tipoDaRevisao("correcao", "execucao"), "execucao");
    assert.equal(tipoDaRevisao("reabertura", "proposta"), "proposta");
    assert.equal(tipoDaRevisao("execucao", "proposta"), "execucao");
    assert.equal(tipoDaRevisao("aditivo", "proposta"), "aditivo");
  });

  it("de onde cada motivo de revisão sai", () => {
    const aguardando = { etapa: "aguardando_cliente" as const };
    assert.equal(problemaDaRevisao("pedido_cliente", aguardando), null);
    assert.equal(problemaDaRevisao("correcao", aguardando), null);
    assert.match(String(problemaDaRevisao("execucao", aguardando)), /Registre a execução/);
    assert.match(String(problemaDaRevisao("aditivo", aguardando)), /demanda fechada/);

    const planejar = { etapa: "para_planejar" as const, escopo_rv: 0 };
    assert.match(String(problemaDaRevisao("pedido_cliente", planejar)), /espera o cliente/);
    assert.match(String(problemaDaRevisao("execucao", planejar)), /Registre a execução/);
    assert.equal(problemaDaRevisao("aditivo", planejar), null);

    const executada = { etapa: "execucao_a_orcar" as const, escopo_rv: 0, executado_de: "2026-10-16" };
    assert.equal(problemaDaRevisao("execucao", executada), null);
    assert.equal(problemaDaRevisao("aditivo", executada), null);
    assert.match(String(problemaDaRevisao("correcao", executada)), /espera o cliente/);

    assert.match(String(problemaDaRevisao("pedido_cliente", { etapa: "perdida", perda: { motivo: "preco" } })), /reabra/);
    assert.match(
      String(problemaDaRevisao("execucao", { etapa: "aguardando_autorizacao", escopo_rv: 0, executado_de: "2026-10-16" })),
      /execução a orçar/,
    );
  });

  it("a validação leva a aguardando autorização quando o contrato exige; senão, a faturar; medição mensal fica pendente", () => {
    assert.deepEqual(destinoDaValidacao({ cobranca: "por_demanda", autorizacao: "pedido_aceite" }), {
      etapa: "aguardando_autorizacao",
      autorizacao_exigida: true,
      medicao_pendente: false,
    });
    assert.equal(destinoDaValidacao({ cobranca: "por_demanda", autorizacao: "portal" }).etapa, "aguardando_autorizacao");
    for (const autorizacao of ["nenhuma", "medicao_aprovada", null, undefined]) {
      assert.equal(destinoDaValidacao({ cobranca: "por_demanda", autorizacao }).etapa, "a_faturar", String(autorizacao));
    }
    assert.deepEqual(destinoDaValidacao({ cobranca: "medicao_mensal", autorizacao: "medicao_aprovada" }), {
      etapa: "a_faturar",
      autorizacao_exigida: false,
      medicao_pendente: true,
    });
  });

  it("valida a RV de execução ou de aditivo enviada, ou a fechada sem desvio; a proposta se fecha", () => {
    const enviada = (tipo_rv: string, rv: number) => ({ status: "enviado", tipo_rv, rv });
    assert.equal(problemaDaValidacao({ etapa: "aguardando_cliente", escopo_rv: 0 }, enviada("execucao", 1)), null);
    assert.equal(problemaDaValidacao({ etapa: "aguardando_cliente", escopo_rv: 0 }, enviada("aditivo", 1)), null);
    assert.match(String(problemaDaValidacao({ etapa: "aguardando_cliente" }, enviada("proposta", 0))), /fecha/);
    // Sem desvio: a RV fechada, depois da execução.
    assert.equal(problemaDaValidacao({ etapa: "execucao_a_orcar", escopo_rv: 0, executado_de: "2026-10-16" }, enviada("proposta", 0)), null);
    assert.match(String(problemaDaValidacao({ etapa: "para_planejar", escopo_rv: 0 }, enviada("proposta", 0))), /para planejar/);
    assert.match(
      String(problemaDaValidacao({ etapa: "execucao_a_orcar", escopo_rv: 0 }, { status: "rascunho", tipo_rv: "execucao", rv: 1 })),
      /enviada/,
    );
  });

  it("o escopo fechado leva item, quantidade e locais, sem preço, total, origem do preço nem motivo; o ajuste fica fora", () => {
    const escopo = escopoDasLinhas([
      {
        id: "ln_1",
        origem: "alterado",
        lpu_item_id: "lpu_mesa",
        codigo: "DTL-0001-T",
        item: "Mesa",
        descricao: "Transporte de mesa",
        servico: "Transporte",
        unidade: "UN",
        quantidade: "24",
        preco: "50.00",
        preco_tabela: "40.00",
        motivo: "Espera de 2 h",
        total_cents: 120000,
        origem_local: "loc_ceic",
        destino_local: "loc_cat",
      } as never,
      { id: "ln_2", origem: "ajuste", quantidade: "1", preco: "-50.00", total_cents: -5000, motivo: "Desconto" } as never,
    ]);
    assert.deepEqual(escopo, [
      {
        linha_id: "ln_1",
        lpu_item_id: "lpu_mesa",
        codigo: "DTL-0001-T",
        item: "Mesa",
        descricao: "Transporte de mesa",
        servico: "Transporte",
        unidade: "UN",
        quantidade: "24",
        origem_local: "loc_ceic",
        destino_local: "loc_cat",
      },
    ]);
    assert.doesNotMatch(JSON.stringify(escopo), /preco|total|cents|motivo|origem"|50\.00|Espera/);
  });
});

describe("data-base e tempos", () => {
  it("o dia é o de São Paulo, não o de UTC", () => {
    // 29/06 às 23:30 em São Paulo já é 30/06 em UTC.
    assert.equal(dataDeHoje(new Date("2026-06-30T02:30:00.000Z")), "2026-06-29");
    assert.equal(dataDeHoje(new Date("2026-06-30T03:00:00.000Z")), "2026-06-30");
    assert.equal(dataDeHoje(new Date("2026-01-01T12:00:00.000Z")), "2026-01-01");
  });

  it("segundos desde o passo anterior: inteiros, nunca negativos; sem o passo, nada", () => {
    const agora = new Date("2026-10-21T13:00:00.000Z");
    assert.equal(segundosDesde("2026-10-21T12:00:00.000Z", agora), 3600);
    assert.equal(segundosDesde("2026-10-21T12:59:59.400Z", agora), 0);
    assert.equal(segundosDesde("2026-10-21T13:00:05.000Z", agora), 0);
    assert.equal(segundosDesde(undefined, agora), undefined);
    assert.equal(segundosDesde("ontem", agora), undefined);
  });
});
