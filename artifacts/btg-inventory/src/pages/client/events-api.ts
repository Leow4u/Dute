/* Eventos do portal: leitura e gravação só pelo backend (callables em functions-api). */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { ClientEvent, ClientEventInput } from "@/lib/client-events";

import { fetchJson } from "./shared";

export const clientEventsQueryKey = ["client-events"] as const;

export function useClientEvents({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery<ClientEvent[], Error>({
    queryKey: clientEventsQueryKey,
    enabled,
    queryFn: () => fetchJson<{ events?: ClientEvent[] }>("/api/client/events").then((data) => data?.events ?? []),
    staleTime: 60_000,
  });
}

export function useSaveClientEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ClientEventInput) =>
      fetchJson<{ id: string; created: boolean; event: ClientEvent }>("/api/client/events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: clientEventsQueryKey }),
  });
}

export function useArchiveClientEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      fetchJson<{ id: string; changed: boolean }>(`/api/client/events/${encodeURIComponent(id)}/archive`, { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: clientEventsQueryKey }),
  });
}
