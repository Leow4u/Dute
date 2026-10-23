import type { Papel } from "@workspace/dominio";

import { OPERACAO_LIBERADO } from "../liberacao";

/**
 * O app do campo (docs/plataforma/fase-3-operacao.md, parte 3.8b;
 * docs/mockups/Campo2Hoje.dc.html e Campo2Execucao.dc.html): as OS em que a
 * pessoa está escalada e a execução de cada uma, no celular. É parte da
 * Operação: só existe onde a Operação está liberada.
 */

/** Quem usa o app do campo. Owner e admin abrem para conferir (a lista deles vem vazia). */
export const CAMPO_ROLES = ["campo", "owner", "admin"] as const satisfies readonly Papel[];

/** Minhas OS. */
export const ROTA_CAMPO = "/campo";
/** A OS no celular: ?numero=10045-01. */
export const ROTA_CAMPO_OS = "/campo/os";

export const TELAS_DO_CAMPO: readonly string[] = [ROTA_CAMPO, ROTA_CAMPO_OS];

export function hrefDaOsNoCampo(numero: string): string {
  return `${ROTA_CAMPO_OS}?numero=${encodeURIComponent(numero)}`;
}

/** A OS pedida na busca da URL (`?numero=`), ou null. */
export function osDoCampoDaBusca(busca: string): string | null {
  const valor = new URLSearchParams(busca.startsWith("?") ? busca.slice(1) : busca).get("numero")?.trim() ?? "";
  return /^\d{5,8}-\d{2}$/.test(valor) ? valor : null;
}

/** O papel campo entra no app do campo onde a Operação está liberada. */
export function abreCampo(role: Papel | string | null | undefined, liberado: boolean = OPERACAO_LIBERADO): boolean {
  return liberado && role === "campo";
}
