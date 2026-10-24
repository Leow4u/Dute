import { FieldValue, type DocumentSnapshot, type Firestore, type Transaction } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";

import { BAIXAS_COLLECTION, baixaLida, baixaNoEstorno, idDaBaixa, novaBaixa, osDaFatura, type Baixa } from "./baixa-omie.js";
import { createFinanceiroEvent } from "./events.js";
import type { FinanceiroActor } from "./operations.js";

/**
 * A baixa na Omie gravada (parte 7.4g): nasce na transação do pagamento da
 * fatura que saiu pela Omie, muda na do estorno e anda pela rotina da Omie
 * (omie-rotina.ts). `nf_baixas` não abre pelo navegador (a regra padrão
 * nega): só as Functions do Financeiro leem e gravam.
 */

export function gravarBaixa(transaction: Transaction, db: Firestore, baixa: Baixa, extra: Record<string, unknown> = {}): void {
  transaction.update(db.collection(BAIXAS_COLLECTION).doc(baixa.id), { ...baixa, ...extra, updated_at: FieldValue.serverTimestamp() });
}

export type PagamentoNaFatura = {
  pagamento_id: string;
  fatura_id: string;
  customer_code: string;
  valor_cents: number;
  recebido_em: string;
  iso: string;
  instante: Date;
};

/** No pagamento: a fatura que saiu pela Omie põe a baixa na fila; as outras não têm baixa. */
export function porNaFila(transaction: Transaction, db: Firestore, fatura: Record<string, unknown>, pagamento: PagamentoNaFatura): Baixa | null {
  const naOmie = osDaFatura(fatura);
  if (!naOmie) return null;
  const baixa = novaBaixa({ ...pagamento, ...naOmie }, pagamento.instante);
  transaction.create(db.collection(BAIXAS_COLLECTION).doc(baixa.id), {
    ...baixa,
    criada_em: pagamento.iso,
    created_at: FieldValue.serverTimestamp(),
    updated_at: FieldValue.serverTimestamp(),
  });
  return baixa;
}

/** A leitura da baixa do pagamento estornado, antes de qualquer escrita da transação; null sem a Omie. */
export async function lerBaixaDoPagamento(transaction: Transaction, db: Firestore, fatura: Record<string, unknown>, pagamentoId: string): Promise<DocumentSnapshot | null> {
  if (!osDaFatura(fatura)) return null;
  return transaction.get(db.collection(BAIXAS_COLLECTION).doc(idDaBaixa(pagamentoId)));
}

/**
 * No estorno: a baixa que pode ter saído vai a cancelar na Omie; a que nunca
 * saiu fica cancelada aqui, com o evento. Sem baixa (o pagamento de antes da
 * parte 7.4g), nada muda.
 */
export function estornarBaixa(
  transaction: Transaction,
  db: Firestore,
  snap: DocumentSnapshot | null,
  contexto: { instante: Date; iso: string; operationId: string; ator: FinanceiroActor },
): Baixa | null {
  if (!snap?.exists) return null;
  let atual: Baixa;
  try {
    atual = baixaLida(snap.id, snap.data() ?? {});
  } catch {
    throw new HttpsError("failed-precondition", "A baixa deste pagamento na Omie está ilegível.");
  }
  const nova = baixaNoEstorno(atual, contexto.instante);
  if (!nova) return null;
  gravarBaixa(transaction, db, nova, { estornada_em: contexto.iso });
  if (nova.etapa === "cancelada") {
    createFinanceiroEvent(transaction, db, {
      operation_id: contexto.operationId,
      suffix: "nf.settlement_cancelled",
      type: "nf.settlement_cancelled",
      entity_id: nova.id,
      customer_code: nova.customer_code,
      payload: { id: nova.id, pagamento_id: nova.pagamento_id },
      actor: contexto.ator,
      occurred_at: contexto.iso,
    });
  }
  return nova;
}
