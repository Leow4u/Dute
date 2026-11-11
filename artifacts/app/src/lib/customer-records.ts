import { useQuery } from "@tanstack/react-query";

import type { CustomerRecord } from "./customer-registry";

/**
 * A leitura do cadastro de clientes que Configurações › Clientes e Pessoas e
 * acessos fazem: a mesma chave e a mesma rota, então o que uma tela leu a
 * outra aproveita, e salvar um cliente atualiza as duas.
 */
export const CUSTOMERS_QUERY_KEY = ["admin-customers"] as const;

type CustomersResponse = { items?: CustomerRecord[]; data?: CustomerRecord[]; message?: string } | CustomerRecord[];

export async function fetchCustomerRecords(): Promise<CustomerRecord[]> {
  const response = await fetch("/api/customers?limit=250", { headers: { "content-type": "application/json" } });
  const payload = (await response.json().catch(() => ({}))) as CustomersResponse;
  if (!response.ok) {
    const message = Array.isArray(payload) ? undefined : payload.message;
    throw new Error(message || "Não foi possível concluir a operação.");
  }
  return Array.isArray(payload) ? payload : (payload.items ?? payload.data ?? []);
}

export function useCustomerRecords(enabled = true) {
  return useQuery({ queryKey: CUSTOMERS_QUERY_KEY, queryFn: fetchCustomerRecords, enabled });
}
