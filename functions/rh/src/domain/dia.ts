/**
 * Datas do RH em dias (AAAA-MM-DD), no fuso de São Paulo, como a rotina
 * diária da Operação (functions/operacao/src/domain/tv.ts).
 */

const DIA_EM_SAO_PAULO = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" });
const DIA = /^\d{4}-\d{2}-\d{2}$/;
const UM_DIA_MS = 86_400_000;

/** O dia em São Paulo (AAAA-MM-DD). */
export function diaEmSaoPaulo(instante: Date): string {
  return DIA_EM_SAO_PAULO.format(instante);
}

/** O dia existe no calendário: 2026-02-30 não. */
export function diaValido(valor: string): boolean {
  if (!DIA.test(valor)) return false;
  const instante = new Date(`${valor}T00:00:00Z`);
  return !Number.isNaN(instante.getTime()) && instante.toISOString().slice(0, 10) === valor;
}

/** Dias corridos de `de` até `ate`; negativo quando `ate` já passou. */
export function diasAte(de: string, ate: string): number {
  return Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / UM_DIA_MS);
}

/** O dia `dias` depois de `dia`. */
export function somarDias(dia: string, dias: number): string {
  return new Date(Date.parse(`${dia}T00:00:00Z`) + dias * UM_DIA_MS).toISOString().slice(0, 10);
}
