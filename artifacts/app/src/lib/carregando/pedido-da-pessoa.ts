import { useSyncExternalStore } from "react";

/**
 * As leituras que a pessoa pediu de novo, com o "Tentar de novo" do aviso no
 * lugar da lista (`ErroNaLeitura`, `BlocoSemConexao`) ou da linha de estado
 * (carregamento v2, momento 2). Depois de uma falha, a releitura automática
 * não fala (parte 7b); a que a pessoa pediu fala como a primeira leitura:
 * "Carregando pedidos" aos 300 ms e o resumo quando a lista chega, para quem
 * apertou o botão saber que ela chegou. A `LinhaDeEstado` olha esta conta.
 */
let pedidos = 0;
const ouvintes = new Set<() => void>();

/** A pessoa pediu uma nova leitura. */
export function marcarPedidoDaPessoa(): void {
  pedidos += 1;
  for (const ouvinte of ouvintes) ouvinte();
}

function assinar(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte);
  return () => {
    ouvintes.delete(ouvinte);
  };
}

function ler(): number {
  return pedidos;
}

/** Quantas novas leituras a pessoa pediu até agora: muda a cada pedido. */
export function usePedidosDaPessoa(): number {
  return useSyncExternalStore(assinar, ler, ler);
}
