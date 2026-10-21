/**
 * Papéis da plataforma Dute no Comercial (docs/plataforma/fase-6-comercial.md).
 *
 * Cópia literal de PAPEIS de lib/dominio: as Functions não importam o pacote
 * (npm próprio, deploy só desta pasta). O teste
 * artifacts/app/src/lib/platform-lists.test.ts lê este arquivo e trava
 * PLATFORM_ROLES e COMERCIAL_ROLES contra lib/dominio. As listas ficam como
 * array literal `NOME = [...]`, que é o que o teste sabe ler.
 */
export const PLATFORM_ROLES = [
  "owner",
  "admin",
  "interno",
  "wms",
  "campo",
  "comercial",
  "financeiro",
  "rh",
  "suporte",
  "painel",
  "cliente",
] as const;

export type PlatformRole = (typeof PLATFORM_ROLES)[number];

/**
 * Papéis que as callables do Comercial atendem: os que têm o módulo
 * `comercial` em MODULOS_POR_PAPEL. O cliente não contrata o Comercial.
 */
export const COMERCIAL_ROLES = ["owner", "admin", "comercial"] as const satisfies readonly PlatformRole[];

export type ComercialRole = (typeof COMERCIAL_ROLES)[number];

/** Quem aprova o orçamento antes do envio: só o owner no v1. */
export const COMERCIAL_APPROVER_ROLES = ["owner"] as const satisfies readonly ComercialRole[];

/**
 * Quem registra e cancela a autorização de faturamento do cliente (parte 15;
 * pergunta 4 do desenho): os papéis do Comercial e o financeiro, este sem
 * editar itens nem preço. O financeiro só entra na callable que pede de
 * propósito (`{ financeiro: true }`, só a recordAuthorization); nas outras
 * continua negado.
 */
export const COMERCIAL_AUTHORIZATION_ROLES = ["owner", "admin", "comercial", "financeiro"] as const satisfies readonly PlatformRole[];

/**
 * Acesso que uma callable pede além do padrão do Comercial. Sem opção, só
 * COMERCIAL_ROLES; `financeiro: true` abre também ao financeiro, e mais nada.
 */
export type AcessoComercial = { financeiro?: true };

export function isPlatformRole(value: unknown): value is PlatformRole {
  return typeof value === "string" && (PLATFORM_ROLES as readonly string[]).includes(value);
}

/**
 * Por que a pessoa não pode usar as callables do Comercial, ou null quando
 * pode. Nega por padrão todo papel fora de COMERCIAL_ROLES, inclusive o
 * cliente; com `{ financeiro: true }`, o financeiro também entra.
 */
export function comercialAccessProblem(role: PlatformRole, acesso: AcessoComercial = {}): string | null {
  if ((COMERCIAL_ROLES as readonly string[]).includes(role)) return null;
  if (acesso.financeiro === true && role === "financeiro") return null;
  return "Seu perfil não tem acesso ao Comercial.";
}

export function canApproveQuote(role: PlatformRole): boolean {
  return (COMERCIAL_APPROVER_ROLES as readonly string[]).includes(role);
}
