import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQuery } from "@tanstack/react-query";
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
};

const FALLBACK_OPTIONS = activeCustomerOptions([]);

const ActiveCustomerContext = createContext<ActiveCustomerState>({
  options: FALLBACK_OPTIONS,
  active: FALLBACK_OPTIONS[0],
  code: LEGACY_CUSTOMER_CODE,
  setCode: () => undefined,
  isLoading: false,
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

  const profiles = useQuery({
    queryKey: commercial ? COMMERCIAL_CUSTOMERS_QUERY_KEY : CLIENT_PROFILES_QUERY_KEY,
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

  const value = useMemo<ActiveCustomerState>(
    () => ({
      options,
      active,
      code: active.code,
      setCode,
      isLoading: (internal || commercial) && profiles.isPending,
    }),
    [active, commercial, internal, options, profiles.isPending, setCode],
  );

  return <ActiveCustomerContext.Provider value={value}>{children}</ActiveCustomerContext.Provider>;
}

export function useActiveCustomer(): ActiveCustomerState {
  return useContext(ActiveCustomerContext);
}
