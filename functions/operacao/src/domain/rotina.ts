import type { ColaboradorGravado, VeiculoGravado } from "./cadastro.js";

/**
 * A rotina diária da Operação (docs/plataforma/fase-3-operacao.md, parte
 * 3.13a): todo dia, a CNH de quem está ativo que vence em até 30 dias (ou já
 * venceu) e a revisão preventiva do veículo ativo em até 15 dias (ou que já
 * passou) viram um evento cada, uma vez por dia por item. O Início mostra o
 * mesmo alerta pela leitura do cadastro (lib/operacao/pendencias.ts); o
 * evento é o que a IA mede.
 */

/** Quantos dias antes do vencimento a CNH entra no alerta. A mesma janela do Início (DIAS_PARA_A_CNH). */
export const DIAS_PARA_A_CNH = 30;
/** Quantos dias antes da revisão preventiva o veículo entra no alerta. A mesma janela do Início (DIAS_PARA_A_REVISAO). */
export const DIAS_PARA_A_REVISAO = 15;

export const TIPOS_DE_ALERTA = ["collaborator.cnh_expiring", "vehicle.maintenance_due"] as const;
export type TipoDeAlerta = (typeof TIPOS_DE_ALERTA)[number];

export type AlertaDoDia = { tipo: TipoDeAlerta; id: string; dias: number };

const DIA = /^\d{4}-\d{2}-\d{2}$/;
const UM_DIA_MS = 86_400_000;

/** Dias corridos de `de` até `ate` (AAAA-MM-DD); negativo quando `ate` já passou. */
export function diasAte(de: string, ate: string): number {
  return Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / UM_DIA_MS);
}

/** Os alertas do dia: a CNH e a revisão dentro da janela, só de quem e do que está ativo. */
export function alertasDoDia(hoje: string, colaboradores: readonly ColaboradorGravado[], veiculos: readonly VeiculoGravado[]): AlertaDoDia[] {
  const cnh = colaboradores.flatMap((colaborador): AlertaDoDia[] => {
    const validade = colaborador.cnh?.validade ?? "";
    if (!colaborador.ativo || !DIA.test(validade)) return [];
    const dias = diasAte(hoje, validade);
    return dias <= DIAS_PARA_A_CNH ? [{ tipo: "collaborator.cnh_expiring", id: colaborador.id, dias }] : [];
  });
  const revisao = veiculos.flatMap((veiculo): AlertaDoDia[] => {
    const quando = veiculo.revisao_em ?? "";
    if (!veiculo.ativo || !DIA.test(quando)) return [];
    const dias = diasAte(hoje, quando);
    return dias <= DIAS_PARA_A_REVISAO ? [{ tipo: "vehicle.maintenance_due", id: veiculo.id, dias }] : [];
  });
  return [...cnh, ...revisao].sort((a, b) => a.dias - b.dias || a.id.localeCompare(b.id));
}
