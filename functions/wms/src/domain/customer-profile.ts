import { FieldValue, type Firestore, type Transaction } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";

/**
 * Perfil de operação do cliente (docs/multicliente-modelos-de-operacao.md).
 *
 * O modelo de operação (uniformes, mobiliário, insumos) e o pacote do cliente
 * são código no app (artifacts/app/src/lib/operations). O cadastro
 * em `customers` só aponta para o modelo e guarda a sigla que abre o SKU do
 * cliente. Aqui ficam as validações dessas chaves e a projeção
 * `client_profiles`, a única parte do cadastro que o portal lê: `customers`
 * tem observações internas e dados de contrato que o cliente não vê.
 *
 * As chaves de modelo precisam bater com o registro do app: o teste
 * `lib/operations/operations.test.ts` do app lê este arquivo e trava a lista.
 */

export const CUSTOMERS_COLLECTION = "customers";
export const CLIENT_PROFILES_COLLECTION = "client_profiles";

export const OPERATION_TEMPLATE_KEYS = ["uniformes", "mobiliario", "insumos"] as const;
export type OperationTemplateKey = (typeof OPERATION_TEMPLATE_KEYS)[number];

/** Modelo da BTG. Cadastro anterior ao campo continua funcionando como hoje. */
export const DEFAULT_OPERATION_TEMPLATE: OperationTemplateKey = "uniformes";

/** Modelos sem portal: o cadastro nasce e permanece com o portal desligado. */
export const TEMPLATES_WITHOUT_PORTAL: readonly OperationTemplateKey[] = ["insumos"];

export const PORTAL_STATUSES = ["active", "inactive"] as const;
export type PortalStatus = (typeof PORTAL_STATUSES)[number];

export const CUSTOMER_STATUSES = ["active", "paused", "archived"] as const;
export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];

/** Sigla do SKU: 2 a 6 letras ou números, começando por letra (BTG, ITAU, DUT). */
export const SKU_PREFIX_PATTERN = /^[A-Z][A-Z0-9]{1,5}$/;

export function isOperationTemplateKey(value: unknown): value is OperationTemplateKey {
  return typeof value === "string" && (OPERATION_TEMPLATE_KEYS as readonly string[]).includes(value);
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

/** Maiúsculas, sem acento e sem separadores: "itaú " vira "ITAU". */
export function canonicalSkuPrefix(value: unknown): string {
  return text(value)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

export function normalizeSkuPrefix(value: unknown): string {
  const prefix = canonicalSkuPrefix(value);
  if (!prefix) {
    throw new HttpsError("invalid-argument", "Informe a sigla do SKU do cliente (2 a 6 letras ou números).");
  }
  if (!SKU_PREFIX_PATTERN.test(prefix)) {
    throw new HttpsError(
      "invalid-argument",
      `Sigla do SKU inválida: ${prefix}. Use 2 a 6 letras ou números, começando por letra.`,
    );
  }
  return prefix;
}

export function resolveOperationTemplate(value: unknown): OperationTemplateKey {
  const key = text(value);
  if (!key) return DEFAULT_OPERATION_TEMPLATE;
  if (!isOperationTemplateKey(key)) {
    throw new HttpsError(
      "invalid-argument",
      `Modelo de operação desconhecido: ${key}. Modelos: ${OPERATION_TEMPLATE_KEYS.join(", ")}.`,
    );
  }
  return key;
}

function resolvePortalStatus(value: unknown, template: OperationTemplateKey): PortalStatus {
  if (TEMPLATES_WITHOUT_PORTAL.includes(template)) return "inactive";
  const status = text(value) || "active";
  if (!(PORTAL_STATUSES as readonly string[]).includes(status)) {
    throw new HttpsError("invalid-argument", `Situação do portal inválida: ${status}.`);
  }
  return status as PortalStatus;
}

function resolveCustomerStatus(value: unknown): CustomerStatus {
  const status = text(value) || "active";
  if (status === "archived") {
    throw new HttpsError("invalid-argument", "Para arquivar um cliente use a ação de arquivar.");
  }
  if (!(CUSTOMER_STATUSES as readonly string[]).includes(status)) {
    throw new HttpsError("invalid-argument", `Situação do cliente inválida: ${status}.`);
  }
  return status as CustomerStatus;
}

export type CustomerMutation = {
  action: "create" | "update" | "archive";
  /** Campos já filtrados pela lista de escrita do callable. */
  data: Record<string, unknown>;
  /** Documento atual (vazio no create). */
  before: Record<string, unknown>;
  documentId: string;
  actorUid: string;
};

/**
 * Payload gravado em `customers`. Código e nome são obrigatórios; o código não
 * muda depois do cadastro (é o `customer_code` de todo o resto). O modelo de
 * operação e a sigla são validados aqui, nunca confiados ao navegador.
 */
export function buildCustomerPayload(mutation: CustomerMutation): Record<string, unknown> {
  const { action, data, before, documentId, actorUid } = mutation;
  if (action === "archive") {
    return {
      status: "archived",
      archived: true,
      portal_status: "inactive",
      archived_by: actorUid,
      archived_at: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp(),
    };
  }

  const code = text(data.code ?? before.code ?? documentId);
  const name = text(data.name ?? before.name);
  if (!code || !name) {
    throw new HttpsError("invalid-argument", "Código e nome do cliente são obrigatórios.");
  }
  if (action === "update" && text(before.code) && text(data.code) && text(data.code) !== text(before.code)) {
    throw new HttpsError(
      "invalid-argument",
      "O código operacional não muda depois do cadastro: ele identifica o cliente em todo o sistema.",
    );
  }

  const operationTemplate = resolveOperationTemplate(data.operation_template ?? before.operation_template);
  const skuPrefix = normalizeSkuPrefix(data.sku_prefix ?? before.sku_prefix);
  const portalStatus = resolvePortalStatus(data.portal_status ?? before.portal_status, operationTemplate);

  return {
    ...data,
    id: documentId,
    code,
    name,
    customer_code: code,
    status: resolveCustomerStatus(data.status ?? before.status),
    portal_status: portalStatus,
    operation_template: operationTemplate,
    sku_prefix: skuPrefix,
    billing_mode: text(data.billing_mode ?? before.billing_mode) || "lpu",
    default_currency: text(data.default_currency ?? before.default_currency) || "BRL",
    archived: false,
    ...(action === "create"
      ? { created_by: actorUid, created_at: FieldValue.serverTimestamp() }
      : { updated_by: actorUid }),
    updated_at: FieldValue.serverTimestamp(),
  };
}

/** Campos do cadastro que o portal pode ver. Nada de contrato nem observação. */
export const CLIENT_PROFILE_PUBLIC_FIELDS = [
  "customer_code",
  "name",
  "operation_template",
  "sku_prefix",
  "portal_status",
  "status",
  "archived",
] as const;

/**
 * Projeção `client_profiles/{id}`: o que o portal lê para montar o menu e as
 * regras do modelo. Gravada na mesma transação do cadastro; no arquivamento,
 * o portal fica desligado e o restante vem do documento anterior.
 */
export function clientProfileProjection(
  documentId: string,
  payload: Record<string, unknown>,
  before: Record<string, unknown>,
): Record<string, unknown> {
  const merged = { ...before, ...payload };
  const customerCode = text(merged.customer_code ?? merged.code) || documentId;
  return {
    id: documentId,
    customer_code: customerCode,
    name: text(merged.name) || customerCode,
    operation_template: isOperationTemplateKey(merged.operation_template)
      ? merged.operation_template
      : DEFAULT_OPERATION_TEMPLATE,
    sku_prefix: canonicalSkuPrefix(merged.sku_prefix) || null,
    portal_status: merged.archived === true ? "inactive" : text(merged.portal_status) || "active",
    status: text(merged.status) || "active",
    archived: merged.archived === true,
    updated_at: FieldValue.serverTimestamp(),
  };
}

/**
 * A sigla é única entre clientes não arquivados: dois clientes com a mesma
 * sigla gerariam o mesmo SKU. Leitura dentro da transação, antes de qualquer
 * escrita.
 */
export async function assertSkuPrefixAvailable(
  transaction: Transaction,
  db: Firestore,
  prefix: string,
  documentId: string,
): Promise<void> {
  const snapshot = await transaction.get(
    db.collection(CUSTOMERS_COLLECTION).where("sku_prefix", "==", prefix),
  );
  const conflict = snapshot.docs.find(
    (row) => row.id !== documentId && row.get("archived") !== true && row.get("status") !== "archived",
  );
  if (conflict) {
    throw new HttpsError(
      "already-exists",
      `A sigla ${prefix} já é do cliente ${text(conflict.get("name")) || conflict.id}.`,
    );
  }
}
