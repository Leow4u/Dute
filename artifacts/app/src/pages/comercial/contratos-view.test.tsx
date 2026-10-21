import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Router } from "wouter";

import { cadastroDoDocumento, type CadastroComercial } from "@/lib/comercial/clientes";
import { aditivoDoRegistro, contratoDoRegistro, tabelaDoRegistro, type Contrato } from "@/lib/comercial/contratos";
import { ROTA_CONTRATOS, TELAS_DO_COMERCIAL } from "@/lib/comercial/navegacao";
import { LEGACY_CUSTOMER_CODE } from "@/lib/operations";

import { ContratosView, type ContratosViewProps } from "./contratos-view";

/**
 * Tela de contratos (docs/mockups/ComContrato.dc.html), parte 14: só
 * rótulos, dados e ações, uma ação principal e a identidade v3 dentro do
 * layout do app. Contratos sintéticos.
 */

const HOJE = "2026-10-21";

const CLIENTES = (
  [
    ["BTG_Pactual", { code: LEGACY_CUSTOMER_CODE, name: "BTG Pactual", legal_name: "Banco BTG Pactual S.A.", sku_prefix: "BTG" }],
    ["ITAU-UNIBANCO", { customer_code: "ITAU-UNIBANCO", name: "Itaú Unibanco", legal_name: "Itaú Unibanco S.A.", stage: "cliente" }],
  ] as Array<[string, Record<string, unknown>]>
).map(([id, data]) => cadastroDoDocumento(id, data)!) as CadastroComercial[];

const BASE = {
  numeros: [],
  objeto: "",
  renovacao: { tipo: "aditivo", aviso_dias: 30, oposicao_ate_dias: null },
  reajuste: { tipo: "negociado", indice: null, data_base: null },
  regimes: [],
  regime_padrao: "por_demanda",
  autorizacao: { tipo: "nenhuma", prazo_perda_dias: null },
  pagamento: { tipo: "texto", faixas: [], dias: null, texto: "Conforme portal." },
  impostos: { inclusos: null, texto: null },
  codigo_servico: null,
  documentos: [],
  status: "vigente",
  edicao: 1,
};

const ITAU = contratoDoRegistro("itau-2026", {
  ...BASE,
  customer_code: "ITAU-UNIBANCO",
  nome: "Gestão de Mudanças",
  numeros: [{ tipo: "contrato", numero: "CT-0003" }],
  objeto: "Mudanças e montagem de mobiliário.",
  vigente_de: "2026-07-01",
  vigente_ate: "2027-06-30",
  autorizacao: { tipo: "pedido_aceite", prazo_perda_dias: null },
  pagamento: {
    tipo: "faixas_do_dia_da_nf",
    faixas: [
      { de: 1, ate: 10, dia: 30, mes: "mesmo" },
      { de: 11, ate: 20, dia: 10, mes: "seguinte" },
      { de: 21, ate: 31, dia: 30, mes: "seguinte" },
    ],
    dias: null,
    texto: null,
  },
  codigo_servico: "1602",
  documentos: [{ nome: "Contrato assinado", referencia: "OneDrive/Contratos/itau.pdf" }],
})!;

const BTG = contratoDoRegistro("btg-2026", {
  ...BASE,
  customer_code: LEGACY_CUSTOMER_CODE,
  nome: "Armazenagem e serviços",
  vigente_de: "2026-01-01",
  vigente_ate: "2026-12-31",
  renovacao: { tipo: "automatica", aviso_dias: null, oposicao_ate_dias: 0 },
  regime_padrao: "wms",
})!;

const RFQ = contratoDoRegistro("rfq-2021", {
  ...BASE,
  customer_code: "ITAU-UNIBANCO",
  nome: "RFQ 2021",
  vigente_de: "2021-07-01",
  vigente_ate: "2026-06-29",
  status: "encerrado",
})!;

const CONTRATOS: Contrato[] = [ITAU, BTG, RFQ];

const TABELAS = [
  tabelaDoRegistro("comercial", { nome: "LPU v2.0", variante: "Comercial", vigente_de: "2026-07-01", status: "ativa", precos: { a: {}, b: {} } })!,
  tabelaDoRegistro("rfq", { nome: "RFQ 2021", variante: "Comercial", vigente_de: "2021-07-01", vigente_ate: "2026-06-29", status: "encerrada", precos: { a: {} } })!,
];

const ADITIVOS = [
  aditivoDoRegistro("1", { numero: 1, tipo: "prorrogacao", assinado_em: "2026-06-20", vigente_de: "2026-07-01", vigente_ate: "2027-06-30", documento: { nome: "Aditivo 1", referencia: "r" } })!,
];

const noop = () => undefined;

function props(overrides: Partial<ContratosViewProps> = {}): ContratosViewProps {
  return {
    estado: "pronto",
    contratos: CONTRATOS,
    clientes: CLIENTES,
    hoje: HOJE,
    filtro: "vigentes",
    onFiltro: noop,
    selecionado: ITAU,
    onSelecionar: noop,
    tabelas: TABELAS,
    aditivos: ADITIVOS,
    ocupado: false,
    acoes: { novoContrato: noop, editar: noop, registrarAditivo: noop },
    telas: TELAS_DO_COMERCIAL,
    ...overrides,
  };
}

function render(overrides: Partial<ContratosViewProps> = {}) {
  return renderToStaticMarkup(
    <Router ssrPath={ROTA_CONTRATOS}>
      <ContratosView {...props(overrides)} />
    </Router>,
  );
}

/** Textos visíveis, na ordem: o que a pessoa lê na tela. */
function texts(html: string) {
  return html
    .replace(/<span class="sr-only">[^<]*<\/span>/g, "")
    .split(/<[^>]+>/)
    .map((text) => text.trim())
    .filter(Boolean)
    .map((text) => text.replace(/&amp;/g, "&"));
}

const CABECALHO_E_LISTA = [
  "Comercial",
  "Orçamentos",
  "Contratos",
  "Autorizações",
  "Medições",
  "Vigentes",
  "2",
  "Novo contrato",
  "BTG Pactual",
  "Renovação em 71 dias",
  "Armazenagem e serviços · renova 31/12/2026",
  "Itaú Unibanco",
  "Vigente",
  "Gestão de Mudanças · vence 30/06/2027",
  "Encerrados",
  "1",
];

describe("tela de contratos", () => {
  it("sem legenda: abas, lista e ficha só têm rótulos, dados e ações", () => {
    expect(texts(render())).toEqual([
      ...CABECALHO_E_LISTA,
      // Ficha
      "Itaú Unibanco S.A.",
      "Gestão de Mudanças",
      "Vigente",
      "Contrato CT-0003",
      "Aditivo 1",
      "Editar",
      "Registrar aditivo",
      "Objeto",
      "Mudanças e montagem de mobiliário.",
      "Vigência",
      "01/07/2026 – 30/06/2027",
      "faltam 252 dias",
      "Hoje · 21/10",
      "Aviso · 31/05/2027",
      // Condições
      "Condições",
      "Renovação",
      "Por aditivo",
      "Aviso de denúncia",
      "30 dias antes do fim",
      "Reajuste",
      "Negociado na renovação",
      "Regime de cobrança",
      "Por demanda",
      "Autorização de faturamento",
      "Pedido e aceite",
      "Código de serviço",
      "1602",
      "Impostos",
      "—",
      "Pagamento",
      "NF recebida dia 1 a 10",
      "Paga dia 30",
      "NF recebida dia 11 a 20",
      "Paga dia 10 do mês seguinte",
      "NF recebida dia 21 a 31",
      "Paga dia 30 do mês seguinte",
      "NF recebida hoje ·",
      "paga em 30/11/2026",
      // Tabelas
      "Tabelas de preço",
      "2",
      "Tabela",
      "Variante",
      "Situação",
      "Itens",
      "Vigência",
      "LPU v2.0",
      "Comercial",
      "Vigente",
      "2",
      "desde 01/07/2026",
      "RFQ 2021",
      "Comercial",
      "Encerrada em 29/06/2026",
      "1",
      "01/07/2021 – 29/06/2026",
      // Aditivos e documentos
      "Aditivos",
      "1",
      "Aditivo 1",
      "Prorrogação",
      "assinado 20/06/2026 · vigência 01/07/2026 – 30/06/2027",
      "Aditivo 1",
      "Documentos",
      "1",
      "Contrato assinado",
      "OneDrive/Contratos/itau.pdf",
    ]);
  });

  it("identidade v3 dentro do layout do app, e uma ação principal só: Registrar aditivo", () => {
    const html = render();
    expect(html).toMatch(/^<div class="v3 /);
    const principais = html.match(/<button[^>]*class="[^"]*bg-primary text-primary-foreground[^"]*"[^>]*>[\s\S]*?<\/button>/g) ?? [];
    expect(principais).toHaveLength(1);
    expect(texts(principais[0] ?? "")).toEqual(["Registrar aditivo"]);
  });

  it("a aba Contratos aparece marcada na barra do módulo", () => {
    expect(render()).toMatch(/<a [^>]*aria-current="page"[^>]*>Contratos<\/a>/);
  });

  it("contrato com alerta: os alertas aparecem na ficha, com a data e quando", () => {
    const ficha = texts(render({ selecionado: BTG }));
    const inicio = ficha.indexOf("Fim da vigência em 31/12/2026");
    expect(inicio).toBeGreaterThan(0);
    expect(ficha.slice(inicio, inicio + 2)).toEqual(["Fim da vigência em 31/12/2026", "em 71 dias"]);
    // Contrato sem alerta não tem a seção.
    expect(render()).not.toContain('aria-label="Alertas"');
    expect(render({ selecionado: BTG })).toContain('aria-label="Alertas"');
  });

  it("cada alerta tem o ícone do tipo: renovação, fim da vigência e reajuste", () => {
    const comIndice = { ...ITAU, dados: { ...ITAU.dados, reajuste: { tipo: "indice" as const, indice: "IPCA", data_base: "04-01" } } };
    // 05/03/2027: aviso em 31/05 (87 dias), fim em 30/06 (117 dias) e reajuste em 01/04 (27 dias).
    const html = render({ selecionado: comIndice, contratos: [comIndice, BTG, RFQ], hoje: "2027-03-05" });
    const alertas = html.match(/<section aria-label="Alertas"[\s\S]*?<\/section>/)?.[0] ?? "";
    expect(texts(alertas)).toEqual([
      "Reajuste IPCA em 01/04/2027",
      "em 27 dias",
      "Aviso de denúncia até 31/05/2027",
      "em 87 dias",
      "Fim da vigência em 30/06/2027",
      "em 117 dias",
    ]);
    const icones = Array.from(alertas.matchAll(/class="lucide (lucide-[a-z-]+)/g), ([, icone]) => icone);
    expect(icones).toEqual(["lucide-trending-up", "lucide-refresh-cw", "lucide-calendar-x"]);
  });

  it("documento com endereço https abre em outra aba, na lista de documentos e no aditivo", () => {
    const link = "https://exemplo.com/aditivo-1.pdf";
    const comLink = contratoDoRegistro("itau-2026", { ...BASE, ...ITAU.dados, documentos: [{ nome: "Contrato assinado", referencia: link }] })!;
    const aditivo = aditivoDoRegistro("1", { numero: 1, tipo: "escopo", assinado_em: "2026-06-20", documento: { nome: "Aditivo 1", referencia: link } })!;
    const html = render({ selecionado: comLink, contratos: [comLink, BTG, RFQ], aditivos: [aditivo] });
    const links = Array.from(html.matchAll(/<a href="([^"]+)" target="_blank" rel="noreferrer"[^>]*>([\s\S]*?)<\/a>/g), ([, href, corpo]) => [href, texts(corpo).join(" ")]);
    expect(links).toEqual([
      [link, "Aditivo 1"],
      [link, link],
    ]);
  });

  it("filtro Encerrados: a lista mostra os encerrados e o atalho volta para Vigentes", () => {
    const lista = texts(render({ filtro: "encerrados", selecionado: RFQ }));
    expect(lista.slice(0, 14)).toEqual([
      "Comercial",
      "Orçamentos",
      "Contratos",
      "Autorizações",
      "Medições",
      "Encerrados",
      "1",
      "Novo contrato",
      "Itaú Unibanco",
      "Encerrado",
      "RFQ 2021 · até 29/06/2026",
      "Vigentes",
      "2",
      "Itaú Unibanco S.A.",
    ]);
  });

  it("no celular e no notebook, lista e ficha empilham; na tela larga, ficam lado a lado e a lista rola sozinha", () => {
    const html = render();
    expect(html).toContain('class="flex flex-col gap-5 xl:flex-row xl:items-start"');
    const lista = html.match(/<section aria-label="Contratos vigentes" class="([^"]+)"/)?.[1] ?? "";
    expect(lista.split(" ")).toEqual(expect.arrayContaining(["xl:sticky", "xl:top-4", "xl:overflow-y-auto", "xl:w-80"]));
  });

  it("as grades da ficha seguem a largura da ficha (container), não a da janela", () => {
    const html = render({ selecionado: BTG });
    expect(html).toMatch(/aria-label="Ficha do contrato" role="region" class="@container /);
    expect(html).toContain('aria-label="Alertas" class="grid gap-3 @xl:grid-cols-2"');
    expect(html).not.toMatch(/ (sm|md|lg):grid-cols-/);
  });

  it("tabelas e aditivos carregando ou com erro não viram lista vazia", () => {
    const carregando = texts(render({ tabelas: "carregando", aditivos: "carregando" }));
    expect(carregando).not.toContain("Nenhuma tabela");
    expect(carregando).not.toContain("Nenhum aditivo");
    expect(carregando.filter((texto) => texto === "Carregando...")).toHaveLength(2);
    const comErro = texts(render({ tabelas: "erro", aditivos: "erro" }));
    expect(comErro.filter((texto) => texto === "Não foi possível carregar.")).toHaveLength(2);
    // Sem aditivos lidos, o selo do último aditivo não aparece e o próximo número não se sabe.
    expect(carregando).not.toContain("Aditivo 1");
    const registrar = (html: string) => html.match(/<button[^>]*>(?:(?!<\/button>)[\s\S])*Registrar aditivo<\/button>/)?.[0] ?? "";
    expect(registrar(render({ aditivos: "carregando" }))).toMatch(/ disabled=""/);
    expect(registrar(render())).not.toMatch(/ disabled=""/);
  });

  it("vazios dizem que não há nada", () => {
    const vazio = texts(render({ tabelas: [], aditivos: [], selecionado: BTG }));
    expect(vazio).toEqual(expect.arrayContaining(["Nenhuma tabela", "Nenhum aditivo", "Nenhum documento"]));
  });

  it("sem contrato nenhum, a lista diz que não há e a ficha não aparece", () => {
    const tela = texts(render({ contratos: [], selecionado: null }));
    expect(tela).toEqual(["Comercial", "Orçamentos", "Contratos", "Autorizações", "Medições", "Vigentes", "0", "Novo contrato", "Nenhum contrato vigente", "Encerrados", "0"]);
  });

  it("carregando e erro na lista", () => {
    expect(texts(render({ estado: "carregando", selecionado: null })).slice(8)).toEqual(["Carregando..."]);
    expect(texts(render({ estado: "erro", selecionado: null })).slice(8)).toEqual(["Não foi possível carregar os contratos."]);
  });
});
