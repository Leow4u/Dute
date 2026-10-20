/*
 * Dicionário português -> inglês da demo: o texto inteiro (sem os espaços
 * das pontas) vira o texto em inglês. Textos com números, nomes e datas
 * ficam em rules.ts. Gerado a partir de uma varredura das telas; ver README.
 */
import phrases from "./en-phrases.json";

export const EN_PHRASES: Record<string, string> = phrases;
