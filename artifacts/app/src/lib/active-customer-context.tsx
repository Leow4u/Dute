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

import {
  LEGACY_CUSTOMER_CODE,
  activeCustomerOptions,
  activeCustomerStorageKey,
  resolveActiveCustomerCode,
  type ActiveCustomerOption,
} from "./active-customer";
import { useAppUser } from "./auth";
import type { CustomerProfileRecord } from "./operations";
import { fetchJson } from "./warehouse-ops/model";

/**
 * Cliente ativo da área interna (lib/active-customer.ts). A lista vem de
 * `client_profiles`, que todo papel interno lê; a escolha fica guardada neste
 * aparelho, por pessoa. No portal não há escolha: o cliente é o da conta.
 */

export const CLIENT_PROFILES_QUERY_KEY = ["client-profiles"];

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
  const internal = Boolean(role) && role !== "cliente";
  const storageKey = activeCustomerStorageKey(user?.uid);

  const profiles = useQuery({
    queryKey: CLIENT_PROFILES_QUERY_KEY,
    enabled: internal,
    staleTime: 5 * 60_000,
    queryFn: async () => {
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

  const options = useMemo(() => activeCustomerOptions(profiles.data), [profiles.data]);
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
      isLoading: internal && profiles.isPending,
    }),
    [active, internal, options, profiles.isPending, setCode],
  );

  return <ActiveCustomerContext.Provider value={value}>{children}</ActiveCustomerContext.Provider>;
}

export function useActiveCustomer(): ActiveCustomerState {
  return useContext(ActiveCustomerContext);
}
