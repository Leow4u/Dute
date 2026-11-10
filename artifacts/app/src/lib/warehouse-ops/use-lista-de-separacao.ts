import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { warehouseBoxFromRecord } from "@/lib/warehouse-boxes";
import type { WarehousePosition } from "@/lib/warehouse-positions";
import { fetchWarehouseRows } from "@/lib/warehouse-rows";

import { gruposDaSeparacao, type GrupoDaLista } from "./lista-de-separacao";
import type { AnyRecord, WarehouseTaskItem } from "./model";

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
 * As caixas do cliente do pedido, para dizer em que caixa cada item está. A
 * mesma chave, a mesma consulta e o mesmo formato da Contagem: o cache serve
 * às duas telas. Sem o cliente, não lê.
 */
export function useCaixasDoCliente(cliente?: string | null) {
  const codigo = String(cliente ?? "").trim();
  return useQuery({
    queryKey: ["warehouse-boxes", codigo, "all-pages"],
    enabled: Boolean(codigo),
    staleTime: 10_000,
    queryFn: async () =>
      (await fetchWarehouseRows<AnyRecord>(`/api/warehouse/boxes?customer_code=${encodeURIComponent(codigo)}&limit=1000`)).map(warehouseBoxFromRecord),
  });
}

/**
 * As linhas do pedido por prateleira, na ordem de caminhada, com a caixa de
 * cada item. Enquanto as posições não chegam (ou se a leitura falha), a ordem
 * é a do código da prateleira; enquanto as caixas não chegam, a linha sai sem
 * caixa: a lista nunca fica em branco.
 */
export function useListaDeSeparacao(itens: readonly WarehouseTaskItem[], cliente?: string | null): GrupoDaLista[] {
  const posicoes = usePosicoesDoArmazem(itens.length > 0);
  const caixas = useCaixasDoCliente(itens.length > 0 ? cliente : null);
  return useMemo(
    () => gruposDaSeparacao(itens, posicoes.data?.items ?? [], { caixas: caixas.data, cliente }),
    [itens, posicoes.data?.items, caixas.data, cliente],
  );
}
