import { getFunctions, httpsCallable } from "firebase/functions";

import { firebaseApp } from "../firebase";

/**
 * Escrita do Comercial: só pelas callables de functions/comercial (região
 * southamerica-east1, como lib/functions-api.ts). Cada chamada leva a chave de
 * idempotência (o recibo fica em comercial_operations) e o servidor confere o
 * estado atual na transação: mark_client só de prospect, local e contato só do
 * mesmo cliente, identidade só sem armazenagem.
 */

export const CALLABLES_DO_CADASTRO = ["saveCommercialCustomer", "saveCustomerLocation", "saveCustomerContact"] as const;
export type CallableDoCadastro = (typeof CALLABLES_DO_CADASTRO)[number];

/** Contratos (parte 8): saveContract confere a edição lida; recordAditivo recusa número que já está no histórico. */
export const CALLABLES_DO_CONTRATO = ["saveContract", "recordAditivo"] as const;
export type CallableDoContrato = (typeof CALLABLES_DO_CONTRATO)[number];

export type CallableDoComercial = CallableDoCadastro | CallableDoContrato;

/** Chave nova por intenção de gravar (um diálogo aberto, um clique de desativar). */
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

export async function chamarComercial<T = Record<string, unknown>>(
  nome: CallableDoComercial,
  dados: Record<string, unknown>,
): Promise<T> {
  if (!firebaseApp) throw new Error("Firebase não configurado.");
  const callable = httpsCallable<Record<string, unknown>, T>(getFunctions(firebaseApp, "southamerica-east1"), nome);
  try {
    return (await callable(dados)).data;
  } catch (error) {
    throw new Error(mensagemDoErro(error));
  }
}
