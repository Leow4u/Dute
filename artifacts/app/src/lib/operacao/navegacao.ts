import type { Papel } from "@workspace/dominio";

import { OPERACAO_LIBERADO } from "../liberacao";

/**
 * Navegação do cadastro da Operação (docs/plataforma/fase-3-operacao.md,
 * parte 1). As rotas são do ambiente Operação: menu e página inicial
 * próprios. Fora da liberação não há rota, item de menu nem card.
 */

/** Quem grava e lê o cadastro. Campo e suporte ficam de fora: o documento tem CPF. */
export const OPERACAO_CADASTRO_ROLES = ["owner", "admin", "interno"] as const satisfies readonly Papel[];

/** Casa do módulo: o Início da Operação (parte 2.6, docs/mockups/ModOpInicio.dc.html). */
export const ROTA_OPERACAO = "/operacao";
/** A fila do dia (parte 3 da Fase 3); era a casa até a parte 2.6. */
export const ROTA_HOJE = "/operacao/hoje";
export const ROTA_COLABORADORES = "/operacao/colaboradores";
export const ROTA_VEICULOS = "/operacao/veiculos";
/** As demandas (parte 3.5b, docs/mockups/OpDemandas.dc.html). */
export const ROTA_DEMANDAS = "/operacao/demandas";
/** A ficha da demanda, aberta pela lista: ?numero=10045 (docs/mockups/OpDemanda.dc.html). */
export const ROTA_DEMANDA = "/operacao/demanda";

export const TELAS_DA_OPERACAO: readonly string[] = [ROTA_OPERACAO, ROTA_HOJE, ROTA_DEMANDAS, ROTA_DEMANDA, ROTA_COLABORADORES, ROTA_VEICULOS];

function parametro(busca: string, nome: string): string | null {
  const valor = new URLSearchParams(busca.startsWith("?") ? busca.slice(1) : busca).get(nome)?.trim();
  return valor ? valor : null;
}

/** A OS aberta direto na fila do dia: "/operacao/hoje?os=10045-01". */
export function hrefDaOs(numero: string): string {
  return `${ROTA_HOJE}?os=${encodeURIComponent(numero)}`;
}

/** A OS pedida na busca da URL da fila (`?os=`), ou null. */
export function osDaBusca(busca: string): string | null {
  return parametro(busca, "os");
}

/** A ficha da demanda: "/operacao/demanda?numero=10045". */
export function hrefDaDemanda(numero: string): string {
  return `${ROTA_DEMANDA}?numero=${encodeURIComponent(numero)}`;
}

/** A demanda pedida na busca da URL da ficha (`?numero=`), ou null. */
export function demandaDaBusca(busca: string): string | null {
  const numero = parametro(busca, "numero");
  return numero && /^\d{5,8}$/.test(numero) ? numero : null;
}

/** A ficha do colaborador aberta direto no cadastro: "/operacao/colaboradores?id=col_...". */
export function hrefDoColaborador(id: string): string {
  return `${ROTA_COLABORADORES}?id=${encodeURIComponent(id)}`;
}

/** O colaborador pedido na busca da URL do cadastro (`?id=`), ou null. */
export function colaboradorDaBusca(busca: string): string | null {
  return parametro(busca, "id");
}

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
