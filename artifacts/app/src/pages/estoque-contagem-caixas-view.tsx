import { ArrowLeft, Printer } from "lucide-react";
import { Link } from "wouter";

import { FalhaDoClienteAtivo } from "@/components/layout/falha-do-cliente-ativo";
import { Button } from "@/components/ui/button";
import { CarregandoNaRegiao } from "@/components/ui/carregando-na-regiao";
import { FalhaNaLeitura } from "@/components/ui/erro-na-leitura";
import { Esqueleto } from "@/components/ui/esqueleto";
import { FalhaNaSecao } from "@/components/ui/falha-na-secao";
import { LinhaDeEstado, type LeituraDaLista } from "@/components/ui/linha-de-estado";
import { PageHeader } from "@/components/ui/page-header";
import type { FalhaDasLeituras } from "@/lib/carregando/falha-das-leituras";
import { cn } from "@/lib/utils";
import {
  horaEmTexto,
  prateleiraDifere,
  resumoDoRelatorio,
  textoCaixasSaldo,
  textoDaDiferenca,
  textoDosItensDiferentes,
  type ContagemDoDia,
  type PrateleiraDaContagem,
  type RelatorioCaixasSaldo,
} from "@/lib/warehouse-ops/contagem-por-caixa";

/**
 * Estoque › Contagem › Caixas × saldo (diagnóstico da Contagem cíclica, seção
 * 6, item 1; o cartão "Caixas × saldo" de docs/mockups/WmsContagemRodada
 * .dc.html, inteiro): a regra de ouro por prateleira do cliente ativo, as
 * diferentes primeiro, e as contagens gravadas hoje. Só a apresentação: os
 * dados chegam por props (pages/estoque-contagem-caixas.tsx). Na v3, sem
 * legenda: rótulos, dados e ações.
 */

export type EstadoDoRelatorio = "carregando" | "erro" | "pronto";

/** A volta: a Contagem, de onde o relatório se abre. */
export const VOLTA_DO_RELATORIO = { href: "/wms/contagem", rotulo: "Contagem" } as const;
/** O que a tela diz sem nenhuma prateleira com caixa ou saldo do cliente. */
export const SEM_PRATELEIRAS = "Nenhuma prateleira com caixa ou saldo do cliente.";
/** O que a seção das contagens diz sem contagem gravada hoje. */
export const SEM_CONTAGENS_HOJE = "Nenhuma contagem hoje.";
/** O aviso do catálogo que não chegou: o nome do produto é o da caixa, ou o SKU. */
export const SEM_CATALOGO = "Não consegui carregar o catálogo.";
/** A prateleira com saldo ou caixa que não está no cadastro de Posições. */
export const FORA_DO_CADASTRO = "fora do cadastro";
const MENSAGEM_DA_FALHA = "Não consegui carregar as prateleiras.";
const MENSAGEM_DAS_CONTAGENS = "Não consegui carregar as contagens de hoje.";
const ROTULO_DAS_CONTAGENS = "Carregando contagens de hoje…";
/** A linha de estado sob o título: o foco vai a ela quando o aviso no lugar da lista sai com ele. */
const ID_DA_LINHA = "caixas-saldo-linha-de-estado";
const ID_DAS_CONTAGENS = "caixas-saldo-contagens";

const numero = new Intl.NumberFormat("pt-BR");

export type ContagensDeHoje = {
  estado: EstadoDoRelatorio;
  itens: readonly ContagemDoDia[];
  /** A nova tentativa pedida está a caminho. */
  tentando?: boolean;
  onTentar?: () => Promise<unknown>;
};

/** "caixas 160 · saldo 158 · 2 itens diferem · fora do cadastro": o que a linha da prateleira diz. */
export function textoDaPrateleira(prateleira: PrateleiraDaContagem): string {
  return [textoCaixasSaldo(prateleira), textoDosItensDiferentes(prateleira), prateleira.cadastrada ? "" : FORA_DO_CADASTRO].filter(Boolean).join(" · ");
}

function Fantasmas() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-3 rounded-lg border border-border bg-card px-4 py-4">
      {Array.from({ length: 5 }, (_, indice) => (
        <div key={indice} className="flex items-center gap-4">
          <Esqueleto forma="texto" className="w-12" />
          <Esqueleto forma="texto" className="w-2/5" />
          <Esqueleto forma="texto" className="ml-auto w-10" />
        </div>
      ))}
    </div>
  );
}

function Prateleiras({ relatorio }: { relatorio: RelatorioCaixasSaldo }) {
  if (!relatorio.linhas.length) return <p className="rounded-lg border border-border bg-card px-5 py-6 text-sm text-muted-foreground">{SEM_PRATELEIRAS}</p>;
  return (
    <section aria-label="Prateleiras" className="rounded-lg border border-border bg-card">
      <p className="border-b border-border/70 px-4 py-3 text-sm font-bold text-foreground">{resumoDoRelatorio(relatorio)}</p>
      <ul className="divide-y divide-border/50">
        {relatorio.linhas.map((prateleira) => {
          const difere = prateleiraDifere(prateleira);
          return (
            <li key={prateleira.posicao} className="flex items-center gap-4 px-4 py-2.5 text-sm">
              <span className="min-w-14 font-mono text-base font-extrabold text-foreground">{prateleira.posicao}</span>
              <span className={cn("min-w-0 flex-1", difere ? "text-foreground" : "text-foreground/70")}>{textoDaPrateleira(prateleira)}</span>
              <span
                className={cn(
                  "whitespace-nowrap font-extrabold tabular-nums",
                  prateleira.diferenca > 0 ? "text-success-soft-foreground" : prateleira.diferenca < 0 || difere ? "text-destructive-soft-foreground" : "text-foreground/50",
                )}
              >
                {textoDaDiferenca(prateleira.diferenca)}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Contagens({ contagens }: { contagens: ContagensDeHoje }) {
  return (
    <section aria-labelledby={ID_DAS_CONTAGENS} className="rounded-lg border border-border bg-card">
      <h2 id={ID_DAS_CONTAGENS} tabIndex={-1} className="border-b border-border/70 px-4 py-3 text-base font-bold text-foreground">
        Contagens de hoje
      </h2>
      {contagens.estado === "carregando" ? (
        <CarregandoNaRegiao rotulo={ROTULO_DAS_CONTAGENS} onTentar={contagens.onTentar} focoAoSair={ID_DAS_CONTAGENS} className="px-4 py-4" />
      ) : contagens.estado === "erro" ? (
        // A falha da seção nunca vira vazio: a frase e "Tentar de novo", na própria seção.
        <FalhaNaSecao mensagem={MENSAGEM_DAS_CONTAGENS} tentando={contagens.tentando ?? false} onTentar={contagens.onTentar ?? (() => undefined)} focoAoSair={ID_DAS_CONTAGENS} className="px-4 py-4" />
      ) : !contagens.itens.length ? (
        <p className="px-4 py-4 text-sm text-muted-foreground">{SEM_CONTAGENS_HOJE}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/70 text-left text-xs font-semibold uppercase tracking-wide text-foreground/50">
                <th scope="col" className="px-4 py-2.5">
                  Prateleira
                </th>
                <th scope="col" className="py-2.5 pr-3">
                  Item
                </th>
                <th scope="col" className="py-2.5 pr-3 text-right">
                  Antes
                </th>
                <th scope="col" className="py-2.5 pr-3 text-right">
                  Contado
                </th>
                <th scope="col" className="py-2.5 pr-3 text-right">
                  Diferença
                </th>
                <th scope="col" className="py-2.5 pr-3">
                  Quem
                </th>
                <th scope="col" className="py-2.5 pr-4 text-right">
                  Hora
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {contagens.itens.map((contagem) => (
                <tr key={contagem.id}>
                  <td className="px-4 py-2.5 font-mono font-bold text-foreground">{contagem.posicao}</td>
                  <td className="min-w-0 py-2.5 pr-3">
                    <p className="font-semibold text-foreground">{contagem.nome}</p>
                    <p className="font-mono text-xs text-foreground/70">{[contagem.codigo, contagem.sku, contagem.caixa].filter(Boolean).join(" · ")}</p>
                  </td>
                  <td className="py-2.5 pr-3 text-right tabular-nums">{numero.format(contagem.antes)}</td>
                  <td className="py-2.5 pr-3 text-right tabular-nums font-bold">{numero.format(contagem.contado)}</td>
                  <td className={cn("py-2.5 pr-3 text-right tabular-nums font-bold", contagem.diferenca > 0 ? "text-success-soft-foreground" : contagem.diferenca < 0 ? "text-destructive-soft-foreground" : "text-foreground/50")}>
                    {textoDaDiferenca(contagem.diferenca)}
                  </td>
                  <td className="py-2.5 pr-3">{contagem.quem}</td>
                  <td className="py-2.5 pr-4 text-right tabular-nums">{horaEmTexto(contagem.quando)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function EstoqueContagemCaixasView({
  estado,
  relatorio,
  contagens,
  leitura = [],
  falha = null,
  clienteFalhou = false,
  catalogoFalhou = false,
  tentando = false,
  onTentar,
  hrefDaFolha,
}: {
  estado: EstadoDoRelatorio;
  relatorio: RelatorioCaixasSaldo | null;
  contagens: ContagensDeHoje;
  /** As leituras de que a conta depende, para a linha de estado sob o título. */
  leitura?: readonly LeituraDaLista[];
  /** A leitura de que a conta depende falhou sem nada lido: o aviso no lugar da lista, nunca o vazio. */
  falha?: FalhaDasLeituras | null;
  /** A lista dos clientes não veio: a tela não lê com o cliente padrão e diz. */
  clienteFalhou?: boolean;
  /** O catálogo não chegou: o nome do produto é o da caixa, e a tela diz. */
  catalogoFalhou?: boolean;
  /** A nova tentativa pedida está a caminho ("Tentando de novo…" no aviso do catálogo). */
  tentando?: boolean;
  onTentar?: () => Promise<unknown>;
  /** A folha de contagem da primeira rua, para imprimir. */
  hrefDaFolha: string;
}) {
  return (
    <div className="flex flex-col gap-4 pb-24">
      <Link href={VOLTA_DO_RELATORIO.href} className="inline-flex w-fit items-center gap-2 text-sm font-semibold text-primary-texto">
        <ArrowLeft className="size-4" aria-hidden="true" />
        {VOLTA_DO_RELATORIO.rotulo}
      </Link>
      <PageHeader
        title="Caixas × saldo"
        estado={<LinhaDeEstado id={ID_DA_LINHA} leitura={leitura} objeto="prateleiras" />}
        actions={
          <Button asChild variant="outline">
            <Link href={hrefDaFolha}>
              <Printer className="size-4" aria-hidden="true" />
              Folha de contagem
            </Link>
          </Button>
        }
      />
      {clienteFalhou ? (
        <FalhaDoClienteAtivo focoAoSair={ID_DA_LINHA} />
      ) : estado === "carregando" ? (
        // A primeira leitura fica na linha de estado, sob o título; a lista guarda a forma final com as linhas-fantasma.
        <Fantasmas />
      ) : falha ? (
        // A falha nunca vira vazio, e tem a nova tentativa.
        <FalhaNaLeitura leitura={falha.leitura} erro={falha.erro} mensagem={MENSAGEM_DA_FALHA} focoAoSair={ID_DA_LINHA} />
      ) : relatorio ? (
        <>
          {catalogoFalhou ? (
            onTentar ? (
              <FalhaNaSecao mensagem={SEM_CATALOGO} tom="aviso" tentando={tentando} onTentar={onTentar} className="rounded-lg border border-warning-soft-border bg-warning-soft px-4 py-3" />
            ) : (
              <p role="alert" className="rounded-lg border border-warning-soft-border bg-warning-soft px-4 py-3 text-sm font-semibold text-carregando-aviso">
                {SEM_CATALOGO}
              </p>
            )
          ) : null}
          <Prateleiras relatorio={relatorio} />
          <Contagens contagens={contagens} />
        </>
      ) : null}
    </div>
  );
}
