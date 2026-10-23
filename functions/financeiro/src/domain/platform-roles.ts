/**
 * Papéis da plataforma Dute no Financeiro (docs/plataforma/fase-4-financeiro.md).
 *
 * Cópia literal de PAPEIS de lib/dominio: as Functions não importam o pacote.
 * O teste artifacts/app/src/lib/platform-lists.test.ts lê este arquivo e trava
 * PLATFORM_ROLES. FINANCEIRO_ROLES é quem fatura e recebe: owner, admin e
 * financeiro. As listas ficam como array literal `NOME = [...]`, que é o que o
 * teste lê.
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

/** Quem fatura a demanda e registra o recebimento. */
export const FINANCEIRO_ROLES = ["owner", "admin", "financeiro"] as const satisfies readonly PlatformRole[];

export function isPlatformRole(value: unknown): value is PlatformRole {
  return typeof value === "string" && (PLATFORM_ROLES as readonly string[]).includes(value);
}

/** Por que a pessoa não grava no Financeiro, ou null quando pode. Nega o resto. */
export function financeiroProblem(role: PlatformRole): string | null {
  if ((FINANCEIRO_ROLES as readonly string[]).includes(role)) return null;
  return "Seu perfil não grava no Financeiro.";
}
