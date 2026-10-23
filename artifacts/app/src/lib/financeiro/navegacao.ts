import type { Papel } from "@workspace/dominio";

import { FINANCEIRO_LIBERADO } from "../liberacao";

/**
 * Navegação do Financeiro no app (docs/plataforma/fase-4-financeiro.md): o
 * shell v3 do módulo, com Início e as filas do faturamento da demanda. O
 * Faturamento do WMS (/faturamento) continua no shell da Armazenagem até a
 * Fase 7.
 *
 * Tudo aqui depende da liberação própria do Financeiro (lib/liberacao.ts):
 * fora dela, o card do Financeiro leva ao Faturamento do WMS, como antes.
 */

/** Quem fatura e recebe: a mesma lista das callables (functions/financeiro, platform-roles.ts). */
export const FINANCEIRO_ROLES = ["owner", "admin", "financeiro"] as const satisfies readonly Papel[];

/** Casa do módulo: o Início do Financeiro. */
export const ROTA_FINANCEIRO = "/financeiro";

/** A fila A faturar e o registro da NF (parte 4.1b). */
export const ROTA_A_FATURAR = "/financeiro/a-faturar";

/** O Faturamento da armazenagem, que continua no shell do WMS até a Fase 7. */
export const ROTA_FATURAMENTO_WMS = "/faturamento";

/** Telas do Financeiro que já existem no app. Cada parte nova acrescenta a dela. */
export const TELAS_DO_FINANCEIRO: readonly string[] = [ROTA_FINANCEIRO, ROTA_A_FATURAR];

export function rotasDoFinanceiro(liberado: boolean = FINANCEIRO_LIBERADO): string[] {
  return liberado ? [...TELAS_DO_FINANCEIRO] : [];
}

export function soComFinanceiroLiberado<T extends { path: string }>(rotas: readonly T[], liberado: boolean = FINANCEIRO_LIBERADO): T[] {
  const permitidas = rotasDoFinanceiro(liberado);
  return rotas.filter((rota) => permitidas.includes(rota.path));
}

export function abreFinanceiro(role: Papel | string | null | undefined, liberado: boolean = FINANCEIRO_LIBERADO): boolean {
  return liberado && Boolean(role) && (FINANCEIRO_ROLES as readonly string[]).includes(role as string);
}
