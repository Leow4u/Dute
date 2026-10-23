import type { ReactNode } from "react";
import { Link } from "wouter";
import { MapPin, Truck, Users } from "lucide-react";

import { COR_DO_STATUS, ROTULO_DO_STATUS, selo } from "@/components/operacao/partes";
import { Button } from "@/components/ui/button";
import { hrefDaOsNoCampo } from "@/lib/campo/navegacao";
import type { CartaoDoCampo, MinhasOs } from "@/lib/campo/os-no-campo";
import { cn } from "@/lib/utils";

/**
 * Campo › Minhas OS (parte 3.8b; docs/mockups/Campo2Hoje.dc.html): agora,
 * depois e feito, no celular. Só apresentação: a lista chega por props
 * (pages/campo/hoje.tsx). Sem legenda e sem valor.
 */

export type EstadoDoCampo = "carregando" | "erro" | "pronto";

function Secao({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section aria-label={titulo} className="flex flex-col gap-2.5">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{titulo}</h2>
      {children}
    </section>
  );
}

function CartaoAgora({ cartao }: { cartao: CartaoDoCampo }) {
  return (
    <article className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold tabular-nums text-muted-foreground">OS {cartao.numero}</span>
        <span className={cn(selo, COR_DO_STATUS[cartao.status])}>{ROTULO_DO_STATUS[cartao.status]}</span>
      </div>
      <div className="flex flex-col">
        <span className="text-lg font-bold leading-snug text-foreground">{cartao.cliente}</span>
        <span className="text-sm text-muted-foreground">{[cartao.servicos, `Demanda ${cartao.demanda}`].filter(Boolean).join(" · ")}</span>
      </div>
      <div className="flex items-start gap-2.5">
        <MapPin aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="flex min-w-0 flex-col">
          <span className="text-sm font-semibold text-foreground">{cartao.quando}</span>
          {cartao.local ? <span className="text-sm text-foreground">{cartao.local}</span> : null}
          {cartao.destino ? <span className="text-sm text-muted-foreground">Destino {cartao.destino}</span> : null}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Users aria-hidden="true" className="size-4" />
          Equipe {cartao.equipe}
        </span>
        {cartao.placas.map((placa) => (
          <span key={placa} className="flex items-center gap-1.5">
            <Truck aria-hidden="true" className="size-4" />
            {placa}
          </span>
        ))}
      </div>
      <Button asChild size="lg" className="w-full">
        <Link href={hrefDaOsNoCampo(cartao.numero)}>{cartao.status === "em_execucao" ? "Continuar OS" : "Abrir OS"}</Link>
      </Button>
    </article>
  );
}

function LinhaCurta({ cartao, data }: { cartao: CartaoDoCampo; data: string }) {
  return (
    <Link
      href={hrefDaOsNoCampo(cartao.numero)}
      className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
    >
      <span className="flex w-14 shrink-0 flex-col items-center">
        <span className="text-xs text-muted-foreground">{data}</span>
        {cartao.hora ? <span className="text-base font-bold tabular-nums text-foreground">{cartao.hora}</span> : null}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-semibold text-foreground">
          {cartao.cliente} · OS {cartao.numero}
        </span>
        <span className="truncate text-sm text-muted-foreground">{[cartao.local, cartao.servicos].filter(Boolean).join(" · ")}</span>
      </span>
    </Link>
  );
}

export function CampoHojeView({ estado, dia, ola, lista }: { estado: EstadoDoCampo; dia: string; ola: string; lista: MinhasOs }) {
  const vazio = !lista.agora.length && !lista.depois.length && !lista.feito.length;
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col">
        <span className="text-sm text-muted-foreground">{dia}</span>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{ola}</h1>
      </header>
      {estado === "carregando" ? <p className="text-sm text-muted-foreground">Carregando</p> : null}
      {estado === "erro" ? (
        <p role="alert" className="text-sm text-destructive">
          Não foi possível carregar suas OS.
        </p>
      ) : null}
      {estado === "pronto" && vazio ? <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">Nenhuma OS para você</p> : null}
      {estado === "pronto" && lista.agora.length ? (
        <Secao titulo="Agora">
          {lista.agora.map((cartao) => (
            <CartaoAgora key={cartao.numero} cartao={cartao} />
          ))}
        </Secao>
      ) : null}
      {estado === "pronto" && lista.depois.length ? (
        <Secao titulo="Depois">
          {lista.depois.map((cartao) => (
            <LinhaCurta key={cartao.numero} cartao={cartao} data={cartao.quando} />
          ))}
        </Secao>
      ) : null}
      {estado === "pronto" && lista.feito.length ? (
        <Secao titulo="Feito">
          {lista.feito.map((cartao) => (
            <LinhaCurta key={cartao.numero} cartao={{ ...cartao, hora: null }} data={cartao.quando} />
          ))}
        </Secao>
      ) : null}
    </div>
  );
}
