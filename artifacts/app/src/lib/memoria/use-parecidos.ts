import { useEffect, useRef } from "react";

import type { Parecidos, PedidoDeParecidos } from "./parecidos";
import { useRespostasDoNucleo } from "./use-nucleo";

/**
 * Os orçamentos parecidos do pedido de agora (parte 5.3c), com a espera e a
 * memória de useRespostasDoNucleo. Enquanto o pedido novo carrega, fica a
 * última resposta, para o painel não piscar a cada quantidade digitada. Sem
 * pedido, desligada ou com erro, nada.
 */
export function useParecidos(pedido: PedidoDeParecidos | null, ligada: boolean): Parecidos | null {
  const [vista] = useRespostasDoNucleo<PedidoDeParecidos, Parecidos>("findSimilarQuotes", [pedido], ligada);
  const ultima = useRef<Parecidos | null>(null);
  const atual = vista?.estado === "pronto" ? vista.resposta : null;
  useEffect(() => {
    if (atual) ultima.current = atual;
  }, [atual]);
  if (!pedido || !ligada || vista?.estado === "erro") return null;
  return atual ?? ultima.current;
}
