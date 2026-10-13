/* Agenda de destinatários e kits modelo da demo (rotas /api/demo/...). */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { KitModel, Recipient } from "../data";

export type { KitModel, Recipient };

async function call<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = (await response.json()) as T & { ok?: boolean; message?: string };
  if (payload && payload.ok === false) throw new Error(payload.message || "Não foi possível salvar.");
  return payload;
}

export const recipientsKey = ["demo-recipients"] as const;
export const kitsKey = ["demo-kits"] as const;

export function useRecipients() {
  return useQuery({ queryKey: recipientsKey, queryFn: () => call<{ items: Recipient[] }>("/api/demo/recipients").then((data) => data.items) });
}

export function useKits() {
  return useQuery({ queryKey: kitsKey, queryFn: () => call<{ items: KitModel[] }>("/api/demo/kits").then((data) => data.items) });
}

export type RecipientInput = Omit<Recipient, "id" | "created_at">;

export function useSaveRecipient() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...fields }: RecipientInput & { id?: string }) =>
      call<Recipient>(id ? `/api/demo/recipients/${encodeURIComponent(id)}` : "/api/demo/recipients", "POST", fields),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: recipientsKey }),
  });
}

export function useDeleteRecipient() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => call(`/api/demo/recipients/${encodeURIComponent(id)}`, "DELETE"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: recipientsKey }),
  });
}

export function useSaveKit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (kit: Pick<KitModel, "name" | "description" | "items">) => call<KitModel>("/api/demo/kits", "POST", kit),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: kitsKey }),
  });
}

export function useDeleteKit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => call(`/api/demo/kits/${encodeURIComponent(id)}`, "DELETE"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: kitsKey }),
  });
}

/** Quantos kits inteiros o saldo livre de hoje monta. */
export function kitsAvailable(kit: KitModel, availableBySku: Map<string, number>) {
  if (!kit.items.length) return 0;
  return Math.min(...kit.items.map((item) => Math.floor((availableBySku.get(item.sku) ?? 0) / Math.max(1, item.quantity))));
}
