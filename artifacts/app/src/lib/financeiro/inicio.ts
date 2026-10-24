import type { ItemDoInicio } from "../inicio-do-modulo";
import { hojeIso } from "../operacao/fila";
import { pendenciasDoFinanceiro, type LinhaAFaturar } from "./a-faturar";
import { pendenciasDasEmissoes, type EmissaoDoFinanceiro } from "./emissoes";
import { pendenciasDaCobranca, type FaturaDoFinanceiro } from "./faturas";
import { ROTA_A_FATURAR, ROTA_A_RECEBER, ROTA_EMISSOES, ROTA_VENCIDOS } from "./navegacao";

/**
 * O "Precisa de você" do Financeiro (partes 4.1b e 4.2b): as NFs vencidas, a
 * fila A faturar, as NFs para enviar e o que espera, o mais urgente primeiro.
 * Dentro do mesmo tom, a ordem fica: a cobrança vencida, as emissões da
 * NFS-e rejeitadas e paradas (parte 7.4f), a fila e o envio.
 */

const ORDEM_DO_TOM: Record<ItemDoInicio["tone"], number> = { critical: 0, attention: 1, agent: 2, info: 3 };

export function itensDoInicioDoFinanceiro(
  linhas: readonly LinhaAFaturar[],
  faturas: readonly FaturaDoFinanceiro[],
  agora: Date,
  emissoes: readonly EmissaoDoFinanceiro[] = [],
): ItemDoInicio[] {
  const cobranca = pendenciasDaCobranca(faturas, hojeIso(agora), { vencidos: ROTA_VENCIDOS, aReceber: ROTA_A_RECEBER });
  return [...cobranca.criticos, ...pendenciasDasEmissoes(emissoes, ROTA_EMISSOES), ...pendenciasDoFinanceiro(linhas, agora, ROTA_A_FATURAR), ...cobranca.outros].sort(
    (a, b) => ORDEM_DO_TOM[a.tone] - ORDEM_DO_TOM[b.tone],
  );
}
