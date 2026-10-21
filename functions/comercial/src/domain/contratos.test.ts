import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HttpsError } from "firebase-functions/https";

import type { FaixaPagamento } from "./contratos-datas.js";
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
 * Contratos (parte 8): entrada e as regras puras de vigência e cadastro. Os
 * alertas e a previsão de pagamento rodam os casos de lib/dominio em
 * contratos-datas.test.ts (parte 14). Os contratos daqui são sintéticos: só
 * datas e tipos, sem número de contrato de cliente.
 */

const FAIXAS_DO_DIA: FaixaPagamento[] = [
  { de: 1, ate: 10, dia: 30, mes: "mesmo" },
  { de: 11, ate: 20, dia: 10, mes: "seguinte" },
  { de: 21, ate: 31, dia: 30, mes: "seguinte" },
];

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
