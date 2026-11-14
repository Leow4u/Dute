/** Um grupo da lista no resumo falado: quantos e o nome dele, no singular e no plural. */
export interface GrupoNoResumo {
  quantos: number;
  /** "para aprovar", "recebida por guardar". */
  um: string;
  /** O plural, quando difere ("recebidas por guardar"); sem ele, o mesmo do singular. */
  varios?: string;
}

/**
 * O que o Anunciador diz quando a primeira leitura da lista termina (momento
 * 2): "3 para aprovar, 2 para separar, 1 para entregar", só os grupos com
 * linha; sem nenhuma, o `vazio` ("Nenhum pedido em aberto").
 */
export function resumoDaLista(grupos: readonly GrupoNoResumo[], vazio: string): string {
  const partes = grupos
    .filter((grupo) => grupo.quantos > 0)
    .map((grupo) => `${grupo.quantos} ${grupo.quantos === 1 ? grupo.um : (grupo.varios ?? grupo.um)}`);
  return partes.length ? partes.join(", ") : vazio;
}
