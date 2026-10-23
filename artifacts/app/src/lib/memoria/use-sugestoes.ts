import type { PedidoDeSugestao, Sugestao, SugestaoNaTela } from "./sugestao";
import { useRespostasDoNucleo } from "./use-nucleo";

/**
 * A duração sugerida de cada OS do plano (parte 5.2b), pelo pedido de cada
 * uma, pela espera e pela memória de useRespostasDoNucleo. A chave é a de
 * chaveDoPedido, que a decisão da pessoa também usa.
 */
export function useSugestoes(pedidos: ReadonlyArray<PedidoDeSugestao | null>, ligada: boolean): Array<SugestaoNaTela | null> {
  return useRespostasDoNucleo<PedidoDeSugestao, Sugestao>("suggestDuration", pedidos, ligada).map((vista) =>
    vista ? { chave: vista.chave, estado: vista.estado, sugestao: vista.resposta } : null,
  );
}
