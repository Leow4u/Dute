import { ROTULO_DO_MOMENTO, TIPOS_DE_MOMENTO } from "@workspace/dominio";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Router } from "wouter";

import { formularioDaEdicao } from "@/lib/eventos/formulario";
import type { EventoView } from "@/lib/eventos/leitura";
import { CAMPOS_DO_MOMENTO } from "@/lib/eventos/rotulos";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { OBSERVACOES_DA_NECTON, edicaoDaNecton, produtosDaNecton } from "@/test/eventos-necton";
import { textosForaDaLista } from "@/test/textos";

import { FormularioDaEdicaoView, type FormularioDaEdicaoViewProps } from "./evento-formulario";

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
