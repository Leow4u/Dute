import { httpsCallable } from "firebase/functions";

import { firebaseApp } from "../firebase";
import { functionsDoApp } from "../firebase-functions";
import type { EntradaDoMover, PreviaDoMover, ResultadoDoMover } from "../warehouse-ops/mover-caixa";

import { erroDaCallable } from "./erro-da-callable";
import { semCamposVazios } from "./separacao";

/**
 * Mover caixa entre prateleiras (docs/superpowers/specs/2026-11-19-mover-caixa-design.md):
 * as callables do WMS (functions/wms, domain/box-move.ts). A prévia só lê; o
 * mover grava a caixa, o saldo das duas prateleiras, o razão e as linhas da
 * abertura numa transação. O campo sem valor não vai: o SDK do Firebase
 * troca o `undefined` por `null`, e o servidor recusa `null` no campo
 * opcional. O erro leva o código da callable e o motivo do servidor em
 * `detalhe` (`BOX_MOVE_RESERVED` e os outros de box-move.ts).
 */

export async function previaDoMover(entrada: { customer_code: string; box_code: string }): Promise<PreviaDoMover> {
  if (!firebaseApp) throw new Error("Firebase não configurado.");
  const callable = httpsCallable<Record<string, unknown>, PreviaDoMover>(functionsDoApp(firebaseApp), "previewWarehouseBoxMove");
  try {
    return (await callable(semCamposVazios({ ...entrada }))).data;
  } catch (error) {
    throw erroDaCallable(error);
  }
}

export async function moverCaixa(entrada: EntradaDoMover & { idempotency_key: string }): Promise<ResultadoDoMover> {
  if (!firebaseApp) throw new Error("Firebase não configurado.");
  const callable = httpsCallable<Record<string, unknown>, ResultadoDoMover>(functionsDoApp(firebaseApp), "moveWarehouseBox");
  try {
    return (await callable(semCamposVazios({ ...entrada }))).data;
  } catch (error) {
    throw erroDaCallable(error);
  }
}
