import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Router } from "wouter";

import { contatoDoDocumento, localDoDocumento } from "@/lib/comercial/clientes";
import { acoesDepoisDoEnvio, type ItemParaAcoes } from "@/lib/comercial/depois-do-envio";
import { acoesDoOrcamento, adicionarDaTabela, catalogoDaTabela, formDoOrcamento, type FormOrcamento } from "@/lib/comercial/montar";

import {
  EstadoDoOrcamento,
  ListaDaBusca,
  MontarView,
  idDaDescricao,
  idDaQuantidade,
  type DadosDoOrcamento,
  type MontarViewProps,
} from "./orcamento-view";

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
  operacao: null,
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
    salvoEm: null,
    desatualizado: false,
    documentoHref: "/comercial/orcamento/documento?numero=10045&rv=0",
    posEnvio: { acoes: { principal: null, secundarias: [] }, onAcao: noop },
    handlers: {
      salvar: noop,
      previaSalva: noop,
      enviar: noop,
      duplicar: noop,
      editar: noop,
      aprovar: noop,
      devolver: noop,
      enviarCliente: noop,
      aprovarEEnviar: noop,
      enviarDispensado: noop,
      descartarRv: noop,
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
  "Prévia do PDF",
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
  "Canal",
  "E-mail",
  "Telefone",
  "WhatsApp",
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

  it("para aprovar, o owner vê só leitura com Aprovar (principal), Devolver e Aprovar e enviar", () => {
    const html = render({
      dados: { ...DADOS, status: "para_aprovar", etapa: "para_aprovar", situacao: "Enviado para aprovação · 21/10 09:05" },
      acoes: acoesDoOrcamento({ status: "para_aprovar", role: "owner", uid: "u-leo", autorUid: "u-gui" }),
    });
    const lista = texts(html);
    expect(lista.slice(0, 22)).toEqual([
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
      "Aprovar e enviar",
      "Duplicar",
      "Prévia do PDF",
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
  });

  it("aprovado: Enviar ao cliente é a ação principal (grava e só então abre o documento)", () => {
    const html = render({
      dados: { ...DADOS, status: "aprovado", etapa: "para_enviar", situacao: "Aprovado por Leonardo · 21/10 08:50" },
      acoes: acoesDoOrcamento({ status: "aprovado", role: "comercial", uid: "u-gui", autorUid: "u-gui" }),
    });
    const lista = texts(html);
    const inicio = lista.indexOf("Aprovado por Leonardo · 21/10 08:50");
    expect(lista.slice(inicio, inicio + 6)).toEqual([
      "Aprovado por Leonardo · 21/10 08:50",
      "Editar",
      "Duplicar",
      "Prévia do PDF",
      "Enviar ao cliente",
      "Pedido do cliente",
    ]);
    expect(html.match(/bg-primary text-primary-foreground/g)).toHaveLength(1);
    expect(html).toMatch(/bg-primary text-primary-foreground[^"]*"[^>]*>.*?Enviar ao cliente<\/button>/);
  });

  it("o documento abre noutra aba: a prévia até o envio; o PDF da RV enviada depois", () => {
    const previa = render();
    expect(previa).toMatch(/<a[^>]*href="\/comercial\/orcamento\/documento\?numero=10045&amp;rv=0"[^>]*target="_blank"[^>]*>.*?Prévia do PDF<\/a>/);
    const enviado = render({
      dados: { ...DADOS, status: "enviado", etapa: "aguardando_cliente", situacao: "Enviado · 21/10 10:02" },
      acoes: acoesDoOrcamento({ status: "enviado", role: "comercial", uid: "u-gui", autorUid: "u-gui" }),
    });
    const lista = texts(enviado);
    expect(lista).toEqual(expect.arrayContaining(["Enviado · 21/10 10:02", "PDF"]));
    expect(lista).not.toContain("Prévia do PDF");
    expect(enviado).not.toContain("bg-primary text-primary-foreground");
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

  it("mudança não salva: o cabeçalho diz; salvo, mostra a hora", () => {
    expect(texts(render({ sujo: true }))).toContain("Alterações não salvas");
    expect(texts(render({ salvoEm: "10:12" }))).toContain("Salvo às 10:12");
    expect(texts(render({ sujo: true, salvoEm: "10:12" }))).not.toContain("Salvo às 10:12");
    expect(texts(render())).not.toContain("Alterações não salvas");
  });

  it("salvando: nenhum campo, botão da grade ou busca se edita até a gravação voltar", () => {
    const html = render({ ocupado: true, sujo: true });
    expect(html).not.toMatch(/<(?:input|textarea|select)(?![^>]*disabled)[^>]*>/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>(?:<svg[\s\S]*?<\/svg>)?Item avulso<\/button>/);
    expect(html).toMatch(/<button[^>]*aria-label="Remover · [^"]*"[^>]*disabled=""/);
    // A grade continua a mesma (sem pular de lugar).
    expect(texts(html)).toEqual(expect.arrayContaining(["Item avulso", "Ajuste", "↵"]));
  });

  it("linha incompleta: os totais somam as linhas válidas e só ela fica sem valor", () => {
    const form = { ...FORM, linhas: FORM.linhas.map((linha) => (linha.chave === "ln_1" ? { ...linha, quantidade: "" } : linha)) };
    const lista = texts(render({ form, sujo: true }));
    expect(lista.slice(lista.indexOf("Total"), lista.indexOf("Total") + 2)).toEqual(["Total", "R$ 1.360,00"]);
    expect(lista).toEqual(expect.arrayContaining(["Quantidade inválida.", "R$ 1.760,00", "-R$ 400,00"]));
    expect(lista.slice(-6)).toEqual(["Subtotal", "R$ 1.760,00", "Ajustes", "-R$ 400,00", "Total", "R$ 1.360,00"]);
  });

  it("execução a definir: a caixa tracejada no lugar da data", () => {
    const form = { ...FORM, execucao: { ...FORM.execucao, modo: "a_definir" as const } };
    const html = render({ form });
    const lista = texts(html);
    const visita = lista.indexOf("Visita técnica");
    expect(lista.slice(visita - 2, visita)).toEqual(["Data", "A definir"]);
    expect(html).toMatch(/<div class="[^"]*border-dashed[^"]*">(?:<svg[\s\S]*?<\/svg>)?A definir<\/div>/);
  });

  it("a execução na Operação: as OS revisadas, por linha o executado e o que se cobra, e o aditivo pedido (parte 3.10c)", async () => {
    const operacao = {
      titulo: "OS 10045-01 revisada · 22/10",
      linhas: [{ item: "Mesa", unidade: "un", executado: "64", aCobrar: "60", absorvido: "0", aditivo: "4" }],
      aditivo: { numero: "10045", cliente: "Itaú Unibanco", pedidoEm: "2026-10-22T21:10:00.000Z", itens: [{ item: "Mesa", quantidade: "4", unidade: "UN", os: "10045-01" }] },
    };
    const html = render({ dados: { ...DADOS, etapa: "execucao_a_orcar", operacao } });
    const lista = texts(html);
    for (const texto of ["Execução na Operação", "OS 10045-01 revisada · 22/10", "Aditivo pedido pela Operação · +4 Mesa", "Executado", "A cobrar", "Absorvido", "Aditivo", "64", "60"]) {
      expect(lista, texto).toContain(texto);
    }
    const { violacoesDeAcessibilidade } = await import("@/test/acessibilidade");
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });

  it("linha nova, ainda sem id, fica destacada até salvar", () => {
    const linhas = adicionarDaTabela(FORM.linhas, CATALOGO[1], "nova-1").linhas;
    const html = render({ form: { ...FORM, linhas }, sujo: true });
    const classes = Array.from(html.matchAll(/<div role="row" class="([^"]*)"/g), ([, classe]) => classe);
    expect(classes).toHaveLength(6);
    expect(classes.map((classe) => classe.includes("bg-info-soft"))).toEqual([false, false, false, false, false, true]);
  });

  it("item avulso e ajuste: a descrição tem id para o foco da linha nova", () => {
    const html = render();
    expect(html).toContain(`id="${idDaDescricao("ln_3")}"`);
    expect(html).toContain(`id="${idDaDescricao("ln_4")}"`);
    expect(idDaDescricao("ln_3")).toBe("desc-ln_3");
    expect(html).toMatch(/aria-label="Item avulso"[^>]*maxLength="200"|maxLength="200"[^>]*aria-label="Item avulso"/);
  });

  it("o código da LPU (DTL-0002-T) não quebra na grade", () => {
    const form = { ...FORM, linhas: [{ ...FORM.linhas[0], codigo: "DTL-0002-T" }] };
    expect(render({ form })).toMatch(/<span role="cell" class="[^"]*whitespace-nowrap[^"]*">DTL-0002-T<\/span>/);
  });

  it("canal: e-mail mostra assunto e link; telefone e WhatsApp, não", () => {
    expect(render()).toMatch(/<button[^>]*aria-pressed="true"[^>]*>E-mail<\/button>/);
    const telefone = render({ form: { ...FORM, canal: "telefone", emailAssunto: "", emailLink: "" } });
    expect(telefone).toMatch(/<button[^>]*aria-pressed="true"[^>]*>Telefone<\/button>/);
    expect(texts(telefone)).not.toContain("Assunto do e-mail");
    expect(texts(telefone)).not.toContain("Link do e-mail");
  });

  it("o orçamento mudou no servidor enquanto a pessoa editava: a tela avisa", () => {
    const html = render({ sujo: true, desatualizado: true });
    expect(html).toMatch(/<p role="alert"[^>]*>O orçamento mudou enquanto você editava\./);
    expect(texts(render({ sujo: true }))).not.toContain("O orçamento mudou enquanto você editava. Ao salvar, o servidor recusa e o orçamento recarrega.");
  });

  it("busca de item: sem nada, Nenhum item; com mais do que cabe, quantos ficaram de fora", () => {
    const lista = (itens: typeof CATALOGO, total: number) =>
      texts(renderToStaticMarkup(<ListaDaBusca itens={itens} total={total} destacado={0} onEscolher={noop} onDestacar={noop} />));
    expect(lista([], 0)).toEqual(["Nenhum item"]);
    expect(lista(CATALOGO.slice(0, 2), 5).at(-1)).toBe("+3 itens");
    expect(lista(CATALOGO.slice(0, 2), 3).at(-1)).toBe("+1 item");
    expect(lista(CATALOGO.slice(0, 2), 2).at(-1)).not.toMatch(/^\+/);
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
    expect(estado("carregando")).toEqual(["Orçamento", "Carregando..."]);
    expect(estado("nao_encontrado")).toEqual(["Orçamento", "Orçamento não encontrado"]);
    expect(estado("erro")).toEqual(["Orçamento", "Não foi possível carregar o orçamento."]);
  });
});

describe("montar orçamento depois do envio (parte 12b)", () => {
  const ENVIADA: ItemParaAcoes = { numero: "10045", rv: 0, etapa: "aguardando_cliente", tipoRv: "proposta", status: "enviado", edicao: 7, revisaoDe: null, autorUid: "u-gui", escopoRv: null, executada: false, validada: false };
  const quem = { role: "comercial", uid: "u-gui" };

  function enviada(parcial: Partial<ItemParaAcoes> = {}, dados: Partial<DadosDoOrcamento> = {}, onAcao: (acao: string) => void = noop) {
    const item = { ...ENVIADA, ...parcial };
    return render({
      dados: { ...DADOS, status: "enviado", etapa: item.etapa, tipoRv: item.tipoRv, situacao: "Enviado · 21/10 10:02", ...dados },
      acoes: acoesDoOrcamento({ status: "enviado", role: "comercial", uid: "u-gui", autorUid: "u-gui", etapa: item.etapa }),
      posEnvio: { acoes: acoesDepoisDoEnvio(item, quem), onAcao },
    });
  }

  it("proposta enviada: Fechado é a ação principal da tela; Revisar e Perdido ao lado", () => {
    const html = enviada();
    const lista = texts(html);
    const inicio = lista.indexOf("PDF");
    expect(lista.slice(inicio, inicio + 4)).toEqual(["PDF", "Fechado", "Revisar", "Perdido"]);
    expect(html.match(/bg-primary text-primary-foreground/g)).toHaveLength(1);
    expect(html).toMatch(/bg-primary text-primary-foreground[^"]*"[^>]*>(?:<svg[^>]*>.*?<\/svg>)?Fechado<\/button>/);
  });

  it("RV de execução enviada: Validado; aditivo: Validado, Recusar aditivo e Revisar", () => {
    const execucao = texts(enviada({ tipoRv: "execucao", rv: 2 }));
    expect(execucao.slice(execucao.indexOf("PDF"), execucao.indexOf("PDF") + 3)).toEqual(["PDF", "Validado", "Revisar"]);
    const aditivo = texts(enviada({ tipoRv: "aditivo", rv: 1 }));
    expect(aditivo.slice(aditivo.indexOf("PDF"), aditivo.indexOf("PDF") + 4)).toEqual(["PDF", "Validado", "Recusar aditivo", "Revisar"]);
  });

  it("para planejar e execução a orçar têm as ações da etapa; as ações da etapa ficam no cabeçalho", () => {
    expect(texts(enviada({ etapa: "para_planejar" }, { etapa: "para_planejar" }))).toEqual(
      expect.arrayContaining(["Registrar execução", "Aditivo", "Perdido"]),
    );
    expect(texts(enviada({ etapa: "execucao_a_orcar" }, { etapa: "execucao_a_orcar" }))).toEqual(expect.arrayContaining(["Orçar execução", "Validado"]));
  });

  it("perdida: Reabrir", () => {
    const html = enviada({ etapa: "perdida" }, { etapa: "perdida" });
    expect(texts(html)).toContain("Reabrir");
    expect(texts(html)).not.toContain("Fechado");
  });

  it("papel sem o Comercial: a RV enviada não tem ação", () => {
    const html = render({
      dados: { ...DADOS, status: "enviado", etapa: "aguardando_cliente", situacao: "Enviado · 21/10 10:02" },
      acoes: acoesDoOrcamento({ status: "enviado", role: "financeiro", uid: "u-fin", autorUid: "u-gui" }),
      posEnvio: { acoes: acoesDepoisDoEnvio(ENVIADA, { role: "financeiro", uid: "u-fin" }), onAcao: noop },
    });
    expect(html).not.toContain("bg-primary text-primary-foreground");
    expect(texts(html)).not.toContain("Fechado");
  });

  it("RV de execução com a aprovação dispensada: marca visível e Enviar ao cliente direto, sem passar pela aprovação", () => {
    const html = render({
      dados: { ...DADOS, tipoRv: "execucao", etapa: "execucao_a_orcar" },
      acoes: acoesDoOrcamento({ status: "rascunho", role: "comercial", uid: "u-gui", autorUid: "u-gui", etapa: "execucao_a_orcar", tipoRv: "execucao", dispensada: true }),
    });
    const lista = texts(html);
    expect(lista).toContain("Aprovação dispensada");
    expect(lista).toContain("Enviar ao cliente");
    expect(lista).not.toContain("Enviar para aprovação");
    expect(html.match(/bg-primary text-primary-foreground/g)).toHaveLength(1);
    expect(html).toMatch(/bg-primary text-primary-foreground[^"]*"[^>]*>(?:<svg[^>]*>.*?<\/svg>)?Enviar ao cliente<\/button>/);
  });

  it("sem a dispensa do servidor, a RV de execução passa pela aprovação e não mostra a marca", () => {
    const html = render({
      dados: { ...DADOS, tipoRv: "execucao", etapa: "execucao_a_orcar" },
      acoes: acoesDoOrcamento({ status: "rascunho", role: "comercial", uid: "u-gui", autorUid: "u-gui", tipoRv: "execucao", dispensada: false }),
    });
    expect(texts(html)).toContain("Enviar para aprovação");
    expect(texts(html)).not.toContain("Aprovação dispensada");
  });

  it("RV seguinte em rascunho: Descartar RV entre as secundárias, sem virar a principal", () => {
    const html = render({
      acoes: acoesDoOrcamento({ status: "rascunho", role: "comercial", uid: "u-gui", autorUid: "u-gui", descartavel: true }),
    });
    const lista = texts(html);
    expect(lista.slice(lista.indexOf("Salvar"), lista.indexOf("Salvar") + 3)).toEqual(["Salvar", "Descartar RV", "Duplicar"]);
    expect(html.match(/bg-primary text-primary-foreground/g)).toHaveLength(1);
  });

  it("sem legenda: a RV enviada só tem rótulos, dados e ações", () => {
    const lista = texts(enviada());
    expect(lista.slice(0, 19)).toEqual([
      "10045",
      "Aguardando cliente",
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
      "Enviado · 21/10 10:02",
      "Duplicar",
      "PDF",
      "Fechado",
      "Revisar",
      "Perdido",
    ]);
  });
});
