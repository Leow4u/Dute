import type { FormEvent } from "react";
import { Check, ChevronRight, Printer } from "lucide-react";
import { Link } from "wouter";

import { nomeComTamanho } from "@workspace/dominio";

import { Badge } from "@/components/ui/badge";
import { BotaoDeAcao, type EstadoDaAcao } from "@/components/ui/botao-de-acao";
import { Button } from "@/components/ui/button";
import { CarregandoNaRegiao } from "@/components/ui/carregando-na-regiao";
import { FalhaNaLeitura } from "@/components/ui/erro-na-leitura";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Segmented } from "@/components/ui/segmented";
import { cn } from "@/lib/utils";
import { formatBoxPlacement } from "@/lib/warehouse-boxes";
import {
  PRATELEIRAS_A_VISTA,
  textoDaMovida,
  textoDaOrigem,
  textoDaPrateleira,
  textoDasForas,
  type CaixaDaPrevia,
  type PreviaDoMover,
  type ResultadoDoMover,
} from "@/lib/warehouse-ops/mover-caixa";

/**
 * Estoque › Mapa › Mover caixa (docs/superpowers/specs/2026-11-19-mover-caixa-design.md;
 * mockup aprovado em docs/mockups/mover-caixa/, decisões do Leonardo de
 * 19/11/2026): uma caixa por vez. O campo "Caixa" (digitar ou ler o código),
 * o cartão da caixa, "Mover para" com a sugestão do sistema ou a escolha à
 * mão, e a caixa movida com "Imprimir etiqueta" e "Mover outra caixa". O que
 * impede o mover aparece com a frase do servidor. Os dados e as ações chegam
 * por props (pages/estoque-mapa-mover.tsx). Sem legenda.
 */

export type EstadoDoMover =
  | { fase: "vazia" }
  | { fase: "carregando"; caixa: string }
  | { fase: "falha"; caixa: string; erro: unknown }
  | { fase: "pronta"; previa: PreviaDoMover }
  | { fase: "movida"; previa: PreviaDoMover; resultado: ResultadoDoMover };

export type ModoDoMover = "sugestao" | "escolha";

export type PropsDoMover = {
  estado: EstadoDoMover;
  /** O que está no campo "Caixa". */
  digitado: string;
  /** A frase do código que não é de caixa, sob o campo; null sem ela. */
  avisoDoCampo: string | null;
  onDigitar: (valor: string) => void;
  onAbrir: () => void;
  modo: ModoDoMover;
  onModo: (modo: ModoDoMover) => void;
  /** A prateleira escolhida à mão. */
  escolhida: string | null;
  onEscolher: (codigo: string) => void;
  verTodas: boolean;
  onVerTodas: () => void;
  mover: { estado: EstadoDaAcao; rotulo?: string };
  onMover: (destino: string) => void;
  /** A frase do servidor depois do mover recusado. */
  recusa: string | null;
  /** As caixas movidas sem etiqueta nova: "Etiquetas para trocar · N" com duas ou mais. */
  etiquetas: readonly string[];
  hrefDasEtiquetas: (codigos: readonly string[]) => string;
  onOutraCaixa: () => void;
  onTentar: () => unknown;
};

const MODOS = [
  { value: "sugestao", label: "Sugestão do sistema" },
  { value: "escolha", label: "Escolher prateleira" },
] as const;

const SITUACOES: Record<string, string> = {
  stored: "guardada",
  committing: "a caminho",
  emptied: "vazia",
  counting: "em conferência",
  reviewed: "em conferência",
};

const numero = new Intl.NumberFormat("pt-BR");
const ID_DO_CAMPO = "mover-caixa-codigo";
const ID_DO_AVISO = "mover-caixa-aviso";

/** O chip da caixa: o código em fonte fixa, no azul da v3. */
function Chip({ code }: { code: string }) {
  return <span className="whitespace-nowrap rounded-md bg-info-soft px-2 py-0.5 font-mono text-sm font-extrabold text-info-soft-foreground">{code}</span>;
}

export function EstoqueMapaMoverView(props: PropsDoMover) {
  const { estado } = props;
  const previa = estado.fase === "pronta" || estado.fase === "movida" ? estado.previa : null;
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 pb-24">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
          <Link href="/estoque/mapa" className="text-sm font-bold text-primary-texto">
            Mapa
          </Link>
          <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
          <h1 className="text-3xl font-extrabold tracking-tight text-foreground">Mover caixa</h1>
        </div>
        {props.etiquetas.length >= 2 ? (
          <Button asChild variant="outline" className="w-fit max-md:min-h-11">
            <Link href={props.hrefDasEtiquetas(props.etiquetas)}>
              <Printer className="size-4" aria-hidden="true" />
              {`Etiquetas para trocar · ${props.etiquetas.length}`}
            </Link>
          </Button>
        ) : null}
      </header>

      <CampoDaCaixa digitado={props.digitado} aviso={props.avisoDoCampo} onDigitar={props.onDigitar} onAbrir={props.onAbrir} />

      {estado.fase === "carregando" ? (
        <CarregandoNaRegiao rotulo="Carregando a caixa…" onTentar={props.onTentar} className="rounded-lg border border-border bg-card px-5 py-6" />
      ) : null}
      {estado.fase === "falha" ? (
        <FalhaNaLeitura leitura={{ error: estado.erro, refetch: async () => props.onTentar() }} erro={estado.erro} mensagem="Não consegui carregar a caixa." />
      ) : null}

      {previa ? <CartaoDaCaixa box={previa.box} local={estado.fase === "movida" ? estado.resultado.to_location_id : previa.box.location_id} /> : null}

      {estado.fase === "pronta" && estado.previa.bloqueio ? <Recusa mensagem={estado.previa.bloqueio.message} /> : null}
      {estado.fase === "pronta" && !estado.previa.bloqueio ? (
        <>
          {props.recusa ? <Recusa mensagem={props.recusa} /> : null}
          <PainelMover previa={estado.previa} {...props} />
        </>
      ) : null}

      {estado.fase === "movida" ? <Movida resultado={estado.resultado} hrefDaEtiqueta={props.hrefDasEtiquetas([estado.resultado.box_code])} onOutraCaixa={props.onOutraCaixa} /> : null}
    </div>
  );
}

function CampoDaCaixa({ digitado, aviso, onDigitar, onAbrir }: { digitado: string; aviso: string | null; onDigitar: (valor: string) => void; onAbrir: () => void }) {
  const abrir = (evento: FormEvent) => {
    evento.preventDefault();
    onAbrir();
  };
  return (
    <form className="flex flex-col gap-1.5 sm:max-w-md" onSubmit={abrir}>
      <Label htmlFor={ID_DO_CAMPO}>Caixa</Label>
      <div className="flex gap-2">
        <Input
          id={ID_DO_CAMPO}
          value={digitado}
          onChange={(evento) => onDigitar(evento.target.value)}
          placeholder="CX-000000"
          autoComplete="off"
          aria-invalid={aviso ? true : undefined}
          aria-describedby={aviso ? ID_DO_AVISO : undefined}
          className="font-mono text-base font-bold max-md:h-12"
        />
        <Button type="submit" variant="outline" className="max-md:min-h-12">
          Abrir
        </Button>
      </div>
      {aviso ? (
        <p id={ID_DO_AVISO} role="alert" className="text-sm font-semibold text-destructive-soft-foreground">
          {aviso}
        </p>
      ) : null}
    </form>
  );
}

function CartaoDaCaixa({ box, local }: { box: CaixaDaPrevia; local: string }) {
  return (
    <section aria-label={`Caixa ${box.code}`} className="flex flex-col gap-3 rounded-lg border border-border bg-card p-5">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
        <Chip code={box.code} />
        <Badge variant="outline" className="text-sm font-bold">
          {SITUACOES[box.status] ?? box.status}
        </Badge>
        <span className="text-sm text-muted-foreground">
          em <b className="font-mono text-base font-extrabold text-foreground">{local}</b>
        </span>
        <span className="ml-auto text-sm font-bold tabular-nums text-foreground">{`${numero.format(box.units)} un.`}</span>
      </div>
      {box.items.length ? (
        <ul className="flex flex-col gap-1.5 text-sm">
          {box.items.map((item) => (
            <li key={item.sku_code} className="flex flex-wrap items-baseline justify-between gap-x-3">
              <span>
                <b className="font-bold tabular-nums">{numero.format(item.qty)}</b>
                {` × ${nomeComTamanho({ nome: item.product_name || item.sku_code, codigo: item.client_item_code, tamanho: item.size }) || item.sku_code}`}
              </span>
              {item.client_item_code ? <span className="font-mono text-xs text-muted-foreground">{item.client_item_code}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="text-xs text-muted-foreground">{textoDaOrigem(box)}</p>
    </section>
  );
}

function Recusa({ mensagem }: { mensagem: string }) {
  return (
    <section role="alert" className="rounded-lg border border-amber-soft-border bg-amber-soft p-5 text-amber-soft-foreground">
      <p className="text-sm font-bold">{mensagem}</p>
    </section>
  );
}

function PainelMover({
  previa,
  modo,
  onModo,
  escolhida,
  onEscolher,
  verTodas,
  onVerTodas,
  mover,
  onMover,
}: PropsDoMover & { previa: PreviaDoMover }) {
  const [sugestao, ...outras] = previa.prateleiras;
  const alternativas = outras.slice(0, 2).map((destino) => destino.code);
  const alvo = modo === "escolha" ? escolhida ?? sugestao?.code : sugestao?.code;
  const escolhido = previa.prateleiras.find((destino) => destino.code === alvo) ?? null;
  const visiveis = verTodas ? previa.prateleiras : previa.prateleiras.slice(0, PRATELEIRAS_A_VISTA);
  const foras = [textoDasForas("Não cabe", previa.nao_cabem), textoDasForas("Com reserva", previa.com_reserva), textoDasForas("Em contagem", previa.em_contagem)].filter((texto): texto is string => Boolean(texto));
  const botao = alvo ? (
    <BotaoDeAcao className="max-md:min-h-12 max-md:w-full" estado={mover.estado} rotulo={mover.rotulo ?? `Mover para ${alvo}`} andamento="Movendo…" onClick={() => onMover(alvo)} />
  ) : null;
  return (
    <section aria-labelledby="mover-para" className="@container flex flex-col gap-4 rounded-lg border border-border bg-muted/40 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="mover-para" className="text-xs font-extrabold uppercase tracking-wider text-muted-foreground">
          Mover para
        </h2>
        <Segmented<ModoDoMover> aria-label="Escolha da prateleira" options={MODOS} value={modo} onChange={onModo} cheioNoCelular />
      </div>

      {!sugestao ? (
        <p className="text-sm font-semibold">{previa.rejected}</p>
      ) : modo === "sugestao" ? (
        <div className="flex flex-col gap-4 @lg:flex-row @lg:items-start @lg:justify-between">
          <div className="flex min-w-0 flex-col gap-1">
            <p className="text-4xl font-extrabold tracking-tight">{sugestao.code}</p>
            <p className="text-sm">{sugestao.reason}</p>
            <p className="text-sm text-muted-foreground">{textoDaPrateleira(sugestao.free_front_m, sugestao.box_count)}</p>
            {/* O encaixe que o mover manda e o servidor confere, como no Receber. */}
            <p className="text-sm text-muted-foreground">{formatBoxPlacement(sugestao.placement)}</p>
            <div className="mt-1 flex flex-wrap gap-2">
              {sugestao.tier === 1 ? (
                <Badge variant="outline" className="border-info-soft-border bg-info-soft text-info-soft-foreground">
                  mesmo produto
                </Badge>
              ) : null}
              {alternativas.length ? (
                <Badge variant="outline" className="border-border bg-muted text-muted-foreground">
                  {`alternativas ${alternativas.join(" · ")}`}
                </Badge>
              ) : null}
            </div>
          </div>
          {botao}
        </div>
      ) : (
        <>
          <RadioGroup
            value={alvo}
            onValueChange={onEscolher}
            aria-label="Prateleiras onde a caixa cabe"
            className="flex flex-col gap-0 divide-y divide-border overflow-hidden rounded-lg border border-border bg-card"
          >
            {visiveis.map((destino) => {
              const id = `destino-${destino.code}`;
              return (
                <label key={destino.code} htmlFor={id} className={cn("flex min-h-12 cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5", destino.code === alvo && "bg-info-soft/70")}>
                  <RadioGroupItem value={destino.code} id={id} />
                  <span className="w-14 font-mono text-base font-extrabold text-foreground">{destino.code}</span>
                  {destino.tier === 1 ? (
                    <Badge variant="outline" className="border-info-soft-border bg-info-soft text-info-soft-foreground">
                      mesmo produto
                    </Badge>
                  ) : null}
                  <span className="ml-auto text-sm tabular-nums text-muted-foreground">{textoDaPrateleira(destino.free_front_m, destino.box_count)}</span>
                </label>
              );
            })}
          </RadioGroup>
          <div className="flex flex-col gap-3 @lg:flex-row @lg:items-center @lg:justify-between">
            {!verTodas && previa.prateleiras.length > PRATELEIRAS_A_VISTA ? (
              <Button type="button" variant="link" className="h-auto w-fit p-0 font-bold" onClick={onVerTodas}>
                {`Ver as ${numero.format(previa.prateleiras.length)} prateleiras`}
              </Button>
            ) : (
              <span aria-hidden="true" />
            )}
            <div className="flex flex-col gap-2 @lg:flex-row @lg:items-center">
              {escolhido ? <p className="text-sm text-muted-foreground">{formatBoxPlacement(escolhido.placement)}</p> : null}
              {botao}
            </div>
          </div>
        </>
      )}

      {/* As de fora, como no mockup: na escolha à mão e quando nenhuma prateleira recebe a caixa. */}
      {foras.length && (modo === "escolha" || !sugestao) ? (
        <div className="flex flex-col gap-1">
          {foras.map((texto) => (
            <p key={texto} className="text-xs text-muted-foreground">
              {texto}
            </p>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function Movida({ resultado, hrefDaEtiqueta, onOutraCaixa }: { resultado: ResultadoDoMover; hrefDaEtiqueta: string; onOutraCaixa: () => void }) {
  return (
    <section role="status" className="flex flex-col gap-3 rounded-lg border border-success-soft-border bg-success-soft p-5 text-success-soft-foreground">
      <p className="flex items-center gap-2 text-xl font-extrabold">
        <Check className="size-5" aria-hidden="true" />
        {`${resultado.box_code} em ${resultado.to_location_id}`}
      </p>
      <p className="text-sm">{textoDaMovida(resultado)}</p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button asChild className="max-md:min-h-12">
          <Link href={hrefDaEtiqueta}>
            <Printer className="size-4" aria-hidden="true" />
            Imprimir etiqueta
          </Link>
        </Button>
        <Button type="button" variant="outline" className="max-md:min-h-12" onClick={onOutraCaixa}>
          Mover outra caixa
        </Button>
      </div>
    </section>
  );
}
