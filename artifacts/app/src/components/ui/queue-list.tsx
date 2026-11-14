import {
  memo,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type Ref,
  type SyntheticEvent,
} from "react";
import { ChevronDown, ChevronRight, type LucideIcon } from "lucide-react";

import { CartaoComBrilho, Esqueleto } from "@/components/ui/esqueleto";
import { useEsperaDaRota } from "@/lib/carregando/espera-da-rota";
import { CARREGANDO } from "@/lib/carregando/tempo";
import { useChegada } from "@/lib/carregando/use-chegada";
import { useEspera } from "@/lib/carregando/use-espera";
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
 * troca. Só o número atual fica na árvore de acessibilidade: o `naArvore`,
 * quando difere do que se vê (a linha que esmaece ainda conta na tela, mas já
 * saiu da árvore, inert). Zero não mostra número. Com `entrar` (o bloco que
 * vira número na chegada da primeira leitura, momento 2), o número entra
 * subindo, como o que rola, e com `deBloco` o bloco sai subindo no mesmo
 * lugar, como o número velho.
 */
export function ContagemQueRola({
  valor,
  naArvore = valor,
  entrar = false,
  deBloco = false,
}: {
  valor: number;
  naArvore?: number;
  entrar?: boolean;
  /** Na chegada (`entrar`), o bloco que estava no lugar do número sai subindo enquanto ele entra (momento 2). */
  deBloco?: boolean;
}) {
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
  const blocoSaindo = entrar && deBloco && saindo === null;
  if (!mostrado && !saindo && !blocoSaindo) return null;
  return (
    <span className="carregando-conta tabular-nums">
      {saindo ? (
        <span key={`sai-${saindo}`} data-conta="sai" aria-hidden="true">
          {saindo}
        </span>
      ) : blocoSaindo ? (
        <span key="bloco" data-conta="sai" aria-hidden="true">
          <Esqueleto forma="contagem" />
        </span>
      ) : null}
      {mostrado ? (
        <span key={`entra-${mostrado}`} data-conta={saindo !== null || entrar ? "entra" : undefined} aria-hidden={naArvore !== mostrado ? true : undefined}>
          {mostrado}
        </span>
      ) : null}
      {naArvore !== mostrado && naArvore ? <span className="sr-only">{naArvore}</span> : null}
    </span>
  );
}

/**
 * O anel do título que recebe o foco quando a última linha sai com ele: o
 * mesmo do Button (o token --foco, cheio, com o contorno das cores
 * forçadas), só no foco visível.
 */
const TITULO_FOCAVEL =
  "rounded-md focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-foco focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/** A lista na primeira leitura (carregamento v2, momento 2): as linhas-fantasma que o grupo mostra antes do dado. */
export interface CarregandoDoGrupo {
  /** Quantas linhas-fantasma: a contagem lembrada do grupo, entre 1 e 5 (linhasDosFantasmas). */
  linhas: number;
  /** Quantos botões-fantasma cada linha tem, nas larguras das ações reais (Recusar e Aprovar; Separar). */
  acoes: 0 | 1 | 2;
  /** A posição do cartão na tela (0, 1, 2…): o brilho de cada um começa 120 ms depois do anterior. */
  ordem?: number;
  /** A linha do atalho sob o apoio, como o "Ver volumes" do pedido em "Para entregar". */
  atalho?: boolean;
  /**
   * No celular, as ações num bloco abaixo da linha, como as do pedido
   * (OrderRow), e não dentro dela: 16 px a mais entre o texto e os botões.
   */
  acoesAbaixo?: boolean;
}

/**
 * As larguras da linha-fantasma, com a do texto típico da fila, para o texto
 * nascer em cima do bloco e não riscado por um bloco mais comprido que ele: o
 * título de 32 a 44% da coluna e o apoio de 52 a 62% (seção 5.2), até a
 * largura de "Pedido 1042" e do meta da linha no computador (a prancha).
 */
const FORMAS_DA_LINHA_FANTASMA = [
  { titulo: "w-2/5 max-w-28", apoio: "w-3/5 max-w-72" },
  { titulo: "w-1/3 max-w-24", apoio: "w-13/24 max-w-64" },
  { titulo: "w-5/12 max-w-32", apoio: "w-7/12 max-w-80" },
] as const;

/** Os botões-fantasma, na largura das ações reais: Recusar e Aprovar (149 px cada, a do rótulo mais largo); uma só, Separar ou Conferir (96). */
const BOTOES_FANTASMA: Record<1 | 2, readonly string[]> = { 1: ["w-24"], 2: ["w-37", "w-37"] };

/**
 * A linha-fantasma com a anatomia da QueueRow (seção 5.2): a caixa do ícone
 * de 44 px, o título de 14 px e o apoio de 10 px nas mesmas linhas de texto
 * da linha real (a mesma altura), a linha do atalho quando a real tem uma
 * ("Ver volumes") e os botões de 40 px; no celular, os botões embaixo, na
 * largura toda, como os da linha real, e no bloco abaixo dela quando é o
 * pedido. A divisória é a da lista.
 */
function LinhaFantasma({ indice, carregando }: { indice: number; carregando: CarregandoDoGrupo }) {
  const forma = FORMAS_DA_LINHA_FANTASMA[indice % FORMAS_DA_LINHA_FANTASMA.length];
  const { acoes, atalho = false, acoesAbaixo = false } = carregando;
  return (
    <div
      data-linha-fantasma=""
      className={cn("flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:gap-4 md:px-5", acoes && acoesAbaixo && "max-sm:gap-7")}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3.5">
        <Esqueleto forma="icone" />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="flex h-6 items-center">
            <Esqueleto forma="texto" className={forma.titulo} />
          </span>
          <span className="mt-0.5 flex h-5 items-center">
            <Esqueleto forma="texto" className={cn("h-2.5", forma.apoio)} />
          </span>
          {atalho ? (
            <span className="mt-1.5 flex h-4 items-center">
              <Esqueleto forma="texto" className="h-2.5 w-20" />
            </span>
          ) : null}
        </div>
      </div>
      {acoes ? (
        <div className="flex shrink-0 gap-2 [&>*]:flex-1 sm:[&>*]:flex-none">
          {BOTOES_FANTASMA[acoes].map((largura, posicao) => (
            <Esqueleto key={posicao} forma="botao" className={largura} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * As linhas-fantasma do cartão (momento 2): desde 0 ms no cartão,
 * invisíveis, guardando a altura; aos 300 ms (`visiveis`) entram em 150 ms e
 * o brilho do cartão começa, dois ciclos, a 120 ms do cartão anterior. Na
 * chegada (`saindo`), o mesmo elemento sai do fluxo e fica por baixo das
 * linhas reais, recortado no cartão, e esmaece em 150 ms junto com a
 * primeira linha do grupo na cascata: a troca é por opacidade, sem quadro com
 * o cartão vazio. São decorativas e ficam fora da árvore de acessibilidade:
 * quem informa é o título real e a linha de estado.
 */
function LinhasFantasma({
  carregando,
  visiveis,
  saindo = false,
  cascata = 0,
  className,
}: {
  carregando: CarregandoDoGrupo;
  visiveis: boolean;
  saindo?: boolean;
  /** Na saída, a posição da primeira linha do grupo na cascata: os fantasmas esmaecem junto com ela. */
  cascata?: number;
  className?: string;
}) {
  const linhas = Array.from({ length: Math.max(1, Math.floor(carregando.linhas)) }, (_, indice) => (
    <LinhaFantasma key={indice} indice={indice} carregando={carregando} />
  ));
  const classes = cn("divide-y divide-border/60", className);
  return visiveis ? (
    <CartaoComBrilho
      ordem={carregando.ordem}
      aria-hidden="true"
      data-fantasmas=""
      data-visivel=""
      data-saindo={saindo ? "" : undefined}
      inert={saindo || undefined}
      style={saindo ? ({ "--chegada-desde": String(cascata) } as CSSProperties) : undefined}
      className={classes}
    >
      {linhas}
    </CartaoComBrilho>
  ) : (
    <div aria-hidden="true" data-fantasmas="" className={classes}>
      {linhas}
    </div>
  );
}

export function QueueGroup({
  title,
  hint,
  count,
  empty,
  children,
  rolarContagem = false,
  contagemNaArvore,
  listaRef,
  tituloRef,
  semSaltos = false,
  barraDoTopo,
  carregando,
  cascata = 0,
}: {
  title: string;
  hint?: string;
  /**
   * Quantas linhas o grupo tem. Nulo antes de ler (momento 2): no lugar do
   * número, o bloco ("Para aprovar ▪"), fora da árvore; nunca "0".
   */
  count: number | null;
  empty: ReactNode;
  children: ReactNode;
  /** A contagem rola quando muda (a fila sem saltos, carregamento v2). */
  rolarContagem?: boolean;
  /**
   * Com a contagem que rola, o número do leitor de tela, quando difere do que
   * se vê: sem a linha que esmaece, já fora da árvore (o `quantasFicam` do
   * useListaSemSaltos).
   */
  contagemNaArvore?: number;
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
  /**
   * A barra no topo do cartão que relê (a `BarraDeEspera lugar="topo"`;
   * carregamento v2, momento 7, caso 3): dentro do cartão, no raio dele.
   */
  barraDoTopo?: ReactNode;
  /**
   * A primeira leitura (carregamento v2, momento 2, e a decisão P3): o
   * cartão com as linhas-fantasma no lugar das linhas e do vazio ("Nenhum
   * pedido…" nunca antes de ler). Quando ele sai, o dado chega: as linhas
   * reais entram por opacidade, subindo 4 px, em cascata.
   */
  carregando?: CarregandoDoGrupo;
  /**
   * Na chegada, a posição da primeira linha deste grupo na cascata da tela
   * (quantas linhas os grupos de cima têm): só as seis primeiras da tela
   * entram uma depois da outra.
   */
  cascata?: number;
}) {
  const lendo = carregando !== undefined;
  // A primeira leitura que começa quando a tela chega segue o relógio da espera da rota, como a linha de estado.
  const rota = useEsperaDaRota(lendo);
  const espera = useEspera(lendo, { desde: rota?.inicio });
  const secao = useRef<HTMLElement>(null);
  const chegando = useChegada(lendo, secao);
  // As linhas-fantasma que estavam na tela quando o dado chegou: esmaecem por baixo das linhas reais.
  const naChegada = useRef<{ carregando: CarregandoDoGrupo; visiveis: boolean } | null>(null);
  useLayoutEffect(() => {
    if (carregando) naChegada.current = { carregando, visiveis: espera.visivel };
    else if (!chegando) naChegada.current = null;
  });
  const fantasmasSaindo = chegando && naChegada.current?.visiveis ? naChegada.current.carregando : null;
  const chegada = chegando ? { "data-chegada": "", style: { "--chegada-desde": String(cascata) } as CSSProperties } : {};
  const vazioChegando = chegando ? { "data-chegada-vazio": "", style: { "--chegada-desde": String(cascata) } as CSSProperties } : {};
  const temLinhas = count === null || count > 0;
  // O número antes de ler é o bloco, fora da árvore; depois, o número, que entra subindo na chegada.
  const contagem =
    count === null ? (
      <>
        {hint}
        {hint ? " · " : null}
        <Esqueleto forma="contagem" />
      </>
    ) : rolarContagem ? (
      <>
        {hint}
        {hint && count ? " · " : null}
        <ContagemQueRola valor={count} naArvore={contagemNaArvore} entrar={chegando} deBloco />
      </>
    ) : chegando ? (
      <>
        {hint}
        {hint && count ? " · " : null}
        <span className="carregando-conta tabular-nums">
          <span data-conta="sai" aria-hidden="true">
            <Esqueleto forma="contagem" />
          </span>
          {count ? <span data-conta="entra">{count}</span> : null}
        </span>
      </>
    ) : (
      [hint, count ? String(count) : null].filter(Boolean).join(" · ")
    );
  return (
    <section ref={secao} className="flex flex-col gap-2.5">
      <h2
        ref={tituloRef}
        tabIndex={tituloRef ? -1 : undefined}
        data-palco={semSaltos ? "bloco" : undefined}
        className={cn("flex items-baseline gap-2 px-1 focus:outline-none", tituloRef && TITULO_FOCAVEL)}
      >
        <span className="text-base font-semibold text-foreground in-[.v3]:text-lg in-[.v3]:font-bold">{title}</span>
        <span className="text-sm text-muted-foreground">{contagem}</span>
      </h2>
      {semSaltos ? (
        <div className="fila-cartao">
          {/* A moldura em três pedaços, atrás das linhas: o meio primeiro, as tampas por cima dele. */}
          <span aria-hidden="true" data-moldura="meio" data-palco="estica" className="border-x border-border" />
          <span aria-hidden="true" data-moldura="topo" data-palco="bloco" className="rounded-t-2xl border border-b-0 border-border bg-card in-[.v3]:rounded-t-lg" />
          <span aria-hidden="true" data-moldura="base" data-palco="bloco" className="rounded-b-2xl border border-t-0 border-border bg-card in-[.v3]:rounded-b-lg" />
          {carregando ? (
            <LinhasFantasma carregando={carregando} visiveis={espera.visivel} className="rounded-2xl bg-card in-[.v3]:rounded-lg" />
          ) : fantasmasSaindo ? (
            <LinhasFantasma carregando={fantasmasSaindo} visiveis saindo cascata={cascata} className="absolute inset-px rounded-2xl bg-card in-[.v3]:rounded-lg" />
          ) : null}
          {carregando ? null : temLinhas ? (
            <div ref={listaRef} className="divide-y divide-border/60 overflow-x-clip rounded-2xl in-[.v3]:rounded-lg" {...chegada}>
              {children}
            </div>
          ) : (
            <p data-palco="bloco" className="rounded-2xl bg-card px-5 py-4 text-sm text-muted-foreground in-[.v3]:rounded-lg" {...vazioChegando}>
              {empty}
            </p>
          )}
          {/* A barra do topo anda com a tampa de cima e fica por cima das linhas, recortada no raio. */}
          {barraDoTopo ? (
            <span
              aria-hidden="true"
              data-palco="bloco"
              className="pointer-events-none absolute inset-x-0 top-0 z-10 h-4 overflow-hidden rounded-t-2xl in-[.v3]:rounded-t-lg"
            >
              {barraDoTopo}
            </span>
          ) : null}
        </div>
      ) : (
        <div className="relative overflow-hidden rounded-2xl border border-border bg-card in-[.v3]:rounded-lg">
          {barraDoTopo}
          {carregando ? (
            <LinhasFantasma carregando={carregando} visiveis={espera.visivel} />
          ) : fantasmasSaindo ? (
            <LinhasFantasma carregando={fantasmasSaindo} visiveis saindo cascata={cascata} className="absolute inset-0" />
          ) : null}
          {carregando ? null : temLinhas ? (
            <div ref={listaRef} className="divide-y divide-border/60" {...chegada}>
              {children}
            </div>
          ) : (
            <p className="px-5 py-4 text-sm text-muted-foreground" {...vazioChegando}>
              {empty}
            </p>
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
 * a 0,45 como o travado do BotaoDeAcao (data-trava-da-espera, no
 * index.css), com a trava aqui, nunca disabled nem inert, que tirariam o
 * foco de quem está nela. A trava fica enquanto ela esmaece, e sai se ela
 * volta à fila.
 */
export function LinhaDaFila({ lista, chave, children }: { lista: Pick<ListaSemSaltos, "linha">; chave: string; children: ReactNode }) {
  const atributos = lista.linha(chave);
  const naLista = atributos["data-na-lista"];
  const esperando = naLista === "esperando";
  const elemento = useRef<HTMLDivElement>(null);
  // A que esperou e agora sai continua travada; a que voltou à fila, não.
  const [esperou, setEsperou] = useState(false);
  if (esperando !== esperou && (esperando || naLista !== "saindo")) setEsperou(esperando);
  const travada = esperando || (naLista === "saindo" && esperou);
  useLayoutEffect(() => {
    if (!travada || !elemento.current) return undefined;
    // Só os que estavam livres: o que já estava travado (o "Aprovado") fica como estava.
    const travados = Array.from(elemento.current.querySelectorAll<HTMLElement>(CONTROLES)).filter(
      (controle) => controle.getAttribute("aria-disabled") !== "true" && !controle.hasAttribute("disabled"),
    );
    for (const controle of travados) {
      controle.setAttribute("aria-disabled", "true");
      controle.setAttribute("data-trava-da-espera", "");
    }
    return () => {
      for (const controle of travados) {
        controle.removeAttribute("data-trava-da-espera");
        if (controle.getAttribute("aria-disabled") === "true") controle.removeAttribute("aria-disabled");
      }
    };
  }, [travada]);
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
  ocupada = false,
  apoioEmAndamento,
  aviso,
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
  /**
   * A linha tem uma ação em andamento (a barra corre na borda dela; momento
   * 4): `aria-busy` na linha até a resposta. O botão da ação diz o quê.
   */
  ocupada?: boolean;
  /** O objeto aos 3 s, no lugar do meta e da idade: "Aprovando pedido 1042…", em tinta e 700 (momento 4). */
  apoioEmAndamento?: string;
  /**
   * O que a linha avisa no lugar do meta e da idade: a demora aos 10 s
   * ("Demorando mais que o normal · 0:12") ou o motivo do erro. Vem antes do
   * apoio em andamento e do `apoio`.
   */
  aviso?: ReactNode;
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
      // O primário como texto: o --primary do escuro dava 4,4:1 no cartão (parte 13h).
      className={cn("inline-flex items-center gap-1 text-xs font-medium text-primary-texto", !aoLadoDoToggle && "mt-1.5")}
    >
      {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
      {open ? "Esconder itens" : "Ver itens"}
    </button>
  ) : null;
  // O estado da linha no lugar do meta: o aviso, o objeto em andamento ou o apoio de quem usa.
  const estadoDaLinha = aviso ?? (apoioEmAndamento ? <span className="font-bold text-foreground">{apoioEmAndamento}</span> : apoio);
  return (
    <div
      aria-busy={ocupada || undefined}
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
            {estadoDaLinha ?? (
              <>
                {meta}
                {/* A idade no tom do apoio, como na prancha: a 45% ela tinha 2,92:1 (parte 13h). */}
                {age ? <span> · {age}</span> : null}
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
