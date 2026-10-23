/**
 * A tabela de um relatório (partes 4.8a e 4.8b): as colunas, as linhas e o
 * total. A mesma forma vai para a tela (components/relatorios) e para a
 * planilha (planilha-xlsx.ts).
 */

/** A célula: texto, número, reais (em centavos) ou sem dado. */
export type CelulaDoRelatorio = string | number | { reais: number } | null;

export type TabelaDeRelatorio = {
  colunas: string[];
  linhas: Array<{ chave: string; celulas: CelulaDoRelatorio[] }>;
  total: CelulaDoRelatorio[] | null;
};

/** Um dos números do período, já em texto ("85%", "R$ 1.234,56"). */
export type NumeroDoResumo = { rotulo: string; valor: string };
