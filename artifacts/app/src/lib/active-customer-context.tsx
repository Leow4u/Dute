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
import { collection, getDocs } from "firebase/firestore";

import {
  LEGACY_CUSTOMER_CODE,
  activeCustomerOptions,
  activeCustomerStorageKey,
  commercialCustomerOptions,
  resolveActiveCustomerCode,
  type ActiveCustomerOption,
} from "./active-customer";
import { useAppUser } from "./auth";
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

async function readCommercialCustomers(): Promise<CustomerProfileRecord[]> {
  if (!firestore) return [];
  const snapshot = await getDocs(collection(firestore, "customers"));
  return snapshot.docs.map((doc) => ({ ...(doc.data() as CustomerProfileRecord), id: doc.id }));
}

export type ActiveCustomerState = {
  options: ActiveCustomerOption[];
  active: ActiveCustomerOption;
  code: string;
  setCode: (code: string) => void;
  isLoading: boolean;
  /**
   * O cliente que a tela vai operar: enquanto a lista dos clientes não chegou
   * (`isLoading`), o escolhido neste aparelho, que o `code` ainda não
   * confirma (até lá ele é o padrão); depois, o `code`. Só para o que pode
   * errar sem dano, como a altura das linhas-fantasma da primeira leitura
   * (lib/carregando/contagem-lembrada.ts): nunca para ler ou gravar dado.
   */
  codeProvavel: string;
  /**
   * Lê a lista dos clientes de novo, cancelando a que ficou presa: o "Tentar
   * de novo" da tela que espera o cliente ativo (o Fechamento do mês). A tela
   * não lê o próprio dado com o cliente padrão enquanto o ativo não chegou.
   */
  recarregar?: () => Promise<unknown>;
};

const FALLBACK_OPTIONS = activeCustomerOptions([]);

const ActiveCustomerContext = createContext<ActiveCustomerState>({
  options: FALLBACK_OPTIONS,
  active: FALLBACK_OPTIONS[0],
  code: LEGACY_CUSTOMER_CODE,
  setCode: () => undefined,
  isLoading: false,
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
  const profiles = useQuery({
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

  const isLoading = (internal || commercial) && profiles.isPending;
  const guardado = stored?.trim() || null;
  const { refetch: lerOsClientes } = profiles;
  // Sem nada lido, o refetch do react-query só espera a leitura presa: ela é cancelada antes, e a nova sai.
  const recarregar = useCallback(
    () => queryClient.cancelQueries({ queryKey: chaveDosClientes }).then(() => lerOsClientes()),
    [chaveDosClientes, lerOsClientes, queryClient],
  );
  const value = useMemo<ActiveCustomerState>(
    () => ({
      options,
      active,
      code: active.code,
      setCode,
      isLoading,
      codeProvavel: isLoading && guardado ? guardado : active.code,
      recarregar,
    }),
    [active, guardado, isLoading, options, recarregar, setCode],
  );

  return <ActiveCustomerContext.Provider value={value}>{children}</ActiveCustomerContext.Provider>;
}

export function useActiveCustomer(): ActiveCustomerState {
  return useContext(ActiveCustomerContext);
}
