import { getListBillingUsersQueryKey, useListBillingUsers } from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { collection, getDocs } from "firebase/firestore";
import { useEffect, useMemo, useRef } from "react";

import { firestore } from "@/lib/firebase";
import { buildPeople, type Invite, type Person } from "@/lib/pessoas";

/**
 * A leitura de Pessoas e acessos: os perfis (a rota de usuários) e os
 * convites pendentes (Firestore). A página de Pessoas e a página do cliente
 * leem pela mesma chave. Convite aceito vira pessoa ativa: quando o convite
 * que estava pendente aparece usado, a lista de perfis é lida de novo.
 */

export const INVITES_QUERY_KEY = ["invites"] as const;

export function usePessoas({ convites = true }: { convites?: boolean } = {}) {
  const qc = useQueryClient();
  const users = useListBillingUsers();
  const invites = useQuery({
    queryKey: INVITES_QUERY_KEY,
    // A galeria de Clientes só conta quem entra; os convites, só na página do cliente.
    enabled: convites,
    refetchInterval: (query) => (query.state.data?.some((invite) => invite.status === "pending") ? 30_000 : false),
    queryFn: async (): Promise<Invite[]> => {
      if (!firestore) return [];
      const snapshot = await getDocs(collection(firestore, "invites"));
      return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as Invite);
    },
  });

  const pendingInviteIds = useRef(new Set<string>());
  useEffect(() => {
    if (!invites.data) return;
    const accepted = invites.data.some((invite) => invite.status === "used" && pendingInviteIds.current.has(invite.id));
    pendingInviteIds.current = new Set(invites.data.filter((invite) => invite.status === "pending").map((invite) => invite.id));
    if (accepted) void qc.invalidateQueries({ queryKey: getListBillingUsersQueryKey() });
  }, [invites.data, qc]);

  const people = useMemo<Person[]>(
    () => buildPeople((users.data?.items ?? []) as unknown as Array<Record<string, unknown>>, invites.data ?? []),
    [users.data, invites.data],
  );

  const refresh = async () => {
    await Promise.all([qc.invalidateQueries({ queryKey: getListBillingUsersQueryKey() }), invites.refetch()]);
  };

  return {
    people,
    carregando: Boolean(users.isLoading || invites.isLoading),
    erro: Boolean(users.isError || invites.isError),
    tentando: Boolean(users.isFetching || invites.isFetching),
    refresh,
  };
}
