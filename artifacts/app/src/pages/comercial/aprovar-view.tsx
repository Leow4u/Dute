import type { ReactNode } from "react";
import { Link } from "wouter";
import { Check, ChevronLeft, ChevronRight, FileText, Send, TriangleAlert, Undo2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { LinhaCompacta, PontoDeConferir } from "@/lib/comercial/aprovar";
import { ORIGEM_ROTULO, type EtapaDemanda } from "@/lib/comercial/orcamentos";
import { cn } from "@/lib/utils";

import { MarcaDaOrigem, SeloDaEtapa } from "./orcamentos-view";

/**
 * Aprovar no celular (docs/mockups/ComAprovarCelular.dc.html), só a
 * apresentação: os dados e as gravações chegam por props
 * (pages/comercial/aprovar.tsx). Feita para o celular e funcionando no
 * computador (coluna estreita no centro). Sem legenda: rótulos, dados e
 * ações; uma ação principal, "Aprovar", no rodapé que fica à vista.
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
  ocupado: boolean;
  aviso: string | null;
  handlers: {
    anterior: () => void;
    proximo: () => void;
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

function Rodape(props: AprovarViewProps) {
  const { confirmacao, ocupado, handlers } = props;
  return (
    <footer className="sticky bottom-0 z-10 -mx-5 -mb-5 flex flex-col gap-1.5 border-t border-border bg-card px-4 pb-5 pt-3 md:mx-0 md:mb-0 md:rounded-lg md:border">
      {confirmacao ? (
        <div className="flex min-h-13 items-center gap-2">
          <span role="status" className="inline-flex items-center gap-2 text-base font-extrabold text-success-soft-foreground">
            <Check className="size-5" aria-hidden="true" />
            {confirmacao}
          </span>
          <Button type="button" variant="outline" size="sm" className="ml-auto" onClick={handlers.proximo} disabled={!props.podeProximo}>
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
            <Button type="button" className="min-h-13 flex-1 text-base" onClick={handlers.aprovar} disabled={ocupado}>
              <Check aria-hidden="true" />
              Aprovar
            </Button>
          </div>
          <Button type="button" variant="ghost" size="sm" className="self-center" onClick={handlers.aprovarEEnviar} disabled={ocupado}>
            <Send aria-hidden="true" />
            Aprovar e enviar
          </Button>
        </>
      )}
    </footer>
  );
}

export function AprovarView(props: AprovarViewProps) {
  const { estado, posicao, cartao, aviso, handlers } = props;
  const mensagem =
    estado === "carregando"
      ? "Carregando..."
      : estado === "erro"
        ? "Não foi possível carregar os orçamentos."
        : estado === "vazio" || !cartao
          ? "Nenhum orçamento para aprovar"
          : null;
  return (
    <div className="v3 mx-auto flex w-full max-w-xl flex-col gap-3 text-foreground">
      <div className="flex items-center gap-2.5">
        <h1 className="text-xl font-extrabold tracking-tight">Para aprovar</h1>
        {posicao.total > 0 ? (
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
      {mensagem || !cartao ? (
        <p className="rounded-lg border border-border bg-card px-5 py-7 text-center text-sm font-bold text-muted-foreground">{mensagem}</p>
      ) : (
        <>
          <Cartao cartao={cartao} />
          {props.conferir.length ? <Conferir pontos={props.conferir} /> : null}
          <Linhas linhas={props.linhas} cartao={cartao} />
          <Rodape {...props} />
        </>
      )}
    </div>
  );
}
