import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEMAND_COUNTER_ID,
  DEMAND_COUNTERS_COLLECTION,
  ETAPAS_DEMANDA,
  PRIMEIRO_NUMERO,
  dataDeHoje,
  etapaDaDemanda,
  proximoNumero,
  rotuloDoOrcamento,
  segundosDesde,
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

  it("RV de aditivo ou de execução enviada espera a validação do cliente; a de execução em montagem é execução a orçar", () => {
    assert.equal(etapaDaDemanda(sem, { status: "enviado", tipo_rv: "aditivo" }), "aguardando_autorizacao");
    assert.equal(etapaDaDemanda(sem, { status: "enviado", tipo_rv: "execucao" }), "aguardando_autorizacao");
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
