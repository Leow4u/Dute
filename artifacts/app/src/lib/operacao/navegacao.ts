import type { Papel } from "@workspace/dominio";

import { TELAS_DO_CAMPO } from "../campo/navegacao";
import { OPERACAO_LIBERADO } from "../liberacao";
import { ROTA_TV } from "../tv/navegacao";

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
/** A agenda da semana (parte 3.6b, docs/mockups/OpAgenda.dc.html): ?semana=2026-10-19. */
export const ROTA_AGENDA = "/operacao/agenda";
/** As demandas (parte 3.5b, docs/mockups/OpDemandas.dc.html). */
export const ROTA_DEMANDAS = "/operacao/demandas";
/** A ficha da demanda, aberta pela lista: ?numero=10045 (docs/mockups/OpDemanda.dc.html). */
export const ROTA_DEMANDA = "/operacao/demanda";
/** A nova demanda direta (parte 3.5c, docs/mockups/OpDemandaNova.dc.html). */
export const ROTA_NOVA_DEMANDA = "/operacao/nova-demanda";
/** A ficha da OS (parte 3.7d, docs/mockups/OpOS.dc.html): ?numero=10045-01. */
export const ROTA_OS = "/operacao/os";
/** A OS impressa, via operacional (parte 3.9d, docs/mockups/OSImpressao.dc.html): ?numero=10045-01. */
export const ROTA_OS_IMPRESSAO = "/operacao/os/impressao";
/** A revisão interna (parte 3.10b, docs/mockups/OpRevisao.dc.html): ?os=10045-01 abre a OS da vez. */
export const ROTA_REVISAO = "/operacao/revisao";
/** Planejar as OS de uma demanda (parte 3.6a, docs/mockups/OpOSPlanejar.dc.html): ?demanda=10045. */
export const ROTA_PLANEJAR = "/operacao/planejar";

export const TELAS_DA_OPERACAO: readonly string[] = [
  ROTA_OPERACAO,
  ROTA_HOJE,
  ROTA_AGENDA,
  ROTA_DEMANDAS,
  ROTA_DEMANDA,
  ROTA_NOVA_DEMANDA,
  ROTA_PLANEJAR,
  ROTA_OS,
  ROTA_OS_IMPRESSAO,
  ROTA_REVISAO,
  ROTA_COLABORADORES,
  ROTA_VEICULOS,
  // O app do campo é da Operação: só existe com a liberação dela (parte 3.8b).
  ...TELAS_DO_CAMPO,
  // A TV da sala também (parte 3.12b).
  ROTA_TV,
];

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

/** A ficha da OS: "/operacao/os?numero=10045-01". */
export function hrefDaFichaDaOs(numero: string): string {
  return `${ROTA_OS}?numero=${encodeURIComponent(numero)}`;
}

/** A revisão com a OS da vez: "/operacao/revisao?os=10045-01". */
export function hrefDaRevisao(numero: string): string {
  return `${ROTA_REVISAO}?os=${encodeURIComponent(numero)}`;
}

/** A OS impressa: "/operacao/os/impressao?numero=10045-01". */
export function hrefDaImpressaoDaOs(numero: string): string {
  return `${ROTA_OS_IMPRESSAO}?numero=${encodeURIComponent(numero)}`;
}

/** A OS pedida na busca da URL da ficha (`?numero=`), ou null. */
export function fichaDaBusca(busca: string): string | null {
  const valor = parametro(busca, "numero");
  return valor && /^\d{5,8}-\d{2}$/.test(valor) ? valor : null;
}

/** A semana da agenda pela segunda-feira: "/operacao/agenda?semana=2026-10-19". */
export function hrefDaSemana(segunda: string): string {
  return `${ROTA_AGENDA}?semana=${encodeURIComponent(segunda)}`;
}

/** A data pedida na busca da URL da agenda (`?semana=`), ou null; a tela acha a segunda dela. */
export function semanaDaBusca(busca: string): string | null {
  const valor = parametro(busca, "semana");
  return valor && /^\d{4}-\d{2}-\d{2}$/.test(valor) ? valor : null;
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

/** Planejar as OS da demanda: "/operacao/planejar?demanda=10045". */
export function hrefDoPlano(numero: string): string {
  return `${ROTA_PLANEJAR}?demanda=${encodeURIComponent(numero)}`;
}

/** Planejar a vistoria da demanda (parte 3.11c): a mesma tela, numa OS só, sem itens. */
export function hrefDoPlanoDaVistoria(numero: string): string {
  return `${ROTA_PLANEJAR}?demanda=${encodeURIComponent(numero)}&vistoria=1`;
}

/** O planejamento pedido é o da vistoria (`&vistoria=1`). */
export function vistoriaNoPlanoDaBusca(busca: string): boolean {
  return parametro(busca, "vistoria") === "1";
}

/** A demanda pedida na busca da URL do planejamento (`?demanda=`), ou null. */
export function demandaDoPlanoDaBusca(busca: string): string | null {
  const numero = parametro(busca, "demanda");
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

/** A ficha do veículo aberta direto no cadastro: "/operacao/veiculos?id=vei_..." (parte 3.13b). */
export function hrefDoVeiculo(id: string): string {
  return `${ROTA_VEICULOS}?id=${encodeURIComponent(id)}`;
}

/** O veículo pedido na busca da URL do cadastro (`?id=`), ou null. */
export function veiculoDaBusca(busca: string): string | null {
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
