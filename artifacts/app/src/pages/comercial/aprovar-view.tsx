import type { ReactNode } from "react";
import { Link } from "wouter";
import { Check, ChevronLeft, ChevronRight, FileText, RefreshCw, Send, TriangleAlert, Undo2 } from "lucide-react";

import { BotaoDeAcao } from "@/components/ui/botao-de-acao";
import { Button } from "@/components/ui/button";
import { CarregandoNaRegiao } from "@/components/ui/carregando-na-regiao";
import { FaixaAoVivo, FalhaAoVivo } from "@/components/ui/erro-na-leitura";
import { useAnunciarAoMudar } from "@/lib/carregando/anunciador";
import { SEM_NOVA_TENTATIVA, type NovaTentativa } from "@/lib/comercial/leitura";
import type { AvisoDoCartaoParado, LinhaCompacta, PontoDeConferir } from "@/lib/comercial/aprovar";
import { ORIGEM_ROTULO, type EtapaDemanda } from "@/lib/comercial/orcamentos";
import { cn } from "@/lib/utils";

import { MarcaDaOrigem, SeloDaEtapa } from "./orcamentos-view";

/**
 * Aprovar no celular (docs/mockups/ComAprovarCelular.dc.html), só a
 * apresentação: os dados e as gravações chegam por props
 * (pages/comercial/aprovar.tsx). Feita para o celular e funcionando no
 * computador (coluna estreita no centro). Sem legenda: rótulos, dados e
 * ações; uma ação principal, "Aprovar", no rodapé que fica à vista. Com o
 * cartão parado (o orçamento saiu da fila ou mudou), o rodapé só oferece
 * Próximo ou Recarregar.
 */

export type CartaoDaAprovacao = {
  numero: string;
  rotulo: string;
  tipo: string;
  etapa: EtapaDemanda;
  titulo: string | null;
  cliente: string;
  /** "Renata Moura · Souza & Lopes": o contato e a empresa dele. */
  para: string | null;
  refCliente: string | null;
  local: string | null;
  /** "Guilherme · 20/10 16:40". */
  orcou: string;
  total: string;
  /** "LPU Itaú v2.0 · Comercial". */
  tabela: string | null;
  /** "14/10/2026". */
  dataBase: string | null;
  quantidadeDeLinhas: number;
  pdfHref: string;
  orcamentoHref: string;
};

export type AprovarViewProps = {
  estado: "carregando" | "erro" | "vazio" | "pronto";
  /** "1 de 3". */
  posicao: { indice: number; total: number };
  podeAnterior: boolean;
  podeProximo: boolean;
  cartao: CartaoDaAprovacao | null;
  conferir: PontoDeConferir[];
  linhas: LinhaCompacta[];
  /** Depois da ação: "Aprovado 17:05", "Devolvido a Guilherme". */
  confirmacao: string | null;
  /**
   * O orçamento da tela saiu da fila (ou voltou com outra edição): o cartão
   * fica parado no que a pessoa viu, e o rodapé só oferece Próximo ou
   * Recarregar (lib/comercial/aprovar.ts, avisoDoCartaoParado).
   */
  parado: AvisoDoCartaoParado | null;
  ocupado: boolean;
  /** Qual ação grava daqui: "aprovar" ou "aprovar_e_enviar" (o botão dela diz o gerúndio; parte 13g). */
  emAndamento?: "aprovar" | "aprovar_e_enviar" | null;
  /** A nova tentativa das leituras da fila (parte 13g). */
  leitura?: NovaTentativa;
  aviso: string | null;
  handlers: {
    anterior: () => void;
    proximo: () => void;
    /** O orçamento que mudou: mostra a edição nova. */
    recarregar: () => void;
    aprovar: () => void;
    devolver: () => void;
    aprovarEEnviar: () => void;
  };
};

function Pill({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-md border border-border bg-muted px-2 text-xs font-bold text-foreground",
        className,
      )}
    >
      {children}
    </span>
  );
}

function Contador({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-foreground/10 px-1.5 text-xs font-bold tabular-nums">
      {children}
    </span>
  );
}

function Cartao({ cartao }: { cartao: CartaoDaAprovacao }) {
  const campos: Array<[string, string]> = [
    ["Cliente", cartao.cliente],
    ["Para", cartao.para ?? "—"],
    ["Ref.", cartao.refCliente ?? "—"],
    ["Local", cartao.local ?? "—"],
    ["Orçou", cartao.orcou],
  ];
  return (
    <section aria-label={`Orçamento ${cartao.rotulo}`} className="flex flex-col gap-3.5 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xl font-extrabold tabular-nums">{cartao.rotulo}</span>
        <Pill>{cartao.tipo}</Pill>
        <span className="ml-auto inline-flex">
          <SeloDaEtapa etapa={cartao.etapa} />
        </span>
      </div>
      {cartao.titulo ? <h2 className="text-base font-bold leading-snug">{cartao.titulo}</h2> : null}
      <dl className="grid grid-cols-[4rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
        {campos.map(([rotulo, valor]) => (
          <div key={rotulo} className="contents">
            <dt className="font-semibold text-muted-foreground">{rotulo}</dt>
            <dd className="min-w-0 break-words font-bold">{valor}</dd>
          </div>
        ))}
      </dl>
      <div className="flex items-end gap-3 border-t border-muted pt-3">
        <div>
          <div className="text-sm font-bold text-muted-foreground">Total</div>
          <div className="text-3xl font-extrabold tabular-nums tracking-tight">{cartao.total}</div>
        </div>
        {/* "PDF", como no mockup: o documento já diz que é prévia (selo, "Prévia em" e o nome do arquivo), e no celular o rótulo longo aperta o total. */}
        <Button asChild variant="outline" size="sm" className="ml-auto">
          <Link href={cartao.pdfHref}>
            <FileText aria-hidden="true" />
            PDF
          </Link>
        </Button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Pill>{cartao.tabela ?? "Sem tabela"}</Pill>
        <Pill>{`Data-base ${cartao.dataBase ?? "—"}`}</Pill>
        <Pill>{cartao.quantidadeDeLinhas === 1 ? "1 linha" : `${cartao.quantidadeDeLinhas} linhas`}</Pill>
      </div>
    </section>
  );
}

function Conferir({ pontos }: { pontos: PontoDeConferir[] }) {
  return (
    <section aria-label="Conferir" className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex items-center gap-2.5 border-b border-muted px-4 py-3">
        <TriangleAlert className="size-4 text-amber-soft-foreground" aria-hidden="true" />
        <h2 className="text-xs font-extrabold uppercase tracking-wider">Conferir</h2>
        <Contador>{pontos.length}</Contador>
      </div>
      <ul className="divide-y divide-muted">
        {pontos.map((ponto) => (
          <li key={ponto.chave} className="flex flex-col gap-1 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              {ponto.origem ? (
                <MarcaDaOrigem origem={ponto.origem} rotulo={ponto.rotulo} />
              ) : (
                <Pill className="border-amber-soft-border bg-amber-soft text-amber-soft-foreground">{ponto.rotulo}</Pill>
              )}
              <span className="text-sm font-extrabold">{ponto.titulo}</span>
            </div>
            {ponto.valor ? (
              <div className="flex items-baseline gap-2 text-sm tabular-nums">
                <b className="font-extrabold">{ponto.valor}</b>
                {ponto.riscado ? (
                  <>
                    <s className="font-semibold text-muted-foreground">{ponto.riscado}</s>
                    <span className="text-muted-foreground">tabela</span>
                  </>
                ) : null}
              </div>
            ) : null}
            {ponto.motivo ? (
              <p className="text-sm">
                <span className="mr-1.5 font-semibold text-muted-foreground">Motivo</span>
                {ponto.motivo}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Linhas({ linhas, cartao }: { linhas: LinhaCompacta[]; cartao: CartaoDaAprovacao }) {
  return (
    <section aria-label="Linhas" className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex items-center gap-2.5 border-b border-muted px-4 py-3">
        <h2 className="text-xs font-extrabold uppercase tracking-wider">Linhas</h2>
        <Contador>{linhas.length}</Contador>
        <Link href={cartao.orcamentoHref} className="ml-auto text-sm font-bold text-info-soft-foreground underline-offset-4 hover:underline">
          Abrir orçamento
        </Link>
      </div>
      <ul className="divide-y divide-muted">
        {linhas.map((linha) => (
          <li key={linha.chave} className="flex items-start gap-3 px-4 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-bold">{linha.nome}</div>
              {linha.quantidade || linha.origem !== "tabela" ? (
                <div className="flex flex-wrap items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                  {linha.quantidade ? <span>{linha.quantidade}</span> : null}
                  {linha.origem !== "tabela" ? <MarcaDaOrigem origem={linha.origem} rotulo={ORIGEM_ROTULO[linha.origem]} /> : null}
                </div>
              ) : null}
            </div>
            <div className="flex shrink-0 flex-col items-end text-sm font-extrabold tabular-nums">
              {linha.total}
              {linha.riscado ? <s className="text-xs font-semibold text-muted-foreground">{linha.riscado}</s> : null}
            </div>
          </li>
        ))}
        <li className="flex items-center justify-between gap-3 bg-muted px-4 py-2.5 font-extrabold">
          <span>Total</span>
          <span className="tabular-nums">{cartao.total}</span>
        </li>
      </ul>
    </section>
  );
}

/**
 * A confirmação toma o lugar dos botões: o foco que estava no Aprovar vai ao
 * Próximo (ou ao Recarregar do cartão parado) e, sem ele, ao título da tela;
 * nunca ao `body` (WCAG 2.4.3).
 */
function focoDepoisDeAprovar(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[data-depois-de-aprovar]");
}

function Rodape(props: AprovarViewProps) {
  const { confirmacao, parado, ocupado, handlers } = props;
  const emAndamento = props.emAndamento ?? null;
  // O resultado e o cartão parado ficam escritos; o Anunciador os diz uma vez, sem região viva solta.
  useAnunciarAoMudar(confirmacao ?? parado?.texto ?? null);
  return (
    <footer className="sticky bottom-0 z-10 -mx-5 -mb-5 flex flex-col gap-1.5 border-t border-border bg-card px-4 pb-5 pt-3 md:mx-0 md:mb-0 md:rounded-lg md:border">
      {!confirmacao && parado ? (
        <div className="flex min-h-13 items-center gap-2">
          <span className="inline-flex items-center gap-2 text-base font-extrabold text-amber-soft-foreground">
            <TriangleAlert className="size-5 shrink-0" aria-hidden="true" />
            {parado.texto}
          </span>
          {parado.acao === "recarregar" ? (
            <Button type="button" variant="outline" size="sm" className="ml-auto" onClick={handlers.recarregar} data-depois-de-aprovar="">
              <RefreshCw aria-hidden="true" />
              Recarregar
            </Button>
          ) : (
            <Button type="button" variant="outline" size="sm" className="ml-auto" onClick={handlers.proximo} disabled={!props.podeProximo} data-depois-de-aprovar="">
              Próximo
              <ChevronRight aria-hidden="true" />
            </Button>
          )}
        </div>
      ) : confirmacao ? (
        <div className="flex min-h-13 items-center gap-2">
          <span className="inline-flex items-center gap-2 text-base font-extrabold text-success-soft-foreground">
            <Check className="size-5" aria-hidden="true" />
            {confirmacao}
          </span>
          <Button type="button" variant="outline" size="sm" className="ml-auto" onClick={handlers.proximo} disabled={!props.podeProximo} data-depois-de-aprovar="">
            Próximo
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>
      ) : (
        <>
          <div className="flex gap-2.5">
            <Button type="button" variant="outline" className="min-h-13 flex-[0_0_8.25rem] text-base" onClick={handlers.devolver} disabled={ocupado}>
              <Undo2 aria-hidden="true" />
              Devolver
            </Button>
            <BotaoDeAcao
              className="min-h-13 flex-1 text-base"
              estado={emAndamento === "aprovar" ? "andamento" : "repouso"}
              bloqueado={ocupado && emAndamento !== "aprovar"}
              icone={<Check aria-hidden="true" />}
              rotulo="Aprovar"
              andamento="Aprovando…"
              focoAoSair={focoDepoisDeAprovar}
              onClick={handlers.aprovar}
            />
          </div>
          <BotaoDeAcao
            variant="ghost"
            size="sm"
            className="self-center"
            estado={emAndamento === "aprovar_e_enviar" ? "andamento" : "repouso"}
            bloqueado={ocupado && emAndamento !== "aprovar_e_enviar"}
            icone={<Send aria-hidden="true" />}
            rotulo="Aprovar e enviar"
            andamento="Aprovando e enviando…"
            focoAoSair={focoDepoisDeAprovar}
            onClick={handlers.aprovarEEnviar}
          />
        </>
      )}
    </footer>
  );
}

export function AprovarView(props: AprovarViewProps) {
  const { estado, posicao, cartao, aviso, handlers } = props;
  const leitura = props.leitura ?? SEM_NOVA_TENTATIVA;
  const caixa = "rounded-lg border border-border bg-card px-5 py-7";
  const mensagem =
    estado === "carregando" || estado === "erro"
      ? null
      : !cartao && props.parado
          ? props.parado.texto
          : estado === "vazio" || !cartao
            ? "Nenhum orçamento para aprovar"
            : null;
  return (
    <div className="v3 mx-auto flex w-full max-w-xl flex-col gap-3 text-foreground">
      <div className="flex items-center gap-2.5">
        <h1 className="text-xl font-extrabold tracking-tight">Para aprovar</h1>
        {posicao.indice > 0 ? (
          <span className="font-bold tabular-nums text-muted-foreground">{`${posicao.indice} de ${posicao.total}`}</span>
        ) : null}
        <div className="ml-auto flex gap-1.5">
          <Button type="button" variant="outline" size="icon" aria-label="Anterior" onClick={handlers.anterior} disabled={!props.podeAnterior}>
            <ChevronLeft aria-hidden="true" />
          </Button>
          <Button type="button" variant="outline" size="icon" aria-label="Próximo" onClick={handlers.proximo} disabled={!props.podeProximo}>
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>
      </div>
      {aviso ? (
        <p
          role="alert"
          className="rounded-md border border-destructive-soft-border bg-destructive-soft px-4 py-3 text-sm font-semibold text-destructive-soft-foreground"
        >
          {aviso}
        </p>
      ) : null}
      {estado === "carregando" ? (
        <CarregandoNaRegiao rotulo="Carregando os orçamentos…" continuaARota onTentar={leitura.tentar} className={caixa} />
      ) : estado === "erro" ? (
        <FalhaAoVivo leitura={leitura} mensagem="Não foi possível carregar os orçamentos." className={caixa} />
      ) : mensagem || !cartao ? (
        <p className={cn(caixa, "text-center text-sm font-bold text-muted-foreground")}>{mensagem}</p>
      ) : (
        <>
          <FaixaAoVivo leitura={leitura} />
          <Cartao cartao={cartao} />
          {props.conferir.length ? <Conferir pontos={props.conferir} /> : null}
          <Linhas linhas={props.linhas} cartao={cartao} />
          <Rodape {...props} />
        </>
      )}
    </div>
  );
}
