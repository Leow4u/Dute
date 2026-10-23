import { Fragment, useId, useState } from "react";
import { Link } from "wouter";
import { ChevronDown, ChevronLeft, ChevronRight, Clock, Plus, Search, Truck, UserPlus, X } from "lucide-react";

import { PainelDaEscala, type EscalaAberta } from "@/components/operacao/escala";
import { Avatar, COR_DO_STATUS, SeloDoTipo, rotuloDoStatusDaOs, selo, seloAlerta } from "@/components/operacao/partes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { resumoDoDiaEmPartes, type Agenda, type DiaDaAgenda, type GrupoDaAgenda, type OsNaAgenda, type ParteDoResumo } from "@/lib/operacao/agenda";
import { ROTA_NOVA_DEMANDA, hrefDaDemanda, hrefDaFichaDaOs } from "@/lib/operacao/navegacao";
import { cn } from "@/lib/utils";

/**
 * Operação › Agenda (docs/plataforma/fase-3-operacao.md, parte 3.6b;
 * docs/mockups/OpAgenda.dc.html): a semana com uma linha por pessoa e por
 * veículo, as OS de cada um em cada dia, e acima as OS agendadas sem equipe.
 * Escolher uma OS acende ela em todas as linhas e mostra o resumo. Só
 * apresentação: os dados e as ações chegam por props (pages/operacao/agenda.tsx).
 * Sem legenda e sem valor.
 */

export type EstadoDaAgenda = "carregando" | "erro" | "pronto";

export type NavegacaoDaSemana = { anterior: string; proxima: string; hoje: string; ehEstaSemana: boolean };

function SemEquipe({ ordens, onEscalar }: { ordens: readonly OsNaAgenda[]; onEscalar: (numero: string) => void }) {
  const id = useId();
  if (!ordens.length) return null;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h2 id={id} className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <span aria-hidden="true" className="size-2 rounded-full bg-amber-soft-foreground" />
        Sem equipe
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold tabular-nums text-foreground">{ordens.length}</span>
      </h2>
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {ordens.map((os) => (
          <li key={os.numero} className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
            <div className="flex items-start justify-between gap-2">
              {os.tipo ? <SeloDoTipo tipo={os.tipo} /> : <span />}
              <span className="text-sm font-semibold tabular-nums text-muted-foreground">OS {os.numero}</span>
            </div>
            <p className="text-base font-semibold leading-snug text-foreground">{os.cliente}</p>
            {os.titulo ? <p className="text-sm text-muted-foreground">{os.titulo}</p> : null}
            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
              <span className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                <Clock aria-hidden="true" className="size-4 shrink-0" />
                {os.quando}
              </span>
              <Button type="button" size="sm" variant="outline" className="ml-auto" onClick={() => onEscalar(os.numero)}>
                <UserPlus aria-hidden="true" className="size-4" />
                Escalar
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ResumoDoDia({ partes }: { partes: readonly ParteDoResumo[] }) {
  return partes.map((parte, indice) => (
    <Fragment key={parte.texto}>
      {indice ? " · " : null}
      <span className={parte.alerta ? "font-semibold text-amber-soft-foreground" : undefined}>{parte.texto}</span>
    </Fragment>
  ));
}

function SeloHoje() {
  return <span className="rounded-full bg-foreground px-1.5 py-0.5 text-xs font-bold text-background">Hoje</span>;
}

/** No celular, um dia embaixo do outro, com tudo da OS à vista. */
function ListaPorDia({ agenda, vazio, onEscalar }: { agenda: Agenda; vazio: string; onEscalar: (numero: string) => void }) {
  const dias = agenda.dias.filter((dia) => agenda.porDia[dia.data]?.length);
  if (!dias.length) return <p className="px-4 py-6 text-center text-sm text-muted-foreground">{vazio}</p>;
  return (
    <ol className="flex flex-col">
      {dias.map((dia) => (
        <li key={dia.data} className={cn("flex flex-col gap-2 border-t border-border/60 px-4 py-3 first:border-t-0", dia.hoje ? "bg-muted/40" : null)}>
          <h3 className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-bold text-foreground">
            {dia.rotulo}
            {dia.hoje ? <SeloHoje /> : null}
            <span className="text-xs font-medium text-muted-foreground">
              <ResumoDoDia partes={resumoDoDiaEmPartes(agenda.resumo[dia.data])} />
            </span>
          </h3>
          <ul className="flex flex-col gap-2">
            {agenda.porDia[dia.data].map((os) => (
              <li key={os.numero} className="flex flex-col gap-1.5 rounded-md border border-border bg-card p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={cn(selo, COR_DO_STATUS[os.status])}>{rotuloDoStatusDaOs({ status: os.status, tipo: os.vistoria ? "vistoria" : "servico" })}</span>
                  <Link href={hrefDaFichaDaOs(os.numero)} className="rounded font-bold tabular-nums text-foreground underline-offset-4 hover:underline">
                    OS {os.numero}
                  </Link>
                  {os.janela ? <span className="ml-auto font-semibold tabular-nums text-foreground">{os.janela}</span> : null}
                </div>
                <p className="font-semibold text-foreground">{os.cliente}</p>
                {os.equipe.length ? <p className="text-muted-foreground">{os.equipe.join(", ")}</p> : <span className={cn(selo, seloAlerta, "self-start")}>Sem equipe</span>}
                {os.placas.length ? (
                  <p className="flex items-center gap-1.5 text-muted-foreground">
                    <Truck aria-hidden="true" className="size-4" />
                    {os.placas.join(" · ")}
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-2 pt-1">
                  {os.status === "agendada" ? (
                    <Button type="button" size="sm" variant="outline" onClick={() => onEscalar(os.numero)}>
                      {os.equipe.length ? "Reagendar" : "Escalar"}
                    </Button>
                  ) : null}
                  <Button asChild size="sm" variant="outline">
                    <Link href={hrefDaDemanda(os.demanda)}>Demanda {os.demanda}</Link>
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}

function Selecao({ os, onEscalar, onFechar }: { os: OsNaAgenda; onEscalar: (numero: string) => void; onFechar: () => void }) {
  return (
    <div role="region" aria-label={`OS ${os.numero}`} className="mx-4 mb-4 hidden flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm sm:flex">
      <span className={cn(selo, COR_DO_STATUS[os.status])}>{rotuloDoStatusDaOs({ status: os.status, tipo: os.vistoria ? "vistoria" : "servico" })}</span>
      <span className="font-bold tabular-nums text-foreground">OS {os.numero}</span>
      <span className="font-semibold text-foreground">{os.cliente}</span>
      {os.titulo ? <span className="text-foreground">{os.titulo}</span> : null}
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <Clock aria-hidden="true" className="size-4" />
        {os.quando}
      </span>
      {os.equipe.length ? <span className="text-muted-foreground">{os.equipe.join(", ")}</span> : <span className={cn(selo, seloAlerta)}>Sem equipe</span>}
      {os.placas.length ? (
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <Truck aria-hidden="true" className="size-4" />
          {os.placas.join(" · ")}
        </span>
      ) : null}
      <span className="ml-auto flex items-center gap-2">
        {os.status === "agendada" ? (
          <Button type="button" size="sm" variant="outline" onClick={() => onEscalar(os.numero)}>
            Reagendar
          </Button>
        ) : null}
        <Button asChild size="sm">
          <Link href={hrefDaFichaDaOs(os.numero)}>Abrir OS</Link>
        </Button>
        <Button asChild size="sm" variant="outline">
          <Link href={hrefDaDemanda(os.demanda)}>Demanda {os.demanda}</Link>
        </Button>
        <Button type="button" size="icon" variant="ghost" className="size-8" aria-label="Fechar seleção" onClick={onFechar}>
          <X aria-hidden="true" className="size-4" />
        </Button>
      </span>
    </div>
  );
}

function Bloco({ os, selecionada, onSelecionar }: { os: OsNaAgenda; selecionada: string | null; onSelecionar: (numero: string | null) => void }) {
  const ativa = selecionada === os.numero;
  return (
    <button
      type="button"
      aria-pressed={ativa}
      onClick={() => onSelecionar(ativa ? null : os.numero)}
      className={cn(
        "flex w-full min-w-0 flex-col items-start rounded-md border border-l-4 px-2 py-1 text-left transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
        COR_DO_STATUS[os.status],
        ativa ? "ring-2 ring-foreground" : selecionada ? "opacity-60" : null,
      )}
    >
      <span className="text-xs font-bold tabular-nums">
        OS {os.numero}
        <span className="sr-only"> · {rotuloDoStatusDaOs({ status: os.status, tipo: os.vistoria ? "vistoria" : "servico" })}</span>
      </span>
      <span className="w-full truncate text-xs font-medium">{[os.cliente, os.janela].filter(Boolean).join(" · ")}</span>
    </button>
  );
}

function Grupo({
  grupo,
  dias,
  veiculos,
  selecionada,
  onSelecionar,
}: {
  grupo: GrupoDaAgenda;
  dias: readonly DiaDaAgenda[];
  veiculos: boolean;
  selecionada: string | null;
  onSelecionar: (numero: string | null) => void;
}) {
  const [aberto, setAberto] = useState(true);
  return (
    <tbody>
      <tr>
        <th colSpan={dias.length + 1} scope="colgroup" className="border-t border-border bg-muted p-0 text-left">
          <button
            type="button"
            aria-expanded={aberto}
            onClick={() => setAberto(!aberto)}
            className="sticky left-0 flex h-9 items-center gap-2 px-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40"
          >
            <ChevronDown aria-hidden="true" className={cn("size-4 transition-transform", aberto ? null : "-rotate-90")} />
            {grupo.titulo}
            <span className="rounded-full bg-background px-2 py-0.5 text-xs font-semibold tabular-nums text-foreground">{grupo.linhas.length}</span>
          </button>
        </th>
      </tr>
      {aberto
        ? grupo.linhas.map((linha) => (
            <tr key={linha.id} className="border-t border-border/60">
              <th scope="row" className="sticky left-0 z-10 bg-card px-4 py-2 text-left font-normal">
                <span className="flex min-w-0 items-center gap-2.5">
                  {veiculos ? (
                    <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-foreground">
                      <Truck className="size-4" />
                    </span>
                  ) : (
                    <Avatar nome={linha.nome} />
                  )}
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-foreground">{linha.nome}</span>
                    {linha.detalhe ? <span className="block truncate text-xs text-muted-foreground">{linha.detalhe}</span> : null}
                  </span>
                </span>
              </th>
              {dias.map((dia) => (
                <td key={dia.data} className={cn("border-l border-border/60 p-1.5 align-top", dia.hoje ? "bg-muted/40" : null)}>
                  <span className="flex min-w-0 flex-col gap-1">
                    {linha.fora?.[dia.data] ? (
                      <span className="block rounded-md border border-dashed border-amber-soft-border bg-amber-soft px-2 py-1 text-xs font-semibold text-amber-soft-foreground">
                        {linha.fora[dia.data]}
                      </span>
                    ) : null}
                    {(linha.dias[dia.data] ?? []).map((os) => (
                      <Bloco key={os.numero} os={os} selecionada={selecionada} onSelecionar={onSelecionar} />
                    ))}
                  </span>
                </td>
              ))}
            </tr>
          ))
        : null}
    </tbody>
  );
}

export function AgendaView({
  estado,
  agenda,
  titulo,
  semana,
  busca,
  onBusca,
  selecionada,
  onSelecionar,
  onEscalar,
  erro,
  escala,
}: {
  estado: EstadoDaAgenda;
  agenda: Agenda;
  /** "19 a 24 de outubro". */
  titulo: string;
  semana: NavegacaoDaSemana;
  busca: string;
  onBusca: (busca: string) => void;
  selecionada: string | null;
  onSelecionar: (numero: string | null) => void;
  onEscalar: (numero: string) => void;
  erro: string | null;
  escala: EscalaAberta | null;
}) {
  const idDaSemana = useId();
  const os = selecionada ? (agenda.ordens[selecionada] ?? null) : null;
  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Agenda</h1>
        <div className="flex w-full flex-col gap-3 sm:flex-row lg:w-auto">
          <label className="relative block w-full lg:w-80">
            <span className="sr-only">Buscar pessoa, placa, OS ou cliente</span>
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input type="search" value={busca} placeholder="Buscar pessoa, placa ou OS" className="pl-9" onChange={(event) => onBusca(event.target.value)} />
          </label>
          <Button asChild className="shrink-0">
            <Link href={ROTA_NOVA_DEMANDA}>
              <Plus aria-hidden="true" className="size-4" />
              Nova demanda
            </Link>
          </Button>
        </div>
      </header>

      {estado === "carregando" ? <p className="text-sm text-muted-foreground">Carregando</p> : null}
      {estado === "erro" ? (
        <p role="alert" className="text-sm text-destructive">
          Não foi possível carregar a agenda.
        </p>
      ) : null}
      {erro && !escala ? (
        <p role="alert" className="text-sm text-destructive">
          {erro}
        </p>
      ) : null}

      {estado === "pronto" ? (
        <>
          <SemEquipe ordens={agenda.semEquipe} onEscalar={onEscalar} />

          <section aria-labelledby={idDaSemana} className="rounded-xl border border-border bg-card">
            <div className="flex flex-wrap items-center gap-2 px-4 py-3">
              <Button asChild size="icon" variant="outline" className="size-9">
                <Link href={semana.anterior} aria-label="Semana anterior">
                  <ChevronLeft aria-hidden="true" className="size-4" />
                </Link>
              </Button>
              <Button asChild size="icon" variant="outline" className="size-9">
                <Link href={semana.proxima} aria-label="Próxima semana">
                  <ChevronRight aria-hidden="true" className="size-4" />
                </Link>
              </Button>
              {semana.ehEstaSemana ? null : (
                <Button asChild size="sm" variant="outline" className="h-9">
                  <Link href={semana.hoje}>Hoje</Link>
                </Button>
              )}
              <h2 id={idDaSemana} className="ml-1 text-lg font-bold text-foreground">
                {titulo}
              </h2>
            </div>

            {os ? <Selecao os={os} onEscalar={onEscalar} onFechar={() => onSelecionar(null)} /> : null}

            <div className="border-t border-border sm:hidden">
              <ListaPorDia agenda={agenda} vazio={busca.trim() ? "Nada encontrado" : "Nenhuma OS na semana"} onEscalar={onEscalar} />
            </div>
            {agenda.grupos.length ? (
              <div className="hidden overflow-x-auto border-t border-border sm:block">
                <table aria-labelledby={idDaSemana} className="w-full min-w-[56rem] table-fixed border-collapse">
                  <colgroup>
                    <col className="w-52" />
                    {agenda.dias.map((dia) => (
                      <col key={dia.data} />
                    ))}
                  </colgroup>
                  <thead>
                    <tr>
                      <td className="sticky left-0 z-10 bg-card" />
                      {agenda.dias.map((dia) => {
                        const partes = resumoDoDiaEmPartes(agenda.resumo[dia.data]);
                        return (
                          <th key={dia.data} scope="col" className={cn("border-l border-border/60 px-2.5 pb-2 pt-2.5 text-left align-top", dia.hoje ? "bg-muted/40" : null)}>
                            <span className="flex items-center gap-1.5 text-sm font-bold text-foreground">
                              {dia.rotulo}
                              {dia.hoje ? <SeloHoje /> : null}
                            </span>
                            <span className="block min-h-4 text-xs font-medium text-muted-foreground">
                              <ResumoDoDia partes={partes} />
                            </span>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  {agenda.grupos.map((grupo) => (
                    <Grupo key={grupo.titulo} grupo={grupo} dias={agenda.dias} veiculos={grupo.titulo === "Veículos"} selecionada={selecionada} onSelecionar={onSelecionar} />
                  ))}
                </table>
              </div>
            ) : (
              <p className="hidden border-t border-border px-4 py-6 text-center text-sm text-muted-foreground sm:block">
                {busca.trim() ? "Nada encontrado" : "Nenhum colaborador ou veículo ativo"}
              </p>
            )}
          </section>
        </>
      ) : null}

      <PainelDaEscala escala={escala} />
    </section>
  );
}
