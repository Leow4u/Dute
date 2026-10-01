/**
 * Variações do mesmo produto (tamanho, numeração) viram um card só no
 * portal. O código do cliente da BTG termina na variação:
 * A.01.0594.005.P / .M / .G, C.0659.001.U (único), J.0149.003.N1 / .N3.
 * Código fora desse padrão fica sozinho no próprio card.
 */

export type VariantCode = { base: string; variant: string };

export function splitVariant(code: string | null | undefined): VariantCode | null {
  const value = (code ?? "").trim();
  const parts = value.split(".");
  if (parts.length < 3) return null;
  const variant = parts[parts.length - 1];
  if (!/^[A-Za-z0-9]{1,4}$/.test(variant)) return null;
  return { base: parts.slice(0, -1).join("."), variant: variant.toUpperCase() };
}

const SIZE_ORDER = ["PP", "P", "M", "G", "GG", "XG", "XGG", "EG", "EGG", "U"];

/** Ordem natural: PP, P, M, G, GG…; N1 antes de N3; números em ordem. */
export function compareVariants(left: string, right: string) {
  const a = SIZE_ORDER.indexOf(left);
  const b = SIZE_ORDER.indexOf(right);
  if (a !== -1 || b !== -1) {
    if (a === -1) return 1;
    if (b === -1) return -1;
    return a - b;
  }
  return left.localeCompare(right, "pt-BR", { numeric: true });
}

export function variantLabel(variant: string) {
  return variant === "U" ? "Único" : variant;
}

export type Family<T> = {
  key: string;
  base: string;
  variants: Array<{ item: T; variant: string | null }>;
};

/**
 * Junta itens com a mesma base de código, na ordem em que aparecem (a lista
 * já chega ordenada). Variações dentro do card ficam na ordem de tamanho.
 */
export function groupFamilies<T>(
  items: T[],
  codeOf: (item: T) => string | null | undefined,
  keyOf: (item: T) => string,
  enabled = true,
): Family<T>[] {
  const families: Family<T>[] = [];
  const byBase = new Map<string, Family<T>>();
  for (const item of items) {
    const split = enabled ? splitVariant(codeOf(item)) : null;
    if (!split) {
      families.push({ key: keyOf(item), base: (codeOf(item) ?? "").trim(), variants: [{ item, variant: null }] });
      continue;
    }
    let family = byBase.get(split.base);
    if (!family) {
      family = { key: `familia:${split.base}`, base: split.base, variants: [] };
      byBase.set(split.base, family);
      families.push(family);
    }
    family.variants.push({ item, variant: split.variant });
  }
  for (const family of families) {
    family.variants.sort((left, right) => compareVariants(left.variant ?? "", right.variant ?? ""));
  }
  return families;
}

/** "POLO PIQUET MESCLA" → "Polo piquet mescla"; texto já com caixa mista fica. */
const SMALL_WORDS = new Set(["de", "da", "do", "das", "dos", "e", "em", "com", "sem", "ml", "kg", "cm", "un", "kit", "par", "cor", "tam", "gel", "pen"]);

export function displayName(value: string) {
  const text = value.trim();
  if (!text || text !== text.toUpperCase()) return text;
  // Siglas curtas (BTG, SP) ficam em maiúsculas; o resto vira minúsculas.
  const words = text.split(/(\s+)/).map((word) => {
    const lower = word.toLocaleLowerCase("pt-BR");
    const letters = word.replace(/[^\p{L}]/gu, "");
    return letters.length >= 2 && letters.length <= 3 && !SMALL_WORDS.has(lower) ? word : lower;
  });
  const joined = words.join("");
  return joined.charAt(0).toLocaleUpperCase("pt-BR") + joined.slice(1);
}
