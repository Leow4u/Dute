import { estagioDoCadastro } from "@workspace/dominio";

import {
  LEGACY_CUSTOMER_CODE,
  resolveOperationProfile,
  type CustomerProfileRecord,
  type OperationProfile,
} from "./operations";

export { LEGACY_CUSTOMER_CODE };

/**
 * Cliente ativo da área interna (docs/multicliente-modelos-de-operacao.md,
 * PR 1b). A equipe opera todos os clientes no mesmo galpão: o seletor no menu
 * diz para qual cliente vão o recebimento, a contagem, as caixas, as
 * etiquetas, os documentos e as notas do agente, e de qual cliente são os
 * itens listados. Mapa, Início e Pedidos continuam mostrando todos.
 *
 * O cliente legado é a BTG: registro sem `customer_code` é dela, e ela entra
 * no seletor mesmo antes de o cadastro dela ser salvo de novo em
 * Configurações › Clientes (que publica o perfil em `client_profiles`).
 */

/** Código da própria Dutelog: perfis internos, incidentes do sistema, insumos. */
export const INTERNAL_CUSTOMER_CODE = "Dutelog";

export type ActiveCustomerOption = {
  code: string;
  name: string;
  profile: OperationProfile;
  paused: boolean;
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

/** Dono de um registro: sem `customer_code`, o cliente legado. */
export function recordCustomerCode(record: { customer_code?: unknown } | null | undefined): string {
  return text(record?.customer_code) || LEGACY_CUSTOMER_CODE;
}

/** O registro é do cliente? Registro sem `customer_code` conta como do legado. */
export function belongsToCustomer(
  record: { customer_code?: unknown } | null | undefined,
  customerCode: string,
): boolean {
  return recordCustomerCode(record) === customerCode;
}

/** Só as linhas do cliente (catálogo, saldos): sem `customer_code`, são do legado. */
export function customerRows<T extends { customer_code?: unknown }>(
  rows: T[] | null | undefined,
  customerCode: string,
): T[] {
  return (rows ?? []).filter((row) => belongsToCustomer(row, customerCode));
}

/**
 * Opções do seletor: perfis publicados que não estão arquivados, por nome.
 * O cliente legado entra sempre, com o perfil padrão se ainda não publicou.
 */
export function activeCustomerOptions(
  records: Array<CustomerProfileRecord & { id?: string }> | null | undefined,
): ActiveCustomerOption[] {
  const byCode = new Map<string, ActiveCustomerOption>();
  for (const record of records ?? []) {
    const code = text(record.customer_code ?? record.code ?? record.id);
    if (!code || byCode.has(code)) continue;
    if (record.archived === true || record.status === "archived") continue;
    const profile = resolveOperationProfile({ ...record, customer_code: code }, code);
    byCode.set(code, {
      code,
      name: profile.customerName,
      profile,
      paused: record.status === "paused",
    });
  }
  if (!byCode.has(LEGACY_CUSTOMER_CODE)) {
    const profile = resolveOperationProfile(null, LEGACY_CUSTOMER_CODE);
    byCode.set(LEGACY_CUSTOMER_CODE, {
      code: LEGACY_CUSTOMER_CODE,
      name: profile.customerName,
      profile,
      paused: false,
    });
  }
  return [...byCode.values()].sort((left, right) => left.name.localeCompare(right.name, "pt-BR"));
}

/**
 * As opções do comercial, que não lê `client_profiles` (parte 5.5j): o
 * cadastro de clientes, sem os prospects. É o cliente do Agent Dute do
 * Comercial, e o servidor confere de novo.
 */
export function commercialCustomerOptions(
  records: Array<CustomerProfileRecord & { id?: string; stage?: unknown }> | null | undefined,
): ActiveCustomerOption[] {
  return activeCustomerOptions((records ?? []).filter((record) => estagioDoCadastro(record.stage) !== "prospect"));
}

/** O guardado neste aparelho, se ainda existir; senão o legado; senão o primeiro. */
export function resolveActiveCustomerCode(
  options: ActiveCustomerOption[],
  stored: string | null | undefined,
): string {
  const wanted = text(stored);
  if (wanted && options.some((option) => option.code === wanted)) return wanted;
  if (options.some((option) => option.code === LEGACY_CUSTOMER_CODE)) return LEGACY_CUSTOMER_CODE;
  return options[0]?.code ?? LEGACY_CUSTOMER_CODE;
}

export function activeCustomerStorageKey(uid: string | null | undefined): string {
  return `dute.active-customer.${text(uid) || "anon"}`;
}
