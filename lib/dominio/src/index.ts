/**
 * Domínio compartilhado da plataforma Dute: tipos e regras que o app
 * (artifacts/app) e as Functions (functions/*) precisam ter iguais.
 */
export const MODULOS = ["wms", "operacao", "comercial", "financeiro", "rh"] as const;

export type Modulo = (typeof MODULOS)[number];
