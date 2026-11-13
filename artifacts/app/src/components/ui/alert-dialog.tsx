import * as React from 'react';
import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog';
import { BotaoDeAcao, type BotaoDeAcaoProps } from '@/components/ui/botao-de-acao';
import { buttonVariants } from '@/components/ui/button';
import { CLASSE_DO_TRAVADO, DialogoEmAcao, useConteudoEmAcao, useDialogoEmAcao } from '@/components/ui/dialog';
import { useNaV3 } from '@/lib/na-v3';
import { cn } from '@/lib/utils';

type AlertDialogProps = React.ComponentProps<typeof AlertDialogPrimitive.Root> & {
  /**
   * A ação que grava segura a confirmação (carregamento v2, parte 13a): o Esc
   * não fecha, o Cancelar fica `aria-disabled` e quem fecha é o sucesso.
   */
  ocupado?: boolean;
};

function AlertDialog({ ocupado = false, onOpenChange, ...props }: AlertDialogProps) {
  const aoMudar = React.useCallback(
    (aberto: boolean) => {
      if (!aberto && ocupado) return;
      onOpenChange?.(aberto);
    },
    [onOpenChange, ocupado],
  );
  const valor = React.useMemo(() => ({ ocupado }), [ocupado]);
  return (
    <DialogoEmAcao.Provider value={valor}>
      <AlertDialogPrimitive.Root {...props} onOpenChange={aoMudar} />
    </DialogoEmAcao.Provider>
  );
}

const AlertDialogTrigger = AlertDialogPrimitive.Trigger;

const AlertDialogPortal = AlertDialogPrimitive.Portal;

const AlertDialogOverlay = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Overlay
    className={cn(
      'fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
      className,
    )}
    {...props}
    ref={ref}
  />
));
AlertDialogOverlay.displayName = AlertDialogPrimitive.Overlay.displayName;

const AlertDialogContent = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Content> & {
    /** O lugar do foco quando o controle que abriu a confirmação saiu da tela. Sem ele, o título da página. */
    focoAoFechar?: () => HTMLElement | null | undefined;
  }
>(({ className, onOpenAutoFocus, onCloseAutoFocus, onEscapeKeyDown, focoAoFechar, ...props }, ref) => {
  const naV3 = useNaV3();
  const { travado, travas } = useConteudoEmAcao({ onOpenAutoFocus, onCloseAutoFocus, onEscapeKeyDown, focoAoFechar });
  return (
    <AlertDialogPortal>
      <AlertDialogOverlay />
      <AlertDialogPrimitive.Content
        ref={ref}
        className={cn(
          'fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg',
          naV3 && 'v3',
          className,
        )}
        data-ocupado={travado ? '' : undefined}
        {...props}
        onOpenAutoFocus={travas.onOpenAutoFocus}
        onCloseAutoFocus={travas.onCloseAutoFocus}
        onEscapeKeyDown={travas.onEscapeKeyDown}
      />
    </AlertDialogPortal>
  );
});
AlertDialogContent.displayName = AlertDialogPrimitive.Content.displayName;

const AlertDialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      'flex flex-col space-y-2 text-center sm:text-left',
      className,
    )}
    {...props}
  />
);
AlertDialogHeader.displayName = 'AlertDialogHeader';

const AlertDialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      // No celular, os dois botões com 44 px.
      'flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2 max-md:[&_button]:min-h-11',
      className,
    )}
    {...props}
  />
);
AlertDialogFooter.displayName = 'AlertDialogFooter';

const AlertDialogTitle = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Title
    ref={ref}
    className={cn('text-lg font-semibold', className)}
    {...props}
  />
));
AlertDialogTitle.displayName = AlertDialogPrimitive.Title.displayName;

const AlertDialogDescription = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Description
    ref={ref}
    className={cn('text-sm text-muted-foreground', className)}
    {...props}
  />
));
AlertDialogDescription.displayName =
  AlertDialogPrimitive.Description.displayName;

/**
 * O confirmar da confirmação: o `BotaoDeAcao`, que nunca fecha sozinho (o
 * `preventDefault` do fechar do Radix fica aqui). Quem usa fecha no sucesso
 * da ação; no erro, a confirmação fica aberta.
 */
const AlertDialogAction = React.forwardRef<HTMLButtonElement, BotaoDeAcaoProps>(({ onClick, ...props }, ref) => (
  <AlertDialogPrimitive.Action asChild onClick={(evento) => evento.preventDefault()}>
    <BotaoDeAcao ref={ref} {...props} onClick={onClick} />
  </AlertDialogPrimitive.Action>
));
AlertDialogAction.displayName = AlertDialogPrimitive.Action.displayName;

/** O Cancelar da confirmação: com a ação gravando, `aria-disabled` e sem resposta, e o foco fica nele. */
const AlertDialogCancel = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Cancel>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Cancel>
>(({ className, onClick, ...props }, ref) => {
  const travado = Boolean(useDialogoEmAcao()?.ocupado);
  return (
    <AlertDialogPrimitive.Cancel
      ref={ref}
      {...props}
      aria-disabled={travado || undefined}
      onClick={(evento) => {
        if (travado) {
          evento.preventDefault();
          return;
        }
        onClick?.(evento);
      }}
      className={cn(
        buttonVariants({ variant: 'outline' }),
        'mt-2 sm:mt-0',
        travado && cn(CLASSE_DO_TRAVADO, 'hover:bg-card active:bg-card'),
        className,
      )}
    />
  );
});
AlertDialogCancel.displayName = AlertDialogPrimitive.Cancel.displayName;

export {
  AlertDialog,
  AlertDialogPortal,
  AlertDialogOverlay,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
};
