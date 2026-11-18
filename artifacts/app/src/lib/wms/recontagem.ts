import { httpsCallable } from "firebase/functions";

import { callableSemResposta, mensagemDaFalta } from "../conexao";
import { firebaseApp } from "../firebase";
import { functionsDoApp } from "../firebase-functions";
import { mensagemDoErro } from "../operacao/api";
import type { EntradaDaRecontagem, RespostaDaRecontagem } from "../warehouse-ops/recontagem-por-caixa";

import { semCamposVazios } from "./separacao";

/**
 * Recontar uma caixa (contagem por caixa, diagnóstico da Contagem cíclica,
 * seção 6, item 4): a callable `recountWarehouseBox` do WMS (functions/wms,
 * domain/box-recount.ts) grava a caixa e o saldo da prateleira na mesma
 * transação. O campo sem valor não vai: o SDK do Firebase troca o
 * `undefined` por `null`, e o servidor recusa `null` no campo opcional.
 *
 * O erro leva o código da callable (`failed-precondition`, para a tentativa
 * da escrita saber que nada foi gravado) e o motivo do servidor em
 * `detalhe` (`BOX_RECOUNT_LIST_CHANGED` e os outros de box-recount.ts).
 */

export type ErroDaRecontagem = Error & { code?: string; detalhe?: string };

/** O motivo da recusa que o servidor mandou em `details.code`; "" sem ele. */
export function detalheDaRecusa(erro: unknown): string {
  return String((erro as { detalhe?: unknown } | null)?.detalhe ?? "");
}

export async function recontarCaixa(entrada: EntradaDaRecontagem & { idempotency_key: string }): Promise<RespostaDaRecontagem> {
  if (!firebaseApp) throw new Error("Firebase não configurado.");
  const callable = httpsCallable<Record<string, unknown>, RespostaDaRecontagem>(functionsDoApp(firebaseApp), "recountWarehouseBox");
  try {
    return (await callable(semCamposVazios({ ...entrada }))).data;
  } catch (error) {
    const codigo = String((error as { code?: unknown } | null)?.code ?? "").replace(/^functions\//, "");
    const detalhes = (error as { details?: unknown } | null)?.details;
    const detalhe = detalhes && typeof detalhes === "object" ? String((detalhes as { code?: unknown }).code ?? "") : "";
    const erro: ErroDaRecontagem = Object.assign(new Error(callableSemResposta(error) ? mensagemDaFalta() : mensagemDoErro(error)), {
      ...(codigo ? { code: codigo } : {}),
      ...(detalhe ? { detalhe } : {}),
    });
    throw erro;
  }
}
