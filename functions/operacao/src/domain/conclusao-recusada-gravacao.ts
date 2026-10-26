import type { Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";

import type { PedidoDeConclusao } from "./conclusao.js";
import { conclusaoRecusadaLida, interpretarResolucao, recusaDaConclusao, recusaResolvida } from "./conclusao-recusada.js";
import { createOperacaoEvent } from "./events.js";
import { runIdempotent } from "./operations.js";
import { ator, autoria, exigirPapel } from "./os-gravacao.js";
import { SERVICE_ORDERS_COLLECTION, osLida } from "./os.js";
import type { OperacaoProfile } from "./profile.js";

/**
 * A conclusão recusada do campo no Firestore (pergunta 66; as regras em
 * domain/conclusao-recusada.ts).
 *
 * - guardarConclusaoRecusada: depois que completeServiceOrder recusa a
 *   conclusão do celular com a assinatura conferida, guarda na OS o que
 *   chegou, com o evento `os.completion_refused`. Roda fora da transação da
 *   recusa, que já desfez tudo; o mesmo pedido repetido não grava de novo.
 * - resolveFieldCompletion (owner, admin e interno): anexa a assinatura à
 *   conclusão (`os.signature_attached`) ou dispensa
 *   (`os.refused_completion_dismissed`), com o recibo, numa transação.
 */

export async function guardarConclusaoRecusada(
  db: Firestore,
  caller: OperacaoProfile,
  pedido: PedidoDeConclusao,
  assinatura: string | null,
  motivo: string,
  agora: Date,
): Promise<void> {
  const ref = db.collection(SERVICE_ORDERS_COLLECTION).doc(pedido.numero);
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) return;
    const dados = snapshot.data() ?? {};
    if (conclusaoRecusadaLida(dados.conclusao_recusada)?.chave === pedido.idempotency_key) return;
    const os = osLida(snapshot.id, dados);
    const recusa = recusaDaConclusao(os, pedido, caller, assinatura, motivo, agora);
    if (!recusa) return;
    transaction.update(ref, { conclusao_recusada: recusa, edicao: os.edicao + 1, ...autoria(caller) });
    createOperacaoEvent(transaction, db, {
      operation_id: `conclusao_recusada:${os.numero}:${recusa.chave}`,
      type: "os.completion_refused",
      entity_id: os.numero,
      customer_code: os.customer_code,
      payload: { id: os.numero, demanda: os.demanda, instante: recusa.instante, canal: "celular" },
      actor: ator(caller),
      occurred_at: recusa.recusada_em,
    });
  });
}

export type ResultadoDaRecusa = { numero: string; edicao: number; acao: "anexar" | "dispensar" };

/** resolveFieldCompletion: anexa a assinatura do campo à conclusão, ou dispensa. */
export async function resolveFieldCompletionFor(
  db: Firestore,
  caller: OperacaoProfile,
  data: unknown,
  agora: () => Date = () => new Date(),
): Promise<ResultadoDaRecusa & { replayed?: true }> {
  exigirPapel(caller);
  const pedido = interpretarResolucao(data);
  return runIdempotent(
    db,
    { kind: "os_refused_completion", scope: { numero: pedido.numero }, idempotency_key: pedido.idempotency_key, input: pedido, actor: ator(caller) },
    async (transaction, { operationId }) => {
      const ref = db.collection(SERVICE_ORDERS_COLLECTION).doc(pedido.numero);
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) throw new HttpsError("not-found", "OS não encontrada.");
      const dados = snapshot.data() ?? {};
      const os = osLida(snapshot.id, dados);
      const instante = agora().toISOString();
      const { recusa, conclusao } = recusaResolvida(os, dados, pedido, { instante, por: { uid: caller.uid, nome: caller.name ?? null } });
      const edicao = os.edicao + 1;
      transaction.update(ref, { conclusao_recusada: recusa, ...(conclusao ? { conclusao } : {}), edicao, ...autoria(caller) });
      const comum = { operation_id: operationId, entity_id: os.numero, customer_code: os.customer_code, actor: ator(caller), occurred_at: instante };
      if (conclusao) {
        createOperacaoEvent(transaction, db, { ...comum, type: "os.signature_attached", payload: { id: os.numero, demanda: os.demanda, instante: recusa.instante } });
      } else {
        createOperacaoEvent(transaction, db, { ...comum, type: "os.refused_completion_dismissed", payload: { id: os.numero, demanda: os.demanda } });
      }
      return { target_id: os.numero, result: { numero: os.numero, edicao, acao: pedido.acao } };
    },
  );
}
