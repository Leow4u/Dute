import { httpsCallable } from "firebase/functions";

import { firebaseApp } from "../firebase";
import { functionsDoApp } from "../firebase-functions";

/**
 * O RH só pelas callables de functions/rh (docs/plataforma/fase-8-rh.md): o
 * banco `rh` é fechado ao navegador. A leitura volta de novo depois de cada
 * gravação; cada gravação leva a chave de idempotência (recibo em
 * rh_operations) e o servidor confere o papel e a edição.
 */

export const CALLABLES_DO_RH = [
  "getRhPanel",
  "getRhFicha",
  "saveRhRecord",
  "archiveRhRecord",
  "requestRhUpload",
  "attachRhFile",
  "openRhFile",
] as const;
export type CallableDoRh = (typeof CALLABLES_DO_RH)[number];

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

export async function chamarRh<T = Record<string, unknown>>(nome: CallableDoRh, dados: Record<string, unknown>): Promise<T> {
  if (!firebaseApp) throw new Error("Firebase não configurado.");
  const callable = httpsCallable<Record<string, unknown>, T>(functionsDoApp(firebaseApp), nome);
  try {
    return (await callable(dados)).data;
  } catch (error) {
    throw new Error(mensagemDoErro(error));
  }
}
