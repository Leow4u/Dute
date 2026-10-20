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
/**
 * Módulos contratados por `customer_code` (o id é o código cru). Existe para
 * as regras do Firestore e as Functions acharem o contrato sem consulta: o id
 * de `client_profiles` é o do cadastro, não o código. Só as Functions gravam,
 * em toda escrita do cadastro, e nunca apagam.
 */
export const CLIENT_ACCESS_COLLECTION = "client_access";

/**
 * Módulos que o cliente contrata (docs/plataforma/fase-2-nucleo.md). Iguais a
 * MODULOS_CONTRATAVEIS de lib/dominio: o teste platform-lists do app trava.
 * `financeiro` são as faturas no portal.
 */
export const CONTRACTED_MODULE_KEYS = ["wms", "operacao", "financeiro"] as const;
export type ContractedModule = (typeof CONTRACTED_MODULE_KEYS)[number];

/** Cadastro anterior ao campo: o que a BTG tem hoje (armazenagem e faturas). */
export const DEFAULT_CONTRACTED_MODULES = ["wms", "financeiro"] as const;

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

export function isContractedModule(value: unknown): value is ContractedModule {
  return typeof value === "string" && (CONTRACTED_MODULE_KEYS as readonly string[]).includes(value);
}

/**
 * Módulos contratados vindos do cadastro. Ausente vale o padrão; o resto
 * precisa ser uma lista de chaves conhecidas com ao menos um módulo. Volta
 * sem repetição e na ordem do registro.
 */
export function resolveContractedModules(value: unknown): ContractedModule[] {
  if (value === undefined || value === null) return [...DEFAULT_CONTRACTED_MODULES];
  if (!Array.isArray(value)) {
    throw new HttpsError("invalid-argument", "Informe os módulos contratados como uma lista.");
  }
  const chosen = new Set<string>();
  for (const item of value) {
    const key = text(item);
    if (!isContractedModule(key)) {
      throw new HttpsError(
        "invalid-argument",
        `Módulo desconhecido: ${key || "(vazio)"}. Módulos: ${CONTRACTED_MODULE_KEYS.join(", ")}.`,
      );
    }
    chosen.add(key);
  }
  if (!chosen.size) {
    throw new HttpsError("invalid-argument", "Marque ao menos um módulo contratado.");
  }
  return CONTRACTED_MODULE_KEYS.filter((key) => chosen.has(key));
}

/**
 * Leitura de um registro já gravado (projeção, perfil). Nunca lança: sem o
 * campo, ou sem nenhum módulo conhecido, vale o padrão.
 */
export function contractedModulesFrom(value: unknown): ContractedModule[] {
  if (!Array.isArray(value)) return [...DEFAULT_CONTRACTED_MODULES];
  const known = CONTRACTED_MODULE_KEYS.filter((key) => value.includes(key));
  return known.length ? known : [...DEFAULT_CONTRACTED_MODULES];
}

/**
 * O código do cliente vira id de documento em `client_access` e caminho nas
 * regras do Firestore: sem `/`, sem `.` ou `..` e sem o formato reservado
 * `__x__`. Mensagem do problema, ou null quando o código serve.
 */
export function customerCodeProblem(code: string): string | null {
  if (!code) return "Informe o código operacional do cliente.";
  if (code.includes("/")) return "O código operacional não pode ter barra (/).";
  if (code === "." || code === "..") return "Código operacional inválido.";
  if (/^__.*__$/.test(code)) return "Código operacional inválido.";
  if (Buffer.byteLength(code, "utf8") > 1500) return "Código operacional longo demais.";
  return null;
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
  if (action === "create") {
    const problem = customerCodeProblem(code);
    if (problem) throw new HttpsError("invalid-argument", problem);
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
    // Depois do `...data`: o navegador não grava a lista crua. Alteração
    // que não manda o campo mantém o que estava.
    modules: resolveContractedModules(data.modules ?? before.modules),
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
  "modules",
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
    modules: contractedModulesFrom(merged.modules),
    updated_at: FieldValue.serverTimestamp(),
  };
}

/**
 * Projeção `client_access/{customer_code}`: os módulos contratados, achados
 * pelo código sem consulta (regras do Firestore e Functions). Calculada de
 * `{...before, ...payload}`, então o arquivamento mantém os módulos. Código
 * que não serve de id (cadastro antigo com barra) fica sem projeção e vale o
 * padrão.
 */
export function clientAccessProjection(
  documentId: string,
  payload: Record<string, unknown>,
  before: Record<string, unknown>,
): { customerCode: string; data: Record<string, unknown> } | null {
  const merged = { ...before, ...payload };
  const customerCode = text(merged.customer_code ?? merged.code) || documentId;
  if (customerCodeProblem(customerCode)) return null;
  return {
    customerCode,
    data: {
      customer_code: customerCode,
      customer_id: documentId,
      modules: contractedModulesFrom(merged.modules),
      updated_at: FieldValue.serverTimestamp(),
    },
  };
}

/** Módulos contratados do cliente, pelo código. Sem projeção vale o padrão. */
export async function readContractedModules(
  db: Firestore,
  customerCode: string,
): Promise<ContractedModule[]> {
  const code = text(customerCode);
  if (customerCodeProblem(code)) return [...DEFAULT_CONTRACTED_MODULES];
  const snapshot = await db.collection(CLIENT_ACCESS_COLLECTION).doc(code).get();
  return contractedModulesFrom(snapshot.exists ? snapshot.get("modules") : undefined);
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

/**
 * O código operacional identifica o cliente em todo o sistema e é o id de
 * `client_access`: dois cadastros com o mesmo código disputariam o mesmo
 * contrato. Vale também contra cadastro arquivado. Leitura dentro da
 * transação, antes de qualquer escrita.
 */
export async function assertCustomerCodeAvailable(
  transaction: Transaction,
  db: Firestore,
  code: string,
  documentId: string,
): Promise<void> {
  const [byCode, byCustomerCode] = await Promise.all([
    transaction.get(db.collection(CUSTOMERS_COLLECTION).where("code", "==", code)),
    transaction.get(db.collection(CUSTOMERS_COLLECTION).where("customer_code", "==", code)),
  ]);
  const conflict = [...byCode.docs, ...byCustomerCode.docs].find((row) => row.id !== documentId);
  if (conflict) {
    throw new HttpsError(
      "already-exists",
      `O código ${code} já é do cliente ${text(conflict.get("name")) || conflict.id}.`,
    );
  }
}
