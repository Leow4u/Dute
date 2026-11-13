import type { UseQueryResult } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { CarregandoNaRegiao } from "@/components/ui/carregando-na-regiao";
import { BlocoSemConexao, ErroNaLeitura, FaixaSemConexao } from "@/components/ui/erro-na-leitura";
import { CartaoComBrilho, Esqueleto } from "@/components/ui/esqueleto";
import { semConexaoNaLeitura } from "@/lib/conexao";
import { cn } from "@/lib/utils";

/** O pedaço da leitura do react-query que a lista do agente usa. */
export type LeituraDoAgente = Pick<UseQueryResult<unknown>, "data" | "error" | "dataUpdatedAt" | "isLoading" | "isError" | "isFetching" | "refetch">;

/** As linhas-fantasma da lista que ainda lê: blocos neutros com a altura das linhas reais, fora da árvore. */
export function FantasmasDaLista({ linhas = 2, altura = "h-16", className }: { linhas?: number; altura?: string; className?: string }) {
  return (
    <CartaoComBrilho className={cn("flex flex-col gap-2 rounded-xl", className)}>
      {Array.from({ length: linhas }, (_, indice) => (
        <Esqueleto key={indice} className={cn("rounded-xl", altura)} />
      ))}
    </CartaoComBrilho>
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
  const falta = semConexaoNaLeitura(leitura);
  const reler = () => void leitura.refetch();
  if (falta && falta.lidaEm === null) return <BlocoSemConexao tentando={leitura.isFetching} onTentar={reler} className={className} />;
  if (leitura.isLoading) {
    return (
      <div className={cn("flex flex-col gap-3", className)}>
        <CarregandoNaRegiao rotulo={rotulo} />
        {fantasmas ?? <FantasmasDaLista />}
      </div>
    );
  }
  if (leitura.isError && leitura.data === undefined) {
    const mensagem = leitura.error instanceof Error && leitura.error.message ? leitura.error.message : falha;
    return <ErroNaLeitura mensagem={mensagem} tentando={leitura.isFetching} onTentar={reler} className={className} />;
  }
  return (
    <>
      {falta?.lidaEm ? <FaixaSemConexao lidaEm={falta.lidaEm} tentando={leitura.isFetching} onTentar={reler} className={className} /> : null}
      {children}
    </>
  );
}
