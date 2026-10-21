/**
 * Domínio compartilhado da plataforma Dute: tipos e regras que o app
 * (artifacts/app) e as Functions (functions/*) precisam ter iguais.
 *
 * As Functions não importam este pacote (npm próprio, deploy só da pasta
 * delas): guardam uma cópia literal em functions/wms/src/domain, e o teste
 * artifacts/app/src/lib/platform-lists.test.ts trava as cópias, junto com a
 * lista de papéis do firestore.rules. Desenho em docs/plataforma/fase-2-nucleo.md.
 */

export * from "./dinheiro";

export const MODULOS = ["wms", "operacao", "comercial", "financeiro", "rh"] as const;

export type Modulo = (typeof MODULOS)[number];

export const MODULO_ROTULO: Record<Modulo, string> = {
  wms: "Armazenagem",
  operacao: "Operação",
  comercial: "Comercial",
  financeiro: "Financeiro",
  rh: "RH",
};

/** Papéis da plataforma (plano.md, "Papéis da plataforma"). */
export const PAPEIS = [
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

export type Papel = (typeof PAPEIS)[number];

/** Papéis que já existiam no WMS antes da plataforma. */
export const PAPEIS_DO_WMS = [
  "owner",
  "admin",
  "interno",
  "wms",
  "financeiro",
  "suporte",
  "cliente",
] as const satisfies readonly Papel[];

export type PapelEquipe = Exclude<Papel, "cliente">;

/**
 * Módulos em que cada papel da equipe trabalha. O cliente usa os módulos que
 * contratou (MODULOS_CONTRATAVEIS). Um módulo só aparece para a pessoa quando
 * tem tela no app.
 */
export const MODULOS_POR_PAPEL: Record<PapelEquipe, readonly Modulo[]> = {
  owner: MODULOS,
  admin: MODULOS,
  interno: ["wms", "operacao"],
  wms: ["wms"],
  campo: ["operacao"],
  comercial: ["comercial"],
  financeiro: ["financeiro"],
  rh: ["rh"],
  suporte: ["wms", "operacao"],
  painel: [],
};

/** Módulos que o cliente contrata. `financeiro` são as faturas no portal. */
export const MODULOS_CONTRATAVEIS = ["wms", "operacao", "financeiro"] as const satisfies readonly Modulo[];

export type ModuloContratavel = (typeof MODULOS_CONTRATAVEIS)[number];

/** Cadastro anterior ao campo: o que a BTG tem hoje (armazenagem e faturas). */
export const MODULOS_PADRAO_CLIENTE: readonly ModuloContratavel[] = ["wms", "financeiro"];

export function isPapel(value: unknown): value is Papel {
  return typeof value === "string" && (PAPEIS as readonly string[]).includes(value);
}

export function isModuloContratavel(value: unknown): value is ModuloContratavel {
  return typeof value === "string" && (MODULOS_CONTRATAVEIS as readonly string[]).includes(value);
}

/**
 * Módulos contratados como chegam de um registro (projeção do perfil). Nunca
 * lança: sem o campo, ou sem nenhum módulo conhecido, vale o padrão.
 */
export function modulosContratados(value: unknown): ModuloContratavel[] {
  if (!Array.isArray(value)) return [...MODULOS_PADRAO_CLIENTE];
  const known = MODULOS_CONTRATAVEIS.filter((modulo) => value.includes(modulo));
  return known.length ? known : [...MODULOS_PADRAO_CLIENTE];
}

/**
 * Estágio do cadastro de empresas (`customers`, docs/plataforma/fase-6-comercial.md).
 * O prospect recebeu orçamento e ainda não é cliente: só o Comercial grava,
 * sem sigla, módulos nem projeções, e o WMS não o mostra.
 */
export const ESTAGIOS_CADASTRO = ["prospect", "cliente"] as const;

export type EstagioCadastro = (typeof ESTAGIOS_CADASTRO)[number];

/** Leitura tolerante do campo `stage`: sem o campo (a BTG e os cadastros de hoje), cliente. */
export function estagioDoCadastro(value: unknown): EstagioCadastro {
  return typeof value === "string" && value.trim().toLowerCase() === "prospect" ? "prospect" : "cliente";
}
