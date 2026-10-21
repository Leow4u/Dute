import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  FAIXAS_DE_IDADE,
  MARCAS_AUTORIZACAO,
  TIPOS_AUTORIZACAO_CLIENTE,
  alertaDePrazoDePerda,
  chaveDoNumeroDoCliente,
  diasEsperandoAutorizacao,
  faixaDeIdade,
  inicioDaEspera,
  marcasDaAutorizacao,
  marcosDoPrazoDePerda,
  problemaDaDemandaParaAutorizar,
} from "./autorizacao.js";
import { somarDias } from "./contratos-datas.js";
import { etapaDaDemanda } from "./demanda.js";

/**
 * Regras puras da autorização de faturamento (parte 15): a idade na fila de
 * executados, o prazo de perda do contrato, as marcas e quem pode ser
 * autorizado. CNPJs e números sintéticos.
 */

/** CNPJs sintéticos com dígitos certos: matriz e filial da mesma raiz, e outra raiz. */
const MATRIZ = "11222333000181";
const FILIAL = "11222333000262";
const OUTRA_RAIZ = "12345678000195";

/** Executada em 06/10, validada em 08/10 às 10h de São Paulo. */
const demandaValidada = {
  etapa: "aguardando_autorizacao",
  customer_code: "ITAU",
  executado_de: "2026-10-05",
  executado_ate: "2026-10-06",
  validacao: { rv: 1, etapa: "aguardando_autorizacao", em: "2026-10-08T13:00:00.000Z" },
};

describe("listas da autorização", () => {
  it("tipos, marcas e faixas são os do desenho", () => {
    assert.deepEqual(TIPOS_AUTORIZACAO_CLIENTE, ["pedido_aceite", "medicao_aprovada", "portal", "outro"]);
    assert.deepEqual(MARCAS_AUTORIZACAO, ["valor_diverge", "tomador_outra_raiz", "rv_nao_validada"]);
    assert.deepEqual(FAIXAS_DE_IDADE, ["ate_30", "31_60", "mais_60"]);
  });
});

describe("dias esperando a autorização", () => {
  it("conta do fim da execução, a data que a fila mostra", () => {
    assert.deepEqual(inicioDaEspera(demandaValidada), { data: "2026-10-06", desde: "execucao" });
    assert.equal(diasEsperandoAutorizacao(demandaValidada, "2026-10-21"), 15);
    assert.equal(diasEsperandoAutorizacao(demandaValidada, "2026-10-06"), 0);
  });

  it("sem o fim da execução, usa o início dela", () => {
    const { executado_ate: _fim, ...semFim } = demandaValidada;
    assert.deepEqual(inicioDaEspera(semFim), { data: "2026-10-05", desde: "execucao" });
  });

  it("sem a execução (o legado), conta da validação, no dia de São Paulo", () => {
    const legado = { etapa: "aguardando_autorizacao", validacao: { rv: 0, etapa: "aguardando_autorizacao", em: "2026-10-09T02:30:00.000Z" } };
    // 02:30 em UTC do dia 9 ainda é 08/10 em São Paulo.
    assert.deepEqual(inicioDaEspera(legado), { data: "2026-10-08", desde: "validacao" });
    assert.equal(diasEsperandoAutorizacao(legado, "2026-10-21"), 13);
  });

  it("a data mais antiga vale: validação gravada antes do fim da execução conta da validação", () => {
    const estranha = { ...demandaValidada, executado_ate: "2026-10-12" };
    assert.deepEqual(inicioDaEspera(estranha), { data: "2026-10-08", desde: "validacao" });
  });

  it("sem execução nem validação, ou com hoje inválido, null; hoje antes do início dá 0", () => {
    assert.equal(diasEsperandoAutorizacao({}, "2026-10-21"), null);
    assert.equal(diasEsperandoAutorizacao({ validacao: { rv: 0, etapa: "a_faturar", em: "não é data" } }, "2026-10-21"), null);
    assert.equal(diasEsperandoAutorizacao(demandaValidada, "21/10/2026"), null);
    assert.equal(diasEsperandoAutorizacao(demandaValidada, "2026-10-01"), 0);
  });

  it("faixas de idade: até 30, de 31 a 60, mais de 60 (os casos do mockup)", () => {
    for (const [dias, faixa] of [
      [0, "ate_30"],
      [12, "ate_30"],
      [15, "ate_30"],
      [29, "ate_30"],
      [30, "ate_30"],
      [31, "31_60"],
      [36, "31_60"],
      [49, "31_60"],
      [60, "31_60"],
      [61, "mais_60"],
      [70, "mais_60"],
    ] as const) {
      assert.equal(faixaDeIdade(dias), faixa, String(dias));
    }
  });
});

describe("prazo de perda do contrato", () => {
  const contrato = { autorizacao: { tipo: "pedido_aceite", prazo_perda_dias: 90 } };
  const em = (dias: number) => somarDias("2026-10-06", dias);

  it("no prazo de 90 dias, avisa aos 30, 60 e 80 dias", () => {
    assert.deepEqual(marcosDoPrazoDePerda(90), [30, 60, 80]);
    assert.deepEqual(marcosDoPrazoDePerda(20), [0, 10]);
    assert.deepEqual(marcosDoPrazoDePerda(5), [0]);
  });

  it("antes dos 30 dias não há alerta; depois, o marco alcançado e os dias que faltam", () => {
    assert.equal(alertaDePrazoDePerda(contrato, demandaValidada, em(29)), null);
    const casos: Array<[number, number, number, boolean]> = [
      [30, 30, 60, false],
      [59, 30, 31, false],
      [60, 60, 30, false],
      [79, 60, 11, false],
      [80, 80, 10, false],
      [90, 80, 0, false],
      [91, 80, -1, true],
      [120, 80, -30, true],
    ];
    for (const [dias, marco, restantes, vencido] of casos) {
      const alerta = alertaDePrazoDePerda(contrato, demandaValidada, em(dias));
      assert.ok(alerta, `dia ${dias}`);
      assert.deepEqual(
        alerta,
        { prazo_dias: 90, dias, marco, restantes, limite: "2027-01-04", vencido, desde: "execucao" },
        `dia ${dias}`,
      );
    }
  });

  it("vale também a faturar (ainda sem NF); fora dessas etapas, não", () => {
    assert.equal(alertaDePrazoDePerda(contrato, { ...demandaValidada, etapa: "a_faturar" }, em(60))?.marco, 60);
    for (const etapa of ["para_planejar", "execucao_a_orcar", "aguardando_cliente", "perdida", "cancelada"]) {
      assert.equal(alertaDePrazoDePerda(contrato, { ...demandaValidada, etapa }, em(85)), null, etapa);
    }
  });

  it("contrato sem prazo de perda (ou sem contrato) não tem alerta", () => {
    for (const semPrazo of [
      null,
      undefined,
      {},
      { autorizacao: null },
      { autorizacao: { tipo: "pedido_aceite", prazo_perda_dias: null } },
      { autorizacao: { tipo: "pedido_aceite", prazo_perda_dias: 0 } },
      { autorizacao: { tipo: "pedido_aceite", prazo_perda_dias: 90.5 } },
      { autorizacao: { tipo: "pedido_aceite", prazo_perda_dias: "90" } },
    ]) {
      assert.equal(alertaDePrazoDePerda(semPrazo, demandaValidada, em(85)), null, JSON.stringify(semPrazo));
    }
  });
});

describe("marcas da autorização", () => {
  const rv = (valor_cents: number, citada = 1, validada: number | null = 1) => ({ rv: citada, rv_validada: validada, valor_cents });

  it("valor igual à soma das RVs, tomador da mesma raiz (filial) e RV validada: nenhuma marca", () => {
    assert.deepEqual(
      marcasDaAutorizacao({ valor_cents: 2_074_880, demandas: [rv(1_423_680), rv(651_200)], tomador_documento: FILIAL, documento_do_cadastro: MATRIZ }),
      [],
    );
    assert.deepEqual(
      marcasDaAutorizacao({ valor_cents: 100, demandas: [rv(100)], tomador_documento: null, documento_do_cadastro: null }),
      [],
      "sem tomador informado, nada a conferir",
    );
  });

  it("um centavo de diferença marca valor_diverge", () => {
    assert.deepEqual(
      marcasDaAutorizacao({ valor_cents: 2_074_881, demandas: [rv(1_423_680), rv(651_200)], tomador_documento: MATRIZ, documento_do_cadastro: MATRIZ }),
      ["valor_diverge"],
    );
  });

  it("tomador de outra raiz, ou cadastro sem CNPJ para conferir, marca tomador_outra_raiz", () => {
    assert.deepEqual(
      marcasDaAutorizacao({ valor_cents: 100, demandas: [rv(100)], tomador_documento: OUTRA_RAIZ, documento_do_cadastro: "11.222.333/0001-81" }),
      ["tomador_outra_raiz"],
    );
    assert.deepEqual(
      marcasDaAutorizacao({ valor_cents: 100, demandas: [rv(100)], tomador_documento: MATRIZ, documento_do_cadastro: "PROVISORIO-01" }),
      ["tomador_outra_raiz"],
    );
  });

  it("RV citada diferente da validada marca rv_nao_validada; as marcas saem na ordem da lista", () => {
    assert.deepEqual(
      marcasDaAutorizacao({
        valor_cents: 999,
        demandas: [rv(100, 0, 1), rv(200)],
        tomador_documento: OUTRA_RAIZ,
        documento_do_cadastro: MATRIZ,
      }),
      ["valor_diverge", "tomador_outra_raiz", "rv_nao_validada"],
    );
    assert.deepEqual(
      marcasDaAutorizacao({ valor_cents: 100, demandas: [rv(100, 1, null)], tomador_documento: null, documento_do_cadastro: MATRIZ }),
      ["rv_nao_validada"],
    );
  });
});

describe("quem pode receber a autorização", () => {
  it("a demanda do mesmo cliente que aguarda autorização", () => {
    assert.equal(problemaDaDemandaParaAutorizar("10045", { etapa: "aguardando_autorizacao", customer_code: "ITAU" }, "ITAU"), null);
  });

  it("no complemento, a demanda já a faturar por outra autorização", () => {
    assert.equal(
      problemaDaDemandaParaAutorizar("10045", { etapa: "a_faturar", customer_code: "ITAU", autorizacao_ids: ["aut_1"] }, "ITAU"),
      null,
    );
    assert.match(
      problemaDaDemandaParaAutorizar("10045", { etapa: "a_faturar", customer_code: "ITAU", autorizacao_ids: [] }, "ITAU") ?? "",
      /a faturar/,
    );
  });

  it("outro cliente e outras etapas são recusados", () => {
    assert.match(
      problemaDaDemandaParaAutorizar("10045", { etapa: "aguardando_autorizacao", customer_code: "SAFRA" }, "ITAU") ?? "",
      /outro cliente/,
    );
    for (const etapa of ["em_montagem", "aguardando_cliente", "para_planejar", "execucao_a_orcar", "perdida", "cancelada"] as const) {
      assert.match(problemaDaDemandaParaAutorizar("10045", { etapa, customer_code: "ITAU" }, "ITAU") ?? "", /aguarda autorização/, etapa);
    }
  });

  it("pedido e aceite comparam sem máscara nem caixa", () => {
    assert.equal(chaveDoNumeroDoCliente("PO 7781-204"), "PO7781204");
    assert.equal(chaveDoNumeroDoCliente(" po.7781/204 "), "PO7781204");
    assert.equal(chaveDoNumeroDoCliente(""), null);
    assert.equal(chaveDoNumeroDoCliente(null), null);
  });
});

describe("a etapa da demanda com a autorização", () => {
  const quote = { status: "enviado", tipo_rv: "execucao", rv: 1 };

  it("aguardando autorização, com uma autorização registrada, é a faturar; sem nenhuma, volta a aguardar", () => {
    assert.equal(etapaDaDemanda({ ...demandaValidada, escopo_rv: 0 }, quote), "aguardando_autorizacao");
    assert.equal(etapaDaDemanda({ ...demandaValidada, escopo_rv: 0, autorizacao_ids: ["aut_1"] }, quote), "a_faturar");
    assert.equal(etapaDaDemanda({ ...demandaValidada, escopo_rv: 0, autorizacao_ids: [] }, quote), "aguardando_autorizacao");
    assert.equal(etapaDaDemanda({ ...demandaValidada, escopo_rv: 0, autorizacao_ids: [""] }, quote), "aguardando_autorizacao");
  });

  it("a validação que já leva a a faturar não muda; perda e cancelamento continuam valendo", () => {
    const aFaturar = { ...demandaValidada, validacao: { ...demandaValidada.validacao, etapa: "a_faturar" } };
    assert.equal(etapaDaDemanda(aFaturar, quote), "a_faturar");
    assert.equal(etapaDaDemanda({ ...demandaValidada, autorizacao_ids: ["aut_1"], perda: { motivo: "cancelado_cliente" } }, quote), "perdida");
  });
});
