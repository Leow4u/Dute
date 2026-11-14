import { useEffect, useState, type RefObject } from "react";

import { CARREGANDO } from "./tempo";

/**
 * Quanto dura a chegada inteira: a última linha da cascata começa 150 ms
 * depois da primeira (seis linhas, 30 ms entre elas) e entra em 150 ms.
 */
export const DURACAO_DA_CHEGADA_MS = CARREGANDO.chegadaMs + (CARREGANDO.linhasNaCascata - 1) * CARREGANDO.passoMs;

/**
 * As animações da chegada (index.css): a linha real e o vazio que entram
 * (`carregando-chega-linha`), o número que entra no lugar do bloco
 * (`carregando-conta-entra`) e as linhas-fantasma que esmaecem por baixo
 * delas (`carregando-some`).
 */
const ANIMACOES_DA_CHEGADA: ReadonlySet<string> = new Set(["carregando-chega-linha", "carregando-conta-entra", "carregando-some"]);

/** As animações da chegada que ainda correm dentro do elemento (as que terminaram ou saíram não contam). */
function chegadaQueCorre(elemento: Element): Animation[] {
  return elemento
    .getAnimations({ subtree: true })
    .filter((animacao) => ANIMACOES_DA_CHEGADA.has((animacao as CSSAnimation).animationName) && animacao.playState !== "finished");
}

/**
 * A chegada do dado no lugar das linhas-fantasma (momento 2): verdadeiro
 * desde o desenho em que a primeira leitura terminou (`lendo` passou a falso)
 * até a cascata acabar. Só a primeira leitura chega assim: a releitura e o
 * que muda depois andam pela lista sem saltos.
 *
 * O fim é o das animações, e não um relógio: elas só começam no primeiro
 * quadro pintado depois da chegada, que no celular lento vem mais de 150 ms
 * depois do efeito (a lista sem saltos ainda redesenha antes de pintar). Com o
 * `alvo` (o grupo), a chegada acaba quando nenhuma animação dela corre mais
 * ali dentro, conferido a cada quadro em que uma termina; a linha que entrou
 * durante a chegada também é esperada. Sem ele, ou sem as animações no
 * ambiente (o jsdom), o relógio de `DURACAO_DA_CHEGADA_MS`.
 */
export function useChegada(lendo: boolean, alvo?: RefObject<Element | null>): boolean {
  const [antes, setAntes] = useState(lendo);
  const [chegando, setChegando] = useState(false);
  if (antes !== lendo) {
    setAntes(lendo);
    setChegando(!lendo);
  }
  useEffect(() => {
    if (!chegando) return undefined;
    const elemento = alvo?.current ?? null;
    if (!elemento || typeof elemento.getAnimations !== "function" || typeof requestAnimationFrame !== "function") {
      const fim = setTimeout(() => setChegando(false), DURACAO_DA_CHEGADA_MS);
      return () => clearTimeout(fim);
    }
    let viva = true;
    let quadro = 0;
    // No quadro seguinte ao efeito, a lista já tem as linhas da chegada (a lista sem saltos redesenha antes de pintar).
    const conferir = () => {
      if (!viva) return;
      const correndo = chegadaQueCorre(elemento);
      if (!correndo.length) {
        setChegando(false);
        return;
      }
      // A que sai da tela no meio (a linha removida) é cancelada: conta como terminada.
      void Promise.allSettled(correndo.map((animacao) => animacao.finished)).then(() => {
        if (viva) quadro = requestAnimationFrame(conferir);
      });
    };
    quadro = requestAnimationFrame(conferir);
    return () => {
      viva = false;
      cancelAnimationFrame(quadro);
    };
  }, [alvo, chegando]);
  return chegando;
}
