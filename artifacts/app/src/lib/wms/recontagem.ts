import { httpsCallable } from "firebase/functions";

import { firebaseApp } from "../firebase";
import { functionsDoApp } from "../firebase-functions";
import type { EntradaDaRecontagem, RespostaDaRecontagem } from "../warehouse-ops/recontagem-por-caixa";

import { erroDaCallable, type ErroDaCallable } from "./erro-da-callable";
import { semCamposVazios } from "./separacao";

export { detalheDaRecusa } from "./erro-da-callable";

/**
 * Recontar uma caixa (contagem por caixa, diagnóstico da Contagem cíclica,
 * seção 6, item 4): a callable `recountWarehouseBox` do WMS (functions/wms,
 * domain/box-recount.ts) grava a caixa e o saldo da prateleira na mesma
 * transação. O campo sem valor não vai: o SDK do Firebase troca o
 * `undefined` por `null`, e o servidor recusa `null` no campo opcional.
 *
 * O erro leva o código da callable (`failed-precondition`, para a tentativa
 * da escrita saber que nada foi gravado) e o motivo do servidor em
 * `detalhe` (`BOX_RECOUNT_LIST_CHANGED` e os outros de box-recount.ts):
 * erro-da-callable.ts, o mesmo das chamadas da rodada.
 */

export type ErroDaRecontagem = ErroDaCallable;

export async function recontarCaixa(entrada: EntradaDaRecontagem & { idempotency_key: string }): Promise<RespostaDaRecontagem> {
  if (!firebaseApp) throw new Error("Firebase não configurado.");
  const callable = httpsCallable<Record<string, unknown>, RespostaDaRecontagem>(functionsDoApp(firebaseApp), "recountWarehouseBox");
  try {
    return (await callable(semCamposVazios({ ...entrada }))).data;
  } catch (error) {
    throw erroDaCallable(error);
  }
}
