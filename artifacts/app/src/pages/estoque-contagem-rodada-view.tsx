import { ArrowLeft, ChevronRight, Printer, Scale } from "lucide-react";
import { Link } from "wouter";

import { FalhaDoClienteAtivo } from "@/components/layout/falha-do-cliente-ativo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BlocoSemConexao, FalhaNaLeitura, erroDaLeituraAoVivo, type LeituraAoVivoNaTela } from "@/components/ui/erro-na-leitura";
import { Esqueleto } from "@/components/ui/esqueleto";
import { LinhaDeEstado, type LeituraDaLista } from "@/components/ui/linha-de-estado";
import { PageHeader } from "@/components/ui/page-header";
import type { FalhaDasLeituras } from "@/lib/carregando/falha-das-leituras";
import { cn } from "@/lib/utils";
import {
  ROTA_DO_RELATORIO_CAIXAS_SALDO,
  prateleiraDifere,
  resumoDoRelatorio,
  textoCaixasSaldo,
  textoDaDiferenca,
  type RelatorioCaixasSaldo,
} from "@/lib/warehouse-ops/contagem-por-caixa";
import {
  acaoDaPrateleira,
  hrefDaPrateleira,
  resumoDaRua,
  seloDaPrateleira,
  textoDoComeco,
  unidadesComSinal,
  type PrateleiraDaRodada,
  type RodadaDaContagem,
} from "@/lib/warehouse-ops/recontagem-por-caixa";

/**
 * Estoque › Contagem por caixa, a rodada (diagnóstico da Contagem cíclica,
 * seção 6, item 4; docs/mockups/WmsContagemRodada.dc.html): a rodada do dia
 * com quando começou e os números dela, as prateleiras com caixa por rua, na
 * ordem de caminhada, com o estado nesta rodada (por contar, em contagem,
 * contada) e o que impede recontá-las (a guarda aberta, o pedido separado
 * esperando a entrega), e o "Caixas × saldo" ao lado. Os dados chegam por
 * props (pages/estoque-contagem-rodada.tsx). Sem legenda.
 */

export type EstadoDaRodada = "carregando" | "erro" | "pronto";

/** A volta: a Contagem, de onde a contagem por caixa se abre. */
export const VOLTA_DA_RODADA = { href: "/wms/contagem", rotulo: "Contagem" } as const;
/** O que a rodada diz sem nenhuma prateleira com caixa do cliente. */
export const SEM_PRATELEIRAS_COM_CAIXA = "Nenhuma prateleira com caixa do cliente.";
const MENSAGEM_DA_FALHA = "Não consegui carregar as prateleiras.";
/** Quantas prateleiras que diferem o cartão "Caixas × saldo" mostra. */
const DIFERENTES_A_VISTA = 6;
const ID_DA_LINHA = "rodada-linha-de-estado";

const numero = new Intl.NumberFormat("pt-BR");

/** O selo da prateleira: verde sem diferença, âmbar com ela, violeta em contagem, neutro antes desta rodada. */
function corDoSelo(prateleira: PrateleiraDaRodada): string {
  if (prateleira.estado === "em_contagem") return "border-violet-soft-border bg-violet-soft text-violet-soft-foreground";
  if (prateleira.estado === "contada") return prateleira.comDiferenca ? "border-amber-soft-border bg-amber-soft text-amber-soft-foreground" : "border-success-soft-border bg-success-soft text-success-soft-foreground";
  return "border-border bg-muted text-foreground";
}

function Selo({ className, children }: { className: string; children: string }) {
  return (
    <Badge variant="outline" className={cn("gap-1.5 text-sm font-bold", className)}>
      <span aria-hidden="true" className="size-2 rounded-full bg-current" />
      {children}
    </Badge>
  );
}

function Fantasmas() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-3 rounded-lg border border-border bg-card px-4 py-4">
      {Array.from({ length: 6 }, (_, indice) => (
        <div key={indice} className="flex items-center gap-4">
          <Esqueleto forma="texto" className="w-12" />
          <Esqueleto forma="texto" className="w-2/5" />
          <Esqueleto forma="texto" className="ml-auto w-16" />
        </div>
      ))}
    </div>
  );
}

/** O cabeçalho da rodada: o nome, quando começou e quem, os números e a barra. */
function Numeros({ rodada }: { rodada: RodadaDaContagem }) {
  const percentual = rodada.caixas ? Math.round((rodada.caixasConfirmadas / rodada.caixas) * 100) : 0;
  const numeros: Array<{ valor: string; de?: string; rotulo: string }> = [
    { valor: numero.format(rodada.prateleirasContadas), de: `de ${numero.format(rodada.prateleiras)}`, rotulo: "prateleiras" },
    { valor: numero.format(rodada.caixasConfirmadas), de: `de ${numero.format(rodada.caixas)}`, rotulo: "caixas" },
    { valor: numero.format(rodada.caixasComDiferenca), rotulo: "caixas com diferença" },
    { valor: unidadesComSinal(rodada.diferenca), rotulo: "diferença líquida" },
  ];
  return (
    <section aria-labelledby="rodada-titulo" className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex flex-col gap-4 px-5 py-4 lg:flex-row lg:items-center lg:gap-6">
        <div className="min-w-0">
          <h2 id="rodada-titulo" className="text-base font-extrabold text-foreground">
            {rodada.titulo}
          </h2>
          {rodada.comeco ? <p className="text-sm text-muted-foreground">{textoDoComeco(rodada.comeco)}</p> : null}
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4 lg:ml-auto">
          {numeros.map((item) => (
            <div key={item.rotulo} className="flex flex-col-reverse lg:text-right">
              <dt className="text-xs font-semibold text-muted-foreground">{item.rotulo}</dt>
              <dd className="text-2xl font-extrabold tabular-nums text-foreground">
                {item.valor}
                {item.de ? <span className="ml-1 text-sm font-bold text-muted-foreground">{item.de}</span> : null}
              </dd>
            </div>
          ))}
        </dl>
      </div>
      <div aria-hidden="true" className="h-1.5 bg-muted">
        <div className="h-full bg-foreground" style={{ width: `${percentual}%` }} />
      </div>
    </section>
  );
}

function LinhaDaPrateleira({ prateleira }: { prateleira: PrateleiraDaRodada }) {
  const selo = seloDaPrateleira(prateleira);
  const [caixas, ...resto] = prateleira.resumo.split(" · ");
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border/60 px-4 py-3 first:border-t-0">
      <span className="min-w-14 font-mono text-base font-extrabold text-foreground">{prateleira.posicao}</span>
      <p className="min-w-0 flex-1 basis-40 text-sm text-muted-foreground">
        <b className="mr-2 font-bold text-foreground">{caixas}</b>
        {resto.join(" · ")}
      </p>
      {selo ? <Selo className={corDoSelo(prateleira)}>{selo}</Selo> : null}
      {prateleira.bloqueio ? <Selo className="border-border bg-muted text-foreground">{prateleira.bloqueio}</Selo> : null}
      <Button asChild variant="outline" className="max-md:min-h-11">
        <Link href={hrefDaPrateleira(prateleira.posicao)} aria-label={`${acaoDaPrateleira(prateleira)} ${prateleira.posicao}`}>
          {acaoDaPrateleira(prateleira)}
        </Link>
      </Button>
    </li>
  );
}

/** O "Caixas × saldo" ao lado: o resumo, as que mais diferem e o relatório completo. */
function CaixasSaldo({ relatorio }: { relatorio: RelatorioCaixasSaldo }) {
  const diferentes = relatorio.linhas.filter(prateleiraDifere).slice(0, DIFERENTES_A_VISTA);
  return (
    <section aria-labelledby="rodada-caixas-saldo" className="flex flex-col gap-2.5 rounded-xl border border-border bg-card px-5 py-4">
      <h2 id="rodada-caixas-saldo" className="text-base font-extrabold text-foreground">
        Caixas × saldo
      </h2>
      <p className="flex items-center gap-2 text-sm font-bold text-foreground">
        <span aria-hidden="true" className="size-2.5 rounded-full bg-success" />
        {resumoDoRelatorio(relatorio)}
      </p>
      {diferentes.length ? (
        <ul className="flex flex-col gap-1.5">
          {diferentes.map((prateleira) => (
            <li key={prateleira.posicao} className="flex items-center gap-2.5 text-sm">
              <b className="min-w-12 font-mono font-extrabold text-foreground">{prateleira.posicao}</b>
              <span className="text-muted-foreground">{textoCaixasSaldo(prateleira)}</span>
              <span
                className={cn(
                  "ml-auto font-extrabold tabular-nums",
                  prateleira.diferenca > 0 ? "text-success-soft-foreground" : prateleira.diferenca < 0 ? "text-destructive-soft-foreground" : "text-muted-foreground",
                )}
              >
                {textoDaDiferenca(prateleira.diferenca)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <Link href={ROTA_DO_RELATORIO_CAIXAS_SALDO} className="w-fit text-sm font-bold text-foreground underline underline-offset-4">
        Relatório completo
      </Link>
    </section>
  );
}

export function EstoqueContagemRodadaView({
  estado,
  rodada,
  relatorio,
  leitura = [],
  aoVivo,
  falha = null,
  clienteFalhou = false,
  hrefDaFolha,
}: {
  estado: EstadoDaRodada;
  rodada: RodadaDaContagem | null;
  relatorio: RelatorioCaixasSaldo | null;
  /** As leituras da folha (as posições, as caixas, a abertura e os saldos), para a linha de estado. */
  leitura?: readonly LeituraDaLista[];
  /** As leituras ao vivo da rodada (as recontagens, as guardas e as reservas): a falta de conexão delas. */
  aoVivo?: LeituraAoVivoNaTela;
  /** A leitura de que a rodada depende falhou sem nada lido: o aviso no lugar da lista, nunca o vazio. */
  falha?: FalhaDasLeituras | null;
  /** A lista dos clientes não veio: a tela não lê com o cliente padrão e diz. */
  clienteFalhou?: boolean;
  /** A folha de contagem da primeira rua. */
  hrefDaFolha: string;
}) {
  const continuar = rodada?.continuar ?? null;
  return (
    <div className="flex flex-col gap-4 pb-24">
      <Link href={VOLTA_DA_RODADA.href} className="inline-flex w-fit items-center gap-2 text-sm font-semibold text-primary-texto">
        <ArrowLeft className="size-4" aria-hidden="true" />
        {VOLTA_DA_RODADA.rotulo}
      </Link>
      <PageHeader
        title="Contagem por caixa"
        estado={<LinhaDeEstado id={ID_DA_LINHA} leitura={leitura} objeto="prateleiras" aoVivo={aoVivo ? [aoVivo] : undefined} />}
        actions={
          <>
            <Button asChild variant="outline">
              <Link href={ROTA_DO_RELATORIO_CAIXAS_SALDO}>
                <Scale className="size-4" aria-hidden="true" />
                Caixas × saldo
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={hrefDaFolha}>
                <Printer className="size-4" aria-hidden="true" />
                Imprimir folha
              </Link>
            </Button>
            {estado === "pronto" && continuar ? (
              <Button asChild>
                <Link href={hrefDaPrateleira(continuar)}>
                  <ChevronRight className="size-4" aria-hidden="true" />
                  {`Continuar ${continuar}`}
                </Link>
              </Button>
            ) : null}
          </>
        }
      />
      {clienteFalhou ? (
        <FalhaDoClienteAtivo focoAoSair={ID_DA_LINHA} />
      ) : estado === "carregando" ? (
        // A primeira leitura fica na linha de estado, sob o título; a lista guarda a forma final com as linhas-fantasma.
        <Fantasmas />
      ) : falha ? (
        <FalhaNaLeitura leitura={falha.leitura} erro={falha.erro} mensagem={MENSAGEM_DA_FALHA} focoAoSair={ID_DA_LINHA} />
      ) : estado === "erro" && aoVivo ? (
        // As recontagens da rodada que não vieram: a falha, nunca as prateleiras todas "por contar".
        <FalhaNaLeitura
          leitura={{ error: erroDaLeituraAoVivo(aoVivo.falta) ?? new Error(MENSAGEM_DA_FALHA), refetch: async () => aoVivo.tentar() }}
          mensagem={MENSAGEM_DA_FALHA}
          focoAoSair={ID_DA_LINHA}
        />
      ) : rodada ? (
        <>
          {aoVivo?.falta === "conexao" && aoVivo.lidaEm == null ? <BlocoSemConexao tentando={aoVivo.tentando} onTentar={() => aoVivo.tentar()} /> : null}
          <Numeros rodada={rodada} />
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
            <div className="flex flex-col gap-4">
              {rodada.ruas.length ? (
                rodada.ruas.map((rua) => {
                  const id = `rua-${rua.rua || "sem-rua"}`;
                  return (
                    <section key={rua.rua || "sem-rua"} aria-labelledby={id} className="flex flex-col gap-2">
                      <h2 id={id} className="flex flex-wrap items-baseline gap-x-2.5 px-0.5 text-xs font-bold uppercase tracking-widest text-muted-foreground">
                        {rua.rua ? `Rua ${rua.rua}` : "Outros locais"}
                        <span className="text-sm font-semibold normal-case tracking-normal">{resumoDaRua(rua)}</span>
                      </h2>
                      <ul className="rounded-xl border border-border bg-card">
                        {rua.prateleiras.map((prateleira) => (
                          <LinhaDaPrateleira key={prateleira.posicao} prateleira={prateleira} />
                        ))}
                      </ul>
                    </section>
                  );
                })
              ) : (
                <p className="rounded-lg border border-border bg-card px-5 py-6 text-sm text-muted-foreground">{SEM_PRATELEIRAS_COM_CAIXA}</p>
              )}
            </div>
            {relatorio ? <CaixasSaldo relatorio={relatorio} /> : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
