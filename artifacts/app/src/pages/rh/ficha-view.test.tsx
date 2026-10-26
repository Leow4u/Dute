import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Router } from "wouter";

import { fichaLida, type FichaDoRh } from "@/lib/rh/ficha";
import { comCategoria, formularioDoRegistro, formularioDoVinculo, formularioNovo } from "@/lib/rh/formulario";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosDaTela, textosForaDaLista } from "@/test/textos";

import { FichaView, type AcoesDaFicha, type FichaViewProps } from "./ficha-view";

/**
 * A ficha da pessoa no RH (partes 8.2c, 8.2d e 8.4b): os vigentes de cada
 * categoria, com o resultado do exame e o prazo dentro da janela, o
 * histórico e as datas do vínculo. Owner e admin só leem e abrem o arquivo;
 * o rh inclui, altera, arquiva, anexa e grava as datas. Sem legenda. Dados
 * sintéticos.
 */

const ANA = "col_aaaaaaaaaaaaaaaa";

function registro(id: string, extra: Record<string, unknown>) {
  return { id, colaborador_id: ANA, descricao: null, resultado: null, situacao: "vigente", substituido_por: null, arquivo: null, edicao: 1, vence_em: null, ...extra };
}

const FICHA = fichaLida({
  hoje: "2026-10-23",
  colaborador: { id: ANA, nome: "Ana Souza", funcao: "Montadora", vinculo: "proprio", ativo: true },
  registros: [
    registro("reg_1", { categoria: "documento", tipo: "rg", emitido_em: "2015-03-02", arquivo: { id: "arq_1", content_type: "application/pdf", tamanho: 2048 } }),
    registro("reg_2", { categoria: "documento", tipo: "outro", descricao: "Certificado de vacinação", emitido_em: "2024-05-10", vence_em: "2027-05-10" }),
    registro("reg_3", { categoria: "exame", tipo: "periodico", emitido_em: "2025-11-01", vence_em: "2026-11-01", resultado: "apto", edicao: 2 }),
    registro("reg_4", { categoria: "exame", tipo: "periodico", emitido_em: "2024-11-01", vence_em: "2025-11-01", resultado: "apto_com_restricao", situacao: "substituido", substituido_por: "reg_3" }),
    registro("reg_5", { categoria: "treinamento", tipo: "nr35", emitido_em: "2024-10-01", vence_em: "2026-10-01" }),
  ],
  datas_do_vinculo: { admissao: "2025-02-03", desligamento: null, edicao: 1 },
})!;

const NADA: AcoesDaFicha = {
  novo: () => undefined,
  alterar: () => undefined,
  editar: () => undefined,
  salvar: () => undefined,
  fechar: () => undefined,
  pedirArquivamento: () => undefined,
  confirmarArquivamento: () => undefined,
  desistir: () => undefined,
  anexar: () => undefined,
  abrirArquivo: () => undefined,
  abrirVinculo: () => undefined,
  editarVinculo: () => undefined,
  salvarVinculo: () => undefined,
  fecharVinculo: () => undefined,
};

function render(extra: Partial<FichaViewProps> = {}, ficha: FichaDoRh | undefined = FICHA) {
  const props: FichaViewProps = { estado: "pronto", ficha, erro: null, grava: false, formulario: null, vinculo: null, arquivando: null, ocupado: false, falha: null, acoes: NADA, ...extra };
  return renderToStaticMarkup(
    <Router ssrPath="/rh/ficha">
      <FichaView {...props} />
    </Router>,
  );
}

const PERMITIDOS = [
  "Ficha",
  "Ana Souza",
  "Montadora · Própria",
  /^Admissão \d{2}\/\d{2}\/\d{4}( · Desligamento \d{2}\/\d{2}\/\d{4})?$/,
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
  "Novo registro",
  "Abrir arquivo",
  "Alterar",
  "Anexar arquivo",
  "Trocar arquivo",
  "Arquivar",
  "Confirmar arquivamento",
  "Voltar",
  "Alterar registro",
  "Categoria",
  "Documento",
  "Exame",
  "Treinamento",
  "Tipo",
  "Nome",
  "Emitido em",
  "Feito em",
  "Vence em",
  "Resultado",
  "—",
  /^(ASO|NR-\d{2}|CTPS|CPF|PIS|Título|Reservista|Comprovante|Contrato|Direção|Primeiros|Integração|Outro)/,
  "Salvar",
  "Cancelar",
  "O vencimento vem depois da data do registro.",
  "Datas do vínculo",
  "Admissão",
  "Desligamento",
];

describe("a ficha da pessoa no RH", () => {
  it("owner e admin leem: os vigentes, o resultado, o prazo, o histórico e o arquivo, sem ações de gravar", () => {
    expect(textosDaTela(render())).toEqual([
      "Ana Souza",
      "Montadora · Própria",
      "Admissão 03/02/2025",
      "Documentos",
      "2",
      "RG",
      "Emitido em 02/03/2015 · sem vencimento",
      "Abrir arquivo",
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

  it("o rh inclui, altera, anexa e arquiva; a única ação principal é Novo registro", () => {
    const html = render({ grava: true });
    const textos = textosDaTela(html);
    expect(textos).toEqual(expect.arrayContaining(["Novo registro", "Alterar", "Anexar arquivo", "Trocar arquivo", "Arquivar", "Abrir arquivo"]));
    expect(html.match(/bg-primary text-primary-foreground/g)?.length).toBe(1);
    expect(html).toMatch(/<input[^>]*type="file"[^>]*accept="application\/pdf,image\/jpeg,image\/png,image\/webp"/);
  });

  it("o formulário: o exame pede o resultado; alterar não troca a categoria nem o tipo", () => {
    const novo = render({ grava: true, formulario: comCategoria(formularioNovo("k"), "exame") });
    expect(textosDaTela(novo)).toEqual(expect.arrayContaining(["Novo registro", "Categoria", "Tipo", "Feito em", "Vence em", "Resultado", "Salvar", "Cancelar"]));
    expect(novo).not.toMatch(/<button[^>]*>Novo registro<\/button>/);
    const alterando = render({ grava: true, formulario: formularioDoRegistro("k", FICHA.registros[2]) });
    expect(textosDaTela(alterando)).toContain("Alterar registro");
    expect(alterando).toMatch(/<select[^>]*id="registro-categoria"[^>]*disabled=""/);
    expect(alterando).toMatch(/<select[^>]*id="registro-tipo"[^>]*disabled=""/);
    // O formulário não aparece para quem não grava, mesmo aberto.
    expect(textosDaTela(render({ grava: false, formulario: formularioNovo("k") }))).not.toContain("Salvar");
  });

  it("as datas do vínculo: o rh abre o formulário ao lado de Novo registro; owner e admin só leem a linha", () => {
    const html = render({ grava: true });
    expect(textosDaTela(html).slice(0, 5)).toEqual(["Ana Souza", "Datas do vínculo", "Novo registro", "Montadora · Própria", "Admissão 03/02/2025"]);
    expect(html.match(/bg-primary text-primary-foreground/g)?.length).toBe(1);
    expect(textosDaTela(render())).not.toContain("Datas do vínculo");

    const aberto = render({ grava: true, vinculo: formularioDoVinculo("k", { admissao: "2025-02-03", desligamento: "2026-10-31", edicao: 1 }) });
    expect(textosDaTela(aberto)).toEqual(expect.arrayContaining(["Datas do vínculo", "Admissão", "Desligamento", "Salvar", "Cancelar"]));
    expect(aberto).not.toMatch(/<button[^>]*>(Novo registro|Datas do vínculo)<\/button>/);
    expect(aberto).toMatch(/<input[^>]*id="vinculo-admissao"[^>]*value="2025-02-03"/);
    expect(aberto).toMatch(/<input[^>]*id="vinculo-desligamento"[^>]*min="2025-02-03"[^>]*value="2026-10-31"/);
    // Com o formulário das datas aberto, as gravações das linhas esperam.
    expect(aberto).toMatch(/<button[^>]*disabled=""[^>]*>Arquivar<\/button>/);
    expect(textosDaTela(render({ grava: false, vinculo: formularioDoVinculo("k", null) }))).not.toContain("Desligamento");
  });

  it("com o desligamento, a linha leva as duas datas; sem as datas, nada; o freelancer e o terceiro não têm as datas", () => {
    const desligada = { ...FICHA, datas_do_vinculo: { admissao: "2025-02-03", desligamento: "2026-10-31", edicao: 2 } };
    expect(textosDaTela(render({}, desligada))).toContain("Admissão 03/02/2025 · Desligamento 31/10/2026");
    expect(textosDaTela(render({ grava: true }, { ...FICHA, datas_do_vinculo: null })).slice(0, 4)).toEqual(["Ana Souza", "Datas do vínculo", "Novo registro", "Montadora · Própria"]);
    for (const vinculo of ["freelancer", "terceiro"]) {
      const textos = textosDaTela(render({ grava: true }, { ...desligada, colaborador: { ...FICHA.colaborador, vinculo } }));
      expect(textos).not.toContain("Datas do vínculo");
      expect(textos.some((texto) => texto.startsWith("Admissão"))).toBe(false);
    }
  });

  it("arquivar pede a confirmação na linha; a falha do servidor aparece como veio", () => {
    const html = render({ grava: true, arquivando: "reg_3", falha: "O vencimento vem depois da data do registro." });
    expect(textosDaTela(html)).toEqual(expect.arrayContaining(["Confirmar arquivamento", "Voltar", "O vencimento vem depois da data do registro."]));
    expect(html).toMatch(/role="alert"/);
  });

  it("quem não está ativo leva a marca; a categoria vazia diz que não há registro; carregando e erro", () => {
    const inativa = fichaLida({ hoje: "2026-10-23", colaborador: { id: ANA, nome: "Ana Souza", funcao: "Montadora", vinculo: "proprio", ativo: false }, registros: [] })!;
    const textos = textosDaTela(render({}, inativa));
    expect(textos).toContain("Inativo");
    expect(textos).toEqual(expect.arrayContaining(["Nenhum documento", "Nenhum exame", "Nenhum treinamento"]));
    expect(textosDaTela(render({ estado: "carregando" }, undefined))).toEqual(["Ficha", "Carregando..."]);
    expect(textosDaTela(render({ estado: "erro", erro: "Colaborador não encontrado." }, undefined))).toEqual(["Ficha", "Colaborador não encontrado."]);
  });

  it("só rótulos, dados e ações: nenhum texto fora da lista", () => {
    for (const html of [
      render(),
      render({ grava: true }),
      render({ grava: true, formulario: comCategoria(formularioNovo("k"), "exame") }),
      render({ grava: true, formulario: { ...formularioNovo("k"), tipo: "outro" } }),
      render({ grava: true, arquivando: "reg_3" }),
      render({ grava: true, vinculo: formularioDoVinculo("k", FICHA.datas_do_vinculo) }),
      render({}, { ...FICHA, datas_do_vinculo: { admissao: "2025-02-03", desligamento: "2026-10-31", edicao: 2 } }),
      render({ estado: "carregando" }, undefined),
    ]) {
      expect(textosForaDaLista(html, PERMITIDOS)).toEqual([]);
    }
  });

  it("acessibilidade: WCAG 2.1 A e AA, lendo, gravando, com o formulário e com a confirmação", async () => {
    expect(await violacoesDeAcessibilidade(render())).toEqual([]);
    expect(await violacoesDeAcessibilidade(render({ grava: true }))).toEqual([]);
    expect(await violacoesDeAcessibilidade(render({ grava: true, formulario: comCategoria(formularioNovo("k"), "exame") }))).toEqual([]);
    expect(await violacoesDeAcessibilidade(render({ grava: true, arquivando: "reg_3" }))).toEqual([]);
    expect(await violacoesDeAcessibilidade(render({ grava: true, vinculo: formularioDoVinculo("k", FICHA.datas_do_vinculo) }))).toEqual([]);
  });
});
