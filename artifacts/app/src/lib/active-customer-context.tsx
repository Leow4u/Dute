import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { collection } from "firebase/firestore";

import {
  LEGACY_CUSTOMER_CODE,
  activeCustomerOptions,
  activeCustomerStorageKey,
  commercialCustomerOptions,
  resolveActiveCustomerCode,
  type ActiveCustomerOption,
} from "./active-customer";
import { useAppUser } from "./auth";
import { relerDoZero } from "./carregando/reler-do-zero";
import { useLeituraComFalha } from "./carregando/use-leitura-com-falha";
import { lerDocsDoServidor } from "./cloud-api";
import { firestore } from "./firebase";
import { AGENTE_LIBERADO } from "./liberacao";
import { INTERNAL_ROLES } from "./modules";
import type { CustomerProfileRecord } from "./operations";
import { fetchJson } from "./warehouse-ops/model";

/**
 * Cliente ativo da área interna (lib/active-customer.ts). A lista vem de
 * `client_profiles`, que todo papel interno lê; a do comercial, do cadastro
 * de clientes, para o Agent Dute do Comercial (parte 5.5j). A escolha fica
 * guardada neste aparelho, por pessoa. No portal não há escolha: o cliente é
 * o da conta.
 */

export const CLIENT_PROFILES_QUERY_KEY = ["client-profiles"];
const COMMERCIAL_CUSTOMERS_QUERY_KEY = ["active-customer-commercial"];

/**
 * Pelo `lib/cloud-api.ts`: sem rede, a leitura que só achou o cache é falta de
 * conexão, e não a lista velha ou vazia (diagnóstico, 9.4; carregamento v2,
 * parte 13e), e o SDK que se deu por offline fica marcado, para a releitura
 * sozinha acordá-lo (parte 7a).
 */
async function readCommercialCustomers(): Promise<CustomerProfileRecord[]> {
  if (!firestore) return [];
  const snapshot = await lerDocsDoServidor(collection(firestore, "customers"));
  return snapshot.docs.map((doc) => ({ ...(doc.data() as CustomerProfileRecord), id: doc.id }));
}

export type ActiveCustomerState = {
  options: ActiveCustomerOption[];
  active: ActiveCustomerOption;
  code: string;
  setCode: (code: string) => void;
  isLoading: boolean;
  /**
   * A lista dos clientes não veio e não há nada lido: o seletor mostra a
   * falta, nunca o cliente legado como se fosse o escolhido (carregamento v2,
   * parte 13e). A falta de conexão o app relê sozinho (parte 7a).
   */
  falhou: boolean;
  /** O erro da leitura que falhou, para dizer qual é a falta. */
  erro: unknown;
  /**
   * Lê a lista dos clientes de novo, cancelando a que ficou presa sem nada
   * lido (`relerDoZero`): o "Tentar de novo" do seletor e o da tela que espera
   * o cliente ativo (o Fechamento do mês, que não lê o próprio dado com o
   * cliente padrão enquanto o ativo não chegou; parte 13d). `tentando`
   * enquanto lê, depois da falha.
   */
  tentar: () => Promise<unknown>;
  tentando: boolean;
  /**
   * O cliente que a tela vai operar: enquanto a lista dos clientes não chegou
   * (`isLoading`), o escolhido neste aparelho, que o `code` ainda não
   * confirma (até lá ele é o padrão); depois, o `code`. Só para o que pode
   * errar sem dano, como a altura das linhas-fantasma da primeira leitura
   * (lib/carregando/contagem-lembrada.ts): nunca para ler ou gravar dado.
   */
  codeProvavel: string;
};

const FALLBACK_OPTIONS = activeCustomerOptions([]);

const ActiveCustomerContext = createContext<ActiveCustomerState>({
  options: FALLBACK_OPTIONS,
  active: FALLBACK_OPTIONS[0],
  code: LEGACY_CUSTOMER_CODE,
  setCode: () => undefined,
  isLoading: false,
  falhou: false,
  erro: null,
  tentar: () => Promise.resolve(),
  tentando: false,
  codeProvavel: LEGACY_CUSTOMER_CODE,
});

function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Sem storage (aba privada): vale só enquanto a tela estiver aberta.
  }
}

export function ActiveCustomerProvider({ children }: { children: ReactNode }) {
  const { user } = useAppUser();
  const role = user?.publicMetadata.role;
  // Equipe do WMS: o papel da plataforma sem tela do WMS não opera cliente.
  const internal = Boolean(role) && INTERNAL_ROLES.includes(role!);
  // O comercial não opera o WMS, mas fala com o Agent Dute do núcleo sobre um cliente.
  const commercial = role === "comercial" && AGENTE_LIBERADO;
  const storageKey = activeCustomerStorageKey(user?.uid);

  const queryClient = useQueryClient();
  const chaveDosClientes = commercial ? COMMERCIAL_CUSTOMERS_QUERY_KEY : CLIENT_PROFILES_QUERY_KEY;
  const leitura = useQuery({
    queryKey: chaveDosClientes,
    enabled: internal || commercial,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      if (commercial) return readCommercialCustomers();
      const payload = await fetchJson<{ items?: CustomerProfileRecord[] }>(
        "/api/client-profiles?limit=500",
      );
      return payload.items ?? [];
    },
  });

  const [stored, setStored] = useState<string | null>(() => readStored(storageKey));
  useEffect(() => {
    setStored(readStored(storageKey));
  }, [storageKey]);

  // A nova tentativa sem dado não volta a "carregando": a falha fica, com "Tentando de novo", até a leitura responder
  // (o react-query 5 a voltaria a "pending", e o seletor piscaria entre o bloco e "Não carregou").
  const profiles = useLeituraComFalha(leitura);
  const options = useMemo(
    () => (commercial ? commercialCustomerOptions(profiles.data) : activeCustomerOptions(profiles.data)),
    [commercial, profiles.data],
  );
  const code = resolveActiveCustomerCode(options, stored);
  const active = options.find((option) => option.code === code) ?? options[0];
  const setCode = useCallback(
    (next: string) => {
      writeStored(storageKey, next);
      setStored(next);
    },
    [storageKey],
  );

  const isLoading = (internal || commercial) && profiles.isPending && !profiles.isError;
  const falhou = (internal || commercial) && profiles.isError && profiles.data === undefined;
  const erro = falhou ? profiles.error : null;
  const tentando = falhou && profiles.isFetching;
  // Sem nada lido, o refetch do react-query só espera a leitura presa: ela é cancelada antes, e a nova sai.
  const tentar = useCallback(() => relerDoZero(queryClient, [chaveDosClientes]), [chaveDosClientes, queryClient]);
  const guardado = stored?.trim() || null;
  const value = useMemo<ActiveCustomerState>(
    () => ({
      options,
      active,
      code: active.code,
      setCode,
      isLoading,
      falhou,
      erro,
      tentar,
      tentando,
      codeProvavel: isLoading && guardado ? guardado : active.code,
    }),
    [active, erro, falhou, guardado, isLoading, options, setCode, tentando, tentar],
  );

  return <ActiveCustomerContext.Provider value={value}>{children}</ActiveCustomerContext.Provider>;
}

export function useActiveCustomer(): ActiveCustomerState {
  return useContext(ActiveCustomerContext);
}
