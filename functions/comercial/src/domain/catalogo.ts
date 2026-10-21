import { digest } from "./operations.js";

/**
 * Catálogo do Comercial: `lpu_items/{id}` (docs/plataforma/fase-6-comercial.md,
 * "Tabelas").
 *
 * O item não tem preço; o preço mora na tabela (`price_tables`, tabelas.ts).
 * O id é um digest de categoria, item, serviço e unidade normalizados: a
 * mesma chave escrita de outro jeito ("Mesa de escritório" e "MESA DE
 * ESCRITORIO", "M²" e "m2") cai no mesmo item, então a Padrão Dutelog e as
 * tabelas dos clientes apontam para os mesmos itens, e recarregar não
 * duplica. O código do cliente (DTL-0126...) se repete e não é chave: fica no
 * preço da tabela.
 */

export const LPU_ITEMS_COLLECTION = "lpu_items";
export const LPU_ITEM_ID_PREFIX = "lpu_";

export type ChaveDoItem = {
  categoria: string;
  item: string;
  servico: string;
  unidade: string;
};

const CAMPOS_DA_CHAVE = ["categoria", "item", "servico", "unidade"] as const;

/** Texto como é mostrado: Unicode composto, sem espaço sobrando (quebra de linha da célula vira espaço). */
export function limparTexto(valor: string): string {
  return String(valor ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
}

/**
 * Texto comparado: sem acento, sem maiúscula e sem espaço sobrando. A
 * decomposição de compatibilidade (NFKD) também transforma "²" e "³" em
 * algarismo, então "M²" e "M2" são a mesma unidade.
 */
export function normalizarTexto(valor: string): string {
  return String(valor ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function chaveNormalizada(chave: ChaveDoItem): ChaveDoItem {
  const normalizada = {} as ChaveDoItem;
  for (const campo of CAMPOS_DA_CHAVE) {
    const valor = normalizarTexto(chave[campo]);
    if (!valor) throw new Error(`Item do catálogo com ${campo} vazio.`);
    normalizada[campo] = valor;
  }
  return normalizada;
}

/** Id do item: "lpu_" + digest da chave normalizada. */
export function lpuItemId(chave: ChaveDoItem): string {
  return `${LPU_ITEM_ID_PREFIX}${digest(chaveNormalizada(chave))}`;
}

const ARMAZENAGEM = /\barmazena(?:gem|mento)\b/;

/**
 * Armazenagem não passa por orçamento: a cobrança é do WMS (decisão 3). O
 * item entra no catálogo, com o preço na tabela do contrato, mas não aparece
 * para orçar.
 *
 * Conta a palavra na categoria, no item ou no serviço: numa LPU de cliente a
 * armazenagem pode vir só no item (categoria "Serviços", serviço "Prestação
 * de Serviço"). A descrição não conta: ela é do cliente e muda de tabela para
 * tabela, e o `orcavel` precisa depender só da chave, como o id.
 */
export function itemOrcavel(chave: Pick<ChaveDoItem, "categoria" | "item" | "servico">): boolean {
  return ![chave.categoria, chave.item, chave.servico].some((valor) => ARMAZENAGEM.test(normalizarTexto(valor)));
}

export type LpuItemDoc = ChaveDoItem & {
  id: string;
  descricao: string;
  orcavel: boolean;
  ativo: boolean;
  /** A chave normalizada, a que entra no id. */
  chave: ChaveDoItem;
  /** Tabela cuja carga criou o item. */
  origem_tabela_id: string;
};

/** Documento do item (sem created_at, que é serverTimestamp na gravação). Nunca leva preço nem código do cliente. */
export function lpuItemDoc(input: ChaveDoItem & { descricao: string; origem_tabela_id: string }): LpuItemDoc {
  return {
    id: lpuItemId(input),
    categoria: limparTexto(input.categoria),
    item: limparTexto(input.item),
    servico: limparTexto(input.servico),
    unidade: limparTexto(input.unidade),
    descricao: limparTexto(input.descricao),
    orcavel: itemOrcavel(input),
    ativo: true,
    chave: chaveNormalizada(input),
    origem_tabela_id: input.origem_tabela_id,
  };
}
