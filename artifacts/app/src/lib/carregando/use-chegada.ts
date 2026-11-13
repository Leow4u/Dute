import { useEffect, useState } from "react";

import { CARREGANDO } from "./tempo";

/**
 * Quanto dura a chegada inteira: a última linha da cascata começa 150 ms
 * depois da primeira (seis linhas, 30 ms entre elas) e entra em 150 ms.
 */
export const DURACAO_DA_CHEGADA_MS = CARREGANDO.chegadaMs + (CARREGANDO.linhasNaCascata - 1) * CARREGANDO.passoMs;

/**
 * A chegada do dado no lugar das linhas-fantasma (momento 2): verdadeiro
 * desde o desenho em que a primeira leitura terminou (`lendo` passou a falso)
 * até a cascata acabar. Só a primeira leitura chega assim: a releitura e o
 * que muda depois andam pela lista sem saltos.
 */
export function useChegada(lendo: boolean): boolean {
  const [antes, setAntes] = useState(lendo);
  const [chegando, setChegando] = useState(false);
  if (antes !== lendo) {
    setAntes(lendo);
    setChegando(!lendo);
  }
  useEffect(() => {
    if (!chegando) return undefined;
    const fim = setTimeout(() => setChegando(false), DURACAO_DA_CHEGADA_MS);
    return () => clearTimeout(fim);
  }, [chegando]);
  return chegando;
}
