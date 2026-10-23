import { FINANCEIRO_LIBERADO } from "../liberacao";
import { ROTA_A_FATURAR, abreFinanceiro, hrefDaViaComercial } from "./navegacao";

/**
 * A ação de pagamento na tela Faturamento do WMS (parte 7.2c,
 * docs/plataforma/fase-7-financeiro-unificado.md).
 *
 * - Onde o Financeiro está ligado, a competência emitida se fatura e se recebe
 *   lá, e o WMS leva até ele: à NF, quando a competência já está numa, ou ao A
 *   faturar. O servidor (payBillingInvoice) recusa o pagamento ali.
 * - Fora dele, segue o "Marcar como paga" do WMS.
 * - Quem não abre o Financeiro (o suporte) não ganha o link.
 */

export type AcaoDaArmazenagem =
  | { tipo: "pagar_no_wms" }
  | { tipo: "abrir_no_financeiro"; href: string; rotulo: string }
  | null;

export function acaoDaArmazenagem(
  status: string,
  faturaId: string | null | undefined,
  role: string | null | undefined,
  liberado: boolean = FINANCEIRO_LIBERADO,
): AcaoDaArmazenagem {
  if (!liberado) return status === "emitido" ? { tipo: "pagar_no_wms" } : null;
  if (status === "aberto" || !abreFinanceiro(role, liberado)) return null;
  if (faturaId) return { tipo: "abrir_no_financeiro", href: hrefDaViaComercial(faturaId), rotulo: "Ver a NF no Financeiro" };
  return status === "emitido" ? { tipo: "abrir_no_financeiro", href: ROTA_A_FATURAR, rotulo: "Faturar no Financeiro" } : null;
}
