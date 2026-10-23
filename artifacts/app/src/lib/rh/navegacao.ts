import type { Papel } from "@workspace/dominio";

import { RH_LIBERADO } from "../liberacao";

/**
 * Navegação do RH no app (docs/plataforma/fase-8-rh.md): o shell v3 do
 * módulo, com o Início, a lista de quem está ativo e a ficha de cada pessoa.
 * Tudo aqui depende da liberação do RH (lib/liberacao.ts), que só liga depois
 * da parte 8.1b.
 */

/** Quem abre o RH: a mesma lista das callables (functions/rh, platform-roles.ts; pergunta 23). */
export const RH_ROLES = ["owner", "admin", "rh"] as const satisfies readonly Papel[];

/** Quem grava no RH: só o rh. Owner e admin leem. */
export const RH_WRITE_ROLES = ["rh"] as const satisfies readonly Papel[];

/** Casa do módulo: o Início do RH. */
export const ROTA_RH = "/rh";

/** Quem está ativo no cadastro da Operação, com a ficha resumida. */
export const ROTA_PESSOAS = "/rh/pessoas";

/** A ficha de uma pessoa: `?colaborador=`. Fora do menu; acende Pessoas. */
export const ROTA_FICHA = "/rh/ficha";

/** Telas do RH que já existem no app. Cada parte nova acrescenta a dela. */
export const TELAS_DO_RH: readonly string[] = [ROTA_RH, ROTA_PESSOAS, ROTA_FICHA];

const ID_DO_COLABORADOR = /^col_[a-f0-9]{16}$/;

/** A ficha da pessoa. */
export function hrefDaFicha(colaboradorId: string): string {
  return `${ROTA_FICHA}?colaborador=${encodeURIComponent(colaboradorId)}`;
}

/** A pessoa aberta pela busca da URL, ou null. */
export function colaboradorDaBusca(busca: string): string | null {
  const id = new URLSearchParams(busca).get("colaborador") ?? "";
  return ID_DO_COLABORADOR.test(id) ? id : null;
}

export function rotasDoRh(liberado: boolean = RH_LIBERADO): string[] {
  return liberado ? [...TELAS_DO_RH] : [];
}

export function soComRhLiberado<T extends { path: string }>(rotas: readonly T[], liberado: boolean = RH_LIBERADO): T[] {
  const permitidas = rotasDoRh(liberado);
  return rotas.filter((rota) => permitidas.includes(rota.path));
}

export function abreRh(role: Papel | string | null | undefined, liberado: boolean = RH_LIBERADO): boolean {
  return liberado && Boolean(role) && (RH_ROLES as readonly string[]).includes(role as string);
}

export function gravaNoRh(role: Papel | string | null | undefined, liberado: boolean = RH_LIBERADO): boolean {
  return abreRh(role, liberado) && (RH_WRITE_ROLES as readonly string[]).includes(role as string);
}
