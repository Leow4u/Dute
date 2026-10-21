import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Router } from "wouter";

import { contatoDoDocumento, localDoDocumento } from "@/lib/comercial/clientes";
import { acoesDoOrcamento, catalogoDaTabela, formDoOrcamento, type FormOrcamento } from "@/lib/comercial/montar";

import { EstadoDoOrcamento, MontarView, idDaQuantidade, type DadosDoOrcamento, type MontarViewProps } from "./orcamento-view";

/**
 * Montar orçamento (docs/mockups/ComOrcamento.dc.html), só a apresentação: sem
 * legenda, uma ação principal, a grade no jeito do Excel, a linha alterada com
 * o preço da tabela riscado, e só leitura para aprovar.
 */

const E = "Estação de trabalho em L 1,40 m";

const DEMANDA = {
  numero: "10045",
  customer_code: "ITAU-UNIBANCO",
  customer_name: "Itaú Unibanco",
  titulo: "Remanejamento do 12º andar",
  ref_cliente: "CE8977",
  solicitante: { contato_id: "ct_renata", empresa: "Souza & Lopes" },
  recebida_em: "2026-10-14T12:42:00.000Z",
  email_assunto: "RES: CE8977 · Remanejamento 12º andar",
  email_link: "https://outlook.office.com/mail/id/AAA",
  origem: { local_id: "loc_os", complemento: "Torre A · 12º andar" },
  destino: { local_id: "loc_conc", complemento: null },
  execucao: { datas: [], de: "2026-10-24", ate: "2026-10-25", a_definir: false, visita_tecnica: "2026-10-17" },
};

const ORCAMENTO = {
  numero: "10045",
  linhas: [
    { id: "ln_1", lpu_item_id: "lpu_est_tran", codigo: "3.02", item: E, descricao: "x", servico: "Transporte", unidade: "UN", quantidade: "24", preco: "21", preco_tabela: "21", origem: "tabela", motivo: null, total_cents: 50_400 },
    { id: "ln_2", lpu_item_id: "lpu_cad_tran", codigo: "4.12", item: "Cadeira giratória", descricao: "x", servico: "Transporte", unidade: "UN", quantidade: "60", preco: "8.5", preco_tabela: "11.4", origem: "alterado", motivo: "Volume acima de 50 un.", total_cents: 51_000 },
    { id: "ln_3", lpu_item_id: null, codigo: null, item: "Içamento de divisória de vidro", descricao: "Içamento de divisória de vidro", servico: "Içamento", unidade: "VB", quantidade: "1", preco: "1250", preco_tabela: null, origem: "avulso", motivo: "Fora da LPU", total_cents: 125_000 },
    { id: "ln_4", lpu_item_id: null, codigo: null, item: "Execução junto com a CE8971", descricao: "Execução junto com a CE8971", servico: null, unidade: null, quantidade: "1", preco: "-400", preco_tabela: null, origem: "ajuste", motivo: "Mesma equipe e veículo", total_cents: -40_000 },
  ],
  condicoes: "Valores pela LPU Itaú v2.0.",
  observacoes_internas: "Elevador reservado.",
};

const FORM = formDoOrcamento(DEMANDA, ORCAMENTO);

const DADOS: DadosDoOrcamento = {
  numero: "10045",
  rotulo: "10045",
  tipoRv: "proposta",
  status: "rascunho",
  edicao: 4,
  etapa: "em_montagem",
  diasNaEtapa: 1,
  cliente: "Itaú Unibanco",
  prospect: false,
  contrato: "Contrato Itaú · até 30/06/2027",
  contratoHref: null,
  autor: "Guilherme",
  tabelaNome: "LPU Itaú v2.0",
  variante: "Comercial",
  dataBase: "2026-10-14",
  subtotalCents: 226_400,
  ajustesCents: -40_000,
  totalCents: 186_400,
  situacao: null,
  devolucao: null,
};

const CONTATOS = [
  contatoDoDocumento("ct_renata", { customer_code: "ITAU-UNIBANCO", nome: "Renata Moraes", empresa: "Souza & Lopes", papel: "gerenciadora" })!,
  contatoDoDocumento("ct_paula", { customer_code: "ITAU-UNIBANCO", nome: "Paula Nogueira", empresa: "Hass & Megale", papel: "gerenciadora" })!,
  contatoDoDocumento("ct_velho", { customer_code: "ITAU-UNIBANCO", nome: "Zé Antigo", ativo: false })!,
];

const LOCAIS = [
  localDoDocumento("loc_os", { nome: "CEIC – Torre Olavo Setubal" })!,
  localDoDocumento("loc_conc", { nome: "CEIC – Torre Conceição" })!,
];

const CATALOGO = catalogoDaTabela(
  {
    lpu_est_tran: { codigo: "3.02", descricao_cliente: "x", preco: "21" },
    lpu_est_mont: { codigo: "3.03", descricao_cliente: "x", preco: "46" },
    lpu_cad_tran: { codigo: "4.12", descricao_cliente: "x", preco: "11.4" },
  },
  new Map(),
);

const noop = () => undefined;

function props(overrides: Partial<MontarViewProps> & { form?: FormOrcamento } = {}): MontarViewProps {
  return {
    dados: DADOS,
    form: FORM,
    onForm: noop,
    sujo: false,
    acoes: acoesDoOrcamento({ status: "rascunho", role: "comercial", uid: "u-gui", autorUid: "u-gui" }),
    contatos: CONTATOS,
    locais: LOCAIS,
    catalogo: CATALOGO,
    ocupado: false,
    aviso: null,
    handlers: {
      salvar: noop,
      enviar: noop,
      duplicar: noop,
      editar: noop,
      aprovar: noop,
      devolver: noop,
      trocarVariante: noop,
      novoContato: noop,
    },
    ...overrides,
  };
}

function render(overrides: Partial<MontarViewProps> = {}) {
  return renderToStaticMarkup(
    <Router ssrPath="/comercial/orcamento">
      <MontarView {...props(overrides)} />
    </Router>,
  );
}

/** Textos visíveis, na ordem: o que a pessoa lê na tela. */
function texts(html: string) {
  return html
    .replace(/<span class="sr-only">[^<]*<\/span>/g, "")
    .split(/<[^>]+>/)
    .map((text) => text.replace(/&amp;/g, "&").replace(/ /g, " ").trim())
    .filter(Boolean);
}

const CABECALHO_RASCUNHO = [
  "Comercial",
  "Orçamentos",
  "10045",
  "Em montagem",
  "Proposta",
  "Itaú Unibanco",
  "·",
  "Contrato Itaú · até 30/06/2027",
  "·",
  "Guilherme",
  "LPU Itaú v2.0",
  "Comercial",
  "Noturna",
  "Data-base 14/10/2026",
  "Total",
  "R$ 1.864,00",
  "Salvar",
  "Duplicar",
  "Enviar para aprovação",
];

const BLOCOS_RASCUNHO = [
  "Pedido do cliente",
  "Para",
  "—",
  "Paula Nogueira · Hass & Megale",
  "Renata Moraes · Souza & Lopes",
  "Novo contato…",
  "Referência do cliente",
  "Título",
  "Recebido em",
  "Assunto do e-mail",
  "Link do e-mail",
  "Abrir no Outlook",
  "Execução",
  "Data",
  "Intervalo",
  "A definir",
  "De",
  "Até",
  "Visita técnica",
  "Locais",
  "Origem",
  "—",
  "CEIC – Torre Olavo Setubal",
  "CEIC – Torre Conceição",
  "Destino",
  "—",
  "CEIC – Torre Olavo Setubal",
  "CEIC – Torre Conceição",
];

const GRADE = [
  "Itens",
  "4",
  "LPU Itaú v2.0 · Comercial",
  "Código",
  "Item",
  "Serviço",
  "Unid.",
  "Valor unit.",
  "Qtd",
  "Total",
  "3.02",
  E,
  "Transporte",
  "UN",
  "504,00",
  "4.12",
  "Cadeira giratória",
  "Alterado",
  "Transporte",
  "UN",
  "11,40",
  "510,00",
  "—",
  "Avulso",
  "1.250,00",
  "—",
  "Ajuste",
  "—",
  "—",
  "−",
  "1",
  "-400,00",
];

const RODAPE = [
  "Condições",
  "Valores pela LPU Itaú v2.0.",
  "Observações internas",
  "Elevador reservado.",
  "Subtotal",
  "R$ 2.264,00",
  "Ajustes",
  "-R$ 400,00",
  "Total",
  "R$ 1.864,00",
];

describe("montar orçamento", () => {
  it("sem legenda: cabeçalho, pedido, execução, locais, grade e rodapé só têm rótulos, dados e ações", () => {
    expect(texts(render())).toEqual([...CABECALHO_RASCUNHO, ...BLOCOS_RASCUNHO, ...GRADE, "↵", "Item avulso", "Ajuste", ...RODAPE]);
  });

  it("identidade v3 e uma ação principal só: Enviar para aprovação", () => {
    const html = render();
    expect(html).toMatch(/^<div class="v3 /);
    expect(html.match(/bg-primary text-primary-foreground/g)).toHaveLength(1);
    expect(html).toMatch(/bg-primary text-primary-foreground[^"]*"[^>]*>.*?Enviar para aprovação<\/button>/);
  });

  it("a grade: busca de item da tabela pelo teclado e a quantidade de cada linha com id para o foco", () => {
    const html = render();
    expect(html).toContain('aria-label="Adicionar item da tabela"');
    expect(html).toContain('placeholder="Adicionar item…"');
    expect(html).toContain('role="combobox"');
    expect(html).toContain(`id="${idDaQuantidade("ln_1")}"`);
    expect(idDaQuantidade("ln_1")).toBe("qtd-ln_1");
  });

  it("linha alterada: o preço da tabela riscado ao lado e o motivo", () => {
    const html = render();
    expect(html).toMatch(/<s class="[^"]*">11,40<\/s>/);
    expect(html).toContain('value="Volume acima de 50 un."');
    expect(html).toContain('aria-label="Motivo · Cadeira giratória · Transporte"');
  });

  it("alterada sem motivo: a linha diz o que falta", () => {
    const form = { ...FORM, linhas: FORM.linhas.map((linha) => (linha.chave === "ln_2" ? { ...linha, motivo: "" } : linha)) };
    expect(texts(render({ form, sujo: true }))).toContain("Informe o motivo do preço diferente da tabela.");
  });

  it("sem mudança, os totais são os do servidor; com mudança, a prévia de lib/dominio", () => {
    const servidor = texts(render({ dados: { ...DADOS, totalCents: 190_000 } }));
    expect(servidor).toContain("R$ 1.900,00");
    const form = { ...FORM, linhas: FORM.linhas.map((linha) => (linha.chave === "ln_1" ? { ...linha, quantidade: "30" } : linha)) };
    const previa = texts(render({ form, sujo: true, dados: { ...DADOS, totalCents: 190_000 } }));
    expect(previa).toContain("R$ 1.990,00");
    expect(previa).not.toContain("R$ 1.900,00");
  });

  it("para aprovar, o owner vê só leitura com Aprovar (principal) e Devolver", () => {
    const html = render({
      dados: { ...DADOS, status: "para_aprovar", etapa: "para_aprovar", situacao: "Enviado para aprovação · 21/10 09:05" },
      acoes: acoesDoOrcamento({ status: "para_aprovar", role: "owner", uid: "u-leo", autorUid: "u-gui" }),
    });
    const lista = texts(html);
    expect(lista.slice(0, 22)).toEqual([
      "Comercial",
      "Orçamentos",
      "10045",
      "Para aprovar",
      "Proposta",
      "Itaú Unibanco",
      "·",
      "Contrato Itaú · até 30/06/2027",
      "·",
      "Guilherme",
      "LPU Itaú v2.0",
      "Comercial",
      "Data-base 14/10/2026",
      "Total",
      "R$ 1.864,00",
      "Enviado para aprovação · 21/10 09:05",
      "Devolver",
      "Duplicar",
      "Aprovar",
      "Pedido do cliente",
      "Para",
      "—",
    ]);
    for (const acao of ["Salvar", "Enviar para aprovação", "Novo contato…", "Item avulso", "↵"]) expect(lista).not.toContain(acao);
    expect(html.match(/bg-primary text-primary-foreground/g)).toHaveLength(1);
    expect(html).not.toMatch(/<(?:input|textarea|select)(?![^>]*disabled)[^>]*>/);
    expect(html).not.toContain("Remover");
  });

  it("para aprovar, quem montou puxa de volta com Editar; aprovado, Editar volta ao rascunho", () => {
    const autor = texts(
      render({
        dados: { ...DADOS, status: "para_aprovar", etapa: "para_aprovar" },
        acoes: acoesDoOrcamento({ status: "para_aprovar", role: "comercial", uid: "u-gui", autorUid: "u-gui" }),
      }),
    );
    expect(autor).toEqual(expect.arrayContaining(["Editar", "Duplicar"]));
    expect(autor).not.toContain("Aprovar");
    const aprovado = render({
      dados: { ...DADOS, status: "aprovado", etapa: "para_enviar" },
      acoes: acoesDoOrcamento({ status: "aprovado", role: "comercial", uid: "u-gui", autorUid: "u-gui" }),
    });
    expect(texts(aprovado)).toEqual(expect.arrayContaining(["Para enviar", "Editar", "Duplicar"]));
    expect(aprovado).not.toContain("bg-primary text-primary-foreground");
  });

  it("devolvido: a nota de quem devolveu aparece no rascunho", () => {
    const lista = texts(render({ dados: { ...DADOS, devolucao: { nota: "Rever o preço da cadeira", detalhe: "Devolvido por Leonardo · 21/10 09:30" } } }));
    const inicio = lista.indexOf("Enviar para aprovação") + 1;
    expect(lista.slice(inicio, inicio + 2)).toEqual(["Devolvido por Leonardo · 21/10 09:30", "Rever o preço da cadeira"]);
  });

  it("erro do servidor aparece em alerta", () => {
    const html = render({ aviso: { tipo: "erro", texto: "O orçamento mudou desde que foi aberto (edição 5, não 4). Abra de novo." } });
    expect(html).toMatch(/<p role="alert"[^>]*>O orçamento mudou desde que foi aberto/);
  });

  it("sem tabela, a busca de item fica desligada e o cabeçalho diz Sem tabela", () => {
    const html = render({ catalogo: [], dados: { ...DADOS, tabelaNome: null } });
    expect(texts(html)).toEqual(expect.arrayContaining(["Sem tabela"]));
    expect(html).toMatch(/<input[^>]*role="combobox"[^>]*disabled=""/);
  });

  it("carregando, não encontrado e erro", () => {
    const estado = (valor: "carregando" | "nao_encontrado" | "erro") =>
      texts(
        renderToStaticMarkup(
          <Router ssrPath="/comercial/orcamento">
            <EstadoDoOrcamento estado={valor} />
          </Router>,
        ),
      );
    expect(estado("carregando")).toEqual(["Comercial", "Orçamentos", "Carregando..."]);
    expect(estado("nao_encontrado")).toEqual(["Comercial", "Orçamentos", "Orçamento não encontrado"]);
    expect(estado("erro")).toEqual(["Comercial", "Orçamentos", "Não foi possível carregar o orçamento."]);
  });
});
