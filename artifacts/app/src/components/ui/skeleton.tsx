import type { HTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

/**
 * O bloco de espera das telas de desenho fixo (o Início de cada módulo,
 * Operações, Contagem, Mapa, Posições, Etiquetas, Relatórios e o portal), com
 * a API de sempre. Desde o carregamento v2 (12/11/2026, seção 5.2) é o bloco
 * neutro do `Esqueleto` (`--carregando-esqueleto`), no lugar do
 * `bg-primary/10 animate-pulse`, que ficava rosado na v3. Cada Skeleton é um
 * cartão: tem a própria faixa de brilho, que faz dois ciclos e para (nenhuma
 * no movimento reduzido). É sempre decorativo e fica fora da árvore de
 * acessibilidade. O tamanho e o raio vêm da classe de quem usa; sem raio, 6
 * px. Telas novas montam a linha-fantasma com `Esqueleto` e `CartaoComBrilho`
 * (components/ui/esqueleto.tsx).
 */
function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      aria-hidden="true"
      data-esqueleto=""
      data-forma="bloco"
      className={cn('carregando-esqueleto carregando-com-brilho', className)}
    />
  );
}

export { Skeleton };
