import type { LinhaEntrada } from "./orcamento.js";

/**
 * A execução da demanda direta aberta pela Operação, para o orçamento dela
 * (docs/plataforma/fase-3-operacao.md, parte 3.10d). A revisão da Operação
 * grava o resumo em `demands/{numero}.operacao` (parte 3.10a): por linha, o
 * item do catálogo, a unidade e o que se cobra (`a_cobrar`, já sem o
 * absorvido). O orçamento da execução nasce com essas linhas pela tabela;
 * o que a tabela não tem (item avulso, fora da tabela, inativo ou de
 * armazenagem) volta para o Comercial lançar à mão, com o preço.
 *
 * O Comercial só lê o resumo: nada aqui escreve na demanda.
 */

export type LinhaExecutada = { lpu_item_id: string | null; item: string; unidade: string | null; quantidade: string };

export type ItemParaPrefill = { id: string; ativo: boolean; orcavel: boolean };

const QUANTIDADE = /^\d{1,9}(\.\d{1,3})?$/;

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

function positiva(quantidade: string): boolean {
  return QUANTIDADE.test(quantidade) && Number(quantidade) > 0;
}

/** O que a Operação executou e se cobra, por linha, do resumo da demanda. */
export function linhasExecutadas(demanda: Record<string, unknown>): LinhaExecutada[] {
  const operacao = demanda.operacao && typeof demanda.operacao === "object" ? (demanda.operacao as Record<string, unknown>) : null;
  const itens = Array.isArray(operacao?.itens) ? operacao.itens : [];
  return itens.flatMap((bruto): LinhaExecutada[] => {
    if (!bruto || typeof bruto !== "object") return [];
    const linha = bruto as Record<string, unknown>;
    const quantidade = texto(linha.a_cobrar);
    if (!positiva(quantidade)) return [];
    return [{ lpu_item_id: texto(linha.lpu_item_id) || null, item: texto(linha.item), unidade: texto(linha.unidade) || null, quantidade }];
  });
}

/**
 * Separa as linhas: as que a tabela precifica (item do catálogo ativo,
 * orçável e com preço na tabela) entram no orçamento pelo preço da tabela;
 * as outras ficam fora, para o Comercial lançar.
 */
export function separarPelaTabela(
  linhas: readonly LinhaExecutada[],
  precos: Readonly<Record<string, unknown>> | null,
  itens: ReadonlyMap<string, ItemParaPrefill>,
): { entradas: LinhaEntrada[]; fora: Array<Pick<LinhaExecutada, "item" | "unidade" | "quantidade">> } {
  const entradas: LinhaEntrada[] = [];
  const fora: Array<Pick<LinhaExecutada, "item" | "unidade" | "quantidade">> = [];
  for (const linha of linhas) {
    const item = linha.lpu_item_id ? itens.get(linha.lpu_item_id) : undefined;
    const naTabela = Boolean(precos && linha.lpu_item_id && Object.prototype.hasOwnProperty.call(precos, linha.lpu_item_id));
    if (linha.lpu_item_id && item && item.ativo && item.orcavel && naTabela) {
      entradas.push({ origem: "tabela", lpu_item_id: linha.lpu_item_id, quantidade: linha.quantidade });
    } else {
      fora.push({ item: linha.item, unidade: linha.unidade, quantidade: linha.quantidade });
    }
  }
  return { entradas, fora };
}

/** Por que a demanda não se orça por aqui, ou null: só a direta aberta pela Operação, executada e sem orçamento. */
export function problemaParaOrcarAExecucao(numero: string, demanda: Record<string, unknown>, temOrcamento: boolean): string | null {
  if (temOrcamento) return `A demanda ${numero} já tem orçamento.`;
  if (demanda.entrada !== "direta" || demanda.aberta_pela !== "operacao") return "Só a demanda direta aberta pela Operação se orça a partir da execução.";
  if (demanda.perda || demanda.cancelamento) return `A demanda ${numero} está perdida ou cancelada.`;
  if (demanda.etapa !== "execucao_a_orcar") return `A demanda ${numero} é direta e ainda não tem orçamento: está com a Operação até a execução.`;
  return null;
}
