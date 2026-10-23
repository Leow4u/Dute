/**
 * Papéis da plataforma Dute no núcleo (docs/plataforma/fase-5-memoria.md).
 *
 * Cópia literal de PAPEIS de lib/dominio: as Functions não importam o pacote.
 * O teste artifacts/app/src/lib/platform-lists.test.ts lê este arquivo e trava
 * as listas. PLANEJAMENTO_ROLES é quem planeja a OS, a mesma lista de
 * OPERACAO_CADASTRO_ROLES da Operação; ORCAMENTO_ROLES é quem orça, a mesma
 * de COMERCIAL_ROLES do Comercial; ALERTA_ROLES é quem aprova o alerta do
 * item parado ao cliente; AGENTE_ROLES é quem tem o Agent Dute do núcleo e
 * VALOR_ROLES é quem lê valor. As listas ficam como array literal
 * `NOME = [...]`, que é o que o teste lê.
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

/**
 * Quem tem o Agent Dute do núcleo (parte 5.5, pergunta 32): a equipe que
 * trabalha nos módulos e o cliente. O campo usa o app de campo, o painel só
 * lê o quadro da TV e o RH entra na Fase 8.
 */
export const AGENTE_ROLES = ["owner", "admin", "interno", "wms", "comercial", "financeiro", "suporte", "cliente"] as const satisfies readonly PlatformRole[];

/** Quem lê valor (preço, total, fatura): a mesma lista de canReadPrices do firestore.rules. O cliente lê só o das próprias faturas e OS. */
export const VALOR_ROLES = ["owner", "admin", "comercial", "financeiro"] as const satisfies readonly PlatformRole[];

/**
 * Os módulos de cada papel da equipe e os que o cliente contrata, com o
 * padrão sem o campo: cópias literais de MODULOS_POR_PAPEL,
 * MODULOS_CONTRATAVEIS e MODULOS_PADRAO_CLIENTE (lib/dominio), travadas por
 * artifacts/app/src/lib/platform-lists.test.ts.
 */
export const MODULOS_POR_PAPEL = {
  owner: ["wms", "operacao", "comercial", "financeiro", "rh"],
  admin: ["wms", "operacao", "comercial", "financeiro", "rh"],
  interno: ["wms", "operacao"],
  wms: ["wms"],
  campo: ["operacao"],
  comercial: ["comercial"],
  financeiro: ["financeiro"],
  rh: ["rh"],
  suporte: ["wms", "operacao"],
  painel: ["operacao"],
} as const satisfies Record<Exclude<PlatformRole, "cliente">, readonly string[]>;
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

/** Por que a pessoa não usa o Agent Dute do núcleo, ou null quando usa. Nega o resto. */
export function agenteProblem(role: PlatformRole): string | null {
  if ((AGENTE_ROLES as readonly string[]).includes(role)) return null;
  return "Seu perfil não usa o Agent Dute.";
}

/** A pessoa lê valor? O cliente lê o dos próprios documentos, que o leitor já restringe a ele. */
export function leValor(role: PlatformRole): boolean {
  return role === "cliente" || (VALOR_ROLES as readonly string[]).includes(role);
}
