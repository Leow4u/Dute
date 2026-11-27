import { formatarReais, nomeComTamanho, nomeSemTamanho } from "@workspace/dominio";

import { groupFamilies, variantLabel } from "../stock-variants";
import type { PrecoDaEdicao } from "./leitura";
import type { EdicaoView, ItemDaEdicao, ItemView } from "./tipos";

/**
 * Os itens do evento na tela do portal (docs/mockups/EventosPortalNovo.dc.html
 * e EventosPortalItens.dc.html): a família pelo código do cliente, com a
 * quantidade de cada tamanho; o resumo e o valor das peças pelo Estoque de
 * hoje; a janela do "Ver mais"; a falta de saldo antes do envio; e o item
 * reduzido aos seis campos que o ItemDaEdicaoSchema do servidor aceita.
 */

/** O item como a leitura o entrega (com o registro do que foi e voltou) ou como a tela o monta (só os seis de entrada). */
export type ItemLido = ItemDaEdicao & Partial<Pick<ItemView, "foi" | "voltou" | "avariadas" | "nao_voltaram" | "observacao">>;

/** Os seis campos do ItemDaEdicaoSchema, que é `.strict()`. */
export type ItemDeEntrada = ItemDaEdicao;

/** O produto do Estoque de hoje que a tela junta ao item: o saldo livre (`available`), o valor e a foto. */
export type ProdutoDoEstoque = {
  sku: string;
  clientItemCode?: string | null;
  total: number;
  available: number;
  value: number;
  photoUrl?: string | null;
};

export type FamiliaDaEdicao = {
  chave: string;
  nome: string;
  codigo: string;
  categoria: string | null;
  tamanhos: Array<{ item: ItemLido; tamanho: string | null }>;
  pecas: number;
};

/** Famílias à vista no formulário, antes de "Ver os N itens". */
export const ITENS_A_VISTA_NO_FORMULARIO = 5;
/** Itens à vista no diálogo, antes do primeiro "Ver mais". */
export const ITENS_A_VISTA = 16;
/** O que cada "Ver mais" acrescenta. */
export const PAGINA_DO_VER_MAIS = 30;

const NUMERO = new Intl.NumberFormat("pt-BR");
const numero = (valor: number) => NUMERO.format(valor);

function plural(quantos: number, um: string, muitos: string): string {
  return `${numero(quantos)} ${quantos === 1 ? um : muitos}`;
}

function semAcento(valor: string): string {
  return valor.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Reduz o item aos seis campos de entrada: o servidor recusa a chave desconhecida, mesmo nula. Nunca `undefined`. */
export function itemDeEntrada(item: ItemLido): ItemDeEntrada {
  return {
    sku_code: item.sku_code,
    client_item_code: item.client_item_code ?? null,
    product_name: item.product_name,
    size: item.size ?? null,
    category: item.category ?? null,
    quantity: item.quantity,
  };
}

/** As famílias pelo código do cliente (A.01.0809.002.P/M/G/GG), na ordem dos itens; o tamanho é o da variação, ou o do item. */
export function familiasDaEdicao(itens: readonly ItemLido[]): FamiliaDaEdicao[] {
  return groupFamilies(
    [...itens],
    (item) => item.client_item_code,
    (item) => item.sku_code,
  ).map((familia) => {
    const primeiro = familia.variants[0].item;
    return {
      chave: familia.key,
      nome: nomeSemTamanho({ nome: primeiro.product_name, codigo: primeiro.client_item_code, tamanho: primeiro.size }) || primeiro.product_name,
      codigo: familia.base || primeiro.client_item_code || primeiro.sku_code,
      categoria: primeiro.category?.trim() || null,
      tamanhos: familia.variants.map(({ item, variant }) => ({ item, tamanho: variant ? variantLabel(variant) : item.size?.trim() || null })),
      pecas: familia.variants.reduce((soma, { item }) => soma + item.quantity, 0),
    };
  });
}

/** "A.01.0809.002 · 4 tamanhos"; com um tamanho, só o código. */
export function descricaoDaFamilia(familia: FamiliaDaEdicao): string {
  return familia.tamanhos.length > 1 ? `${familia.codigo} · ${familia.tamanhos.length} tamanhos` : familia.codigo;
}

/** "100 itens · 2.000 peças". */
export function resumoDosItens(itens: readonly ItemLido[]): string {
  const pecas = itens.reduce((soma, item) => soma + item.quantity, 0);
  return `${plural(itens.length, "item", "itens")} · ${plural(pecas, "peça", "peças")}`;
}

/** O produto do SKU somado entre as linhas do Estoque dele (o saldo do servidor é por SKU), ou null fora do catálogo. */
function produtoDoSku(sku: string, produtos: readonly ProdutoDoEstoque[]): ProdutoDoEstoque | null {
  const doSku = produtos.filter((produto) => produto.sku === sku);
  if (!doSku.length) return null;
  return doSku.reduce((soma, produto) => ({
    ...soma,
    total: soma.total + produto.total,
    available: soma.available + produto.available,
    value: soma.value + produto.value,
    photoUrl: soma.photoUrl ?? produto.photoUrl ?? null,
  }));
}

/** O valor das peças pelo custo médio do Estoque (em reais); 0 sem custo. */
export function valorDasPecas(itens: readonly ItemLido[], produtos: readonly ProdutoDoEstoque[]): number {
  return itens.reduce((soma, item) => {
    const produto = produtoDoSku(item.sku_code, produtos);
    if (!produto || produto.total <= 0 || produto.value <= 0) return soma;
    return soma + item.quantity * (produto.value / produto.total);
  }, 0);
}

/** "100 itens · 2.000 peças · R$ 86.400,00 em peças"; sem valor, só o resumo. */
export function resumoComValor(itens: readonly ItemLido[], produtos: readonly ProdutoDoEstoque[]): string {
  const centavos = Math.round(valorDasPecas(itens, produtos) * 100);
  return centavos > 0 ? `${resumoDosItens(itens)} · ${formatarReais(centavos)} em peças` : resumoDosItens(itens);
}

export function fotoDoItem(item: ItemLido, produtos: readonly ProdutoDoEstoque[]): string | null {
  return produtoDoSku(item.sku_code, produtos)?.photoUrl ?? null;
}

export type FaltaDeSaldo = { item: ItemLido; disponivel: number; falta: number };

/**
 * Cada item que passa do saldo livre de hoje do SKU, na ordem dos itens. O
 * SKU fora de `produtos` (o arquivado, fora do catálogo) falta inteiro.
 */
export function faltasDeSaldo(itens: readonly ItemLido[], produtos: readonly ProdutoDoEstoque[]): FaltaDeSaldo[] {
  return itens.flatMap((item) => {
    const disponivel = Math.max(0, produtoDoSku(item.sku_code, produtos)?.available ?? 0);
    return item.quantity > disponivel ? [{ item, disponivel, falta: item.quantity - disponivel }] : [];
  });
}

/**
 * "Falta saldo em 2 itens: Polo Masculino Piquet Preto · GG (no evento 120,
 * disponível 80), Caneca Térmica (no evento 50, disponível 0)": as três
 * primeiras; null sem falta.
 */
export function textoDasFaltas(faltas: readonly FaltaDeSaldo[]): string | null {
  if (!faltas.length) return null;
  const nomes = faltas
    .slice(0, 3)
    .map(
      ({ item, disponivel }) =>
        `${nomeComTamanho({ nome: item.product_name, codigo: item.client_item_code, tamanho: item.size })} (no evento ${numero(item.quantity)}, disponível ${numero(disponivel)})`,
    );
  return `Falta saldo em ${plural(faltas.length, "item", "itens")}: ${nomes.join(", ")}`;
}

/** O status em que o retorno já foi registrado. */
const COM_RETORNO = new Set(["retornado", "fechado"]);

/**
 * A linha dos itens do cartão: "100 itens do estoque · 2.000 peças · coleta no
 * cliente: 2.190 produtos" e, do retorno em diante, "· voltaram 63"; só com a
 * coleta, "Coleta no cliente: 2.190 produtos"; null sem nada.
 */
export function linhaDosItens(edicao: EdicaoView): string | null {
  const partes: string[] = [];
  if (edicao.itens.length) {
    const pecas = edicao.itens.reduce((soma, item) => soma + item.quantity, 0);
    partes.push(`${plural(edicao.itens.length, "item do estoque", "itens do estoque")} · ${plural(pecas, "peça", "peças")}`);
  }
  if (COM_RETORNO.has(edicao.status) && edicao.itens.length) {
    partes.push(`voltaram ${numero(edicao.itens.reduce((soma, item) => soma + (item.voltou ?? 0), 0))}`);
  } else if (edicao.coleta.quantidade > 0) {
    partes.push(`${partes.length ? "coleta" : "Coleta"} no cliente: ${plural(edicao.coleta.quantidade, "produto", "produtos")}`);
  }
  return partes.length ? partes.join(" · ") : null;
}

/** "Preço fechado R$ 12.400,00 · 31 fotos", só com o preço fechado. */
export function linhaDoFechamento(edicao: EdicaoView, preco: PrecoDaEdicao | null): string | null {
  if (preco?.fechado_cents == null) return null;
  const fechado = `Preço fechado ${formatarReais(preco.fechado_cents)}`;
  return edicao.fotos.length ? `${fechado} · ${plural(edicao.fotos.length, "foto", "fotos")}` : fechado;
}

/** Os tipos dos itens, na ordem em que aparecem, com quantos itens cada um tem. */
export function categoriasDosItens(itens: readonly ItemLido[]): Array<{ categoria: string; itens: number }> {
  const contagem = new Map<string, number>();
  for (const item of itens) {
    const categoria = item.category?.trim();
    if (categoria) contagem.set(categoria, (contagem.get(categoria) ?? 0) + 1);
  }
  return [...contagem].map(([categoria, quantos]) => ({ categoria, itens: quantos }));
}

/** A busca pelo nome e pelos códigos, sem acento; o tipo pela categoria da família. */
export function filtrarFamilias(familias: readonly FamiliaDaEdicao[], filtro: { busca: string; categoria: string | null }): FamiliaDaEdicao[] {
  const busca = semAcento(filtro.busca.trim());
  return familias.filter((familia) => {
    if (filtro.categoria && familia.categoria !== filtro.categoria) return false;
    if (!busca) return true;
    const textos = [familia.nome, familia.codigo, ...familia.tamanhos.flatMap(({ item }) => [item.client_item_code ?? "", item.sku_code])];
    return textos.some((texto) => semAcento(texto).includes(busca));
  });
}

/** "Como no Estoque": a ordem dos produtos (a família fora deles vai ao fim); "Nome: A-Z": pelo nome. */
export function ordenarFamilias(familias: readonly FamiliaDaEdicao[], ordem: "estoque" | "nome", produtos: readonly ProdutoDoEstoque[]): FamiliaDaEdicao[] {
  if (ordem === "nome") return [...familias].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR", { numeric: true }));
  const posicao = new Map<string, number>();
  produtos.forEach((produto, indice) => {
    if (!posicao.has(produto.sku)) posicao.set(produto.sku, indice);
  });
  const lugar = (familia: FamiliaDaEdicao) => Math.min(...familia.tamanhos.map(({ item }) => posicao.get(item.sku_code) ?? Number.MAX_SAFE_INTEGER));
  return familias
    .map((familia, indice) => ({ familia, indice, lugar: lugar(familia) }))
    .sort((a, b) => a.lugar - b.lugar || a.indice - b.indice)
    .map(({ familia }) => familia);
}

/**
 * As famílias inteiras que cabem em `itensAVista` (pelo menos uma), quantos
 * itens elas mostram e quantos o próximo "Ver mais" acrescenta.
 */
export function janelaDeFamilias(
  familias: readonly FamiliaDaEdicao[],
  itensAVista: number,
): { familias: FamiliaDaEdicao[]; mostrando: number; proximos: number } {
  const vistas: FamiliaDaEdicao[] = [];
  let mostrando = 0;
  for (const familia of familias) {
    const itens = familia.tamanhos.length;
    if (vistas.length && mostrando + itens > itensAVista) break;
    vistas.push(familia);
    mostrando += itens;
  }
  const total = familias.reduce((soma, familia) => soma + familia.tamanhos.length, 0);
  return { familias: vistas, mostrando, proximos: Math.min(PAGINA_DO_VER_MAIS, total - mostrando) };
}

/** "Mostrando 16 de 100 itens". */
export function textoDoMostrando(mostrando: number, total: number): string {
  return `Mostrando ${numero(mostrando)} de ${plural(total, "item", "itens")}`;
}

/** "Ver mais 30 itens". */
export function textoDoVerMais(proximos: number): string {
  return `Ver mais ${plural(proximos, "item", "itens")}`;
}

/** A quantidade nova de um SKU; 0 tira o item. */
export function comQuantidade<T extends ItemLido>(itens: readonly T[], skuCode: string, quantidade: number): T[] {
  if (quantidade <= 0) return itens.filter((item) => item.sku_code !== skuCode);
  return itens.map((item) => (item.sku_code === skuCode ? { ...item, quantity: quantidade } : item));
}

/** Tira a família inteira (todos os tamanhos). */
export function semFamilia<T extends ItemLido>(itens: readonly T[], familia: FamiliaDaEdicao): T[] {
  const skus = new Set(familia.tamanhos.map(({ item }) => item.sku_code));
  return itens.filter((item) => !skus.has(item.sku_code));
}
