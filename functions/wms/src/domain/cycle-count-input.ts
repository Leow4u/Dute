import { z } from "genkit";

/**
 * Entrada de recordCycleCount (contagem cíclica e inventário de abertura).
 * Produto novo na abertura não traz SKU: ele é gerado na sigla do cliente
 * dentro da transação (domain/catalog-codes.ts), e recordCycleCountTransaction
 * exige o SKU em todos os outros casos.
 */
export const CycleCountSchema = z.object({
  mode: z.enum(["cycle", "opening"]).default("cycle"),
  session_id: z.string().trim().optional(),
  customer_code: z.string().trim().optional(),
  // Opcional: produto novo na abertura vem sem SKU, gerado na transação.
  sku_code: z.string().trim().optional(),
  client_item_code: z.string().trim().optional(),
  product_name: z.string().trim().optional(),
  product_registration: z.enum(["existing", "new"]).optional(),
  category: z.string().trim().optional(),
  genero: z.string().trim().max(80).optional(),
  grupo: z.string().trim().max(120).optional(),
  barcode: z.string().trim().max(120).optional(),
  brand: z.string().trim().max(120).optional(),
  size: z.string().trim().max(80).optional(),
  color: z.string().trim().max(80).optional(),
  photo_urls: z.array(z.string().url()).max(8).optional(),
  photo_storage_paths: z.array(z.string().trim().min(1).max(900)).max(8).optional(),
  location_id: z.string().trim().min(1),
  counted_qty: z.number().nonnegative(),
  unit_cost: z.number().nonnegative().optional(),
  reason: z.string().trim().min(3),
  reference: z.string().trim().optional(),
  box_code: z.string().trim().max(20).optional(),
  occurred_at: z.string().trim().optional(),
  idempotency_key: z.string().trim().min(1),
});
