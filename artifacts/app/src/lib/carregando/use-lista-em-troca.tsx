import { memo, useEffect, useMemo, useState, type AnimationEvent, type ReactNode } from "react";
import type { UseQueryResult } from "@tanstack/react-query";

import { BarraDeEspera } from "@/components/ui/barra-de-espera";

import { CARREGANDO } from "./tempo";
import { useLeituraComFalha, type LeituraQueFalha } from "./use-leitura-com-falha";

/** O pedaço da leitura do react-query que diz se a lista na tela é a anterior (`placeholderData`). */
export type LeituraQueTroca = Pick<UseQueryResult<unknown>, "isPlaceholderData">;

/** Como a lista com filtro no servidor se mostra agora. */
export interface ListaComFiltro {
  /** O filtro mudou e a lista na tela ainda é a anterior (`placeholderData`): a 50%, `inert` e `aria-busy`. */
  trocando: boolean;
  /**
   * A leitura falhou sem a lista dela para mostrar (a primeira, ou a troca que
   * falhou), também enquanto tenta de novo: o aviso no lugar da lista, nunca o
   * vazio, nem a lista de outro filtro de volta.
   */
  falhou: boolean;
  /** O erro que o aviso mostra. */
  erro: unknown;
}

/**
 * A leitura da lista com filtro no servidor (momento 7, caso 4): com o
 * `placeholderData: keepPreviousData`, o react-query mostra a lista anterior
 * enquanto a do filtro novo não chega. Se a do filtro novo falha, o aviso
 * entra no lugar dela; a nova tentativa (que o react-query faria com a lista
 * anterior por baixo) segue com o aviso e "Tentando de novo…", como a
 * `useLeituraComFalha`. A releitura com a lista do filtro na tela que falha
 * não a apaga: quem diz é a linha de estado ou a faixa da tela.
 */
export function useListaComFiltro(leitura: LeituraQueFalha & LeituraQueTroca): ListaComFiltro {
  const propria = useLeituraComFalha({ ...leitura, data: leitura.isPlaceholderData ? undefined : leitura.data });
  const falhou = propria.isError && propria.data === undefined;
  const trocando = leitura.isPlaceholderData && !falhou;
  const erro = propria.error;
  // O mesmo objeto enquanto nada muda: quem calcula a lista com ele (os Relatórios) não refaz a conta a cada desenho.
  return useMemo(() => ({ trocando, falhou, erro }), [trocando, falhou, erro]);
}

/** Os atributos do contêiner da lista que troca, para espalhar nele. */
export interface PropsDaListaEmTroca {
  "data-lista-em-troca": "";
  "data-trocando"?: "";
  "data-chegou"?: "";
  "aria-busy"?: true;
  inert?: true;
  onAnimationEnd: (evento: AnimationEvent<HTMLElement>) => void;
}

/**
 * A animação da chegada da lista nova (index.css): a subida de 4 px, em 150
 * ms (nada no reduzido); a opacidade volta a 1 por uma transição, de onde a
 * lista anterior estava.
 */
const ANIMACAO_DA_CHEGADA = "carregando-chega-troca";

/**
 * A troca de filtro, mês ou cliente (carregamento v2, momento 7, caso 4):
 * com o `placeholderData` (a lista anterior fica), enquanto a nova não chega,
 * a lista anterior fica a 50% e `inert`, com `aria-busy`, que só vale neste
 * caso, como na prancha. Nada nela recebe toque nem foco: a lista é de outro
 * filtro. O `inert` também a tira da árvore de acessibilidade, e com ela o
 * `aria-busy` (no Chromium, a lista some para o leitor de tela até a nova
 * chegar); quem diz que ela está atualizando é a linha de estado, aos 5 s. A
 * barra do topo do cartão (`BarraDaLista`) fica fora deste contêiner ou
 * dentro dele: o CSS esmaece tudo menos o caminho até ela (index.css,
 * `[data-lista-em-troca]`), e ela fica inteira.
 *
 * Na chegada, a lista nova volta a 1 da opacidade em que a anterior estava,
 * subindo 4 px, em 150 ms (`data-chegou`, só opacidade no reduzido): nunca
 * passa por 0, e a troca rápida não pisca. O atributo sai quando a subida
 * termina: no celular lento, o primeiro quadro pintado vem depois do efeito.
 * Sem animação no ambiente (o jsdom), um relógio folgado tira o atributo.
 *
 * O foco fica onde a pessoa tocou (o filtro, o mês, a paginação): eles ficam
 * fora deste contêiner.
 */
export function useListaEmTroca(trocando: boolean): { trocando: boolean; props: PropsDaListaEmTroca } {
  const [antes, setAntes] = useState(trocando);
  const [chegou, setChegou] = useState(false);
  if (antes !== trocando) {
    setAntes(trocando);
    setChegou(!trocando);
  }
  useEffect(() => {
    if (!chegou) return undefined;
    // A folga: a animação termina antes; sem ela no ambiente, o atributo não fica para sempre.
    const fim = setTimeout(() => setChegou(false), CARREGANDO.chegadaMs * 4);
    return () => clearTimeout(fim);
  }, [chegou]);
  return {
    trocando,
    props: {
      "data-lista-em-troca": "",
      ...(trocando ? { "data-trocando": "" as const, "aria-busy": true as const, inert: true as const } : {}),
      ...(chegou ? { "data-chegou": "" as const } : {}),
      onAnimationEnd: (evento) => {
        if (evento.target === evento.currentTarget && evento.animationName === ANIMACAO_DA_CHEGADA) setChegou(false);
      },
    },
  };
}

/**
 * A barra no topo do cartão da lista que relê (momento 7, casos 3 e 4): a
 * volta do app ou a troca de filtro. Entra aos 300 ms, para aos 5 s e, na
 * chegada, completa em tinta e esmaece (`BarraDeEspera`, `resultado="fim"`).
 * Fica num invólucro sem caixa (`display: contents`), sempre na árvore: o
 * cartão a posiciona, e a lista que troca esmaece tudo menos o caminho até
 * ela, desde o começo da troca e não só quando a barra aparece.
 */
export function BarraDaLista({ ativa }: { ativa: boolean }) {
  return (
    <span data-barra-da-lista="" aria-hidden="true" className="contents">
      <BarraDeEspera lugar="topo" ativa={ativa} resultado="fim" />
    </span>
  );
}

/**
 * O conteúdo da lista que troca (o corpo da tabela, as linhas): enquanto a
 * nova não chega, ele fica como estava no último desenho, sem se redesenhar.
 * A lista na tela é a anterior, `inert`, e nada nela muda até a chegada; o
 * toque que troca o filtro responde em um quadro, sem refazer a tabela
 * inteira (antes, o toque redesenhava as 50 linhas duas vezes, e a resposta
 * passava de 100 ms com a CPU 4× mais lenta). Na chegada, desenha a nova.
 */
export const ConteudoEmTroca = memo(
  function ConteudoEmTroca({ children }: { trocando: boolean; children: ReactNode }) {
    return <>{children}</>;
  },
  (_antes, depois) => depois.trocando,
);
