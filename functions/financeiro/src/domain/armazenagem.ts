/**
 * A armazenagem na NF (parte 7.2a, docs/plataforma/fase-7-financeiro-unificado.md).
 *
 * - A competência que o WMS emitiu entra na NF do Financeiro pelo total
 *   congelado na emissão (`billing_periods`, "fechado para faturar"). O
 *   Financeiro não recalcula: o total é `invoice_snapshot.total_cents`.
 * - Registrar a NF grava no período o resumo `faturamento`, o mesmo da
 *   demanda. Cancelar o registro o tira.
 * - O status do WMS não muda aqui: `emitido` continua até o pagamento (parte
 *   7.2c).
 */

/**
 * Cópias literais do WMS (functions/wms/src/index.ts, collectionNames.periods,
 * e domain/billing-scope.ts, LEGACY_BILLING_CUSTOMER); a trava é
 * armazenagem.test.ts.
 */
export const BILLING_PERIODS_COLLECTION = "billing_periods";
export const LEGACY_BILLING_CUSTOMER = "BTG Pactual";

/** Quantas competências uma NF fecha de uma vez: um ano. */
export const MAX_COMPETENCIAS_POR_NF = 12;

/**
 * O id do período no WMS: `{cliente}__{AAAA-MM}` (billingDocumentId), ou o id
 * antigo da BTG, só `AAAA-MM`.
 */
export const PERIODO_ID = /^(?:([\w.-]{1,200})__)?(\d{4}-(?:0[1-9]|1[0-2]))$/;

type Registro = Record<string, unknown>;

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

export type PeriodoParaFaturar = {
  id: string;
  customer_code: string;
  competencia: string;
  /** O status do WMS: aberto, emitido ou pago. */
  status: string;
  /** O total congelado na emissão; null sem a foto. */
  valor_cents: number | null;
  /** A NF em que a competência já está; null fora de NF. */
  fatura_id: string | null;
};

export function periodoLido(id: string, dados: Registro): PeriodoParaFaturar {
  const casado = PERIODO_ID.exec(id);
  const foto = dados.invoice_snapshot && typeof dados.invoice_snapshot === "object" ? (dados.invoice_snapshot as Registro) : {};
  const total = foto.total_cents;
  const faturamento = dados.faturamento && typeof dados.faturamento === "object" ? (dados.faturamento as Registro) : {};
  return {
    id,
    // O id antigo é só da BTG, que nem sempre gravou o cliente.
    customer_code: texto(dados.customer_code) || (casado && !casado[1] ? LEGACY_BILLING_CUSTOMER : ""),
    competencia: texto(dados.competencia) || casado?.[2] || "",
    status: texto(dados.status) || "aberto",
    valor_cents: typeof total === "number" && Number.isSafeInteger(total) && total >= 0 ? total : null,
    fatura_id: texto(faturamento.fatura_id) || null,
  };
}

/** "09/2026". */
export function rotuloDaCompetencia(competencia: string): string {
  const [ano, mes] = competencia.split("-");
  return ano && mes ? `${mes}/${ano}` : competencia;
}

/** Por que a competência não entra na NF agora, ou null. */
export function problemaDaArmazenagem(periodo: PeriodoParaFaturar): string | null {
  const rotulo = `A armazenagem de ${rotuloDaCompetencia(periodo.competencia)}`;
  if (periodo.fatura_id) return `${rotulo} já está numa NF.`;
  if (periodo.status === "pago") return `${rotulo} já está paga no WMS.`;
  if (periodo.status !== "emitido") return `${rotulo} ainda não foi emitida no WMS.`;
  if (periodo.valor_cents === null) return `${rotulo} não tem o total congelado da emissão.`;
  if (!periodo.customer_code) return `${rotulo} não tem cliente.`;
  return null;
}

/** A competência como a fatura guarda: o período, o mês e o total da foto. */
export type ArmazenagemNaFatura = {
  periodo_id: string;
  competencia: string;
  valor_cents: number;
};

export function armazenagemNaFatura(periodo: PeriodoParaFaturar): ArmazenagemNaFatura {
  return { periodo_id: periodo.id, competencia: periodo.competencia, valor_cents: periodo.valor_cents ?? 0 };
}

/** No cancelamento: a competência que a cobrança espera encontrar nesta NF, ou o problema. */
export function problemaDoPeriodoNaFatura(id: string, dados: Registro | null, faturaId: string): string | null {
  if (!dados) return `A competência de armazenagem ${id} não foi encontrada.`;
  const periodo = periodoLido(id, dados);
  if (periodo.fatura_id !== faturaId) return `A armazenagem de ${rotuloDaCompetencia(periodo.competencia)} não está nesta NF.`;
  return null;
}
