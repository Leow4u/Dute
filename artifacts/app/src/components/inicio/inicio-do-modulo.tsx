import type { ReactNode } from "react";
import { Link } from "wouter";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { fraseDoInicio, type ItemDoInicio, type TomDoItem } from "@/lib/inicio-do-modulo";
import { formatToday, greeting } from "@/lib/saudacao";
import { cn } from "@/lib/utils";

/**
 * O Início de um módulo na v3 (docs/mockups/ModComInicio.dc.html e
 * ModOpInicio.dc.html): a data, a saudação, quantas coisas esperam a pessoa,
 * o "Precisa de você" com a ação de cada item e, ao lado, os números do
 * módulo. Sem legenda: só rótulos, dados e ações.
 */

const CAIXA_DO_TOM: Record<TomDoItem, string> = {
  critical: "border-destructive-soft-border bg-destructive-soft text-destructive-soft-foreground",
  attention: "border-warning-soft-border bg-warning-soft text-warning-soft-foreground",
  info: "border-info-soft-border bg-info-soft text-info-soft-foreground",
  agent: "border-agent-border bg-agent-soft text-agent",
};

export function TituloDaSecao({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <h2 id={id} className="px-1 text-xs font-bold uppercase tracking-widest text-muted-foreground">
      {children}
    </h2>
  );
}

/** Linha de número: ponto da cor, rótulo e o valor. */
export function LinhaDeNumero({ ponto, rotulo, valor, alerta = false }: { ponto: string; rotulo: string; valor: number; alerta?: boolean }) {
  return (
    <li className="flex items-center justify-between gap-3 border-t border-border px-5 py-3.5 first:border-t-0">
      <span className={cn("flex items-center gap-2.5 text-base font-semibold", alerta && "text-destructive-soft-foreground")}>
        <span aria-hidden="true" className={cn("size-2.5 shrink-0 rounded-full", ponto)} />
        {rotulo}
      </span>
      <span className={cn("text-2xl font-extrabold tabular-nums", alerta && "text-destructive-soft-foreground")}>{valor}</span>
    </li>
  );
}

function Linha({ item, principal }: { item: ItemDoInicio; principal: boolean }) {
  const Icone = item.icon;
  return (
    <li className="flex flex-col gap-3 border-t border-border px-5 py-4 first:border-t-0 sm:flex-row sm:items-center sm:gap-4 md:px-6">
      <div className="flex min-w-0 flex-1 items-center gap-4">
        <span className={cn("flex size-13 shrink-0 items-center justify-center rounded-lg border", CAIXA_DO_TOM[item.tone])}>
          <Icone className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="text-base font-bold text-foreground">{item.title}</p>
          {item.detail ? <p className="mt-0.5 text-sm text-muted-foreground sm:truncate">{item.detail}</p> : null}
        </div>
      </div>
      <Button asChild variant={principal ? "default" : "outline"} className="shrink-0 self-start sm:self-auto">
        <Link href={item.href}>{item.actionLabel}</Link>
      </Button>
    </li>
  );
}

export type InicioDoModuloProps = {
  nome: string;
  hoje: Date;
  /** "no Comercial", "na Operação": entra na frase de quantas coisas esperam. */
  noModulo: string;
  itens: readonly ItemDoInicio[];
  carregando: boolean;
  falhas: readonly string[];
  /** A coluna ao lado: os números do módulo. */
  lateral?: ReactNode;
};

export function InicioDoModulo({ nome, hoje, noModulo, itens, carregando, falhas, lateral }: InicioDoModuloProps) {
  const primeiroNome = nome.split(" ")[0] ?? "";
  const frase = fraseDoInicio(itens.length, noModulo);
  return (
    <div className="flex flex-col gap-7">
      <header className="flex flex-col gap-1.5">
        <p className="text-base font-semibold text-muted-foreground">{formatToday(hoje)}</p>
        <h1 className="text-4xl font-extrabold tracking-tight">
          {greeting(hoje)}
          {primeiroNome ? `, ${primeiroNome}` : ""}
        </h1>
        {carregando ? null : (
          <p className="text-lg text-muted-foreground">
            {frase.destaque ? <strong className="font-extrabold text-destructive-soft-foreground">{frase.destaque}</strong> : null}
            {frase.destaque ? " " : null}
            {frase.resto}
          </p>
        )}
      </header>

      {falhas.length ? (
        <p role="alert" className="rounded-lg border border-warning-soft-border bg-warning-soft px-4 py-3 text-sm font-semibold text-warning-soft-foreground">
          Não foi possível carregar: {falhas.join(", ")}.
        </p>
      ) : null}

      <div className="flex flex-wrap items-start gap-7">
        {carregando || itens.length ? (
          <section aria-labelledby="precisa-de-voce" className="flex min-w-0 flex-[2.2_1_560px] flex-col gap-3.5">
            <TituloDaSecao id="precisa-de-voce">Precisa de você</TituloDaSecao>
            {carregando ? (
              <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-5">
                {[0, 1, 2].map((linha) => (
                  <Skeleton key={linha} className="h-14 rounded-lg" />
                ))}
              </div>
            ) : (
              <ul className="rounded-lg border border-border bg-card">
                {itens.map((item, indice) => (
                  <Linha key={item.id} item={item} principal={indice === 0} />
                ))}
              </ul>
            )}
          </section>
        ) : null}
        {lateral ? <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-3.5">{lateral}</div> : null}
      </div>
    </div>
  );
}
