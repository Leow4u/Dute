import { ROTULO_DO_MOMENTO, TIPOS_DE_MOMENTO } from "@workspace/dominio";
import { JSDOM } from "jsdom";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Router } from "wouter";

import { adicionarOutro } from "@/lib/eventos/cronograma";
import { formularioDaEdicao } from "@/lib/eventos/formulario";
import type { EventoView } from "@/lib/eventos/leitura";
import { CAMPOS_DO_MOMENTO, ROTULO_DO_OUTRO } from "@/lib/eventos/rotulos";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { OBSERVACOES_DA_NECTON, edicaoDaNecton, produtosDaNecton } from "@/test/eventos-necton";
import { textosForaDaLista } from "@/test/textos";

import type { DocumentoView } from "@/lib/eventos/tipos";

import { FormularioDaEdicaoView, type AnexosNaTela, type FormularioDaEdicaoViewProps } from "./evento-formulario";

/**
 * Portal › Eventos, o formulário da edição (docs/mockups/EventosPortalNovo.dc.html):
 * só os textos da prancha (mais a falta de saldo, que a spec pede antes do
 * envio), o axe e os nomes acessíveis do cronograma. Dados sintéticos.
 */

const NECTON = edicaoDaNecton();
const PRODUTOS = produtosDaNecton();
const CAPA: EventoView = {
  id: NECTON.event_id,
  customer_code: "BTG",
  name: "B2B Conference Necton",
  description: "Lounge, balcão de recepção e brindes da conferência B2B da Necton",
  status: "active",
  editions_count: 1,
  last_edition_id: NECTON.id,
  last_edition_label: "2027",
};

function documento(id: string, nome: string, tipo: string, tamanho: number): DocumentoView {
  return { id, caminho: `portal/BTG/eventos/${NECTON.id}/${id}`, nome, tipo, tamanho, origem: "cliente", momento_id: null, registrado_por: null, registrado_em: null };
}

function anexos(documentos: DocumentoView[]): AnexosNaTela {
  return { documentos, enviando: false, problema: null, onEscolher: () => undefined, onTirar: () => undefined };
}

const ANEXOS = {
  layout: anexos([documento("an_0000000000000001", "layout-necton-2027.pdf", "application/pdf", 1_258_291)]),
  planilhas: anexos([documento("an_0000000000000002", "produtos-b2b-conference.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", 519_168)]),
};

function props(extra: Partial<FormularioDaEdicaoViewProps> = {}): FormularioDaEdicaoViewProps {
  return {
    form: formularioDaEdicao(NECTON, CAPA, { id: NECTON.id, valor_declarado_cents: 10_000_000, fechado_cents: null }),
    eventos: [CAPA],
    nascida: true,
    idDaEdicao: NECTON.id,
    produtos: PRODUTOS,
    salvoAs: "14:32",
    salvando: false,
    enviando: false,
    erros: {},
    anexos: ANEXOS,
    acoes: {
      mudar: () => undefined,
      sairDoNome: () => undefined,
      escolherEvento: () => undefined,
      salvarAgora: () => undefined,
      enviar: () => undefined,
      verItens: () => undefined,
    },
    ...extra,
  };
}

const tela = (extra: Partial<FormularioDaEdicaoViewProps> = {}) =>
  renderToStaticMarkup(
    <Router ssrPath="/portal/eventos/edicao">
      <FormularioDaEdicaoView {...props(extra)} />
    </Router>,
  );

const TEXTOS = [
  "Novo evento",
  "O plano da edição. Salvar guarda o rascunho; Enviar para a Dutelog cria o pedido com os itens.",
  /^Salvo \d{2}:\d{2}$/,
  "O evento",
  "Nome do evento",
  "*",
  "Edição de",
  "Evento novo",
  "B2B Conference Necton",
  "Descrição",
  "Onde",
  "Local",
  "Endereço",
  "Contato no local",
  "Telefone do contato",
  "Layout do evento",
  "layout-necton-2027.pdf · 1,2 MB",
  "Anexar layout",
  "Cronograma",
  "Momento",
  "Data",
  "Hora",
  "Até",
  "Observação",
  ...TIPOS_DE_MOMENTO.map((tipo) => ROTULO_DO_MOMENTO[tipo]),
  "—",
  "O que vai · do estoque Dutelog",
  // O textosDaTela junta o espaço duro do R$ ao espaço comum.
  "100 itens · 2.000 peças · R$ 86.400,00 em peças",
  "Ver os 100 itens",
  "Escolher no Estoque",
  "Polo Masculino Piquet Arpoador",
  "A.01.0809.002 · 4 tamanhos",
  "Polo Feminina Piquet Azul Marinho",
  "A.01.0805.002 · 3 tamanhos",
  "Camiseta Feminina Piquet Preto",
  "A.02.0311.006 · 3 tamanhos",
  "Sacola Quadrada BTG",
  "J.0149.003",
  "Balcão de Recepção",
  "MAT-021",
  "P",
  "M",
  "G",
  "GG",
  "N1",
  "Único",
  /^\d{1,3}$/,
  "Mostrando 12 de 100 itens",
  "O que vai · coleta no cliente",
  "Onde buscar",
  "Quantidade",
  "Valor declarado",
  "Planilha dos produtos",
  "produtos-b2b-conference.xlsx · 507 KB",
  "Anexar planilha",
  "Observações para a Dutelog",
  "O que mais a Dutelog precisa saber",
  OBSERVACOES_DA_NECTON.replace(/\s+/g, " "),
  "Cancelar",
  "Salvar rascunho",
  "Enviar para a Dutelog",
  // As camadas do BotaoDeAcao (o gerúndio, o feito e a conferência aos 70 s) estão no HTML, escondidas.
  "Salvando…",
  "Salvo",
  "Conferir",
  "Enviando…",
  "Resumo da edição",
  "Evento",
  "Edição",
  "28 e 29/01/2027",
  "Hotel Unique",
  "Do estoque Dutelog",
  "100 itens · 2.000 peças",
  "Coleta no cliente",
  "2.190 produtos",
  "Entrega no local",
  "28/01 08:30",
  "Retorno ao estoque",
  "30/01 09:00",
  "Ao enviar",
  "Pedido PED com os 100 itens",
  "A Dutelog responde com",
  "Preço fechado",
];

describe("Portal › Eventos, o formulário", () => {
  it("o rascunho da Necton: só os textos da prancha, os nomes do cronograma e sem violação do axe", async () => {
    const html = tela();
    expect(textosForaDaLista(html, TEXTOS)).toEqual([]);
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
    expect(html).toContain('aria-label="Voltar a Eventos"');
    for (const tipo of TIPOS_DE_MOMENTO.filter((item) => item !== "outro")) {
      const campos = CAMPOS_DO_MOMENTO[tipo];
      for (const rotulo of [campos.data, campos.hora, campos.observacao, ...(campos.ate ? [campos.ate] : [])]) expect(html).toContain(`aria-label="${rotulo}"`);
    }
    expect(html).toContain(`href="/portal/estoque?evento=${NECTON.id}"`);
    expect(html).not.toContain("Falta saldo");
    expect(html).toContain('aria-label="Tirar layout-necton-2027.pdf"');
    expect(html).toContain('aria-label="Tirar produtos-b2b-conference.xlsx"');
  });

  it("o cronograma pela largura da seção: as cinco colunas só onde a Observação cabe; antes, ela desce para a linha de baixo, com o nome no campo", () => {
    const dom = new JSDOM(`<!doctype html><body>${tela()}</body>`);
    const documento = dom.window.document;
    const classes = (elemento: Element | null | undefined) => (elemento?.getAttribute("class") ?? "").split(/\s+/);
    const cinco = "@3xl:grid-cols-[minmax(0,12rem)_9rem_6rem_6rem_minmax(0,1fr)]";
    const quatro = "@min-[31rem]:grid-cols-[minmax(0,12rem)_9rem_6rem_6rem]";
    const cabecalho = [...documento.querySelectorAll("[aria-hidden=true]")].find((elemento) => elemento.textContent?.startsWith("MomentoDataHoraAté"));
    // A largura que conta é a da seção (o menu lateral e o resumo tiram espaço), não a da janela.
    expect(classes(cabecalho?.parentElement)).toContain("@container");
    expect(classes(cabecalho)).toEqual(expect.arrayContaining(["@min-[31rem]:grid", quatro, cinco]));
    expect(classes([...(cabecalho?.children ?? [])].at(-1))).toEqual(expect.arrayContaining(["hidden", "@3xl:block"]));
    for (const tipo of TIPOS_DE_MOMENTO.filter((item) => item !== "outro")) {
      const observacao = documento.querySelector(`input[aria-label="${CAMPOS_DO_MOMENTO[tipo].observacao}"]`);
      expect(classes(observacao?.parentElement), tipo).toEqual(expect.arrayContaining([quatro, cinco, "gap-x-2.5", "gap-y-1.5"]));
      expect(classes(observacao?.parentElement?.firstElementChild), tipo).toEqual(expect.arrayContaining(["col-span-2", "@min-[31rem]:col-span-1"]));
      expect(classes(observacao?.parentElement).some((classe) => classe.startsWith("md:grid-cols-")), tipo).toBe(false);
      expect(observacao?.getAttribute("placeholder"), tipo).toBe("Observação");
      expect(classes(observacao), tipo).toEqual(expect.arrayContaining(["@min-[31rem]:col-start-2", "@min-[31rem]:col-span-3", "@3xl:col-start-auto", "@3xl:col-span-1", "@3xl:placeholder:text-transparent"]));
    }
    // Nada dentro do cronograma muda de grade, coluna ou visibilidade pela largura da janela.
    const noCronograma = [cabecalho!.parentElement!, ...cabecalho!.parentElement!.querySelectorAll("[class]")].flatMap((elemento) => classes(elemento));
    expect(noCronograma.filter((classe) => /^(?:sm|md|lg|xl|2xl):(?:grid|col-|row-|hidden|block)/.test(classe))).toEqual([]);
    dom.window.close();
    // O outro momento: o rótulo é um campo e segura as mesmas colunas.
    const comOutro = new JSDOM(`<!doctype html><body>${tela({ form: { ...props().form, cronograma: adicionarOutro(props().form.cronograma) } })}</body>`);
    const rotulo = comOutro.window.document.querySelector(`input[aria-label="${ROTULO_DO_OUTRO}"]`);
    expect(classes(rotulo)).toEqual(expect.arrayContaining(["col-span-2", "@min-[31rem]:col-span-1"]));
    comOutro.window.close();
  });

  it("com o GG da primeira família acima do disponível, a linha 'Falta saldo em 1 item: …' sob a seção, nos textos e sem violação do axe", async () => {
    const gg = NECTON.itens[3];
    const produtos = PRODUTOS.map((produto) => (produto.sku === gg.sku_code ? { ...produto, available: 60 } : produto));
    const html = tela({ produtos });
    const falta = "Falta saldo em 1 item: Polo Masculino Piquet Arpoador · GG (no evento 80, disponível 60)";
    expect(textosForaDaLista(html, [...TEXTOS, /^Falta saldo em 1 item: /])).toEqual([]);
    expect(html).toContain(falta);
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
    // Quando a mesma frase é o erro dos itens (depois do Enviar), ela aparece uma vez só.
    const comErro = tela({ produtos, erros: { itens: falta } });
    expect(comErro.split(falta)).toHaveLength(2);
  });

  it("antes do nascimento: Escolher no Estoque travado e o Enviar bloqueado; sem itens, só o Escolher; os erros sob os campos", async () => {
    const vazio = tela({
      nascida: false,
      idDaEdicao: null,
      salvoAs: null,
      form: { ...props().form, itens: [] },
      erros: { nome: "Informe o nome do evento", cronograma: "Informe a data do evento", itens: "Escolha ao menos um item ou informe a coleta no cliente" },
    });
    expect(vazio).not.toContain("/portal/estoque?evento=");
    expect(vazio).not.toContain("Ver os 0 itens");
    expect(vazio).not.toContain("Salvo ");
    expect(vazio).toMatch(/<button[^>]*disabled=""[^>]*>.*?Escolher no Estoque/);
    expect(vazio).toContain('aria-describedby="evento-nome-problema"');
    expect(vazio).toContain("Informe a data do evento");
    expect(await violacoesDeAcessibilidade(vazio)).toEqual([]);
  });
});
