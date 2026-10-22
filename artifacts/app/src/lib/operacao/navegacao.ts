import type { Papel } from "@workspace/dominio";

import { OPERACAO_LIBERADO } from "../liberacao";

/**
 * Navegação do cadastro da Operação (docs/plataforma/fase-3-operacao.md,
 * parte 1). As rotas são do ambiente Operação: menu e página inicial
 * próprios. Fora da liberação não há rota, item de menu nem card.
 */

/** Quem grava e lê o cadastro. Campo e suporte ficam de fora: o documento tem CPF. */
export const OPERACAO_CADASTRO_ROLES = ["owner", "admin", "interno"] as const satisfies readonly Papel[];

export const ROTA_OPERACAO = "/operacao/colaboradores";
export const ROTA_COLABORADORES = "/operacao/colaboradores";
export const ROTA_VEICULOS = "/operacao/veiculos";

export const TELAS_DA_OPERACAO: readonly string[] = [ROTA_COLABORADORES, ROTA_VEICULOS];

export function rotasDaOperacao(liberado: boolean = OPERACAO_LIBERADO): string[] {
  return liberado ? [...TELAS_DA_OPERACAO] : [];
}

export function soComOperacaoLiberada<T extends { path: string }>(
  rotas: readonly T[],
  liberado: boolean = OPERACAO_LIBERADO,
): T[] {
  const permitidas = rotasDaOperacao(liberado);
  return rotas.filter((rota) => permitidas.includes(rota.path));
}

export function abreOperacao(role: Papel | string | null | undefined, liberado: boolean = OPERACAO_LIBERADO): boolean {
  return liberado && Boolean(role) && (OPERACAO_CADASTRO_ROLES as readonly string[]).includes(role as string);
}
