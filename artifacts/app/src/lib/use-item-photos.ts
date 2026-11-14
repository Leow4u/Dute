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
 * O cadastro dos SKUs, com a mesma consulta e a mesma chave de cache do
 * Estoque: quem já passou por lá, pela fila de Pedidos ou pela bancada (as
 * fotos dos itens) não busca de novo.
 */
export function useCatalogoDeSkus(enabled = true) {
  return useQuery({
    queryKey: ["estoque", "skus"],
    queryFn: () => fetchItems("/api/skus?limit=2000"),
    enabled,
    staleTime: 120_000,
  });
}

/**
 * Foto do item por código (SKU interno ou código do cliente), a mesma que o
 * Estoque mostra. Usa as mesmas consultas e chaves de cache da tela de
 * Estoque, então quem já passou por lá não busca de novo.
 */
export function useItemPhotos(enabled = true) {
  const skus = useCatalogoDeSkus(enabled);
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

  const fotoDe = (...codes: Array<string | null | undefined>) => {
    for (const code of codes) {
      const photo = code ? byCode.get(String(code).trim()) : undefined;
      if (photo) return photo;
    }
    return undefined;
  };
  // As leituras ainda não chegaram: quem mostra a foto não afirma "sem foto" antes de ler (carregamento v2, parte 13c;
  // o diagnóstico, 4.3). O lugar da foto fica neutro até lá.
  const naoLeu = (leitura: { data: unknown; isError: boolean }) => leitura.data === undefined && !leitura.isError;
  return Object.assign(fotoDe, { lendo: enabled && (naoLeu(skus) || naoLeu(balances) || naoLeu(products)) });
}
