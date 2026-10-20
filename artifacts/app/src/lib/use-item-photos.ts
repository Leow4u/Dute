import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { buildStockItems } from "./stock-items";

type AnyRecord = Record<string, unknown>;

async function fetchItems(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as { items: AnyRecord[] };
}

/**
 * Foto do item por código (SKU interno ou código do cliente), a mesma que o
 * Estoque mostra. Usa as mesmas consultas e chaves de cache da tela de
 * Estoque, então quem já passou por lá não busca de novo.
 */
export function useItemPhotos(enabled = true) {
  const skus = useQuery({
    queryKey: ["estoque", "skus"],
    queryFn: () => fetchItems("/api/skus?limit=2000"),
    enabled,
    staleTime: 120_000,
  });
  const balances = useQuery({
    queryKey: ["stock-balances", "estoque"],
    queryFn: () => fetchItems("/api/stock-balances?limit=2000"),
    enabled,
    staleTime: 120_000,
  });
  const products = useQuery({
    queryKey: ["estoque", "products"],
    queryFn: () => fetchItems("/api/products?limit=2000"),
    enabled,
    staleTime: 300_000,
  });

  const byCode = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of buildStockItems({
      skus: skus.data?.items,
      balances: balances.data?.items,
      products: products.data?.items,
    })) {
      const photo = item.photos[0];
      if (!photo) continue;
      map.set(item.skuCode, photo);
      if (item.clientCode) map.set(item.clientCode, photo);
    }
    return map;
  }, [balances.data?.items, products.data?.items, skus.data?.items]);

  return (...codes: Array<string | null | undefined>) => {
    for (const code of codes) {
      const photo = code ? byCode.get(String(code).trim()) : undefined;
      if (photo) return photo;
    }
    return undefined;
  };
}
