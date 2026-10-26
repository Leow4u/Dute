import { formatarReais } from "@workspace/dominio";

import { linhasGravadas } from "../comercial/documento";
import { medicaoDoRegistro } from "../comercial/medicoes";
import { problemaDoFiltro } from "../operacao/relatorios";
import type { Celula } from "../planilha-xlsx";
import type { CelulaDoRelatorio, NumeroDoResumo, TabelaDeRelatorio } from "../relatorios";
import type { DemandaDaNf, FaturaDoFinanceiro, PagamentoDaNf } from "./faturas";
import { chaveDaRevisao } from "./nf-documento";

type Registro = Record<string, unknown>;

/**
 * Os relatórios do Financeiro (docs/plataforma/fase-4-financeiro.md, parte
 * 4.8b; docs/mockups/Relatorios.dc.html): a receita por cliente e por serviço
 * (os pagamentos do período, sem os estornados; por serviço, cada pagamento
 * rateado pelas linhas do orçamento das demandas da NF, pergunta 26), as NFs
 * emitidas por mês e as contas a receber por idade. Têm valor: a tela é só
 * de quem lê preço (owner, admin e financeiro), e as regras de `faturas`,
 * `pagamentos` e das RVs são as mesmas.
 */

export const RELATORIOS_DO_FINANCEIRO = ["receita", "servico", "faturamento", "a_receber"] as const;
export type RelatorioDoFinanceiro = (typeof RELATORIOS_DO_FINANCEIRO)[number];

export const RELATORIO_DO_FINANCEIRO_ROTULO: Record<RelatorioDoFinanceiro, string> = {
  receita: "Receita por cliente",
  servico: "Receita por serviço",
  faturamento: "NFs emitidas por mês",
  a_receber: "Contas a receber",
};

export function relatorioDoFinanceiroDaBusca(busca: string): RelatorioDoFinanceiro {
  const valor = new URLSearchParams(busca.startsWith("?") ? busca.slice(1) : busca).get("relatorio");
  return (RELATORIOS_DO_FINANCEIRO as readonly string[]).includes(valor ?? "") ? (valor as RelatorioDoFinanceiro) : "receita";
}

export type FiltroDoFinanceiro = { de: string; ate: string; cliente: string | null };

/** Do primeiro dia de dois meses atrás até hoje, todos os clientes. */
export function filtroInicialDoFinanceiro(hoje: string): FiltroDoFinanceiro {
  const [ano, mes] = hoje.split("-").map(Number);
  const inicio = new Date(Date.UTC(ano, mes - 1 - 2, 1)).toISOString().slice(0, 10);
  return { de: inicio, ate: hoje, cliente: null };
}

/** As contas a receber são a posição de hoje: o período não vale para elas. */
export function problemaDoFiltroDoFinanceiro(relatorio: RelatorioDoFinanceiro, filtro: FiltroDoFinanceiro): string | null {
  return relatorio === "a_receber" ? null : problemaDoFiltro(filtro);
}

export function doClienteDoFinanceiro<T extends { customerCode: string }>(lista: readonly T[], cliente: string | null): T[] {
  return cliente ? lista.filter((item) => item.customerCode === cliente) : [...lista];
}

export function clientesDasFaturas(faturas: readonly FaturaDoFinanceiro[]): Array<{ code: string; nome: string }> {
  const nomes = new Map<string, string>();
  for (const fatura of faturas) if (fatura.customerCode && !nomes.has(fatura.customerCode)) nomes.set(fatura.customerCode, fatura.cliente);
  return [...nomes.entries()].map(([code, nome]) => ({ code, nome })).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

const reais = (cents: number): CelulaDoRelatorio => ({ reais: cents });

// --- Receita por cliente ------------------------------------------------------------------

/** Os pagamentos recebidos no período (aaaa-mm-dd), sem os estornados. */
export function pagamentosDoPeriodo(pagamentos: readonly PagamentoDaNf[], de: string, ate: string): PagamentoDaNf[] {
  return pagamentos.filter((pagamento) => !pagamento.estornado && pagamento.recebidoEm >= de && pagamento.recebidoEm <= ate);
}

export function tabelaDaReceita(pagamentos: readonly PagamentoDaNf[], nomes: ReadonlyMap<string, string>): TabelaDeRelatorio {
  const porCliente = new Map<string, { quantos: number; cents: number }>();
  for (const pagamento of pagamentos) {
    const atual = porCliente.get(pagamento.customerCode) ?? { quantos: 0, cents: 0 };
    porCliente.set(pagamento.customerCode, { quantos: atual.quantos + 1, cents: atual.cents + pagamento.valorCents });
  }
  const linhas = [...porCliente.entries()]
    .map(([code, soma]) => ({ code, cliente: nomes.get(code) ?? code, ...soma }))
    .sort((a, b) => b.cents - a.cents || a.cliente.localeCompare(b.cliente, "pt-BR"));
  const total = pagamentos.reduce((soma, pagamento) => soma + pagamento.valorCents, 0);
  return {
    colunas: ["Cliente", "Pagamentos", "Recebido"],
    linhas: linhas.map((linha) => ({ chave: linha.code, celulas: [linha.cliente, linha.quantos, reais(linha.cents)] })),
    total: linhas.length ? ["Total", pagamentos.length, reais(total)] : null,
  };
}

export function resumoDaReceita(validos: readonly PagamentoDaNf[], estornados: number): NumeroDoResumo[] {
  const total = validos.reduce((soma, pagamento) => soma + pagamento.valorCents, 0);
  return [
    { rotulo: "Recebido", valor: formatarReais(total) },
    { rotulo: "Pagamentos", valor: String(validos.length) },
    { rotulo: "Clientes", valor: String(new Set(validos.map((pagamento) => pagamento.customerCode)).size) },
    { rotulo: "Estornos", valor: String(estornados) },
  ];
}

// --- Receita por serviço ------------------------------------------------------------------

export const SEM_ORCAMENTO = "Sem orçamento";
export const SEM_SERVICO = "Sem serviço";
export const ARMAZENAGEM = "Armazenagem";

/** O que o rateio lê: a RV de cada demanda, a medição e o serviço de cada item do catálogo. */
export type FontesDoRateio = {
  /** `quotes/{numero}/revisoes/{rv}`, pela chave `${numero}:${rv}`. */
  revisoes: ReadonlyMap<string, Registro | null>;
  /** `medicoes/{id}`. */
  medicoes: ReadonlyMap<string, Registro | null>;
  /** O serviço de cada item do catálogo (`lpu_items`), pelo id. */
  servicoDoItem: ReadonlyMap<string, string>;
};

export type FonteDoRateio = { chave: string; caminho: string; tipo: "revisoes" | "medicoes" };

/** Os documentos que o rateio lê: a medição da demanda que veio dela; senão, a RV faturada. */
export function fontesDoRateio(faturas: readonly FaturaDoFinanceiro[]): FonteDoRateio[] {
  const fontes = faturas.flatMap((fatura) =>
    fatura.demandas.flatMap((demanda): FonteDoRateio[] => {
      if (demanda.medicaoId) return [{ chave: demanda.medicaoId, caminho: `medicoes/${demanda.medicaoId}`, tipo: "medicoes" }];
      if (demanda.rv !== null) return [{ chave: chaveDaRevisao(demanda.numero, demanda.rv), caminho: `quotes/${demanda.numero}/revisoes/${demanda.rv}`, tipo: "revisoes" }];
      return [];
    }),
  );
  return [...new Map(fontes.map((fonte) => [fonte.caminho, fonte])).values()];
}

/**
 * As linhas da demanda com o serviço e o valor: as da RV faturada ou, na
 * demanda da medição, os itens das linhas dela, com o serviço do catálogo. O
 * ajuste (desconto) fica de fora: o valor da demanda na NF já o desconta, e o
 * rateio o espalha pelas outras linhas.
 */
function linhasComServico(demanda: DemandaDaNf, fontes: FontesDoRateio): Array<{ servico: string; cents: number }> {
  if (demanda.medicaoId) {
    const dados = fontes.medicoes.get(demanda.medicaoId);
    const medicao = dados ? medicaoDoRegistro(demanda.medicaoId, dados) : null;
    return (medicao?.linhas ?? [])
      .filter((linha) => linha.demanda_numero === demanda.numero)
      .flatMap((linha) => linha.itens)
      .map((item) => ({ servico: (item.lpu_item_id && fontes.servicoDoItem.get(item.lpu_item_id)) || SEM_SERVICO, cents: item.total_cents }))
      .filter((linha) => linha.cents > 0);
  }
  if (demanda.rv === null) return [];
  return linhasGravadas(fontes.revisoes.get(chaveDaRevisao(demanda.numero, demanda.rv))?.linhas)
    .map((linha) => ({ servico: linha.servico ?? SEM_SERVICO, cents: linha.totalCents }))
    .filter((linha) => linha.cents > 0);
}

/**
 * O peso de cada serviço na NF: a armazenagem do WMS e, de cada demanda, o
 * valor dela na NF repartido pelas linhas. A demanda sem orçamento lido vai
 * inteira para "Sem orçamento".
 */
export function servicosDaNf(fatura: FaturaDoFinanceiro, fontes: FontesDoRateio): Map<string, number> {
  const pesos = new Map<string, number>();
  const somar = (servico: string, valor: number) => pesos.set(servico, (pesos.get(servico) ?? 0) + valor);
  for (const armazenagem of fatura.armazenagem) somar(ARMAZENAGEM, armazenagem.valorCents);
  for (const demanda of fatura.demandas) {
    const linhas = linhasComServico(demanda, fontes);
    const base = linhas.reduce((soma, linha) => soma + linha.cents, 0);
    if (base <= 0) {
      somar(SEM_ORCAMENTO, demanda.valorCents);
      continue;
    }
    for (const linha of linhas) somar(linha.servico, (demanda.valorCents * linha.cents) / base);
  }
  return pesos;
}

/** O valor repartido pelos pesos em centavos inteiros: os que sobram do arredondamento vão aos maiores restos. */
export function ratear(totalCents: number, pesos: ReadonlyMap<string, number>): Map<string, number> {
  const soma = [...pesos.values()].reduce((total, peso) => total + Math.max(0, peso), 0);
  if (soma <= 0) return new Map([[SEM_ORCAMENTO, totalCents]]);
  const partes = [...pesos.entries()].map(([servico, peso]) => {
    const exato = (totalCents * Math.max(0, peso)) / soma;
    return { servico, cents: Math.floor(exato), resto: exato - Math.floor(exato) };
  });
  let falta = totalCents - partes.reduce((total, parte) => total + parte.cents, 0);
  for (const parte of [...partes].sort((a, b) => b.resto - a.resto || a.servico.localeCompare(b.servico, "pt-BR"))) {
    if (falta <= 0) break;
    parte.cents += 1;
    falta -= 1;
  }
  return new Map(partes.filter((parte) => parte.cents > 0).map((parte) => [parte.servico, parte.cents]));
}

export type ReceitaDoServico = { servico: string; cents: number; pagamentos: number };

/** Cada pagamento rateado pelos serviços da NF dele (a NF que não se leu vai para "Sem orçamento"). */
export function receitaPorServico(pagamentos: readonly PagamentoDaNf[], faturas: readonly FaturaDoFinanceiro[], fontes: FontesDoRateio): ReceitaDoServico[] {
  const porId = new Map(faturas.map((fatura) => [fatura.id, fatura]));
  const porServico = new Map<string, ReceitaDoServico>();
  for (const pagamento of pagamentos) {
    const fatura = porId.get(pagamento.faturaId);
    const partes = ratear(pagamento.valorCents, fatura ? servicosDaNf(fatura, fontes) : new Map());
    for (const [servico, cents] of partes) {
      const atual = porServico.get(servico) ?? { servico, cents: 0, pagamentos: 0 };
      porServico.set(servico, { servico, cents: atual.cents + cents, pagamentos: atual.pagamentos + 1 });
    }
  }
  const noFim = (servico: string) => (servico === SEM_ORCAMENTO || servico === SEM_SERVICO ? 1 : 0);
  return [...porServico.values()].sort((a, b) => noFim(a.servico) - noFim(b.servico) || b.cents - a.cents || a.servico.localeCompare(b.servico, "pt-BR"));
}

export function tabelaDaReceitaPorServico(linhas: readonly ReceitaDoServico[], pagamentos: number): TabelaDeRelatorio {
  const total = linhas.reduce((soma, linha) => soma + linha.cents, 0);
  return {
    colunas: ["Serviço", "Pagamentos", "Recebido", "Participação (%)"],
    linhas: linhas.map((linha) => ({ chave: linha.servico, celulas: [linha.servico, linha.pagamentos, reais(linha.cents), total ? Math.round((linha.cents * 100) / total) : 0] })),
    total: linhas.length ? ["Total", pagamentos, reais(total), 100] : null,
  };
}

export function resumoDaReceitaPorServico(linhas: readonly ReceitaDoServico[], pagamentos: number): NumeroDoResumo[] {
  const servicos = linhas.filter((linha) => linha.servico !== SEM_ORCAMENTO && linha.servico !== SEM_SERVICO);
  return [
    { rotulo: "Recebido", valor: formatarReais(linhas.reduce((soma, linha) => soma + linha.cents, 0)) },
    { rotulo: "Serviços", valor: String(servicos.length) },
    { rotulo: "Pagamentos", valor: String(pagamentos) },
    { rotulo: SEM_ORCAMENTO, valor: formatarReais(linhas.find((linha) => linha.servico === SEM_ORCAMENTO)?.cents ?? 0) },
  ];
}

// --- NFs emitidas por mês -----------------------------------------------------------------

const MES_ROTULO = new Intl.DateTimeFormat("pt-BR", { month: "short", year: "numeric", timeZone: "UTC" });

function rotuloDoMes(mes: string): string {
  return MES_ROTULO.format(new Date(`${mes}-15T12:00:00Z`)).replace(".", "").replace(" de ", "/");
}

/** As NFs emitidas no período (pela emissão), sem as canceladas. */
export function nfsDoPeriodo(faturas: readonly FaturaDoFinanceiro[], de: string, ate: string): FaturaDoFinanceiro[] {
  return faturas.filter((fatura) => fatura.status !== "cancelada" && fatura.nf.emitidaEm >= de && fatura.nf.emitidaEm <= ate);
}

export function tabelaDoFaturamento(faturas: readonly FaturaDoFinanceiro[]): TabelaDeRelatorio {
  const porMes = new Map<string, FaturaDoFinanceiro[]>();
  for (const fatura of faturas) {
    const mes = fatura.nf.emitidaEm.slice(0, 7);
    porMes.set(mes, [...(porMes.get(mes) ?? []), fatura]);
  }
  const somar = (lista: readonly FaturaDoFinanceiro[]): CelulaDoRelatorio[] => [
    lista.length,
    reais(lista.reduce((soma, fatura) => soma + fatura.valorCents, 0)),
    reais(lista.reduce((soma, fatura) => soma + fatura.recebidoCents, 0)),
    reais(lista.reduce((soma, fatura) => soma + fatura.saldoCents, 0)),
  ];
  return {
    colunas: ["Mês", "NFs", "Emitido", "Recebido", "Saldo"],
    linhas: [...porMes.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([mes, lista]) => ({ chave: mes, celulas: [rotuloDoMes(mes), ...somar(lista)] })),
    total: faturas.length ? ["Total", ...somar(faturas)] : null,
  };
}

export function resumoDoFaturamento(faturas: readonly FaturaDoFinanceiro[]): NumeroDoResumo[] {
  return [
    { rotulo: "NFs emitidas", valor: String(faturas.length) },
    { rotulo: "Emitido", valor: formatarReais(faturas.reduce((soma, fatura) => soma + fatura.valorCents, 0)) },
    { rotulo: "Recebido", valor: formatarReais(faturas.reduce((soma, fatura) => soma + fatura.recebidoCents, 0)) },
    { rotulo: "Saldo", valor: formatarReais(faturas.reduce((soma, fatura) => soma + fatura.saldoCents, 0)) },
  ];
}

// --- Contas a receber ---------------------------------------------------------------------

export const FAIXAS_DE_ATRASO = ["a_vencer", "ate_30", "ate_60", "ate_90", "mais_de_90"] as const;
export type FaixaDeAtraso = (typeof FAIXAS_DE_ATRASO)[number];

const FAIXA_ROTULO: Record<FaixaDeAtraso, string> = {
  a_vencer: "A vencer",
  ate_30: "1 a 30 dias",
  ate_60: "31 a 60 dias",
  ate_90: "61 a 90 dias",
  mais_de_90: "Mais de 90 dias",
};

function diasEntre(de: string, ate: string): number {
  return Math.round((Date.parse(`${ate}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) / 86_400_000);
}

/** A faixa da NF pelo vencimento: a vencer até o dia do vencimento; depois, pelos dias de atraso. */
export function faixaDeAtraso(vencimento: string, hoje: string): FaixaDeAtraso {
  const atraso = diasEntre(vencimento, hoje);
  if (atraso <= 0) return "a_vencer";
  if (atraso <= 30) return "ate_30";
  if (atraso <= 60) return "ate_60";
  if (atraso <= 90) return "ate_90";
  return "mais_de_90";
}

/** As NFs com saldo: emitidas ou enviadas, sem as pagas e as canceladas. */
export function nfsEmAberto(faturas: readonly FaturaDoFinanceiro[]): FaturaDoFinanceiro[] {
  return faturas.filter((fatura) => fatura.status !== "cancelada" && fatura.status !== "paga" && fatura.saldoCents > 0);
}

export function tabelaAReceber(faturas: readonly FaturaDoFinanceiro[], hoje: string): TabelaDeRelatorio {
  const vazio = (): Record<FaixaDeAtraso, number> => ({ a_vencer: 0, ate_30: 0, ate_60: 0, ate_90: 0, mais_de_90: 0 });
  const porCliente = new Map<string, { cliente: string; faixas: Record<FaixaDeAtraso, number> }>();
  const geral = vazio();
  for (const fatura of faturas) {
    const faixa = faixaDeAtraso(fatura.vencimento, hoje);
    const atual = porCliente.get(fatura.customerCode) ?? { cliente: fatura.cliente, faixas: vazio() };
    atual.faixas[faixa] += fatura.saldoCents;
    geral[faixa] += fatura.saldoCents;
    porCliente.set(fatura.customerCode, atual);
  }
  const celulas = (faixas: Record<FaixaDeAtraso, number>): CelulaDoRelatorio[] => {
    const total = FAIXAS_DE_ATRASO.reduce((soma, faixa) => soma + faixas[faixa], 0);
    return [...FAIXAS_DE_ATRASO.map((faixa) => reais(faixas[faixa])), reais(total)];
  };
  const totalDe = (faixas: Record<FaixaDeAtraso, number>) => FAIXAS_DE_ATRASO.reduce((soma, faixa) => soma + faixas[faixa], 0);
  return {
    colunas: ["Cliente", ...FAIXAS_DE_ATRASO.map((faixa) => FAIXA_ROTULO[faixa]), "Total"],
    linhas: [...porCliente.entries()]
      .sort(([, a], [, b]) => totalDe(b.faixas) - totalDe(a.faixas) || a.cliente.localeCompare(b.cliente, "pt-BR"))
      .map(([code, linha]) => ({ chave: code, celulas: [linha.cliente, ...celulas(linha.faixas)] })),
    total: faturas.length ? ["Total", ...celulas(geral)] : null,
  };
}

export function resumoAReceber(faturas: readonly FaturaDoFinanceiro[], hoje: string): NumeroDoResumo[] {
  const total = faturas.reduce((soma, fatura) => soma + fatura.saldoCents, 0);
  const aVencer = faturas.filter((fatura) => faixaDeAtraso(fatura.vencimento, hoje) === "a_vencer").reduce((soma, fatura) => soma + fatura.saldoCents, 0);
  return [
    { rotulo: "A receber", valor: formatarReais(total) },
    { rotulo: "A vencer", valor: formatarReais(aVencer) },
    { rotulo: "Vencido", valor: formatarReais(total - aVencer) },
    { rotulo: "NFs em aberto", valor: String(faturas.length) },
  ];
}

// --- A planilha ---------------------------------------------------------------------------

/** As linhas da planilha, com o total no fim; o valor sai em reais, com duas casas. */
export function linhasDaPlanilhaDoFinanceiro(tabela: TabelaDeRelatorio): Celula[][] {
  return [...tabela.linhas.map((linha) => [...linha.celulas]), ...(tabela.total ? [[...tabela.total]] : [])];
}

export function nomeDaPlanilhaDoFinanceiro(relatorio: RelatorioDoFinanceiro, filtro: FiltroDoFinanceiro, hoje: string): string {
  return relatorio === "a_receber" ? `relatorio-a-receber-${hoje}.xlsx` : `relatorio-${relatorio}-${filtro.de}-a-${filtro.ate}.xlsx`;
}
