import { httpsCallable } from "firebase/functions";

import { firebaseApp } from "../firebase";
import { functionsDoApp } from "../firebase-functions";
import { mensagemDoErro } from "../operacao/api";

/**
 * As callables da memória da Dute, em functions/core (docs/plataforma/fase-5-memoria.md).
 * O teste api.test.ts trava a lista contra as exportadas pela codebase.
 */

export const CALLABLES_DO_NUCLEO = [
  // A duração sugerida no Planejar OS (parte 5.2a): só lê.
  "suggestDuration",
  // O que a pessoa fez com a sugestão, gravado quando a OS é salva.
  "answerSuggestion",
  // Os orçamentos parecidos do mesmo cliente, na montagem do orçamento (parte 5.3b): só lê.
  "findSimilarQuotes",
  // A decisão da coordenação sobre o alerta do item parado (parte 5.4d): aprovar com os itens ou descartar.
  "answerStockAlert",
] as const;
export type CallableDoNucleo = (typeof CALLABLES_DO_NUCLEO)[number];

export async function chamarNucleo<T = Record<string, unknown>>(nome: CallableDoNucleo, dados: Record<string, unknown>): Promise<T> {
  if (!firebaseApp) throw new Error("Firebase não configurado.");
  const callable = httpsCallable<Record<string, unknown>, T>(functionsDoApp(firebaseApp), nome);
  try {
    return (await callable(dados)).data;
  } catch (error) {
    throw new Error(mensagemDoErro(error));
  }
}
