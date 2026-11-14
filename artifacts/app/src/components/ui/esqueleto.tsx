import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';

import { CARREGANDO } from '@/lib/carregando/tempo';
import { cn } from '@/lib/utils';

/** Uma passada do brilho: 1,6 s de varredura e 0,4 s de pausa (o mesmo --carregando-t-brilho do index.css). */
export const BRILHO_MS = 2000;
/** O brilho faz dois ciclos e para; o indicador da linha de estado continua. */
export const CICLOS_DO_BRILHO = 2;
/** A defasagem entre um cartão e o seguinte. */
export const DEFASAGEM_DO_BRILHO_MS = 120;
/**
 * A última ordem com defasagem própria (8, o nono cartão): com ela, os dois
 * ciclos ainda terminam dentro dos 5 s do movimento decorativo (4 s + 8 × 120
 * ms). Do décimo cartão em diante, o brilho sai junto com o do nono.
 */
export const ORDEM_MAXIMA_DO_BRILHO = Math.floor(
  (CARREGANDO.movimentoMaxMs - CICLOS_DO_BRILHO * BRILHO_MS) / DEFASAGEM_DO_BRILHO_MS,
);

/**
 * As formas do esqueleto, com a anatomia da linha real (seção 4.2): `texto`,
 * a linha de 14 px de altura (o título; o apoio é a mesma com `h-2.5`);
 * `icone`, a caixa de 44 × 44 com raio 12; `botao`, o botão-fantasma de 40 px
 * com raio 10, na largura do rótulo; `contagem`, o bloco de 16 × 12 com raio 4
 * no lugar do número ("Em aberto · ▪"); e `bloco`, raio 6, do tamanho que
 * quem usa der.
 */
export type FormaDoEsqueleto = 'texto' | 'icone' | 'botao' | 'contagem' | 'bloco';

export interface EsqueletoProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children' | 'aria-hidden'> {
  forma?: FormaDoEsqueleto;
}

/**
 * Um bloco do esqueleto (carregamento v2, aprovado em 12/11/2026, seção 5.2 e
 * momento 2): cinza neutro (`--carregando-esqueleto`, no claro, na v3 e no
 * escuro; na barra preta, o branco a 12%), nunca o rosado do
 * `bg-primary/10`. É sempre decorativo e fica fora da árvore de
 * acessibilidade: quem informa é o título real e a linha de estado. O brilho
 * não é do bloco, é do cartão em volta (`CartaoComBrilho`). A largura do
 * texto e do botão vem de quem usa (`w-2/5`, `w-24`). O CSS mora em
 * index.css (`.carregando-esqueleto`).
 */
export function Esqueleto({ forma = 'bloco', className, ...props }: EsqueletoProps) {
  return (
    <span
      {...props}
      aria-hidden="true"
      data-esqueleto=""
      data-forma={forma}
      className={cn('carregando-esqueleto', className)}
    />
  );
}

export interface CartaoComBrilhoProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
  /** A posição do cartão na tela (0, 1, 2…): cada um começa 120 ms depois do anterior, até o nono. */
  ordem?: number;
}

/** A ordem como inteiro de 0 a `ORDEM_MAXIMA_DO_BRILHO`; o que não é número vira 0. */
function ordemDoCartao(ordem: number): number {
  return Number.isFinite(ordem) && ordem > 0 ? Math.min(Math.floor(ordem), ORDEM_MAXIMA_DO_BRILHO) : 0;
}

/**
 * O cartão com a faixa de brilho do esqueleto (seção 5.2): uma faixa só por
 * cartão (`::after`, na cor do cartão a 60%, inclinada a 20°), que anda só
 * por `transform`, some sobre o cartão e só mexe nos blocos. Faz dois ciclos
 * e para, antes dos 5 s do movimento decorativo; no movimento reduzido, não
 * há brilho. Embrulha as linhas-fantasma, não o dado: a faixa passaria por
 * cima das linhas reais. O visual do cartão (borda, fundo, raio) vem de quem
 * usa; os filhos ficam na árvore como estão (os blocos já são `aria-hidden`).
 */
export function CartaoComBrilho({ ordem = 0, className, style, children, ...props }: CartaoComBrilhoProps) {
  return (
    <div
      {...props}
      data-brilho=""
      className={cn('carregando-com-brilho', className)}
      style={{ ...style, '--ordem': String(ordemDoCartao(ordem)) } as CSSProperties}
    >
      {children}
    </div>
  );
}
