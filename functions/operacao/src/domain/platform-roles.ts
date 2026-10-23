/**
 * Papéis da plataforma Dute na Operação (docs/plataforma/fase-3-operacao.md).
 *
 * Cópia literal de PAPEIS de lib/dominio: as Functions não importam o pacote.
 * O teste artifacts/app/src/lib/platform-lists.test.ts lê este arquivo e trava
 * PLATFORM_ROLES. OPERACAO_CADASTRO_ROLES é quem grava colaborador e veículo
 * (owner, admin e interno). Campo vê a própria OS depois; suporte não lê CPF.
 * As listas ficam como array literal `NOME = [...]`, que é o que o teste lê.
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

/** Quem grava o cadastro de colaboradores e veículos. */
export const OPERACAO_CADASTRO_ROLES = ["owner", "admin", "interno"] as const satisfies readonly PlatformRole[];

/**
 * Quem abre a TV da sala (parte 3.12): o papel `painel`, que só lê o quadro
 * do dia, e quem coordena, para conferir. O painel não grava nada.
 */
export const TV_ROLES = ["owner", "admin", "interno", "painel"] as const satisfies readonly PlatformRole[];

/**
 * Os módulos que o cliente contrata e o padrão sem o campo: cópias literais
 * de MODULOS_CONTRATAVEIS e MODULOS_PADRAO_CLIENTE (lib/dominio), travadas
 * por artifacts/app/src/lib/platform-lists.test.ts. O portal pede OS só com a
 * Operação no contrato (client_access/{customer_code}).
 */
export const CONTRACTED_MODULE_KEYS = ["wms", "operacao", "financeiro"] as const;
export const DEFAULT_CONTRACTED_MODULES = ["wms", "financeiro"] as const;
export type ContractedModule = (typeof CONTRACTED_MODULE_KEYS)[number];

/** Os módulos que valem de `client_access.modules`: sem a lista, ou sem nenhum conhecido, o padrão. */
export function contractedModulesFrom(value: unknown): ContractedModule[] {
  if (!Array.isArray(value)) return [...DEFAULT_CONTRACTED_MODULES];
  const known = CONTRACTED_MODULE_KEYS.filter((key) => value.includes(key));
  return known.length ? known : [...DEFAULT_CONTRACTED_MODULES];
}

export function isPlatformRole(value: unknown): value is PlatformRole {
  return typeof value === "string" && (PLATFORM_ROLES as readonly string[]).includes(value);
}

/** Por que a pessoa não vê a TV, ou null quando vê. Nega o resto. */
export function tvProblem(role: PlatformRole): string | null {
  if ((TV_ROLES as readonly string[]).includes(role)) return null;
  return "Seu perfil não abre a TV da sala.";
}

/** Por que a pessoa não grava o cadastro, ou null quando pode. Nega o resto. */
export function operacaoCadastroProblem(role: PlatformRole): string | null {
  if ((OPERACAO_CADASTRO_ROLES as readonly string[]).includes(role)) return null;
  return "Seu perfil não grava o cadastro da Operação.";
}
