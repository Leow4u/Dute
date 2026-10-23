import { readFileSync } from "node:fs";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Router } from "wouter";

import {
  autorizacaoDoRegistro,
  autorizadasAFaturar,
  chaveDaRv,
  demandaDoRegistro,
  formNovaAutorizacao,
  linhasDaFila,
  type AutorizacaoRegistrada,
  type DemandaDaFila,
} from "@/lib/comercial/autorizacoes";
import { contratoDoRegistro } from "@/lib/comercial/contratos";
import { ROTA_AUTORIZACOES, TELAS_DO_COMERCIAL } from "@/lib/comercial/navegacao";

import { AutorizacoesView, type AutorizacoesViewProps } from "./autorizacoes-view";

/**
 * Tela de Autorizações (docs/mockups/ComAutorizacoes.dc.html), parte 15b: só
 * rótulos, dados e ações, uma ação principal ("Registrar autorização") e a
 * identidade v3 dentro do layout do app. Demandas e números sintéticos.
 */

const HOJE = "2026-10-21";
const ITAU = "ITAU-UNIBANCO";
const BTG = "BTG_Pactual";
const NOMES = new Map([
  [ITAU, "Itaú Unibanco"],
  [BTG, "BTG Pactual"],
]);

const CONTRATOS = [
  contratoDoRegistro("itau-2026", {
    customer_code: ITAU,
    nome: "Gestão de Mudanças",
    vigente_de: "2026-07-01",
    vigente_ate: "2027-06-30",
    autorizacao: { tipo: "pedido_aceite", prazo_perda_dias: null },
    codigo_servico: "1602",
  })!,
  contratoDoRegistro("btg-2026", {
    customer_code: BTG,
    nome: "Armazenagem e serviços",
    vigente_de: "2026-01-01",
    autorizacao: { tipo: "portal", prazo_perda_dias: 90 },
  })!,
];

function registro(numero: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const btg = String(extra.customer_code ?? "") === BTG;
  return {
    numero,
    customer_code: ITAU,
    contrato_id: btg ? "btg-2026" : "itau-2026",
    etapa: "aguardando_autorizacao",
    titulo: `Serviço ${numero}`,
    ref_cliente: `CE${numero.slice(-4)}`,
    solicitante: { contato_id: "ct_1", empresa: "Gerenciadora A" },
    validacao: { rv: 2, etapa: "aguardando_autorizacao", autorizacao: btg ? "portal" : "pedido_aceite", em: "2026-10-20T13:00:00.000Z" },
    autorizacao_ids: [],
    ...extra,
  };
}

const DEMANDAS: DemandaDaFila[] = [
  registro("10029", { executado_ate: "2026-08-12", titulo: "Montagem de sala de treinamento", numero_legado: "9898" }),
  registro("10031", { executado_ate: "2026-09-02", solicitante: { contato_id: "ct_2", empresa: "Gerenciadora B" } }),
  registro("10036", { executado_ate: "2026-09-15" }),
  registro("10042", { executado_ate: "2026-09-22" }),
  registro("10045", {
    executado_ate: "2026-10-06",
    titulo: "Desmontagem e transporte de mobiliário",
    validacao: { rv: 3, etapa: "aguardando_autorizacao", autorizacao: "pedido_aceite", em: "2026-10-08T13:00:00.000Z" },
  }),
  registro("10047", { executado_ate: "2026-10-09", titulo: "Transporte de arquivo deslizante" }),
  registro("10044", { customer_code: BTG, executado_ate: "2026-09-25", titulo: "Desmontagem de estande", ref_cliente: "REQ 0001", solicitante: null }),
].map((data) => demandaDoRegistro(String(data.numero), data)!);

const VALORES = new Map<string, number>([
  [chaveDaRv("10029", 2), 2231000],
  [chaveDaRv("10031", 2), 1842050],
  [chaveDaRv("10036", 2), 394640],
  [chaveDaRv("10042", 2), 987400],
  [chaveDaRv("10045", 3), 1423680],
  [chaveDaRv("10047", 2), 651200],
  [chaveDaRv("10044", 2), 548000],
]);

const LINHAS = linhasDaFila(DEMANDAS, { nomes: NOMES, valores: VALORES, hoje: HOJE });

const AUTORIZACOES = [
  autorizacaoDoRegistro("aut_1", {
    customer_code: ITAU,
    contrato_id: "itau-2026",
    tipo: "pedido_aceite",
    pedido: "4500000001",
    aceite: "1000000001",
    recebida_em: "2026-10-14",
    valor_cents: 3120460,
    demandas: [
      { numero: "10033", rv: 2, rotulo: "10033 – RV02", valor_cents: 1500000 },
      { numero: "10035", rv: 2, rotulo: "10035 – RV02", valor_cents: 1620460 },
    ],
    centro_custo: "41220",
    marcas: [],
    status: "registrada",
    registrada_em: "2026-10-14T15:00:00.000Z",
  }),
  autorizacaoDoRegistro("aut_2", {
    customer_code: BTG,
    contrato_id: "btg-2026",
    tipo: "portal",
    pedido: "PO 0000001",
    recebida_em: "2026-10-19",
    valor_cents: 795000,
    demandas: [{ numero: "10040", rv: 2, rotulo: "10040 – RV02", valor_cents: 790000 }],
    marcas: ["valor_diverge"],
    status: "registrada",
    registrada_em: "2026-10-19T12:00:00.000Z",
  }),
].filter((item): item is AutorizacaoRegistrada => item !== null);
const A_FATURAR = [demandaDoRegistro("10040", registro("10040", { customer_code: BTG, etapa: "a_faturar", executado_ate: "2026-08-20" }))!];
const AUTORIZADAS = autorizadasAFaturar(AUTORIZACOES, { nomes: NOMES, demandas: A_FATURAR, contratos: CONTRATOS, hoje: HOJE });

const noop = () => undefined;

function props(overrides: Partial<AutorizacoesViewProps> = {}): AutorizacoesViewProps {
  return {
    estado: "pronto",
    linhas: LINHAS,
    filtro: "todas",
    busca: "",
    painel: {
      aberto: true,
      marcadas: ["10045", "10047"],
      form: { ...formNovaAutorizacao(HOJE), valor: "20.748,80" },
      resultado: null,
      erro: null,
    },
    contratos: CONTRATOS,
    autorizadas: AUTORIZADAS,
    hoje: HOJE,
    ocupado: false,
    acoes: {
      filtrar: noop,
      buscar: noop,
      abrirPainel: noop,
      fecharPainel: noop,
      marcar: noop,
      editar: noop,
      registrar: noop,
      cancelarAutorizacao: noop,
    },
    telas: TELAS_DO_COMERCIAL,
    ...overrides,
  };
}

function render(overrides: Partial<AutorizacoesViewProps> = {}) {
  return renderToStaticMarkup(
    <Router ssrPath={ROTA_AUTORIZACOES}>
      <AutorizacoesView {...props(overrides)} />
    </Router>,
  );
}

/** Textos visíveis, na ordem: o que a pessoa lê na tela. */
function texts(html: string) {
  return html
    .replace(/<span class="sr-only">[^<]*<\/span>/g, "")
    .split(/<[^>]+>/)
    .map((text) => text.replace(/ /g, " ").trim())
    .filter(Boolean)
    .map((text) => text.replace(/&amp;/g, "&"));
}

function painel(overrides: Partial<AutorizacoesViewProps["painel"]>): AutorizacoesViewProps["painel"] {
  return { ...props().painel, ...overrides };
}

const FILA = [
  "Executados aguardando autorização",
  "7",
  "Todas",
  "7",
  "Até 30 dias",
  "4",
  "31–60 dias",
  "2",
  "Mais de 60",
  "1",
  "Itaú Unibanco",
  "6",
  "R$ 75.299,70",
  "10029 – RV02",
  "nº legado 9898",
  "Montagem de sala de treinamento",
  "CE0029 · Gerenciadora A · executada 12/08",
  "R$ 22.310,00",
  "70 dias",
  "10031 – RV02",
  "Serviço 10031",
  "CE0031 · Gerenciadora B · executada 02/09",
  "R$ 18.420,50",
  "49 dias",
  "10036 – RV02",
  "Serviço 10036",
  "CE0036 · Gerenciadora A · executada 15/09",
  "R$ 3.946,40",
  "36 dias",
  "10042 – RV02",
  "Serviço 10042",
  "CE0042 · Gerenciadora A · executada 22/09",
  "R$ 9.874,00",
  "29 dias",
  "10045 – RV03",
  "Desmontagem e transporte de mobiliário",
  "CE0045 · Gerenciadora A · executada 06/10",
  "R$ 14.236,80",
  "15 dias",
  "10047 – RV02",
  "Transporte de arquivo deslizante",
  "CE0047 · Gerenciadora A · executada 09/10",
  "R$ 6.512,00",
  "12 dias",
  "BTG Pactual",
  "1",
  "R$ 5.480,00",
  "10044 – RV02",
  "Desmontagem de estande",
  "REQ 0001 · executada 25/09",
  "R$ 5.480,00",
  "26 dias",
];

const PAINEL = [
  "Registrar autorização de faturamento",
  "Cliente",
  "Itaú Unibanco",
  "Contrato até 30/06/2027",
  "Pedido",
  "Aceite",
  "Recebida em",
  "Valor do aceite (R$)",
  "Tomador · CNPJ",
  "Centro de custo",
  "Código de serviço",
  "Escopo",
  "Documento",
  "Link ou pasta",
  "Demandas",
  "2",
  "10045 – RV03",
  "Desmontagem e transporte de mobiliário",
  "R$ 14.236,80",
  "10047 – RV02",
  "Transporte de arquivo deslizante",
  "R$ 6.512,00",
  "Soma das RVs",
  "R$ 20.748,80",
  "Valor confere com a soma das RVs",
  "Registrar autorização",
  "Cancelar",
];

const AUTORIZADAS_TEXTOS = [
  "Autorizadas · a faturar",
  "2",
  "R$ 39.154,60",
  "PO 0000001",
  "Portal do fornecedor",
  "BTG Pactual",
  "10040 – RV02",
  "Valor diverge",
  "faturar até 18/11/2026",
  "R$ 7.950,00",
  "autorizada 19/10",
  "A faturar",
  "Cancelar",
  "4500000001",
  "Aceite 1000000001",
  "Itaú Unibanco",
  "10033 – RV02",
  "10035 – RV02",
  "CC 41220",
  "R$ 31.204,60",
  "autorizada 14/10",
  "A faturar",
  "Cancelar",
];

/** O bloco de uma seção pelo aria-label. */
function secao(html: string, rotulo: string): string {
  return html.match(new RegExp(`<section aria-label="${rotulo}"[\\s\\S]*?</section>`))?.[0] ?? "";
}

describe("tela de autorizações", () => {
  it("sem legenda: fila, painel e autorizadas só têm rótulos, dados e ações", () => {
    expect(texts(render())).toEqual(["Autorizações", ...FILA, ...PAINEL, ...AUTORIZADAS_TEXTOS]);
  });

  it("identidade v3 dentro do layout do app, e uma ação principal só: Registrar autorização", () => {
    const html = render();
    expect(html).toMatch(/^<div class="v3 /);
    const principais = html.match(/<button[^>]*class="[^"]*bg-primary text-primary-foreground[^"]*"[^>]*>[\s\S]*?<\/button>/g) ?? [];
    expect(principais).toHaveLength(1);
    expect(texts(principais[0] ?? "")).toEqual(["Registrar autorização"]);
  });

  it("a autorização da medição aprovada aparece junto das outras, com Cancelar e sem legenda", () => {
    const daMedicao = autorizacaoDoRegistro("aut_safra-2026_2026-10", {
      customer_code: ITAU,
      contrato_id: "itau-2026",
      tipo: "medicao_aprovada",
      origem: "medicao",
      status: "registrada",
      recebida_em: "2026-10-20T13:30:00.000Z",
      valor_cents: 480000,
      demandas: [],
      demanda_numeros: ["10050", "10051"],
      competencia: "2026-09",
      medicao_id: "itau-2026_2026-09",
      registrada_em: "2026-10-20T13:30:00.000Z",
    })!;
    const lista = autorizadasAFaturar([...AUTORIZACOES, daMedicao], { nomes: NOMES, demandas: A_FATURAR, contratos: CONTRATOS, hoje: HOJE });
    const secaoAutorizadas = texts(secao(render({ autorizadas: lista }), "Autorizadas, a faturar"));
    expect(secaoAutorizadas.slice(0, 3)).toEqual(["Autorizadas · a faturar", "3", "R$ 43.954,60"]);
    const inicio = secaoAutorizadas.indexOf("Medição 09/2026");
    expect(secaoAutorizadas.slice(inicio, inicio + 8)).toEqual([
      "Medição 09/2026",
      "Medição aprovada",
      "Itaú Unibanco",
      "10050",
      "10051",
      "R$ 4.800,00",
      "autorizada 20/10",
      "A faturar",
    ]);
    expect(secaoAutorizadas.filter((texto) => texto === "Cancelar")).toHaveLength(3);
    // O diálogo de cancelar avisa que a medição segue aprovada: a linha leva a origem.
    expect(lista.map((linha) => linha.daMedicao)).toEqual(lista.map((linha) => linha.pedido === "Medição 09/2026"));
  });

  it("registrou as últimas demandas: a fila esvazia e a confirmação continua na tela", () => {
    const html = render({ linhas: [], painel: painel({ aberto: false, resultado: "Pedido 4500000009 registrado · 2 demandas · R$ 20.748,80" }) });
    expect(texts(html)).toContain("Pedido 4500000009 registrado · 2 demandas · R$ 20.748,80");
  });

  it("o título é o da tela, e a troca de tela fica no menu do módulo, sem abas dentro dela", () => {
    const html = render();
    expect(html).toMatch(/<h1[^>]*>Autorizações<\/h1>/);
    expect(html).not.toContain('aria-current="page"');
  });

  it("o filtro de idade marca o escolhido e mostra só a faixa", () => {
    const html = render({ filtro: "mais_60" });
    expect(html).toMatch(/<button[^>]*aria-pressed="true"[^>]*>Mais de 60/);
    expect(html).toMatch(/<button[^>]*aria-pressed="false"[^>]*>Todas/);
    const fila = texts(secao(html, "Executados aguardando autorização"));
    expect(fila).toContain("10029 – RV02");
    expect(fila).not.toContain("10045 – RV03");
    expect(fila).not.toContain("BTG Pactual");
  });

  it("dias acima de 30 em vermelho (destructive-soft); até 30, âmbar (warning-soft)", () => {
    const html = render();
    // O badge é o span com o ícone e os dias; o padrão não atravessa outro </span>.
    const badge = (dias: string) =>
      html.match(new RegExp(`<span class="([^"]*)"[^>]*><svg(?:(?!</span>)[\\s\\S])*?</svg>${dias}</span>`))?.[1] ?? "";
    expect(badge("70 dias")).toContain("bg-destructive-soft");
    expect(badge("36 dias")).toContain("bg-destructive-soft");
    expect(badge("29 dias")).toContain("bg-warning-soft");
    expect(badge("12 dias")).toContain("bg-warning-soft");
  });

  it("conferência: valor igual à soma em verde (success-soft); diferente, âmbar (warning-soft) com a diferença", () => {
    const igual = render();
    expect(igual).toMatch(/<div role="status" class="[^"]*bg-success-soft[^"]*"[^>]*>[\s\S]*?Valor confere com a soma das RVs<\/div>/);
    const diferente = render({ painel: painel({ form: { ...formNovaAutorizacao(HOJE), valor: "20.000,00" } }) });
    expect(diferente).toMatch(/<div role="status" class="[^"]*bg-warning-soft[^"]*"[^>]*>[\s\S]*?Diverge em R\$ 748,80<\/div>/);
    expect(texts(diferente)).not.toContain("Valor confere com a soma das RVs");
    // Sem valor digitado, nenhuma conferência.
    const vazio = render({ painel: painel({ form: formNovaAutorizacao(HOJE) }) });
    expect(vazio).not.toContain('role="status"');
  });

  it("com o painel aberto, cada linha marcável tem a caixa; a de outro cliente não", () => {
    const html = render();
    const caixas = Array.from(html.matchAll(/role="checkbox"[^>]*aria-label="Incluir ([^"]+)"|aria-label="Incluir ([^"]+)"[^>]*role="checkbox"/g), ([, a, b]) => a ?? b);
    expect(caixas).toEqual(["10029 – RV02", "10031 – RV02", "10036 – RV02", "10042 – RV02", "10045 – RV03", "10047 – RV02"]);
    expect(html).toMatch(/aria-checked="true"[^>]*aria-label="Incluir 10045 – RV03"|aria-label="Incluir 10045 – RV03"[^>]*aria-checked="true"/);
  });

  it("portal: pedido do portal, sem aceite, e o valor do pedido", () => {
    const html = render({ painel: painel({ marcadas: ["10044"], form: { ...formNovaAutorizacao(HOJE), valor: "5.480,00" } }) });
    const textos = texts(secao(html, "Registrar autorização de faturamento"));
    expect(textos).toEqual(expect.arrayContaining(["BTG Pactual", "Contrato sem prazo", "Pedido do portal", "Valor do pedido (R$)"]));
    expect(textos).not.toContain("Aceite");
  });

  it("o código de serviço vem do contrato até alguém mudar", () => {
    expect(render()).toMatch(/<input[^>]*id="aut-codigo"[^>]*value="1602"|<input[^>]*value="1602"[^>]*id="aut-codigo"/);
    const mudado = render({ painel: painel({ form: { ...formNovaAutorizacao(HOJE), codigoServico: "1603" } }) });
    expect(mudado).toMatch(/<input[^>]*id="aut-codigo"[^>]*value="1603"|<input[^>]*value="1603"[^>]*id="aut-codigo"/);
  });

  it("sem demanda marcada, o painel não tem cliente e o registro espera", () => {
    const html = render({ painel: painel({ marcadas: [] }) });
    const textos = texts(secao(html, "Registrar autorização de faturamento"));
    expect(textos).not.toContain("Cliente");
    expect(textos).toEqual(expect.arrayContaining(["Demandas", "0", "Soma das RVs", "R$ 0,00"]));
    const registrar = html.match(/<button[^>]*>(?:(?!<\/button>)[\s\S])*Registrar autorização<\/button>/)?.[0] ?? "";
    expect(registrar).toMatch(/ disabled=""/);
  });

  it("painel fechado: sem caixas, sem ação principal, e \"Nova autorização\" no cabeçalho", () => {
    const html = render({ painel: painel({ aberto: false }) });
    expect(html).not.toContain('role="checkbox"');
    expect(html).not.toContain('aria-label="Registrar autorização de faturamento"');
    expect(html).not.toMatch(/bg-primary text-primary-foreground/);
    expect(texts(html).slice(0, 2)).toEqual(["Autorizações", "Nova autorização"]);
  });

  it("registrada: a confirmação aparece no painel; o erro do servidor também", () => {
    const ok = texts(render({ painel: painel({ resultado: "Pedido 4500000009 registrado · 2 demandas · R$ 20.748,80" }) }));
    expect(ok).toContain("Pedido 4500000009 registrado · 2 demandas · R$ 20.748,80");
    const erro = render({ painel: painel({ erro: "Este pedido e aceite já estão registrados para o cliente." }) });
    expect(erro).toMatch(/<p role="alert"[^>]*>Este pedido e aceite já estão registrados para o cliente.<\/p>/);
  });

  it("fila vazia: diz que não há executado e o painel some", () => {
    const html = render({ linhas: [] });
    expect(texts(secao(html, "Executados aguardando autorização"))).toEqual([
      "Executados aguardando autorização",
      "0",
      "Todas",
      "0",
      "Até 30 dias",
      "0",
      "31–60 dias",
      "0",
      "Mais de 60",
      "0",
      "Nenhum executado aguardando autorização",
    ]);
    expect(html).not.toContain('aria-label="Registrar autorização de faturamento"');
    expect(html).not.toContain("Nova autorização");
  });

  it("faixa sem executado: \"Nenhum executado nesta faixa\"; busca sem resultado: \"Nenhum executado encontrado\"", () => {
    const so30 = LINHAS.filter((linha) => linha.faixa === "ate_30");
    expect(texts(render({ linhas: so30, filtro: "mais_60" }))).toContain("Nenhum executado nesta faixa");
    const busca = texts(secao(render({ busca: "nada assim" }), "Executados aguardando autorização"));
    expect(busca).toContain("Nenhum executado encontrado");
    expect(busca).not.toContain("Nenhum executado aguardando autorização");
  });

  it("a busca filtra a fila e as contagens", () => {
    const fila = texts(secao(render({ busca: "gerenciadora b" }), "Executados aguardando autorização"));
    expect(fila.slice(0, 2)).toEqual(["Executados aguardando autorização", "1"]);
    expect(fila).toContain("10031 – RV02");
    expect(fila).not.toContain("10029 – RV02");
  });

  it("carregando e erro não viram fila vazia", () => {
    expect(texts(render({ estado: "carregando", linhas: [] }))).toContain("Carregando...");
    expect(texts(render({ estado: "erro", linhas: [] }))).toContain("Não foi possível carregar a fila.");
    expect(texts(render({ autorizadas: "carregando" }))).not.toContain("Nenhuma autorização a faturar");
    expect(texts(render({ autorizadas: "erro" }))).toContain("Não foi possível carregar as autorizações.");
    expect(texts(render({ autorizadas: [] }))).toContain("Nenhuma autorização a faturar");
  });

  it("valor da RV ainda não lido aparece como traço, sem somar errado", () => {
    const semValor = linhasDaFila(DEMANDAS, { nomes: NOMES, valores: new Map(), hoje: HOJE });
    const textos = texts(render({ linhas: semValor }));
    expect(textos).not.toContain("R$ 75.299,70");
    expect(textos.filter((texto) => texto === "—").length).toBeGreaterThan(7);
  });

  it("cores só por token do tema (theme-colors), sem cor fixa nem valor fora da escala", () => {
    const fonte = readFileSync(new URL("./autorizacoes-view.tsx", import.meta.url), "utf8");
    expect(fonte).not.toMatch(/\b(?:bg|text|border)-(?:white|black|gray|slate|zinc|red|green|amber|yellow|teal|emerald|blue)-?\d*\b/);
    expect(fonte).not.toMatch(/-\[#[0-9a-fA-F]{3,8}\]|\b(?:rounded|shadow|text)-\[/);
  });
});
