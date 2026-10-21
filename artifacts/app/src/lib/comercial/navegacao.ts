import type { Papel } from "@workspace/dominio";

import { COMERCIAL_LIBERADO } from "../liberacao";

/**
 * Navegação do Comercial no app (docs/plataforma/fase-6-comercial.md, parte
 * 13). As telas entram no layout de hoje (menu e cabeçalho do app), com o
 * conteúdo na identidade v3; o shell v3 completo é da Fase 2.
 *
 * Tudo aqui depende da liberação própria do Comercial (lib/liberacao.ts): fora
 * dela (produção) não há rota, item de menu, card na tela de entrada nem
 * aterrissagem, como antes. As funções recebem a liberação como parâmetro (o
 * padrão é a deste build) para os testes decidirem o ambiente.
 */

/**
 * Quem trabalha no Comercial: os papéis com o módulo em MODULOS_POR_PAPEL
 * (lib/dominio), a mesma lista das callables (functions/comercial,
 * platform-roles.ts). Travada por lib/platform-lists.test.ts.
 */
export const COMERCIAL_ROLES = ["owner", "admin", "comercial"] as const satisfies readonly Papel[];

/** Casa do módulo: a fila de orçamentos (parte 11, docs/mockups/ComFila.dc.html). */
export const ROTA_COMERCIAL = "/comercial";
/** Montar orçamento (docs/mockups/ComOrcamento.dc.html), aberto pela fila: ?numero=10045. */
export const ROTA_ORCAMENTO = "/comercial/orcamento";
export const ROTA_CLIENTES = "/comercial/clientes";
/** Aba Contratos do módulo (parte 14): lista e ficha do contrato. */
export const ROTA_CONTRATOS = "/comercial/contratos";

/**
 * Telas do Comercial que já existem no app. Cada parte nova acrescenta a dela:
 * a rota passa a existir e a aba ou o link para ela aparece.
 */
export const TELAS_DO_COMERCIAL: readonly string[] = [ROTA_COMERCIAL, ROTA_ORCAMENTO, ROTA_CLIENTES, ROTA_CONTRATOS];

/** Rotas do Comercial que o App registra: nenhuma fora da liberação. */
export function rotasDoComercial(liberado: boolean = COMERCIAL_LIBERADO): string[] {
  return liberado ? Array.from(new Set([ROTA_COMERCIAL, ...TELAS_DO_COMERCIAL])) : [];
}

/**
 * O portão das rotas no App: toda rota do Comercial passa por aqui, e fora
 * da liberação nenhuma é registrada (cai na tela de não encontrado). O teste
 * de navegação exige que o App.tsx não registre rota do Comercial fora dele.
 */
export function soComComercialLiberado<T extends { path: string }>(
  rotas: readonly T[],
  liberado: boolean = COMERCIAL_LIBERADO,
): T[] {
  const permitidas = rotasDoComercial(liberado);
  return rotas.filter((rota) => permitidas.includes(rota.path));
}

/**
 * A pessoa abre o Comercial: papel do módulo e ambiente liberado. É a decisão
 * que o menu (modules.ts), a aterrissagem e o card da tela de entrada
 * (platform-modules.ts) usam.
 */
export function abreComercial(role: Papel | string | null | undefined, liberado: boolean = COMERCIAL_LIBERADO): boolean {
  return liberado && Boolean(role) && (COMERCIAL_ROLES as readonly string[]).includes(role as string);
}

export type AbaDoComercial = {
  id: "orcamentos" | "contratos" | "autorizacoes" | "medicoes";
  rotulo: string;
  href: string;
  /** Outras telas em que a aba fica marcada (a montagem é da aba Orçamentos). */
  tambem?: readonly string[];
};

/** Barra de abas do módulo, na ordem dos mockups (ComFila e ComContrato). */
export const ABAS_DO_COMERCIAL: readonly AbaDoComercial[] = [
  { id: "orcamentos", rotulo: "Orçamentos", href: ROTA_COMERCIAL, tambem: [ROTA_ORCAMENTO] },
  { id: "contratos", rotulo: "Contratos", href: ROTA_CONTRATOS },
  { id: "autorizacoes", rotulo: "Autorizações", href: "/comercial/autorizacoes" },
  { id: "medicoes", rotulo: "Medições", href: "/comercial/medicoes" },
];

/** Abas com tela; a que ainda não tem fica oculta. */
export function abasVisiveis(telas: readonly string[] = TELAS_DO_COMERCIAL): AbaDoComercial[] {
  return ABAS_DO_COMERCIAL.filter((aba) => telas.includes(aba.href));
}

/** Link para a ficha do contrato na aba Contratos (parte 14), quando a tela existe. */
export function hrefDoContrato(contratoId: string, telas: readonly string[] = TELAS_DO_COMERCIAL): string | null {
  return telas.includes(ROTA_CONTRATOS) ? `${ROTA_CONTRATOS}?id=${encodeURIComponent(contratoId)}` : null;
}

/** O contrato aberto na aba Contratos: o `id` da busca da URL (`?id=...`), ou null. */
export function contratoDaBusca(busca: string): string | null {
  const id = new URLSearchParams(busca.startsWith("?") ? busca.slice(1) : busca).get("id")?.trim();
  return id ? id : null;
}
