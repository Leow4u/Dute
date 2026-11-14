import { useEffect, useMemo, useRef, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { collection, doc, getDoc, query, where, type DocumentData } from "firebase/firestore";

import { contratoDoDocumento } from "../comercial/clientes";
import { firestore } from "../firebase";
import type { ItemDoInicio } from "../inicio-do-modulo";
import type { ProfileRole } from "../modules";
import { juntarTentativas, novaTentativaDe, useLeitura, type NovaTentativa } from "../operacao/leitura";
import {
  ETAPAS_DA_FILA,
  autorizacaoDoFinanceiro,
  competenciaDoFinanceiro,
  demandaDoFinanceiro,
  fonteDoValor,
  linhaAFaturar,
  linhaDaArmazenagem,
  linhaDaMedicao,
  medicaoDoFinanceiro,
  valorDaRv,
  type AutorizacaoDoFinanceiro,
  type LinhaAFaturar,
} from "./a-faturar";
import type { FaturaDoFinanceiro } from "./faturas";
import { itensDoInicioDoFinanceiro } from "./inicio";
import { abreFinanceiro } from "./navegacao";
import { useBaixasDoFinanceiro } from "./use-baixas";
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
 * - O valor de cada demanda: a RV validada (congelada no envio), lida uma
 *   vez por minuto no máximo.
 * - A armazenagem emitida no WMS e fora de NF (parte 7.2b), ao vivo, com o
 *   total da foto da emissão. As regras abrem `billing_periods` a quem lê o
 *   faturamento, que inclui os papéis do Financeiro.
 * - A medição enviada ou aprovada e fora de NF (pergunta 64), ao vivo, com a
 *   autorização dela e o contrato, que dá o número para a linha (sem esperar:
 *   sem ele, a linha diz "Medição mensal"). A demanda presa a uma medição vai
 *   na linha da medição, nunca à parte.
 */

export type FilaDoFinanceiro = {
  /** As linhas da fila; undefined enquanto alguma leitura não chegou. */
  linhas: LinhaAFaturar[] | undefined;
  carregando: boolean;
  /** As leituras que falharam, em palavras ("demandas", "autorizações", "valores"). */
  falhas: string[];
  /**
   * A nova tentativa (parte 13g): assina de novo as leituras ao vivo que
   * falharam e relê as que vêm por consulta; a falha fica na tela até elas
   * responderem.
   */
  releitura: NovaTentativa;
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
  const medicoes = useLeitura(
    abre ? "financeiro:medicoes" : null,
    (db) => query(collection(db, "medicoes"), where("status", "in", ["enviada", "aprovada"])),
    medicaoDoFinanceiro,
  );
  const lidas = demandas.itens;
  const daMedicao = medicoes.itens;
  // A demanda presa a uma medição fatura com ela: só a de fora entra sozinha na fila.
  const avulsas = useMemo(() => (lidas ?? []).filter((demanda) => demanda.medicaoId === null), [lidas]);
  const ids = useMemo(
    () => unicos([...avulsas.flatMap((demanda) => demanda.autorizacaoIds), ...(daMedicao ?? []).map((medicao) => medicao.autorizacaoId)]),
    [avulsas, daMedicao],
  );
  const fontes = useMemo(
    () => unicos(avulsas.flatMap((demanda) => {
      const fonte = fonteDoValor(demanda);
      return fonte ? [fonte] : [];
    })),
    [avulsas],
  );
  const contratoIds = useMemo(() => unicos((daMedicao ?? []).flatMap((medicao) => (medicao.contratoId ? [medicao.contratoId] : []))), [daMedicao]);
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
  const contratos = useQueries({
    queries: contratoIds.map((id) => ({
      queryKey: ["financeiro", "contrato-da-medicao", id],
      queryFn: () => lerDocumento(`contracts/${id}`),
      staleTime: 300_000,
      retry: 1,
      enabled: abre,
    })),
  });

  // A nova tentativa das consultas: o react-query volta a leitura sem dado a "pending", e a falha de antes fica na
  // tela até elas responderem (o aviso não sai com o foco nele).
  const [tentandoConsultas, setTentandoConsultas] = useState(false);
  const falhasDeAntes = useRef<string[]>([]);
  const consultas = [...autorizacoes, ...documentos];
  const consultasLendo = consultas.some((leitura) => leitura.isFetching);
  useEffect(() => {
    if (tentandoConsultas && !consultasLendo) setTentandoConsultas(false);
  }, [tentandoConsultas, consultasLendo]);
  const aoVivo = novaTentativaDe([demandas, periodos, medicoes]);
  const releitura = juntarTentativas(aoVivo, {
    tentando: tentandoConsultas,
    tentar: () => {
      const falharam = consultas.filter((leitura) => leitura.isError);
      if (!falharam.length) return;
      setTentandoConsultas(true);
      for (const leitura of falharam) void leitura.refetch();
    },
  });

  if (!abre) return { linhas: undefined, carregando: false, falhas: [], releitura };

  const falhasAgora = [
    demandas.erro ? "demandas" : null,
    periodos.erro ? "armazenagem" : null,
    medicoes.erro ? "medições" : null,
    autorizacoes.some((leitura) => leitura.isError) ? "autorizações" : null,
    documentos.some((leitura) => leitura.isError) ? "valores" : null,
  ].filter((falha): falha is string => falha !== null);
  if (falhasAgora.length) falhasDeAntes.current = falhasAgora;
  const falhas = falhasAgora.length ? falhasAgora : tentandoConsultas && consultasLendo ? falhasDeAntes.current : [];
  const pendente =
    lidas === null || periodos.itens === null || daMedicao === null || autorizacoes.some((leitura) => leitura.isPending) || documentos.some((leitura) => leitura.isPending);
  if (falhas.length || pendente || !lidas || !periodos.itens || !daMedicao) return { linhas: undefined, carregando: !falhas.length && pendente, falhas, releitura };

  const porId = new Map<string, AutorizacaoDoFinanceiro>();
  ids.forEach((id, indice) => {
    const dados = autorizacoes[indice]?.data;
    if (dados) porId.set(id, autorizacaoDoFinanceiro(id, dados));
  });
  const porFonte = new Map(fontes.map((caminho, indice) => [caminho, documentos[indice]?.data ?? null]));
  const porNumero = new Map(lidas.map((demanda) => [demanda.numero, demanda]));
  const rotuloDoContrato = new Map(
    contratoIds.flatMap((id, indice) => {
      const dados = contratos[indice]?.data;
      const contrato = dados ? contratoDoDocumento(id, dados) : null;
      return contrato ? [[id, contrato.numeros[0] ?? contrato.nome] as const] : [];
    }),
  );
  const linhas = [
    ...avulsas.map((demanda) => {
      const fonte = fonteDoValor(demanda);
      return linhaAFaturar(demanda, porId, fonte ? valorDaRv(porFonte.get(fonte)) : null);
    }),
    ...periodos.itens.map(linhaDaArmazenagem),
    ...daMedicao.map((medicao) => linhaDaMedicao(medicao, porNumero, porId, medicao.contratoId ? (rotuloDoContrato.get(medicao.contratoId) ?? null) : null)),
  ];
  return { linhas, carregando: false, falhas: [], releitura };
}

export type InicioDoFinanceiro = {
  itens: ItemDoInicio[];
  linhas: LinhaAFaturar[] | undefined;
  faturas: FaturaDoFinanceiro[] | undefined;
  carregando: boolean;
  falhas: string[];
  /** A nova tentativa das quatro leituras (parte 13g): o "Tentar de novo" do Início. */
  releitura?: NovaTentativa;
};

/**
 * O "Precisa de você" do Financeiro (lib/financeiro/inicio.ts), das mesmas
 * leituras das telas. `ligado` falso não assina nada.
 */
export function useInicioDoFinanceiro(role: ProfileRole | null | undefined, agora: Date = new Date(), ligado = true): InicioDoFinanceiro {
  const fila = useFilaDoFinanceiro(role, ligado);
  const cobranca = useFaturas(role, ligado);
  const emissoes = useEmissoesDoFinanceiro(role, ligado);
  const baixas = useBaixasDoFinanceiro(role, ligado);
  const falhas = [...fila.falhas, ...cobranca.falhas, ...emissoes.falhas, ...baixas.falhas];
  const itens =
    fila.linhas && cobranca.faturas && emissoes.emissoes && baixas.baixas ? itensDoInicioDoFinanceiro(fila.linhas, cobranca.faturas, agora, emissoes.emissoes, baixas.baixas) : [];
  return {
    // Sem todas as leituras, uma lista parcial diria "nada parado" sem saber.
    itens: falhas.length ? [] : itens,
    linhas: fila.linhas,
    faturas: cobranca.faturas,
    carregando: !falhas.length && (fila.carregando || cobranca.carregando || emissoes.carregando || baixas.carregando),
    falhas,
    releitura: juntarTentativas(fila.releitura, cobranca.releitura, emissoes.releitura, baixas.releitura),
  };
}
