import { useEffect, useState, type RefCallback } from "react";

import { CARREGANDO } from "./tempo";

/**
 * O palco de uma tela sem saltos (carregamento v2, momento 4): o que sobe e
 * desce junto quando uma linha deixa uma fila ou chega a outra. Não só as
 * linhas da lista, mas o cartão que encolhe ou cresce, o título e os grupos
 * de baixo: cada peça parte de onde estava e vai ao lugar novo só por
 * transform (a propriedade `translate`, e `scale` no meio do cartão), em 240
 * ms (FLIP), nunca por height nem grid-template-rows.
 *
 * As peças são os elementos do palco com `data-palco` (`bloco`, que só anda,
 * ou `estica`, o meio do cartão, que anda e muda de altura) e as linhas das
 * filas (`data-chave`), também a que está saindo. Quem muda a lista chama
 * `antes()` e, depois da mudança no DOM, `depois()`: a primeira foto de uma
 * rodada vale, e a mudança em cascata (a linha que sai de "Para aprovar" e
 * entra em "Para separar") reflui de uma vez. No movimento reduzido nada
 * desliza: o palco não fotografa e tudo pula para o lugar.
 *
 * O refluxo é uma animação da própria peça (Web Animations), e não uma
 * transição de CSS, por três motivos medidos no Chromium:
 *
 * - um refluxo que começa antes de o anterior terminar soma com ele
 *   (composite "add"): o que corre continua no relógio dele, e o novo leva só
 *   a mudança do layout, do quadro em que ela aparece. A peça não pula, não
 *   volta e não para no meio, nem quando a tarefa longa segura a thread (o
 *   refluxo que corre no compositor seguiu andando);
 * - o `translate` soma com o `transform` da linha que entra ou sai
 *   (carregando-chega-linha e carregando-sai-linha), em vez de ser apagado
 *   por ele;
 * - o palco lê todas as peças antes de escrever em qualquer uma (um layout
 *   só no quadro do soltar).
 *
 * O dedo também é do palco: um toque em qualquer lista dele segura todas
 * (nada na tela se mexe se houve toque nos últimos 700 ms).
 */
export interface PalcoSemSaltos {
  /** O elemento que contém as peças. */
  ref: RefCallback<HTMLElement>;
  /** Fotografa onde cada peça está na tela, antes da mudança. A primeira foto da rodada vale. */
  antes(): void;
  /** Depois da mudança: cada peça que mudou de lugar parte da foto e vai ao lugar novo, só por transform. */
  depois(): void;
  /** Um toque numa lista do palco: nenhuma lista dele tira nem põe linha por 700 ms (até 3 s). */
  tocou(): void;
  /** Quando foi o último toque numa lista do palco (o relógio do performance), ou nulo. */
  ultimoToque(): number | null;
  /** Para os relógios e os refluxos do palco (a tela saiu). */
  encerrar(): void;
}

interface Foto {
  top: number;
  height: number;
}

/** Os pontos de controle da curva do refluxo: a --ease-carregando-padrao (cubic-bezier(.4, 0, .2, 1)). */
const PONTOS_DA_CURVA = [0.4, 0, 0.2, 1] as const;

/** A curva do refluxo: a --ease-carregando-padrao do index.css (lib/carregando/tokens.test.ts trava as duas). */
export const CURVA_DO_REFLUXO = `cubic-bezier(${PONTOS_DA_CURVA.join(", ")})`;

/** O nome da animação do refluxo (document.getAnimations()). */
export const REFLUXO = "carregando-reflui";

/**
 * A curva do refluxo em JS: o progresso (0 a 1) no tempo `x` (0 a 1), o
 * mesmo do navegador com CURVA_DO_REFLUXO. Para compor o meio do cartão
 * quando dois refluxos se cruzam.
 */
export function progressoDoRefluxo(x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const [x1, y1, x2, y2] = PONTOS_DA_CURVA;
  const bezier = (a: number, b: number, t: number) => 3 * (1 - t) * (1 - t) * t * a + 3 * (1 - t) * t * t * b + t * t * t;
  let baixo = 0;
  let alto = 1;
  for (let vez = 0; vez < 40; vez += 1) {
    const meio = (baixo + alto) / 2;
    if (bezier(x1, x2, meio) < x) baixo = meio;
    else alto = meio;
  }
  return bezier(y1, y2, (baixo + alto) / 2);
}

const PECAS = "[data-palco], [data-chave]";

/** Quantos quadros-chave tem o meio do cartão composto (um a cada 10 ms do refluxo). */
const QUADROS_DO_MEIO = 24;

export function movimentoReduzido(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function pecasDo(elemento: HTMLElement): HTMLElement[] {
  return Array.from(elemento.querySelectorAll<HTMLElement>(PECAS));
}

/** O relógio das animações (o do quadro); sem ele (o jsdom), o do performance. */
function relogio(): number {
  const linha = typeof document !== "undefined" ? document.timeline?.currentTime : null;
  return typeof linha === "number" ? linha : performance.now();
}

function numero(valor: CSSNumberish | null | undefined): number | null {
  return typeof valor === "number" ? valor : null;
}

/** A escala vertical que a peça tem agora (as animações dela compostas); 1 sem nenhuma. */
function escalaAgora(peca: HTMLElement): number {
  const valor = getComputedStyle(peca).scale;
  const partes = valor && valor !== "none" ? valor.trim().split(/\s+/).map(Number.parseFloat) : [];
  const vertical = partes.length > 1 ? partes[1] : partes[0];
  return Number.isFinite(vertical) && vertical > 0 ? vertical : 1;
}

/** Um refluxo da altura do meio do cartão: quanto ele estava mais alto (px) e quando começou. */
interface ComponenteDaAltura {
  dh: number;
  animacao: Animation;
  inicio: number | null;
}

interface AlturaDoMeio {
  /** A altura do meio no layout, depois da última mudança. */
  altura: number;
  componentes: ComponenteDaAltura[];
  /** A animação que anda a altura agora, quando os refluxos se cruzaram e ela foi composta. */
  composta: Animation | null;
}

/** Um palco solto, para quem não usa o hook (a lista sem palco da página faz o dela). */
export function criarPalco(): PalcoSemSaltos {
  let elemento: HTMLElement | null = null;
  let foto: Map<HTMLElement, Foto> | null = null;
  let validade: ReturnType<typeof setTimeout> | null = null;
  let toque: number | null = null;
  let vivo = true;
  /** As animações do palco, para parar todas. */
  const todas = new Set<Animation>();
  /** Os refluxos de posição que correm em cada peça (mais de um quando um começou antes de o outro terminar). */
  const andando = new Map<HTMLElement, Set<Animation>>();
  /** A altura do meio de cada cartão que estica. */
  const alturas = new Map<HTMLElement, AlturaDoMeio>();

  const esquecer = () => {
    foto = null;
    if (validade !== null) clearTimeout(validade);
    validade = null;
  };

  const parar = () => {
    for (const animacao of [...todas]) animacao.cancel();
    todas.clear();
    andando.clear();
    alturas.clear();
  };

  const animar = (peca: HTMLElement, quadros: Keyframe[], opcoes: KeyframeAnimationOptions, aoTerminar?: () => void) => {
    const animacao = peca.animate(quadros, { duration: CARREGANDO.refluiMs, easing: CURVA_DO_REFLUXO, id: REFLUXO, ...opcoes });
    todas.add(animacao);
    const fim = () => {
      todas.delete(animacao);
      aoTerminar?.();
    };
    animacao.onfinish = fim;
    animacao.oncancel = fim;
    return animacao;
  };

  /** A posição da peça: sozinha, substitui (e anda no compositor); com outra que ainda corre, soma com ela. */
  const andar = (peca: HTMLElement, anda: number) => {
    const correndo = andando.get(peca);
    const animacao = animar(peca, [{ translate: `0 ${anda}px` }, { translate: "0 0" }], { composite: correndo?.size ? "add" : "replace" }, () => {
      const daPeca = andando.get(peca);
      daPeca?.delete(animacao);
      if (daPeca && !daPeca.size) andando.delete(peca);
    });
    if (correndo) correndo.add(animacao);
    else andando.set(peca, new Set([animacao]));
  };

  /**
   * A altura do meio do cartão que estica. Sozinha, uma escala de `antes`
   * para 1. Se outro refluxo da altura ainda corre, a nova escala multiplica
   * a dele: certa no primeiro quadro, seja quando for que ele saia (a tarefa
   * longa). Quando ela começa (ready), as duas viram uma só, composta pela
   * soma das alturas no relógio de cada uma: o meio encosta nas tampas, que
   * somam os deslocamentos, em todo quadro.
   */
  const esticar = (peca: HTMLElement, antes: number, depois: number) => {
    const agora = relogio();
    const meio = alturas.get(peca) ?? { altura: depois, componentes: [], composta: null };
    meio.componentes = meio.componentes.filter((componente) => componente.inicio === null || agora < componente.inicio + CARREGANDO.refluiMs);
    const cruzou = meio.componentes.length > 0;
    const animacao = animar(peca, [{ scale: `1 ${antes / depois}` }, { scale: "1 1" }], { composite: cruzou ? "add" : "replace" });
    meio.componentes.push({ dh: antes - depois, animacao, inicio: null });
    meio.altura = depois;
    alturas.set(peca, meio);
    animacao.ready.then(
      () => compor(peca, meio),
      () => undefined,
    );
  };

  const compor = (peca: HTMLElement, meio: AlturaDoMeio) => {
    if (!vivo || alturas.get(peca) !== meio) return;
    for (const componente of meio.componentes) componente.inicio ??= numero(componente.animacao.startTime);
    // Um refluxo que ainda não começou compõe quando começar.
    if (meio.componentes.some((componente) => componente.inicio === null)) return;
    const inicio = Math.max(...meio.componentes.map((componente) => componente.inicio!));
    const ativos = meio.componentes.filter((componente) => inicio < componente.inicio! + CARREGANDO.refluiMs);
    if (ativos.length < 2) return;
    const altura = meio.altura;
    const escala = (instante: number) =>
      (altura + ativos.reduce((soma, componente) => soma + componente.dh * (1 - progressoDoRefluxo((instante - componente.inicio!) / CARREGANDO.refluiMs)), 0)) / altura;
    const quadros: Keyframe[] = Array.from({ length: QUADROS_DO_MEIO + 1 }, (_, indice) => ({
      offset: indice / QUADROS_DO_MEIO,
      scale: `1 ${escala(inicio + (indice / QUADROS_DO_MEIO) * CARREGANDO.refluiMs)}`,
    }));
    const anteriores = [meio.composta, ...meio.componentes.map((componente) => componente.animacao)];
    const composta = animar(peca, quadros, { easing: "linear" });
    composta.startTime = inicio;
    meio.composta = composta;
    meio.componentes = ativos;
    for (const anterior of anteriores) if (anterior && anterior !== composta) anterior.cancel();
  };

  return {
    ref(no) {
      elemento = no;
    },
    antes() {
      if (foto || !elemento || movimentoReduzido()) return;
      // Onde cada peça está na tela agora, com o refluxo que ainda corre: só leitura, um layout.
      foto = new Map(
        pecasDo(elemento).map((peca) => {
          const caixa = peca.getBoundingClientRect();
          return [peca, { top: caixa.top, height: caixa.height }];
        }),
      );
      // A foto vale só para esta rodada: a mudança chega no DOM antes de o relógio andar.
      validade = setTimeout(() => {
        validade = null;
        foto = null;
      }, 0);
    },
    depois() {
      const de = foto;
      esquecer();
      if (!de || !elemento) return;
      // Primeiro lê todas as peças, depois escreve: um layout só. O refluxo que ainda corre fica: ele está na
      // foto e no lugar novo, no mesmo quadro, e a diferença entre os dois é só a mudança do layout.
      const medidas = pecasDo(elemento).map((peca) => {
        const caixa = peca.getBoundingClientRect();
        // O meio que estica mede a altura do layout: a da tela dividida pela escala que ele tem agora.
        const escala = peca.dataset.palco === "estica" && alturas.has(peca) ? escalaAgora(peca) : 1;
        return [peca, de.get(peca), caixa, escala] as const;
      });
      for (const [peca, estava, caixa, escala] of medidas) {
        if (!estava || typeof peca.animate !== "function") continue;
        const anda = estava.top - caixa.top;
        if (Math.abs(anda) >= 0.5) andar(peca, anda);
        if (peca.dataset.palco !== "estica" || caixa.height <= 0) continue;
        const antes = estava.height / escala;
        const depois = caixa.height / escala;
        if (Math.abs(antes - depois) >= 0.5) esticar(peca, antes, depois);
      }
    },
    tocou() {
      toque = performance.now();
    },
    ultimoToque() {
      return toque;
    },
    encerrar() {
      vivo = false;
      esquecer();
      parar();
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
