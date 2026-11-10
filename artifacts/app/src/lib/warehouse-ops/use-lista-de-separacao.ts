import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import type { WarehousePosition } from "@/lib/warehouse-positions";
import { fetchWarehouseRows } from "@/lib/warehouse-rows";

import { gruposDaSeparacao, type GrupoDaLista } from "./lista-de-separacao";
import type { WarehouseTaskItem } from "./model";

/**
 * O cadastro de Posições, para a ordem de caminhada. A mesma chave e o mesmo
 * formato do Mapa: o cache serve às duas telas. Só lê com `ligado`.
 */
export function usePosicoesDoArmazem(ligado = true) {
  return useQuery<{ items?: WarehousePosition[] }>({
    queryKey: ["warehouse-positions", "all-pages"],
    enabled: ligado,
    staleTime: 30_000,
    queryFn: async () => ({ items: await fetchWarehouseRows<WarehousePosition>("/api/warehouse/positions?limit=2000") }),
  });
}

/**
 * As linhas do pedido por prateleira, na ordem de caminhada. Enquanto as
 * posições não chegam (ou se a leitura falha), a ordem é a do código da
 * prateleira: a lista nunca fica em branco.
 */
export function useListaDeSeparacao(itens: readonly WarehouseTaskItem[], _cliente?: string | null): GrupoDaLista[] {
  const posicoes = usePosicoesDoArmazem(itens.length > 0);
  return useMemo(() => gruposDaSeparacao(itens, posicoes.data?.items ?? []), [itens, posicoes.data?.items]);
}
