import { httpsCallable } from "firebase/functions";

import { SEM_CONEXAO, callableSemResposta } from "../conexao";
import { firebaseApp } from "../firebase";
import { functionsDoApp } from "../firebase-functions";
import { mensagemDoErro } from "../operacao/api";

/**
 * Separar com o progresso salvo (docs/plataforma/separacao-com-caixas.md,
 * partes 2, 3b e 5): as callables do WMS (functions/wms,
 * domain/pick-progress.ts). `setPickLineSeparated` separa, registra o
 * separado a menos ou desfaz uma linha, e baixa a caixa: a mais antiga da
 * prateleira ou, com `boxes`, as que a pessoa informou em "Outra caixa".
 * `completeOrderSeparation` conclui a separação e a embalagem, com o lacre,
 * numa chamada.
 */

export type LinhaSeparada = {
  ok: true;
  pick_task_id: string;
  pick_line_id: string;
  separated: boolean;
  changed: boolean;
  expected_qty: number;
  separated_qty: number;
  shortage_reason?: string;
  separated_at?: string;
  /** De quais caixas saiu, e o que saiu sem caixa. */
  boxes?: Array<{ box_code: string; qty: number; whole?: boolean; emptied?: boolean }>;
  loose_qty?: number;
};

export type SeparacaoConcluida = {
  ok: true;
  pick_task_id: string;
  order_id: string;
  pack_task_id: string;
  shipment_id?: string;
  seal_code: string;
};

async function chamarWms<T>(nome: "setPickLineSeparated" | "completeOrderSeparation", dados: Record<string, unknown>): Promise<T> {
  if (!firebaseApp) throw new Error("Firebase não configurado.");
  const callable = httpsCallable<Record<string, unknown>, T>(functionsDoApp(firebaseApp), nome);
  try {
    return (await callable(dados)).data;
  } catch (error) {
    throw new Error(callableSemResposta(error) ? SEM_CONEXAO : mensagemDoErro(error));
  }
}

/** "Separar": a linha inteira, da caixa mais antiga; com `boxes` ("Outra caixa"), das caixas informadas. */
export function separarLinha(input: { pick_task_id: string; pick_line_id: string; idempotency_key: string; boxes?: Array<{ box_code: string; qty: number }> }) {
  return chamarWms<LinhaSeparada>("setPickLineSeparated", { ...input, separated: true });
}

/** "Separar menos": o separado de fato, com o motivo e, se houver, o detalhe. */
export function separarMenos(input: {
  pick_task_id: string;
  pick_line_id: string;
  separated_qty: number;
  shortage_reason: string;
  shortage_detail?: string;
  idempotency_key: string;
}) {
  return chamarWms<LinhaSeparada>("setPickLineSeparated", { ...input, shortage_detail: input.shortage_detail?.trim() || undefined, separated: true });
}

/** "Desfazer": a linha volta a ficar por separar. */
export function desfazerLinha(input: { pick_task_id: string; pick_line_id: string; idempotency_key: string }) {
  return chamarWms<LinhaSeparada>("setPickLineSeparated", { ...input, separated: false });
}

/** "Confirmar separação": a separação e a embalagem, com o lacre. */
export function concluirSeparacao(input: { pick_task_id: string; seal_code: string; idempotency_key: string }) {
  return chamarWms<SeparacaoConcluida>("completeOrderSeparation", input);
}
