/**
 * Datas do contrato: alertas (fim da vigência, renovação, reajuste) e a
 * previsão de pagamento pela regra do contrato (docs/plataforma/fase-6-comercial.md,
 * parte 8).
 *
 * Funções puras, sem Firestore nem zod. O app não importa de
 * functions/comercial: quando a tela de contratos e o Início (parte 14)
 * precisarem destas regras, elas vão para lib/dominio com um JSON de casos e
 * ficam aqui como cópia travada por teste, como o dinheiro
 * (lib/dominio/src/dinheiro.ts). Toda data é texto "AAAA-MM-DD", sem fuso: o
 * dia do calendário, como está no contrato e na NF.
 */

export const TIPOS_RENOVACAO = ["aditivo", "automatica", "novo_documento", "indeterminado"] as const;
export type TipoRenovacao = (typeof TIPOS_RENOVACAO)[number];

export const TIPOS_REAJUSTE = ["negociado", "indice", "nenhum"] as const;
export type TipoReajuste = (typeof TIPOS_REAJUSTE)[number];

export const TIPOS_PAGAMENTO = ["faixas_do_dia_da_nf", "dias_apos_nf", "texto"] as const;
export type TipoPagamento = (typeof TIPOS_PAGAMENTO)[number];

export const MESES_PAGAMENTO = ["mesmo", "seguinte"] as const;
export type MesPagamento = (typeof MESES_PAGAMENTO)[number];

export const STATUS_CONTRATO = ["vigente", "encerrado"] as const;
export type StatusContrato = (typeof STATUS_CONTRATO)[number];

export const TIPOS_ALERTA = ["fim_vigencia", "renovacao", "reajuste"] as const;
export type TipoAlerta = (typeof TIPOS_ALERTA)[number];

/** Dias antes da data em que o aviso aparece e muda de nível. */
export const MARCOS_DE_AVISO = [120, 90, 30] as const;

/** Depois da data, o reajuste por índice continua aparecendo (vencido) por estes dias; depois vale o do ano seguinte. */
export const REAJUSTE_VENCIDO_DIAS = 30;

/**
 * Alerta de um contrato. `dias` é quanto falta a partir de hoje (negativo
 * quando a data já passou). `marco` é o menor marco alcançado: 120, 90 ou 30
 * dias antes, ou 0 quando a data já passou.
 */
export type AlertaContrato = {
  tipo: TipoAlerta;
  data: string;
  dias: number;
  marco: 120 | 90 | 30 | 0;
};

export type ContratoParaAlertas = {
  status: StatusContrato;
  vigente_de: string;
  /** null: prazo indeterminado. */
  vigente_ate: string | null;
  renovacao: { tipo: TipoRenovacao; aviso_dias: number | null; oposicao_ate_dias: number | null };
  reajuste: { tipo: TipoReajuste; indice: string | null; data_base: string | null };
};

export type FaixaPagamento = { de: number; ate: number; dia: number; mes: MesPagamento };

export type ContratoParaPagamento = {
  pagamento: { tipo: TipoPagamento; faixas: FaixaPagamento[]; dias: number | null; texto: string | null };
};

// --- Datas ---------------------------------------------------------------------

const DATA = /^(\d{4})-(\d{2})-(\d{2})$/;
const MES_DIA = /^(\d{2})-(\d{2})$/;
const DIA_MS = 86_400_000;

export function ultimoDiaDoMes(ano: number, mes: number): number {
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate();
}

/** "AAAA-MM-DD" de um dia que existe no calendário. */
export function dataValida(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = DATA.exec(value);
  if (!match) return false;
  const [ano, mes, dia] = match.slice(1).map(Number);
  return ano >= 1900 && ano <= 2999 && mes >= 1 && mes <= 12 && dia >= 1 && dia <= ultimoDiaDoMes(ano, mes);
}

/** "MM-DD" de um dia que existe em algum ano (29/02 vale). */
export function mesDiaValido(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = MES_DIA.exec(value);
  if (!match) return false;
  const [mes, dia] = match.slice(1).map(Number);
  return mes >= 1 && mes <= 12 && dia >= 1 && dia <= ultimoDiaDoMes(2000, mes);
}

function partes(data: string): [number, number, number] {
  if (!dataValida(data)) throw new Error(`Data inválida: "${data}" (AAAA-MM-DD).`);
  const [ano, mes, dia] = data.split("-").map(Number);
  return [ano, mes, dia];
}

function comoDias(data: string): number {
  const [ano, mes, dia] = partes(data);
  return Date.UTC(ano, mes - 1, dia) / DIA_MS;
}

function deDias(dias: number): string {
  return new Date(dias * DIA_MS).toISOString().slice(0, 10);
}

/** Data de um dia do mês, trazida para o último dia quando o mês é mais curto. */
function dataNoMes(ano: number, mes: number, dia: number): string {
  const ajustado = Math.min(dia, ultimoDiaDoMes(ano, mes));
  return `${String(ano).padStart(4, "0")}-${String(mes).padStart(2, "0")}-${String(ajustado).padStart(2, "0")}`;
}

/** Dias de `de` até `ate` (negativo quando `ate` vem antes). */
export function diasEntre(de: string, ate: string): number {
  return comoDias(ate) - comoDias(de);
}

export function somarDias(data: string, dias: number): string {
  return deDias(comoDias(data) + dias);
}

// --- Alertas -------------------------------------------------------------------

function marcoDoAviso(dias: number): AlertaContrato["marco"] | null {
  if (dias < 0) return 0;
  for (const marco of [...MARCOS_DE_AVISO].reverse()) {
    if (dias <= marco) return marco;
  }
  return null;
}

/**
 * Prazo da renovação: na automática, o último dia para a oposição (fim menos
 * `oposicao_ate_dias`); nas outras, o aviso do contrato (fim menos
 * `aviso_dias`). Sem prazo antes do fim, null: o alerta do fim já cobre.
 */
function prazoDeRenovacao(contrato: ContratoParaAlertas, fim: string): string | null {
  const { tipo, aviso_dias, oposicao_ate_dias } = contrato.renovacao;
  const antes = tipo === "automatica" ? oposicao_ate_dias ?? aviso_dias : aviso_dias;
  if (antes === null || antes === undefined || antes <= 0) return null;
  return somarDias(fim, -antes);
}

/**
 * Próxima data de reajuste por índice: o dia e mês da data-base, a primeira
 * vez depois do início da vigência; passados 30 dias da data, vale a do ano
 * seguinte. Fora da vigência (e sem renovação automática), não há reajuste.
 */
function proximoReajuste(contrato: ContratoParaAlertas, hoje: string): string | null {
  const { tipo, data_base } = contrato.reajuste;
  if (tipo !== "indice" || !mesDiaValido(data_base)) return null;
  const [mes, dia] = data_base.split("-").map(Number);
  const [anoInicio] = partes(contrato.vigente_de);
  let ano = anoInicio;
  let data = dataNoMes(ano, mes, dia);
  while (diasEntre(contrato.vigente_de, data) <= 0 || diasEntre(data, hoje) > REAJUSTE_VENCIDO_DIAS) {
    ano += 1;
    data = dataNoMes(ano, mes, dia);
  }
  const fim = contrato.vigente_ate;
  if (fim !== null && diasEntre(fim, data) > 0 && contrato.renovacao.tipo !== "automatica") return null;
  return data;
}

const ORDEM_DO_TIPO: Record<TipoAlerta, number> = { fim_vigencia: 0, renovacao: 1, reajuste: 2 };

/**
 * Alertas do contrato em `hoje`: o fim da vigência e o prazo de renovação
 * (oposição ou aviso) a 120, 90 e 30 dias, e a data do reajuste por índice.
 * Vencido continua aparecendo, com `dias` negativo, até alguém registrar o
 * aditivo ou encerrar o contrato. Encerrado não tem alerta; prazo
 * indeterminado só tem o reajuste.
 */
export function alertasDoContrato(contrato: ContratoParaAlertas, hoje: string): AlertaContrato[] {
  partes(hoje);
  if (contrato.status === "encerrado") return [];
  const alertas: AlertaContrato[] = [];
  const incluir = (tipo: TipoAlerta, data: string) => {
    const dias = diasEntre(hoje, data);
    const marco = marcoDoAviso(dias);
    if (marco !== null) alertas.push({ tipo, data, dias, marco });
  };

  const fim = contrato.vigente_ate;
  if (fim !== null) {
    incluir("fim_vigencia", fim);
    const prazo = prazoDeRenovacao(contrato, fim);
    // Depois do fim, o alerta do fim já diz o que fazer.
    if (prazo !== null && diasEntre(hoje, fim) >= 0) incluir("renovacao", prazo);
  }
  const reajuste = proximoReajuste(contrato, hoje);
  if (reajuste !== null) incluir("reajuste", reajuste);

  return alertas.sort((a, b) => a.data.localeCompare(b.data) || ORDEM_DO_TIPO[a.tipo] - ORDEM_DO_TIPO[b.tipo]);
}

// --- Pagamento -----------------------------------------------------------------

/**
 * Data prevista do pagamento de uma NF, pela regra do contrato:
 * - faixas do dia em que a NF foi recebida (no Itaú, 1–10 → dia 30 do mesmo
 *   mês; 11–20 → dia 10 do mês seguinte; 21–31 → dia 30 do mês seguinte). O
 *   mês sem o dia (fevereiro sem 30) paga no último dia;
 * - um número de dias corridos depois do recebimento da NF;
 * - texto: sem previsão calculada (null).
 */
export function pagamentoPrevisto(contrato: ContratoParaPagamento, dataRecebimentoNF: string): string | null {
  const [ano, mes, dia] = partes(dataRecebimentoNF);
  const regra = contrato.pagamento;
  if (regra.tipo === "dias_apos_nf") {
    return regra.dias === null ? null : somarDias(dataRecebimentoNF, regra.dias);
  }
  if (regra.tipo !== "faixas_do_dia_da_nf") return null;
  const faixa = regra.faixas.find((item) => item.de <= dia && dia <= item.ate);
  if (!faixa) return null;
  const seguinte = faixa.mes === "seguinte";
  const mesAlvo = seguinte ? (mes === 12 ? 1 : mes + 1) : mes;
  const anoAlvo = seguinte && mes === 12 ? ano + 1 : ano;
  return dataNoMes(anoAlvo, mesAlvo, faixa.dia);
}

/**
 * Problema nas faixas de pagamento, ou null: precisam cobrir os dias 1 a 31,
 * em ordem, sem buraco nem sobreposição.
 */
export function problemaDasFaixas(faixas: readonly FaixaPagamento[]): string | null {
  if (faixas.length === 0) return "Informe as faixas do dia da NF.";
  let esperado = 1;
  for (const [index, faixa] of faixas.entries()) {
    if (faixa.de > faixa.ate) return `Faixa ${index + 1}: o dia inicial passa do final.`;
    if (faixa.de !== esperado) {
      return faixa.de < esperado
        ? `Faixa ${index + 1}: sobrepõe a faixa anterior no dia ${faixa.de}.`
        : `As faixas não cobrem o dia ${esperado}.`;
    }
    esperado = faixa.ate + 1;
  }
  return esperado === 32 ? null : `As faixas não cobrem o dia ${esperado}.`;
}
