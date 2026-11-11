import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { collection, getDocs, query, where } from "firebase/firestore";

import { firestore } from "@/lib/firebase";
import { warehouseBoxFromRecord } from "@/lib/warehouse-boxes";
import type { WarehousePosition } from "@/lib/warehouse-positions";
import { fetchWarehouseRows } from "@/lib/warehouse-rows";

import { caixasComOItem, entradaDasCaixas, linhaDeEntrada, type LinhaDeEntrada } from "./caixas-da-separacao";
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
 * O conteúdo de entrada das caixas da abertura do cliente (as linhas da
 * sessão), para a lista dizer só as caixas que ainda têm o item (separação
 * com caixas, parte 3). Sem o cliente, não lê.
 */
export function useEntradaDaAbertura(cliente?: string | null) {
  const codigo = String(cliente ?? "").trim();
  return useQuery<LinhaDeEntrada[]>({
    queryKey: ["opening-inventory-lines", codigo, "entrada-das-caixas"],
    enabled: Boolean(codigo),
    staleTime: 60_000,
    queryFn: async () => {
      if (!firestore) throw new Error("Firebase não configurado.");
      const snapshot = await getDocs(query(collection(firestore, "opening_inventory_lines"), where("customer_code", "==", codigo)));
      return snapshot.docs.flatMap((linha) => linhaDeEntrada(linha.id, linha.data()) ?? []);
    },
  });
}

/** A lista e o estado das duas leituras de que ela depende. */
export type LeituraDaLista = {
  grupos: GrupoDaLista[];
  /** A primeira leitura das posições ou das caixas ainda não voltou. */
  carregando: boolean;
  /** A leitura das posições falhou: a ordem é a do código da prateleira. */
  semPosicoes: boolean;
  /** A leitura das caixas falhou: a linha sai sem caixa. */
  semCaixas: boolean;
};

/**
 * As linhas do pedido por prateleira, na ordem de caminhada, com a caixa de
 * cada item. Enquanto as posições não chegam (ou se a leitura falha), a ordem
 * é a do código da prateleira; enquanto as caixas não chegam, a linha sai sem
 * caixa: a lista nunca fica em branco. A folha impressa espera as leituras e
 * avisa a que falhou.
 *
 * Com o conteúdo de entrada lido, a caixa da linha é a que ainda tem o item
 * (o saldo, parte 3); se essa leitura falha, vale o que a caixa conhece do
 * conteúdo de entrada, como na parte 1.
 */
export function useLeituraDaLista(itens: readonly WarehouseTaskItem[], cliente?: string | null): LeituraDaLista {
  const posicoes = usePosicoesDoArmazem(itens.length > 0);
  const caixas = useCaixasDoCliente(itens.length > 0 ? cliente : null);
  const abertura = useEntradaDaAbertura(itens.length > 0 ? cliente : null);
  const grupos = useMemo(() => {
    const guardadas = caixas.data;
    const entrada = guardadas && abertura.data ? entradaDasCaixas(guardadas, abertura.data) : null;
    return gruposDaSeparacao(itens, posicoes.data?.items ?? [], {
      caixas: guardadas,
      cliente,
      caixasDe: guardadas && entrada ? (item) => caixasComOItem(item, guardadas, entrada, cliente).map((caixa) => caixa.code) : undefined,
    });
  }, [itens, posicoes.data?.items, caixas.data, abertura.data, cliente]);
  return {
    grupos,
    carregando: posicoes.isLoading || caixas.isLoading || (abertura.isLoading && !abertura.isError),
    semPosicoes: posicoes.isError && !posicoes.data,
    semCaixas: caixas.isError && !caixas.data,
  };
}

/** Só a lista, para a fila de Pedidos. */
export function useListaDeSeparacao(itens: readonly WarehouseTaskItem[], cliente?: string | null): GrupoDaLista[] {
  return useLeituraDaLista(itens, cliente).grupos;
}
