import { Download, Printer } from "lucide-react";
import { Link } from "wouter";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ROTA_RELATORIOS } from "@/lib/operacao/navegacao";
import {
  RELATORIOS_DA_OPERACAO,
  RELATORIO_ROTULO,
  type FiltroDoRelatorio,
  type RelatorioDaOperacao,
  type ResumoDasOs,
  type TabelaDoRelatorio,
  type ValorDaCelula,
} from "@/lib/operacao/relatorios";
import { cn } from "@/lib/utils";

/**
 * Relatórios da Operação (parte 4.8a; docs/mockups/Relatorios.dc.html): a
 * lista dos relatórios, o período, o cliente e o agrupamento, os números do
 * período e a tabela, com Excel e PDF (a impressão do navegador). Sem valor
 * e sem legenda: só rótulos, dados e ações.
 */

export function hrefDoRelatorio(relatorio: RelatorioDaOperacao): string {
  return relatorio === "periodo" ? ROTA_RELATORIOS : `${ROTA_RELATORIOS}?relatorio=${relatorio}`;
}

export type ResumoDoRelatorio = Array<{ rotulo: string; valor: string }>;

export type RelatoriosViewProps = {
  relatorio: RelatorioDaOperacao;
  filtro: FiltroDoRelatorio;
  clientes: ReadonlyArray<{ code: string; nome: string }>;
  estado: "carregando" | "erro" | "pronto";
  /** O que falta no filtro, ou null. */
  problema: string | null;
  resumo: ResumoDoRelatorio | null;
  tabela: TabelaDoRelatorio | null;
  acoes: {
    mudarFiltro: (mudanca: Partial<FiltroDoRelatorio>) => void;
    exportar: () => void;
    imprimir: () => void;
  };
};

/** Os números do período: as OS ou as solicitações. */
export function resumoDasOsEmTexto(resumo: ResumoDasOs): ResumoDoRelatorio {
  return [
    { rotulo: "OS no período", valor: String(resumo.total) },
    { rotulo: "Concluídas", valor: String(resumo.concluidas) },
    { rotulo: "Canceladas", valor: String(resumo.canceladas) },
    { rotulo: "No prazo", valor: resumo.noPrazo === null ? "—" : `${resumo.noPrazo}%` },
  ];
}

function celulaEmTexto(celula: ValorDaCelula, coluna: string): string {
  if (celula === null) return "—";
  if (typeof celula === "number" && coluna.includes("(%)")) return `${celula}%`;
  return typeof celula === "number" ? new Intl.NumberFormat("pt-BR").format(celula) : celula;
}

function dataBr(dia: string): string {
  const [ano, mes, dd] = dia.split("-");
  return dd && mes && ano ? `${dd}/${mes}/${ano}` : dia;
}

const CAMPO_SELECT =
  "flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-sm focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25";

function Filtros({ relatorio, filtro, clientes, problema, acoes }: Pick<RelatoriosViewProps, "relatorio" | "filtro" | "clientes" | "problema" | "acoes">) {
  return (
    <div className="no-print flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="relatorio-de">De</Label>
          <Input id="relatorio-de" type="date" value={filtro.de} onChange={(event) => acoes.mudarFiltro({ de: event.target.value })} className="w-40" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="relatorio-ate">Até</Label>
          <Input id="relatorio-ate" type="date" value={filtro.ate} onChange={(event) => acoes.mudarFiltro({ ate: event.target.value })} className="w-40" />
        </div>
        <div className="grid min-w-52 gap-1.5">
          <Label htmlFor="relatorio-cliente">Cliente</Label>
          <select id="relatorio-cliente" value={filtro.cliente ?? ""} onChange={(event) => acoes.mudarFiltro({ cliente: event.target.value || null })} className={CAMPO_SELECT}>
            <option value="">Todos</option>
            {clientes.map((cliente) => (
              <option key={cliente.code} value={cliente.code}>
                {cliente.nome}
              </option>
            ))}
          </select>
        </div>
        {relatorio === "periodo" ? (
          <div className="grid gap-1.5">
            <Label htmlFor="relatorio-agrupar">Agrupar</Label>
            <select
              id="relatorio-agrupar"
              value={filtro.agrupamento}
              onChange={(event) => acoes.mudarFiltro({ agrupamento: event.target.value === "mes" ? "mes" : "semana" })}
              className={cn(CAMPO_SELECT, "w-36")}
            >
              <option value="semana">Semana</option>
              <option value="mes">Mês</option>
            </select>
          </div>
        ) : null}
      </div>
      {problema ? (
        <p role="alert" className="text-sm font-semibold text-destructive">
          {problema}
        </p>
      ) : null}
    </div>
  );
}

function Tabela({ tabela, vazio }: { tabela: TabelaDoRelatorio; vazio: string }) {
  if (!tabela.linhas.length) return <p className="rounded-lg border border-border bg-card px-5 py-6 text-sm text-muted-foreground">{vazio}</p>;
  const [primeira, ...numeros] = tabela.colunas;
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full min-w-[520px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs font-bold uppercase tracking-widest text-muted-foreground">
            <th scope="col" className="px-5 py-3 font-bold">
              {primeira}
            </th>
            {numeros.map((coluna) => (
              <th key={coluna} scope="col" className="px-5 py-3 text-right font-bold">
                {coluna}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tabela.linhas.map((linha) => (
            <tr key={linha.chave} className="border-t border-border first:border-t-0">
              {linha.celulas.map((celula, indice) =>
                indice === 0 ? (
                  <th key={indice} scope="row" className="px-5 py-3 text-left font-semibold">
                    {celulaEmTexto(celula, tabela.colunas[indice])}
                  </th>
                ) : (
                  <td key={indice} className="px-5 py-3 text-right tabular-nums">
                    {celulaEmTexto(celula, tabela.colunas[indice])}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
        {tabela.total ? (
          <tfoot>
            <tr className="border-t-2 border-border font-bold">
              {tabela.total.map((celula, indice) =>
                indice === 0 ? (
                  <th key={indice} scope="row" className="px-5 py-3 text-left">
                    {celulaEmTexto(celula, tabela.colunas[indice])}
                  </th>
                ) : (
                  <td key={indice} className="px-5 py-3 text-right tabular-nums">
                    {celulaEmTexto(celula, tabela.colunas[indice])}
                  </td>
                ),
              )}
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}

export function RelatoriosView({ relatorio, filtro, clientes, estado, problema, resumo, tabela, acoes }: RelatoriosViewProps) {
  const cliente = filtro.cliente ? (clientes.find((item) => item.code === filtro.cliente)?.nome ?? filtro.cliente) : null;
  const pronto = estado === "pronto" && !problema && tabela;
  return (
    <div className="flex flex-col gap-6">
      <header className="no-print flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-extrabold tracking-tight">Relatórios</h1>
        <div className="flex gap-2">
          <Button type="button" variant="outline" disabled={!pronto} onClick={acoes.exportar}>
            <Download aria-hidden="true" />
            Excel
          </Button>
          <Button type="button" variant="outline" disabled={!pronto} onClick={acoes.imprimir}>
            <Printer aria-hidden="true" />
            PDF
          </Button>
        </div>
      </header>

      <div className="flex flex-wrap items-start gap-6">
        <nav aria-label="Relatórios da Operação" className="no-print flex w-full flex-col gap-1 rounded-lg border border-border bg-card p-2 lg:w-60">
          {RELATORIOS_DA_OPERACAO.map((item) => (
            <Link
              key={item}
              href={hrefDoRelatorio(item)}
              aria-current={item === relatorio ? "page" : undefined}
              className={cn(
                "flex min-h-11 items-center rounded-md px-3 text-sm font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                item === relatorio ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
              )}
            >
              {RELATORIO_ROTULO[item]}
            </Link>
          ))}
        </nav>

        <div className="flex min-w-0 flex-[1_1_640px] flex-col gap-5">
          <Filtros relatorio={relatorio} filtro={filtro} clientes={clientes} problema={problema} acoes={acoes} />
          <section aria-labelledby="titulo-do-relatorio" className="print-area flex flex-col gap-5">
            <div className="flex flex-col gap-1">
              <h2 id="titulo-do-relatorio" className="text-2xl font-extrabold tracking-tight">
                {RELATORIO_ROTULO[relatorio]}
              </h2>
              <p className="text-sm font-semibold text-muted-foreground">
                {[`${dataBr(filtro.de)} a ${dataBr(filtro.ate)}`, cliente].filter(Boolean).join(" · ")}
              </p>
            </div>
            {estado === "erro" ? (
              <p role="alert" className="rounded-lg border border-destructive-soft-border bg-destructive-soft px-4 py-3 text-sm font-semibold text-destructive-soft-foreground">
                Não foi possível carregar.
              </p>
            ) : estado === "carregando" ? (
              <Skeleton className="h-64 rounded-lg" />
            ) : pronto ? (
              <>
                {resumo ? (
                  <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    {resumo.map((numero) => (
                      <div key={numero.rotulo} className="rounded-lg border border-border bg-card px-5 py-4">
                        <dt className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{numero.rotulo}</dt>
                        <dd className="mt-1 text-3xl font-extrabold tabular-nums">{numero.valor}</dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
                <Tabela tabela={tabela} vazio={relatorio === "solicitacoes" ? "Nenhuma solicitação no período." : "Nenhuma OS no período."} />
              </>
            ) : null}
          </section>
        </div>
      </div>
    </div>
  );
}
