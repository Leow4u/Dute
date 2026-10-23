import { useQuery } from "@tanstack/react-query";

import { buildHomeInbox, type HomeInbox, type HomeRequest } from "./home-inbox";
import { MEMORIA_LIBERADA } from "./liberacao";
import { ALERTA_PARADO_ROLES, alertaLido, type AlertaProposto } from "./memoria/alertas";
import { canAccessModule, COORDINATION_NAV_ROLES, WMS_ROLES, type ProfileRole } from "./modules";
import type { WarehouseOpsResponse } from "./warehouse-ops/model";

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.message ?? "Falha ao carregar dados.");
  }
  return response.json() as Promise<T>;
}

export type InicioDoWms = HomeInbox & {
  carregando: boolean;
  /** As fontes que não carregaram, em palavras ("armazém", "solicitações"). */
  falhas: string[];
};

/**
 * As leituras do Início do WMS (o armazém, as solicitações do portal e, onde
 * a memória roda, os alertas de itens parados para aprovar). A
 * entrada usa as mesmas chaves para o contador do card: a leitura sai uma
 * vez. `ligado` falso não consulta nada.
 */
export function useInicioDoWms(role: ProfileRole | null | undefined, ligado = true): InicioDoWms {
  const seesWarehouse = ligado && canAccessModule(role, WMS_ROLES);
  const seesRequests = ligado && canAccessModule(role, COORDINATION_NAV_ROLES);
  const seesAlerts = ligado && MEMORIA_LIBERADA && canAccessModule(role, ALERTA_PARADO_ROLES);
  const ops = useQuery({
    queryKey: ["warehouse-ops"],
    queryFn: () => fetchJson<WarehouseOpsResponse>("/api/warehouse/ops"),
    enabled: seesWarehouse,
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
  });
  const requests = useQuery({
    queryKey: ["customer-requests", "home"],
    queryFn: () => fetchJson<{ items?: HomeRequest[] }>("/api/customer-requests?limit=200"),
    enabled: seesRequests,
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
  });
  // A mesma chave da tela Estoque › Alertas: a decisão lá atualiza o Início.
  const alerts = useQuery({
    queryKey: ["stock-alerts"],
    queryFn: () => fetchJson<{ items?: Record<string, unknown>[] }>("/api/stock-alerts"),
    enabled: seesAlerts,
    refetchInterval: 120_000,
    refetchOnWindowFocus: false,
  });
  const stockAlerts = (alerts.data?.items ?? [])
    .map(alertaLido)
    .filter((alerta): alerta is AlertaProposto => alerta !== null)
    .map((alerta) => ({ id: alerta.id, customer_code: alerta.customerCode, itens: alerta.itens.length }));
  const inbox = buildHomeInbox({ role, ops: ops.data, requests: requests.data?.items, stockAlerts });
  return {
    ...inbox,
    carregando: (seesWarehouse && ops.isLoading) || (seesRequests && requests.isLoading) || (seesAlerts && alerts.isLoading),
    falhas: [seesWarehouse && ops.isError ? "armazém" : null, seesRequests && requests.isError ? "solicitações" : null, seesAlerts && alerts.isError ? "alertas" : null].filter(
      (fonte): fonte is string => Boolean(fonte),
    ),
  };
}
