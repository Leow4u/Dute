import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  FAIXAS_DE_IDADE,
  MARCAS_AUTORIZACAO,
  TIPOS_AUTORIZACAO_CLIENTE,
  alertaDePrazoDePerda,
  chaveDoNumeroDoCliente,
  completarTomador,
  diasEsperandoAutorizacao,
  documentoDaAutorizacao,
  faixaDeIdade,
  inicioDaEspera,
  lerTomador,
  marcasDaAutorizacao,
  marcosDoPrazoDePerda,
  numerosDaAutorizacao,
  problemaDaDemandaParaAutorizar,
  problemaDoTipoDaAutorizacao,
  saldoDaAutorizacao,
  statusDaAutorizacao,
  valorDaAutorizacao,
} from "./autorizacao.js";
import { somarDias } from "./contratos-datas.js";
import { autorizacoesDaDemanda, etapaDaDemanda } from "./demanda.js";

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

describe("o complemento: o que falta autorizar", () => {
  const rv = (valor_cents: number) => ({ rv: 0, rv_validada: 0, valor_cents });

  it("sem outra autorização, o saldo é a soma das RVs", () => {
    assert.equal(saldoDaAutorizacao(["10045"], 184_800, []), 184_800);
  });

  it("outra autorização só destas demandas: o saldo desconta o valor dela", () => {
    assert.equal(saldoDaAutorizacao(["10045"], 184_800, [{ valor_cents: 172_800, demanda_numeros: ["10045"] }]), 12_000);
    assert.equal(
      saldoDaAutorizacao(
        ["10045", "10047"],
        369_600,
        [
          { valor_cents: 100_000, demanda_numeros: ["10045"] },
          { valor_cents: 50_000, demanda_numeros: ["10045", "10047"] },
        ],
      ),
      219_600,
    );
  });

  it("outra autorização que cobre demanda fora desta: sem saldo (não há como repartir)", () => {
    assert.equal(saldoDaAutorizacao(["10045"], 184_800, [{ valor_cents: 369_600, demanda_numeros: ["10045", "10046"] }]), null);
  });

  it("o complemento que fecha o saldo não marca valor_diverge; o que passa dele, marca", () => {
    const entrada = { demandas: [rv(184_800)], tomador_documento: null, documento_do_cadastro: MATRIZ };
    assert.deepEqual(marcasDaAutorizacao({ ...entrada, valor_cents: 12_000, saldo_cents: 12_000 }), []);
    assert.deepEqual(marcasDaAutorizacao({ ...entrada, valor_cents: 12_001, saldo_cents: 12_000 }), ["valor_diverge"]);
    assert.deepEqual(marcasDaAutorizacao({ ...entrada, valor_cents: 12_000, saldo_cents: null }), ["valor_diverge"]);
    assert.deepEqual(marcasDaAutorizacao({ ...entrada, valor_cents: 184_800, saldo_cents: 12_000 }), [], "a soma cheia continua valendo");
  });
});

describe("tomador mascarado (o e-mail do cliente esconde parte da raiz)", () => {
  it("CNPJ inteiro vale como veio, com ou sem máscara de pontuação; vazio é null", () => {
    assert.deepEqual(lerTomador("11.222.333/0002-62"), { tipo: "inteiro", cnpj: FILIAL });
    assert.deepEqual(lerTomador(MATRIZ), { tipo: "inteiro", cnpj: MATRIZ });
    assert.equal(lerTomador(""), null);
    assert.equal(lerTomador("   "), null);
    assert.equal(lerTomador(null), null);
  });

  it("raiz escondida com X ou asterisco, filial e dígitos à mostra: mascarado", () => {
    assert.deepEqual(lerTomador("11.222.XXX/0002-62"), { tipo: "mascarado", mascara: "11222XXX000262" });
    assert.deepEqual(lerTomador("11.222.xxx/0002-62"), { tipo: "mascarado", mascara: "11222XXX000262" });
    assert.deepEqual(lerTomador("11222***000262"), { tipo: "mascarado", mascara: "11222***000262" });
  });

  it("o que não é CNPJ nem a máscara do cliente é inválido", () => {
    for (const valor of ["11222333000199", "11.222.XXX/0002-6X", "11.222.333/XXXX-62", "11.222.XXX/0002", "abc", "11222XXX00026299"]) {
      assert.deepEqual(lerTomador(valor), { tipo: "invalido" }, valor);
    }
  });

  it("completa com a raiz do cadastro quando os dígitos verificadores fecham", () => {
    assert.deepEqual(completarTomador("11222XXX000262", MATRIZ), { cnpj: FILIAL });
    assert.deepEqual(completarTomador("11222***000181", "11.222.333/0001-81"), { cnpj: MATRIZ });
  });

  it("outra raiz à mostra, dígitos que não fecham ou cadastro sem CNPJ: pede o CNPJ inteiro", () => {
    assert.match(String((completarTomador("12345XXX000195", MATRIZ) as { problema?: string }).problema), /outra raiz/);
    assert.match(String((completarTomador("11222XXX000263", MATRIZ) as { problema?: string }).problema), /não fecha/);
    assert.match(String((completarTomador("11222XXX000262", null) as { problema?: string }).problema), /não tem CNPJ/);
  });
});

describe("o tipo da autorização e o contrato", () => {
  const validada = (autorizacao: string | null) => ({ validacao: { rv: 1, etapa: "aguardando_autorizacao", autorizacao, em: "2026-10-08T13:00:00.000Z" } });

  it("no contrato com pedido e aceite, só pedido e aceite; no portal, só portal", () => {
    assert.equal(problemaDoTipoDaAutorizacao("pedido_aceite", "10045", validada("pedido_aceite")), null);
    assert.equal(problemaDoTipoDaAutorizacao("portal", "10044", validada("portal")), null);
    for (const tipo of ["outro", "portal"] as const) {
      assert.match(problemaDoTipoDaAutorizacao(tipo, "10045", validada("pedido_aceite")) ?? "", /10045 é de contrato com autorização por pedido e aceite/, tipo);
    }
    for (const tipo of ["outro", "pedido_aceite"] as const) {
      assert.match(problemaDoTipoDaAutorizacao(tipo, "10044", validada("portal")) ?? "", /portal do fornecedor/, tipo);
    }
  });

  it("a medição aprovada nunca: vem da medição mensal", () => {
    for (const exigido of ["pedido_aceite", "portal", null]) {
      assert.match(problemaDoTipoDaAutorizacao("medicao_aprovada", "10045", validada(exigido)) ?? "", /medição mensal/);
    }
  });

  it("validação sem tipo exigido (o legado): pedido e aceite, portal ou outro", () => {
    for (const tipo of ["pedido_aceite", "portal", "outro"] as const) {
      assert.equal(problemaDoTipoDaAutorizacao(tipo, "10045", validada(null)), null, tipo);
      assert.equal(problemaDoTipoDaAutorizacao(tipo, "10045", {}), null, tipo);
    }
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

describe("um só formato para a autorização (registrada à mão ou da medição aprovada)", () => {
  const comum = {
    customer_code: "SAFRA",
    contrato_id: "safra-2026",
    recebida_em: "2026-11-03",
    registrada_por: "uid_1",
    registrada_por_papel: "comercial",
    registrada_em: "2026-11-03T13:30:00.000Z",
    operation_id: "op_1",
  };
  const manual = documentoDaAutorizacao({
    ...comum,
    id: "aut_manual",
    tipo: "pedido_aceite",
    valor_cents: 2_074_880,
    soma_cents: 2_074_880,
    saldo_cents: 2_074_880,
    pedido: "PO 7781",
    aceite: "AC 204",
    chave_pedido_aceite: "PO7781|AC204",
    demandas: [{ numero: "10045", rv: 2, rotulo: "10045 – RV02", valor_cents: 2_074_880 }],
    demanda_numeros: ["10045"],
    marcas: [],
  });
  const medicao = documentoDaAutorizacao({
    ...comum,
    id: "aut_safra-2026_2026-10",
    tipo: "medicao_aprovada",
    valor_cents: 480_000,
    demanda_numeros: ["10050", "10051"],
    origem: "medicao",
    medicao_id: "safra-2026_2026-10",
    competencia: "2026-10",
    demandas_pendentes: [{ numero: "10052", motivo: "proposta sem fechamento" }],
    contato_id: "ct_safra",
    email_link: "https://outlook.office.com/mail/id/aprovacao",
  });

  it("os dois têm exatamente os mesmos campos, na situação registrada", () => {
    assert.deepEqual(Object.keys(medicao).sort(), Object.keys(manual).sort());
    assert.equal(manual.status, "registrada");
    assert.equal(medicao.status, "registrada");
    assert.equal(manual.origem, "manual");
    assert.equal(medicao.origem, "medicao");
  });

  it("a medição guarda o valor aprovado em valor_cents e os números em demanda_numeros", () => {
    assert.equal(medicao.valor_cents, 480_000);
    assert.deepEqual(medicao.demanda_numeros, ["10050", "10051"]);
    assert.deepEqual(medicao.demandas, []);
    assert.equal(medicao.total_cents, undefined);
    assert.equal(medicao.demandas_a_faturar, undefined);
    assert.deepEqual(medicao.marcas, []);
    assert.deepEqual([medicao.pedido, medicao.aceite, medicao.tomador_documento], [null, null, null]);
    assert.deepEqual([medicao.nf_ids, medicao.enviada_portal_em, medicao.omie_lancada_em], [[], null, null]);
    assert.deepEqual([medicao.cancelada_em, medicao.motivo_cancelamento], [null, null]);
  });

  it("lê a situação, os números e o valor também do formato antigo da medição", () => {
    assert.equal(statusDaAutorizacao({ status: "registrada" }), "registrada");
    assert.equal(statusDaAutorizacao({ status: "cancelada" }), "cancelada");
    assert.equal(statusDaAutorizacao({ status: "a_faturar" }), "registrada", "formato antigo da medição aprovada");
    assert.equal(statusDaAutorizacao({ status: "outra" }), null);
    assert.equal(statusDaAutorizacao({}), null);

    assert.deepEqual(numerosDaAutorizacao(manual), ["10045"]);
    assert.deepEqual(numerosDaAutorizacao(medicao), ["10050", "10051"]);
    assert.deepEqual(numerosDaAutorizacao({ demandas: ["10050", "10051", "10050"] }), ["10050", "10051"], "antigo: lista de números");
    assert.deepEqual(numerosDaAutorizacao({ demandas: [{ numero: "10045" }, { numero: 7 }, "x"] }), ["10045"], "só números de demanda");
    assert.deepEqual(numerosDaAutorizacao({}), []);

    assert.equal(valorDaAutorizacao(manual), 2_074_880);
    assert.equal(valorDaAutorizacao({ total_cents: 480_000 }), 480_000, "antigo: total_cents");
    assert.equal(valorDaAutorizacao({ valor_cents: -1 }), null);
    assert.equal(valorDaAutorizacao({}), null);
  });

  it("a demanda presa à autorização antiga (autorizacao_id) também conta como autorizada", () => {
    assert.deepEqual(autorizacoesDaDemanda({ autorizacao_ids: ["aut_1"] }), ["aut_1"]);
    assert.deepEqual(autorizacoesDaDemanda({ autorizacao_id: "aut_medicao" } as never), ["aut_medicao"]);
    assert.deepEqual(autorizacoesDaDemanda({ autorizacao_ids: ["aut_1"], autorizacao_id: "aut_1" } as never), ["aut_1"]);
    assert.deepEqual(autorizacoesDaDemanda({ autorizacao_ids: ["aut_1"], autorizacao_id: "aut_2" } as never), ["aut_1", "aut_2"]);
  });
});
