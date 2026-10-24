import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { collection, doc, getDoc, query, where, type DocumentData } from "firebase/firestore";

import { firestore } from "../firebase";
import type { ItemDoInicio } from "../inicio-do-modulo";
import type { ProfileRole } from "../modules";
import { useLeitura } from "../operacao/leitura";
import {
  ETAPAS_DA_FILA,
  autorizacaoDoFinanceiro,
  competenciaDoFinanceiro,
  demandaDoFinanceiro,
  fonteDoValor,
  linhaAFaturar,
  linhaDaArmazenagem,
  valorDaFonte,
  type AutorizacaoDoFinanceiro,
  type LinhaAFaturar,
} from "./a-faturar";
import type { FaturaDoFinanceiro } from "./faturas";
import { itensDoInicioDoFinanceiro } from "./inicio";
import { abreFinanceiro } from "./navegacao";
import { useEmissoesDoFinanceiro } from "./use-emissoes";
import { useFaturas } from "./use-faturas";

/**
 * As leituras do Financeiro, ao vivo como o resto da plataforma, e só para
 * quem abre o módulo (owner, admin e financeiro): para os outros papéis, nada
 * é assinado. As regras abrem `demands` a quem lê demandas e as autorizações,
 * as RVs e as medições a quem lê preço. A escrita é só da callable
 * registerNf.
 *
 * - As demandas A faturar e Aguardando autorização, ao vivo.
 * - Cada autorização citada pelas demandas, lida pelo id (a fila do Comercial
 *   lê só as mais recentes; aqui cada demanda precisa da dela).
 * - O valor de cada demanda: a RV validada (congelada no envio) ou a medição
 *   aprovada, lidas uma vez por minuto no máximo.
 * - A armazenagem emitida no WMS e fora de NF (parte 7.2b), ao vivo, com o
 *   total da foto da emissão. As regras abrem `billing_periods` a quem lê o
 *   faturamento, que inclui os papéis do Financeiro.
 */

export type FilaDoFinanceiro = {
  /** As linhas da fila; undefined enquanto alguma leitura não chegou. */
  linhas: LinhaAFaturar[] | undefined;
  carregando: boolean;
  /** As leituras que falharam, em palavras ("demandas", "autorizações", "valores"). */
  falhas: string[];
};

async function lerDocumento(caminho: string): Promise<DocumentData | null> {
  if (!firestore) throw new Error("Firebase não configurado.");
  const snapshot = await getDoc(doc(firestore, caminho));
  return snapshot.exists() ? snapshot.data() : null;
}

function unicos(valores: readonly string[]): string[] {
  return [...new Set(valores)].sort();
}

export function useFilaDoFinanceiro(role: ProfileRole | null | undefined, ligado = true): FilaDoFinanceiro {
  const abre = ligado && abreFinanceiro(role);
  const demandas = useLeitura(
    abre ? "financeiro:demands" : null,
    (db) => query(collection(db, "demands"), where("etapa", "in", [...ETAPAS_DA_FILA])),
    demandaDoFinanceiro,
  );
  const periodos = useLeitura(
    abre ? "financeiro:billing_periods" : null,
    (db) => query(collection(db, "billing_periods"), where("status", "==", "emitido")),
    competenciaDoFinanceiro,
  );
  const lidas = demandas.itens;
  const ids = useMemo(() => unicos((lidas ?? []).flatMap((demanda) => demanda.autorizacaoIds)), [lidas]);
  const fontes = useMemo(
    () => unicos((lidas ?? []).flatMap((demanda) => {
      const fonte = fonteDoValor(demanda);
      return fonte ? [fonte] : [];
    })),
    [lidas],
  );
  const autorizacoes = useQueries({
    queries: ids.map((id) => ({
      queryKey: ["financeiro", "autorizacao", id],
      queryFn: () => lerDocumento(`client_authorizations/${id}`),
      staleTime: 30_000,
      retry: 1,
      enabled: abre,
    })),
  });
  const documentos = useQueries({
    queries: fontes.map((caminho) => ({
      queryKey: ["financeiro", "valor", caminho],
      queryFn: () => lerDocumento(caminho),
      staleTime: 60_000,
      retry: 1,
      enabled: abre,
    })),
  });

  if (!abre) return { linhas: undefined, carregando: false, falhas: [] };

  const falhas = [
    demandas.erro ? "demandas" : null,
    periodos.erro ? "armazenagem" : null,
    autorizacoes.some((leitura) => leitura.isError) ? "autorizações" : null,
    documentos.some((leitura) => leitura.isError) ? "valores" : null,
  ].filter((falha): falha is string => falha !== null);
  const pendente = lidas === null || periodos.itens === null || autorizacoes.some((leitura) => leitura.isPending) || documentos.some((leitura) => leitura.isPending);
  if (falhas.length || pendente || !lidas || !periodos.itens) return { linhas: undefined, carregando: !falhas.length && pendente, falhas };

  const porId = new Map<string, AutorizacaoDoFinanceiro>();
  ids.forEach((id, indice) => {
    const dados = autorizacoes[indice]?.data;
    if (dados) porId.set(id, autorizacaoDoFinanceiro(id, dados));
  });
  const porFonte = new Map(fontes.map((caminho, indice) => [caminho, documentos[indice]?.data ?? null]));
  const linhas = [
    ...lidas.map((demanda) => {
      const fonte = fonteDoValor(demanda);
      return linhaAFaturar(demanda, porId, fonte ? valorDaFonte(demanda, porFonte.get(fonte)) : null);
    }),
    ...periodos.itens.map(linhaDaArmazenagem),
  ];
  return { linhas, carregando: false, falhas: [] };
}

export type InicioDoFinanceiro = {
  itens: ItemDoInicio[];
  linhas: LinhaAFaturar[] | undefined;
  faturas: FaturaDoFinanceiro[] | undefined;
  carregando: boolean;
  falhas: string[];
};

/**
 * O "Precisa de você" do Financeiro (lib/financeiro/inicio.ts), das mesmas
 * leituras das telas. `ligado` falso não assina nada.
 */
export function useInicioDoFinanceiro(role: ProfileRole | null | undefined, agora: Date = new Date(), ligado = true): InicioDoFinanceiro {
  const fila = useFilaDoFinanceiro(role, ligado);
  const cobranca = useFaturas(role, ligado);
  const emissoes = useEmissoesDoFinanceiro(role, ligado);
  const falhas = [...fila.falhas, ...cobranca.falhas, ...emissoes.falhas];
  const itens = fila.linhas && cobranca.faturas && emissoes.emissoes ? itensDoInicioDoFinanceiro(fila.linhas, cobranca.faturas, agora, emissoes.emissoes) : [];
  return {
    // Sem todas as leituras, uma lista parcial diria "nada parado" sem saber.
    itens: falhas.length ? [] : itens,
    linhas: fila.linhas,
    faturas: cobranca.faturas,
    carregando: !falhas.length && (fila.carregando || cobranca.carregando || emissoes.carregando),
    falhas,
  };
}
