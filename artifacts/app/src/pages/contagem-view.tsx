import type { ReactNode } from "react";
import { CheckCircle2, ChevronRight, Printer, Scale } from "lucide-react";
import { Link } from "wouter";

import { FalhaDoClienteAtivo } from "@/components/layout/falha-do-cliente-ativo";
import { Button } from "@/components/ui/button";
import { BlocoSemConexao, FalhaNaLeitura, erroDaLeituraAoVivo, type LeituraAoVivoNaTela } from "@/components/ui/erro-na-leitura";
import { Esqueleto } from "@/components/ui/esqueleto";
import { LinhaDeEstado, type LeituraDaLista } from "@/components/ui/linha-de-estado";
import { PageHeader } from "@/components/ui/page-header";
import { CartaoDaRodada } from "@/features/warehouse-ops/cartao-da-rodada";
import type { FalhaDasLeituras } from "@/lib/carregando/falha-das-leituras";
import type { RegistroDaAberturaConcluida } from "@/lib/opening-inventory";
export { ROTA_DA_ABERTURA } from "@/lib/opening-inventory";
import { ROTA_DO_RELATORIO_CAIXAS_SALDO } from "@/lib/warehouse-ops/contagem-por-caixa";
import { ROTA_DA_RODADA, hrefDaPrateleira, type RodadaDaContagem } from "@/lib/warehouse-ops/recontagem-por-caixa";

/**
 * Estoque › Contagem, a entrada (desenho de 18/11/2026,
 * docs/mockups/contagem-entrada/01-em-andamento.png; a coleção da rodada
 * decidida em 17/11/2026): abrir a Contagem mostra as contagens, não as
 * prateleiras. "Em andamento" é o cartão da recontagem geral, com "Continuar"
 * para a bancada e "Ver prateleiras" para a Contagem por caixa; "Anteriores"
 * tem a linha do inventário de abertura, lida da sessão. "Iniciar contagem",
 * o fim de uma contagem e as anteriores além da abertura esperam o registro
 * da rodada. Os dados chegam por props (pages/contagem.tsx). Sem legenda.
 */

export type EstadoDaEntrada = "carregando" | "erro" | "pronto";

const MENSAGEM_DA_FALHA = "Não consegui carregar as contagens.";
const ID_DA_LINHA = "contagem-linha-de-estado";
const ID_DO_EM_ANDAMENTO = "contagem-em-andamento";

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

export function ContagemView({
  estado,
  cliente,
  abertura,
  rodada,
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
  /** A linha de "Anteriores"; sem ela, a seção não aparece. */
  abertura: RegistroDaAberturaConcluida | null;
  /** "Em andamento"; sem prateleira com caixa, a seção não aparece. */
  rodada: RodadaDaContagem | null;
  /** O dia da tela: o começo de outro dia sai com o dia. */
  agora: Date;
  /** As leituras da folha e a sessão, para a linha de estado. */
  leitura?: readonly LeituraDaLista[];
  /** As leituras ao vivo da rodada: a falta de conexão delas. */
  aoVivo?: LeituraAoVivoNaTela;
  /** Uma leitura de que a entrada depende falhou sem nada lido: o aviso no lugar, nunca o vazio. */
  falha?: FalhaDasLeituras | null;
  /** A lista dos clientes não veio: a tela não lê com o cliente padrão e diz. */
  clienteFalhou?: boolean;
  /** A folha de contagem da primeira rua. */
  hrefDaFolha: string;
}) {
  const continuar = rodada?.continuar ?? null;
  return (
    <div className="flex flex-col gap-6 pb-24">
      <PageHeader
        title={`Contagem · ${cliente}`}
        estado={<LinhaDeEstado id={ID_DA_LINHA} leitura={leitura} objeto="contagens" aoVivo={aoVivo ? [aoVivo] : undefined} />}
        actions={
          <>
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
        // As recontagens que não vieram: a falha, nunca a recontagem toda "por contar".
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
                  </>
                }
              />
            </Secao>
          ) : null}
          {abertura ? (
            <Secao id="contagem-anteriores" titulo="Anteriores">
              <ul className="rounded-xl border border-border bg-card">
                <li className="flex flex-wrap items-center gap-x-5 gap-y-1 px-4 py-3 text-sm">
                  <span className="flex items-center gap-2 font-medium text-foreground">
                    <CheckCircle2 className="size-4 shrink-0 text-success-soft-foreground" aria-hidden="true" />
                    {abertura.titulo}
                  </span>
                  {abertura.quando ? <span className="text-muted-foreground">{abertura.quando}</span> : null}
                  <span className="text-muted-foreground">{abertura.numeros}</span>
                </li>
              </ul>
            </Secao>
          ) : null}
        </>
      )}
    </div>
  );
}
