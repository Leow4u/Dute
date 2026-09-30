/**
 * Estoque mínimo por item. É opcional: sem mínimo cadastrado o item nunca
 * aparece como "Baixo". Vazio/null limpa o mínimo; qualquer outro valor
 * precisa ser um inteiro entre 0 e MAX_MINIMUM_STOCK.
 */
export const MAX_MINIMUM_STOCK = 1_000_000;

export class MinimumStockError extends Error {}

export function normalizeMinimumStock(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === "string" && !value.trim()) return null;

  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value.trim().replace(",", "."))
        : Number.NaN;
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > MAX_MINIMUM_STOCK) {
    throw new MinimumStockError(
      "Estoque mínimo precisa ser um número inteiro de 0 em diante (ou vazio para não ter mínimo).",
    );
  }
  return parsed;
}
