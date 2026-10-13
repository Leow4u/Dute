/* Agenda de destinatários, kits modelo e eventos modelo da demo (rotas /api/demo/...). */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { EventModel, KitModel, Recipient } from "../data";

export type { EventModel, KitModel, Recipient };

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
export const eventsKey = ["demo-events"] as const;

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
    mutationFn: (kit: Pick<KitModel, "name" | "description" | "message" | "items">) => call<KitModel>("/api/demo/kits", "POST", kit),
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

export function useEvents() {
  return useQuery({ queryKey: eventsKey, queryFn: () => call<{ items: EventModel[] }>("/api/demo/events").then((data) => data.items) });
}

export function useSaveEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (event: Omit<EventModel, "id" | "created_at">) => call<EventModel>("/api/demo/events", "POST", event),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: eventsKey }),
  });
}

export function useDeleteEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => call(`/api/demo/events/${encodeURIComponent(id)}`, "DELETE"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: eventsKey }),
  });
}

/** O que falta no saldo livre de hoje para levar o evento inteiro. */
export function eventShortages(event: EventModel, availableBySku: Map<string, number>) {
  return event.items
    .map((item) => ({ name: item.name, need: item.quantity, have: availableBySku.get(item.sku) ?? 0 }))
    .filter((item) => item.have < item.need);
}
