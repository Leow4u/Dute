import {
  memo,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type Ref,
  type SyntheticEvent,
} from "react";
import { ChevronDown, ChevronRight, type LucideIcon } from "lucide-react";

import { CARREGANDO } from "@/lib/carregando/tempo";
import type { ListaSemSaltos } from "@/lib/carregando/use-lista-sem-saltos";
import { cn } from "@/lib/utils";

/**
 * Lista de fila (Pedidos, Receber): grupos com título e contagem, linhas com
 * ícone, título, apoio e ações. O mesmo desenho nas duas telas. Dentro do
 * `.v3` (parte 4.7), o título e a linha seguem a v3.
 */

export const QUEUE_TONE = {
  approve: "bg-warning-soft text-warning-soft-foreground",
  pick: "bg-info-soft text-info-soft-foreground",
  deliver: "bg-success-soft text-success-soft-foreground",
  check: "bg-info-soft text-info-soft-foreground",
  store: "bg-success-soft text-success-soft-foreground",
  done: "bg-muted text-muted-foreground",
} as const;

export type QueueTone = keyof typeof QUEUE_TONE;

/**
 * A contagem que rola (carregamento v2, momento 4): quando muda (3 → 2), o
 * número velho sobe e sai e o novo sobe e entra, 8 px em 160 ms; no reduzido,
 * troca. Só o número atual fica na árvore de acessibilidade. Zero não mostra
 * número.
 */
export function ContagemQueRola({ valor }: { valor: number }) {
  const [mostrado, setMostrado] = useState(valor);
  const [saindo, setSaindo] = useState<number | null>(null);
  if (valor !== mostrado) {
    setSaindo(mostrado);
    setMostrado(valor);
  }
  useEffect(() => {
    if (saindo === null) return undefined;
    const fim = setTimeout(() => setSaindo(null), CARREGANDO.contaMs);
    return () => clearTimeout(fim);
  }, [saindo, mostrado]);
  if (!mostrado && !saindo) return null;
  return (
    <span className="carregando-conta tabular-nums">
      {saindo ? (
        <span key={`sai-${saindo}`} data-conta="sai" aria-hidden="true">
          {saindo}
        </span>
      ) : null}
      {mostrado ? (
        <span key={`entra-${mostrado}`} data-conta={saindo !== null ? "entra" : undefined}>
          {mostrado}
        </span>
      ) : null}
    </span>
  );
}

/**
 * O anel do título que recebe o foco quando a última linha sai com ele: o
 * mesmo do Button (o token --ring), só no foco visível.
 */
const TITULO_FOCAVEL =
  "rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export function QueueGroup({
  title,
  hint,
  count,
  empty,
  children,
  rolarContagem = false,
  listaRef,
  tituloRef,
  semSaltos = false,
}: {
  title: string;
  hint?: string;
  count: number;
  empty: ReactNode;
  children: ReactNode;
  /** A contagem rola quando muda (a fila sem saltos, carregamento v2). */
  rolarContagem?: boolean;
  /** O elemento das linhas: o `ref` do useListaSemSaltos. */
  listaRef?: Ref<HTMLDivElement>;
  /** O título, que recebe o foco quando a última linha sai com ele (o `titulo` do useListaSemSaltos). */
  tituloRef?: Ref<HTMLHeadingElement>;
  /**
   * O grupo de uma fila sem saltos, no palco da tela (usePalcoSemSaltos;
   * carregamento v2, momento 4): o título e o cartão sobem e descem por
   * transform, e o cartão, em três pedaços como na prancha, encolhe e estica
   * sem cortar a linha que sobe. Sem ele, o grupo de sempre (Receber).
   */
  semSaltos?: boolean;
}) {
  return (
    <section className="flex flex-col gap-2.5">
      <h2
        ref={tituloRef}
        tabIndex={tituloRef ? -1 : undefined}
        data-palco={semSaltos ? "bloco" : undefined}
        className={cn("flex items-baseline gap-2 px-1 focus:outline-none", tituloRef && TITULO_FOCAVEL)}
      >
        <span className="text-base font-semibold text-foreground in-[.v3]:text-lg in-[.v3]:font-bold">{title}</span>
        <span className="text-sm text-foreground/50">
          {rolarContagem ? (
            <>
              {hint}
              {hint && count ? " · " : null}
              <ContagemQueRola valor={count} />
            </>
          ) : (
            [hint, count ? String(count) : null].filter(Boolean).join(" · ")
          )}
        </span>
      </h2>
      {semSaltos ? (
        <div className="fila-cartao">
          {/* A moldura em três pedaços, atrás das linhas: o meio primeiro, as tampas por cima dele. */}
          <span aria-hidden="true" data-moldura="meio" data-palco="estica" className="border-x border-border" />
          <span aria-hidden="true" data-moldura="topo" data-palco="bloco" className="rounded-t-2xl border border-b-0 border-border bg-card in-[.v3]:rounded-t-lg" />
          <span aria-hidden="true" data-moldura="base" data-palco="bloco" className="rounded-b-2xl border border-t-0 border-border bg-card in-[.v3]:rounded-b-lg" />
          {count > 0 ? (
            <div ref={listaRef} className="divide-y divide-border/60 overflow-x-clip rounded-2xl in-[.v3]:rounded-lg">
              {children}
            </div>
          ) : (
            <p data-palco="bloco" className="px-5 py-4 text-sm text-muted-foreground">
              {empty}
            </p>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-card in-[.v3]:rounded-lg">
          {count > 0 ? (
            <div ref={listaRef} className="divide-y divide-border/60">
              {children}
            </div>
          ) : (
            <p className="px-5 py-4 text-sm text-muted-foreground">{empty}</p>
          )}
        </div>
      )}
    </section>
  );
}

/** O conteúdo que, congelado, não se redesenha: fica como estava no último desenho. */
const Congelada = memo(
  function Congelada({ children }: { congelada: boolean; children: ReactNode }) {
    return <>{children}</>;
  },
  (_antes, depois) => depois.congelada,
);

/** Os controles da linha que a espera trava. */
const CONTROLES = 'button, a[href], input, select, textarea, [role="button"], [tabindex]:not([tabindex="-1"])';

/** As teclas que acionam um botão ou abrem um menu. */
const TECLAS_QUE_ACIONAM = new Set(["Enter", " ", "ArrowDown", "ArrowUp"]);

/** O toque que chega à linha que espera não aciona nada: nem o clique, nem o link. */
function semAcao(evento: SyntheticEvent) {
  evento.preventDefault();
  evento.stopPropagation();
}

/**
 * O dedo continua contando para a regra da lista (o evento segue), mas o menu
 * que abre no pointerdown não abre.
 */
function semAbrir(evento: PointerEvent) {
  evento.preventDefault();
}

function semTeclaQueAciona(evento: KeyboardEvent) {
  if (TECLAS_QUE_ACIONAM.has(evento.key)) evento.preventDefault();
}

/**
 * A linha de uma fila sem saltos (o useListaSemSaltos, carregamento v2,
 * momento 4): o elemento com a chave e o estado na lista. A linha que espera
 * o dedo ou que sai fica congelada: mostra o que mostrava quando deixou a
 * fila (o "Aprovado"), mesmo sem o dado.
 *
 * A que espera já saiu dos dados (outra pessoa decidiu): fica à vista e no
 * mesmo lugar, mas não dispara ação. Os controles dela ficam aria-disabled,
 * com a trava aqui, nunca disabled nem inert, que tirariam o foco de quem
 * está nela.
 */
export function LinhaDaFila({ lista, chave, children }: { lista: Pick<ListaSemSaltos, "linha">; chave: string; children: ReactNode }) {
  const atributos = lista.linha(chave);
  const naLista = atributos["data-na-lista"];
  const esperando = naLista === "esperando";
  const elemento = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!esperando || !elemento.current) return undefined;
    // Só os que estavam livres: o que já estava travado (o "Aprovado") fica como estava.
    const travados = Array.from(elemento.current.querySelectorAll<HTMLElement>(CONTROLES)).filter(
      (controle) => controle.getAttribute("aria-disabled") !== "true" && !controle.hasAttribute("disabled"),
    );
    for (const controle of travados) controle.setAttribute("aria-disabled", "true");
    return () => {
      for (const controle of travados) if (controle.getAttribute("aria-disabled") === "true") controle.removeAttribute("aria-disabled");
    };
  }, [esperando]);
  return (
    <div
      ref={elemento}
      {...atributos}
      {...(esperando ? { onClickCapture: semAcao, onPointerDownCapture: semAbrir, onKeyDownCapture: semTeclaQueAciona } : {})}
    >
      <Congelada congelada={esperando || naLista === "saindo"}>{children}</Congelada>
    </div>
  );
}

export function QueueRow({
  icon: Icon,
  tone,
  title,
  badge,
  meta,
  apoio,
  age,
  note,
  detail,
  actions,
  onToggle,
  open,
  aoLadoDoToggle,
  actionsClassName,
  className,
}: {
  actionsClassName?: string;
  className?: string;
  icon: LucideIcon;
  tone: QueueTone;
  title: string;
  /** Um selo ao lado do título ("sem prateleira", "0 de 2 caixas guardadas"). */
  badge?: ReactNode;
  meta: string;
  /**
   * O estado da linha no lugar do meta e da idade (carregamento v2, momento
   * 4): o objeto aos 3 s ("Aprovando pedido 1042…"), a demora aos 10 s e o
   * motivo do erro. Sem ele, o meta.
   */
  apoio?: ReactNode;
  age?: string;
  note?: ReactNode;
  /** Uma linha de dado neutra abaixo do meta (a entrega do pedido, por exemplo). */
  detail?: ReactNode;
  actions?: ReactNode;
  onToggle?: () => void;
  open?: boolean;
  /** Um atalho ao lado de "Ver itens" ("Imprimir lista" no celular, onde os botões vêm depois dos itens). */
  aoLadoDoToggle?: ReactNode;
}) {
  const toggle = onToggle ? (
    <button
      type="button"
      onClick={onToggle}
      className={cn("inline-flex items-center gap-1 text-xs font-medium text-primary", !aoLadoDoToggle && "mt-1.5")}
    >
      {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
      {open ? "Esconder itens" : "Ver itens"}
    </button>
  ) : null;
  return (
    <div
      className={cn(
        "flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:gap-4 md:px-5",
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3.5">
        <div className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl in-[.v3]:size-11 in-[.v3]:rounded-lg", QUEUE_TONE[tone])}>
          <Icon className="size-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-foreground in-[.v3]:text-base in-[.v3]:font-bold">
            {title}
            {badge ? <span className="ml-2 inline-flex align-middle">{badge}</span> : null}
          </p>
          <p className="mt-0.5 text-sm text-foreground/60">
            {apoio ?? (
              <>
                {meta}
                {age ? <span className="text-foreground/45"> · {age}</span> : null}
              </>
            )}
          </p>
          {detail ? <p className="mt-1 text-sm text-foreground/75">{detail}</p> : null}
          {note ? (
            <p className="mt-1.5 flex items-center gap-1.5 text-sm text-warning-soft-foreground">{note}</p>
          ) : null}
          {aoLadoDoToggle ? (
            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1">
              {toggle}
              {aoLadoDoToggle}
            </div>
          ) : (
            toggle
          )}
        </div>
      </div>
      {actions ? (
        <div
          className={cn(
            "flex shrink-0 gap-2 [&>*]:flex-1 sm:[&>*]:flex-none",
            actionsClassName,
          )}
        >
          {actions}
        </div>
      ) : null}
    </div>
  );
}
