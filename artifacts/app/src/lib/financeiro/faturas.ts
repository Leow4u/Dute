import { centavosDaLinha, dataValida, diasEntre, formatarReais } from "@workspace/dominio";
import { AlarmClock, Send } from "lucide-react";

import { valorDaTela } from "../comercial/autorizacoes";
import type { Celula } from "../planilha-xlsx";
import { dataBr } from "../comercial/clientes";
import type { ItemDoInicio } from "../inicio-do-modulo";
import { FORMAS_DE_PAGAMENTO, FORMA_ROTULO, type FormaDePagamento } from "./a-faturar";

/**
 * As NFs registradas e a cobrança delas (docs/plataforma/fase-4-financeiro.md,
 * parte 4.2b): A receber, Vencidos e Pagos, o painel da NF e os pedidos para
 * advanceFatura. O valor aqui é para ler e conferir: o servidor confere de
 * novo o saldo, as datas e o status. Vencida não é status gravado: é a NF com
 * saldo e vencimento antes de hoje.
 */

type Registro = Record<string, unknown>;

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

function centavos(valor: unknown): number {
  return typeof valor === "number" && Number.isSafeInteger(valor) && valor >= 0 ? valor : 0;
}

function objeto(valor: unknown): Registro | null {
  return valor && typeof valor === "object" && !Array.isArray(valor) ? (valor as Registro) : null;
}

export const STATUS_DA_FATURA = ["emitida", "enviada", "paga", "cancelada"] as const;
export type StatusDaFatura = (typeof STATUS_DA_FATURA)[number];

export const MEIOS_DE_ENVIO = ["email", "portal_do_cliente", "correio", "em_maos"] as const;
export type MeioDeEnvio = (typeof MEIOS_DE_ENVIO)[number];
export const MEIO_ROTULO: Record<MeioDeEnvio, string> = {
  email: "E-mail",
  portal_do_cliente: "Portal do cliente",
  correio: "Correio",
  em_maos: "Em mãos",
};

/** A demanda como a fatura guardou: o valor calculado no servidor e de onde ele saiu. */
export type DemandaDaNf = { numero: string; valorCents: number; rv: number | null; medicaoId: string | null; autorizacaoIds: string[] };

export type FaturaDoFinanceiro = {
  id: string;
  customerCode: string;
  cliente: string;
  status: StatusDaFatura;
  valorCents: number;
  recebidoCents: number;
  saldoCents: number;
  nf: { numero: string; serie: string; emitidaEm: string };
  vencimento: string;
  forma: FormaDePagamento;
  observacao: string | null;
  demandas: DemandaDaNf[];
  enviada: { em: string; meio: MeioDeEnvio } | null;
  pagaEm: string | null;
  cancelada: { em: string; motivo: string } | null;
  /** A NF que saiu pela Omie (Fase 7, parte 7.4d): só se desfaz com a NFS-e cancelada na Omie. */
  pelaOmie: boolean;
};

export function faturaDoFinanceiro(id: string, dados: Registro): FaturaDoFinanceiro | null {
  const nf = objeto(dados.nf);
  const numero = texto(nf?.numero);
  if (!numero) return null;
  const status = texto(dados.status);
  const valorCents = centavos(dados.valor_cents);
  const recebidoCents = centavos(dados.recebido_cents);
  const forma = texto(dados.forma);
  const enviada = objeto(dados.enviada);
  const meio = texto(enviada?.meio);
  const cancelada = objeto(dados.cancelada);
  const customerCode = texto(dados.customer_code);
  return {
    id,
    customerCode,
    cliente: texto(dados.customer_name) || customerCode,
    status: (STATUS_DA_FATURA as readonly string[]).includes(status) ? (status as StatusDaFatura) : "emitida",
    valorCents,
    recebidoCents,
    saldoCents: Math.max(0, valorCents - recebidoCents),
    nf: { numero, serie: texto(nf?.serie) || "1", emitidaEm: texto(nf?.emitida_em) },
    vencimento: texto(dados.vencimento),
    forma: (FORMAS_DE_PAGAMENTO as readonly string[]).includes(forma) ? (forma as FormaDePagamento) : "boleto",
    observacao: texto(dados.observacao) || null,
    demandas: (Array.isArray(dados.demandas) ? dados.demandas : []).flatMap((item) => {
      const demanda = objeto(item);
      const numeroDaDemanda = texto(demanda?.numero);
      if (!numeroDaDemanda) return [];
      const rv = demanda?.rv;
      const ids = Array.isArray(demanda?.autorizacao_ids) ? demanda.autorizacao_ids : [];
      return [
        {
          numero: numeroDaDemanda,
          valorCents: centavos(demanda?.valor_cents),
          rv: typeof rv === "number" && Number.isInteger(rv) ? rv : null,
          medicaoId: texto(demanda?.medicao_id) || null,
          autorizacaoIds: ids.filter((id): id is string => typeof id === "string" && id.length > 0),
        },
      ];
    }),
    enviada: enviada && (MEIOS_DE_ENVIO as readonly string[]).includes(meio) ? { em: texto(enviada.em), meio: meio as MeioDeEnvio } : null,
    pagaEm: texto(dados.paga_em) || null,
    cancelada: cancelada ? { em: texto(cancelada.em), motivo: texto(cancelada.motivo) } : null,
    pelaOmie: dados.origem_nf === "omie",
  };
}

/** "NF 1234"; com a série quando ela não é a 1: "NF 77 · série 2". */
export function rotuloDaNf(fatura: Pick<FaturaDoFinanceiro, "nf">): string {
  return fatura.nf.serie === "1" ? `NF ${fatura.nf.numero}` : `NF ${fatura.nf.numero} · série ${fatura.nf.serie}`;
}

export type SituacaoDaCobranca = "a_vencer" | "vencida" | "paga" | "cancelada";

export function situacaoDaCobranca(fatura: FaturaDoFinanceiro, hoje: string): SituacaoDaCobranca {
  if (fatura.status === "cancelada") return "cancelada";
  if (fatura.status === "paga" || fatura.saldoCents === 0) return "paga";
  return dataValida(fatura.vencimento) && fatura.vencimento < hoje ? "vencida" : "a_vencer";
}

/** "Vence hoje", "Vence em 5 dias", "Vencida há 3 dias", "Paga em 22/10/2026", "Cancelada". */
export function textoDaSituacao(fatura: FaturaDoFinanceiro, hoje: string): string {
  const situacao = situacaoDaCobranca(fatura, hoje);
  if (situacao === "cancelada") return "Cancelada";
  if (situacao === "paga") return fatura.pagaEm ? `Paga em ${dataBr(fatura.pagaEm)}` : "Paga";
  if (!dataValida(fatura.vencimento)) return "Sem vencimento";
  const dias = diasEntre(hoje, fatura.vencimento);
  if (situacao === "vencida") return dias === -1 ? "Vencida há 1 dia" : `Vencida há ${-dias} dias`;
  if (dias === 0) return "Vence hoje";
  return dias === 1 ? "Vence amanhã" : `Vence em ${dias} dias`;
}

// --- As listas -----------------------------------------------------------------------------

export const FILTROS_DE_FATURAS = ["a_receber", "vencidos", "pagos", "todas"] as const;
export type FiltroDeFaturas = (typeof FILTROS_DE_FATURAS)[number];

export const TITULO_DO_FILTRO: Record<FiltroDeFaturas, string> = {
  a_receber: "A receber",
  vencidos: "Vencidos",
  pagos: "Pagos",
  todas: "Faturas",
};

function semAcento(valor: string): string {
  return valor.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function noFiltro(fatura: FaturaDoFinanceiro, filtro: FiltroDeFaturas, hoje: string): boolean {
  const situacao = situacaoDaCobranca(fatura, hoje);
  if (filtro === "a_receber") return situacao === "a_vencer";
  if (filtro === "vencidos") return situacao === "vencida";
  if (filtro === "pagos") return situacao === "paga";
  return true;
}

/**
 * A lista do filtro, com a busca (NF, cliente ou demanda): a receber e
 * vencidos pelo vencimento, o mais perto (ou o mais atrasado) primeiro; pagos
 * pelo pagamento, o mais recente primeiro; todas pela emissão, a mais recente
 * primeiro.
 */
export function faturasDoFiltro(faturas: readonly FaturaDoFinanceiro[], filtro: FiltroDeFaturas, hoje: string, busca = ""): FaturaDoFinanceiro[] {
  const termo = semAcento(busca.trim());
  const lista = faturas.filter(
    (fatura) =>
      noFiltro(fatura, filtro, hoje) &&
      (!termo || [fatura.nf.numero, fatura.cliente, fatura.customerCode, ...fatura.demandas.map((demanda) => demanda.numero)].some((campo) => semAcento(campo).includes(termo))),
  );
  const desempate = (a: FaturaDoFinanceiro, b: FaturaDoFinanceiro) => a.cliente.localeCompare(b.cliente, "pt-BR") || a.nf.numero.localeCompare(b.nf.numero, "pt-BR", { numeric: true });
  if (filtro === "pagos") return lista.sort((a, b) => (b.pagaEm ?? "").localeCompare(a.pagaEm ?? "") || desempate(a, b));
  if (filtro === "todas") return lista.sort((a, b) => b.nf.emitidaEm.localeCompare(a.nf.emitidaEm) || desempate(a, b));
  return lista.sort((a, b) => a.vencimento.localeCompare(b.vencimento) || desempate(a, b));
}

/** Quanto a lista soma: o saldo nas que esperam pagamento, o valor nas pagas e em todas. */
export function totalDaLista(faturas: readonly FaturaDoFinanceiro[], filtro: FiltroDeFaturas): number {
  return faturas.reduce((soma, fatura) => soma + (filtro === "a_receber" || filtro === "vencidos" ? fatura.saldoCents : fatura.valorCents), 0);
}

export type NumerosDaCobranca = {
  aReceber: number;
  aReceberCents: number;
  vencidas: number;
  vencidoCents: number;
  paraEnviar: number;
};

export function numerosDaCobranca(faturas: readonly FaturaDoFinanceiro[], hoje: string): NumerosDaCobranca {
  const aVencer = faturas.filter((fatura) => situacaoDaCobranca(fatura, hoje) === "a_vencer");
  const vencidas = faturas.filter((fatura) => situacaoDaCobranca(fatura, hoje) === "vencida");
  return {
    aReceber: aVencer.length,
    aReceberCents: totalDaLista(aVencer, "a_receber"),
    vencidas: vencidas.length,
    vencidoCents: totalDaLista(vencidas, "vencidos"),
    paraEnviar: faturas.filter((fatura) => fatura.status === "emitida" && !fatura.enviada && situacaoDaCobranca(fatura, hoje) !== "paga").length,
  };
}

// --- Os pagamentos -------------------------------------------------------------------------

export type PagamentoDaNf = {
  id: string;
  faturaId: string;
  customerCode: string;
  valorCents: number;
  recebidoEm: string;
  forma: FormaDePagamento;
  observacao: string | null;
  estornado: { motivo: string } | null;
};

export function pagamentoDaNf(id: string, dados: Registro): PagamentoDaNf | null {
  const faturaId = texto(dados.fatura_id);
  if (!faturaId) return null;
  const forma = texto(dados.forma);
  const estornado = objeto(dados.estornado);
  return {
    id,
    faturaId,
    customerCode: texto(dados.customer_code),
    valorCents: centavos(dados.valor_cents),
    recebidoEm: texto(dados.recebido_em),
    forma: (FORMAS_DE_PAGAMENTO as readonly string[]).includes(forma) ? (forma as FormaDePagamento) : "boleto",
    observacao: texto(dados.observacao) || null,
    estornado: texto(dados.status) === "estornado" ? { motivo: texto(estornado?.motivo) } : null,
  };
}

/** Os pagamentos da NF, o mais antigo primeiro. */
export function pagamentosDaNf(pagamentos: readonly PagamentoDaNf[], faturaId: string): PagamentoDaNf[] {
  return pagamentos.filter((pagamento) => pagamento.faturaId === faturaId).sort((a, b) => a.recebidoEm.localeCompare(b.recebidoEm) || a.id.localeCompare(b.id));
}

/** "22/10/2026 · Pix". */
export function textoDoPagamento(pagamento: PagamentoDaNf): string {
  return `${dataBr(pagamento.recebidoEm)} · ${FORMA_ROTULO[pagamento.forma]}`;
}

// --- A planilha e a receita -----------------------------------------------------------------

export const CABECALHO_DA_PLANILHA = ["NF", "Série", "Cliente", "Emissão", "Vencimento", "Situação", "Valor", "Recebido", "Saldo", "Paga em", "Forma", "Enviada em", "Demandas"] as const;

/** As linhas da planilha da lista, na ordem da tela; valores em reais e datas de verdade. */
export function linhasDaPlanilha(faturas: readonly FaturaDoFinanceiro[], hoje: string): Celula[][] {
  return faturas.map((fatura) => [
    fatura.nf.numero,
    fatura.nf.serie,
    fatura.cliente,
    { data: fatura.nf.emitidaEm },
    { data: fatura.vencimento },
    textoDaSituacao(fatura, hoje),
    { reais: fatura.valorCents },
    { reais: fatura.recebidoCents },
    { reais: fatura.saldoCents },
    fatura.pagaEm ? { data: fatura.pagaEm } : null,
    FORMA_ROTULO[fatura.forma],
    fatura.enviada ? { data: fatura.enviada.em } : null,
    fatura.demandas.map((demanda) => demanda.numero).join(", "),
  ]);
}

const ARQUIVO_DO_FILTRO: Record<FiltroDeFaturas, string> = { a_receber: "a-receber", vencidos: "vencidos", pagos: "pagos", todas: "faturas" };

/** "financeiro-vencidos-2026-10-23.xlsx". */
export function nomeDaPlanilha(filtro: FiltroDeFaturas, hoje: string): string {
  return `financeiro-${ARQUIVO_DO_FILTRO[filtro]}-${hoje}.xlsx`;
}

/** O mês da tela ("2026-10") e o intervalo de dias dele, para a consulta dos pagamentos. */
export function diasDoMes(mes: string): { de: string; ate: string } | null {
  const partes = /^(\d{4})-(\d{2})$/.exec(mes);
  if (!partes) return null;
  const numero = Number(partes[2]);
  if (numero < 1 || numero > 12) return null;
  const ultimo = new Date(Date.UTC(Number(partes[1]), numero, 0)).getUTCDate();
  return { de: `${mes}-01`, ate: `${mes}-${String(ultimo).padStart(2, "0")}` };
}

const NOME_DO_MES = new Intl.DateTimeFormat("pt-BR", { month: "long", timeZone: "UTC" });

/** "outubro de 2026". */
export function rotuloDoMes(mes: string): string {
  const dias = diasDoMes(mes);
  if (!dias) return mes;
  return `${NOME_DO_MES.format(new Date(`${dias.de}T12:00:00Z`))} de ${mes.slice(0, 4)}`;
}

export type ReceitaPorCliente = {
  linhas: Array<{ customerCode: string; cliente: string; cents: number }>;
  /** Os clientes além dos primeiros, somados. */
  outros: { clientes: number; cents: number } | null;
  totalCents: number;
  pagamentos: number;
};

/**
 * O recebido no mês por cliente: os pagamentos registrados (não os
 * estornados), do maior para o menor; depois dos primeiros, "Outros".
 */
export function receitaPorCliente(pagamentos: readonly PagamentoDaNf[], nomes: ReadonlyMap<string, string>, mostrar = 4): ReceitaPorCliente {
  const validos = pagamentos.filter((pagamento) => !pagamento.estornado);
  const porCliente = new Map<string, number>();
  for (const pagamento of validos) porCliente.set(pagamento.customerCode, (porCliente.get(pagamento.customerCode) ?? 0) + pagamento.valorCents);
  const ordenadas = [...porCliente.entries()]
    .map(([customerCode, cents]) => ({ customerCode, cliente: nomes.get(customerCode) ?? customerCode, cents }))
    .sort((a, b) => b.cents - a.cents || a.cliente.localeCompare(b.cliente, "pt-BR"));
  const cabem = ordenadas.length > mostrar + 1 ? ordenadas.slice(0, mostrar) : ordenadas;
  const resto = ordenadas.slice(cabem.length);
  return {
    linhas: cabem,
    outros: resto.length ? { clientes: resto.length, cents: resto.reduce((soma, linha) => soma + linha.cents, 0) } : null,
    totalCents: ordenadas.reduce((soma, linha) => soma + linha.cents, 0),
    pagamentos: validos.length,
  };
}

/** O nome de cada cliente, das NFs lidas. */
export function nomesDosClientes(faturas: readonly FaturaDoFinanceiro[]): Map<string, string> {
  return new Map(faturas.map((fatura) => [fatura.customerCode, fatura.cliente]));
}

// --- Os formulários ------------------------------------------------------------------------

/** O saldo como a pessoa digitaria ("9.845,00"). */
function valorEmTexto(centavosDoValor: number): string {
  return formatarReais(centavosDoValor).replace(/^R\$\s?/, "").replace(/ /g, "");
}

export type FormDoPagamento = { valor: string; recebidoEm: string; forma: FormaDePagamento; observacao: string };

export function formDoPagamento(fatura: FaturaDoFinanceiro, hoje: string): FormDoPagamento {
  return { valor: valorEmTexto(fatura.saldoCents), recebidoEm: hoje, forma: fatura.forma, observacao: "" };
}

export function problemasDoPagamento(form: FormDoPagamento, fatura: FaturaDoFinanceiro, hoje: string): string[] {
  const problemas: string[] = [];
  const decimal = valorDaTela(form.valor);
  const valor = decimal === null ? null : centavosDaLinha("1", decimal);
  if (valor === null || valor <= 0) problemas.push("Informe o valor recebido.");
  else if (valor > fatura.saldoCents) problemas.push(`O pagamento passa do saldo, de ${formatarReais(fatura.saldoCents)}.`);
  if (!dataValida(form.recebidoEm)) problemas.push("Informe a data do pagamento.");
  else if (form.recebidoEm > hoje) problemas.push("A data do pagamento ainda não chegou.");
  else if (fatura.nf.emitidaEm && form.recebidoEm < fatura.nf.emitidaEm) problemas.push("A data do pagamento vem antes da emissão da NF.");
  if (form.observacao.trim().length > 300) problemas.push("Use até 300 caracteres na observação.");
  return problemas;
}

export function pedidoDoPagamento(form: FormDoPagamento, fatura: FaturaDoFinanceiro, chave: string): Record<string, unknown> {
  return {
    acao: "pay",
    idempotency_key: chave,
    fatura_id: fatura.id,
    valor: valorDaTela(form.valor),
    recebido_em: form.recebidoEm,
    forma: form.forma,
    ...(form.observacao.trim() ? { observacao: form.observacao.trim() } : {}),
  };
}

export type FormDoEnvio = { enviadaEm: string; meio: MeioDeEnvio };

export function formDoEnvio(hoje: string): FormDoEnvio {
  return { enviadaEm: hoje, meio: "email" };
}

export function problemasDoEnvio(form: FormDoEnvio, fatura: FaturaDoFinanceiro, hoje: string): string[] {
  if (!dataValida(form.enviadaEm)) return ["Informe a data do envio."];
  if (form.enviadaEm > hoje) return ["A data do envio ainda não chegou."];
  if (fatura.nf.emitidaEm && form.enviadaEm < fatura.nf.emitidaEm) return ["A data do envio vem antes da emissão da NF."];
  return [];
}

export function pedidoDoEnvio(form: FormDoEnvio, fatura: FaturaDoFinanceiro, chave: string): Record<string, unknown> {
  return { acao: "send", idempotency_key: chave, fatura_id: fatura.id, enviada_em: form.enviadaEm, meio: form.meio };
}

export function problemasDoMotivo(motivo: string): string[] {
  const limpo = motivo.trim();
  if (limpo.length < 5) return ["Conte o motivo em ao menos 5 caracteres."];
  return limpo.length > 300 ? ["Use até 300 caracteres no motivo."] : [];
}

export function pedidoDoEstorno(fatura: FaturaDoFinanceiro, pagamentoId: string, motivo: string, chave: string): Record<string, unknown> {
  return { acao: "reverse_payment", idempotency_key: chave, fatura_id: fatura.id, pagamento_id: pagamentoId, motivo: motivo.trim() };
}

export function pedidoDoCancelamento(fatura: FaturaDoFinanceiro, motivo: string, chave: string): Record<string, unknown> {
  return { acao: "cancel", idempotency_key: chave, fatura_id: fatura.id, motivo: motivo.trim() };
}

/** O que a NF ainda aceita no painel. */
export function acoesDaNf(fatura: FaturaDoFinanceiro): { enviar: boolean; pagar: boolean; cancelar: boolean } {
  const aberta = fatura.status !== "cancelada" && fatura.status !== "paga" && fatura.saldoCents > 0;
  return {
    enviar: aberta && fatura.status === "emitida" && !fatura.enviada,
    pagar: aberta,
    // O registro que nasceu da NFS-e autorizada pela Omie não se cancela aqui (o servidor recusa).
    cancelar: fatura.status !== "cancelada" && fatura.recebidoCents === 0 && !fatura.pelaOmie,
  };
}

// --- O Início ------------------------------------------------------------------------------

function previa(valores: readonly string[], max = 2): string {
  const unicos = [...new Set(valores)];
  const mostrados = unicos.slice(0, max).join(" · ");
  return unicos.length > max ? `${mostrados} e mais ${unicos.length - max}` : mostrados;
}

function plural(quantos: number, singular: string, pluralForm: string) {
  return `${quantos} ${quantos === 1 ? singular : pluralForm}`;
}

export type RotasDaCobranca = { vencidos: string; aReceber: string };

/** O que a cobrança pede no Início: as vencidas (crítico) e as NFs ainda não enviadas ao cliente. */
export function pendenciasDaCobranca(faturas: readonly FaturaDoFinanceiro[], hoje: string, rotas: RotasDaCobranca): { criticos: ItemDoInicio[]; outros: ItemDoInicio[] } {
  const vencidas = faturas.filter((fatura) => situacaoDaCobranca(fatura, hoje) === "vencida");
  const paraEnviar = faturas.filter((fatura) => fatura.status === "emitida" && !fatura.enviada && situacaoDaCobranca(fatura, hoje) === "a_vencer");
  const criticos: ItemDoInicio[] = vencidas.length
    ? [
        {
          id: "financeiro-vencidas",
          tone: "critical",
          icon: AlarmClock,
          title: `${plural(vencidas.length, "NF vencida", "NFs vencidas")}`,
          detail: [previa(vencidas.map((fatura) => fatura.cliente)), formatarReais(totalDaLista(vencidas, "vencidos"))].join(" · "),
          href: rotas.vencidos,
          actionLabel: "Cobrar",
        },
      ]
    : [];
  const outros: ItemDoInicio[] = paraEnviar.length
    ? [
        {
          id: "financeiro-para-enviar",
          tone: "attention",
          icon: Send,
          title: `${plural(paraEnviar.length, "NF para enviar", "NFs para enviar")} ao cliente`,
          detail: previa(paraEnviar.map((fatura) => fatura.cliente)),
          href: rotas.aReceber,
          actionLabel: "Enviar",
        },
      ]
    : [];
  return { criticos, outros };
}
