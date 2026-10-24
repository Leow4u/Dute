import { httpsCallable } from "firebase/functions";

import { firebaseApp } from "../firebase";
import { functionsDoApp } from "../firebase-functions";

/**
 * Escrita do Financeiro: só pelas callables de functions/financeiro (região
 * southamerica-east1, como o resto). Cada chamada leva a chave de
 * idempotência (recibo em financeiro_operations) e o servidor confere de novo
 * a etapa, o cliente, a autorização e o valor de cada demanda.
 */

/**
 * registerNf (parte 4.1a), advanceFatura (parte 4.2a: enviar, pagar, estornar
 * e cancelar) e a NFS-e pela Omie (parte 7.4): emitNfOmie, actOnNfEmission e
 * listNfEmissions.
 */
export const CALLABLES_DO_FINANCEIRO = ["registerNf", "advanceFatura", "emitNfOmie", "actOnNfEmission", "listNfEmissions"] as const;
export type CallableDoFinanceiro = (typeof CALLABLES_DO_FINANCEIRO)[number];

/** Chave nova por intenção de gravar (um painel aberto). */
export function novaChave(): string {
  return crypto.randomUUID();
}

/** Mensagem do erro da callable: a do servidor (em português) ou uma genérica para "internal". */
export function mensagemDoErro(error: unknown): string {
  const code = String((error as { code?: unknown })?.code ?? "").replace(/^functions\//, "");
  const message = error instanceof Error ? error.message : "";
  if (!message || message === "INTERNAL" || code === "internal") {
    return "Falha interna no servidor. Tente novamente ou avise o time técnico.";
  }
  return message;
}

export async function chamarFinanceiro<T = Record<string, unknown>>(nome: CallableDoFinanceiro, dados: Record<string, unknown>): Promise<T> {
  if (!firebaseApp) throw new Error("Firebase não configurado.");
  const callable = httpsCallable<Record<string, unknown>, T>(functionsDoApp(firebaseApp), nome);
  try {
    return (await callable(dados)).data;
  } catch (error) {
    throw new Error(mensagemDoErro(error));
  }
}
