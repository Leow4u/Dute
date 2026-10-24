/**
 * Papéis da plataforma Dute no RH (docs/plataforma/fase-8-rh.md).
 *
 * Cópia literal de PAPEIS de lib/dominio: as Functions não importam o pacote.
 * O teste artifacts/app/src/lib/platform-lists.test.ts lê este arquivo e trava
 * as listas, que ficam como array literal `NOME = [...]`, o que o teste lê.
 *
 * - RH_ROLES lê o RH: owner, admin e rh (pergunta 23).
 * - RH_WRITE_ROLES grava: só o rh.
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

export const RH_ROLES = ["owner", "admin", "rh"] as const satisfies readonly PlatformRole[];
export const RH_WRITE_ROLES = ["rh"] as const satisfies readonly PlatformRole[];

export function isPlatformRole(value: unknown): value is PlatformRole {
  return typeof value === "string" && (PLATFORM_ROLES as readonly string[]).includes(value);
}

/** Por que a pessoa não lê o RH, ou null quando pode. Nega o resto. */
export function rhProblem(role: PlatformRole): string | null {
  if ((RH_ROLES as readonly string[]).includes(role)) return null;
  return "Seu perfil não abre o RH.";
}

/** Por que a pessoa não grava no RH, ou null quando pode: owner e admin só leem. */
export function rhWriteProblem(role: PlatformRole): string | null {
  if ((RH_WRITE_ROLES as readonly string[]).includes(role)) return null;
  return "Só o RH grava no RH.";
}
