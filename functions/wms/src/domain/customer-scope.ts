import { HttpsError } from "firebase-functions/https";

/**
 * Isolamento entre clientes nas trilhas de estoque, agora que a área interna
 * opera o cliente ativo (docs/multicliente-modelos-de-operacao.md, PR 1b).
 *
 * O cliente legado é a BTG: registro sem `customer_code` (anterior ao
 * multicliente) é dela, e `system_controls/inventory` guarda a abertura dela
 * (zeragem de 16/10/2026) e a base do faturamento atual. Os outros clientes
 * seguem só a própria sessão de abertura e o próprio cadastro.
 */
export const LEGACY_CUSTOMER_CODE = "BTG Pactual";

type Data = Record<string, unknown> | null | undefined;

function text(value: unknown): string {
  if (typeof value === "string") return value.trim();
  return value == null ? "" : String(value).trim();
}

/** Dono de um registro (catálogo, saldo, evento): sem `customer_code`, o cliente legado. */
export function recordOwner(data: Data): string {
  return text(data?.customer_code) || LEGACY_CUSTOMER_CODE;
}

/** A abertura deste cliente escreve em `system_controls/inventory`? Só a do cliente legado. */
export function openingUsesGlobalControl(customerCode: string): boolean {
  return text(customerCode) === LEGACY_CUSTOMER_CODE;
}

/**
 * Pedido de saída travado pelo inventário de abertura?
 *
 * Cliente legado: o controle global, como sempre foi (pendente depois da
 * zeragem, em curso durante a contagem, liberado na conclusão). Outro
 * cliente: só a própria sessão, aberta trava; sem sessão ele começou pelo
 * recebimento e não espera a contagem de ninguém.
 */
export function openingInventoryBlocksOutbound(input: {
  customerCode: string;
  control?: Data;
  session?: Data;
}): boolean {
  if (openingUsesGlobalControl(input.customerCode)) {
    const control = input.control ?? {};
    return control.stock_initialized === false || control.opening_inventory_required === true;
  }
  return text(input.session?.status) === "open";
}

/**
 * Um código de catálogo tem dono. A operação de um cliente não reaproveita
 * produto nem SKU de outro: o catálogo ainda é um só (o SKU por cliente vem
 * no PR 2) e somar estoque no cadastro alheio misturaria os clientes.
 * Arquivado também conta: reativá-lo tomaria o histórico do outro cliente.
 */
export function assertCatalogOwnedBy(customerCode: string, records: Data[], subject: string): void {
  const customer = text(customerCode);
  for (const data of records) {
    if (!data) continue;
    const owner = recordOwner(data);
    if (owner !== customer) {
      throw new HttpsError(
        "failed-precondition",
        `${subject} já está cadastrado para o cliente ${owner}. Cada cliente usa o próprio cadastro: confira o cliente ativo ou use outro código.`,
        { code: "CATALOG_OWNED_BY_OTHER_CUSTOMER", owner },
      );
    }
  }
}

/**
 * Destinatários padrão de uma notificação (variáveis de ambiente). A lista de
 * e-mails do cliente é a do contrato legado: e-mail de outro cliente nunca
 * cai nela; sem destinatário próprio, a entrega para e avisa.
 */
export function defaultNotificationRecipients(input: {
  audience: string;
  customerCode: string;
  clientDefaults: string[];
  internalDefaults: string[];
}): string[] {
  if (input.audience !== "client") return input.internalDefaults;
  return text(input.customerCode || LEGACY_CUSTOMER_CODE) === LEGACY_CUSTOMER_CODE
    ? input.clientDefaults
    : [];
}
