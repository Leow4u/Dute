import { useQuery } from "@tanstack/react-query";

import { useAppUser } from "./auth";
import {
  resolveOperationProfile,
  type CustomerProfileRecord,
  type OperationProfile,
} from "./operations";
import { fetchJson } from "./warehouse-ops/model";

/**
 * Perfil de operação do cliente logado (modelo + pacote, lib/operations),
 * lido da projeção `client_profiles` que as Functions publicam junto com o
 * cadastro. O portal monta o menu e as rotas com ele. Na área interna o
 * perfil é null: nada é filtrado (o cliente ativo vem no próximo PR).
 */

export const OPERATION_PROFILE_QUERY_KEY = "operation-profile";

type ClientProfileResponse = {
  customer_code?: string;
  profile: CustomerProfileRecord | null;
};

export type OperationProfileState = {
  profile: OperationProfile | null;
  /** Só no portal: true até a primeira leitura terminar. */
  isLoading: boolean;
};

export function useOperationProfile(): OperationProfileState {
  const { user } = useAppUser();
  const role = user?.publicMetadata.role;
  const customerCode = user?.publicMetadata.customer_code ?? null;
  const isClient = role === "cliente";

  const query = useQuery({
    queryKey: [OPERATION_PROFILE_QUERY_KEY, customerCode],
    queryFn: async () => {
      const payload = await fetchJson<ClientProfileResponse>("/api/client/profile");
      return resolveOperationProfile(
        payload.profile,
        payload.customer_code || customerCode || undefined,
      );
    },
    enabled: isClient,
    staleTime: 5 * 60_000,
    retry: 1,
  });

  if (!isClient) return { profile: null, isLoading: false };
  if (query.isError) {
    // Sem leitura (offline, regra): o modelo padrão, que é o do portal de hoje.
    return { profile: resolveOperationProfile(null, customerCode ?? undefined), isLoading: false };
  }
  return { profile: query.data ?? null, isLoading: query.isPending };
}
