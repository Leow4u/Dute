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

/** Quem trabalha no Comercial: a mesma lista das callables (functions/comercial, platform-roles.ts). */
export const COMERCIAL_ROLES = ["owner", "admin", "comercial"] as const satisfies readonly Papel[];

/** Casa do módulo: a fila de orçamentos quando a parte 11 existir. */
export const ROTA_COMERCIAL = "/comercial";
export const ROTA_CLIENTES = "/comercial/clientes";

/**
 * Telas do Comercial que já existem no app. Cada parte nova acrescenta a dela:
 * a rota passa a existir e a aba ou o link para ela aparece.
 */
export const TELAS_DO_COMERCIAL: readonly string[] = [ROTA_CLIENTES];

/** Para onde /comercial leva enquanto a fila de orçamentos (parte 11) não existe. */
export const DESTINO_DO_COMERCIAL = ROTA_CLIENTES;

/** Rotas do Comercial que o App registra: nenhuma fora da liberação. */
export function rotasDoComercial(liberado: boolean = COMERCIAL_LIBERADO): string[] {
  return liberado ? Array.from(new Set([ROTA_COMERCIAL, ...TELAS_DO_COMERCIAL])) : [];
}

/** A pessoa abre o Comercial: papel do módulo e ambiente liberado. */
export function abreComercial(role: Papel | null | undefined, liberado: boolean = COMERCIAL_LIBERADO): boolean {
  return liberado && Boolean(role) && (COMERCIAL_ROLES as readonly string[]).includes(role as string);
}

export type AbaDoComercial = {
  id: "orcamentos" | "contratos" | "autorizacoes" | "medicoes";
  rotulo: string;
  href: string;
};

/** Barra de abas do módulo, na ordem dos mockups (ComFila e ComContrato). */
export const ABAS_DO_COMERCIAL: readonly AbaDoComercial[] = [
  { id: "orcamentos", rotulo: "Orçamentos", href: ROTA_COMERCIAL },
  { id: "contratos", rotulo: "Contratos", href: "/comercial/contratos" },
  { id: "autorizacoes", rotulo: "Autorizações", href: "/comercial/autorizacoes" },
  { id: "medicoes", rotulo: "Medições", href: "/comercial/medicoes" },
];

/** Abas com tela; a que ainda não tem fica oculta. */
export function abasVisiveis(telas: readonly string[] = TELAS_DO_COMERCIAL): AbaDoComercial[] {
  return ABAS_DO_COMERCIAL.filter((aba) => telas.includes(aba.href));
}

/** Link para a tela de contrato, quando ela existir (parte 14). */
export function hrefDoContrato(contratoId: string, telas: readonly string[] = TELAS_DO_COMERCIAL): string | null {
  const contratos = ABAS_DO_COMERCIAL.find((aba) => aba.id === "contratos")!.href;
  return telas.includes(contratos) ? `${contratos}?id=${encodeURIComponent(contratoId)}` : null;
}
