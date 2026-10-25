// Trecho literal de lib/dominio/src/parados.ts: não edite aqui (trava em sentido-do-movimento.test.ts).
/**
 * As origens do razão (`movements.source`) que contam no relógio: a entrada e
 * a saída de verdade. A contagem de abertura conta como a entrada: o estoque
 * que já estava no armazém entra no dia em que foi contado. A guarda
 * (`wms_putaway`) e a troca de caixa da abertura só mudam o lugar; a contagem
 * cíclica e o estorno da abertura corrigem o saldo. Mudam o saldo, não o relógio.
 */
export const ORIGENS_QUE_CONTAM = [
  "wms_receiving",
  "wms_shipping",
  "functions_manual_inventory",
  "functions_return_disposition",
  "functions_opening_inventory",
] as const;

export type SentidoDoMovimento = "entrada" | "saida";

/** O sentido do movimento que conta no relógio; null para o que não conta. */
export function sentidoDoMovimento(origem: unknown, tipoMov: unknown): SentidoDoMovimento | null {
  if (typeof origem !== "string" || !(ORIGENS_QUE_CONTAM as readonly string[]).includes(origem)) return null;
  if (tipoMov === "ENTRADA") return "entrada";
  if (tipoMov === "SAIDA") return "saida";
  return null;
}
