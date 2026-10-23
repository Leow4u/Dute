/**
 * Estoque do portal: nomes, tipos e resumo da vitrine.
 *
 * A Contagem e o Receber gravam o nome como a descrição ("Polo masculino
 * pima preta SW") e a categoria como o tipo ("Polo", "Sacola"). O título do
 * cartão usa o nome; o filtro agrupa pela categoria (agrupar pelo nome dava
 * uma opção por produto).
 *
 * O gênero do chip FEM/MASC vem do mesmo texto do título, não do campo Gênero
 * do cadastro: a Contagem pré-preenche esse campo pelo prefixo do código (A.01
 * vira Masculino), e a BTG usa A.01 também em polo feminina (A.01.0805.002).
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

function categoryOf(product: Pick<StockLike, "category">) {
  const category = product.category?.trim();
  return category && category !== "Sem categoria" ? category : "";
}

/** Nome que a pessoa reconhece: a descrição; sem ela, a categoria. */
export function productTitle(product: Pick<StockLike, "name" | "category">) {
  return displayName(product.name?.trim() || categoryOf(product));
}

/** Tipo do produto, a categoria (POLO → Polo), para o filtro e a linha de apoio. */
export function productType(product: Pick<StockLike, "category">) {
  return displayName(categoryOf(product) || "Outros");
}

export type ProductGender = "feminino" | "masculino";

const FEMININO = /\b(?:feminin[oa]s?|fem)\b/;
const MASCULINO = /\b(?:masculin[oa]s?|masc)\b/;

/**
 * Gênero dito no nome que o cartão mostra ("Polo feminina…", "Camiseta
 * masculino…", "fem."/"masc."). Sem a palavra, ou com as duas, não marca.
 */
export function productGender(product: Pick<StockLike, "name" | "category">): ProductGender | null {
  const text = productTitle(product)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const feminino = FEMININO.test(text);
  const masculino = MASCULINO.test(text);
  if (feminino === masculino) return null;
  return feminino ? "feminino" : "masculino";
}

export function typeValue(product: Pick<StockLike, "category">) {
  return slug(categoryOf(product)) || "outros";
}

export function typeOptions(products: Array<Pick<StockLike, "category">>) {
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
