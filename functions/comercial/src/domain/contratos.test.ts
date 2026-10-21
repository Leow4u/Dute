import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HttpsError } from "firebase-functions/https";

import {
  alertasDoContrato,
  diasEntre,
  pagamentoPrevisto,
  problemaDasFaixas,
  type ContratoParaAlertas,
  type FaixaPagamento,
} from "./contratos-datas.js";
import {
  ADITIVO_DADOS,
  CONTRATO_DADOS,
  SAVE_CONTRACT_INPUT,
  aditivoDocId,
  camposAlterados,
  parseEntrada,
  problemaDoCadastro,
  problemaDoIdDoContrato,
  vigenciaComAditivo,
} from "./contratos.js";
import { buildComercialEvent } from "./events.js";

/**
 * Contratos (parte 8): alertas com datas fixas, previsão de pagamento,
 * entrada e as regras puras de vigência e cadastro. Os contratos daqui são
 * sintéticos: só datas e tipos, sem número de contrato de cliente.
 */

const ANUAL: ContratoParaAlertas = {
  status: "vigente",
  vigente_de: "2026-07-01",
  vigente_ate: "2027-06-30",
  renovacao: { tipo: "aditivo", aviso_dias: 30, oposicao_ate_dias: null },
  reajuste: { tipo: "negociado", indice: null, data_base: null },
};

/** Renovação automática, oposição até o fim e reajuste por IPCA na data de início. */
const AUTOMATICO: ContratoParaAlertas = {
  status: "vigente",
  vigente_de: "2026-07-01",
  vigente_ate: "2027-07-01",
  renovacao: { tipo: "automatica", aviso_dias: null, oposicao_ate_dias: 0 },
  reajuste: { tipo: "indice", indice: "IPCA", data_base: "07-01" },
};

const INDETERMINADO: ContratoParaAlertas = {
  status: "vigente",
  vigente_de: "2025-05-12",
  vigente_ate: null,
  renovacao: { tipo: "indeterminado", aviso_dias: null, oposicao_ate_dias: null },
  reajuste: { tipo: "negociado", indice: null, data_base: null },
};

const FAIXAS_DO_DIA: FaixaPagamento[] = [
  { de: 1, ate: 10, dia: 30, mes: "mesmo" },
  { de: 11, ate: 20, dia: 10, mes: "seguinte" },
  { de: 21, ate: 31, dia: 30, mes: "seguinte" },
];

const PAGA_POR_FAIXA = { pagamento: { tipo: "faixas_do_dia_da_nf" as const, faixas: FAIXAS_DO_DIA, dias: null, texto: null } };

/** Contrato válido, como a tela e a carga mandam. */
function contratoValido(overrides: Record<string, unknown> = {}) {
  return {
    customer_code: "CLIENTE-A",
    nome: "Contrato de serviços",
    numeros: [{ tipo: "contrato", numero: "CT-0001" }],
    objeto: "Mudanças e montagem de mobiliário.",
    vigente_de: "2026-07-01",
    vigente_ate: "2027-06-30",
    renovacao: { tipo: "aditivo", aviso_dias: 30, oposicao_ate_dias: null },
    reajuste: { tipo: "negociado", indice: null, data_base: null },
    regimes: [{ servico: "Mudança", regime: "por_demanda" }],
    regime_padrao: "por_demanda",
    autorizacao: { tipo: "pedido_aceite", prazo_perda_dias: null },
    pagamento: { tipo: "faixas_do_dia_da_nf", faixas: FAIXAS_DO_DIA, dias: null, texto: null },
    impostos: { inclusos: null, texto: null },
    codigo_servico: "1602",
    documentos: [{ nome: "Contrato assinado", referencia: "OneDrive/Contratos/cliente-a.pdf" }],
    status: "vigente",
    ...overrides,
  };
}

function aditivoValido(overrides: Record<string, unknown> = {}) {
  return {
    numero: 1,
    assinado_em: "2027-06-15",
    tipo: "prorrogacao",
    vigente_de: "2027-07-01",
    vigente_ate: "2028-06-30",
    tabela_ids: [],
    documento: { nome: "Aditivo 1", referencia: "OneDrive/Contratos/aditivo-1.pdf" },
    observacao: "",
    ...overrides,
  };
}

function erroDe(schema: typeof CONTRATO_DADOS | typeof ADITIVO_DADOS, value: unknown): string {
  const parsed = schema.safeParse(value);
  assert.equal(parsed.success, false, "deveria recusar");
  return parsed.success ? "" : parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join(" | ");
}

describe("alertas do contrato", () => {
  it("longe do fim, nenhum alerta", () => {
    assert.deepEqual(alertasDoContrato(ANUAL, "2026-10-21"), []);
  });

  it("o prazo de aviso aparece antes do fim, a 120 dias dele", () => {
    assert.deepEqual(alertasDoContrato(ANUAL, "2027-03-01"), [
      { tipo: "renovacao", data: "2027-05-31", dias: 91, marco: 120 },
    ]);
  });

  it("fim a 120 dias e prazo de aviso a 90", () => {
    assert.deepEqual(alertasDoContrato(ANUAL, "2027-03-02"), [
      { tipo: "renovacao", data: "2027-05-31", dias: 90, marco: 90 },
      { tipo: "fim_vigencia", data: "2027-06-30", dias: 120, marco: 120 },
    ]);
  });

  it("a 30 dias do fim, com o prazo de aviso já perdido", () => {
    assert.deepEqual(alertasDoContrato(ANUAL, "2027-06-01"), [
      { tipo: "renovacao", data: "2027-05-31", dias: -1, marco: 0 },
      { tipo: "fim_vigencia", data: "2027-06-30", dias: 29, marco: 30 },
    ]);
  });

  it("vencimento já passado continua no alerta, com dias negativos, sem o prazo de aviso", () => {
    assert.deepEqual(alertasDoContrato(ANUAL, "2027-07-10"), [
      { tipo: "fim_vigencia", data: "2027-06-30", dias: -10, marco: 0 },
    ]);
    assert.deepEqual(alertasDoContrato(ANUAL, "2029-01-01")[0]?.marco, 0);
  });

  it("no dia do fim, marco de 30 dias e zero dias", () => {
    assert.deepEqual(alertasDoContrato({ ...ANUAL, renovacao: { tipo: "aditivo", aviso_dias: null, oposicao_ate_dias: null } }, "2027-06-30"), [
      { tipo: "fim_vigencia", data: "2027-06-30", dias: 0, marco: 30 },
    ]);
  });

  it("contrato encerrado não tem alerta", () => {
    assert.deepEqual(alertasDoContrato({ ...ANUAL, status: "encerrado" }, "2027-07-10"), []);
  });

  it("contrato indeterminado não tem fim nem renovação", () => {
    for (const hoje of ["2025-05-12", "2026-10-21", "2030-01-01"]) {
      assert.deepEqual(alertasDoContrato(INDETERMINADO, hoje), [], hoje);
    }
  });

  it("indeterminado com reajuste por índice só avisa o reajuste", () => {
    const comIndice: ContratoParaAlertas = {
      ...INDETERMINADO,
      reajuste: { tipo: "indice", indice: "IGP-M", data_base: "03-01" },
    };
    assert.deepEqual(alertasDoContrato(comIndice, "2026-01-15"), [
      { tipo: "reajuste", data: "2026-03-01", dias: 45, marco: 90 },
    ]);
  });

  it("renovação automática com oposição até o fim: fim e reajuste, sem prazo à parte", () => {
    assert.deepEqual(alertasDoContrato(AUTOMATICO, "2027-03-03"), [
      { tipo: "fim_vigencia", data: "2027-07-01", dias: 120, marco: 120 },
      { tipo: "reajuste", data: "2027-07-01", dias: 120, marco: 120 },
    ]);
  });

  it("o reajuste é a primeira data-base depois do início, não o próprio início", () => {
    assert.deepEqual(alertasDoContrato(AUTOMATICO, "2026-07-01"), []);
  });

  it("reajuste vencido aparece por 30 dias; depois vale o do ano seguinte", () => {
    assert.deepEqual(alertasDoContrato(AUTOMATICO, "2027-07-20"), [
      { tipo: "fim_vigencia", data: "2027-07-01", dias: -19, marco: 0 },
      { tipo: "reajuste", data: "2027-07-01", dias: -19, marco: 0 },
    ]);
    assert.deepEqual(alertasDoContrato(AUTOMATICO, "2027-08-15"), [
      { tipo: "fim_vigencia", data: "2027-07-01", dias: -45, marco: 0 },
    ]);
    assert.deepEqual(alertasDoContrato(AUTOMATICO, "2028-03-03"), [
      { tipo: "fim_vigencia", data: "2027-07-01", dias: -246, marco: 0 },
      { tipo: "reajuste", data: "2028-07-01", dias: 120, marco: 120 },
    ]);
  });

  it("renovação automática com prazo de oposição: o último dia para se opor", () => {
    const comOposicao: ContratoParaAlertas = {
      ...AUTOMATICO,
      vigente_de: "2026-01-01",
      vigente_ate: "2026-12-31",
      renovacao: { tipo: "automatica", aviso_dias: null, oposicao_ate_dias: 60 },
      reajuste: { tipo: "nenhum", indice: null, data_base: null },
    };
    assert.deepEqual(alertasDoContrato(comOposicao, "2026-10-21"), [
      { tipo: "renovacao", data: "2026-11-01", dias: 11, marco: 30 },
      { tipo: "fim_vigencia", data: "2026-12-31", dias: 71, marco: 90 },
    ]);
  });

  it("reajuste depois do fim, sem renovação automática, não aparece", () => {
    const anualComIndice: ContratoParaAlertas = { ...ANUAL, reajuste: { tipo: "indice", indice: "IPCA", data_base: "07-01" } };
    assert.deepEqual(
      alertasDoContrato(anualComIndice, "2027-03-02").map((alerta) => alerta.tipo),
      ["renovacao", "fim_vigencia"],
    );
  });

  it("data-base em 29/02 cai em 28/02 no ano comum", () => {
    const bissexto: ContratoParaAlertas = { ...INDETERMINADO, vigente_de: "2024-03-01", reajuste: { tipo: "indice", indice: "IPCA", data_base: "02-29" } };
    assert.deepEqual(alertasDoContrato(bissexto, "2027-02-01"), [{ tipo: "reajuste", data: "2027-02-28", dias: 27, marco: 30 }]);
    assert.deepEqual(alertasDoContrato(bissexto, "2028-02-01"), [{ tipo: "reajuste", data: "2028-02-29", dias: 28, marco: 30 }]);
  });

  it("hoje fora do formato é erro", () => {
    assert.throws(() => alertasDoContrato(ANUAL, "21/10/2026"));
    assert.throws(() => alertasDoContrato(ANUAL, "2026-02-30"));
  });
});

describe("pagamento previsto", () => {
  it("faixas do dia da NF: 1–10, 11–20 e 21–31", () => {
    assert.equal(pagamentoPrevisto(PAGA_POR_FAIXA, "2026-03-05"), "2026-03-30");
    assert.equal(pagamentoPrevisto(PAGA_POR_FAIXA, "2026-03-10"), "2026-03-30");
    assert.equal(pagamentoPrevisto(PAGA_POR_FAIXA, "2026-03-11"), "2026-04-10");
    assert.equal(pagamentoPrevisto(PAGA_POR_FAIXA, "2026-03-20"), "2026-04-10");
    assert.equal(pagamentoPrevisto(PAGA_POR_FAIXA, "2026-03-21"), "2026-04-30");
    assert.equal(pagamentoPrevisto(PAGA_POR_FAIXA, "2026-03-31"), "2026-04-30");
  });

  it("fevereiro sem dia 30 paga no último dia, inclusive no ano bissexto", () => {
    assert.equal(pagamentoPrevisto(PAGA_POR_FAIXA, "2027-02-05"), "2027-02-28");
    assert.equal(pagamentoPrevisto(PAGA_POR_FAIXA, "2028-02-05"), "2028-02-29");
    assert.equal(pagamentoPrevisto(PAGA_POR_FAIXA, "2027-01-25"), "2027-02-28");
    assert.equal(pagamentoPrevisto(PAGA_POR_FAIXA, "2027-01-31"), "2027-02-28");
    assert.equal(pagamentoPrevisto(PAGA_POR_FAIXA, "2027-01-15"), "2027-02-10");
  });

  it("virada do ano", () => {
    assert.equal(pagamentoPrevisto(PAGA_POR_FAIXA, "2026-12-10"), "2026-12-30");
    assert.equal(pagamentoPrevisto(PAGA_POR_FAIXA, "2026-12-15"), "2027-01-10");
    assert.equal(pagamentoPrevisto(PAGA_POR_FAIXA, "2026-12-31"), "2027-01-30");
  });

  it("dias depois da NF, em dias corridos", () => {
    const trintaDias = { pagamento: { tipo: "dias_apos_nf" as const, faixas: [], dias: 30, texto: null } };
    assert.equal(pagamentoPrevisto(trintaDias, "2026-12-20"), "2027-01-19");
    assert.equal(pagamentoPrevisto(trintaDias, "2028-01-31"), "2028-03-01");
    assert.equal(pagamentoPrevisto({ pagamento: { ...trintaDias.pagamento, dias: 15 } }, "2027-02-14"), "2027-03-01");
  });

  it("regra em texto não tem previsão calculada", () => {
    assert.equal(pagamentoPrevisto({ pagamento: { tipo: "texto", faixas: [], dias: null, texto: "Conforme portal." } }, "2026-03-05"), null);
  });

  it("data da NF fora do formato é erro", () => {
    assert.throws(() => pagamentoPrevisto(PAGA_POR_FAIXA, "2026-02-30"));
  });

  it("faixas precisam cobrir 1 a 31, sem buraco nem sobreposição", () => {
    assert.equal(problemaDasFaixas(FAIXAS_DO_DIA), null);
    assert.match(String(problemaDasFaixas([])), /Informe as faixas/);
    assert.match(String(problemaDasFaixas(FAIXAS_DO_DIA.slice(0, 2))), /não cobrem o dia 21/);
    assert.match(String(problemaDasFaixas([FAIXAS_DO_DIA[0], FAIXAS_DO_DIA[2]])), /não cobrem o dia 11/);
    assert.match(
      String(problemaDasFaixas([FAIXAS_DO_DIA[0], { ...FAIXAS_DO_DIA[1], de: 10 }, FAIXAS_DO_DIA[2]])),
      /sobrepõe/,
    );
    assert.match(String(problemaDasFaixas([{ de: 5, ate: 1, dia: 30, mes: "mesmo" }])), /inicial passa do final/);
  });

  it("diasEntre atravessa ano bissexto", () => {
    assert.equal(diasEntre("2028-02-28", "2028-03-01"), 2);
    assert.equal(diasEntre("2027-02-28", "2027-03-01"), 1);
    assert.equal(diasEntre("2027-01-01", "2026-12-31"), -1);
  });
});

describe("entrada do contrato", () => {
  it("o contrato completo passa", () => {
    const parsed = CONTRATO_DADOS.safeParse(contratoValido());
    assert.ok(parsed.success, parsed.success ? "" : parsed.error.message);
  });

  it("campos opcionais ganham o padrão", () => {
    const { numeros: _n, objeto: _o, regimes: _r, impostos: _i, codigo_servico: _c, documentos: _d, ...minimo } = contratoValido();
    const parsed = CONTRATO_DADOS.parse(minimo);
    assert.deepEqual(parsed.numeros, []);
    assert.equal(parsed.objeto, "");
    assert.deepEqual(parsed.impostos, { inclusos: null, texto: null });
    assert.equal(parsed.codigo_servico, null);
  });

  it("preço não entra no contrato", () => {
    for (const campo of ["valor", "valor_estimado", "preco", "tabela"]) {
      assert.match(erroDe(CONTRATO_DADOS, contratoValido({ [campo]: "1500.00" })), /Unrecognized key/, campo);
    }
  });

  it("vigência ao contrário, oposição fora da automática e reajuste por índice incompleto são recusados", () => {
    assert.match(erroDe(CONTRATO_DADOS, contratoValido({ vigente_ate: "2026-06-30" })), /vigente_ate: O fim da vigência vem antes/);
    assert.match(
      erroDe(CONTRATO_DADOS, contratoValido({ renovacao: { tipo: "aditivo", aviso_dias: 30, oposicao_ate_dias: 60 } })),
      /oposicao_ate_dias/,
    );
    assert.match(
      erroDe(CONTRATO_DADOS, contratoValido({ reajuste: { tipo: "indice", indice: "IPCA", data_base: null } })),
      /reajuste.data_base/,
    );
    assert.match(
      erroDe(CONTRATO_DADOS, contratoValido({ reajuste: { tipo: "indice", indice: "IPCA", data_base: "02-30" } })),
      /Data-base inválida/,
    );
    assert.match(
      erroDe(CONTRATO_DADOS, contratoValido({ reajuste: { tipo: "negociado", indice: "IPCA", data_base: null } })),
      /só no reajuste por índice/,
    );
  });

  it("regra de pagamento coerente com o tipo", () => {
    assert.match(
      erroDe(CONTRATO_DADOS, contratoValido({ pagamento: { tipo: "faixas_do_dia_da_nf", faixas: FAIXAS_DO_DIA.slice(0, 2) } })),
      /não cobrem o dia 21/,
    );
    assert.match(erroDe(CONTRATO_DADOS, contratoValido({ pagamento: { tipo: "dias_apos_nf" } })), /pagamento.dias/);
    assert.match(erroDe(CONTRATO_DADOS, contratoValido({ pagamento: { tipo: "texto" } })), /pagamento.texto/);
    assert.ok(CONTRATO_DADOS.safeParse(contratoValido({ pagamento: { tipo: "dias_apos_nf", dias: 30 } })).success);
  });

  it("data inválida, código de serviço e serviço repetido", () => {
    assert.match(erroDe(CONTRATO_DADOS, contratoValido({ vigente_de: "2026-02-30" })), /Data inválida/);
    assert.match(erroDe(CONTRATO_DADOS, contratoValido({ codigo_servico: "16.02" })), /Código de serviço/);
    assert.match(
      erroDe(CONTRATO_DADOS, contratoValido({ regimes: [{ servico: "Mudança", regime: "por_demanda" }, { servico: "mudança", regime: "wms" }] })),
      /Serviço repetido/,
    );
  });

  it("atualizar exige contrato e edição; criar não tem edição", () => {
    const base = { idempotency_key: "k1", contrato: contratoValido() };
    assert.ok(SAVE_CONTRACT_INPUT.safeParse({ ...base, acao: "criar" }).success);
    assert.ok(SAVE_CONTRACT_INPUT.safeParse({ ...base, acao: "atualizar", contrato_id: "ct-1", edicao: 1 }).success);
    assert.equal(SAVE_CONTRACT_INPUT.safeParse({ ...base, acao: "atualizar", contrato_id: "ct-1" }).success, false);
    assert.equal(SAVE_CONTRACT_INPUT.safeParse({ ...base, acao: "atualizar", edicao: 1 }).success, false);
    assert.equal(SAVE_CONTRACT_INPUT.safeParse({ ...base, acao: "criar", edicao: 1 }).success, false);
    assert.equal(SAVE_CONTRACT_INPUT.safeParse({ ...base, acao: "criar", contrato_id: "com espaço" }).success, false);
  });

  it("entrada inválida é invalid-argument com o campo, nunca internal", () => {
    assert.throws(
      () => parseEntrada(SAVE_CONTRACT_INPUT, { acao: "criar", idempotency_key: "k1", contrato: contratoValido({ status: "ativo" }) }),
      (error: unknown) => error instanceof HttpsError && error.code === "invalid-argument" && /contrato\.status/.test(error.message),
    );
    assert.throws(
      () => parseEntrada(SAVE_CONTRACT_INPUT, null),
      (error: unknown) => error instanceof HttpsError && error.code === "invalid-argument",
    );
  });
});

describe("entrada do aditivo", () => {
  it("prorrogação com vigência passa", () => {
    assert.ok(ADITIVO_DADOS.safeParse(aditivoValido()).success);
  });

  it("prorrogação sem vigência, vigência pela metade ou ao contrário é recusada", () => {
    assert.match(erroDe(ADITIVO_DADOS, aditivoValido({ vigente_de: null, vigente_ate: null })), /Prorrogação precisa da vigência nova/);
    assert.match(erroDe(ADITIVO_DADOS, aditivoValido({ vigente_ate: null })), /início e fim/);
    assert.match(erroDe(ADITIVO_DADOS, aditivoValido({ vigente_ate: "2027-06-30" })), /vem antes do início/);
  });

  it("aditivo de preço liga tabela; os outros não", () => {
    assert.match(erroDe(ADITIVO_DADOS, aditivoValido({ tipo: "preco" })), /liga ao menos uma tabela/);
    assert.ok(ADITIVO_DADOS.safeParse(aditivoValido({ tipo: "preco", tabela_ids: ["tab-a"] })).success);
    assert.ok(ADITIVO_DADOS.safeParse(aditivoValido({ tipo: "preco", tabela_ids: ["tab-a"], vigente_de: null, vigente_ate: null })).success);
    assert.match(erroDe(ADITIVO_DADOS, aditivoValido({ tabela_ids: ["tab-a"] })), /Só aditivo de preço liga tabela/);
    assert.match(erroDe(ADITIVO_DADOS, aditivoValido({ tipo: "preco", tabela_ids: ["tab-a", "tab-a"] })), /Tabela repetida/);
  });

  it("escopo e outros tipos não mudam a vigência", () => {
    assert.match(erroDe(ADITIVO_DADOS, aditivoValido({ tipo: "escopo" })), /Só aditivo de prorrogação ou de preço muda a vigência/);
    assert.ok(ADITIVO_DADOS.safeParse(aditivoValido({ tipo: "escopo", vigente_de: null, vigente_ate: null })).success);
  });

  it("sem documento localizado, o aditivo entra", () => {
    const parsed = ADITIVO_DADOS.parse(aditivoValido({ documento: undefined }));
    assert.equal(parsed.documento, null);
  });

  it("o id do aditivo é o número: contracts/{id}/aditivos/{numero}", () => {
    assert.equal(aditivoDocId(1), "1");
    assert.equal(aditivoDocId(12), "12");
    assert.equal(aditivoDocId(104), "104");
  });
});

describe("id do contrato", () => {
  const base = { idempotency_key: "k1", acao: "criar" as const };

  it("o id não leva o número do contrato no cliente: ele vai nos eventos", () => {
    const numeros = [
      { tipo: "contrato", numero: "CT-998877" },
      { tipo: "sistema_cliente", numero: "SC.0001/A" },
    ];
    for (const id of ["CT-998877", "ct998877", "cliente-a-ct-998877", "998877", "cliente-a-998877", "sc0001a", "SC-0001-A-2026"]) {
      assert.match(String(problemaDoIdDoContrato(id, numeros)), /número do contrato no cliente/, id);
      const parsed = SAVE_CONTRACT_INPUT.safeParse({ ...base, contrato_id: id, contrato: contratoValido({ numeros }) });
      assert.equal(parsed.success, false, id);
      assert.deepEqual(parsed.success ? [] : parsed.error.issues.map((issue) => issue.path.join(".")), ["contrato_id"], id);
    }
  });

  it("id interno com o ano, ou id automático, passa", () => {
    const numeros = [
      { tipo: "contrato", numero: "001/2026" },
      { tipo: "outro", numero: "12" },
    ];
    for (const id of ["cliente-a-2026", "cliente-a-2026-mudanca", "X7aB9cD0eF1gH2iJ3kL4"]) {
      assert.equal(problemaDoIdDoContrato(id, numeros), null, id);
    }
    assert.ok(SAVE_CONTRACT_INPUT.safeParse({ ...base, contrato_id: "cliente-a-2026", contrato: contratoValido({ numeros }) }).success);
    assert.ok(SAVE_CONTRACT_INPUT.safeParse({ ...base, contrato: contratoValido({ numeros }) }).success);
  });

  it("vale também ao atualizar", () => {
    const parsed = SAVE_CONTRACT_INPUT.safeParse({
      idempotency_key: "k2",
      acao: "atualizar",
      contrato_id: "ct-0001",
      edicao: 1,
      contrato: contratoValido(),
    });
    assert.equal(parsed.success, false);
  });
});

describe("vigência depois do aditivo", () => {
  const atual = { de: "2026-07-01", ate: "2027-06-30" };
  const prorrogacao = { tipo: "prorrogacao" as const, vigente_de: "2027-07-01", vigente_ate: "2028-06-30" };

  it("prorrogação estende a vigência", () => {
    assert.deepEqual(vigenciaComAditivo(atual, prorrogacao), { de: "2027-07-01", ate: "2028-06-30", alterada: true });
    assert.deepEqual(vigenciaComAditivo(atual, { ...prorrogacao, tipo: "preco" }), { de: "2027-07-01", ate: "2028-06-30", alterada: true });
  });

  it("aditivo antigo, registrado depois, só entra no histórico", () => {
    const antigo = { tipo: "prorrogacao" as const, vigente_de: "2024-07-01", vigente_ate: "2025-06-30" };
    assert.deepEqual(vigenciaComAditivo(atual, antigo), { ...atual, alterada: false });
    assert.deepEqual(vigenciaComAditivo(atual, { ...prorrogacao, vigente_ate: "2027-06-30" }), { ...atual, alterada: false });
  });

  it("contrato sem fim recebe a vigência do aditivo que começa depois dele: vira prazo fixo", () => {
    assert.deepEqual(vigenciaComAditivo({ de: "2025-05-12", ate: null }, prorrogacao), { de: "2027-07-01", ate: "2028-06-30", alterada: true });
    const noMesmoDia = { ...prorrogacao, vigente_de: "2025-05-12" };
    assert.deepEqual(vigenciaComAditivo({ de: "2025-05-12", ate: null }, noMesmoDia), { de: "2025-05-12", ate: "2028-06-30", alterada: true });
  });

  it("aditivo antigo em contrato sem fim só entra no histórico: o contrato continua indeterminado", () => {
    const indeterminado = { de: "2026-01-01", ate: null };
    const antigo = { tipo: "prorrogacao" as const, vigente_de: "2019-01-01", vigente_ate: "2019-12-31" };
    assert.deepEqual(vigenciaComAditivo(indeterminado, antigo), { ...indeterminado, alterada: false });
    assert.deepEqual(
      vigenciaComAditivo(indeterminado, { ...antigo, tipo: "preco", vigente_ate: "2030-12-31" }),
      { ...indeterminado, alterada: false },
      "começou antes do contrato atual: é histórico, mesmo terminando depois",
    );
  });

  it("preço sem vigência e escopo não mexem na vigência", () => {
    assert.deepEqual(vigenciaComAditivo(atual, { tipo: "preco", vigente_de: null, vigente_ate: null }), { ...atual, alterada: false });
    assert.deepEqual(vigenciaComAditivo(atual, { ...prorrogacao, tipo: "escopo" }), { ...atual, alterada: false });
  });
});

describe("cadastro do contrato", () => {
  it("contrato é de cliente: sem cadastro ou prospect é recusado", () => {
    assert.match(String(problemaDoCadastro("NOVO", [], true)), /não encontrado/);
    assert.match(String(problemaDoCadastro("PROSP", [{ stage: "prospect" }], true)), /ainda é prospect/);
    assert.match(String(problemaDoCadastro("PROSP", [{ stage: "prospect" }], false)), /ainda é prospect/);
    assert.equal(problemaDoCadastro("CLI", [{ stage: "cliente" }], true), null);
    assert.equal(problemaDoCadastro("BTG Pactual", [{ code: "BTG Pactual" }], true), null);
  });

  it("arquivado não ganha contrato novo, mas o contrato dele continua editável", () => {
    assert.match(String(problemaDoCadastro("ARQ", [{ status: "archived" }], true)), /arquivado/);
    assert.match(String(problemaDoCadastro("ARQ", [{ archived: true }], true)), /arquivado/);
    assert.equal(problemaDoCadastro("ARQ", [{ status: "archived" }], false), null);
  });

  it("campos alterados na ordem do formulário", () => {
    const antes = CONTRATO_DADOS.parse(contratoValido());
    assert.deepEqual(camposAlterados(antes, antes), []);
    const depois = CONTRATO_DADOS.parse(
      contratoValido({ status: "encerrado", vigente_ate: "2027-01-31", renovacao: { tipo: "aditivo", aviso_dias: 60 } }),
    );
    assert.deepEqual(camposAlterados(antes, depois), ["vigente_ate", "renovacao", "status"]);
  });
});

describe("eventos do contrato", () => {
  const equipe = { uid: "com-1", role: "comercial", name: "Guilherme" };

  it("o evento não leva número do contrato no cliente, objeto nem documento", () => {
    for (const extra of [{ numero: "CT-0001" }, { objeto: "Mudanças" }, { numeros: ["CT-0001"] }, { referencia: "OneDrive/x.pdf" }]) {
      assert.throws(
        () =>
          buildComercialEvent({
            operation_id: "op_1",
            type: "contract.created",
            entity_id: "ct-1",
            customer_code: "CLIENTE-A",
            payload: { contrato_id: "ct-1", regime: "por_demanda", vigente_de: "2026-07-01", vigente_ate: null, ...extra } as never,
            actor: equipe,
          }),
        HttpsError,
        JSON.stringify(extra),
      );
    }
  });

  it("título e descrição do aditivo e do encerramento", () => {
    const aditivo = buildComercialEvent({
      operation_id: "op_2",
      type: "contract.amendment_added",
      entity_id: "ct-1",
      customer_code: "CLIENTE-A",
      payload: {
        contrato_id: "ct-1",
        aditivo_id: "4",
        tipo: "preco",
        vigencia_alterada: true,
        vigente_ate: "2027-06-30",
        tabelas: 2,
        documento_localizado: true,
      },
      actor: equipe,
    });
    assert.equal(aditivo.title, "Aditivo 4 registrado no contrato");
    assert.equal(aditivo.description, "Aditivo de preço; vigência prorrogada até 30/06/2027; 2 tabelas ligadas.");
    const semDocumento = buildComercialEvent({
      operation_id: "op_3",
      type: "contract.amendment_added",
      entity_id: "ct-1",
      customer_code: "CLIENTE-A",
      payload: { contrato_id: "ct-1", aditivo_id: "1", tipo: "prorrogacao", vigencia_alterada: false, tabelas: 0, documento_localizado: false },
      actor: equipe,
    });
    assert.equal(semDocumento.description, "Aditivo de prorrogação; vigência mantida; documento não localizado.");
    const encerrado = buildComercialEvent({
      operation_id: "op_4",
      type: "contract.updated",
      entity_id: "ct-1",
      customer_code: "CLIENTE-A",
      payload: { contrato_id: "ct-1", campos: ["status"], edicao: 3, status: "encerrado" },
      actor: equipe,
    });
    assert.equal(encerrado.title, "Contrato encerrado");
    const criado = buildComercialEvent({
      operation_id: "op_5",
      type: "contract.created",
      entity_id: "ct-1",
      customer_code: "CLIENTE-A",
      payload: { contrato_id: "ct-1", regime: "medicao_mensal", vigente_de: "2025-05-12", vigente_ate: null },
      actor: equipe,
    });
    assert.equal(criado.description, "Cobrança medição mensal; vigente desde 12/05/2025, por prazo indeterminado.");
  });
});
