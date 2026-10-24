import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HttpsError } from "firebase-functions/https";

import { diaEmSaoPaulo, diaValido, diasAte, somarDias } from "./dia.js";
import {
  DIAS_PARA_O_VENCIMENTO,
  TIPOS_POR_CATEGORIA,
  entradaDoArquivamento,
  entradaDoRegistro,
  grupoDoRegistro,
  marcoDoVencimento,
  registroArquivado,
  registroSalvo,
  situacoesDoGrupo,
  vencimentosDoDia,
  type RegistroGravado,
} from "./ficha.js";

/**
 * A ficha do colaborador (parte 8.2a), sem o Firestore: o catálogo e a
 * entrada, quem é o vigente de cada tipo e o que entra no Início do RH.
 */

const HOJE = "2026-10-23";
const COL = "col_0123456789abcdef";
const OUTRO_COL = "col_fedcba9876543210";

function recusa(fn: () => unknown, mensagem: string | RegExp, codigo = "invalid-argument") {
  assert.throws(fn, (error: unknown) => {
    assert.ok(error instanceof HttpsError);
    assert.equal(error.code, codigo);
    if (typeof mensagem === "string") assert.equal(error.message, mensagem);
    else assert.match(error.message, mensagem);
    return true;
  });
}

function entrada(extra: Record<string, unknown> = {}) {
  return { idempotency_key: "k-1", colaborador_id: COL, categoria: "treinamento", tipo: "nr35", emitido_em: "2025-11-10", vence_em: "2027-11-10", ...extra };
}

function registro(id: string, extra: Partial<RegistroGravado> = {}): RegistroGravado {
  return {
    id,
    colaborador_id: COL,
    categoria: "exame",
    tipo: "periodico",
    descricao: null,
    emitido_em: "2025-11-01",
    vence_em: "2026-11-01",
    resultado: "apto",
    situacao: "vigente",
    substituido_por: null,
    arquivo: null,
    edicao: 1,
    ...extra,
  };
}

const REG_A = "reg_aaaaaaaaaaaaaaaa";
const REG_B = "reg_bbbbbbbbbbbbbbbb";
const REG_C = "reg_cccccccccccccccc";

describe("os dias", () => {
  it("o dia de São Paulo, o dia que existe e a conta de dias", () => {
    assert.equal(diaEmSaoPaulo(new Date("2026-10-24T02:00:00Z")), "2026-10-23");
    assert.equal(diaValido("2026-02-28"), true);
    assert.equal(diaValido("2026-02-30"), false);
    assert.equal(diaValido("23/10/2026"), false);
    assert.equal(diasAte("2026-10-23", "2026-11-22"), 30);
    assert.equal(diasAte("2026-10-23", "2026-10-22"), -1);
    assert.equal(somarDias("2026-12-20", 30), "2027-01-19");
  });
});

describe("a entrada do registro", () => {
  it("o treinamento com o vencimento entra como veio", () => {
    assert.deepEqual(entradaDoRegistro(entrada(), HOJE), {
      idempotency_key: "k-1",
      colaborador_id: COL,
      id: null,
      expected_edicao: null,
      categoria: "treinamento",
      tipo: "nr35",
      descricao: null,
      emitido_em: "2025-11-10",
      vence_em: "2027-11-10",
      resultado: null,
    });
  });

  it("o tipo é o do catálogo da categoria, e a CNH não está nele", () => {
    recusa(() => entradaDoRegistro(entrada({ tipo: "admissional" }), HOJE), `tipo: use ${TIPOS_POR_CATEGORIA.treinamento.join(", ")}.`);
    for (const tipos of Object.values(TIPOS_POR_CATEGORIA)) assert.ok(!(tipos as readonly string[]).includes("cnh"));
  });

  it("o outro pede o nome, e só ele leva nome", () => {
    recusa(() => entradaDoRegistro(entrada({ tipo: "outro" }), HOJE), "Informe o nome do registro (ao menos 2 caracteres).");
    assert.equal(entradaDoRegistro(entrada({ tipo: "outro", descricao: "  Curso   de ponte rolante " }), HOJE).descricao, "Curso de ponte rolante");
    recusa(() => entradaDoRegistro(entrada({ descricao: "NR 35 da empresa X" }), HOJE), "Só o tipo outro leva nome.");
  });

  it("o exame pede o resultado, e só o exame tem resultado", () => {
    const exame = entrada({ categoria: "exame", tipo: "periodico" });
    recusa(() => entradaDoRegistro(exame, HOJE), "Informe o resultado do exame.");
    assert.equal(entradaDoRegistro({ ...exame, resultado: "apto_com_restricao" }, HOJE).resultado, "apto_com_restricao");
    recusa(() => entradaDoRegistro(entrada({ resultado: "apto" }), HOJE), "Só o exame tem resultado.");
    recusa(() => entradaDoRegistro({ ...exame, resultado: "positivo" }, HOJE), /^resultado: use apto, apto_com_restricao, inapto\.$/);
  });

  it("a data não passa de hoje, o vencimento vem depois e a data existe", () => {
    recusa(() => entradaDoRegistro(entrada({ emitido_em: "2026-10-24", vence_em: null }), HOJE), "A data do registro não pode ser depois de hoje.");
    assert.equal(entradaDoRegistro(entrada({ emitido_em: HOJE }), HOJE).emitido_em, HOJE);
    recusa(() => entradaDoRegistro(entrada({ vence_em: "2025-11-10" }), HOJE), "O vencimento vem depois da data do registro.");
    recusa(() => entradaDoRegistro(entrada({ emitido_em: "2026-02-30" }), HOJE), "Data inválida.");
    assert.equal(entradaDoRegistro(entrada({ vence_em: null }), HOJE).vence_em, null);
  });

  it("alterar pede o registro e a edição juntos; campo de fora não entra", () => {
    recusa(() => entradaDoRegistro(entrada({ id: REG_A }), HOJE), "Informe a edição do registro.");
    recusa(() => entradaDoRegistro(entrada({ expected_edicao: 1 }), HOJE), "Informe o registro que muda.");
    assert.equal(entradaDoRegistro(entrada({ id: REG_A, expected_edicao: 2 }), HOJE).id, REG_A);
    recusa(() => entradaDoRegistro(entrada({ salario: 3000 }), HOJE), "Campo não aceito: salario.");
    recusa(() => entradaDoRegistro(entrada({ colaborador_id: "col-1" }), HOJE), "Colaborador inválido.");
    recusa(() => entradaDoArquivamento({ idempotency_key: "k", id: REG_A }), "Informe expected_edicao.");
  });
});

describe("salvar e arquivar", () => {
  const exame = entradaDoRegistro(entrada({ categoria: "exame", tipo: "periodico", resultado: "apto", id: REG_A, expected_edicao: 1 }), HOJE);

  it("alterar sobe a edição e mantém a situação", () => {
    const salvo = registroSalvo(registro(REG_A, { situacao: "substituido", substituido_por: REG_B }), exame, REG_A);
    assert.equal(salvo.edicao, 2);
    assert.equal(salvo.situacao, "substituido");
    assert.equal(salvo.vence_em, "2027-11-10");
  });

  it("a edição velha, o arquivado, o tipo trocado e o colaborador de outro recusam", () => {
    recusa(() => registroSalvo(registro(REG_A, { edicao: 3 }), exame, REG_A), "O registro foi atualizado. Recarregue e tente de novo.", "failed-precondition");
    recusa(() => registroSalvo(registro(REG_A, { situacao: "arquivado" }), exame, REG_A), "O registro está arquivado.", "failed-precondition");
    recusa(() => registroSalvo(registro(REG_A, { tipo: "admissional" }), exame, REG_A), "O tipo do registro não muda. Arquive e registre de novo.");
    recusa(() => registroSalvo(registro(REG_A, { colaborador_id: OUTRO_COL }), exame, REG_A), "Registro não encontrado.", "not-found");
  });

  it("arquivar sobe a edição; arquivar de novo recusa", () => {
    const arquivado = registroArquivado(registro(REG_A, { situacao: "substituido", substituido_por: REG_B }), 1);
    assert.equal(arquivado.situacao, "arquivado");
    assert.equal(arquivado.substituido_por, null);
    assert.equal(arquivado.edicao, 2);
    recusa(() => registroArquivado(arquivado, 2), "O registro já está arquivado.", "failed-precondition");
  });
});

describe("o vigente de cada tipo", () => {
  it("o mais recente vale e os anteriores ficam substituídos por ele", () => {
    const situacoes = situacoesDoGrupo([
      registro(REG_A, { emitido_em: "2024-11-01" }),
      registro(REG_B, { emitido_em: "2025-11-01" }),
      registro(REG_C, { emitido_em: "2023-11-01" }),
    ]);
    assert.deepEqual(situacoes.get(REG_B), { situacao: "vigente", substituido_por: null });
    assert.deepEqual(situacoes.get(REG_A), { situacao: "substituido", substituido_por: REG_B });
    assert.deepEqual(situacoes.get(REG_C), { situacao: "substituido", substituido_por: REG_B });
  });

  it("no empate da data, vale o que vence depois; o arquivado fica de fora", () => {
    const situacoes = situacoesDoGrupo([
      registro(REG_A, { vence_em: "2026-12-01" }),
      registro(REG_B, { vence_em: "2026-11-15" }),
      registro(REG_C, { emitido_em: "2026-01-01", situacao: "arquivado" }),
    ]);
    assert.equal(situacoes.get(REG_A)?.situacao, "vigente");
    assert.equal(situacoes.get(REG_B)?.substituido_por, REG_A);
    assert.equal(situacoes.get(REG_C)?.situacao, "arquivado");
  });

  it("o tipo outro, a outra categoria e a outra pessoa são grupos à parte", () => {
    const outro1 = registro(REG_A, { categoria: "documento", tipo: "outro", resultado: null });
    const outro2 = registro(REG_B, { categoria: "documento", tipo: "outro", resultado: null });
    assert.notEqual(grupoDoRegistro(outro1), grupoDoRegistro(outro2));
    assert.notEqual(grupoDoRegistro(registro(REG_A)), grupoDoRegistro(registro(REG_A, { colaborador_id: OUTRO_COL })));
    const situacoes = situacoesDoGrupo([outro1, outro2]);
    assert.equal(situacoes.get(REG_A)?.situacao, "vigente");
    assert.equal(situacoes.get(REG_B)?.situacao, "vigente");
  });
});

describe("os vencimentos do Início do RH", () => {
  const ativos = new Set([COL]);

  it("entra o vigente de quem está ativo, a 30 dias ou menos ou vencido, o mais urgente primeiro", () => {
    const vencimentos = vencimentosDoDia(
      HOJE,
      [
        registro(REG_A, { vence_em: somarDias(HOJE, DIAS_PARA_O_VENCIMENTO) }),
        registro(REG_B, { categoria: "treinamento", tipo: "nr35", resultado: null, vence_em: "2026-10-20" }),
        registro(REG_C, { categoria: "documento", tipo: "contrato_de_trabalho", resultado: null, vence_em: somarDias(HOJE, DIAS_PARA_O_VENCIMENTO + 1) }),
      ],
      ativos,
    );
    assert.deepEqual(
      vencimentos.map((vencimento) => [vencimento.registro_id, vencimento.dias, marcoDoVencimento(vencimento.dias)]),
      [
        [REG_B, -3, "vencido"],
        [REG_A, 30, "vencendo"],
      ],
    );
  });

  it("o substituído, o arquivado, o sem vencimento e o de quem não está ativo ficam de fora", () => {
    const vencimentos = vencimentosDoDia(
      HOJE,
      [
        registro(REG_A, { situacao: "substituido", substituido_por: REG_B, vence_em: "2026-10-01" }),
        registro(REG_B, { situacao: "arquivado", vence_em: "2026-10-01" }),
        registro(REG_C, { vence_em: null }),
        registro("reg_dddddddddddddddd", { colaborador_id: OUTRO_COL, vence_em: "2026-10-01" }),
      ],
      ativos,
    );
    assert.deepEqual(vencimentos, []);
  });
});
