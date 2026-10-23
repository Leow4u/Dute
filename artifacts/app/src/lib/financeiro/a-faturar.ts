import { MESES_PAGAMENTO, TIPOS_PAGAMENTO, dataValida, formatarReais, pagamentoPrevisto, type ContratoParaPagamento, type FaixaPagamento } from "@workspace/dominio";
import { ClipboardCheck, FileText, Hourglass } from "lucide-react";

import { rotuloDaRv } from "../comercial/autorizacoes";
import type { ItemDoInicio } from "../inicio-do-modulo";

/**
 * A fila A faturar do Financeiro (docs/plataforma/fase-4-financeiro.md,
 * parte 4.1b): as demandas A faturar e as que esperam (autorização ou
 * medição), o valor de cada uma e o formulário da NF. O valor aqui é para
 * ler e conferir: o servidor (registerNf) lê de novo e decide. A regra é a
 * mesma: a RV validada (que as autorizações citam) ou, na medição mensal, a
 * soma das linhas da demanda na medição aprovada.
 */

type Registro = Record<string, unknown>;

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

function inteiro(valor: unknown): number | null {
  return typeof valor === "number" && Number.isInteger(valor) ? valor : null;
}

/** Os tipos de autorização que o contrato exige antes de faturar (functions/financeiro, AUTORIZACOES_EXIGIDAS). */
export const AUTORIZACOES_EXIGIDAS = ["pedido_aceite", "portal", "medicao_aprovada"] as const;

export type DemandaDoFinanceiro = {
  numero: string;
  customerCode: string;
  cliente: string;
  titulo: string | null;
  etapa: "a_faturar" | "aguardando_autorizacao";
  /** Desde quando está na etapa (ISO). */
  desde: string | null;
  contratoId: string | null;
  rv: number | null;
  /** O tipo de autorização que o contrato pede (o que a validação guardou). */
  autorizacao: string | null;
  medicaoId: string | null;
  medicaoPendente: boolean;
  autorizacaoIds: string[];
};

/** As etapas que a fila lê: A faturar e as que esperam a autorização. */
export const ETAPAS_DA_FILA = ["a_faturar", "aguardando_autorizacao"] as const;

/** A demanda como o Financeiro lê de `demands`; só as etapas da fila. */
export function demandaDoFinanceiro(id: string, dados: Registro): DemandaDoFinanceiro | null {
  const etapa = texto(dados.etapa);
  if (etapa !== "a_faturar" && etapa !== "aguardando_autorizacao") return null;
  const validacao = dados.validacao && typeof dados.validacao === "object" ? (dados.validacao as Registro) : {};
  const ids = Array.isArray(dados.autorizacao_ids) ? dados.autorizacao_ids : [];
  const antigo = typeof dados.autorizacao_id === "string" ? [dados.autorizacao_id] : [];
  const customerCode = texto(dados.customer_code);
  return {
    numero: id,
    customerCode,
    cliente: texto(dados.customer_name) || customerCode,
    titulo: texto(dados.titulo) || null,
    etapa,
    desde: texto(dados.etapa_desde) || null,
    contratoId: texto(dados.contrato_id) || null,
    rv: inteiro(validacao.rv),
    autorizacao: texto(validacao.autorizacao) || null,
    medicaoId: texto(validacao.medicao_id) || texto(dados.medicao_id) || null,
    medicaoPendente: dados.medicao_pendente === true,
    autorizacaoIds: [...new Set([...ids, ...antigo].filter((item): item is string => typeof item === "string" && item.length > 0))],
  };
}

export type AutorizacaoDoFinanceiro = {
  id: string;
  customerCode: string;
  registrada: boolean;
  tipo: string;
  pedido: string | null;
  aceite: string | null;
  /** A RV que a autorização cita para cada demanda. */
  rvs: ReadonlyMap<string, number>;
};

export function autorizacaoDoFinanceiro(id: string, dados: Registro): AutorizacaoDoFinanceiro {
  const status = texto(dados.status);
  const rvs = new Map<string, number>();
  for (const item of Array.isArray(dados.demandas) ? dados.demandas : []) {
    if (!item || typeof item !== "object") continue;
    const numero = texto((item as Registro).numero);
    const rv = inteiro((item as Registro).rv);
    if (numero && rv !== null) rvs.set(numero, rv);
  }
  return {
    id,
    customerCode: texto(dados.customer_code),
    registrada: status === "registrada" || status === "a_faturar",
    tipo: texto(dados.tipo),
    pedido: texto(dados.pedido) || null,
    aceite: texto(dados.aceite) || null,
    rvs,
  };
}

/** As autorizações que valem para a demanda: registradas e do mesmo cliente (como registerNf). */
export function autorizacoesValidas(demanda: DemandaDoFinanceiro, autorizacoes: ReadonlyMap<string, AutorizacaoDoFinanceiro>): AutorizacaoDoFinanceiro[] {
  return demanda.autorizacaoIds.flatMap((id) => {
    const autorizacao = autorizacoes.get(id);
    return autorizacao?.registrada && autorizacao.customerCode === demanda.customerCode ? [autorizacao] : [];
  });
}

/** O valor da demanda em centavos: a soma das linhas dela na medição aprovada, ou null. */
export function valorNaMedicao(numero: string, medicao: Registro | null | undefined): number | null {
  if (!medicao || texto(medicao.status) !== "aprovada") return null;
  const linhas = (Array.isArray(medicao.linhas) ? medicao.linhas : []).filter(
    (linha): linha is Registro => Boolean(linha) && typeof linha === "object" && texto((linha as Registro).demanda_numero) === numero,
  );
  if (!linhas.length) return null;
  let soma = 0;
  for (const linha of linhas) {
    const total = inteiro(linha.total_cents);
    if (total === null || total < 0) return null;
    soma += total;
  }
  return soma;
}

/** O total da RV validada em centavos, ou null. */
export function valorDaRv(revisao: Registro | null | undefined): number | null {
  const total = inteiro(revisao?.total_cents);
  return total !== null && total >= 0 ? total : null;
}

// --- A fila -------------------------------------------------------------------------------

export type SituacaoNaFila = "pronta" | "aguardando_autorizacao" | "medicao_pendente" | "sem_autorizacao" | "rv_diferente" | "sem_valor";

export const SITUACAO_ROTULO: Record<Exclude<SituacaoNaFila, "pronta">, string> = {
  aguardando_autorizacao: "Aguardando autorização",
  medicao_pendente: "Medição pendente",
  sem_autorizacao: "Sem autorização registrada",
  rv_diferente: "A autorização cita outra RV",
  sem_valor: "Sem o valor para faturar",
};

export type LinhaAFaturar = {
  demanda: DemandaDoFinanceiro;
  situacao: SituacaoNaFila;
  valorCents: number | null;
  /** "RV 2" ou "Medição 10/2026". */
  origem: string;
  /** "Pedido 4500000009 · aceite ACE-1", "Medição aprovada", "Sem exigência de autorização". */
  autorizacaoTexto: string;
};

function textoDaAutorizacao(demanda: DemandaDoFinanceiro, validas: readonly AutorizacaoDoFinanceiro[]): string {
  const comPedido = validas.find((item) => item.pedido);
  if (comPedido) return [`Pedido ${comPedido.pedido}`, comPedido.aceite ? `aceite ${comPedido.aceite}` : null].filter(Boolean).join(" · ");
  if (validas.length) return demanda.medicaoId ? "Medição aprovada" : "Autorização registrada";
  return exigeAutorizacao(demanda) ? "Sem autorização registrada" : "Sem exigência de autorização";
}

/** "Medição 10/2026" pela competência no fim do id da medição (`{contrato}_{AAAA-MM}`), ou "Medição". */
function rotuloDaMedicao(medicaoId: string): string {
  const competencia = /_(\d{4})-(\d{2})$/.exec(medicaoId);
  return competencia ? `Medição ${competencia[2]}/${competencia[1]}` : "Medição";
}

function exigeAutorizacao(demanda: DemandaDoFinanceiro): boolean {
  return (AUTORIZACOES_EXIGIDAS as readonly string[]).includes(demanda.autorizacao ?? "");
}

/** Uma autorização válida cita outra RV da demanda (registerNf recusa). */
function citaOutraRv(demanda: DemandaDoFinanceiro, validas: readonly AutorizacaoDoFinanceiro[]): boolean {
  if (demanda.medicaoId || demanda.rv === null) return false;
  return validas.some((autorizacao) => {
    const citada = autorizacao.rvs.get(demanda.numero);
    return citada !== undefined && citada !== demanda.rv;
  });
}

/**
 * A linha da fila e por que ela ainda não fatura, na ordem em que o
 * servidor confere: etapa, medição, autorização, RV citada e valor.
 */
export function linhaAFaturar(
  demanda: DemandaDoFinanceiro,
  autorizacoes: ReadonlyMap<string, AutorizacaoDoFinanceiro>,
  valorCents: number | null,
): LinhaAFaturar {
  const validas = autorizacoesValidas(demanda, autorizacoes);
  const situacao: SituacaoNaFila =
    demanda.etapa === "aguardando_autorizacao"
      ? "aguardando_autorizacao"
      : demanda.medicaoPendente
        ? "medicao_pendente"
        : exigeAutorizacao(demanda) && validas.length === 0
          ? "sem_autorizacao"
          : citaOutraRv(demanda, validas)
            ? "rv_diferente"
            : valorCents === null
              ? "sem_valor"
              : "pronta";
  return {
    demanda,
    situacao,
    valorCents,
    origem: demanda.medicaoId ? rotuloDaMedicao(demanda.medicaoId) : demanda.rv !== null ? `RV ${demanda.rv}` : "Sem RV validada",
    autorizacaoTexto: textoDaAutorizacao(demanda, validas),
  };
}

/** De onde sai o valor da demanda: a RV validada ou a medição aprovada. O caminho do documento, ou null. */
export function fonteDoValor(demanda: DemandaDoFinanceiro): string | null {
  if (demanda.medicaoId) return `medicoes/${demanda.medicaoId}`;
  if (demanda.rv !== null) return `quotes/${demanda.numero}/revisoes/${demanda.rv}`;
  return null;
}

/** O valor da demanda a partir do documento da fonte (fonteDoValor). */
export function valorDaFonte(demanda: DemandaDoFinanceiro, documento: Registro | null | undefined): number | null {
  if (!documento) return null;
  return demanda.medicaoId ? valorNaMedicao(demanda.numero, documento) : valorDaRv(documento);
}

/** "10045 – RV02" como o cliente cita; na medição, só o número. */
export function rotuloDaLinha(linha: LinhaAFaturar): string {
  return linha.demanda.medicaoId ? linha.demanda.numero : rotuloDaRv(linha.demanda.numero, linha.demanda.rv);
}

function semAcento(valor: string): string {
  return valor.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/** A busca da tela: número, cliente, título, pedido ou aceite. */
export function filtrarLinhas(linhas: readonly LinhaAFaturar[], busca: string): LinhaAFaturar[] {
  const termo = semAcento(busca.trim());
  if (!termo) return [...linhas];
  return linhas.filter((linha) =>
    [linha.demanda.numero, linha.demanda.cliente, linha.demanda.titulo ?? "", linha.autorizacaoTexto].some((campo) => semAcento(campo).includes(termo)),
  );
}

/** Dias inteiros na etapa até agora, ou null sem a data. */
export function diasNaEtapa(linha: LinhaAFaturar, agora: Date): number | null {
  const desde = linha.demanda.desde ? Date.parse(linha.demanda.desde) : Number.NaN;
  if (Number.isNaN(desde)) return null;
  return Math.max(0, Math.floor((agora.getTime() - desde) / 86_400_000));
}

export type GrupoDaFila = { customerCode: string; cliente: string; linhas: LinhaAFaturar[]; totalCents: number };

/** Por cliente, em ordem alfabética; dentro do cliente, a mais antiga primeiro. */
export function gruposPorCliente(linhas: readonly LinhaAFaturar[]): GrupoDaFila[] {
  const grupos = new Map<string, GrupoDaFila>();
  for (const linha of linhas) {
    const atual = grupos.get(linha.demanda.customerCode) ?? { customerCode: linha.demanda.customerCode, cliente: linha.demanda.cliente, linhas: [], totalCents: 0 };
    atual.linhas.push(linha);
    atual.totalCents += linha.valorCents ?? 0;
    grupos.set(linha.demanda.customerCode, atual);
  }
  return [...grupos.values()]
    .map((grupo) => ({ ...grupo, linhas: [...grupo.linhas].sort((a, b) => (a.demanda.desde ?? "").localeCompare(b.demanda.desde ?? "") || a.demanda.numero.localeCompare(b.demanda.numero)) }))
    .sort((a, b) => a.cliente.localeCompare(b.cliente, "pt-BR"));
}

/** A demanda entra na NF quando está pronta e é do mesmo cliente das já marcadas. */
export function podeMarcarNaNf(linha: LinhaAFaturar, marcadas: readonly LinhaAFaturar[]): boolean {
  if (linha.situacao !== "pronta") return false;
  return marcadas.length === 0 || marcadas[0].demanda.customerCode === linha.demanda.customerCode;
}

// --- A NF ---------------------------------------------------------------------------------

export const FORMAS_DE_PAGAMENTO = ["boleto", "pix", "transferencia", "cartao", "dinheiro"] as const;
export type FormaDePagamento = (typeof FORMAS_DE_PAGAMENTO)[number];
export const FORMA_ROTULO: Record<FormaDePagamento, string> = {
  boleto: "Boleto",
  pix: "Pix",
  transferencia: "Transferência",
  cartao: "Cartão",
  dinheiro: "Dinheiro",
};

export type FormDaNf = { numero: string; serie: string; emissao: string; vencimento: string; forma: FormaDePagamento; observacao: string };

/** A regra de pagamento do contrato como o Financeiro lê de `contracts`. */
export type PagamentoDoContrato = ContratoParaPagamento["pagamento"];

function faixaLida(faixa: unknown): FaixaPagamento | null {
  if (!faixa || typeof faixa !== "object") return null;
  const item = faixa as Registro;
  const [de, ate, dia] = [inteiro(item.de), inteiro(item.ate), inteiro(item.dia)];
  const mes = (MESES_PAGAMENTO as readonly string[]).includes(texto(item.mes)) ? (texto(item.mes) as FaixaPagamento["mes"]) : null;
  return de !== null && ate !== null && dia !== null && mes ? { de, ate, dia, mes } : null;
}

export function pagamentoDoContrato(dados: Registro | null | undefined): PagamentoDoContrato | null {
  const regra = dados?.pagamento;
  if (!regra || typeof regra !== "object") return null;
  const bruto = regra as Registro;
  const tipo = texto(bruto.tipo);
  if (!(TIPOS_PAGAMENTO as readonly string[]).includes(tipo)) return null;
  const faixas = (Array.isArray(bruto.faixas) ? bruto.faixas : []).map(faixaLida).filter((faixa): faixa is FaixaPagamento => faixa !== null);
  return { tipo: tipo as PagamentoDoContrato["tipo"], dias: inteiro(bruto.dias), faixas, texto: texto(bruto.texto) || null };
}

/** O vencimento pela regra do contrato (dias depois da NF ou faixas do dia), ou vazio. */
export function vencimentoPeloContrato(pagamento: PagamentoDoContrato | null, emissao: string): string {
  if (!pagamento || !dataValida(emissao)) return "";
  return pagamentoPrevisto({ pagamento }, emissao) ?? "";
}

export function formInicial(hoje: string, pagamento: PagamentoDoContrato | null): FormDaNf {
  return { numero: "", serie: "1", emissao: hoje, vencimento: vencimentoPeloContrato(pagamento, hoje), forma: "boleto", observacao: "" };
}

/** O vencimento segue a regra do contrato até a pessoa mexer nele; sem regra calculável, fica o digitado. */
export function formComVencimento(form: FormDaNf, editado: boolean, pagamento: PagamentoDoContrato | null): FormDaNf {
  if (editado) return form;
  const sugerido = vencimentoPeloContrato(pagamento, form.emissao);
  return sugerido ? { ...form, vencimento: sugerido } : form;
}

/** O que impede registrar a NF, na ordem do formulário. O servidor confere de novo. */
export function problemasDaNf(form: FormDaNf, marcadas: readonly LinhaAFaturar[], hoje: string): string[] {
  const problemas: string[] = [];
  if (!marcadas.length) problemas.push("Marque ao menos uma demanda.");
  if (!/^\d{1,15}$/.test(form.numero.trim())) problemas.push("Informe o número da NF, só dígitos.");
  if (!/^[A-Za-z0-9]{1,5}$/.test(form.serie.trim())) problemas.push("Informe a série da NF.");
  if (!dataValida(form.emissao)) problemas.push("Informe a data de emissão.");
  else if (form.emissao > hoje) problemas.push("A data de emissão ainda não chegou.");
  if (!dataValida(form.vencimento)) problemas.push("Informe o vencimento.");
  else if (dataValida(form.emissao) && form.vencimento < form.emissao) problemas.push("O vencimento vem depois da emissão.");
  if (form.observacao.trim().length > 300) problemas.push("Use até 300 caracteres na observação.");
  return problemas;
}

/** O pedido para `registerNf`. Sem valor: o servidor calcula. */
export function pedidoDaNf(form: FormDaNf, marcadas: readonly LinhaAFaturar[], chave: string): Record<string, unknown> {
  return {
    idempotency_key: chave,
    demandas: marcadas.map((linha) => linha.demanda.numero),
    nf: { numero: form.numero.trim(), serie: form.serie.trim().toUpperCase(), emitida_em: form.emissao },
    vencimento: form.vencimento,
    forma: form.forma,
    ...(form.observacao.trim() ? { observacao: form.observacao.trim() } : {}),
  };
}

/** A confirmação depois de registerNf: a NF, quantas demandas e o total que o servidor calculou. */
export function textoDoRegistro(form: FormDaNf, resultado: { valor_cents?: unknown; demandas?: unknown }): string {
  const quantas = Array.isArray(resultado.demandas) ? resultado.demandas.length : 0;
  const valor = typeof resultado.valor_cents === "number" ? ` · ${formatarReais(resultado.valor_cents)}` : "";
  return `NF ${form.numero.trim()} registrada: ${plural(quantas, "demanda faturada", "demandas faturadas")}${valor}`;
}

export function totalDasMarcadas(marcadas: readonly LinhaAFaturar[]): number {
  return marcadas.reduce((soma, linha) => soma + (linha.valorCents ?? 0), 0);
}

// --- O Início -----------------------------------------------------------------------------

/** Os números da fila para o Início: as prontas (e o total delas), as que esperam autorização e as sem valor. */
export type NumerosDaFila = { prontas: number; prontasCents: number; aguardando: number; semValor: number };

const ESPERAM_AUTORIZACAO: readonly SituacaoNaFila[] = ["aguardando_autorizacao", "sem_autorizacao", "rv_diferente"];
const SEM_VALOR: readonly SituacaoNaFila[] = ["medicao_pendente", "sem_valor"];

export function numerosDaFila(linhas: readonly LinhaAFaturar[]): NumerosDaFila {
  const prontas = linhas.filter((linha) => linha.situacao === "pronta");
  return {
    prontas: prontas.length,
    prontasCents: totalDasMarcadas(prontas),
    aguardando: linhas.filter((linha) => ESPERAM_AUTORIZACAO.includes(linha.situacao)).length,
    semValor: linhas.filter((linha) => SEM_VALOR.includes(linha.situacao)).length,
  };
}

/** Quantos dias A faturar deixam o item crítico no Início. */
export const DIAS_PARA_FATURAR = 15;

function previa(valores: readonly string[], max = 2): string {
  const unicos = [...new Set(valores)];
  const mostrados = unicos.slice(0, max).join(" · ");
  return unicos.length > max ? `${mostrados} e mais ${unicos.length - max}` : mostrados;
}

function plural(quantos: number, singular: string, pluralForm: string) {
  return `${quantos} ${quantos === 1 ? singular : pluralForm}`;
}

/** O "Precisa de você" do Financeiro: a faturar (crítico depois de DIAS_PARA_FATURAR) e o que espera. */
export function pendenciasDoFinanceiro(linhas: readonly LinhaAFaturar[], agora: Date, rota: string): ItemDoInicio[] {
  const prontas = linhas.filter((linha) => linha.situacao === "pronta");
  const itens: ItemDoInicio[] = [];
  if (prontas.length) {
    const antiga = prontas.some((linha) => linha.demanda.desde && agora.getTime() - Date.parse(linha.demanda.desde) > DIAS_PARA_FATURAR * 86_400_000);
    itens.push({
      id: "financeiro-a-faturar",
      tone: antiga ? "critical" : "attention",
      icon: FileText,
      title: `${plural(prontas.length, "demanda", "demandas")} a faturar`,
      detail: [previa(prontas.map((linha) => linha.demanda.cliente)), formatarReais(totalDasMarcadas(prontas))].join(" · "),
      href: rota,
      actionLabel: "Faturar",
    });
  }
  const aguardando = linhas.filter((linha) => ESPERAM_AUTORIZACAO.includes(linha.situacao));
  if (aguardando.length) {
    itens.push({
      id: "financeiro-aguardando",
      tone: "info",
      icon: ClipboardCheck,
      title: `${plural(aguardando.length, "demanda", "demandas")} aguardando autorização`,
      detail: previa(aguardando.map((linha) => linha.demanda.cliente)),
      href: rota,
      actionLabel: "Ver",
    });
  }
  const medicao = linhas.filter((linha) => SEM_VALOR.includes(linha.situacao));
  if (medicao.length) {
    itens.push({
      id: "financeiro-medicao",
      tone: "info",
      icon: Hourglass,
      title: `${plural(medicao.length, "demanda", "demandas")} sem valor para faturar`,
      detail: previa(medicao.map((linha) => linha.demanda.cliente)),
      href: rota,
      actionLabel: "Ver",
    });
  }
  return itens;
}
