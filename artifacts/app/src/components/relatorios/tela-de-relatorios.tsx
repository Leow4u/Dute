import type { ReactNode } from "react";
import { Download, Printer } from "lucide-react";
import { Link } from "wouter";

import { Button } from "@/components/ui/button";
import { CarregandoNaRegiao } from "@/components/ui/carregando-na-regiao";
import { CartaoComBrilho, Esqueleto } from "@/components/ui/esqueleto";
import { FaixaAoVivo, FalhaAoVivo } from "@/components/ui/erro-na-leitura";
import { useEsperaDaRota } from "@/lib/carregando/espera-da-rota";
import { useEspera } from "@/lib/carregando/use-espera";
import { SEM_NOVA_TENTATIVA, type NovaTentativa } from "@/lib/operacao/leitura";
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
  /** A nova tentativa das leituras do relatório (parte 13g): "Tentar de novo" na falha, aos 10 s e aos 70 s. */
  leitura?: NovaTentativa;
};

/**
 * O relatório que ainda lê (carregamento v2, parte 13g), no lugar do bloco
 * rosado: a linha "Carregando o relatório…" sob o título, que continua a
 * espera da tela, e, aos 300 ms, os números e as linhas da tabela em blocos
 * neutros, com o brilho de dois ciclos. Os blocos são decorativos e ficam
 * fora da árvore: quem diz que lê é a linha, que fica fora de qualquer
 * `aria-busy`.
 */
function RelatorioCarregando({ leitura }: { leitura: NovaTentativa }) {
  // Os blocos seguem o relógio da linha, que continua a espera da tela que abriu.
  const rota = useEsperaDaRota(true);
  const visivel = useEspera(true, { desde: rota?.inicio }).visivel;
  return (
    <>
      <CarregandoNaRegiao rotulo="Carregando o relatório…" continuaARota onTentar={leitura.tentar} />
      <div aria-hidden="true" className={cn("flex flex-col gap-5 transition-opacity duration-150 motion-reduce:transition-none", visivel ? "opacity-100" : "opacity-0")}>
        <div className="@container">
          <div className="grid grid-cols-2 gap-3 @3xl:grid-cols-4">
          {[0, 1, 2, 3].map((indice) => (
            <CartaoComBrilho key={indice} ordem={indice} className="flex flex-col gap-2.5 rounded-lg border border-border bg-card px-5 py-4">
              <Esqueleto forma="texto" className="h-2.5 w-2/3" />
              <Esqueleto forma="bloco" className="h-6 w-1/3" />
            </CartaoComBrilho>
          ))}
          </div>
        </div>
        <CartaoComBrilho ordem={4} className="rounded-lg border border-border bg-card">
          {[0, 1, 2, 3, 4].map((indice) => (
            <div key={indice} className="flex items-center gap-4 border-t border-border px-5 py-3.5 first:border-t-0">
              <Esqueleto forma="texto" className={indice % 2 ? "w-1/4" : "w-1/3"} />
              <Esqueleto forma="texto" className="ml-auto w-16" />
            </div>
          ))}
        </CartaoComBrilho>
      </div>
    </>
  );
}

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

/** A coluna que leva a barra ao lado do número (a receita por serviço do Financeiro). */
export const COLUNA_DE_PARTICIPACAO = "Participação (%)";

function Barra({ percentual }: { percentual: number }) {
  return (
    <span aria-hidden="true" className="mr-2 inline-block h-2 w-24 overflow-hidden rounded-full bg-muted align-middle">
      <span className="block h-full rounded-full bg-primary" style={{ width: `${Math.min(100, Math.max(0, percentual))}%` }} />
    </span>
  );
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
            {colunas[indice] === COLUNA_DE_PARTICIPACAO && typeof celula === "number" && !total ? <Barra percentual={celula} /> : null}
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

export function TelaDeRelatorios({
  rotuloDaLista,
  relatorios,
  atual,
  titulo,
  subtitulo,
  filtros,
  estado,
  problema,
  resumo,
  tabela,
  vazio,
  acoes,
  leitura = SEM_NOVA_TENTATIVA,
}: TelaDeRelatoriosProps) {
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
              "flex min-h-11 items-center rounded-md px-3.5 text-sm font-semibold focus-visible:outline-hidden transition-colors focus-visible:ring-2 focus-visible:ring-foco",
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
        {/* O papel claro da impressão (print-area) só com o relatório lido: a espera e a falha ficam nas cores do
            tema, como no resto da tela, e não somem no escuro (o rótulo da espera em tinta clara sobre o fundo escuro). */}
        <section aria-labelledby="titulo-do-relatorio" className={cn("flex flex-col gap-5", pronto && "print-area")} data-relatorio="">
          <div className="flex flex-col gap-1">
            <h2 id="titulo-do-relatorio" className="text-2xl font-extrabold tracking-tight">
              {titulo}
            </h2>
            <p className="text-sm font-semibold text-muted-foreground">{subtitulo}</p>
          </div>
          {estado === "erro" ? (
            <FalhaAoVivo
              leitura={leitura}
              mensagem="Não foi possível carregar o relatório."
              className="rounded-lg border border-destructive-soft-border bg-destructive-soft px-4 py-3"
            />
          ) : estado === "carregando" ? (
            <RelatorioCarregando leitura={leitura} />
          ) : pronto ? (
            <>
              <FaixaAoVivo leitura={leitura} className="no-print" />
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
  "flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-sm focus-visible:border-primary focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring/25";
