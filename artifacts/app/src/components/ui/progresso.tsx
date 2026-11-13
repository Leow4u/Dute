import type { CSSProperties } from "react";
import { Check, Clock3, RefreshCw } from "lucide-react";

import { CaixaDeAlerta } from "@/components/ui/botao-de-acao";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useEspera } from "@/lib/carregando/use-espera";
import { cn } from "@/lib/utils";

/** Onde cada item está: esperando a vez, em andamento, feito ou com erro. */
export type EstadoDoItemDoProgresso = "fila" | "andamento" | "feito" | "erro";

export interface ItemDoProgresso {
  /** "Foto 3", "Separação". Sem ele, a foto leva o número da posição. */
  rotulo?: string;
  estado: EstadoDoItemDoProgresso;
  /** De 0 a 1: a parte feita do item em andamento (os bytes da foto). Muda por evento, nunca por quadro. */
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
  /** O fim da contagem, com a caixa fechada: "4 fotos enviadas". */
  concluido?: string;
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

/** O número que a contagem mostra: as feitas mais a que está em andamento ("3 de 4" com duas enviadas e a terceira subindo). */
export function numeroDaContagem(itens: readonly Pick<ItemDoProgresso, "estado">[]): number {
  const feitos = itens.filter((item) => item.estado === "feito").length;
  const andando = itens.some((item) => item.estado === "andamento") ? 1 : 0;
  return Math.min(itens.length, feitos + andando);
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
 *   de novo". No fim, a caixa fechada e o `concluido` ("4 fotos enviadas").
 *   As miniaturas das enviadas saem quando a vez acaba: elas já estão na tela.
 * - `etapas`: "Etapa 1 de 2" e os marcadores de 28 px (a feita cheia com o
 *   check, a atual com o indicador, a pendente em contorno com o número),
 *   unidos pelo fio que enche quando a de antes termina.
 *
 * A barra de progresso (`role="progressbar"`) tem o título como nome e o
 * `aria-valuetext` ("3 de 4 fotos", "Etapa 1 de 2"), que muda por item, nunca
 * por byte. O resto é decorativo. O começo e o fim são falados pelo
 * Anunciador, por quem conduz a operação.
 */
export function Progresso({ forma, titulo, itens, concluido, unidade = ["foto", "fotos"], className }: ProgressoProps) {
  const total = itens.length;
  const ativo = itens.some((item) => item.estado === "andamento" || item.estado === "fila");
  const espera = useEspera(ativo);
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
        <div className="rounded-xl border border-border bg-background px-4 py-3.5">
          <div className="carregando-etapas">
            {itens.map((item, indice) => (
              <Etapa
                key={item.rotulo ?? indice}
                item={item}
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
  const feitos = itens.filter((item) => item.estado === "feito").length;
  const terminou = !ativo && feitos === total;
  const mostradas = itens
    .map((item, indice) => ({ item, rotulo: item.rotulo ?? `Foto ${indice + 1}` }))
    .filter(({ item }) => ativo || item.estado !== "feito");
  const comMiniatura = mostradas.filter(({ item }) => item.miniatura);
  const falhas = mostradas.filter(({ item }) => item.estado === "erro" && item.onTentar);
  const [um, varios] = unidade;

  return (
    <div data-progresso="contagem" className={cn("grid gap-3", className)}>
      <div className="flex min-h-11 items-end justify-between gap-3">
        <p className="flex min-h-7 items-center gap-2.5 text-base font-bold text-foreground">
          {terminou && concluido ? (
            <>
              <CaixaCheia tamanho={20} className="text-success" />
              {concluido}
            </>
          ) : (
            titulo
          )}
        </p>
        <p
          role="progressbar"
          aria-label={titulo}
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
                  <Spinner tamanho={24} progresso={fracao(item.fracao)} className="carregando-sobre-preto" />
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
      {falhas.map(({ item, rotulo }) => (
        <div key={rotulo} className="flex flex-wrap items-center gap-3">
          <p className="text-sm font-bold text-foreground">{`${rotulo} não enviada`}</p>
          <Button type="button" variant="outline" className="min-h-11" onClick={item.onTentar}>
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
