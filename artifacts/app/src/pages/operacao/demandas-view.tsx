import { Link } from "wouter";
import { Plus, Search } from "lucide-react";

import { Filtro, SeloDoTipo, type OpcaoDeFiltro } from "@/components/operacao/partes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ETAPAS_NA_OPERACAO,
  ETAPA_NA_OPERACAO_ROTULO,
  type EtapaNaOperacao,
  type FiltrosDeDemandas,
  type LinhaDeDemanda,
} from "@/lib/operacao/demandas";
import { ENTRADAS_DA_DEMANDA, ENTRADA_ROTULO, TIPOS_DA_DEMANDA, TIPO_ROTULO, entradaNaTela } from "@/lib/operacao/hoje";
import { ROTA_NOVA_DEMANDA, hrefDaDemanda } from "@/lib/operacao/navegacao";
import { cn } from "@/lib/utils";

/**
 * Operação › Demandas (docs/plataforma/fase-3-operacao.md, parte 3.5b;
 * docs/mockups/OpDemandas.dc.html): todas as demandas, a etapa vista pela
 * Operação, as OS e o próximo passo. Tabela no desktop, cartões no celular.
 * Só apresentação; sem legenda e sem valor.
 */

export type EstadoDasDemandas = "carregando" | "erro" | "pronto";

const COR_DA_ETAPA: Record<EtapaNaOperacao, string> = {
  no_comercial: "bg-muted-foreground",
  aguardando_cliente: "bg-info-soft-foreground",
  para_planejar: "bg-foreground",
  para_agendar: "bg-info-soft-foreground",
  agendada: "bg-violet-soft-foreground",
  em_execucao: "bg-amber-soft-foreground",
  em_revisao: "bg-teal-soft-foreground",
  execucao_a_orcar: "bg-amber-soft-foreground",
  a_faturar: "bg-success-soft-foreground",
  faturada: "bg-success-soft-foreground",
  paga: "bg-success-soft-foreground",
  perdida: "bg-muted-foreground",
  cancelada: "bg-muted-foreground",
};

export function Etapa({ etapa }: { etapa: EtapaNaOperacao }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm font-medium text-foreground">
      <span aria-hidden="true" className={cn("size-2 rounded-full", COR_DA_ETAPA[etapa])} />
      {ETAPA_NA_OPERACAO_ROTULO[etapa]}
    </span>
  );
}

/** "Nenhuma OS", "1 OS · para agendar", "3 OS · 1 em execução": o resumo da coluna OS fora da tabela. */
export function osComRotulo(resumo: string): string {
  return resumo === "Nenhuma" ? "Nenhuma OS" : resumo.replace(/^(\d+) · /, "$1 OS · ");
}

function Proximo({ linha }: { linha: LinhaDeDemanda }) {
  if (linha.prazo) {
    return (
      <span className={cn("text-sm", linha.prazo.atrasada ? "font-semibold text-destructive" : "text-foreground")}>
        {[linha.proximo, linha.prazo.texto, linha.prazo.falta].filter(Boolean).join(" · ")}
      </span>
    );
  }
  return <span className="text-sm text-foreground">{linha.proximo ?? "—"}</span>;
}

export function DemandasView({
  estado,
  resumo,
  linhas,
  filtros,
  clientes,
  busca,
  onBusca,
  onFiltros,
}: {
  estado: EstadoDasDemandas;
  resumo: string;
  linhas: readonly LinhaDeDemanda[];
  filtros: FiltrosDeDemandas;
  clientes: readonly OpcaoDeFiltro[];
  busca: string;
  onBusca: (busca: string) => void;
  onFiltros: (filtros: FiltrosDeDemandas) => void;
}) {
  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-4">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Demandas</h1>
          {estado === "pronto" ? <p className="text-sm font-medium text-muted-foreground">{resumo}</p> : null}
        </div>
        <div className="flex w-full flex-col gap-3 sm:flex-row lg:w-auto">
          <label className="relative block w-full lg:w-80">
            <span className="sr-only">Buscar demanda, OS ou cliente</span>
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input type="search" value={busca} placeholder="Buscar demanda, OS ou cliente" className="pl-9" onChange={(event) => onBusca(event.target.value)} />
          </label>
          <Button asChild className="shrink-0">
            <Link href={ROTA_NOVA_DEMANDA}>
              <Plus aria-hidden="true" className="size-4" />
              Nova demanda
            </Link>
          </Button>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <Filtro
          rotulo="Tipo"
          todos="Todos os tipos"
          valor={filtros.tipo}
          opcoes={TIPOS_DA_DEMANDA.map((tipo) => ({ valor: tipo, rotulo: TIPO_ROTULO[tipo] }))}
          onChange={(valor) => onFiltros({ ...filtros, tipo: valor as FiltrosDeDemandas["tipo"] })}
        />
        <Filtro
          rotulo="Entrada"
          todos="Todas as entradas"
          valor={filtros.entrada}
          opcoes={ENTRADAS_DA_DEMANDA.map((entrada) => ({ valor: entrada, rotulo: ENTRADA_ROTULO[entrada] }))}
          onChange={(valor) => onFiltros({ ...filtros, entrada: valor as FiltrosDeDemandas["entrada"] })}
        />
        <Filtro rotulo="Cliente" todos="Todos os clientes" valor={filtros.cliente} opcoes={clientes} onChange={(valor) => onFiltros({ ...filtros, cliente: valor })} />
        <Filtro
          rotulo="Etapa"
          todos="Todas as etapas"
          valor={filtros.etapa}
          opcoes={ETAPAS_NA_OPERACAO.map((etapa) => ({ valor: etapa, rotulo: ETAPA_NA_OPERACAO_ROTULO[etapa] }))}
          onChange={(valor) => onFiltros({ ...filtros, etapa: valor as FiltrosDeDemandas["etapa"] })}
        />
      </div>

      {estado === "carregando" ? <p className="text-sm text-muted-foreground">Carregando</p> : null}
      {estado === "erro" ? (
        <p role="alert" className="text-sm text-destructive">
          Não foi possível carregar as demandas.
        </p>
      ) : null}
      {estado === "pronto" && linhas.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">Nenhuma demanda</p>
      ) : null}

      {estado === "pronto" && linhas.length > 0 ? (
        <>
          <div className="hidden overflow-hidden rounded-lg border border-border bg-card lg:block">
            <table className="w-full text-left">
              <thead className="border-b border-border text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th scope="col" className="px-5 py-3">Demanda</th>
                  <th scope="col" className="px-3 py-3">Cliente</th>
                  <th scope="col" className="px-3 py-3">Tipo</th>
                  <th scope="col" className="px-3 py-3">Entrada</th>
                  <th scope="col" className="px-3 py-3">Etapa</th>
                  <th scope="col" className="px-3 py-3">OS</th>
                  <th scope="col" className="px-5 py-3">Próximo</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((linha) => (
                  <tr key={linha.demanda.numero} className="border-t border-border first:border-t-0 hover:bg-surface-hover">
                    <td className="px-5 py-3.5 align-top">
                      <Link href={hrefDaDemanda(linha.demanda.numero)} className="text-sm font-semibold tabular-nums text-foreground underline-offset-4 hover:underline">
                        {linha.demanda.numero}
                      </Link>
                      {linha.demanda.titulo ? <p className="max-w-xs text-sm text-muted-foreground">{linha.demanda.titulo}</p> : null}
                    </td>
                    <td className="px-3 py-3.5 align-top text-sm text-foreground">{linha.cliente}</td>
                    <td className="px-3 py-3.5 align-top">
                      <SeloDoTipo tipo={linha.demanda.tipo} />
                    </td>
                    <td className="px-3 py-3.5 align-top text-sm text-foreground">{ENTRADA_ROTULO[entradaNaTela(linha.demanda)]}</td>
                    <td className="px-3 py-3.5 align-top">
                      <Etapa etapa={linha.etapa} />
                    </td>
                    <td className="px-3 py-3.5 align-top text-sm tabular-nums text-foreground">{linha.os}</td>
                    <td className="px-5 py-3.5 align-top">
                      <Proximo linha={linha} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="flex flex-col gap-3 lg:hidden">
            {linhas.map((linha) => (
              <li key={linha.demanda.numero}>
                <Link href={hrefDaDemanda(linha.demanda.numero)} className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4 hover:bg-surface-hover">
                  <span className="flex items-start justify-between gap-2">
                    <SeloDoTipo tipo={linha.demanda.tipo} />
                    <span className="text-sm font-semibold tabular-nums text-muted-foreground">{linha.demanda.numero}</span>
                  </span>
                  <span className="text-base font-semibold text-foreground">{linha.cliente}</span>
                  {linha.demanda.titulo ? <span className="text-sm text-muted-foreground">{linha.demanda.titulo}</span> : null}
                  <span className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
                    <Etapa etapa={linha.etapa} />
                    <span className="text-sm tabular-nums text-muted-foreground">
                      {ENTRADA_ROTULO[entradaNaTela(linha.demanda)]} · {osComRotulo(linha.os)}
                    </span>
                  </span>
                  {linha.proximo || linha.prazo ? <Proximo linha={linha} /> : null}
                </Link>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
