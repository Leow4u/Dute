import { describe, expect, it } from "vitest";

import { fichaLida, nomeDoRegistro, painelLido, semAdmissao, textoDoPrazo, textosDoVinculo, type VencimentoDoRh } from "./ficha";
import { itensDoInicioDoRh, numerosDoRh } from "./inicio";

/**
 * A ficha e o Início do RH na tela (partes 8.2c e 8.4b): a leitura do que as
 * callables devolvem, com as datas do vínculo, o nome de cada registro, o
 * prazo como dado e o "Precisa de você", uma linha por pessoa, o vencido
 * primeiro.
 */

const ANA = "col_aaaaaaaaaaaaaaaa";
const BRUNO = "col_bbbbbbbbbbbbbbbb";

function vencimento(colaborador: string, nome: string, tipo: string, dias: number, extra: Partial<VencimentoDoRh> = {}): VencimentoDoRh {
  return { registro_id: `reg_${tipo}`, colaborador_id: colaborador, nome, categoria: "treinamento", tipo, descricao: null, vence_em: "2026-11-01", dias, ...extra };
}

describe("a leitura das callables do RH", () => {
  it("o painel: as pessoas e os vencimentos legíveis; o resto fica de fora", () => {
    const painel = painelLido({
      hoje: "2026-10-23",
      colaboradores: [{ id: ANA, nome: "Ana Souza", funcao: "Montadora", vinculo: "proprio", ativo: true, registros: 3, vencendo: 1, vencidos: 1, proximo_vencimento: "2026-10-01" }, "lixo"],
      vencimentos: [vencimento(ANA, "Ana Souza", "nr35", -22), { registro_id: 1 }],
    });
    expect(painel?.colaboradores.map((colaborador) => [colaborador.nome, colaborador.registros, colaborador.proximo_vencimento])).toEqual([["Ana Souza", 3, "2026-10-01"]]);
    expect(painel?.vencimentos.map((item) => item.tipo)).toEqual(["nr35"]);
    expect(painelLido({ hoje: "ontem", colaboradores: [], vencimentos: [] })).toBeNull();
    expect(painelLido(null)).toBeNull();
  });

  it("a ficha: o colaborador e os registros, com o arquivo sem o caminho", () => {
    const ficha = fichaLida({
      hoje: "2026-10-23",
      colaborador: { id: ANA, nome: "Ana Souza", funcao: "Montadora", vinculo: "proprio", ativo: false },
      registros: [
        { id: "reg_1", colaborador_id: ANA, categoria: "exame", tipo: "periodico", descricao: null, emitido_em: "2025-11-01", vence_em: "2026-11-01", resultado: "apto", situacao: "vigente", substituido_por: null, arquivo: { id: "arq_1", content_type: "application/pdf", tamanho: 2048 }, edicao: 2 },
        { id: "reg_2", categoria: "salario", tipo: "x", emitido_em: "2025-11-01", situacao: "vigente" },
      ],
    });
    expect(ficha?.colaborador.ativo).toBe(false);
    expect(ficha?.registros).toHaveLength(1);
    expect(ficha?.registros[0].arquivo).toEqual({ id: "arq_1", content_type: "application/pdf", tamanho: 2048 });
    expect(fichaLida({ hoje: "2026-10-23", registros: [] })).toBeNull();
  });

  it("as datas do vínculo: no painel e na ficha, só as legíveis; a ficha leva a edição", () => {
    const painel = painelLido({
      hoje: "2026-10-23",
      colaboradores: [
        { id: ANA, nome: "Ana Souza", funcao: "Montadora", vinculo: "proprio", ativo: true, admissao: "2025-02-03", desligamento: "2026-10-31" },
        { id: BRUNO, nome: "Bruno Lima", funcao: "Motorista", vinculo: "proprio", ativo: true, admissao: "03/02/2025" },
      ],
      vencimentos: [],
    })!;
    expect(painel.colaboradores.map((colaborador) => [colaborador.admissao, colaborador.desligamento])).toEqual([["2025-02-03", "2026-10-31"], [null, null]]);

    const base = { hoje: "2026-10-23", colaborador: { id: ANA, nome: "Ana Souza", funcao: "Montadora", vinculo: "proprio", ativo: true }, registros: [] };
    expect(fichaLida({ ...base, datas_do_vinculo: { admissao: "2025-02-03", desligamento: null, edicao: 2 } })?.datas_do_vinculo).toEqual({ admissao: "2025-02-03", desligamento: null, edicao: 2 });
    for (const datas of [null, undefined, { admissao: "2025-02-03", edicao: 0 }, { admissao: "", edicao: 1 }, "lixo"]) {
      expect(fichaLida({ ...base, datas_do_vinculo: datas })?.datas_do_vinculo).toBeNull();
    }
  });

  it("sem admissão é só o próprio; as datas viram os dados da linha", () => {
    expect(semAdmissao({ vinculo: "proprio", admissao: null })).toBe(true);
    expect(semAdmissao({ vinculo: "proprio", admissao: "2025-02-03" })).toBe(false);
    expect(semAdmissao({ vinculo: "terceiro", admissao: null })).toBe(false);
    expect(semAdmissao({ vinculo: "freelancer", admissao: null })).toBe(false);
    expect(textosDoVinculo({ admissao: "2025-02-03", desligamento: "2026-10-31" })).toEqual(["Admissão 03/02/2025", "Desligamento 31/10/2026"]);
    expect(textosDoVinculo({ admissao: "2025-02-03", desligamento: null })).toEqual(["Admissão 03/02/2025"]);
    expect(textosDoVinculo(null)).toEqual([]);
  });

  it("o nome do registro e o prazo como dado", () => {
    expect(nomeDoRegistro({ tipo: "nr35", descricao: null })).toBe("NR-35 (trabalho em altura)");
    expect(nomeDoRegistro({ tipo: "outro", descricao: "Curso de ponte rolante" })).toBe("Curso de ponte rolante");
    expect([0, 1, 9, -1, -22].map(textoDoPrazo)).toEqual(["vence hoje", "vence amanhã", "vence em 9 dias", "venceu ontem", "venceu há 22 dias"]);
  });
});

describe("o Início do RH", () => {
  it("uma linha por pessoa: o vencido é crítico e vem primeiro; a ação abre a ficha", () => {
    const itens = itensDoInicioDoRh([
      vencimento(BRUNO, "Bruno Lima", "periodico", 5, { categoria: "exame" }),
      vencimento(ANA, "Ana Souza", "nr11", 12),
      vencimento(ANA, "Ana Souza", "nr35", -22),
    ]);
    expect(itens.map((item) => [item.tone, item.title, item.detail, item.href, item.actionLabel])).toEqual([
      ["critical", "Ana Souza", "NR-35 (trabalho em altura) venceu há 22 dias · NR-11 (movimentação de cargas) vence em 12 dias", `/rh/ficha?colaborador=${ANA}`, "Abrir a ficha"],
      ["attention", "Bruno Lima", "ASO periódico vence em 5 dias", `/rh/ficha?colaborador=${BRUNO}`, "Abrir a ficha"],
    ]);
    expect(itensDoInicioDoRh([])).toEqual([]);
  });

  it("os números: pessoas ativas, vencidos, vencendo e sem registro", () => {
    expect(
      numerosDoRh({
        colaboradores: [{ registros: 3 }, { registros: 0 }],
        vencimentos: [{ dias: -22 }, { dias: 9 }, { dias: 0 }],
      }),
    ).toEqual({ pessoas: 2, vencidos: 1, vencendo: 2, semRegistro: 1 });
  });
});
