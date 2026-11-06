import { cn } from '@/lib/utils';

/**
 * O spinner da Armazenagem (docs/plataforma/diagnostico-carregamento.md,
 * decisão 5 de 06/11/2026): um anel com o arco, que se lê como espera mesmo
 * parado. Com `prefers-reduced-motion` ele não gira, e o rótulo ao lado diz o
 * estado.
 *
 * Fica fora da árvore de acessibilidade, porque o rótulo visível ("Emitindo…",
 * "Verificando o catálogo…") já diz o que acontece. Sozinho, sem rótulo,
 * recebe `aria-label` e vira o aviso de status.
 */
function Spinner({ className, ...props }: React.ComponentProps<'svg'>) {
  const anunciado = Boolean(props['aria-label']);
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      role={anunciado ? 'status' : undefined}
      aria-hidden={anunciado ? undefined : true}
      data-spinner=""
      className={cn('size-4 shrink-0 animate-spin motion-reduce:animate-none', className)}
      {...props}
    >
      <circle cx="12" cy="12" r="9" strokeOpacity={0.2} />
      <path d="M21 12a9 9 0 0 0-9-9" />
    </svg>
  );
}

export { Spinner };
