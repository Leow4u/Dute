import type { ReactNode } from "react";
import { Download, Printer } from "lucide-react";
import { Link } from "wouter";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatarReais } from "@workspace/dominio";
import type { CelulaDoRelatorio, NumeroDoResumo, TabelaDeRelatorio } from "@/lib/relatorios";
import { cn } from "@/lib/utils";

/**
 * A tela de relatórios de um módulo (docs/mockups/Relatorios.dc.html; partes
 * 4.8a e 4.8b): a lista dos relatórios do módulo, os filtros, os números do
 * período e a tabela, com Excel e PDF (a impressão do navegador, só do
 * relatório). Sem legenda: só rótulos, dados e ações.
 */

export type { CelulaDoRelatorio, NumeroDoResumo, TabelaDeRelatorio } from "@/lib/relatorios";

export type TelaDeRelatoriosProps = {
  /** O nome da lista, para o leitor de tela ("Relatórios da Operação"). */
  rotuloDaLista: string;
  relatorios: ReadonlyArray<{ id: string; rotulo: string; href: string }>;
  atual: string;
  titulo: string;
  /** "01/10/2026 a 23/10/2026 · Itaú Unibanco". */
  subtitulo: string;
  filtros: ReactNode;
  estado: "carregando" | "erro" | "pronto";
  problema: string | null;
  resumo: readonly NumeroDoResumo[] | null;
  tabela: TabelaDeRelatorio | null;
  vazio: string;
  acoes: { exportar: () => void; imprimir: () => void };
};

/**
 * As colunas dos números do período, pela largura da tela do relatório (não da
 * janela, que inclui o menu): valor em reais pede mais espaço que uma contagem,
 * e o número não quebra no meio.
 */
export function colunasDoResumo(resumo: readonly NumeroDoResumo[]): string {
  const longo = resumo.some((numero) => numero.valor.length > 9);
  return longo ? "grid-cols-1 @md:grid-cols-2 @5xl:grid-cols-4" : "grid-cols-2 @3xl:grid-cols-4";
}

export function celulaEmTexto(celula: CelulaDoRelatorio, coluna: string): string {
  if (celula === null) return "—";
  if (typeof celula === "object") return formatarReais(celula.reais);
  if (typeof celula === "number" && coluna.includes("(%)")) return `${celula}%`;
  return typeof celula === "number" ? new Intl.NumberFormat("pt-BR").format(celula) : celula;
}

function Linha({ celulas, colunas, total = false }: { celulas: readonly CelulaDoRelatorio[]; colunas: readonly string[]; total?: boolean }) {
  return (
    <tr className={total ? "border-t-2 border-border font-bold" : "border-t border-border first:border-t-0"}>
      {celulas.map((celula, indice) =>
        indice === 0 ? (
          <th key={indice} scope="row" className={cn("min-w-40 px-5 py-3 text-left", !total && "font-semibold")}>
            {celulaEmTexto(celula, colunas[indice])}
          </th>
        ) : (
          <td key={indice} className="whitespace-nowrap px-5 py-3 text-right tabular-nums">
            {celulaEmTexto(celula, colunas[indice])}
          </td>
        ),
      )}
    </tr>
  );
}

function Tabela({ tabela, vazio }: { tabela: TabelaDeRelatorio; vazio: string }) {
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
            <Linha key={linha.chave} celulas={linha.celulas} colunas={tabela.colunas} />
          ))}
        </tbody>
        {tabela.total ? (
          <tfoot>
            <Linha celulas={tabela.total} colunas={tabela.colunas} total />
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}

export function TelaDeRelatorios({ rotuloDaLista, relatorios, atual, titulo, subtitulo, filtros, estado, problema, resumo, tabela, vazio, acoes }: TelaDeRelatoriosProps) {
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

      <nav aria-label={rotuloDaLista} className="no-print flex flex-wrap gap-1 rounded-lg border border-border bg-card p-1">
        {relatorios.map((item) => (
          <Link
            key={item.id}
            href={item.href}
            aria-current={item.id === atual ? "page" : undefined}
            className={cn(
              "flex min-h-11 items-center rounded-md px-3.5 text-sm font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
              item.id === atual ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {item.rotulo}
          </Link>
        ))}
      </nav>

      <div className="flex min-w-0 flex-col gap-5">
        <div className="no-print flex flex-col gap-2">
          {filtros}
          {problema ? (
            <p role="alert" className="text-sm font-semibold text-destructive">
              {problema}
            </p>
          ) : null}
        </div>
        <section aria-labelledby="titulo-do-relatorio" className="print-area flex flex-col gap-5">
          <div className="flex flex-col gap-1">
            <h2 id="titulo-do-relatorio" className="text-2xl font-extrabold tracking-tight">
              {titulo}
            </h2>
            <p className="text-sm font-semibold text-muted-foreground">{subtitulo}</p>
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
                <div className="@container">
                  <dl className={cn("grid gap-3", colunasDoResumo(resumo))}>
                    {resumo.map((numero) => (
                      <div key={numero.rotulo} className="rounded-lg border border-border bg-card px-5 py-4">
                        <dt className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{numero.rotulo}</dt>
                        <dd className="mt-1 break-words text-2xl font-extrabold tabular-nums">{numero.valor}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ) : null}
              <Tabela tabela={tabela} vazio={vazio} />
            </>
          ) : null}
        </section>
      </div>
    </div>
  );
}

/** "01/10/2026". */
export function dataBr(dia: string): string {
  const [ano, mes, dd] = dia.split("-");
  return dd && mes && ano ? `${dd}/${mes}/${ano}` : dia;
}

export const CAMPO_SELECT =
  "flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-sm focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25";
