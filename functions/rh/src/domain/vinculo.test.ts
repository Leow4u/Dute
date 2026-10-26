import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  diasDaCompetencia,
  entradaDoVinculo,
  situacaoNoMes,
  temVinculoNoMes,
  vinculoLido,
  vinculoSalvo,
  vinculosPorColaborador,
  type VinculoGravado,
} from "./vinculo.js";

/**
 * As datas do vínculo (parte 8.4): a admissão obrigatória, o desligamento que
 * não vem antes dela, a edição que a tela leu e a regra do vínculo no mês da
 * planilha de colaboradores. Dados sintéticos.
 */

const ANA = "col_aaaaaaaaaaaaaaaa";

function entrada(extra: Record<string, unknown> = {}) {
  return { idempotency_key: "k-1", colaborador_id: ANA, admissao: "2025-02-03", ...extra };
}

describe("a entrada das datas do vínculo", () => {
  it("a admissão é obrigatória; o desligamento e a edição são opcionais", () => {
    assert.deepEqual(entradaDoVinculo(entrada()), { idempotency_key: "k-1", colaborador_id: ANA, expected_edicao: null, admissao: "2025-02-03", desligamento: null });
    assert.deepEqual(
      entradaDoVinculo(entrada({ desligamento: "2026-10-31", expected_edicao: 2 })),
      { idempotency_key: "k-1", colaborador_id: ANA, expected_edicao: 2, admissao: "2025-02-03", desligamento: "2026-10-31" },
    );
    assert.equal(entradaDoVinculo(entrada({ desligamento: null, expected_edicao: null })).desligamento, null);
    assert.throws(() => entradaDoVinculo({ idempotency_key: "k", colaborador_id: ANA }), /Informe admissao/);
  });

  it("o desligamento pode ser no dia da admissão, nunca antes", () => {
    assert.equal(entradaDoVinculo(entrada({ desligamento: "2025-02-03" })).desligamento, "2025-02-03");
    assert.throws(() => entradaDoVinculo(entrada({ desligamento: "2025-02-02" })), /não pode ser antes da admissão/);
  });

  it("as datas existem no calendário e ficam entre 1900 e 2100; o campo a mais e o colaborador inválido recusam", () => {
    assert.throws(() => entradaDoVinculo(entrada({ admissao: "2025-02-30" })), /Data inválida/);
    assert.throws(() => entradaDoVinculo(entrada({ admissao: "0025-02-03" })), /entre 1900 e 2100/);
    assert.throws(() => entradaDoVinculo(entrada({ desligamento: "2101-01-01" })), /entre 1900 e 2100/);
    assert.throws(() => entradaDoVinculo(entrada({ salario: 3000 })), /Campo não aceito: salario/);
    assert.throws(() => entradaDoVinculo(entrada({ colaborador_id: "ana" })), /Colaborador inválido/);
  });
});

describe("as datas gravadas", () => {
  const gravado: VinculoGravado = { colaborador_id: ANA, admissao: "2025-02-03", desligamento: null, edicao: 1 };

  it("a primeira gravação nasce na edição 1, e cada uma depois soma 1", () => {
    assert.deepEqual(vinculoSalvo(null, entradaDoVinculo(entrada())), gravado);
    assert.deepEqual(
      vinculoSalvo(gravado, entradaDoVinculo(entrada({ desligamento: "2026-10-31", expected_edicao: 1 }))),
      { colaborador_id: ANA, admissao: "2025-02-03", desligamento: "2026-10-31", edicao: 2 },
    );
  });

  it("a tela com a edição velha, ou que leu sem datas quando já há, recarrega", () => {
    for (const [atual, esperada] of [[gravado, null], [gravado, 2], [null, 1]] as const) {
      assert.throws(() => vinculoSalvo(atual, entradaDoVinculo(entrada({ expected_edicao: esperada }))), /Recarregue e tente de novo/);
    }
  });

  it("a leitura confere cada campo, e o ilegível fica de fora da lista", () => {
    assert.deepEqual(vinculoLido(ANA, { colaborador_id: ANA, admissao: "2025-02-03", desligamento: null, edicao: 1 }), gravado);
    assert.throws(() => vinculoLido(ANA, { colaborador_id: "col_bbbbbbbbbbbbbbbb", admissao: "2025-02-03", edicao: 1 }), /ilegíveis/);
    assert.throws(() => vinculoLido(ANA, { colaborador_id: ANA, admissao: "03/02/2025", edicao: 1 }), /ilegíveis/);
    const lista = vinculosPorColaborador([
      { id: ANA, data: () => ({ colaborador_id: ANA, admissao: "2025-02-03", edicao: 1 }) },
      { id: "col_bbbbbbbbbbbbbbbb", data: () => ({ colaborador_id: "col_bbbbbbbbbbbbbbbb", admissao: 20250203, edicao: 1 }) },
    ]);
    assert.deepEqual([...lista.keys()], [ANA]);
  });
});

describe("o vínculo no mês", () => {
  it("o último dia da competência, com o fevereiro bissexto", () => {
    assert.deepEqual(diasDaCompetencia("2026-09"), { primeiro: "2026-09-01", ultimo: "2026-09-30" });
    assert.equal(diasDaCompetencia("2026-02").ultimo, "2026-02-28");
    assert.equal(diasDaCompetencia("2024-02").ultimo, "2024-02-29");
    assert.equal(diasDaCompetencia("2026-12").ultimo, "2026-12-31");
  });

  it("admitido até o último dia e, se desligado, desligado a partir do primeiro", () => {
    assert.equal(temVinculoNoMes({ admissao: "2026-09-30", desligamento: null }, "2026-09"), true);
    assert.equal(temVinculoNoMes({ admissao: "2026-10-01", desligamento: null }, "2026-09"), false);
    assert.equal(temVinculoNoMes({ admissao: "2024-01-10", desligamento: "2026-09-01" }, "2026-09"), true);
    assert.equal(temVinculoNoMes({ admissao: "2024-01-10", desligamento: "2026-08-31" }, "2026-09"), false);
  });

  it("a situação no mês: a admissão, o desligamento, os dois ou ativo; sem as datas, o cadastro", () => {
    assert.equal(situacaoNoMes({ admissao: "2026-09-08", desligamento: null }, true, "2026-09"), "admissao");
    assert.equal(situacaoNoMes({ admissao: "2024-03-02", desligamento: "2026-09-19" }, false, "2026-09"), "desligamento");
    assert.equal(situacaoNoMes({ admissao: "2026-09-02", desligamento: "2026-09-25" }, false, "2026-09"), "admissao_e_desligamento");
    assert.equal(situacaoNoMes({ admissao: "2024-06-10", desligamento: "2026-10-31" }, true, "2026-09"), "ativo");
    assert.equal(situacaoNoMes(null, true, "2026-09"), "ativo");
    assert.equal(situacaoNoMes(null, false, "2026-09"), "inativo");
  });
});
