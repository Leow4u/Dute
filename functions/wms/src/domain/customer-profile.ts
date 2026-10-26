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

/**
 * Estágio do cadastro (docs/plataforma/fase-6-comercial.md). `customers` é a
 * lista única de empresas: o prospect (recebeu orçamento, ainda não é
 * cliente) mora aqui com `stage: "prospect"`, gravado só pelo Comercial, sem
 * sigla, modelo, módulos nem projeções. O WMS não grava `stage` e não altera
 * nem arquiva prospect. Igual a ESTAGIOS_CADASTRO de lib/dominio: o teste
 * platform-lists do app trava.
 */
export const CUSTOMER_STAGES = ["prospect", "cliente"] as const;
export type CustomerStage = (typeof CUSTOMER_STAGES)[number];

/** Leitura tolerante do estágio: sem o campo (a BTG e os cadastros de hoje), cliente. */
export function customerStage(value: unknown): CustomerStage {
  return text(value).toLowerCase() === "prospect" ? "prospect" : "cliente";
}

export function isProspect(record: Record<string, unknown> | null | undefined): boolean {
  return customerStage(record?.stage) === "prospect";
}

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
  const { action, before, documentId, actorUid } = mutation;
  // O estágio é do Comercial: o WMS nunca grava `stage`.
  const { stage: _stage, ...data } = mutation.data;
  if (action !== "create" && isProspect(before)) {
    throw new HttpsError(
      "failed-precondition",
      "Este cadastro é um prospect do Comercial: ele não é alterado nem arquivado pelo WMS.",
    );
  }
  if (action === "archive" && !canonicalSkuPrefix(before.sku_prefix)) {
    // Arquivar grava client_profiles e client_access com os módulos padrão
    // (wms e financeiro): o cadastro sem armazenagem ganharia acesso ao portal.
    throw new HttpsError(
      "failed-precondition",
      "Cliente sem sigla do SKU não é arquivado pelo WMS: ele não tem armazenagem.",
    );
  }
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
 * O portal do cliente ligado: o cadastro não está arquivado nem "Sem portal"
 * (o modelo sem portal já grava "Sem portal"). Arquivar e "Sem portal"
 * cortam o portal; os logins ficam (pergunta 69, decidida em 26/10/2026).
 */
export function portalAtivoDoCadastro(record: Record<string, unknown>): boolean {
  if (record.archived === true || text(record.status) === "archived") return false;
  return (text(record.portal_status) || "active") === "active";
}

/**
 * Leitura de `client_access.portal_ativo`. Sem o documento, ou sem o campo (a
 * projeção gravada antes da pergunta 69), o portal segue ligado, como antes.
 */
export function portalAtivoFrom(value: unknown): boolean {
  return value !== false;
}

/**
 * Projeção `client_access/{customer_code}`: os módulos contratados e o portal
 * ligado, achados pelo código sem consulta (regras do Firestore e
 * Functions). Calculada de `{...before, ...payload}`, então o arquivamento
 * mantém os módulos e desliga o portal. Código que não serve de id (cadastro
 * antigo com barra) fica sem projeção e vale o padrão.
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
      portal_ativo: portalAtivoDoCadastro(merged),
      updated_at: FieldValue.serverTimestamp(),
    },
  };
}

export type ClientAccess = { modules: ContractedModule[]; portalAtivo: boolean };

/** Módulos contratados e portal do cliente, pelo código. Sem projeção vale o padrão, com o portal ligado. */
export async function readClientAccess(db: Firestore, customerCode: string): Promise<ClientAccess> {
  const code = text(customerCode);
  if (customerCodeProblem(code)) return { modules: [...DEFAULT_CONTRACTED_MODULES], portalAtivo: true };
  const snapshot = await db.collection(CLIENT_ACCESS_COLLECTION).doc(code).get();
  return {
    modules: contractedModulesFrom(snapshot.exists ? snapshot.get("modules") : undefined),
    portalAtivo: portalAtivoFrom(snapshot.exists ? snapshot.get("portal_ativo") : undefined),
  };
}

/** Módulos contratados do cliente, pelo código. Sem projeção vale o padrão. */
export async function readContractedModules(
  db: Firestore,
  customerCode: string,
): Promise<ContractedModule[]> {
  return (await readClientAccess(db, customerCode)).modules;
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
 * Código comparado na unicidade: sem acento, sem diferenciar maiúsculas e sem
 * separador (espaço, hífen, ponto). "Itau" e "ITAÚ" são o mesmo código, e
 * "BTG Pactual" (WMS) e "BTG-PACTUAL" (o Comercial só usa letras, números e
 * hífen) também. O acento vira `_` no id do documento, então só o id não
 * pegaria a colisão.
 */
export function canonicalCustomerCode(value: unknown): string {
  return text(value)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

/** CNPJ sem máscara: 12 letras ou números e 2 dígitos verificadores (IN RFB 2.229/2024). */
const CNPJ_PATTERN = /^[0-9A-Z]{12}[0-9]{2}$/;

/** Dígito verificador do CNPJ, numérico ou alfanumérico (cada caractere vale o código ASCII menos 48). */
function cnpjCheckDigit(base: string): number {
  let weight = 2;
  let sum = 0;
  for (let index = base.length - 1; index >= 0; index -= 1) {
    sum += (base.charCodeAt(index) - 48) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

function isValidCnpj(cnpj: string): boolean {
  if (!CNPJ_PATTERN.test(cnpj) || /^0+$/.test(cnpj)) return false;
  const first = cnpjCheckDigit(cnpj.slice(0, 12));
  const second = cnpjCheckDigit(`${cnpj.slice(0, 12)}${first}`);
  return cnpj.endsWith(`${first}${second}`);
}

/**
 * Raiz do CNPJ (8 primeiros caracteres), tirada de `document` sem máscara.
 * Vale o CNPJ numérico e o alfanumérico, só com os dígitos verificadores
 * certos: CPF, texto livre, número incompleto ou preenchimento provisório
 * ("00.000.000/0000-00") não têm raiz e não entram na comparação. A raiz
 * 00000000 existe (Banco do Brasil) e conta.
 */
export function cnpjRoot(value: unknown): string | null {
  const raw = text(value).toUpperCase();
  const cnpj = [raw.replace(/[^0-9A-Z]/g, ""), raw.replace(/\D/g, "")].find(isValidCnpj);
  return cnpj ? cnpj.slice(0, 8) : null;
}

export type CustomerIdentityCandidate = {
  code: unknown;
  document?: unknown;
  /** Id do documento que está sendo gravado: não conflita consigo mesmo. */
  documentId: string;
};

export type CustomerIdentityRow = { id: string; data: Record<string, unknown> };

/**
 * Conflito de identidade de um cadastro novo contra todos os outros,
 * inclusive arquivados e prospects: o código (canônico, contra `code` e
 * `customer_code`) e, quando vier, a raiz do CNPJ. Mensagem do conflito, ou
 * null. O Comercial (functions/comercial) usa a mesma regra.
 */
export function customerIdentityConflict(
  candidate: CustomerIdentityCandidate,
  rows: readonly CustomerIdentityRow[],
): string | null {
  const code = text(candidate.code);
  const canonical = canonicalCustomerCode(code);
  // Código sem letra nem número: a comparação volta a ser exata.
  const sameCode = (existing: string) =>
    canonical ? canonicalCustomerCode(existing) === canonical : existing === code;
  const root = cnpjRoot(candidate.document);
  const others = rows.filter((row) => row.id !== candidate.documentId);
  // O prospect não aparece no WMS: a mensagem diz onde ele está.
  const ownerOf = (row: CustomerIdentityRow) => {
    const name = text(row.data.name) || row.id;
    return isProspect(row.data) ? `do prospect ${name}, no Comercial` : `do cliente ${name}`;
  };

  if (code) {
    for (const row of others) {
      const taken = [row.data.code, row.data.customer_code].map(text).find((existing) => existing && sameCode(existing));
      if (taken === undefined) continue;
      const detail = taken === code ? "" : ` (cadastrado como ${taken})`;
      return `O código ${code} já é ${ownerOf(row)}${detail}.`;
    }
  }
  if (root) {
    const conflict = others.find((row) => cnpjRoot(row.data.document) === root);
    if (conflict) {
      return `A raiz do CNPJ ${root} já é ${ownerOf(conflict)}. Filiais ficam no mesmo cadastro.`;
    }
  }
  return null;
}

/**
 * O código operacional identifica o cliente em todo o sistema e é o id de
 * `client_access`: dois cadastros com o mesmo código disputariam o mesmo
 * contrato. A raiz do CNPJ também é única: há um cadastro por empresa. Lê o
 * cadastro inteiro (centenas de documentos) dentro da transação, antes de
 * qualquer escrita, e compara em memória: funciona com cadastro antigo, sem
 * campo novo.
 */
export async function assertCustomerIdentityAvailable(
  transaction: Transaction,
  db: Firestore,
  candidate: CustomerIdentityCandidate,
): Promise<void> {
  const snapshot = await transaction.get(db.collection(CUSTOMERS_COLLECTION));
  const problem = customerIdentityConflict(
    candidate,
    snapshot.docs.map((row) => ({ id: row.id, data: row.data() })),
  );
  if (problem) throw new HttpsError("already-exists", problem);
}
