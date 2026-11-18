import type { ReactNode } from "react";
import { CheckCircle2, ChevronRight, Printer, Scale } from "lucide-react";
import { Link } from "wouter";

import { FalhaDoClienteAtivo } from "@/components/layout/falha-do-cliente-ativo";
import type { EstadoDaAcao } from "@/components/ui/botao-de-acao";
import { Button } from "@/components/ui/button";
import { BlocoSemConexao, FalhaNaLeitura, erroDaLeituraAoVivo, type LeituraAoVivoNaTela } from "@/components/ui/erro-na-leitura";
import { Esqueleto } from "@/components/ui/esqueleto";
import { LinhaDeEstado, type LeituraDaLista } from "@/components/ui/linha-de-estado";
import { PageHeader } from "@/components/ui/page-header";
import { CartaoDaRodada } from "@/features/warehouse-ops/cartao-da-rodada";
import { ConcluirContagemDialog } from "@/features/warehouse-ops/concluir-contagem";
import { IniciarContagemDialog, type IniciarContagemProps } from "@/features/warehouse-ops/iniciar-contagem";
import type { FalhaDasLeituras } from "@/lib/carregando/falha-das-leituras";
import type { RegistroDaAberturaConcluida } from "@/lib/opening-inventory";
export { ROTA_DA_ABERTURA } from "@/lib/opening-inventory";
import { ROTA_DO_RELATORIO_CAIXAS_SALDO } from "@/lib/warehouse-ops/contagem-por-caixa";
import { ROTA_DA_RODADA, hrefDaPrateleira, type RodadaDaContagem } from "@/lib/warehouse-ops/recontagem-por-caixa";
import { hrefDaRodada, numerosDaRodadaConcluida, periodoDaRodada, type RodadaRegistrada } from "@/lib/warehouse-ops/rodadas-da-contagem";

/**
 * Estoque › Contagem, a entrada (desenho de 18/11/2026,
 * docs/mockups/contagem-entrada/01-em-andamento.png e 02-iniciar-contagem.png;
 * o registro da rodada): abrir a Contagem mostra as contagens, não as
 * prateleiras. "Em andamento" é o cartão da rodada aberta, com "Continuar"
 * para a bancada, "Ver prateleiras" para a Contagem por caixa e "Concluir
 * contagem"; sem rodada aberta, "Iniciar contagem" no cabeçalho (geral, por
 * rua ou por item); "Anteriores" tem as rodadas concluídas, com "Ver", e a
 * linha do inventário de abertura. Os dados e as ações chegam por props
 * (pages/contagem.tsx). Sem legenda.
 */

export type EstadoDaEntrada = "carregando" | "erro" | "pronto";

/** "Iniciar contagem": o diálogo, aberto ou não, e o que ele precisa. */
export type IniciarNaEntrada = Omit<IniciarContagemProps, "onCancelar"> & { aberto: boolean; onAbrir: () => void; onFechar: () => void };

/** "Concluir contagem": o diálogo da rodada em andamento. */
export type ConcluirNaEntrada = { aberto: boolean; estado: EstadoDaAcao; onAbrir: () => void; onFechar: () => void; onConcluir: () => void };

const MENSAGEM_DA_FALHA = "Não consegui carregar as contagens.";
const ID_DA_LINHA = "contagem-linha-de-estado";
const ID_DO_EM_ANDAMENTO = "contagem-em-andamento";
const SEM_ANTERIORES: readonly RodadaRegistrada[] = [];

/** A forma final na primeira leitura: o lugar do cartão e o da lista, sem número. */
function Fantasmas() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-card px-5 py-4">
        <Esqueleto forma="texto" className="w-56" />
        <Esqueleto forma="texto" className="w-80" />
      </div>
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-card px-4 py-4">
        <Esqueleto forma="texto" className="w-2/5" />
      </div>
    </div>
  );
}

function Secao({ id, titulo, children }: { id: string; titulo: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h2 id={id} className="px-0.5 text-xs font-bold uppercase tracking-widest text-muted-foreground">
        {titulo}
      </h2>
      {children}
    </section>
  );
}

type LinhaAnterior = { chave: string; titulo: string; quando: string; numeros: string; href: string | null };

/** As linhas de "Anteriores": as rodadas concluídas, a mais recente primeiro, e a abertura por último. */
function linhasAnteriores(anteriores: readonly RodadaRegistrada[], abertura: RegistroDaAberturaConcluida | null): LinhaAnterior[] {
  return [
    ...anteriores.map((rodada) => ({
      chave: rodada.id,
      titulo: rodada.titulo,
      quando: periodoDaRodada(rodada),
      numeros: rodada.numeros ? numerosDaRodadaConcluida(rodada.numeros) : "",
      href: hrefDaRodada(rodada.id),
    })),
    ...(abertura ? [{ chave: "abertura", titulo: abertura.titulo, quando: abertura.quando, numeros: abertura.numeros, href: null }] : []),
  ];
}

const focoNaLinha = () => document.getElementById(ID_DA_LINHA);

export function ContagemView({
  estado,
  cliente,
  abertura,
  rodada,
  anteriores = SEM_ANTERIORES,
  iniciar = null,
  concluir = null,
  agora,
  leitura = [],
  aoVivo,
  falha = null,
  clienteFalhou = false,
  hrefDaFolha,
}: {
  estado: EstadoDaEntrada;
  /** O nome do cliente ativo: "Contagem · BTG". */
  cliente: string;
  /** A linha da abertura em "Anteriores"; sem ela, a abertura não aparece. */
  abertura: RegistroDaAberturaConcluida | null;
  /** "Em andamento": a rodada aberta; sem prateleira com caixa, a seção não aparece; null sem rodada aberta. */
  rodada: RodadaDaContagem | null;
  /** As rodadas concluídas, a mais recente primeiro. */
  anteriores?: readonly RodadaRegistrada[];
  /** "Iniciar contagem" no cabeçalho e o diálogo dele; null com rodada aberta ou antes de ler. */
  iniciar?: IniciarNaEntrada | null;
  /** "Concluir contagem" no cartão e o diálogo dele; null sem rodada aberta. */
  concluir?: ConcluirNaEntrada | null;
  /** O dia da tela: o começo de outro dia sai com o dia. */
  agora: Date;
  /** As leituras da folha e a sessão, para a linha de estado. */
  leitura?: readonly LeituraDaLista[];
  /** As leituras ao vivo (as rodadas e as recontagens): a falta de conexão delas. */
  aoVivo?: LeituraAoVivoNaTela;
  /** Uma leitura de que a entrada depende falhou sem nada lido: o aviso no lugar, nunca o vazio. */
  falha?: FalhaDasLeituras | null;
  /** A lista dos clientes não veio: a tela não lê com o cliente padrão e diz. */
  clienteFalhou?: boolean;
  /** A folha de contagem da primeira rua. */
  hrefDaFolha: string;
}) {
  const continuar = rodada?.continuar ?? null;
  const linhas = estado === "pronto" ? linhasAnteriores(anteriores, abertura) : [];
  return (
    <div className="flex flex-col gap-6 pb-24">
      <PageHeader
        title={`Contagem · ${cliente}`}
        estado={<LinhaDeEstado id={ID_DA_LINHA} leitura={leitura} objeto="contagens" aoVivo={aoVivo ? [aoVivo] : undefined} />}
        actions={
          <>
            {iniciar && estado === "pronto" ? (
              <Button type="button" onClick={iniciar.onAbrir}>
                <ChevronRight className="size-4" aria-hidden="true" />
                Iniciar contagem
              </Button>
            ) : null}
            <Button asChild variant="outline">
              <Link href={hrefDaFolha}>
                <Printer className="size-4" aria-hidden="true" />
                Folha de contagem
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={ROTA_DO_RELATORIO_CAIXAS_SALDO}>
                <Scale className="size-4" aria-hidden="true" />
                Caixas × saldo
              </Link>
            </Button>
          </>
        }
      />
      {clienteFalhou ? (
        <FalhaDoClienteAtivo focoAoSair={ID_DA_LINHA} />
      ) : estado === "carregando" ? (
        <Fantasmas />
      ) : falha ? (
        <FalhaNaLeitura leitura={falha.leitura} erro={falha.erro} mensagem={MENSAGEM_DA_FALHA} focoAoSair={ID_DA_LINHA} />
      ) : estado === "erro" && aoVivo ? (
        // As rodadas ou as recontagens que não vieram: a falha, nunca "Iniciar contagem" nem a recontagem toda "por contar".
        <FalhaNaLeitura
          leitura={{ error: erroDaLeituraAoVivo(aoVivo.falta) ?? new Error(MENSAGEM_DA_FALHA), refetch: async () => aoVivo.tentar() }}
          mensagem={MENSAGEM_DA_FALHA}
          focoAoSair={ID_DA_LINHA}
        />
      ) : (
        <>
          {aoVivo?.falta === "conexao" && aoVivo.lidaEm == null ? <BlocoSemConexao tentando={aoVivo.tentando} onTentar={() => aoVivo.tentar()} /> : null}
          {rodada && rodada.prateleiras > 0 ? (
            <Secao id="contagem-em-andamento-secao" titulo="Em andamento">
              <CartaoDaRodada
                rodada={rodada}
                agora={agora}
                titulo="h3"
                id={ID_DO_EM_ANDAMENTO}
                acoes={
                  <>
                    {continuar ? (
                      <Button asChild>
                        <Link href={hrefDaPrateleira(continuar)}>
                          <ChevronRight className="size-4" aria-hidden="true" />
                          {`Continuar ${continuar}`}
                        </Link>
                      </Button>
                    ) : null}
                    <Button asChild variant="outline">
                      <Link href={ROTA_DA_RODADA}>Ver prateleiras</Link>
                    </Button>
                    {concluir ? (
                      <Button type="button" variant="outline" onClick={concluir.onAbrir}>
                        Concluir contagem
                      </Button>
                    ) : null}
                  </>
                }
              />
            </Secao>
          ) : null}
          {linhas.length ? (
            <Secao id="contagem-anteriores" titulo="Anteriores">
              <ul className="divide-y divide-border/60 rounded-xl border border-border bg-card">
                {linhas.map((linha) => (
                  <li key={linha.chave} className="flex flex-wrap items-center gap-x-5 gap-y-1 px-4 py-3 text-sm">
                    <span className="flex items-center gap-2 font-medium text-foreground">
                      <CheckCircle2 className="size-4 shrink-0 text-success-soft-foreground" aria-hidden="true" />
                      {linha.titulo}
                    </span>
                    {linha.quando ? <span className="text-muted-foreground">{linha.quando}</span> : null}
                    {linha.numeros ? <span className="text-muted-foreground">{linha.numeros}</span> : null}
                    {linha.href ? (
                      <Button asChild variant="outline" className="ml-auto max-md:min-h-11">
                        <Link href={linha.href} aria-label={`Ver ${linha.titulo}`}>
                          Ver
                        </Link>
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Secao>
          ) : null}
        </>
      )}
      {iniciar ? (
        <IniciarContagemDialog
          aberto={iniciar.aberto}
          ruas={iniciar.ruas}
          produtos={iniciar.produtos}
          catalogoFalhou={iniciar.catalogoFalhou}
          estado={iniciar.estado}
          onFechar={iniciar.onFechar}
          onIniciar={iniciar.onIniciar}
          focoAoFechar={focoNaLinha}
        />
      ) : null}
      {concluir ? <ConcluirContagemDialog aberto={concluir.aberto} rodada={rodada} estado={concluir.estado} onFechar={concluir.onFechar} onConcluir={concluir.onConcluir} focoAoFechar={focoNaLinha} /> : null}
    </div>
  );
}
