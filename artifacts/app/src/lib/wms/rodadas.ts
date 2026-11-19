import { httpsCallable } from "firebase/functions";

import { firebaseApp } from "../firebase";
import { functionsDoApp } from "../firebase-functions";
import type { EntradaDoInicio } from "../warehouse-ops/rodadas-da-contagem";

import { erroDaCallable } from "./erro-da-callable";
import { semCamposVazios } from "./separacao";

/**
 * A rodada da contagem (o registro da rodada, 18/11/2026): as callables
 * `startCountRound` e `completeCountRound` do WMS (functions/wms,
 * domain/count-rounds.ts). O campo sem valor não vai: o SDK do Firebase troca
 * o `undefined` por `null`, e o servidor recusa `null` no campo opcional.
 */

export type RespostaDoInicio = { ok?: boolean; round_id: string; title: string; status?: string; started_at?: string };

export type RespostaDaConclusao = {
  ok?: boolean;
  round_id: string;
  title: string;
  status?: string;
  started_at?: string;
  closed_at?: string;
  shelves_total?: number;
  shelves_counted?: number;
  boxes_total?: number;
  boxes_counted?: number;
  boxes_with_difference?: number;
  difference_units?: number;
};

async function chamar<Resposta>(nome: string, entrada: Record<string, unknown>): Promise<Resposta> {
  if (!firebaseApp) throw new Error("Firebase não configurado.");
  const callable = httpsCallable<Record<string, unknown>, Resposta>(functionsDoApp(firebaseApp), nome);
  try {
    return (await callable(semCamposVazios({ ...entrada }))).data;
  } catch (error) {
    throw erroDaCallable(error);
  }
}

export function iniciarContagem(entrada: EntradaDoInicio & { idempotency_key: string }): Promise<RespostaDoInicio> {
  return chamar<RespostaDoInicio>("startCountRound", entrada);
}

export function concluirContagem(entrada: { customer_code: string; round_id: string; idempotency_key: string }): Promise<RespostaDaConclusao> {
  return chamar<RespostaDaConclusao>("completeCountRound", entrada);
}
