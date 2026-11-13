import { getListBillingUsersQueryKey, useListBillingUsers } from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { collection } from "firebase/firestore";
import { useEffect, useMemo, useRef } from "react";

import { useLeituraComFalha } from "@/lib/carregando/use-leitura-com-falha";
import { lerDocsDoServidor } from "@/lib/cloud-api";
import { semConexaoNaLeitura, type LeituraNaTela } from "@/lib/conexao";
import { firestore } from "@/lib/firebase";
import { buildPeople, type Invite, type Person } from "@/lib/pessoas";

/**
 * A leitura de Pessoas e acessos: os perfis (a rota de usuários) e os
 * convites pendentes (Firestore). A página de Pessoas e a página do cliente
 * leem pela mesma chave. Convite aceito vira pessoa ativa: quando o convite
 * que estava pendente aparece usado, a lista de perfis é lida de novo.
 *
 * Os convites leem o Firestore pelo `lib/cloud-api.ts` (carregamento v2,
 * parte 13e; diagnóstico, 9.4): sem rede, a leitura que só achou o cache é
 * falta de conexão, e não a lista velha ou vazia, e o app relê sozinho (parte
 * 7a). A falha só toma o lugar da lista quando não há nada lido; com a lista
 * na tela, a releitura que falha (os convites a cada 30 s) não a apaga, e a
 * falta de conexão fica na faixa com a hora da leitura (`falta`).
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
      const snapshot = await lerDocsDoServidor(collection(firestore, "invites"));
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

  // A nova tentativa sem dado não volta a "carregando": a falha fica na tela, com "Tentando de novo…".
  const usuarios = useLeituraComFalha(users);
  const convitesLidos = useLeituraComFalha(invites);
  const leituras = [usuarios, ...(convites ? [convitesLidos] : [])];
  // Sem nada lido, a falha toma o lugar da lista; lida, a releitura que falha não a apaga.
  const semNada = leituras.some((leitura) => leitura.isError && leitura.data === undefined);
  const falta = semConexaoNaLeitura(...(leituras as LeituraNaTela[]));

  return {
    people,
    carregando: !semNada && leituras.some((leitura) => leitura.isLoading),
    erro: semNada,
    /** A falta de conexão: a hora da lista na tela, ou `null` sem nada lido; sem falta, `null`. */
    falta,
    tentando: leituras.some((leitura) => leitura.isFetching),
    refresh,
  };
}
