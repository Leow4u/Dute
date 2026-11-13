import { useEffect, useId, useRef, type CSSProperties, type ReactNode } from "react";
import { Check, Clock3, RefreshCw } from "lucide-react";

import { CaixaDeAlerta } from "@/components/ui/botao-de-acao";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useAnuncio } from "@/lib/carregando/anunciador";
import { useEspera } from "@/lib/carregando/use-espera";
import { cn } from "@/lib/utils";

/** Onde cada item está: esperando a vez, em andamento, feito ou com erro. */
export type EstadoDoItemDoProgresso = "fila" | "andamento" | "feito" | "erro";

export interface ItemDoProgresso {
  /** "Foto 3", "Separação". Sem ele, a foto leva o número da posição. */
  rotulo?: string;
  estado: EstadoDoItemDoProgresso;
  /**
   * De 0 a 1: a parte feita do item em andamento (os bytes da foto). Muda por
   * evento, nunca por quadro. Sem ela (ou em 0), os bytes ainda não foram
   * medidos: a foto de até 256 KB sobe numa requisição só, sem evento no
   * meio, e o item gira em vez de encher.
   */
  fracao?: number;
  /** A miniatura da foto (o object URL local), na contagem. */
  miniatura?: string | null;
  /** O "Tentar de novo" do item que falhou. */
  onTentar?: () => void;
}

export interface ProgressoProps {
  /** `contagem`: "3 de 4", a barra em segmentos e as miniaturas. `etapas`: "Etapa 1 de 2" e os marcadores. */
  forma: "contagem" | "etapas";
  /** O nome da operação: "Enviando fotos", "Concluindo a separação". É o nome da barra de progresso. */
  titulo: string;
  itens: readonly ItemDoProgresso[];
  /** O fim da contagem: "4 fotos enviadas", com a caixa fechada quando nenhuma falhou. É também o nome da barra no fim. */
  concluido?: string;
  /** Ao lado do título, só visual e fora de região viva: o "0:12" da foto por IA. */
  apoio?: ReactNode;
  /** O que se conta, no singular e no plural: "3 de 4 fotos". */
  unidade?: readonly [string, string];
  className?: string;
}

/** A caixa chanfrada (viewBox 24), a mesma do indicador. */
const CAIXA = "M6 3.5H18A2.5 2.5 0 0 1 20.5 6V14.5L14.5 20.5H6A2.5 2.5 0 0 1 3.5 18V6A2.5 2.5 0 0 1 6 3.5Z";
const CHECK = "M8 12.3l2.6 2.6 5.2-5.5";

/** A caixa cheia, com o check vazado (a etapa feita, o fim da contagem), ou só o contorno a 30% (`vazia`). Decorativa. */
export function CaixaCheia({ tamanho = 28, vazia = false, className }: { tamanho?: number; vazia?: boolean; className?: string }) {
  return (
    <svg
      className={cn("carregando-caixa-cheia", className)}
      data-vazia={vazia ? "" : undefined}
      width={tamanho}
      height={tamanho}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path data-parte="miolo" d={CAIXA} />
      {vazia ? null : <path data-parte="check" d={CHECK} />}
    </svg>
  );
}

function fracao(valor: number | undefined): number {
  return valor !== undefined && Number.isFinite(valor) ? Math.min(1, Math.max(0, valor)) : 0;
}

/** Os bytes do item já foram medidos: ele enche pela fração; antes disso, gira. */
function medido(item: Pick<ItemDoProgresso, "fracao">): boolean {
  return fracao(item.fracao) > 0;
}

/**
 * O número que a contagem mostra: as que já passaram (enviadas ou não) mais
 * a que está em andamento ("3 de 4" com uma enviada, uma não enviada e a
 * terceira subindo).
 */
export function numeroDaContagem(itens: readonly Pick<ItemDoProgresso, "estado">[]): number {
  const passadas = itens.filter((item) => item.estado === "feito" || item.estado === "erro").length;
  const andando = itens.some((item) => item.estado === "andamento") ? 1 : 0;
  return Math.min(itens.length, passadas + andando);
}

/** A etapa atual: a primeira que não terminou (a última, quando todas terminaram). */
export function numeroDaEtapa(itens: readonly Pick<ItemDoProgresso, "estado">[]): number {
  const atual = itens.findIndex((item) => item.estado !== "feito");
  return atual < 0 ? itens.length : atual + 1;
}

/**
 * O progresso das operações longas (carregamento v2, seção 9 e momento 6),
 * no lugar do "Enviando..." das fotos e do "Registrando..." único das
 * etapas. Conta sempre que dá: "3 de 4" e "Etapa 1 de 2" se leem de longe e
 * não dependem do movimento.
 *
 * - `contagem`: o título ("Enviando fotos") e o "3" grande com o "de 4"; a
 *   barra em segmentos chanfrados de 8 px (o feito em tinta, o atual enchendo
 *   pelos bytes, com as listras até os 5 s, o da fila só no trilho); as
 *   miniaturas com o véu e a caixa determinada, o selo verde da enviada, o
 *   contorno da fila e a caixa com o "!" da que falhou, com o próprio "Tentar
 *   de novo". O item sem os bytes medidos gira, em vez de encher. No fim, o
 *   `concluido` ("4 fotos enviadas"), com a caixa fechada quando nenhuma
 *   falhou, e as miniaturas ficam com o selo verde, como na prancha: o bloco
 *   não encolhe no fim.
 * - `etapas`: "Etapa 1 de 2" e os marcadores de 28 px (a feita cheia com o
 *   check, a atual com o indicador, a pendente em contorno com o número),
 *   unidos pelo fio que enche quando a de antes termina. Mora na tela desde o
 *   repouso, com as etapas pendentes, para nada empurrar o botão tocado; o
 *   Anunciador fala o título aos 300 ms da espera. Com mais de duas etapas
 *   numa caixa estreita, os rótulos vão para baixo dos marcadores.
 *
 * A barra de progresso (`role="progressbar"`) tem o título como nome (no fim
 * da contagem, o `concluido`) e o `aria-valuetext` ("3 de 4 fotos", "Etapa 1
 * de 2"), que muda por item, nunca por byte. O resto é decorativo. Cada
 * "Tentar de novo" é descrito pela foto dele ("Foto 3 não enviada"), e o
 * que sai da tela leva o foco ao seguinte, ou ao título.
 */
export function Progresso({ forma, titulo, itens, concluido, apoio, unidade = ["foto", "fotos"], className }: ProgressoProps) {
  const total = itens.length;
  // Nas etapas, em repouso todas ficam pendentes: espera só a que anda. Na contagem, a da fila também espera.
  const ativo = itens.some((item) => item.estado === "andamento" || (forma === "contagem" && item.estado === "fila"));
  const espera = useEspera(ativo);
  const anunciar = useAnuncio();
  const id = useId();
  const cabecalho = useRef<HTMLParagraphElement | null>(null);
  const tentativas = useRef(new Map<number, HTMLButtonElement>());
  // As etapas falam a entrada na espera aos 300 ms; a contagem é falada por quem envia ("Enviando 4 fotos").
  const entrou = forma === "etapas" && espera.visivel;
  useEffect(() => {
    if (entrou) anunciar(titulo);
  }, [entrou, titulo, anunciar]);
  // Antes de 300 ms o relógio ainda não mostrou nada: o movimento conta como ligado.
  const movimento = !espera.visivel || espera.movimento;
  if (total === 0) return null;

  if (forma === "etapas") {
    const atual = numeroDaEtapa(itens);
    return (
      <div data-progresso="etapas" className={cn("grid gap-3", className)}>
        <p
          role="progressbar"
          aria-label={titulo}
          aria-valuemin={1}
          aria-valuemax={total}
          aria-valuenow={atual}
          aria-valuetext={`Etapa ${atual} de ${total}`}
          className="flex items-baseline gap-1.5 text-base font-bold text-foreground"
        >
          Etapa
          <span className="flex items-baseline gap-1.5">
            <b className="text-xl font-extrabold tabular-nums">{atual}</b>
            <span className="text-muted-foreground">de {total}</span>
          </span>
        </p>
        <div className="carregando-etapas-caixa rounded-xl border border-border bg-background px-4 py-3.5">
          <div className="carregando-etapas" data-n={total}>
            {itens.map((item, indice) => (
              <Etapa
                key={item.rotulo ?? indice}
                // Nada aparece antes de 300 ms: até lá, a etapa que anda fica como estava, pendente.
                item={item.estado === "andamento" && !espera.visivel ? { ...item, estado: "fila" } : item}
                numero={indice + 1}
                calmo={espera.calmo}
                fio={indice > 0 ? itens[indice - 1].estado === "feito" : null}
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  const numero = numeroDaContagem(itens);
  const semFalha = itens.every((item) => item.estado === "feito");
  // A vez acabou (nada espera nem sobe): o título diz o que subiu, mesmo com uma não enviada.
  const terminou = !ativo && Boolean(concluido);
  const nome = terminou && concluido ? concluido : titulo;
  const mostradas = itens.map((item, indice) => ({ item, indice, rotulo: item.rotulo ?? `Foto ${indice + 1}` }));
  const comMiniatura = mostradas.filter(({ item }) => item.miniatura);
  const falhas = mostradas.filter(({ item }) => item.estado === "erro" && item.onTentar);
  const [um, varios] = unidade;
  /**
   * O "Tentar de novo" sai da tela quando a foto volta à fila: o foco vai,
   * antes, ao da próxima não enviada, ou ao título (2.4.3), e não cai no corpo.
   */
  const tentar = (indice: number, fazer: () => void) => {
    const proximo = falhas.find((falha) => falha.indice !== indice);
    const destino = (proximo ? tentativas.current.get(proximo.indice) : undefined) ?? cabecalho.current;
    destino?.focus();
    fazer();
  };

  return (
    <div data-progresso="contagem" className={cn("grid gap-3", className)}>
      <div className="flex min-h-11 items-end justify-between gap-3">
        <p
          ref={cabecalho}
          tabIndex={-1}
          data-titulo=""
          className="flex min-h-7 flex-wrap items-center gap-x-2.5 text-base font-bold text-foreground outline-none"
        >
          {terminou && concluido ? (
            <>
              {semFalha ? <CaixaCheia tamanho={20} className="text-success" /> : null}
              {concluido}
            </>
          ) : (
            titulo
          )}
          {apoio}
        </p>
        <p
          role="progressbar"
          aria-label={nome}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={numero}
          aria-valuetext={`${numero} de ${total} ${total === 1 ? um : varios}`}
          className="flex items-baseline gap-1.5 whitespace-nowrap leading-none text-foreground"
        >
          <b className="text-contagem tabular-nums md:text-contagem-sm">{numero}</b>
          <span className="text-base font-bold text-muted-foreground">de {total}</span>
        </p>
      </div>
      <div
        className="carregando-segmentos"
        aria-hidden="true"
        data-parado={movimento ? undefined : ""}
        style={{ "--n": String(total) } as CSSProperties}
      >
        {itens.map((item, indice) => (
          <span
            key={indice}
            data-segmento=""
            data-estado={item.estado}
            data-medido={item.estado === "andamento" && medido(item) ? "" : undefined}
            style={item.estado === "andamento" ? ({ "--f": String(fracao(item.fracao)) } as CSSProperties) : undefined}
          >
            <span data-parte="trilho" />
            <span data-parte="enche" />
            {item.estado === "andamento" ? <span data-parte="listras" /> : null}
          </span>
        ))}
      </div>
      {comMiniatura.length > 0 ? (
        <div className="carregando-miniaturas" aria-hidden="true">
          {comMiniatura.map(({ item, rotulo }) => (
            <span key={rotulo} className="carregando-miniatura" data-estado={item.estado}>
              <img src={item.miniatura ?? undefined} alt="" />
              {item.estado === "fila" ? (
                <>
                  <span data-veu="fila" />
                  <span data-selo="fila">
                    <Clock3 className="size-3.5" />
                  </span>
                </>
              ) : item.estado === "andamento" ? (
                <span data-veu="escuro">
                  <Spinner tamanho={24} progresso={medido(item) ? fracao(item.fracao) : undefined} calmo={espera.calmo} className="carregando-sobre-preto" />
                </span>
              ) : item.estado === "erro" ? (
                <span data-veu="escuro">
                  <CaixaDeAlerta className="size-6" />
                </span>
              ) : (
                <span data-selo="feito">
                  <Check className="size-3.5" strokeWidth={3} />
                </span>
              )}
            </span>
          ))}
        </div>
      ) : null}
      {falhas.map(({ item, indice, rotulo }) => (
        <div key={rotulo} className="flex flex-wrap items-center gap-3">
          <p id={`${id}-falha-${indice}`} className="text-sm font-bold text-foreground">{`${rotulo} não enviada`}</p>
          <Button
            ref={(botao) => {
              if (botao) tentativas.current.set(indice, botao);
              else tentativas.current.delete(indice);
            }}
            type="button"
            variant="outline"
            className="min-h-11"
            aria-describedby={`${id}-falha-${indice}`}
            onClick={() => (item.onTentar ? tentar(indice, item.onTentar) : undefined)}
          >
            <RefreshCw className="size-4" aria-hidden="true" />
            Tentar de novo
          </Button>
        </div>
      ))}
    </div>
  );
}

function Etapa({ item, numero, calmo, fio }: { item: ItemDoProgresso; numero: number; calmo: boolean; fio: boolean | null }) {
  return (
    <>
      {fio === null ? null : (
        <span className="carregando-fio" data-cheio={fio ? "" : undefined} aria-hidden="true">
          <i data-parte="trilho" />
          <i data-parte="enche" />
        </span>
      )}
      <span
        className={cn("flex items-center gap-2.5 whitespace-nowrap text-base font-bold", item.estado === "fila" ? "text-muted-foreground" : "text-foreground")}
        data-etapa={item.estado}
      >
        <span className="carregando-marcador" aria-hidden="true">
          {item.estado === "feito" ? (
            <CaixaCheia className="text-foreground" />
          ) : item.estado === "andamento" ? (
            <Spinner tamanho={24} calmo={calmo} className="text-foreground" />
          ) : item.estado === "erro" ? (
            <CaixaDeAlerta className="size-7 text-destructive" />
          ) : (
            <>
              <CaixaCheia vazia className="text-foreground" />
              <span className="text-xs font-extrabold text-muted-foreground">{numero}</span>
            </>
          )}
        </span>
        {item.rotulo}
      </span>
    </>
  );
}
