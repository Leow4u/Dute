import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Router } from "wouter";

import { cadastroDoDocumento, type CadastroComercial } from "@/lib/comercial/clientes";
import { contratoDoRegistro } from "@/lib/comercial/contratos";
import {
  competenciasDoContrato,
  medicaoDoRegistro,
  tabelaDaLinhaDoRegistro,
  type Medicao,
} from "@/lib/comercial/medicoes";
import { medicaoDoDoc } from "@/lib/comercial/medicoes-exemplo";
import { ROTA_MEDICOES, TELAS_DO_COMERCIAL } from "@/lib/comercial/navegacao";

import { MedicoesView, type MedicoesViewProps } from "./medicoes-view";

/**
 * Tela de Medições (docs/mockups/ComMedicaoMensal.dc.html), parte 16b: só
 * rótulos, dados e ações, uma ação principal e a identidade v3 dentro do
 * layout do app. Medição e contrato sintéticos.
 */

const HOJE = "2026-10-21";

const CLIENTES = [
  cadastroDoDocumento("BANCO-SAFRA", { customer_code: "BANCO-SAFRA", name: "Banco Safra", legal_name: "Banco Safra S.A.", stage: "cliente" }),
  cadastroDoDocumento("ITAU", { customer_code: "ITAU", name: "Itaú Unibanco", stage: "cliente" }),
].filter((cadastro): cadastro is CadastroComercial => cadastro !== null);

const BASE_CONTRATO = {
  customer_code: "BANCO-SAFRA",
  nome: "LPU de transporte",
  vigente_de: "2025-05-12",
  vigente_ate: null,
  regime_padrao: "medicao_mensal",
  regimes: [],
  status: "vigente",
};
const SAFRA = contratoDoRegistro("safra", BASE_CONTRATO)!;
const ITAU = contratoDoRegistro("itau", { ...BASE_CONTRATO, customer_code: "ITAU", nome: "Mudanças" })!;

const TABELAS = [
  tabelaDaLinhaDoRegistro("safra-2026", { nome: "LPU Safra 2026", variante: "Comercial", vigente_de: "2026-01-01", status: "ativa", precos: {} })!,
];

function lida(sobrescrever: Record<string, unknown> = {}): Medicao {
  return medicaoDoRegistro(String(sobrescrever.id ?? "safra_2026-10"), medicaoDoDoc(sobrescrever))!;
}

const AGOSTO = lida({ id: "safra_2026-08", competencia: "2026-08", status: "enviada", enviada_em: "2026-09-01T13:00:00.000Z", total_cents: 1694000 });
const SETEMBRO = lida({ id: "safra_2026-09", competencia: "2026-09", status: "aprovada", aprovada_em: "2026-10-05T13:00:00.000Z", total_cents: 1521000 });
const OUTUBRO = lida();

const noop = () => undefined;

function props(overrides: Partial<MedicoesViewProps> = {}): MedicoesViewProps {
  const medicao = overrides.medicao === undefined ? OUTUBRO : overrides.medicao;
  return {
    estado: "pronto",
    contratos: [SAFRA],
    clientes: CLIENTES,
    contrato: SAFRA,
    onContrato: noop,
    hoje: HOJE,
    chips: competenciasDoContrato([AGOSTO, SETEMBRO, OUTUBRO], HOJE),
    competencia: "2026-10",
    onCompetencia: noop,
    medicao,
    tabelas: TABELAS,
    ocupado: false,
    aviso: null,
    acoes: {
      abrir: noop,
      enviar: noop,
      aprovar: noop,
      contestar: noop,
      reabrir: noop,
      exportar: noop,
      novaLinha: noop,
      editarLinha: noop,
      aplicar: noop,
      anexar: noop,
    },
    telas: TELAS_DO_COMERCIAL,
    ...overrides,
  };
}

function render(overrides: Partial<MedicoesViewProps> = {}) {
  return renderToStaticMarkup(
    <Router ssrPath={ROTA_MEDICOES}>
      <MedicoesView {...props(overrides)} />
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
    .map((text) => text.replace(/&amp;/g, "&").replace(/&gt;/g, ">").replace(/ /g, " "));
}

const CABECALHO_E_COMPETENCIAS = [
  "Comercial",
  "Orçamentos",
  "Contratos",
  "Medições",
  // Competências
  "Agosto/2026",
  "Aguardando aprovação",
  "Enviada 01/09 · R$ 16.940,00",
  "Setembro/2026",
  "Aprovada",
  "Aprovada 05/10 · R$ 15.210,00",
  "Outubro/2026",
  "Rascunho",
  "Rascunho · R$ 7.736,00",
];

describe("tela de medições", () => {
  it("sem legenda: abas, competências, cabeçalho, linhas, resumo e anexos só têm rótulos, dados e ações", () => {
    expect(texts(render())).toEqual([
      ...CABECALHO_E_COMPETENCIAS,
      // Cabeçalho da medição
      "Banco Safra · Outubro/2026",
      "Rascunho",
      "Exportar Diário de Bordo",
      "Enviar ao cliente",
      "Competência",
      "Outubro/2026",
      "01 a 31/10",
      "Contrato",
      "LPU de transporte",
      "Medição mensal",
      "Demandas",
      "4",
      "01/10 a 18/10",
      "Total",
      "R$ 7.736,00",
      "LPU Safra 2026",
      "Envio até",
      "01/11/2026",
      "em 11 dias",
      // Linhas
      "Demandas do mês",
      "LPU Safra 2026",
      "Nova linha",
      "OS · solicitação",
      "Frete",
      "Veículo · ajudantes",
      "Origem → destino · mercadoria",
      "Valor",
      "OS 10031-01",
      "29/09 · Infraestrutura",
      "01/10 · qui",
      "VUC × 1",
      "2 ajudantes · seg–sex",
      "Sede Paulista → Agência Augusta",
      "18 caixas de arquivo",
      "R$ 1.180,00",
      "OS 10034-01",
      "02/10 · Facilities",
      "03/10 · sáb",
      "Sábado na tarifa de dia útil",
      "Aplicar sábado",
      "3/4 × 1",
      "3 ajudantes · seg–sex",
      "Agência Augusta → Sede Paulista",
      "14 cadeiras e 2 armários altos",
      "R$ 1.730,00",
      "OS 10038-01",
      "08/10 · Arquivo",
      "12/10 · seg",
      "Truck até Jundiaí × 1",
      "4 ajudantes · dom/feriado",
      "Sede Paulista → Arquivo Jundiaí",
      "120 caixas de arquivo",
      "Rota fora da tabela",
      "R$ 3.254,00",
      "OS 10043-01",
      "15/10 · Facilities",
      "Sem pedido anexo",
      "18/10 · dom",
      "VUC × 1",
      "2 ajudantes · dom/feriado",
      "Sede Paulista → Agência Vila Olímpia",
      "40 caixas de material",
      "R$ 1.572,00",
      "Total · 4 demandas",
      "R$ 7.736,00",
      // Resumo por item
      "Resumo por item",
      "Diárias de ajudante",
      "Ajudante de Domingo/feriado das 08:00 às 17:00",
      "6 × 476,00",
      "R$ 2.856,00",
      "Ajudante de Segunda a Sexta das 09:00 às 18:00",
      "5 × 280,00",
      "R$ 1.400,00",
      "Viagens",
      "3/4",
      "1 × 890,00",
      "R$ 890,00",
      "Truck até Jundiaí",
      "1 × 1.350,00",
      "R$ 1.350,00",
      "VUC",
      "2 × 620,00",
      "R$ 1.240,00",
      "Total",
      "R$ 7.736,00",
      // Anexos
      "Pedidos anexados",
      "3 de 4",
      "OS 10031-01.pdf",
      "29/09",
      "OS 10034-01.pdf",
      "02/10",
      "OS 10038-01.pdf",
      "08/10",
      "OS 10043-01 · faltando",
      "Anexar",
    ]);
  });

  it("identidade v3 dentro do layout do app, e uma ação principal só: Enviar ao cliente", () => {
    const html = render();
    expect(html).toMatch(/^<div class="v3 /);
    const principais = html.match(/<button[^>]*class="[^"]*bg-primary text-primary-foreground[^"]*"[^>]*>[\s\S]*?<\/button>/g) ?? [];
    expect(principais).toHaveLength(1);
    expect(texts(principais[0] ?? "")).toEqual(["Enviar ao cliente"]);
  });

  it("a aba Medições aparece marcada na barra do módulo", () => {
    expect(render()).toMatch(/<a [^>]*aria-current="page"[^>]*>Medições<\/a>/);
  });

  it("a competência aberta fica marcada (aria-pressed) e as outras levam a ela", () => {
    const html = render();
    const botoes = Array.from(html.matchAll(/<button[^>]*aria-pressed="(true|false)"[^>]*>([\s\S]*?)<\/button>/g), ([, marcado, corpo]) => [marcado, texts(corpo)[0]]);
    expect(botoes).toEqual([
      ["false", "Agosto/2026"],
      ["false", "Setembro/2026"],
      ["true", "Outubro/2026"],
    ]);
  });

  it("os botões do cabeçalho: enviar fica desabilitado sem linhas; exportar também", () => {
    const vazia = render({ medicao: lida({ linhas: [], total_cents: 0, marcas: {} }) });
    const botao = (html: string, rotulo: string) => html.match(new RegExp(`<button[^>]*>(?:(?!</button>)[\\s\\S])*${rotulo}</button>`))?.[0] ?? "";
    expect(botao(vazia, "Enviar ao cliente")).toMatch(/ disabled=""/);
    expect(botao(vazia, "Exportar Diário de Bordo")).toMatch(/ disabled=""/);
    expect(botao(render(), "Enviar ao cliente")).not.toMatch(/ disabled=""/);
    expect(botao(render({ ocupado: true }), "Enviar ao cliente")).toMatch(/ disabled=""/);
    expect(texts(vazia)).toEqual(expect.arrayContaining(["Nenhuma OS nesta medição", "Total · 0 demandas"]));
  });

  it("Baixar ZIP dos pedidos fica fora do v1 (os PDFs não estão no Storage)", () => {
    expect(render()).not.toContain("ZIP");
  });
});

describe("tela de medições: cada situação tem uma ação principal", () => {
  const principais = (html: string) =>
    (html.match(/<button[^>]*class="[^"]*bg-primary text-primary-foreground[^"]*"[^>]*>[\s\S]*?<\/button>/g) ?? []).map((botao) => texts(botao).join(" "));

  it("enviada: Registrar aprovação é a principal; Registrar contestação, secundária; o envio fica registrado", () => {
    const enviada = lida({ status: "enviada", enviada_em: "2026-10-20T13:15:00.000Z" });
    const html = render({ medicao: enviada, chips: competenciasDoContrato([AGOSTO, SETEMBRO, enviada], HOJE) });
    expect(principais(html)).toEqual(["Registrar aprovação"]);
    const t = texts(html);
    expect(t).toEqual(expect.arrayContaining(["Aguardando aprovação", "Enviada 20/10 10:15", "Registrar contestação", "Exportar Diário de Bordo"]));
    expect(t).not.toContain("Enviar ao cliente");
    // Enviada não se edita: sem Nova linha, Aplicar nem Anexar.
    expect(t).not.toContain("Nova linha");
    expect(t).not.toContain("Aplicar sábado");
    expect(t).not.toContain("Anexar");
  });

  it("contestada: Reabrir é a principal e a nota do cliente aparece", () => {
    const contestada = lida({
      status: "contestada",
      enviada_em: "2026-10-20T13:15:00.000Z",
      contestacao: { em: "2026-10-22T12:00:00.000Z", nota: "Valor do sábado diverge" },
    });
    const html = render({ medicao: contestada, chips: competenciasDoContrato([AGOSTO, SETEMBRO, contestada], HOJE) });
    expect(principais(html)).toEqual(["Reabrir"]);
    expect(texts(html)).toEqual(expect.arrayContaining(["Contestada", "Contestada pelo cliente · 22/10 09:00", "Valor do sábado diverge"]));
  });

  it("aprovada: sem ação principal; mostra quando foi aprovada e as demandas pendentes", () => {
    const aprovada = lida({
      status: "aprovada",
      enviada_em: "2026-10-20T13:15:00.000Z",
      aprovada_em: "2026-10-22T12:00:00.000Z",
      aprovacao: { em: "2026-10-22T12:00:00.000Z", link: "https://mail/aprovou" },
      demandas_pendentes: [{ numero: "10045", motivo: "proposta sem fechamento" }],
    });
    const html = render({ medicao: aprovada, chips: competenciasDoContrato([AGOSTO, SETEMBRO, aprovada], HOJE) });
    expect(principais(html)).toEqual([]);
    expect(texts(html)).toEqual(expect.arrayContaining(["Aprovada", "Aprovada 22/10 09:00", "Demandas pendentes", "10045", "proposta sem fechamento"]));
    expect(html).toContain('href="https://mail/aprovou"');
  });

  it("competência sem medição: Abrir medição é a principal", () => {
    const html = render({ medicao: null, competencia: "2026-09", chips: competenciasDoContrato([AGOSTO], HOJE) });
    expect(principais(html)).toEqual(["Abrir medição"]);
    const t = texts(html);
    expect(t).toEqual(expect.arrayContaining(["Banco Safra · Setembro/2026", "Não aberta", "Prazo de envio 01/10"]));
    expect(t).not.toContain("Resumo por item");
  });
});

describe("tela de medições: marcas e estados", () => {
  it("a linha com marca fica destacada; sem marca, não", () => {
    const html = render();
    const linhas = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) ?? [];
    const corpo = linhas.slice(1);
    expect(corpo).toHaveLength(4);
    expect(corpo.map((linha) => /bg-warning-soft/.test(linha))).toEqual([false, true, true, true]);
  });

  it("o prazo vencido aparece como há N dias, em tom de alerta", () => {
    const html = render({ hoje: "2026-11-03", competencia: "2026-10", chips: competenciasDoContrato([AGOSTO, SETEMBRO, OUTUBRO], "2026-11-03") });
    expect(texts(html)).toEqual(expect.arrayContaining(["01/11/2026", "há 2 dias"]));
  });

  it("com mais de um contrato por medição mensal, o seletor de contrato aparece e marca o aberto", () => {
    const html = render({ contratos: [SAFRA, ITAU] });
    const grupo = html.match(/<div role="group" aria-label="Contrato"[\s\S]*?<\/div><\/div>/)?.[0] ?? html.match(/aria-label="Contrato"[\s\S]{0,900}/)?.[0] ?? "";
    expect(texts(grupo)).toEqual(expect.arrayContaining(["Banco Safra", "LPU de transporte", "Itaú Unibanco", "Mudanças"]));
    expect(render()).not.toContain('aria-label="Contrato"');
  });

  it("aviso de que a medição mudou fica no alto", () => {
    const aviso = "A medição safra_2026-10 mudou: está enviada ao cliente, na edição 7. Abra de novo.";
    expect(texts(render({ aviso }))).toContain(aviso);
    expect(render({ aviso })).toContain('role="alert"');
    expect(render()).not.toContain('role="alert"');
  });

  it("carregando e erro nunca viram medição vazia", () => {
    expect(texts(render({ medicao: "carregando" })).slice(CABECALHO_E_COMPETENCIAS.length)).toEqual(["Carregando..."]);
    expect(texts(render({ medicao: "erro" })).slice(CABECALHO_E_COMPETENCIAS.length)).toEqual(["Não foi possível carregar a medição."]);
    expect(texts(render({ estado: "carregando", contrato: null, medicao: "carregando", chips: [] }))).toEqual([
      "Comercial",
      "Orçamentos",
      "Contratos",
      "Medições",
      "Carregando...",
    ]);
    expect(texts(render({ estado: "erro", contrato: null, medicao: "carregando", chips: [] })).slice(4)).toEqual(["Não foi possível carregar os contratos."]);
  });

  it("sem contrato por medição mensal, diz que não há", () => {
    expect(texts(render({ contratos: [], contrato: null, medicao: "carregando", chips: [] })).slice(4)).toEqual([
      "Nenhum contrato cobra por medição mensal",
    ]);
  });

  it("resumo e anexos carregando por leitura de tabela não quebram: a tabela com erro só tira o nome", () => {
    const t = texts(render({ tabelas: "erro" }));
    expect(t).toEqual(expect.arrayContaining(["Demandas do mês", "Resumo por item"]));
    expect(t).not.toContain("LPU Safra 2026");
  });
});
