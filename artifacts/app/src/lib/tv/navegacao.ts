import type { Papel } from "@workspace/dominio";

import { OPERACAO_LIBERADO } from "../liberacao";

/**
 * A TV da sala de operações (docs/plataforma/fase-3-operacao.md, parte 3.12;
 * docs/mockups/TVSala.dc.html): o quadro do dia em tela cheia. É parte da
 * Operação: só existe onde a Operação está liberada.
 */

/**
 * Quem abre a TV: o papel painel e quem coordena, para conferir. A mesma
 * lista de functions/operacao/src/domain/platform-roles.ts (TV_ROLES), que
 * platform-lists.test.ts trava.
 */
export const TV_ROLES = ["owner", "admin", "interno", "painel"] as const satisfies readonly Papel[];

export const ROTA_TV = "/tv";

/** O papel painel entra direto na TV onde a Operação está liberada. */
export function abreTv(role: Papel | string | null | undefined, liberado: boolean = OPERACAO_LIBERADO): boolean {
  return liberado && role === "painel";
}
