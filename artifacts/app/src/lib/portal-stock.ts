/**
 * Estoque do portal: nomes, tipos e resumo da vitrine.
 *
 * A Contagem e o Receber gravam o nome como a descrição ("Polo masculino
 * pima preta SW") e a categoria como o tipo ("Polo", "Sacola"). O título do
 * cartão usa o nome; o filtro agrupa pela categoria (agrupar pelo nome dava
 * uma opção por produto).
 *
 * O nome é o mesmo em todos os tamanhos da família (padrão de 06/11/2026,
 * docs/mockups/NomePortal*.dc.html): o título tira o tamanho repetido no fim
 * ("Polo masculino piquet preto - XG" → "Polo masculino piquet preto"), e o
 * que mostra um tamanho só leva o tamanho depois do ponto ("… · XG"). O
 * tamanho é o fim do código do cliente (A.01.0806.005.XG → XG); sem ele, o
 * campo Tamanho da projeção. Assim a tela fica certa antes e depois da
 * limpeza dos nomes gravados.
 *
 * O gênero do chip FEM/MASC vem do mesmo texto do título, não do campo Gênero
 * do cadastro: a Contagem pré-preenche esse campo pelo prefixo do código (A.01
 * vira Masculino), e a BTG usa A.01 também em polo feminina (A.01.0805.002).
 */

import { nomeSemTamanho, tamanhoDoProduto } from "@workspace/dominio";

import { displayName } from "./stock-variants";

type StockLike = {
  name: string;
  category: string;
  /** O código do cliente que o card mostra ("Sem cod. cliente" quando falta). */
  clientCode?: string | null;
  /** O código do cliente do item (cod_cliente), que termina no tamanho: A.01.0806.005.XG. */
  clientItemCode?: string | null;
  /** O campo Tamanho da projeção (size): vale quando o código não diz o tamanho. */
  size?: string | null;
  available: number;
  receiving?: number;
  total?: number;
  minimum?: number;
  archived?: boolean;
};

type NamedProduct = Pick<StockLike, "name" | "category" | "clientCode" | "clientItemCode" | "size">;

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

function codeOf(product: NamedProduct) {
  return product.clientItemCode ?? product.clientCode ?? null;
}

/**
 * Nome que a pessoa reconhece: a descrição; sem ela, a categoria. Sem o
 * tamanho repetido no fim, que os botões de tamanho mostram (ou
 * productTitleWithSize, depois do ponto).
 */
export function productTitle(product: NamedProduct) {
  const nome = product.name?.trim() || categoryOf(product);
  return displayName(nomeSemTamanho({ nome, codigo: codeOf(product), tamanho: product.size }));
}

/** O tamanho do produto: o fim do código do cliente; sem ele, o campo Tamanho; ou null. */
export function productSize(product: NamedProduct) {
  return tamanhoDoProduto({ codigo: codeOf(product), tamanho: product.size });
}

/**
 * "Polo masculino piquet preto · XG": o título e o tamanho depois do ponto,
 * para o que mostra um tamanho só (a linha da lista e a do pedido, o card e o
 * detalhe sem botões de tamanho, o contador). Tamanho único (U) e produto sem
 * tamanho ficam só com o título. O tamanho entra depois do displayName, que
 * poria em minúscula a palavra de uma letra ("P").
 */
export function productTitleWithSize(product: NamedProduct) {
  const title = productTitle(product);
  const size = productSize(product);
  if (!size || size.toUpperCase() === "U") return title;
  return title ? `${title} · ${size}` : size;
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
export function productGender(product: NamedProduct): ProductGender | null {
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
    receiving: active.reduce((sum, product) => sum + Math.max(0, product.receiving ?? 0), 0),
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
    overview.receiving ? `${integer.format(overview.receiving)} em recebimento` : "",
    overview.low ? `${integer.format(overview.low)} abaixo do mínimo` : "",
    overview.zero ? `${integer.format(overview.zero)} sem saldo` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}
