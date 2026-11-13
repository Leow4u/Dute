import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Button, type ButtonProps } from '@/components/ui/button';
import { abridorDoDialogo, devolverFocoAoFechar } from '@/lib/foco-de-volta';
import { useNaV3 } from '@/lib/na-v3';
import { cn } from '@/lib/utils';
import { X } from 'lucide-react';

/**
 * O diálogo em ação (carregamento v2, parte 13a): enquanto a ação que ele
 * pediu grava, nada o fecha. É um jeito só para o app inteiro, ligado pelo
 * `ocupado` da raiz:
 * - o `onOpenChange(false)` não chega a quem usa, e o Esc, o toque fora e o X
 *   não fecham;
 * - o X e o Cancelar (o `DialogCancelar`) ficam `aria-disabled`, a 0,45, com a
 *   trava no código, nunca `disabled`: o foco que estava neles não cai no
 *   `body`;
 * - o botão de confirmar é o `BotaoDeAcao`, e quem fecha é o sucesso da ação;
 * - no fim, o foco volta ao controle que abriu o diálogo e, se ele saiu da
 *   tela, ao lugar certo dela (`focoAoFechar`, ou o título da página).
 */
export const DialogoEmAcao = React.createContext<{ ocupado: boolean } | null>(null);

/** O estado do diálogo em ação de quem está dentro dele; `null` fora de um diálogo. */
export function useDialogoEmAcao() {
  return React.useContext(DialogoEmAcao);
}

type DialogProps = React.ComponentProps<typeof DialogPrimitive.Root> & {
  /** A ação que grava segura o diálogo: nada o fecha até ela terminar. */
  ocupado?: boolean;
};

function Dialog({ ocupado = false, onOpenChange, ...props }: DialogProps) {
  const aoMudar = React.useCallback(
    (aberto: boolean) => {
      // O pedido de fechar que chega no meio da ação não chega a quem usa.
      if (!aberto && ocupado) return;
      onOpenChange?.(aberto);
    },
    [onOpenChange, ocupado],
  );
  const valor = React.useMemo(() => ({ ocupado }), [ocupado]);
  return (
    <DialogoEmAcao.Provider value={valor}>
      <DialogPrimitive.Root {...props} onOpenChange={aoMudar} />
    </DialogoEmAcao.Provider>
  );
}

const DialogTrigger = DialogPrimitive.Trigger;

const DialogPortal = DialogPrimitive.Portal;

const DialogClose = DialogPrimitive.Close;

/** O que o conteúdo do diálogo faz no começo e no fim, e as travas da ação. */
type TravasDoConteudo = Pick<
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>,
  'onOpenAutoFocus' | 'onCloseAutoFocus' | 'onEscapeKeyDown' | 'onInteractOutside'
> & {
  /** O lugar do foco quando o controle que abriu o diálogo saiu da tela. Sem ele, o título da página. */
  focoAoFechar?: () => HTMLElement | null | undefined;
};

/**
 * As travas do conteúdo do diálogo em ação, para o `DialogContent`, o
 * `SheetContent`, o `AlertDialogContent` e os painéis próprios: o Esc e o
 * toque fora não fecham, e o foco volta ao lugar certo no fim.
 */
export function useConteudoEmAcao(
  { onOpenAutoFocus, onCloseAutoFocus, onEscapeKeyDown, onInteractOutside, focoAoFechar }: TravasDoConteudo,
  ocupadoAqui = false,
) {
  const dialogo = useDialogoEmAcao();
  const travado = ocupadoAqui || Boolean(dialogo?.ocupado);
  const abridor = React.useRef<HTMLElement | null>(null);
  return {
    travado,
    travas: {
      onOpenAutoFocus: (evento: Event) => {
        // Antes de o foco entrar no diálogo: quem o abriu.
        abridor.current = abridorDoDialogo();
        onOpenAutoFocus?.(evento);
      },
      onCloseAutoFocus: (evento: Event) => {
        onCloseAutoFocus?.(evento);
        devolverFocoAoFechar(evento, abridor.current, focoAoFechar);
        abridor.current = null;
      },
      onEscapeKeyDown: (evento: KeyboardEvent) => {
        onEscapeKeyDown?.(evento);
        if (travado) evento.preventDefault();
      },
      onInteractOutside: (evento: Parameters<NonNullable<TravasDoConteudo['onInteractOutside']>>[0]) => {
        onInteractOutside?.(evento);
        if (travado) evento.preventDefault();
      },
    },
  };
}

/** O controle travado pela ação: esmaecido e sem resposta ao ponteiro, nunca `disabled`. */
export const CLASSE_DO_TRAVADO = 'opacity-45 hover:bg-transparent hover:opacity-45 active:bg-transparent';

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      'fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> &
    TravasDoConteudo & {
      /**
       * A ação que grava, quando ela mora no conteúdo e não em quem abre o
       * diálogo (o formulário do convite): segura o diálogo como o `ocupado`
       * da raiz.
       */
      ocupado?: boolean;
    }
>(({ className, children, onOpenAutoFocus, onCloseAutoFocus, onEscapeKeyDown, onInteractOutside, focoAoFechar, ocupado = false, ...props }, ref) => {
  const naV3 = useNaV3();
  const { travado, travas } = useConteudoEmAcao({ onOpenAutoFocus, onCloseAutoFocus, onEscapeKeyDown, onInteractOutside, focoAoFechar }, ocupado);
  const valor = React.useMemo(() => ({ ocupado: travado }), [travado]);
  return (
    <DialogoEmAcao.Provider value={valor}>
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          'fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg max-h-[85vh] translate-x-[-50%] translate-y-[-50%] gap-5 overflow-y-auto rounded-xl border border-border bg-card p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]',
          naV3 && 'v3',
          className,
        )}
        data-ocupado={travado ? '' : undefined}
        {...props}
        {...travas}
      >
        {children}
        <BotaoFecharDoPainel travado={travado} className="right-4 top-4 max-md:right-2 max-md:top-2" />
      </DialogPrimitive.Content>
    </DialogPortal>
    </DialogoEmAcao.Provider>
  );
});
DialogContent.displayName = DialogPrimitive.Content.displayName;

/**
 * O X "Fechar" do diálogo e do painel: 28 px no computador, 44 px no celular
 * (o alvo do toque). Travado pela ação, fica `aria-disabled` e esmaecido, e o
 * toque nele não faz nada.
 */
export function BotaoFecharDoPainel({ travado, className }: { travado: boolean; className?: string }) {
  return (
    <DialogPrimitive.Close
      aria-disabled={travado || undefined}
      onClick={(event) => {
        if (travado) event.preventDefault();
      }}
      className={cn(
        'absolute inline-grid place-items-center rounded-full p-1.5 opacity-70 transition-[background-color,opacity] duration-200 hover:bg-surface-hover hover:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:pointer-events-none data-[state=open]:text-muted-foreground max-md:size-11 max-md:p-0 max-md:[&_svg]:size-5',
        travado && CLASSE_DO_TRAVADO,
        className,
      )}
    >
      <X className="h-4 w-4" aria-hidden="true" />
      <span className="sr-only">Fechar</span>
    </DialogPrimitive.Close>
  );
}

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      // No celular, o X de 44 px fica no canto: o título (só ele) não passa por baixo dele.
      'flex flex-col space-y-1.5 text-center sm:text-left max-md:[&>h2]:px-7',
      className,
    )}
    {...props}
  />
);
DialogHeader.displayName = 'DialogHeader';

/**
 * O rodapé das ações. No celular, ele fica preso embaixo enquanto o diálogo
 * longo rola (o conteúdo passa por baixo dele, que cobre até a borda), e os
 * botões têm 44 px.
 */
const DialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    data-rodape-do-dialogo=""
    className={cn(
      'flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2',
      'max-md:sticky max-md:-bottom-6 max-md:z-10 max-md:-mb-6 max-md:gap-2 max-md:border-t max-md:border-border max-md:bg-card max-md:pb-6 max-md:pt-3 max-md:[&_button]:min-h-11',
      className,
    )}
    {...props}
  />
);
DialogFooter.displayName = 'DialogFooter';

/**
 * O Cancelar (ou Voltar) do diálogo: com a ação gravando, fica
 * `aria-disabled` e não responde, e o foco fica nele. Sem `onClick`, fecha o
 * diálogo; com ele, quem usa decide.
 */
const DialogCancelar = React.forwardRef<HTMLButtonElement, ButtonProps & { ocupado?: boolean }>(
  ({ ocupado, onClick, className, variant = 'outline', type = 'button', children = 'Cancelar', ...props }, ref) => {
    const dialogo = useDialogoEmAcao();
    const travado = ocupado ?? Boolean(dialogo?.ocupado);
    const botao = (
      <Button
        ref={ref}
        type={type}
        variant={variant}
        {...props}
        aria-disabled={travado || undefined}
        className={cn(travado && CLASSE_DO_TRAVADO, travado && variant !== 'ghost' && 'hover:bg-card active:bg-card', className)}
        onClick={(event) => {
          if (travado) {
            event.preventDefault();
            return;
          }
          onClick?.(event);
        }}
      >
        {children}
      </Button>
    );
    // Sem quem feche, o próprio diálogo fecha (o Radix, inclusive o sem `open`).
    return onClick || !dialogo ? botao : <DialogPrimitive.Close asChild>{botao}</DialogPrimitive.Close>;
  },
);
DialogCancelar.displayName = 'DialogCancelar';

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      'text-lg font-semibold leading-none tracking-normal',
      className,
    )}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('text-sm text-muted-foreground', className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogCancelar,
  DialogTitle,
  DialogDescription,
};
