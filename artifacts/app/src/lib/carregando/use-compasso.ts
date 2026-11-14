import { useLayoutEffect, useRef, type RefObject } from "react";

/**
 * O atraso que põe uma animação de `duracaoMs`, montada no instante
 * `montagemMs` do relógio, no passo de todas as outras: o quanto da volta o
 * relógio já andou, para trás (de 0 a -duração).
 */
export function atrasoDoCompasso(montagemMs: number, duracaoMs: number): number {
  if (!(duracaoMs > 0) || !Number.isFinite(montagemMs)) return 0;
  const andado = ((montagemMs % duracaoMs) + duracaoMs) % duracaoMs;
  return andado === 0 ? 0 : -andado;
}

/**
 * O compasso do giro (carregamento v2, seção 5.1): todos os indicadores giram
 * no mesmo passo, mesmo os que montam em horas diferentes. Só o CSS não
 * sincroniza, porque cada animação começa quando o elemento entra na tela.
 *
 * Quando o elemento monta, o hook põe nele `--compasso` com o atraso negativo
 * tirado do relógio (`-(performance.now() % duração)`). Quem gira lê em
 * `animation-delay: var(--compasso, 0ms)`; a variável é herdada, então o ref
 * pode ficar no indicador e a cabeça, lá dentro, gira com ela. Quando a
 * duração muda (a volta calma, depois de 10 s), o atraso é refeito a partir da
 * mesma montagem, porque a animação continua contando de quando começou.
 */
export function useCompasso<T extends HTMLElement>(duracaoMs: number): RefObject<T | null> {
  const ref = useRef<T>(null);
  const montagem = useRef<number | null>(null);
  useLayoutEffect(() => {
    const elemento = ref.current;
    if (!elemento) return;
    montagem.current ??= performance.now();
    elemento.style.setProperty("--compasso", `${Math.round(atrasoDoCompasso(montagem.current, duracaoMs))}ms`);
  }, [duracaoMs]);
  return ref;
}
