import { httpsCallable } from "firebase/functions";
import { functionsDoApp } from "../firebase-functions";

import { firebaseApp } from "../firebase";

/**
 * Escrita do Comercial: só pelas callables de functions/comercial (região
 * southamerica-east1, como lib/functions-api.ts). Cada chamada leva a chave de
 * idempotência (o recibo fica em comercial_operations) e o servidor confere o
 * estado atual na transação: mark_client só de prospect, local e contato só do
 * mesmo cliente, identidade só sem armazenagem; no orçamento, a situação e a
 * edição que a tela viu (expected_status e expected_edicao).
 */

export const CALLABLES_DO_CADASTRO = ["saveCommercialCustomer", "saveCustomerLocation", "saveCustomerContact"] as const;
export type CallableDoCadastro = (typeof CALLABLES_DO_CADASTRO)[number];

/** Contratos (parte 8): saveContract confere a edição lida; recordAditivo recusa número que já está no histórico. */
export const CALLABLES_DO_CONTRATO = ["saveContract", "recordAditivo"] as const;
export type CallableDoContrato = (typeof CALLABLES_DO_CONTRATO)[number];

/** Demanda e orçamento (parte 9, domain/quotes.ts): a chave vai em `request_id`. */
export const CALLABLES_DO_ORCAMENTO = ["saveQuote", "advanceQuote"] as const;
export type CallableDoOrcamento = (typeof CALLABLES_DO_ORCAMENTO)[number];

/**
 * Autorização de faturamento (parte 15a, domain/autorizacoes.ts): registrar e
 * cancelar. A chave vai em `request_id`; o servidor confere a etapa de cada
 * demanda e recalcula o valor das RVs.
 */
export const CALLABLES_DA_AUTORIZACAO = ["recordAuthorization"] as const;
export type CallableDaAutorizacao = (typeof CALLABLES_DA_AUTORIZACAO)[number];

/** Medição mensal (parte 16a, domain/medicoes.ts): saveMedicao (create, upsert_line, remove_line) e advanceMedicao (send, approve, contest, reopen). */
export const CALLABLES_DA_MEDICAO = ["saveMedicao", "advanceMedicao"] as const;
export type CallableDaMedicao = (typeof CALLABLES_DA_MEDICAO)[number];

/** A demanda depois do envio (parte 10): fechar, perder, reabrir, registrar a execução, validar e recusar o aditivo. */
export const CALLABLES_DA_DEMANDA = ["advanceDemand"] as const;
export type CallableDaDemanda = (typeof CALLABLES_DA_DEMANDA)[number];

export type CallableDoComercial =
  | CallableDoCadastro
  | CallableDoContrato
  | CallableDoOrcamento
  | CallableDaAutorizacao
  | CallableDaMedicao
  | CallableDaDemanda;

/** Chave nova por intenção de gravar (um diálogo aberto, um clique de desativar). */
export function novaChave(): string {
  return crypto.randomUUID();
}

/** Mensagem do erro da callable: a do servidor (em português) ou uma genérica para "internal". */
export function mensagemDoErro(error: unknown): string {
  const code = codigoDoErro(error);
  const message = error instanceof Error ? error.message : "";
  if (!message || message === "INTERNAL" || code === "internal") {
    return "Falha interna no servidor. Tente novamente ou avise o time técnico.";
  }
  return message;
}

/** O código do HttpsError sem o prefixo do SDK ("functions/failed-precondition" → "failed-precondition"). */
export function codigoDoErro(error: unknown): string {
  return String((error as { code?: unknown })?.code ?? "").replace(/^functions\//, "");
}

/**
 * Erro de uma callable do Comercial: a mensagem do servidor e o código, que a
 * tela usa para decidir se recarrega (situação ou edição divergente).
 */
export class ErroDaCallable extends Error {
  readonly codigo: string;

  constructor(mensagem: string, codigo: string) {
    super(mensagem);
    this.name = "ErroDaCallable";
    this.codigo = codigo;
  }
}

export async function chamarComercial<T = Record<string, unknown>>(
  nome: CallableDoComercial,
  dados: Record<string, unknown>,
): Promise<T> {
  if (!firebaseApp) throw new Error("Firebase não configurado.");
  const callable = httpsCallable<Record<string, unknown>, T>(functionsDoApp(firebaseApp), nome);
  try {
    return (await callable(dados)).data;
  } catch (error) {
    throw new ErroDaCallable(mensagemDoErro(error), codigoDoErro(error));
  }
}
