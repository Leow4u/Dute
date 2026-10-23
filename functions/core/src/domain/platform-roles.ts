/**
 * Papéis da plataforma Dute no núcleo (docs/plataforma/fase-5-memoria.md).
 *
 * Cópia literal de PAPEIS de lib/dominio: as Functions não importam o pacote.
 * O teste artifacts/app/src/lib/platform-lists.test.ts lê este arquivo e trava
 * as listas. PLANEJAMENTO_ROLES é quem planeja a OS, a mesma lista de
 * OPERACAO_CADASTRO_ROLES da Operação; ORCAMENTO_ROLES é quem orça, a mesma
 * de COMERCIAL_ROLES do Comercial; ALERTA_ROLES é quem aprova o alerta do
 * item parado ao cliente. As listas ficam como array literal `NOME = [...]`,
 * que é o que o teste lê.
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

/** Quem planeja a OS e recebe a duração sugerida (parte 5.2). */
export const PLANEJAMENTO_ROLES = ["owner", "admin", "interno"] as const satisfies readonly PlatformRole[];

/** Quem orça e vê os orçamentos parecidos, com o preço (parte 5.3b): a mesma lista de COMERCIAL_ROLES do Comercial. */
export const ORCAMENTO_ROLES = ["owner", "admin", "comercial"] as const satisfies readonly PlatformRole[];

/** Quem aprova ou descarta o alerta do item parado ao cliente (parte 5.4d): a coordenação. */
export const ALERTA_ROLES = ["owner", "admin", "interno"] as const satisfies readonly PlatformRole[];

export function isPlatformRole(value: unknown): value is PlatformRole {
  return typeof value === "string" && (PLATFORM_ROLES as readonly string[]).includes(value);
}

/** Por que a pessoa não recebe a sugestão do planejamento, ou null quando recebe. Nega o resto. */
export function planejamentoProblem(role: PlatformRole): string | null {
  if ((PLANEJAMENTO_ROLES as readonly string[]).includes(role)) return null;
  return "Seu perfil não planeja OS.";
}

/** Por que a pessoa não vê os orçamentos parecidos, ou null quando vê. Nega o resto. */
export function orcamentoProblem(role: PlatformRole): string | null {
  if ((ORCAMENTO_ROLES as readonly string[]).includes(role)) return null;
  return "Seu perfil não orça.";
}

/** Por que a pessoa não decide o alerta do item parado, ou null quando decide. Nega o resto. */
export function alertaProblem(role: PlatformRole): string | null {
  if ((ALERTA_ROLES as readonly string[]).includes(role)) return null;
  return "Seu perfil não decide o alerta ao cliente.";
}
