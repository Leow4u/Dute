import { useQuery } from "@tanstack/react-query";

import { buildHomeInbox, type HomeInbox, type HomeRequest } from "./home-inbox";
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
 * As leituras do Início do WMS (o armazém e as solicitações do portal). A
 * entrada usa as mesmas chaves para o contador do card: a leitura sai uma
 * vez. `ligado` falso não consulta nada.
 */
export function useInicioDoWms(role: ProfileRole | null | undefined, ligado = true): InicioDoWms {
  const seesWarehouse = ligado && canAccessModule(role, WMS_ROLES);
  const seesRequests = ligado && canAccessModule(role, COORDINATION_NAV_ROLES);
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
  const inbox = buildHomeInbox({ role, ops: ops.data, requests: requests.data?.items });
  return {
    ...inbox,
    carregando: (seesWarehouse && ops.isLoading) || (seesRequests && requests.isLoading),
    falhas: [seesWarehouse && ops.isError ? "armazém" : null, seesRequests && requests.isError ? "solicitações" : null].filter(
      (fonte): fonte is string => Boolean(fonte),
    ),
  };
}
