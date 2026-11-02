/**
 * Áreas de passagem do armazém (docs/plataforma/recebimento-com-caixas.md,
 * decisão 10 e parte 7). O que está nelas ainda não está numa prateleira e
 * não serve ao pedido do cliente: o RECEBIMENTO guarda o que chegou até a
 * guarda, e a EXPEDICAO, o separado à espera da entrega ou da guarda de volta
 * (pedido cancelado, domain/order-cancel.ts).
 *
 * O local de um saldo é texto livre (posições cadastradas, LOC-*, DEVOLUCAO):
 * a prateleira é definida por exclusão, todo local que não é área de
 * passagem.
 */
export const AREAS_DE_PASSAGEM = ["RECEBIMENTO", "EXPEDICAO"] as const;
export type AreaDePassagem = (typeof AREAS_DE_PASSAGEM)[number];

/** A área de passagem do local, sem diferenciar maiúscula nem acento; null quando é prateleira. */
export function areaDePassagem(local: unknown): AreaDePassagem | null {
  const code =
    typeof local === "string"
      ? local.trim().normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase()
      : "";
  return (AREAS_DE_PASSAGEM as readonly string[]).includes(code) ? (code as AreaDePassagem) : null;
}

/** O pedido do cliente só reserva da prateleira: o local pedido numa área é recusado com esta frase. */
export function problemaDoLocalDoPedido(local: unknown): string | null {
  return areaDePassagem(local)
    ? `O local ${String(local).trim()} não atende pedido: o pedido só reserva o que está na prateleira.`
    : null;
}

export type SaldoDoLocal = { location_id?: unknown; qty_on_hand?: unknown; qty_reserved?: unknown };

/**
 * O que o portal do cliente mostra de um SKU, dos saldos dele: o livre das
 * prateleiras é o disponível para pedido (qty_available), e o livre do
 * RECEBIMENTO, o "Em recebimento" (qty_receiving). A EXPEDICAO entra só no
 * total (qty_on_hand), que continua sendo a soma de todos os locais.
 */
export function livreParaOCliente(saldos: Iterable<SaldoDoLocal>): { qty_available: number; qty_receiving: number } {
  let prateleira = 0;
  let recebimento = 0;
  for (const saldo of saldos) {
    const livre = Math.max(0, quantidade(saldo.qty_on_hand) - quantidade(saldo.qty_reserved));
    const area = areaDePassagem(saldo.location_id);
    if (area === null) prateleira += livre;
    else if (area === "RECEBIMENTO") recebimento += livre;
  }
  return { qty_available: prateleira, qty_receiving: recebimento };
}

function quantidade(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}
