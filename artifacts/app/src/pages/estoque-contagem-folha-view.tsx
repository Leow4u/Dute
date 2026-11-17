import { ArrowLeft, Printer } from "lucide-react";
import { Link } from "wouter";

import { FalhaDoClienteAtivo } from "@/components/layout/falha-do-cliente-ativo";
import { Button } from "@/components/ui/button";
import { CarregandoNaRegiao } from "@/components/ui/carregando-na-regiao";
import { Chip } from "@/components/ui/chip";
import { FalhaNaLeitura } from "@/components/ui/erro-na-leitura";
import { FalhaNaSecao } from "@/components/ui/falha-na-secao";
import { PageHeader } from "@/components/ui/page-header";
import { FolhaDeContagemDocumento } from "@/features/warehouse-ops/folha-de-contagem-documento";
import type { FalhaDasLeituras } from "@/lib/carregando/falha-das-leituras";
import type { FolhaDeContagem } from "@/lib/warehouse-ops/contagem-por-caixa";

/**
 * Estoque › Contagem › Folha de contagem (diagnóstico da Contagem cíclica,
 * seção 6, item 1): a barra de cima, que não sai na impressão, com a rua
 * escolhida, e a folha (docs/mockups/WmsContagemFolha.dc.html). Os dados
 * chegam por props (pages/estoque-contagem-folha.tsx). Sem legenda; uma
 * ação: "Imprimir".
 */

export type EstadoDaFolha = "carregando" | "erro" | "pronto";

/** A volta: a Contagem, de onde a folha se abre. */
export const VOLTA_DA_FOLHA = { href: "/wms/contagem", rotulo: "Contagem" } as const;

/** O que a tela diz sem nenhuma prateleira com caixa ou saldo do cliente. */
export const SEM_PRATELEIRAS = "Nenhuma prateleira com caixa ou saldo do cliente.";
/** O que a tela diz quando a rua da busca não existe. */
export const RUA_NAO_ENCONTRADA = "Rua não encontrada";
/** O aviso do catálogo que não chegou: a folha sai com o nome da caixa, ou o SKU. */
export const SEM_CATALOGO = "Não consegui carregar o catálogo.";
const MENSAGEM_DA_FALHA = "Não consegui carregar a folha de contagem.";
const ROTULO_DA_ESPERA = "Carregando a folha de contagem…";
/** O título da tela: o foco vai a ele quando a falha ou a espera sai com ele. */
const ID_DO_TITULO = "folha-de-contagem-titulo";

export function EstoqueContagemFolhaView({
  estado,
  folha,
  ruas,
  rua,
  onRua,
  falha = null,
  clienteFalhou = false,
  catalogoFalhou = false,
  tentando = false,
  onImprimir,
  onTentar,
}: {
  estado: EstadoDaFolha;
  /** A folha da rua escolhida; null sem rua (nada lido ainda, ou a rua não existe). */
  folha: FolhaDeContagem | null;
  /** As ruas com prateleira do cliente, na ordem de caminhada. */
  ruas: readonly string[];
  /** A rua escolhida (a da busca, ou a primeira). */
  rua: string | null;
  onRua: (rua: string) => void;
  /** A leitura de que a folha depende falhou sem nada lido: o aviso no lugar da folha, nunca o vazio. */
  falha?: FalhaDasLeituras | null;
  /** A lista dos clientes não veio: a tela não lê com o cliente padrão e diz. */
  clienteFalhou?: boolean;
  /** O catálogo não chegou: a folha sai com o nome da caixa, e a tela diz. */
  catalogoFalhou?: boolean;
  /** A nova tentativa pedida está a caminho ("Tentando de novo…" no aviso do catálogo). */
  tentando?: boolean;
  onImprimir: () => void;
  /** Lê de novo o que ainda não chegou: "Tentar de novo" na demora, na desistência e na falha. */
  onTentar?: () => Promise<unknown>;
}) {
  const pronta = estado === "pronto" && !clienteFalhou && Boolean(folha);
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 pb-24">
      <div className="no-print flex flex-col gap-4">
        <Link href={VOLTA_DA_FOLHA.href} className="inline-flex w-fit items-center gap-2 text-sm font-semibold text-primary-texto">
          <ArrowLeft className="size-4" aria-hidden="true" />
          {VOLTA_DA_FOLHA.rotulo}
        </Link>
        <PageHeader
          title={<span id={ID_DO_TITULO}>Folha de contagem</span>}
          actions={
            <Button type="button" onClick={onImprimir} disabled={!pronta}>
              <Printer className="size-4" aria-hidden="true" />
              Imprimir
            </Button>
          }
        >
          {/* A rua da folha: uma por vez, a escolhida em tinta; a troca vai à busca (?rua=B), como as Etiquetas. */}
          {ruas.length > 1 ? (
            <div role="group" aria-label="Rua" className="flex flex-wrap gap-2">
              {ruas.map((opcao) => (
                <Chip key={opcao} selected={opcao === rua} onClick={() => onRua(opcao)}>
                  {`Rua ${opcao}`}
                </Chip>
              ))}
            </div>
          ) : null}
        </PageHeader>
      </div>
      {clienteFalhou ? (
        <FalhaDoClienteAtivo className="no-print" focoAoSair={ID_DO_TITULO} />
      ) : estado === "carregando" ? (
        // A primeira leitura é a espera em bloco do carregamento v2: nada antes de 300 ms, a caixa e o rótulo, com o
        // anúncio; ela continua a espera da rota, com "Tentar de novo" aos 10 s e a desistência aos 70 s.
        <CarregandoNaRegiao rotulo={ROTULO_DA_ESPERA} continuaARota onTentar={onTentar} focoAoSair={ID_DO_TITULO} className="no-print rounded-lg border border-border bg-card px-5 py-6" />
      ) : falha ? (
        // A falha nunca vira vazio: o aviso com "Tentar de novo" (sem conexão, o bloco da conexão).
        <FalhaNaLeitura leitura={falha.leitura} erro={falha.erro} mensagem={MENSAGEM_DA_FALHA} focoAoSair={ID_DO_TITULO} className="no-print" />
      ) : !ruas.length ? (
        <p className="no-print rounded-lg border border-border bg-card px-5 py-7 text-center text-sm font-semibold text-muted-foreground">{SEM_PRATELEIRAS}</p>
      ) : !folha ? (
        <p className="no-print rounded-lg border border-border bg-card px-5 py-7 text-center text-sm font-semibold text-muted-foreground">{RUA_NAO_ENCONTRADA}</p>
      ) : (
        <>
          {catalogoFalhou ? (
            onTentar ? (
              <FalhaNaSecao mensagem={SEM_CATALOGO} tom="aviso" tentando={tentando} onTentar={onTentar} className="no-print rounded-lg border border-warning-soft-border bg-warning-soft px-4 py-3" />
            ) : (
              <p role="alert" className="no-print rounded-lg border border-warning-soft-border bg-warning-soft px-4 py-3 text-sm font-semibold text-carregando-aviso">
                {SEM_CATALOGO}
              </p>
            )
          ) : null}
          {/* A folha tem a largura do A4; no celular, a caixa rola para o lado em vez de espremer a tabela, e recebe o foco
              do teclado para rolar, como a lista de separação. */}
          <div
            role="region"
            aria-label="Folha de contagem"
            tabIndex={0}
            className="overflow-x-auto rounded-lg border border-border bg-muted p-4 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-foco"
          >
            <FolhaDeContagemDocumento folha={folha} />
          </div>
        </>
      )}
    </div>
  );
}
