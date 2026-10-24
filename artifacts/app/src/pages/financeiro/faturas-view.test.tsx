import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Router } from "wouter";

import { faturaDoFinanceiro, formDoEnvio, formDoPagamento, pagamentoDaNf, receitaPorCliente, type FaturaDoFinanceiro } from "@/lib/financeiro/faturas";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosDaTela, textosForaDaLista } from "@/test/textos";

import { FaturasView, type FaturasViewProps } from "./faturas-view";

/**
 * Financeiro › A receber, Vencidos, Pagos e Faturas (parte 4.2b): a lista do
 * filtro e o painel da NF aberta. Só rótulos, dados e ações; uma ação
 * principal, "Registrar pagamento", quando a NF tem saldo; e a identidade v3.
 * Dados sintéticos.
 */

const HOJE = "2026-10-23";

function fatura(numero: string, extra: Record<string, unknown> = {}): FaturaDoFinanceiro {
  return faturaDoFinanceiro(`fat_${numero.padStart(24, "0")}`, {
    customer_code: "ITAU",
    customer_name: "Itaú Unibanco",
    status: "emitida",
    valor_cents: 1_484_500,
    nf: { numero, serie: "1", emitida_em: "2026-10-20" },
    vencimento: "2026-11-20",
    forma: "boleto",
    demandas: [
      { numero: "10045", valor_cents: 1_000_000 },
      { numero: "10046", valor_cents: 484_500 },
    ],
    ...extra,
  })!;
}

const PARCIAL = fatura("1234", { recebido_cents: 500_000 });
const FATURAS = [
  PARCIAL,
  fatura("1235", { customer_code: "SAFRA", customer_name: "Banco Safra", valor_cents: 50_000, vencimento: "2026-10-23", status: "enviada", enviada: { em: "2026-10-21", meio: "portal_do_cliente" }, demandas: [{ numero: "10060", valor_cents: 50_000 }] }),
  fatura("1190", { vencimento: "2026-10-10", nf: { numero: "1190", serie: "2", emitida_em: "2026-09-10" } }),
  fatura("1180", { status: "paga", recebido_cents: 1_484_500, paga_em: "2026-10-22", nf: { numero: "1180", emitida_em: "2026-09-01" } }),
];
const PAGAMENTOS = [pagamentoDaNf("pag_000000000000000000000001", { fatura_id: PARCIAL.id, valor_cents: 500_000, recebido_em: "2026-10-22", forma: "pix", observacao: "Primeira parcela" })!];

const noop = () => undefined;

function props(extra: Partial<FaturasViewProps> = {}): FaturasViewProps {
  const aberta = extra.aberta === undefined ? PARCIAL : extra.aberta;
  return {
    filtro: "a_receber",
    estado: "pronto",
    faturas: FATURAS,
    busca: "",
    hoje: HOJE,
    aberta,
    pagamentos: PAGAMENTOS,
    painel: { pagamento: aberta ? formDoPagamento(aberta, HOJE) : formDoPagamento(PARCIAL, HOJE), envio: formDoEnvio(HOJE), confirmando: null, erro: null },
    resultado: null,
    ocupado: false,
    acoes: {
      buscar: noop,
      abrir: noop,
      fechar: noop,
      editarPagamento: noop,
      registrarPagamento: noop,
      editarEnvio: noop,
      marcarEnviada: noop,
      pedirEstorno: noop,
      editarMotivo: noop,
      confirmarEstorno: noop,
      pedirCancelamento: noop,
      confirmarCancelamento: noop,
      desistir: noop,
      exportar: noop,
      mudarMes: noop,
    },
    ...extra,
  };
}

function render(extra: Partial<FaturasViewProps> = {}): string {
  return renderToStaticMarkup(
    <Router ssrPath="/financeiro/a-receber">
      <FaturasView {...props(extra)} />
    </Router>,
  );
}

const PRINCIPAL = /<button[^>]*class="[^"]*bg-primary text-primary-foreground[^"]*"[^>]*>[\s\S]*?<\/button>/g;

function secao(html: string, rotulo: string): string {
  const rotuloEm = html.indexOf(`aria-label="${rotulo}"`);
  expect(rotuloEm, rotulo).toBeGreaterThan(-1);
  // Do começo da tag da seção até o fim dela.
  const inicio = html.lastIndexOf("<", rotuloEm);
  return html.slice(inicio, html.indexOf("</section>", rotuloEm));
}

const FORMAS = ["Boleto", "Pix", "Transferência", "Cartão", "Dinheiro"];
const MEIOS = ["E-mail", "Portal do cliente", "Correio", "Em mãos"];

describe("A receber, Vencidos, Pagos e Faturas", () => {
  it("A receber: a lista pelo vencimento e o painel da NF com pagamento parcial, sem legenda", () => {
    expect(textosDaTela(render())).toEqual([
      "A receber",
      "Exportar XLSX",
      "NFs",
      "2",
      "R$ 10.345,00",
      "NF 1235",
      "Banco Safra",
      "Emitida 20/10/2026 · vence 23/10/2026",
      "R$ 500,00",
      "Vence hoje",
      "NF 1234",
      "Itaú Unibanco",
      "Emitida 20/10/2026 · vence 20/11/2026",
      "R$ 9.845,00",
      "de R$ 14.845,00",
      "Para enviar",
      "Vence em 28 dias",
      "Via comercial",
      "Valor da NF",
      "R$ 14.845,00",
      "Recebido",
      "R$ 5.000,00",
      "Saldo",
      "Emissão",
      "20/10/2026",
      "Vencimento",
      "20/11/2026",
      "Forma",
      "Boleto",
      "Demandas",
      "10045",
      "R$ 10.000,00",
      "10046",
      "R$ 4.845,00",
      "Envio",
      "Enviada em",
      "Meio",
      ...MEIOS,
      "Marcar como enviada",
      "Pagamentos",
      "22/10/2026 · Pix",
      "Estornar",
      "Primeira parcela",
      "Valor recebido",
      "Recebido em",
      ...FORMAS.slice(1),
      "Observação",
      "Registrar pagamento",
    ]);
    const permitidos = [
      /^(A receber|Vencidos|Pagos|Faturas|NFs|Envio|Pagamentos|Demandas)$/,
      /^\d+$/,
      /^(de )?R\$ [\d.]+,\d{2}$/,
      /^NF \d+( · série \w+)?$/,
      /^(Itaú Unibanco|Banco Safra)$/,
      /^Emitida \d{2}\/\d{2}\/\d{4} · vence \d{2}\/\d{2}\/\d{4}$/,
      /^(Vence hoje|Vence amanhã|Vence em \d+ dias|Vencida há \d+ dias?|Paga em \d{2}\/\d{2}\/\d{4}|Cancelada)$/,
      "Para enviar",
      /^(Valor da NF|Recebido|Saldo|Emissão|Vencimento|Forma)$/,
      /^\d{2}\/\d{2}\/\d{4}$/,
      /^\d{5,8}$/,
      /^(Enviada em|Meio|Valor recebido|Recebido em|Observação)$/,
      ...FORMAS,
      ...MEIOS,
      /^\d{2}\/\d{2}\/\d{4} · (Boleto|Pix|Transferência|Cartão|Dinheiro)$/,
      "Primeira parcela",
      /^(Marcar como enviada|Estornar|Registrar pagamento|Cancelar registro|Exportar XLSX|Via comercial)$/,
    ];
    expect(textosForaDaLista(render(), permitidos)).toEqual([]);
  });

  it("identidade v3 e uma ação principal só, Registrar pagamento; a NF com pagamento não se cancela", () => {
    const html = render();
    expect(html).toMatch(/^<div class="v3 /);
    const principais = html.match(PRINCIPAL) ?? [];
    expect(principais).toHaveLength(1);
    expect(textosDaTela(principais[0] ?? "")).toEqual(["Registrar pagamento"]);
    expect(textosDaTela(html)).not.toContain("Cancelar registro");
    // A via comercial abre a NF para imprimir.
    expect(html).toContain(`href="/financeiro/nf?nf=${PARCIAL.id}"`);
    // A NF aberta fica marcada na lista.
    expect(secao(html, "NFs: A receber")).toMatch(/<button[^>]*aria-pressed="true"[^>]*>[\s\S]*?NF 1234/);
  });

  it("na NF que saiu pela Omie, cada pagamento mostra a baixa dele na Omie (parte 7.4i)", () => {
    const pelaOmie = fatura("815", { origem_nf: "omie", recebido_cents: 700_000 });
    const lancado = pagamentoDaNf("pag_000000000000000000000001", { fatura_id: pelaOmie.id, valor_cents: 500_000, recebido_em: "2026-10-21", forma: "pix" })!;
    const naFila = pagamentoDaNf("pag_000000000000000000000002", { fatura_id: pelaOmie.id, valor_cents: 200_000, recebido_em: "2026-10-22", forma: "boleto" })!;
    const baixas = new Map([
      [lancado.id, "lancada" as const],
      [naFila.id, "na_fila" as const],
    ]);
    const html = render({ aberta: pelaOmie, faturas: [pelaOmie], pagamentos: [lancado, naFila], baixas });
    const pagamentos = textosDaTela(html.slice(html.indexOf(">Pagamentos<") + 1));
    expect(pagamentos.slice(0, 8)).toEqual(["Pagamentos", "R$ 5.000,00", "21/10/2026 · Pix", "Estornar", "Baixa lançada", "R$ 2.000,00", "22/10/2026 · Boleto", "Baixa na fila"]);
    // A NF registrada à mão não tem baixa: nada muda.
    expect(textosDaTela(render())).not.toContain("Baixa lançada");
  });

  it("Vencidos: a NF vencida sem pagamento pode ser enviada, receber pagamento ou ter o registro cancelado", () => {
    const html = render({ filtro: "vencidos", aberta: FATURAS[2], pagamentos: [] });
    const textos = textosDaTela(html);
    expect(textos.slice(0, 10)).toEqual(["Vencidos", "Exportar XLSX", "NFs", "1", "R$ 14.845,00", "NF 1190 · série 2", "Itaú Unibanco", "Emitida 10/09/2026 · vence 10/10/2026", "Para enviar", "Vencida há 13 dias"]);
    expect(textos).toContain("Nenhum pagamento");
    expect(textos).toContain("Cancelar registro");
    expect((html.match(PRINCIPAL) ?? []).length).toBe(1);
    // A que saiu pela Omie (parte 7.4d) só se desfaz com a NFS-e cancelada lá: sem a ação.
    const pelaOmie = fatura("1190", { vencimento: "2026-10-10", nf: { numero: "1190", serie: "2", emitida_em: "2026-09-10" }, origem_nf: "omie" });
    const semCancelar = textosDaTela(render({ filtro: "vencidos", aberta: pelaOmie, faturas: [pelaOmie], pagamentos: [] }));
    expect(semCancelar).toContain("Registrar pagamento");
    expect(semCancelar).not.toContain("Cancelar registro");
  });

  it("Pagos: a NF paga não tem ação; o envio que não houve aparece como dado", () => {
    const html = render({ filtro: "pagos", aberta: FATURAS[3], pagamentos: [] });
    const textos = textosDaTela(html);
    expect(textos).toContain("Paga em 22/10/2026");
    expect(textos).toContain("Não enviada");
    expect(html.match(PRINCIPAL) ?? []).toHaveLength(0);
    for (const acao of ["Registrar pagamento", "Marcar como enviada", "Cancelar registro", "Estornar"]) expect(textos, acao).not.toContain(acao);
  });

  it("a NF enviada mostra o envio; o estorno e o cancelamento pedem o motivo antes de confirmar", () => {
    const enviada = FATURAS[1];
    expect(textosDaTela(secao(render({ aberta: enviada, pagamentos: [] }), "NF 1235"))).toContain("21/10/2026 · Portal do cliente");
    const estornando = render({ painel: { ...props().painel, confirmando: { tipo: "estorno", pagamentoId: PAGAMENTOS[0].id, motivo: "" } } });
    expect(textosDaTela(estornando)).toEqual(expect.arrayContaining(["Motivo do estorno", "Confirmar estorno", "Voltar"]));
    expect(textosDaTela(estornando)).not.toContain("Estornar");
    const cancelando = render({ filtro: "vencidos", aberta: FATURAS[2], pagamentos: [], painel: { ...props().painel, confirmando: { tipo: "cancelamento", motivo: "Demanda errada" } } });
    expect(textosDaTela(cancelando)).toEqual(expect.arrayContaining(["Motivo do cancelamento", "Confirmar cancelamento", "Voltar"]));
    expect(textosDaTela(cancelando)).not.toContain("Cancelar registro");
    const comErro = render({ painel: { ...props().painel, erro: "O pagamento passa do saldo da NF, de R$ 9.845,00." } });
    expect(comErro).toMatch(/<p role="alert"[^>]*>O pagamento passa do saldo da NF/);
  });

  it("sem NF aberta, a lista ocupa a tela; carregando, erro, vazio e busca sem resultado dizem o que é", () => {
    const fechada = render({ aberta: null });
    expect(fechada).not.toContain('aria-label="NF 1234"');
    expect(fechada.match(PRINCIPAL) ?? []).toHaveLength(0);
    expect(textosDaTela(render({ aberta: null, estado: "carregando", faturas: [] }))).toEqual(["A receber", "NFs", "0", "Carregando..."]);
    expect(textosDaTela(render({ aberta: null, estado: "erro", faturas: [] }))).toEqual(["A receber", "NFs", "0", "Não foi possível carregar as NFs."]);
    expect(textosDaTela(render({ aberta: null, filtro: "vencidos", faturas: [PARCIAL] }))).toEqual(["Vencidos", "NFs", "0", "Nenhuma NF vencida"]);
    expect(textosDaTela(render({ aberta: null, busca: "nada assim" }))).toContain("Nenhuma NF encontrada");
    expect(textosDaTela(render({ aberta: null, resultado: "Pagamento registrado na NF 1234" })).slice(0, 3)).toEqual(["A receber", "Exportar XLSX", "Pagamento registrado na NF 1234"]);
  });

  it("Pagos sem NF aberta: a receita do mês por cliente, com os outros somados, o total e quantos pagamentos", () => {
    const nomes = new Map([["ITAU", "Itaú Unibanco"], ["SAFRA", "Banco Safra"], ["BTG", "BTG Pactual"], ["XP", "XP"], ["C6", "C6 Bank"], ["INTER", "Banco Inter"]]);
    const pagamento = (id: string, cliente: string, cents: number, extra: Record<string, unknown> = {}) =>
      pagamentoDaNf(`pag_${id.padStart(24, "0")}`, { fatura_id: "fat_x", customer_code: cliente, valor_cents: cents, recebido_em: "2026-10-10", forma: "pix", ...extra })!;
    const dados = receitaPorCliente(
      [pagamento("1", "ITAU", 900_000), pagamento("2", "ITAU", 100_000), pagamento("3", "SAFRA", 500_000), pagamento("4", "BTG", 300_000), pagamento("5", "XP", 200_000), pagamento("6", "C6", 50_000), pagamento("7", "INTER", 40_000), pagamento("8", "SAFRA", 999_999, { status: "estornado" })],
      nomes,
    );
    const html = render({ filtro: "pagos", aberta: null, receita: { mes: "2026-10", dados, erro: false } });
    const textos = textosDaTela(secao(html, "Receita por cliente"));
    expect(textos).toEqual([
      "Receita por cliente",
      "Mês",
      "Itaú Unibanco",
      "R$ 10.000,00",
      "Banco Safra",
      "R$ 5.000,00",
      "BTG Pactual",
      "R$ 3.000,00",
      "XP",
      "R$ 2.000,00",
      "Outros 2 clientes",
      "R$ 900,00",
      "Recebido em outubro de 2026",
      "R$ 20.900,00",
      "Pagamentos",
      "7",
    ]);
    expect(html).toMatch(/id="receita-mes"[^>]*type="month"|type="month"[^>]*id="receita-mes"/);
    // Com a NF aberta, o painel dela ocupa o lugar da receita.
    expect(render({ filtro: "pagos", aberta: FATURAS[3], pagamentos: [], receita: { mes: "2026-10", dados, erro: false } })).not.toContain('aria-label="Receita por cliente"');
    expect(textosDaTela(secao(render({ filtro: "pagos", aberta: null, receita: { mes: "2026-09", dados: receitaPorCliente([], nomes), erro: false } }), "Receita por cliente"))).toContain("Nenhum pagamento em setembro de 2026");
    expect(textosDaTela(secao(render({ filtro: "pagos", aberta: null, receita: { mes: "2026-10", dados: null, erro: false } }), "Receita por cliente"))).toContain("Carregando...");
    expect(textosDaTela(secao(render({ filtro: "pagos", aberta: null, receita: { mes: "2026-10", dados: null, erro: true } }), "Receita por cliente"))).toContain("Não foi possível carregar os pagamentos.");
  });

  it("passa nas regras WCAG 2.1 A e AA do axe, com e sem NF aberta", async () => {
    expect(await violacoesDeAcessibilidade(render())).toEqual([]);
    expect(await violacoesDeAcessibilidade(render({ filtro: "vencidos", aberta: FATURAS[2], pagamentos: [] }))).toEqual([]);
    expect(await violacoesDeAcessibilidade(render({ aberta: null }))).toEqual([]);
    expect(await violacoesDeAcessibilidade(render({ filtro: "pagos", aberta: null, receita: { mes: "2026-10", dados: receitaPorCliente([], new Map()), erro: false } }))).toEqual([]);
  });
});
