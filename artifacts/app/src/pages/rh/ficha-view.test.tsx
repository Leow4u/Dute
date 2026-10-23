import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Router } from "wouter";

import { fichaLida, type FichaDoRh } from "@/lib/rh/ficha";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosDaTela, textosForaDaLista } from "@/test/textos";

import { FichaView, type EstadoDaFicha } from "./ficha-view";

/**
 * A ficha da pessoa no RH (parte 8.2c): os vigentes de cada categoria, com o
 * resultado do exame e o prazo dentro da janela, e o histórico. Sem legenda.
 * Dados sintéticos.
 */

const ANA = "col_aaaaaaaaaaaaaaaa";

function registro(id: string, extra: Record<string, unknown>) {
  return { id, colaborador_id: ANA, descricao: null, resultado: null, situacao: "vigente", substituido_por: null, arquivo: null, edicao: 1, vence_em: null, ...extra };
}

const FICHA = fichaLida({
  hoje: "2026-10-23",
  colaborador: { id: ANA, nome: "Ana Souza", funcao: "Montadora", vinculo: "proprio", ativo: true },
  registros: [
    registro("reg_1", { categoria: "documento", tipo: "rg", emitido_em: "2015-03-02" }),
    registro("reg_2", { categoria: "documento", tipo: "outro", descricao: "Certificado de vacinação", emitido_em: "2024-05-10", vence_em: "2027-05-10" }),
    registro("reg_3", { categoria: "exame", tipo: "periodico", emitido_em: "2025-11-01", vence_em: "2026-11-01", resultado: "apto" }),
    registro("reg_4", { categoria: "exame", tipo: "periodico", emitido_em: "2024-11-01", vence_em: "2025-11-01", resultado: "apto_com_restricao", situacao: "substituido", substituido_por: "reg_3" }),
    registro("reg_5", { categoria: "treinamento", tipo: "nr35", emitido_em: "2024-10-01", vence_em: "2026-10-01" }),
  ],
})!;

function render(estado: EstadoDaFicha = "pronto", ficha: FichaDoRh | undefined = FICHA, erro: string | null = null) {
  return renderToStaticMarkup(
    <Router ssrPath="/rh/ficha">
      <FichaView estado={estado} ficha={ficha} erro={erro} />
    </Router>,
  );
}

describe("a ficha da pessoa no RH", () => {
  it("o nome, a função e o vínculo; cada categoria com os vigentes, o resultado, o prazo e o histórico", () => {
    expect(textosDaTela(render())).toEqual([
      "Ana Souza",
      "Montadora · Própria",
      "Documentos",
      "2",
      "RG",
      "Emitido em 02/03/2015 · sem vencimento",
      "Certificado de vacinação",
      "Emitido em 10/05/2024 · vence em 10/05/2027",
      "Exames",
      "1",
      "ASO periódico",
      "Feito em 01/11/2025 · vence em 01/11/2026",
      "Apto",
      "Vence em 9 dias",
      "Histórico · 1",
      "Feito em 01/11/2024 · vence em 01/11/2025",
      "Apto com restrição",
      "Substituído",
      "Treinamentos",
      "NR-35 (trabalho em altura)",
      "Feito em 01/10/2024 · vence em 01/10/2026",
      "Venceu há 22 dias",
    ]);
  });

  it("quem não está ativo leva a marca; a categoria vazia diz que não há registro", () => {
    const inativa = fichaLida({ hoje: "2026-10-23", colaborador: { id: ANA, nome: "Ana Souza", funcao: "Montadora", vinculo: "proprio", ativo: false }, registros: [] })!;
    const textos = textosDaTela(render("pronto", inativa));
    expect(textos).toContain("Inativo");
    expect(textos).toEqual(expect.arrayContaining(["Nenhum documento", "Nenhum exame", "Nenhum treinamento"]));
  });

  it("carregando e erro: o título e a frase de dados, com a mensagem do servidor", () => {
    expect(textosDaTela(render("carregando", undefined))).toEqual(["Ficha", "Carregando..."]);
    expect(textosDaTela(render("erro", undefined, "Colaborador não encontrado."))).toEqual(["Ficha", "Colaborador não encontrado."]);
  });

  it("só rótulos, dados e ações: nenhum texto fora da lista", () => {
    const permitidos = [
      "Ficha",
      "Ana Souza",
      "Montadora · Própria",
      "Inativo",
      "Documentos",
      "Exames",
      "Treinamentos",
      /^\d+$/,
      "RG",
      "Certificado de vacinação",
      "ASO periódico",
      "NR-35 (trabalho em altura)",
      /^(Emitido|Feito) em \d{2}\/\d{2}\/\d{4} · (sem vencimento|vence em \d{2}\/\d{2}\/\d{4})$/,
      /^(Apto|Apto com restrição|Inapto)$/,
      /^(Vence hoje|Vence amanhã|Vence em \d+ dias|Venceu ontem|Venceu há \d+ dias)$/,
      /^Histórico · \d+$/,
      "Substituído",
      "Arquivado",
      /^Nenhum (documento|exame|treinamento)$/,
      "Carregando...",
      "Colaborador não encontrado.",
    ];
    expect(textosForaDaLista(render(), permitidos)).toEqual([]);
    expect(textosForaDaLista(render("carregando", undefined), permitidos)).toEqual([]);
  });

  it("acessibilidade: WCAG 2.1 A e AA", async () => {
    expect(await violacoesDeAcessibilidade(render())).toEqual([]);
  });
});
