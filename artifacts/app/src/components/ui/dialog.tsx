import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { AvisoDeEspera } from '@/components/ui/aviso-de-espera';
import { Button, type ButtonProps } from '@/components/ui/button';
import { DialogoEmAcao, useDialogoEmAcao, type DialogoEmAcaoValor } from '@/components/ui/dialogo-em-acao';
import { CARREGANDO } from '@/lib/carregando/tempo';
import { useEspera } from '@/lib/carregando/use-espera';
import { abridorDoDialogo, devolverFocoAoFechar, vizinhosDoFoco } from '@/lib/foco-de-volta';
import { useNaV3 } from '@/lib/na-v3';
import { cn } from '@/lib/utils';
import { X } from 'lucide-react';

/**
 * O diálogo em ação (carregamento v2, parte 13a): enquanto a ação que ele
 * pediu grava, nada o fecha. É um jeito só para o app inteiro, ligado pelo
 * `ocupado` da raiz:
 * - o `onOpenChange(false)` não chega a quem usa, e o Esc, o toque fora e o X
 *   não fecham; o Esc e o toque fora esperam também o toque no confirmar,
 *   antes de a ação chegar à tela;
 * - o X e o Cancelar (o `DialogCancelar`) ficam `aria-disabled`, com a trava
 *   no código, nunca `disabled`: o foco que estava neles não cai no `body`. Eles
 *   esmaecem a 0,45 junto com o gerúndio do confirmar, aos 300 ms;
 * - o botão de confirmar é o `BotaoDeAcao`, e quem fecha é o sucesso da ação;
 * - aos 10 s, o rodapé diz "Demorando mais que o normal · 0:12"; aos 70 s,
 *   "Sem confirmação do servidor", e o diálogo volta a fechar (a ação pode
 *   ter gravado ou não);
 * - no fim, o foco volta ao controle que abriu o diálogo e, se ele saiu da
 *   tela, ao lugar certo dela (`focoAoFechar`, o vizinho dele, ou o título
 *   da página).
 *
 * O estado mora em `dialogo-em-acao.ts`.
 */
export { DialogoEmAcao, useDialogoEmAcao, type DialogoEmAcaoValor };

/**
 * O estado do diálogo em ação, de uma raiz (`Dialog`, `AlertDialog`) ou do
 * conteúdo que tem a própria ação (o convite). Somado ao de fora, quando há.
 */
export function useEstadoEmAcao(ocupado: boolean, fora: DialogoEmAcaoValor | null = null): DialogoEmAcaoValor {
  const espera = useEspera(ocupado, { segurarMinimo: true });
  const [avisos, setAvisos] = React.useState(0);
  const avisoProprio = avisos > 0 || Boolean(fora?.avisoProprio);
  // Aos 70 s, a saída: o diálogo sem aviso próprio volta a fechar, e a ação
  // que ainda grava segue no confirmar. Quem tem o aviso próprio (as fotos,
  // a entrega por etapas) cuida da própria saída.
  const desistiu = espera.fase === 'sem-resposta' && !avisoProprio;
  const travado = (ocupado || espera.visivel) && !desistiu;
  const esmaecido = espera.visivel && !desistiu;

  const ocupadoTotal = travado || Boolean(fora?.ocupado);
  const agora = React.useRef({ travado, toqueEm: null as number | null, fora });
  React.useLayoutEffect(() => {
    agora.current.travado = travado;
    agora.current.fora = fora;
    // A ação chegou à tela: daqui em diante quem segura é ela, e o toque sai
    // (a falha que volta antes dos 300 ms não deixa o Esc preso).
    if (ocupadoTotal) agora.current.toqueEm = null;
  });
  const segura = React.useCallback(() => agora.current.travado || Boolean(agora.current.fora?.segura()), []);
  // O Esc e o toque fora (os gestos que escapam sem querer) também esperam o
  // toque do confirmar: entre ele e a ação chegar à tela, o Esc dado logo
  // depois do Enter fechava o diálogo com a gravação andando.
  const seguraNoToque = React.useCallback(() => {
    const { travado: travadoAgora, toqueEm, fora: deFora } = agora.current;
    if (travadoAgora || Boolean(deFora?.seguraNoToque())) return true;
    return toqueEm !== null && Date.now() - toqueEm < CARREGANDO.atrasoMs;
  }, []);
  // O toque fica com quem o recebeu: o conteúdo confere o dele e o da raiz no
  // Esc e no toque fora, que passam por ele.
  const marcarToque = React.useCallback(() => {
    agora.current.toqueEm = Date.now();
  }, []);
  const registrarAviso = React.useCallback(() => {
    // O aviso do conteúdo também vale para a raiz: a saída dos 70 s fica com ele.
    const tirarDeFora = agora.current.fora?.registrarAviso();
    setAvisos((total) => total + 1);
    return () => {
      setAvisos((total) => total - 1);
      tirarDeFora?.();
    };
  }, []);

  const esmaecidoTotal = esmaecido || Boolean(fora?.esmaecido);
  const esperaTotal = ocupado || espera.visivel ? espera : (fora?.espera ?? null);
  return React.useMemo(
    () => ({
      ocupado: ocupadoTotal,
      esmaecido: esmaecidoTotal,
      espera: esperaTotal,
      avisoProprio,
      segura,
      seguraNoToque,
      marcarToque,
      registrarAviso,
    }),
    [ocupadoTotal, esmaecidoTotal, esperaTotal, avisoProprio, segura, seguraNoToque, marcarToque, registrarAviso],
  );
}

type DialogProps = React.ComponentProps<typeof DialogPrimitive.Root> & {
  /** A ação que grava segura o diálogo: nada o fecha até ela terminar (ou até a saída dos 70 s). */
  ocupado?: boolean;
};

function Dialog({ ocupado = false, onOpenChange, ...props }: DialogProps) {
  const valor = useEstadoEmAcao(ocupado);
  const { segura } = valor;
  const aoMudar = React.useCallback(
    (aberto: boolean) => {
      // O pedido de fechar que chega no meio da ação não chega a quem usa.
      if (!aberto && segura()) return;
      onOpenChange?.(aberto);
    },
    [onOpenChange, segura],
  );
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
  /** O lugar do foco quando o controle que abriu o diálogo saiu da tela. Sem ele, o vizinho do controle ou o título da página. */
  focoAoFechar?: () => HTMLElement | null | undefined;
};

/**
 * As travas do conteúdo do diálogo em ação, para o `DialogContent`, o
 * `SheetContent`, o `AlertDialogContent` e os painéis próprios: o Esc e o
 * toque fora não fecham, e o foco volta ao lugar certo no fim.
 */
export function useConteudoEmAcao(
  { onOpenAutoFocus, onCloseAutoFocus, onEscapeKeyDown, onInteractOutside, focoAoFechar }: TravasDoConteudo,
  dialogo: DialogoEmAcaoValor | null = null,
) {
  const deFora = useDialogoEmAcao();
  const estado = dialogo ?? deFora;
  const travado = Boolean(estado?.ocupado);
  const segura = () => travado || Boolean(estado?.seguraNoToque());
  const abridor = React.useRef<HTMLElement | null>(null);
  const vizinhos = React.useRef<HTMLElement[]>([]);
  return {
    travado,
    esmaecido: Boolean(estado?.esmaecido),
    travas: {
      onOpenAutoFocus: (evento: Event) => {
        // Antes de o foco entrar no diálogo: quem o abriu, e os vizinhos dele na ordem do Tab.
        abridor.current = abridorDoDialogo();
        vizinhos.current = abridor.current ? vizinhosDoFoco(abridor.current) : [];
        onOpenAutoFocus?.(evento);
      },
      onCloseAutoFocus: (evento: Event) => {
        onCloseAutoFocus?.(evento);
        devolverFocoAoFechar(evento, abridor.current, focoAoFechar, vizinhos.current);
        abridor.current = null;
        vizinhos.current = [];
      },
      onEscapeKeyDown: (evento: KeyboardEvent) => {
        onEscapeKeyDown?.(evento);
        if (segura()) evento.preventDefault();
      },
      onInteractOutside: (evento: Parameters<NonNullable<TravasDoConteudo['onInteractOutside']>>[0]) => {
        onInteractOutside?.(evento);
        if (segura()) evento.preventDefault();
      },
    },
  };
}

/**
 * O controle travado pela ação, sem resposta ao ponteiro (nunca `disabled`).
 * Esmaecido, a 0,45, só junto com o gerúndio do confirmar (`CLASSE_DO_ESMAECIDO`).
 */
export const CLASSE_DO_TRAVADO = 'hover:bg-transparent active:bg-transparent';
export const CLASSE_DO_ESMAECIDO = 'opacity-45 hover:opacity-45';

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
  const valor = useEstadoEmAcao(ocupado, useDialogoEmAcao());
  const { travado, esmaecido, travas } = useConteudoEmAcao({ onOpenAutoFocus, onCloseAutoFocus, onEscapeKeyDown, onInteractOutside, focoAoFechar }, valor);
  return (
    <DialogoEmAcao.Provider value={valor}>
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          'fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg max-h-[85vh] translate-x-[-50%] translate-y-[-50%] gap-5 overflow-y-auto rounded-xl border border-border bg-card p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]',
          // No celular, o campo que recebe o foco não fica atrás do rodapé preso:
          // o navegador o traz para cima da altura do rodapé (medida pelo DialogFooter).
          'celular:scroll-pb-[var(--altura-do-rodape,0px)]',
          naV3 && 'v3',
          className,
        )}
        data-ocupado={travado ? '' : undefined}
        {...props}
        {...travas}
      >
        {children}
        <BotaoFecharDoPainel travado={travado} esmaecido={esmaecido} className="right-4 top-4 celular:right-2 celular:top-2" />
      </DialogPrimitive.Content>
    </DialogPortal>
    </DialogoEmAcao.Provider>
  );
});
DialogContent.displayName = DialogPrimitive.Content.displayName;

/**
 * O X "Fechar" do diálogo e do painel: 28 px no computador, 44 px no celular
 * (o alvo do toque, também deitado). Travado pela ação, fica `aria-disabled`,
 * e o toque nele não faz nada; esmaece com o gerúndio do confirmar. O anel do
 * foco é o cheio, com o recuo, e não esmaece com o ícone.
 */
export function BotaoFecharDoPainel({ travado, esmaecido = travado, className }: { travado: boolean; esmaecido?: boolean; className?: string }) {
  const dialogo = useDialogoEmAcao();
  return (
    <DialogPrimitive.Close
      aria-disabled={travado || undefined}
      onClick={(event) => {
        if (travado || dialogo?.segura()) event.preventDefault();
      }}
      className={cn(
        'absolute inline-grid place-items-center rounded-full p-1.5 transition-[background-color] duration-200 hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none data-[state=open]:text-muted-foreground celular:size-11 celular:p-0 celular:[&_svg]:size-5',
        // O ícone esmaece, e o anel do foco fica inteiro.
        '[&_svg]:opacity-70 [&_svg]:transition-opacity [&_svg]:duration-200 hover:[&_svg]:opacity-100',
        travado && CLASSE_DO_TRAVADO,
        travado && 'hover:[&_svg]:opacity-70',
        esmaecido && '[&_svg]:opacity-45 hover:[&_svg]:opacity-45',
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
      // Centrado (o celular em pé), o recuo é dos dois lados; alinhado à esquerda (deitado), só à direita.
      'flex flex-col space-y-1.5 text-center sm:text-left celular:[&>h2]:pr-7 max-sm:[&>h2]:pl-7',
      className,
    )}
    {...props}
  />
);
DialogHeader.displayName = 'DialogHeader';

/**
 * O aviso da espera da ação do diálogo, no rodapé, em cima dos botões: aos
 * 10 s, "Demorando mais que o normal · 0:12"; aos 70 s, "Sem confirmação do
 * servidor", quando o diálogo volta a fechar. O diálogo que já tem o aviso
 * dele (a operação longa) não repete.
 */
export function AvisoDaAcaoDoDialogo() {
  const dialogo = useDialogoEmAcao();
  const espera = dialogo?.espera;
  if (!espera || dialogo.avisoProprio) return null;
  if (espera.fase !== 'demorando' && espera.fase !== 'sem-resposta') return null;
  return (
    <AvisoDeEspera
      fase={espera.fase}
      tipo="escrita"
      desdeMs={espera.decorridoMs}
      doRodapeDoDialogo
      // Na coluna do celular (de baixo para cima), em cima dos botões; na linha do computador, a linha de cima inteira.
      className="order-last w-full sm:order-first sm:me-0 sm:basis-full sm:justify-end"
    />
  );
}

/** A altura do rodapé preso, para o campo com o foco não ficar atrás dele (`--altura-do-rodape`). */
function useAlturaDoRodape() {
  const rodape = React.useRef<HTMLDivElement | null>(null);
  React.useLayoutEffect(() => {
    const elemento = rodape.current;
    const dialogo = elemento?.closest<HTMLElement>('[role="dialog"], [role="alertdialog"]');
    if (!elemento || !dialogo) return undefined;
    const medir = () => dialogo.style.setProperty('--altura-do-rodape', `${elemento.offsetHeight}px`);
    medir();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observador = new ResizeObserver(medir);
    observador.observe(elemento);
    return () => observador.disconnect();
  }, []);
  return rodape;
}

/**
 * O rodapé das ações. No celular (também deitado), ele fica preso embaixo
 * enquanto o diálogo longo rola (o conteúdo passa por baixo dele, que cobre
 * até a borda), e os botões têm 44 px. Com a ação demorando, o aviso da
 * espera entra em cima dos botões.
 */
const DialogFooter = ({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => {
  const rodape = useAlturaDoRodape();
  return (
    <div
      ref={rodape}
      data-rodape-do-dialogo=""
      className={cn(
        'flex flex-col-reverse sm:flex-row sm:flex-wrap sm:justify-end sm:space-x-2',
        'max-sm:gap-2 sm:gap-y-2 celular:sticky celular:-bottom-6 celular:z-10 celular:-mb-6 celular:border-t celular:border-border celular:bg-card celular:pb-6 celular:pt-3 celular:[&_button]:min-h-11',
        className,
      )}
      {...props}
    >
      {/* Antes dos botões no DOM: o último botão continua o último (o espaço entre eles não muda). */}
      <AvisoDaAcaoDoDialogo />
      {children}
    </div>
  );
};
DialogFooter.displayName = 'DialogFooter';

/**
 * O Cancelar (ou Voltar) do diálogo: com a ação gravando, fica
 * `aria-disabled` e não responde, e o foco fica nele; esmaece com o gerúndio
 * do confirmar. Sem `onClick`, fecha o diálogo; com ele, quem usa decide.
 *
 * Com `ocupado` (a ação que mora fora de um diálogo, como a confirmação na
 * linha), o mesmo relógio do confirmar: travado já no toque, esmaecido só aos
 * 300 ms e pelo menos 500 ms, junto com o gerúndio do `BotaoDeAcao`. A ação
 * que responde antes não pisca o botão.
 */
const DialogCancelar = React.forwardRef<HTMLButtonElement, ButtonProps & { ocupado?: boolean }>(
  ({ ocupado, onClick, className, variant = 'outline', type = 'button', children = 'Cancelar', ...props }, ref) => {
    const dialogo = useDialogoEmAcao();
    const proprio = useEspera(Boolean(ocupado), { segurarMinimo: true }).visivel;
    const travado = ocupado === undefined ? Boolean(dialogo?.ocupado) : ocupado || proprio;
    const esmaecido = ocupado === undefined ? Boolean(dialogo?.esmaecido) : proprio;
    const botao = (
      <Button
        ref={ref}
        type={type}
        variant={variant}
        {...props}
        aria-disabled={travado || undefined}
        className={cn(
          travado && CLASSE_DO_TRAVADO,
          travado && variant !== 'ghost' && 'hover:bg-card active:bg-card',
          esmaecido && CLASSE_DO_ESMAECIDO,
          className,
        )}
        onClick={(event) => {
          if (travado || (ocupado === undefined && dialogo?.segura())) {
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
