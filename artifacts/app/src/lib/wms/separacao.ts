import { httpsCallable } from "firebase/functions";

import { SEM_CONEXAO, callableSemResposta } from "../conexao";
import { firebaseApp } from "../firebase";
import { functionsDoApp } from "../firebase-functions";
import { mensagemDoErro } from "../operacao/api";

/**
 * Separar com o progresso salvo (docs/plataforma/separacao-com-caixas.md,
 * partes 2, 3b, 4 e 5): as callables do WMS (functions/wms,
 * domain/pick-progress.ts). `setPickLineSeparated` separa, registra o
 * separado a menos ou desfaz uma linha, e baixa a caixa: a mais antiga da
 * prateleira ou, com `boxes`, as que a pessoa informou em "Outra caixa". O
 * separado entra no volume aberto; com `take_boxes` ("Levar a caixa"), a
 * caixa que sai inteira vira o volume. `closeOrderVolume` fecha o volume
 * aberto, com o peso opcional. `completeOrderSeparation` conclui a separação
 * e a embalagem, com o lacre, numa chamada.
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
  /** Em quais volumes a linha está. */
  volumes?: Array<{ volume_id: string; number: number; qty: number; box_code?: string }>;
  /** O volume fechado que mudou de número, e o fechado de que saiu uma parte: a etiqueta deles precisa sair de novo. */
  renumbered_volumes?: Array<{ volume_id: string; from: number; to: number }>;
  changed_volumes?: Array<{ volume_id: string; number: number }>;
};

export type VolumeFechado = {
  ok: true;
  pick_task_id: string;
  volume_id: string;
  volume_number: number;
  units: number;
  weight_kg?: number;
  closed_at: string;
};

export type SeparacaoConcluida = {
  ok: true;
  pick_task_id: string;
  order_id: string;
  pack_task_id: string;
  shipment_id?: string;
  seal_code: string;
};

async function chamarWms<T>(
  nome: "setPickLineSeparated" | "closeOrderVolume" | "completeOrderSeparation" | "recordBoxBalanceLabelPrint",
  dados: Record<string, unknown>,
): Promise<T> {
  if (!firebaseApp) throw new Error("Firebase não configurado.");
  const callable = httpsCallable<Record<string, unknown>, T>(functionsDoApp(firebaseApp), nome);
  try {
    return (await callable(dados)).data;
  } catch (error) {
    throw new Error(callableSemResposta(error) ? SEM_CONEXAO : mensagemDoErro(error));
  }
}

/**
 * "Separar": a linha inteira, da caixa mais antiga; com `boxes` ("Outra
 * caixa"), das caixas informadas. Com `take_boxes` ("Levar a caixa"), a caixa
 * que sai inteira vira o volume.
 */
export function separarLinha(input: {
  pick_task_id: string;
  pick_line_id: string;
  idempotency_key: string;
  boxes?: Array<{ box_code: string; qty: number }>;
  take_boxes?: boolean;
}) {
  return chamarWms<LinhaSeparada>("setPickLineSeparated", { ...input, separated: true });
}

/** "Fechar volume": o volume aberto fecha com o que tem; o peso é opcional. */
export function fecharVolume(input: { pick_task_id: string; volume_id: string; weight_kg?: number; idempotency_key: string }) {
  return chamarWms<VolumeFechado>("closeOrderVolume", input);
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

/**
 * Registra a impressão da etiqueta com o saldo das caixas abertas (parte 3d):
 * elas saem de "Etiquetas para trocar". A caixa que não está aberta é pulada.
 */
export function registrarEtiquetaDeSaldo(input: { box_codes: string[]; idempotency_key: string }) {
  return chamarWms<{ ok: true; printed: string[]; skipped: string[] }>("recordBoxBalanceLabelPrint", input);
}
