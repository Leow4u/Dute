import type { UseQueryResult } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { CarregandoNaRegiao } from "@/components/ui/carregando-na-regiao";
import { BlocoSemConexao, ErroNaLeitura, FaixaSemConexao } from "@/components/ui/erro-na-leitura";
import { CartaoComBrilho, Esqueleto } from "@/components/ui/esqueleto";
import { useEspera } from "@/lib/carregando/use-espera";
import { useLeituraComFalha } from "@/lib/carregando/use-leitura-com-falha";
import { semConexaoNaLeitura } from "@/lib/conexao";
import { cn } from "@/lib/utils";

/** O pedaço da leitura do react-query que a lista do agente usa. */
export type LeituraDoAgente = Pick<
  UseQueryResult<unknown>,
  "data" | "error" | "errorUpdatedAt" | "errorUpdateCount" | "dataUpdatedAt" | "isLoading" | "isError" | "isFetching" | "refetch"
>;

/**
 * As linhas-fantasma da lista que ainda lê: blocos neutros com a altura das
 * linhas reais, fora da árvore. Entram aos 300 ms, como o rótulo (seção 3):
 * antes, o lugar fica guardado e vazio, e a leitura rápida não pisca os
 * blocos. O brilho começa quando eles aparecem.
 */
export function FantasmasDaLista({ linhas = 2, altura = "h-16", className }: { linhas?: number; altura?: string; className?: string }) {
  const visivel = useEspera(true).visivel;
  const blocos = Array.from({ length: linhas }, (_, indice) => <Esqueleto key={indice} className={cn("rounded-xl", altura)} />);
  const forma = cn("flex flex-col gap-2 rounded-xl", className);
  return visivel ? (
    <CartaoComBrilho className={forma}>{blocos}</CartaoComBrilho>
  ) : (
    <div aria-hidden="true" data-fantasmas-guardados="" className={cn(forma, "invisible")}>
      {blocos}
    </div>
  );
}

/**
 * Os estados da leitura de uma lista do Agent Dute (anotações, playbooks,
 * rotinas), no carregamento v2: lendo, a caixa com o rótulo depois de 300 ms
 * ("Carregando anotações…") e as linhas-fantasma; sem conexão e sem nada lido,
 * o aviso no lugar da lista; sem conexão com a lista lida, ela fica, com "Sem
 * conexão · lista de 10:42" ou "Reconectando…" (o estado único da conexão,
 * parte 7a); a falha do servidor nunca vira vazio, e mostra o motivo com o
 * "Tentar de novo".
 */
export function LeituraDaLista({
  leitura,
  rotulo,
  fantasmas,
  falha,
  className,
  children,
}: {
  leitura: LeituraDoAgente;
  /** "Carregando anotações…" */
  rotulo: string;
  fantasmas?: ReactNode;
  /** A mensagem da falha sem texto do servidor. */
  falha: string;
  className?: string;
  children: ReactNode;
}) {
  // A falha fica na tela enquanto tenta de novo: o "Tentar de novo" não some com o foco nele.
  const lida = useLeituraComFalha(leitura);
  const falta = semConexaoNaLeitura(lida);
  const reler = () => void leitura.refetch();
  if (falta && falta.lidaEm === null) return <BlocoSemConexao tentando={lida.isFetching} onTentar={reler} className={className} />;
  if (lida.isLoading) {
    return (
      <div className={cn("flex flex-col gap-3", className)}>
        <CarregandoNaRegiao rotulo={rotulo} />
        {fantasmas ?? <FantasmasDaLista />}
      </div>
    );
  }
  if (lida.isError && lida.data === undefined) {
    const mensagem = lida.error instanceof Error && lida.error.message ? lida.error.message : falha;
    return <ErroNaLeitura mensagem={mensagem} tentando={lida.isFetching} onTentar={reler} className={className} />;
  }
  return (
    <>
      {falta?.lidaEm ? <FaixaSemConexao lidaEm={falta.lidaEm} tentando={lida.isFetching} onTentar={reler} className={className} /> : null}
      {children}
    </>
  );
}
