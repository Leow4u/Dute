/**
 * Achar o produto já cadastrado antes de criar outro
 * (docs/multicliente-modelos-de-operacao.md, PR 2). O SKU é gerado pelo
 * sistema na sigla do cliente, então a pessoa procura pelo código que tem na
 * mão: o do cliente, o SKU da etiqueta ou o código de barras. Antes de
 * cadastrar como novo, a tela mostra os parecidos, com foto, para quem está
 * com a peça na mão decidir se é o mesmo produto.
 */

export type MatchableProduct = {
  id: string;
  skuCode: string;
  clientCode: string;
  productName: string;
  barcode?: string;
  brand?: string;
  size?: string;
  color?: string;
};

export type CodeMatchField = "clientCode" | "skuCode" | "barcode";

export type CodeMatch<T> = { product: T; field: CodeMatchField };

/** Código como as Functions comparam: maiúsculas, sem espaço nas pontas. */
export function productCodeKey(value: string | null | undefined): string {
  return String(value ?? "").trim().toUpperCase();
}

/** Código de barras como as Functions comparam (domain/catalog-codes.ts): sem espaço nenhum. */
export function barcodeKey(value: string | null | undefined): string {
  return String(value ?? "").replace(/\s+/g, "").toUpperCase();
}

/**
 * O produto deste código, seja ele o do cliente, o SKU ou o de barras. O do
 * cliente vence (é o campo que a pessoa preenche), depois o SKU, depois o de
 * barras.
 */
export function findProductByAnyCode<T extends MatchableProduct>(
  products: T[],
  code: string | null | undefined,
): CodeMatch<T> | undefined {
  const key = productCodeKey(code);
  if (!key) return undefined;
  const byClientCode = products.find((product) => productCodeKey(product.clientCode) === key);
  if (byClientCode) return { product: byClientCode, field: "clientCode" };
  const bySku = products.find((product) => productCodeKey(product.skuCode) === key);
  if (bySku) return { product: bySku, field: "skuCode" };
  const byBarcode = findProductByBarcode(products, code);
  return byBarcode ? { product: byBarcode, field: "barcode" } : undefined;
}

/** O produto com este código de barras, ou nenhum. */
export function findProductByBarcode<T extends MatchableProduct>(
  products: T[],
  barcode: string | null | undefined,
): T | undefined {
  const key = barcodeKey(barcode);
  if (!key) return undefined;
  return products.find((product) => barcodeKey(product.barcode) === key);
}

export const CODE_MATCH_LABEL: Record<CodeMatchField, string> = {
  clientCode: "pelo código do cliente",
  skuCode: "pelo SKU",
  barcode: "pelo código de barras",
};

const STOP_WORDS = new Set([
  "a", "as", "o", "os", "um", "uma", "de", "da", "das", "do", "dos",
  "e", "em", "na", "no", "nas", "nos", "com", "sem", "para", "por",
]);

function plain(value: string | null | undefined): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

function words(value: string | null | undefined): string[] {
  return plain(value)
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 2 && !STOP_WORDS.has(word));
}

/** Tamanho "M" e cor "Azul" contam inteiros, mesmo com uma letra só. */
function sameAttribute(left: string | null | undefined, right: string | null | undefined): boolean {
  const key = plain(left).replace(/[^a-z0-9]+/g, " ").trim();
  return Boolean(key) && key === plain(right).replace(/[^a-z0-9]+/g, " ").trim();
}

export type SimilarDraft = {
  name: string;
  brand?: string;
  size?: string;
  color?: string;
};

/**
 * Até `limit` produtos de nome parecido com a descrição digitada: dividem
 * pelo menos duas palavras com ela (uma, se a descrição é uma palavra só, de
 * quatro letras ou mais). Marca, tamanho e cor iguais sobem na lista.
 */
export function similarProducts<T extends MatchableProduct>(
  draft: SimilarDraft,
  products: T[],
  limit = 3,
): T[] {
  const nameWords = [...new Set(words(draft.name))];
  if (!nameWords.length) return [];
  if (nameWords.length === 1 && nameWords[0]!.length < 4) return [];
  const needed = Math.min(2, nameWords.length);
  const scored: Array<{ product: T; score: number }> = [];
  for (const product of products) {
    const productWords = new Set(words(product.productName));
    const shared = nameWords.filter((word) => productWords.has(word)).length;
    if (shared < needed) continue;
    let score = shared * 3;
    if (sameAttribute(draft.brand, product.brand)) score += 1;
    if (sameAttribute(draft.size, product.size)) score += 1;
    if (sameAttribute(draft.color, product.color)) score += 1;
    scored.push({ product, score });
  }
  return scored
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.product.productName.localeCompare(right.product.productName, "pt-BR"),
    )
    .slice(0, limit)
    .map((entry) => entry.product);
}

export type SavedLineCodes = {
  sku_code?: string | null;
  product_registration?: string | null;
};

/** O aviso depois de salvar: "SKU gerado: BTG-000010." (null quando nenhuma linha era nova). */
export function generatedSkuNote(items: SavedLineCodes[] | null | undefined): string | null {
  const codes = (items ?? [])
    .filter((item) => item.product_registration === "new" && item.sku_code)
    .map((item) => String(item.sku_code));
  if (!codes.length) return null;
  return codes.length === 1 ? `SKU gerado: ${codes[0]}.` : `SKUs gerados: ${codes.join(", ")}.`;
}
