import type { CSSProperties, HTMLAttributes } from 'react';

import { useCompasso } from '@/lib/carregando/use-compasso';
import { cn } from '@/lib/utils';

/** Os tamanhos do indicador (carregamento v2, seção 4.2). */
export type TamanhoDoIndicador = 16 | 20 | 24 | 40;

/** Uma volta da cabeça e a volta calma, depois do aviso de 10 s (os mesmos --carregando-t-giro e -giro-calmo do index.css). */
export const GIRO_MS = 1200;
export const GIRO_CALMO_MS = 2000;

export interface SpinnerProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  /**
   * 16 junto de texto de 13 a 14 px e em botão de 36 a 40 px (o padrão); 20 em
   * botão de 44 a 48 px no celular e no Agent Dute; 24 na linha de estado e no
   * cabeçalho de região; 40 no módulo sem esqueleto e na troca de tela.
   */
  tamanho?: TamanhoDoIndicador;
  /** Depois do aviso de 10 s, a volta passa a durar 2 s. */
  calmo?: boolean;
  /** De 0 a 1: o contorno fecha conforme o valor e a cabeça não gira. Muda por evento, nunca por quadro. */
  progresso?: number;
  'aria-label'?: string;
}

/** O progresso entre 0 e 1; o que não é número vira 0. */
function fracao(progresso: number): number {
  return Number.isFinite(progresso) ? Math.min(1, Math.max(0, progresso)) : 0;
}

/**
 * O indicador do carregamento (carregamento v2, aprovado em 12/11/2026, seção
 * 5.1 e momento 1): a caixa chanfrada, com o canto de 45° do "D" da marca, no
 * lugar do anel da decisão 5 de 06/11/2026. O contorno é uma máscara parada
 * (`--carregando-mascara-*`); dentro dela, o trilho mostra o contorno inteiro
 * em `currentColor` na opacidade do contexto (0,16 na superfície, 0,25 na
 * barra preta, 0,35 no botão de cor) e a cabeça, um gradiente cônico com 40%
 * cheios e 25% de cauda, gira só por `transform`, no compositor. Todos giram
 * no mesmo passo (`useCompasso`). Com movimento reduzido, a cabeça para no
 * canto de cima à direita e a caixa respira até o piso de contraste. O CSS
 * mora em index.css (`.carregando-caixa`).
 *
 * A cor é a do texto em volta: tinta na superfície, branco no botão de cor e
 * na barra preta, violeta no Agent Dute. O tamanho é o da própria caixa: ela
 * é um `span`, e o `[&_svg]:size-4` do Button não a alcança.
 *
 * Fica fora da árvore de acessibilidade, porque o rótulo visível ("Emitindo…",
 * "Verificando o catálogo…") já diz o que acontece. Sozinho, sem rótulo,
 * recebe `aria-label` e vira o aviso de status.
 */
function Spinner({ tamanho = 16, calmo = false, progresso, className, style, ...props }: SpinnerProps) {
  const anunciado = Boolean(props['aria-label']);
  const ref = useCompasso<HTMLSpanElement>(calmo ? GIRO_CALMO_MS : GIRO_MS);
  const determinado = progresso !== undefined;
  return (
    <span
      ref={ref}
      role={anunciado ? 'status' : undefined}
      aria-hidden={anunciado ? undefined : true}
      data-spinner=""
      data-forma="caixa"
      data-tamanho={tamanho}
      data-calmo={calmo ? '' : undefined}
      data-determinado={determinado ? '' : undefined}
      className={cn('carregando-caixa', className)}
      style={determinado ? ({ ...style, '--p': String(fracao(progresso)) } as CSSProperties) : style}
      {...props}
    >
      <span className="trilho" />
      <span className="cabeca" />
    </span>
  );
}

export { Spinner };
