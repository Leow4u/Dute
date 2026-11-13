import type { UseQueryResult } from "@tanstack/react-query";
import { useRef } from "react";

/** O pedaço da leitura do react-query que a falha precisa para ficar na tela. */
export type LeituraQueFalha = Pick<
  UseQueryResult<unknown>,
  "data" | "error" | "errorUpdatedAt" | "errorUpdateCount" | "isError" | "isLoading" | "isFetching"
>;

/**
 * A leitura que falhou e ainda não tem dado, enquanto tenta de novo. O
 * react-query 5, na nova tentativa sem dado, volta o status a "pending" e
 * zera o erro: a tela que pergunta pelo carregando antes da falha trocaria o
 * bloco com o "Tentar de novo" pela caixa "Carregando…", e o botão sumiria
 * com o foco nele (WCAG 2.4.3). Aqui a falha fica na tela, com o erro de
 * antes e o `isFetching` ("Tentando de novo…"), até a leitura responder: o
 * dado entra, ou a falha nova toma o lugar da velha.
 *
 * Só vale para o erro desta leitura: a chave nova (outra conversa) começa sem
 * falha e mostra o carregando como sempre.
 */
export function useLeituraComFalha<L extends LeituraQueFalha>(leitura: L): L {
  const ultima = useRef<{ em: number; erro: unknown } | null>(null);
  if (leitura.error != null) ultima.current = { em: leitura.errorUpdatedAt, erro: leitura.error };
  const falhaDeAntes = ultima.current;
  const tentandoDeNovo =
    leitura.data === undefined &&
    leitura.error == null &&
    leitura.isFetching &&
    leitura.errorUpdateCount > 0 &&
    falhaDeAntes !== null &&
    falhaDeAntes.em === leitura.errorUpdatedAt;
  if (!tentandoDeNovo) return leitura;
  return { ...leitura, error: falhaDeAntes.erro, isError: true, isLoading: false };
}
