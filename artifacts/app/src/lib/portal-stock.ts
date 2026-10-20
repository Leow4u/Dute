/**
 * Estoque do portal: nomes, tipos e resumo da vitrine.
 *
 * Nos dados da BTG o nome do produto é o TIPO ("POLO", "SACOLA") e a
 * categoria é o nome legível ("Polo piquet riscos"). O título do cartão usa a
 * categoria; o filtro agrupa pelo tipo (filtrar pela categoria dava uma opção
 * por produto: 373 para 124 produtos).
 */

import { displayName } from "./stock-variants";

type StockLike = { name: string; category: string; available: number; total?: number; minimum?: number; archived?: boolean };

function slug(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Nome que a pessoa reconhece: a categoria, quando existe; senão o nome. */
export function productTitle(product: Pick<StockLike, "name" | "category">) {
  const category = product.category?.trim();
  return displayName(category && category !== "Sem categoria" ? category : product.name);
}

/** Tipo do produto (POLO → Polo), para o filtro e a linha de apoio. */
export function productType(product: Pick<StockLike, "name">) {
  return displayName(product.name || "Outros");
}

export function typeValue(product: Pick<StockLike, "name">) {
  return slug(product.name) || "outros";
}

export function typeOptions(products: Array<Pick<StockLike, "name">>) {
  const counts = new Map<string, { value: string; label: string; count: number }>();
  for (const product of products) {
    const value = typeValue(product);
    const current = counts.get(value) ?? { value, label: productType(product), count: 0 };
    current.count += 1;
    counts.set(value, current);
  }
  return [
    { value: "todos", label: "Todos os tipos", count: products.length },
    ...[...counts.values()].sort((left, right) => right.count - left.count || left.label.localeCompare(right.label, "pt-BR")),
  ];
}

export function isLow(product: StockLike) {
  return product.minimum !== undefined && product.available > 0 && product.available <= product.minimum;
}

/** Resumo do topo e contagem dos filtros (fora os arquivados). */
export function stockOverview(products: StockLike[]) {
  const active = products.filter((product) => !product.archived);
  return {
    items: active.length,
    pieces: active.reduce((sum, product) => sum + Math.max(0, product.total ?? product.available), 0),
    withStock: active.filter((product) => product.available > 0).length,
    low: active.filter(isLow).length,
    zero: active.filter((product) => product.available <= 0).length,
    archived: products.length - active.length,
  };
}

const integer = new Intl.NumberFormat("pt-BR");

export function overviewLine(overview: ReturnType<typeof stockOverview>) {
  return [
    `${integer.format(overview.pieces)} ${overview.pieces === 1 ? "peça" : "peças"} em ${integer.format(overview.items)} ${overview.items === 1 ? "item" : "itens"}`,
    overview.low ? `${integer.format(overview.low)} abaixo do mínimo` : "",
    overview.zero ? `${integer.format(overview.zero)} sem saldo` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}
