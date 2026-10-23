import { ClipboardList, Package, Truck, Wrench, type LucideIcon } from "lucide-react";

import { dataDaTv, horaDaTv, type CartaoDaTv, type IconeDaOs, type PainelDaTv, type TomDoSelo } from "@/lib/tv/quadro";
import { cn } from "@/lib/utils";

/**
 * A TV da sala de operações (parte 3.12b; docs/mockups/TVSala.dc.html):
 * tela cheia, escura, sem menu, sem botão e sem link. O relógio, os
 * indicadores, as três colunas e a hora da última leitura. Só rótulos e
 * dados; nunca valor.
 */

export type EstadoDaTv = "carregando" | "pronto" | "erro";

export type TvViewProps = {
  estado: EstadoDaTv;
  painel: PainelDaTv | null;
  agora: Date;
  /** Quando o quadro foi montado no servidor (a última leitura que deu certo). */
  atualizadoEm: string | null;
  /** A última releitura falhou: a TV segue com o quadro anterior. */
  semConexao: boolean;
  /** Quantos cartões cabem em cada coluna; o resto vira "+ 3 OS". */
  porColuna: number;
  basePath: string;
};

const ICONE: Record<IconeDaOs, LucideIcon> = { transporte: Truck, montagem: Wrench, armazenagem: Package, vistoria: ClipboardList };

const TOM: Record<TomDoSelo, string> = {
  critico: "border-destructive-soft-border bg-destructive-soft text-destructive-soft-foreground",
  alerta: "border-amber-soft-border bg-amber-soft text-amber-soft-foreground",
  ok: "border-success-soft-border bg-success-soft text-success-soft-foreground",
};

type Coluna = { chave: "agendadas" | "emExecucao" | "concluidas"; titulo: string; ponto: string; contador: string };

const COLUNAS: readonly Coluna[] = [
  { chave: "agendadas", titulo: "Agendadas hoje", ponto: "bg-violet-soft-foreground", contador: "bg-violet-soft text-violet-soft-foreground" },
  { chave: "emExecucao", titulo: "Em execução", ponto: "bg-amber-soft-foreground", contador: "bg-amber-soft text-amber-soft-foreground" },
  { chave: "concluidas", titulo: "Concluídas hoje", ponto: "bg-success-soft-foreground", contador: "bg-success-soft text-success-soft-foreground" },
];

function Indicador({ rotulo, valor, tom }: { rotulo: string; valor: string; tom?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-1 flex-col gap-1 rounded-xl border bg-card px-6 py-3", tom ?? "border-border")}>
      <dt className="text-lg font-bold text-muted-foreground">{rotulo}</dt>
      <dd className="truncate text-5xl font-extrabold tabular-nums leading-tight text-foreground">{valor}</dd>
    </div>
  );
}

function Progresso({ feitas, previstas, atrasada }: { feitas: number; previstas: number; atrasada: boolean }) {
  return (
    <div aria-hidden="true" className="flex min-w-0 flex-1 gap-1.5">
      {Array.from({ length: previstas }, (_, i) => (
        <span
          key={i}
          className={cn(
            "h-1.5 flex-1 rounded-full",
            i < feitas ? "bg-success-soft-foreground" : i === feitas ? (atrasada ? "bg-destructive" : "bg-amber-soft-foreground") : "bg-muted",
          )}
        />
      ))}
    </div>
  );
}

function Cartao({ cartao }: { cartao: CartaoDaTv }) {
  const Icone = ICONE[cartao.icone];
  return (
    <li className={cn("flex flex-col gap-1.5 rounded-xl border bg-card px-5 py-3.5", cartao.atrasada ? "border-destructive-soft-border" : "border-border")}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-3xl font-extrabold tabular-nums tracking-tight text-foreground">{cartao.hora}</span>
        {cartao.selo ? (
          <span className={cn("inline-flex h-8 shrink-0 items-center rounded-lg border px-3 text-base font-extrabold", TOM[cartao.selo.tom])}>{cartao.selo.texto}</span>
        ) : (
          <span className="text-base font-bold text-muted-foreground">OS {cartao.numero}</span>
        )}
      </div>
      <p className="truncate text-2xl font-extrabold text-foreground">{cartao.cliente}</p>
      <p className="flex min-w-0 items-center gap-2 text-lg text-foreground/80">
        <Icone aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
        <span className="truncate">{cartao.descricao}</span>
      </p>
      {cartao.progresso || cartao.etapa ? (
        <div className="flex items-center gap-4">
          {cartao.progresso ? <Progresso feitas={cartao.progresso.feitas} previstas={cartao.progresso.previstas} atrasada={cartao.atrasada} /> : null}
          {cartao.etapa ? <p className="shrink-0 text-base font-semibold text-muted-foreground">{cartao.etapa}</p> : null}
        </div>
      ) : null}
      <div className="flex items-center justify-between gap-3 border-t border-border pt-1.5 text-base text-foreground/80">
        {cartao.equipe ? (
          <span className="flex min-w-0 items-center gap-2.5">
            <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-extrabold text-foreground">
              {cartao.iniciais}
            </span>
            <span className="truncate">{cartao.equipe}</span>
          </span>
        ) : (
          <span className="text-muted-foreground">Sem equipe</span>
        )}
        {cartao.placa ? <span className="shrink-0 tabular-nums">{cartao.placa}</span> : null}
      </div>
      {cartao.selo ? <span className="sr-only">OS {cartao.numero}</span> : null}
    </li>
  );
}

function ColunaDoQuadro({ coluna, cartoes, porColuna }: { coluna: Coluna; cartoes: CartaoDaTv[]; porColuna: number }) {
  const visiveis = cartoes.slice(0, porColuna);
  const resto = cartoes.length - visiveis.length;
  const id = `tv-${coluna.chave}`;
  return (
    <section aria-labelledby={id} className="flex min-h-0 min-w-0 flex-1 flex-col gap-3.5">
      <div className="flex items-center justify-between px-1.5">
        <h2 id={id} className="flex items-center gap-3 text-2xl font-extrabold text-foreground">
          <span aria-hidden="true" className={cn("size-3 rounded-full", coluna.ponto)} />
          {coluna.titulo}
        </h2>
        <span className={cn("inline-flex h-9 min-w-9 items-center justify-center rounded-full px-2.5 text-lg font-extrabold tabular-nums", coluna.contador)}>{cartoes.length}</span>
      </div>
      {visiveis.length ? (
        <ul className="flex min-h-0 flex-col gap-3.5 overflow-hidden">
          {visiveis.map((cartao) => (
            <Cartao key={cartao.numero} cartao={cartao} />
          ))}
        </ul>
      ) : (
        <p className="rounded-xl border border-dashed border-border px-5 py-6 text-lg text-muted-foreground">Nenhuma OS</p>
      )}
      {resto > 0 ? <p className="px-1.5 text-lg font-bold text-muted-foreground">+ {resto} OS</p> : null}
    </section>
  );
}

export function TvView({ estado, painel, agora, atualizadoEm, semConexao, porColuna, basePath }: TvViewProps) {
  return (
    <main className="flex h-dvh flex-col gap-5 overflow-hidden bg-background px-11 pb-6 pt-8 text-foreground">
      <header className="flex items-center justify-between gap-8">
        <div className="flex items-center gap-6">
          <img src={`${basePath}/dutelog-logo-light.png`} alt="Dutelog Soluções Logísticas" className="h-11 w-auto" />
          <span aria-hidden="true" className="h-11 w-px bg-border" />
          <h1 className="text-3xl font-extrabold">Sala de Operações</h1>
        </div>
        <div className="flex items-center gap-7">
          <span className="text-2xl font-bold text-muted-foreground">{dataDaTv(agora)}</span>
          <time dateTime={agora.toISOString()} className="text-6xl font-extrabold leading-none tracking-tight tabular-nums">
            {horaDaTv(agora)}
          </time>
        </div>
      </header>

      {estado === "carregando" ? (
        <p className="flex flex-1 items-center justify-center text-3xl font-bold text-muted-foreground">Carregando</p>
      ) : !painel ? (
        <p role="alert" className="flex flex-1 items-center justify-center text-3xl font-bold text-destructive-soft-foreground">
          Não foi possível carregar o quadro.
        </p>
      ) : (
        <>
          <dl className="flex gap-4">
            <Indicador rotulo="OS hoje" valor={String(painel.indicadores.total)} />
            <Indicador rotulo="Agendadas" valor={String(painel.indicadores.agendadas)} tom="border-violet-soft-border" />
            <Indicador rotulo="Em execução" valor={String(painel.indicadores.emExecucao)} tom="border-amber-soft-border" />
            <Indicador rotulo="Concluídas" valor={String(painel.indicadores.concluidas)} tom="border-success-soft-border" />
            <Indicador rotulo="Atrasadas" valor={String(painel.indicadores.atrasadas)} tom="border-destructive-soft-border" />
            <div className="flex min-w-0 flex-[2.6] flex-col gap-1 rounded-xl border border-border bg-card px-6 py-3">
              <dt className="text-lg font-bold text-muted-foreground">Próxima saída</dt>
              <dd className="flex min-w-0 items-baseline gap-3 leading-tight">
                {painel.proximaSaida ? (
                  <>
                    <span className="text-5xl font-extrabold tabular-nums">{painel.proximaSaida.hora}</span>
                    <span className="truncate text-2xl font-extrabold">{painel.proximaSaida.cliente}</span>
                  </>
                ) : (
                  <span className="text-5xl font-extrabold">Nenhuma</span>
                )}
              </dd>
            </div>
          </dl>
          <div className="flex min-h-0 flex-1 gap-5">
            {COLUNAS.map((coluna) => (
              <ColunaDoQuadro key={coluna.chave} coluna={coluna} cartoes={painel[coluna.chave]} porColuna={porColuna} />
            ))}
          </div>
        </>
      )}

      <footer className="flex items-center border-t border-border pt-2 text-lg text-muted-foreground">
        {atualizadoEm ? (
          <span className="flex items-center gap-2.5">
            <span aria-hidden="true" className={cn("size-2.5 rounded-full", semConexao ? "bg-destructive" : "bg-success-soft-foreground")} />
            {semConexao ? `Sem conexão · atualizado às ${horaDaTv(atualizadoEm)}` : `Atualizado às ${horaDaTv(atualizadoEm)}`}
          </span>
        ) : null}
      </footer>
    </main>
  );
}
