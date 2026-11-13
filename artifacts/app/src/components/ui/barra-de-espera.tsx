import type { CSSProperties } from "react";

import { useEspera, type Espera } from "@/lib/carregando/use-espera";

/** Onde a barra fica: na borda de baixo da linha em andamento ou no topo do cartão que relê. */
export type LugarDaBarra = "linha" | "topo";

/** O fim da espera que a barra mostra: completa em verde ou em crítico. */
export type ResultadoDaBarra = "ok" | "erro";

/** O que a barra desenha (data-estado): varrendo, parada aos 5 s, determinada ou completa. */
export type EstadoDaBarra = "andamento" | "parada" | "progresso" | ResultadoDaBarra;

export interface BarraDeEsperaProps {
  lugar: LugarDaBarra;
  /** A espera está correndo. A barra entra aos 300 ms e, quando a espera acaba, fica até completar o mínimo de 500 ms. */
  ativa: boolean;
  /** De 0 a 1: enche até o valor, sem varrer. Muda por evento, nunca por quadro. */
  progresso?: number;
  /** Depois da espera: completa em verde (`ok`) ou em crítico (`erro`). Sem ele, a barra sai. */
  resultado?: ResultadoDaBarra;
}

/** O progresso entre 0 e 1; o que não é número vira 0. */
function fracao(progresso: number): number {
  return Number.isFinite(progresso) ? Math.min(1, Math.max(0, progresso)) : 0;
}

function estadoDaBarra(espera: Espera, ativa: boolean, progresso: number | undefined, resultado: ResultadoDaBarra | undefined): EstadoDaBarra | null {
  if (espera.visivel) {
    if (progresso !== undefined) return "progresso";
    return espera.movimento ? "andamento" : "parada";
  }
  return !ativa && resultado ? resultado : null;
}

/**
 * A barra de espera do carregamento v2 (aprovado em 12/11/2026, seção 5.5 e
 * momento 4). Na linha (`lugar="linha"`), 4 px na borda de baixo (6 px no
 * celular); no cartão que relê (`lugar="topo"`), 3 px no topo (4 px no
 * celular). Quem a contém é `position: relative`; o cartão, com
 * `overflow: hidden`, para ela respeitar o raio.
 *
 * Aos 300 ms ela entra (150 ms, de 25% da altura) e um segmento de 32% em
 * tinta varre o trilho de tinta a 8%, só por `transform`; aos 5 s para
 * inteira, a 0,6. Com `resultado`, depois do mínimo de 500 ms do em andamento
 * (o mesmo do BotaoDeAcao), completa por `scaleX` em 220 ms: verde no `ok`,
 * crítico no `erro`. Com `progresso`, enche até o valor e não para aos 5 s.
 * No movimento reduzido, fica parada e inteira a 0,6 desde o começo, e o
 * verde entra de uma vez.
 *
 * Decorativa: sempre `aria-hidden`, sem texto e sem região viva. Quem informa
 * é o apoio da linha ("Aprovando pedido 1042…") e o botão. O CSS mora em
 * index.css (`.carregando-barra`).
 */
export function BarraDeEspera({ lugar, ativa, progresso, resultado }: BarraDeEsperaProps) {
  const espera = useEspera(ativa, { segurarMinimo: true });
  const estado = estadoDaBarra(espera, ativa, progresso, resultado);
  if (estado === null) return null;
  return (
    <span
      aria-hidden="true"
      data-barra=""
      data-lugar={lugar}
      data-estado={estado}
      className="carregando-barra"
      style={estado === "progresso" ? ({ "--p": String(fracao(progresso ?? 0)) } as CSSProperties) : undefined}
    >
      <span data-parte="trilho" />
      {estado === "andamento" ? <span data-parte="segmento" /> : null}
      <span data-parte="cheio" />
    </span>
  );
}
