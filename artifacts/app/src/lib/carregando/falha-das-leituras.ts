import type { UseQueryResult } from "@tanstack/react-query";

import { ehFaltaDeConexao } from "@/lib/conexao";

/**
 * Uma leitura da tela, em par: a do react-query (quem relê) e a cópia da
 * `useLeituraComFalha` (a falha que fica na tela enquanto tenta de novo).
 */
export type ParDaLeitura = readonly [
  leitura: Pick<UseQueryResult<unknown>, "data" | "refetch">,
  naTela: Pick<UseQueryResult<unknown>, "data" | "error" | "isError">,
];

/** O que a `FalhaNaLeitura` precisa: a falha que fica na tela e a nova tentativa. */
export interface FalhaDasLeituras {
  /** A falta de conexão, se alguma leitura está sem conexão e falta ler alguma; senão, a primeira que falhou sem nada lido. */
  erro: Error;
  /** A nova tentativa relê as leituras sem nada lido e as que falharam, e acaba quando todas respondem. */
  leitura: Pick<UseQueryResult<unknown>, "error" | "refetch">;
}

/**
 * As leituras de uma tela que só entra com todas lidas (o Estoque: o catálogo
 * e os saldos; o Mapa: as posições, as caixas e os saldos; as Etiquetas), como
 * uma leitura só para a `FalhaNaLeitura` (carregamento v2, parte 13b). A falha
 * vem das cópias, que guardam o erro na nova tentativa: o "Reconectando…" não
 * vira o erro genérico enquanto relê, e o aviso não sai com o foco nele. O
 * "Tentando de novo…" é o da `FalhaNaLeitura`: só na nova tentativa que a
 * pessoa pede, nunca na releitura automática. Sem falha, `null`.
 */
export function falhaDasLeituras(pares: readonly ParDaLeitura[]): FalhaDasLeituras | null {
  const naTela = pares.map(([, copia]) => copia);
  const faltaLer = naTela.some((copia) => copia.data === undefined);
  const semConexao = naTela.find((copia) => copia.isError && ehFaltaDeConexao(copia.error));
  const semNadaLido = naTela.find((copia) => copia.isError && copia.data === undefined);
  const falha = semConexao && faltaLer ? semConexao : semNadaLido;
  if (!falha || falha.error == null) return null;
  const erro = falha.error;
  const refetch = () =>
    Promise.all(
      pares.filter(([leitura, copia]) => leitura.data === undefined || copia.isError).map(([leitura]) => leitura.refetch()),
    ).then((resultados) => resultados[0]);
  return { erro, leitura: { error: erro, refetch: refetch as Pick<UseQueryResult<unknown>, "refetch">["refetch"] } };
}
