import { useCallback, useEffect, useRef, useState } from "react";
import type { UseQueryResult } from "@tanstack/react-query";

import { ehFaltaDeConexao } from "@/lib/conexao";

import { useAnuncio } from "./anunciador";
import { useTentarDeNovo } from "./estado-da-conexao";

/**
 * A leitura de uma lista, como a linha de estado e o Atualizar a veem
 * (carregamento v2, seção 9): o pedaço do `useQuery` que diz se já leu, se
 * está lendo, se falhou e de quando é o dado. O `dataUpdatedAt` zero é a
 * lista que ainda não leu nada.
 */
export type LeituraDaLista = Pick<UseQueryResult<unknown>, "isLoading" | "isFetching" | "isError" | "error" | "dataUpdatedAt" | "refetch">;

/** A lista já leu tudo o que mostra: nenhuma das leituras está sem dado. */
export function listaLida(leituras: readonly LeituraDaLista[]): boolean {
  return leituras.length > 0 && leituras.every((leitura) => leitura.dataUpdatedAt > 0);
}

/** Alguma das leituras está com a falta de conexão: quem relê é o estado da conexão (parte 7a). */
export function listaComFalta(leituras: readonly LeituraDaLista[]): boolean {
  return leituras.some((leitura) => leitura.isError && ehFaltaDeConexao(leitura.error));
}

export interface AtualizarLista {
  /**
   * O toque no Atualizar: relê as leituras da lista (e o que `alemDaLista`
   * relê junto) e, no fim, o Anunciador diz "Lista atualizada". Antes, acorda
   * a conexão de quem lê, para o toque alcançar o servidor. O toque repetido
   * enquanto lê não faz nada.
   */
  atualizar: () => void;
  /** O Atualizar tocado está lendo: só o botão mostra a espera (caso 1 do momento 7). */
  atualizando: boolean;
  /**
   * A releitura da volta do app ao primeiro plano está lendo: a barra no topo
   * do cartão e, passados 5 s, "Atualizando…" na linha de estado (caso 3).
   */
  voltando: boolean;
}

/**
 * Quem pediu a releitura da lista (carregamento v2, momento 7). A releitura
 * automática (o intervalo da tela, o tempo real, a volta da rede) não passa
 * por aqui e não mostra nada; aqui ficam as duas que a pessoa pediu:
 *
 * 1. o toque no Atualizar, que só muda o próprio botão e, no fim, diz "Lista
 *    atualizada";
 * 2. a volta do app ao primeiro plano (`visibilitychange`), que relê a lista
 *    já lida com a barra no topo do cartão. A lista ainda sem leitura já está
 *    lendo, e a com a falta de conexão o estado da conexão relê sozinho.
 *
 * As leituras são as mesmas da `LinhaDeEstado`; `alemDaLista` relê, sem
 * esperar, o que a tela usa além da lista (os saldos da validação, em
 * Pedidos).
 */
export function useAtualizarLista(leituras: readonly LeituraDaLista[], alemDaLista?: () => void): AtualizarLista {
  const tentarDeNovo = useTentarDeNovo();
  const ultimas = useRef(leituras);
  const alem = useRef(alemDaLista);
  const tentar = useRef(tentarDeNovo);
  useEffect(() => {
    ultimas.current = leituras;
    alem.current = alemDaLista;
    tentar.current = tentarDeNovo;
  });
  const [atualizando, setAtualizando] = useState(false);
  const [voltando, setVoltando] = useState(false);
  const tocou = useRef(false);
  const anunciar = useAnuncio();

  const atualizar = useCallback(() => {
    if (tocou.current) return;
    tocou.current = true;
    setAtualizando(true);
    tentar.current(() => {
      alem.current?.();
      void Promise.all(ultimas.current.map((leitura) => leitura.refetch()))
        .then((resultados) => {
          if (resultados.every((resultado) => !resultado.isError)) anunciar("Lista atualizada");
        })
        .finally(() => {
          tocou.current = false;
          setAtualizando(false);
        });
    });
  }, [anunciar]);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    let escondido = document.visibilityState === "hidden";
    let ativo = true;
    const mudou = () => {
      if (document.visibilityState === "hidden") {
        escondido = true;
        return;
      }
      if (!escondido) return;
      escondido = false;
      const lista = ultimas.current;
      if (!listaLida(lista) || listaComFalta(lista)) return;
      setVoltando(true);
      tentar.current(() => {
        void Promise.all(lista.map((leitura) => leitura.refetch({ cancelRefetch: false }))).finally(() => {
          if (ativo) setVoltando(false);
        });
      });
    };
    document.addEventListener("visibilitychange", mudou);
    return () => {
      ativo = false;
      document.removeEventListener("visibilitychange", mudou);
    };
  }, []);

  return { atualizar, atualizando, voltando };
}
