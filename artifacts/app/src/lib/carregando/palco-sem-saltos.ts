import { useEffect, useState, type RefCallback } from "react";

import { CARREGANDO } from "./tempo";

/**
 * O palco de uma tela sem saltos (carregamento v2, momento 4): o que sobe e
 * desce junto quando uma linha deixa uma fila ou chega a outra. Não só as
 * linhas da lista, mas o cartão que encolhe ou cresce, o título e os grupos
 * de baixo: cada peça parte de onde estava e vai ao lugar novo só por
 * transform, em 240 ms (FLIP), nunca por height nem grid-template-rows.
 *
 * As peças são os elementos do palco com `data-palco` (`bloco`, que só anda,
 * ou `estica`, o meio do cartão, que anda e muda de altura por scaleY) e as
 * linhas das filas (`data-chave`), menos a que está saindo. Quem muda a lista
 * chama `antes()` e, depois da mudança no DOM, `depois()`: a primeira foto de
 * uma rodada vale, e a mudança em cascata (a linha que sai de "Para aprovar"
 * e entra em "Para separar") reflui de uma vez. No movimento reduzido nada
 * desliza: o palco não fotografa e tudo pula para o lugar.
 */
export interface PalcoSemSaltos {
  /** O elemento que contém as peças. */
  ref: RefCallback<HTMLElement>;
  /** Fotografa onde cada peça está na tela, antes da mudança. A primeira foto da rodada vale. */
  antes(): void;
  /** Depois da mudança: cada peça que mudou de lugar parte da foto e vai ao lugar novo, só por transform. */
  depois(): void;
  /** Para os relógios do palco (a tela saiu). */
  encerrar(): void;
}

interface Foto {
  top: number;
  height: number;
}

const PECAS = '[data-palco], [data-chave]:not([data-na-lista="saindo"])';

export function movimentoReduzido(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function pecasDo(elemento: HTMLElement): HTMLElement[] {
  return Array.from(elemento.querySelectorAll<HTMLElement>(PECAS));
}

/** Um palco solto, para quem não usa o hook (a lista sem palco da página faz o dela). */
export function criarPalco(): PalcoSemSaltos {
  let elemento: HTMLElement | null = null;
  let foto: Map<HTMLElement, Foto> | null = null;
  let validade: ReturnType<typeof setTimeout> | null = null;
  /** Cada refluxo marca as peças com a sua vez: o fim de um não tira a transição do seguinte. */
  let vez = 0;
  const timers = new Set<ReturnType<typeof setTimeout>>();

  const agendar = (fazer: () => void, ms: number) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      fazer();
    }, ms);
    timers.add(timer);
    return timer;
  };

  const esquecer = () => {
    foto = null;
    if (validade !== null) {
      clearTimeout(validade);
      timers.delete(validade);
      validade = null;
    }
  };

  return {
    ref(no) {
      elemento = no;
    },
    antes() {
      if (foto || !elemento || movimentoReduzido()) return;
      foto = new Map(
        pecasDo(elemento).map((peca) => {
          const caixa = peca.getBoundingClientRect();
          return [peca, { top: caixa.top, height: caixa.height }];
        }),
      );
      // A foto vale só para esta rodada: a mudança chega no DOM antes de o relógio andar.
      validade = agendar(() => {
        validade = null;
        foto = null;
      }, 0);
    },
    depois() {
      const antes = foto;
      esquecer();
      if (!antes || !elemento) return;
      const pecas = pecasDo(elemento);
      // O lugar novo, sem o transform de um refluxo que ainda corre (a foto já tem onde ela estava).
      for (const peca of pecas) {
        peca.removeAttribute("data-reflui");
        peca.style.transform = "";
      }
      const movidas = pecas.filter((peca) => {
        const de = antes.get(peca);
        if (!de) return false;
        const caixa = peca.getBoundingClientRect();
        const anda = de.top - caixa.top;
        const estica = peca.dataset.palco === "estica" && caixa.height > 0 ? de.height / caixa.height : 1;
        if (Math.abs(anda) < 0.5 && Math.abs(estica - 1) * caixa.height < 0.5) return false;
        peca.style.transform = estica === 1 ? `translateY(${anda}px)` : `translateY(${anda}px) scaleY(${estica})`;
        return true;
      });
      if (!movidas.length) return;
      // O navegador assenta o ponto de partida antes da transição.
      void elemento.getBoundingClientRect();
      vez += 1;
      const marca = String(vez);
      for (const peca of movidas) {
        peca.setAttribute("data-reflui", marca);
        peca.style.transform = "";
      }
      // Só a marca desta vez sai: a peça que um refluxo seguinte levou continua a transição dele.
      agendar(() => {
        for (const peca of movidas) if (peca.getAttribute("data-reflui") === marca) peca.removeAttribute("data-reflui");
      }, CARREGANDO.refluiMs);
    },
    encerrar() {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      validade = null;
      foto = null;
    },
  };
}

/**
 * O palco da tela: o `ref` vai no elemento que contém as filas sem saltos (o
 * `palco` de cada useListaSemSaltos), para o refluxo levar junto o cartão, os
 * títulos e os grupos de baixo.
 */
export function usePalcoSemSaltos(): PalcoSemSaltos {
  const [palco] = useState(criarPalco);
  useEffect(() => () => palco.encerrar(), [palco]);
  return palco;
}
