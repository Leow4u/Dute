import { LEGACY_CUSTOMER_CODE } from "./active-customer";

export function billingDocumentId(customerCode: string, competencia: string): string {
  const customer = customerCode.trim().replace(/[^\w.-]/g, "_").slice(0, 200);
  return `${customer}__${competencia}`;
}

/** Documento antigo, sem customer_code, é da BTG. */
export function periodBelongsToCustomer(
  period: { id?: unknown; customer_code?: unknown; competencia?: unknown },
  customerCode: string,
): boolean {
  const code = typeof period.customer_code === "string" ? period.customer_code.trim() : "";
  if (code) return code === customerCode;
  const id = typeof period.id === "string" ? period.id : "";
  return customerCode === LEGACY_CUSTOMER_CODE && /^\d{4}-\d{2}$/.test(id);
}
