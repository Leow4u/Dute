import { httpsCallable } from "firebase/functions";

import { firebaseApp } from "../firebase";
import { functionsDoApp } from "../firebase-functions";

/**
 * Escrita da Operação: só pelas callables de functions/operacao.
 * Cada chamada leva a chave de idempotência (recibo em operacao_operations).
 */

export const CALLABLES_DA_OPERACAO = [
  "saveCollaborator",
  "saveVehicle",
  "saveServiceOrder",
  "openDirectDemand",
  // A entrega pela Dutelog do pedido de saída do WMS (parte 4.5b): vira demanda e OS.
  "openStorageDemand",
  "registerStep",
  "registerItem",
  "registerOccurrence",
  "attachPhoto",
  "registerPresence",
  "completeServiceOrder",
  "reviewServiceOrder",
  "reopenServiceOrder",
  "sendSurveyToCommercial",
  // A solicitação de OS pelo portal (parte 4.4a): o cliente pede; quem coordena recusa (ou abre a demanda direta com ela).
  "requestService",
  "declineServiceRequest",
  // O sino do portal (parte 4.6c): o cliente abriu, os avisos até agora ficam vistos.
  "markNotificationsRead",
  // A leitura da TV da sala (parte 3.12): só lê.
  "getRoomBoard",
] as const;
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

/** O erro da callable com a mensagem já em português e o código (a fila do campo decide pelo código). */
export class ErroDaOperacao extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "ErroDaOperacao";
    this.code = code;
  }
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
    throw new ErroDaOperacao(mensagemDoErro(error), String((error as { code?: unknown })?.code ?? "").replace(/^functions\//, ""));
  }
}
