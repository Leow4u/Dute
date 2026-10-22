import { httpsCallable } from "firebase/functions";

import { firebaseApp } from "../firebase";
import { functionsDoApp } from "../firebase-functions";

/**
 * Escrita da Operação: só pelas callables de functions/operacao.
 * Cada chamada leva a chave de idempotência (recibo em operacao_operations).
 */

export const CALLABLES_DA_OPERACAO = ["saveCollaborator", "saveVehicle", "saveServiceOrder"] as const;
export type CallableDaOperacao = (typeof CALLABLES_DA_OPERACAO)[number];

export function novaChave(): string {
  return crypto.randomUUID();
}

export function mensagemDoErro(error: unknown): string {
  const code = String((error as { code?: unknown })?.code ?? "").replace(/^functions\//, "");
  const message = error instanceof Error ? error.message : "";
  if (!message || message === "INTERNAL" || code === "internal") {
    return "Falha interna no servidor. Tente novamente ou avise o time técnico.";
  }
  return message;
}

export async function chamarOperacao<T = Record<string, unknown>>(
  nome: CallableDaOperacao,
  dados: Record<string, unknown>,
): Promise<T> {
  if (!firebaseApp) throw new Error("Firebase não configurado.");
  const callable = httpsCallable<Record<string, unknown>, T>(functionsDoApp(firebaseApp), nome);
  try {
    return (await callable(dados)).data;
  } catch (error) {
    throw new Error(mensagemDoErro(error));
  }
}
