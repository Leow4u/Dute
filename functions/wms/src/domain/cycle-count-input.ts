import { z } from "genkit";

/**
 * O teto da contagem cíclica (diagnóstico da Contagem cíclica, F11): nenhuma
 * prateleira da Dutelog guarda tanto de um SKU; acima disso é dedo a mais no
 * número. A abertura não muda aqui.
 */
export const CONTAGEM_CICLICA_MAXIMA = 100_000;

export const QUANTIDADE_FRACIONADA =
  "A quantidade contada precisa ser um número inteiro de unidades, sem casas decimais.";
export const QUANTIDADE_ACIMA_DO_TETO =
  "A quantidade contada não pode passar de 100.000 unidades. Confira o número digitado.";
const CONTAGEM_INVALIDA = "Contagem inválida: confira os campos e tente de novo.";

/**
 * O problema da quantidade da contagem cíclica, ou null quando ela serve: só
 * unidades inteiras, até o teto. O esquema e a transação usam a mesma regra,
 * com a mesma frase para quem opera; a abertura (`mode: "opening"`) não muda.
 */
export function problemaDaQuantidadeContada(mode: unknown, countedQty: number): string | null {
  if (mode === "opening") return null;
  if (!Number.isInteger(countedQty)) return QUANTIDADE_FRACIONADA;
  if (countedQty > CONTAGEM_CICLICA_MAXIMA) return QUANTIDADE_ACIMA_DO_TETO;
  return null;
}

/**
 * Os campos da entrada de recordCycleCount (contagem cíclica e inventário de
 * abertura). Produto novo na abertura não traz SKU: ele é gerado na sigla do
 * cliente dentro da transação (domain/catalog-codes.ts), e
 * recordCycleCountTransaction exige o SKU em todos os outros casos. A
 * conferência da abertura (opening-inventory-conference.ts) recorta estes
 * campos; a callable usa o CycleCountSchema, com a regra da quantidade.
 */
export const CycleCountFieldsSchema = z
  .object({
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

/** A entrada da callable: os campos, com a quantidade da cíclica conferida. */
export const CycleCountSchema = CycleCountFieldsSchema
  .superRefine((input, ctx) => {
    const problema = problemaDaQuantidadeContada(input.mode, input.counted_qty);
    if (problema) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["counted_qty"], message: problema });
    }
  });

/**
 * A contagem fora do formato vira a frase que quem opera lê: a quantidade diz
 * o que corrigir; o resto, que a tela não manda errado, é genérico. O ZodError
 * cru viraria INTERNAL na callable.
 */
export function problemaDaEntradaDaContagem(error: z.ZodError): string {
  const quantidade = error.issues.find(
    (issue) => issue.code === "custom" && issue.path.length === 1 && issue.path[0] === "counted_qty",
  );
  return quantidade?.message ?? CONTAGEM_INVALIDA;
}
