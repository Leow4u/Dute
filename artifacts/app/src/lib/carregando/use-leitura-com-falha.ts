import type { UseQueryResult } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { usePedidosDaPessoa } from "./pedido-da-pessoa";

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

/**
 * A lista que falhou sem nada lido e é relida sem que a pessoa peça (o
 * intervalo da tela, o tempo real): a falha fica na tela, como na
 * `useLeituraComFalha`, com o aviso, o "Tentar de novo" e o foco nele, e a
 * lista não volta às linhas-fantasma a cada minuto (a releitura automática não
 * mostra nada nem fala). Só a nova tentativa que a pessoa pede
 * (`marcarPedidoDaPessoa`, o "Tentar de novo" do aviso) volta à espera da
 * lista: as linhas-fantasma, "Carregando pedidos" e o foco na linha de estado
 * (Pedidos e Receber, a parte 8).
 */
export function useFalhaNaReleituraAutomatica<L extends LeituraQueFalha>(leitura: L): L {
  const pedidos = usePedidosDaPessoa();
  const comFalha = useLeituraComFalha(leitura);
  // Quantas novas leituras a pessoa tinha pedido quando a leitura falhou: um pedido depois disso é dela.
  const pedidosNaFalha = useRef<number | null>(null);
  if (leitura.error != null) pedidosNaFalha.current = pedidos;
  const pediu = pedidosNaFalha.current !== null && pedidos !== pedidosNaFalha.current;
  return pediu ? leitura : comFalha;
}

/** O pedaço de cada consulta de um `useQueries` que a nova tentativa precisa. */
export type ConsultaQueTenta = Pick<UseQueryResult<unknown>, "isError" | "refetch">;

/**
 * A nova tentativa das consultas de um `useQueries` (as fontes da via da NF, o
 * rateio dos Relatórios), como a `useLeituraComFalha` faz com uma consulta: o
 * react-query 5 volta a consulta sem dado a "pending" e zera o erro na nova
 * leitura, e o aviso sairia da tela com o foco nele. Aqui `erro` fica até as
 * consultas que falharam responderem de novo, com `tentando`; só as que
 * falharam relêem.
 */
export function useConsultasComFalha(consultas: ReadonlyArray<ConsultaQueTenta>): { erro: boolean; tentando: boolean; tentar: () => void } {
  const [tentando, setTentando] = useState(false);
  const montado = useRef(true);
  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);
  const falhou = consultas.some((consulta) => consulta.isError);
  return {
    erro: falhou || tentando,
    tentando,
    tentar: () => {
      const falharam = consultas.filter((consulta) => consulta.isError);
      if (!falharam.length || tentando) return;
      setTentando(true);
      void Promise.allSettled(falharam.map((consulta) => consulta.refetch())).then(() => {
        if (montado.current) setTentando(false);
      });
    },
  };
}
