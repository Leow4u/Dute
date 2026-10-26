import type { ContractedModule } from "./customer-profile.js";

/**
 * Papéis da plataforma Dute (docs/plataforma/plano.md, "Papéis da plataforma";
 * desenho em docs/plataforma/fase-2-nucleo.md).
 *
 * Cópia literal de PAPEIS e PAPEIS_DO_WMS de lib/dominio: as Functions não
 * importam o pacote (npm próprio, deploy só desta pasta). O teste
 * artifacts/app/src/lib/platform-lists.test.ts lê este arquivo e trava as
 * listas, junto com validProfileRole do firestore.rules.
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
 * Papéis que as callables de hoje atendem: a equipe do WMS e o cliente. Toda
 * callable que existe é do WMS; um papel novo só entra numa callable quando o
 * módulo dele a liberar de propósito, com teste.
 */
export const WMS_ROLES = [
  "owner",
  "admin",
  "interno",
  "wms",
  "financeiro",
  "suporte",
  "cliente",
] as const satisfies readonly PlatformRole[];

export function isPlatformRole(value: unknown): value is PlatformRole {
  return typeof value === "string" && (PLATFORM_ROLES as readonly string[]).includes(value);
}

/**
 * Por que a pessoa não pode usar as callables do WMS, ou null quando pode.
 * Nega por padrão: papel da plataforma que o WMS não atende, cliente com o
 * portal desligado (arquivado ou "Sem portal", pergunta 69) e cliente cujo
 * contrato não tem armazenagem. `modules` e `portalAtivo` só importam para o
 * cliente.
 */
export function wmsAccessProblem(
  role: PlatformRole,
  modules: readonly ContractedModule[] | null,
  portalAtivo = true,
): string | null {
  if (!(WMS_ROLES as readonly string[]).includes(role)) {
    return "Seu perfil ainda não tem acesso a esta ação.";
  }
  if (role === "cliente" && !portalAtivo) {
    return "O portal do seu cliente está desligado.";
  }
  if (role === "cliente" && !(modules ?? []).includes("wms")) {
    return "O contrato do seu cliente não inclui armazenagem.";
  }
  return null;
}
