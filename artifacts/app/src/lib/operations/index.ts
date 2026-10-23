import { modulosContratados, type ModuloContratavel } from "@workspace/dominio";

import { btg } from "./packs/btg";
import { insumos } from "./templates/insumos";
import { mobiliario } from "./templates/mobiliario";
import { uniformes } from "./templates/uniformes";
import type {
  OperationPack,
  OperationTemplate,
  OperationTemplateKey,
  PortalModuleKey,
} from "./types";

export type * from "./types";

/**
 * Registro dos modelos de operação e dos pacotes de cliente. Um sistema, uma
 * instância, um galpão: cada cliente nasce de um modelo (código), pode ter um
 * pacote (código, opcional) e o cadastro só aponta para eles
 * (docs/multicliente-modelos-de-operacao.md).
 */

export const OPERATION_TEMPLATES: readonly OperationTemplate[] = [uniformes, mobiliario, insumos];
export const OPERATION_PACKS: readonly OperationPack[] = [btg];

/** Modelo da BTG: cadastro anterior ao campo e perfil não publicado caem aqui. */
export const DEFAULT_OPERATION_TEMPLATE: OperationTemplateKey = "uniformes";

/**
 * Cliente legado: o da BTG, do pacote btg. Registro sem `customer_code`
 * (anterior ao multicliente) é dele (lib/active-customer.ts).
 */
export const LEGACY_CUSTOMER_CODE: string = btg.customers[0]!;

export const OPERATION_TEMPLATE_KEYS: readonly OperationTemplateKey[] = OPERATION_TEMPLATES.map(
  (template) => template.key,
);

export function isOperationTemplateKey(value: unknown): value is OperationTemplateKey {
  return typeof value === "string" && OPERATION_TEMPLATE_KEYS.includes(value as OperationTemplateKey);
}

export function operationTemplate(key: unknown): OperationTemplate | null {
  return OPERATION_TEMPLATES.find((template) => template.key === key) ?? null;
}

export function templateStatusLabel(template: Pick<OperationTemplate, "status">): string {
  return template.status === "ready" ? "Pronto" : "Em construção";
}

/** O pacote é encontrado pelo código operacional do cliente, nunca digitado. */
export function packForCustomer(customerCode: string | null | undefined): OperationPack | null {
  const code = String(customerCode ?? "").trim();
  if (!code) return null;
  return OPERATION_PACKS.find((pack) => pack.customers.includes(code)) ?? null;
}

export type PortalStatus = "active" | "inactive";

/** Documento `client_profiles` (ou `customers`) como chega do Firestore. */
export type CustomerProfileRecord = {
  customer_code?: string | null;
  code?: string | null;
  name?: string | null;
  operation_template?: string | null;
  sku_prefix?: string | null;
  portal_status?: string | null;
  status?: string | null;
  archived?: boolean | null;
  /** Módulos contratados (lib/dominio); sem o campo vale o padrão da BTG. */
  modules?: unknown;
};

export type OperationProfile = {
  customerCode: string;
  customerName: string;
  template: OperationTemplate;
  /** Só se aplica quando o pacote é do mesmo modelo do cadastro. */
  pack: OperationPack | null;
  skuPrefix: string | null;
  portalStatus: PortalStatus;
  /** "published": veio do registro publicado; "fallback": sem registro, modelo padrão. */
  source: "published" | "fallback";
  /** Módulos contratados. Sem registro, ou sem o campo, armazenagem e faturas. */
  modules: ModuloContratavel[];
};

export function resolveOperationProfile(
  record: CustomerProfileRecord | null | undefined,
  fallbackCustomerCode = LEGACY_CUSTOMER_CODE,
): OperationProfile {
  const customerCode =
    String(record?.customer_code ?? record?.code ?? "").trim() || fallbackCustomerCode;
  const template = operationTemplate(record?.operation_template) ?? operationTemplate(DEFAULT_OPERATION_TEMPLATE)!;
  const pack = packForCustomer(customerCode);
  const skuPrefix = canonicalSkuPrefix(record?.sku_prefix ?? "") || null;
  const portalStatus: PortalStatus =
    template.portal === null || record?.archived === true || record?.portal_status === "inactive"
      ? "inactive"
      : "active";
  return {
    customerCode,
    customerName: String(record?.name ?? "").trim() || customerCode,
    template,
    pack: pack && pack.template === template.key ? pack : null,
    skuPrefix,
    portalStatus,
    source: record ? "published" : "fallback",
    modules: modulosContratados(record?.modules),
  };
}

/**
 * O módulo contratado de que cada tela do portal depende (parte 2.7 da Fase
 * 2). O Início é de todos. As regras do Firestore negam o resto: as
 * projeções do armazém e os documentos exigem `wms`, as faturas exigem
 * `financeiro`, as OS (parte 4.3b) exigem `operacao`, e o Agent Dute do
 * portal ainda é do WMS (Fase 5).
 */
export const MODULO_DA_TELA_DO_PORTAL: Readonly<Record<PortalModuleKey, ModuloContratavel | null>> = {
  home: null,
  assistant: "wms",
  inventory: "wms",
  events: "wms",
  requests: "wms",
  orders: "wms",
  documents: "wms",
  services: "operacao",
  invoices: "financeiro",
};

/** A tela do portal cabe no contrato: o Início sempre; as outras, com o módulo delas. */
export function telaNoContrato(tela: PortalModuleKey, modules: readonly ModuloContratavel[]): boolean {
  const modulo = MODULO_DA_TELA_DO_PORTAL[tela];
  return modulo === null || modules.includes(modulo);
}

/**
 * As projeções do portal que o contrato deixa ler, as mesmas das regras do
 * Firestore (`isOwnProjectionWith`): o portal não pede o que vai ser negado.
 */
export function leiturasDoPortal(modules: readonly ModuloContratavel[]) {
  const armazenagem = modules.includes("wms");
  return {
    estoque: armazenagem,
    pedidos: armazenagem,
    solicitacoes: armazenagem,
    documentos: armazenagem,
    servicos: modules.includes("operacao"),
    faturas: modules.includes("financeiro"),
  };
}

/**
 * Módulos que o portal mostra para o perfil: os do modelo de operação que
 * cabem nos módulos contratados. Sem perfil (ainda carregando, ou área
 * interna) não há filtro. Modelo sem portal mostra só o Início, para uma
 * conta de cliente criada por engano não abrir uma tela em branco.
 */
export function portalModulesFor(profile: OperationProfile | null | undefined): readonly PortalModuleKey[] | null {
  if (!profile) return null;
  return (profile.template.portal ?? ["home"]).filter((tela) => telaNoContrato(tela, profile.modules));
}

/** Sigla do SKU: 2 a 6 letras ou números, começando por letra. Igual às Functions. */
export const SKU_PREFIX_PATTERN = /^[A-Z][A-Z0-9]{1,5}$/;

/** Maiúsculas, sem acento e sem separadores: "itaú " vira "ITAU". */
export function canonicalSkuPrefix(value: string | null | undefined): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

/** Mensagem de validação da sigla, ou null quando válida. */
export function skuPrefixProblem(value: string | null | undefined): string | null {
  const prefix = canonicalSkuPrefix(value);
  if (!prefix) return "Informe a sigla do SKU: 2 a 6 letras ou números.";
  if (!SKU_PREFIX_PATTERN.test(prefix)) {
    return "Use 2 a 6 letras ou números, começando por letra.";
  }
  return null;
}

/** Sugestão a partir do nome: a primeira palavra, até 6 caracteres ("Itaú Unibanco" → ITAU). */
export function suggestSkuPrefix(name: string | null | undefined): string {
  const first = String(name ?? "")
    .trim()
    .split(/\s+/)
    .map((part) => canonicalSkuPrefix(part))
    .find((part) => /^[A-Z]/.test(part));
  return (first ?? "").slice(0, 6);
}

/** Exemplo de SKU gerado com a sigla (PR 2: numeração sequencial por cliente). */
export function skuExample(prefix: string | null | undefined): string {
  const canonical = canonicalSkuPrefix(prefix);
  return `${canonical || "SIGLA"}-000001`;
}
