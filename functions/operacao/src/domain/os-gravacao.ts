import { FieldValue, type DocumentData, type Firestore, type Transaction } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";

import { createOperacaoEvent } from "./events.js";
import { runIdempotent, type OperacaoActor } from "./operations.js";
import {
  SERVICE_ORDERS_COLLECTION,
  SERVICE_ORDER_COUNTERS_COLLECTION,
  aplicarOs,
  interpretarOs,
  itensSemPreco,
  localDaDemanda,
  numeroDaOs,
  problemaParaAbrirOs,
  proximaSequencia,
  type AcaoOs,
  type OsGravada,
} from "./os.js";
import { operacaoCadastroProblem } from "./platform-roles.js";
import type { OperacaoProfile } from "./profile.js";

/**
 * Abre e cancela a OS. A transação lê a demanda, o orçamento e a revisão
 * fechada antes de escrever. O preço da revisão não entra na OS nem no evento.
 */

const DEMANDS = "demands";
const QUOTES = "quotes";

export type ResultadoDaOs = { numero: string; edicao: number; demanda: string };

function ator(caller: OperacaoProfile): OperacaoActor {
  return { uid: caller.uid, role: caller.role, email: caller.email, name: caller.name };
}

function exigirPapel(caller: OperacaoProfile): void {
  const problem = operacaoCadastroProblem(caller.role);
  if (problem) throw new HttpsError("permission-denied", problem);
}

function dados(snapshot: { exists: boolean; data: () => DocumentData | undefined }, mensagem: string): DocumentData {
  if (!snapshot.exists) throw new HttpsError("not-found", mensagem);
  return snapshot.data() ?? {};
}

export async function saveServiceOrderFor(
  db: Firestore,
  caller: OperacaoProfile,
  data: unknown,
): Promise<ResultadoDaOs & { replayed?: true }> {
  exigirPapel(caller);
  const acao = interpretarOs(data);
  return runIdempotent(
    db,
    {
      kind: acao.action === "create" ? "os_open" : "os_cancel",
      scope: acao.action === "create" ? { demanda: acao.demanda } : { numero: acao.numero },
      idempotency_key: acao.idempotency_key,
      input: acao,
      actor: ator(caller),
    },
    async (transaction, { operationId }) => {
      const efeito = acao.action === "create" ? await abrir(transaction, db, acao, caller) : await cancelar(transaction, db, acao, caller);
      const payload = efeito.evento === "os.created"
        ? { id: efeito.documento.numero, demanda: efeito.documento.demanda, seq: efeito.documento.seq, linhas: efeito.documento.itens.length }
        : { id: efeito.documento.numero, demanda: efeito.documento.demanda };
      createOperacaoEvent(transaction, db, {
        operation_id: operationId,
        type: efeito.evento,
        entity_id: efeito.documento.numero,
        customer_code: efeito.documento.customer_code,
        payload,
        actor: ator(caller),
      });
      return {
        target_id: efeito.documento.numero,
        result: { numero: efeito.documento.numero, edicao: efeito.documento.edicao, demanda: efeito.documento.demanda },
      };
    },
  );
}

async function abrir(transaction: Transaction, db: Firestore, acao: Extract<AcaoOs, { action: "create" }>, caller: OperacaoProfile) {
  const demandaRef = db.collection(DEMANDS).doc(acao.demanda);
  const orcamentoRef = db.collection(QUOTES).doc(acao.demanda);
  const contadorRef = db.collection(SERVICE_ORDER_COUNTERS_COLLECTION).doc(acao.demanda);
  const demandaSnap = await transaction.get(demandaRef);
  const orcamentoSnap = await transaction.get(orcamentoRef);
  const contadorSnap = await transaction.get(contadorRef);
  const demanda = dados(demandaSnap, "Demanda não encontrada.");
  const orcamento = orcamentoSnap.exists ? orcamentoSnap.data() ?? {} : null;
  const problema = problemaParaAbrirOs(demanda, orcamento);
  if (problema) throw new HttpsError("failed-precondition", problema);
  const rv = Number(demanda.escopo_rv);
  const revisaoSnap = await transaction.get(orcamentoRef.collection("revisoes").doc(String(rv)));
  const revisao = dados(revisaoSnap, "A revisão fechada não está gravada.");
  const itens = itensSemPreco(revisao.linhas);
  const seq = proximaSequencia(contadorSnap.exists ? contadorSnap.data()?.ultimo : 0);
  const numero = numeroDaOs(acao.demanda, seq);
  const efeito = aplicarOs(null, acao, {
    numero,
    seq,
    customer_code: String(demanda.customer_code).trim(),
    escopo_rv: rv,
    itens,
    origem_local_id: localDaDemanda(demanda.origem),
    destino_local_id: localDaDemanda(demanda.destino),
  });
  const ref = db.collection(SERVICE_ORDERS_COLLECTION).doc(numero);
  transaction.set(contadorRef, { demanda: acao.demanda, ultimo: seq, updated_at: FieldValue.serverTimestamp() });
  transaction.create(ref, {
    ...efeito.documento,
    id: numero,
    atualizado_por: { uid: caller.uid, role: caller.role },
    created_at: FieldValue.serverTimestamp(),
    updated_at: FieldValue.serverTimestamp(),
  });
  transaction.update(demandaRef, { os_numeros: FieldValue.arrayUnion(numero) });
  return efeito;
}

function osLida(numero: string, data: DocumentData): OsGravada {
  if (data.status !== "aberta" && data.status !== "cancelada") throw new HttpsError("failed-precondition", "OS ilegível.");
  if (typeof data.edicao !== "number" || typeof data.demanda !== "string" || typeof data.customer_code !== "string") {
    throw new HttpsError("failed-precondition", "OS ilegível.");
  }
  const cancelamento = data.cancelamento;
  return {
    numero,
    demanda: data.demanda,
    seq: typeof data.seq === "number" ? data.seq : 1,
    customer_code: data.customer_code,
    status: data.status,
    escopo_rv: typeof data.escopo_rv === "number" ? data.escopo_rv : 0,
    itens: Array.isArray(data.itens) ? data.itens : [],
    origem_local_id: typeof data.origem_local_id === "string" ? data.origem_local_id : null,
    destino_local_id: typeof data.destino_local_id === "string" ? data.destino_local_id : null,
    edicao: data.edicao,
    cancelamento: cancelamento && typeof cancelamento === "object" && typeof cancelamento.motivo === "string" ? { motivo: cancelamento.motivo } : null,
  };
}

async function cancelar(transaction: Transaction, db: Firestore, acao: Extract<AcaoOs, { action: "cancel" }>, caller: OperacaoProfile) {
  const ref = db.collection(SERVICE_ORDERS_COLLECTION).doc(acao.numero);
  const snapshot = await transaction.get(ref);
  if (!snapshot.exists) throw new HttpsError("not-found", "OS não encontrada.");
  const efeito = aplicarOs(osLida(acao.numero, snapshot.data() ?? {}), acao, null);
  transaction.update(ref, {
    status: efeito.documento.status,
    edicao: efeito.documento.edicao,
    cancelamento: efeito.documento.cancelamento,
    atualizado_por: { uid: caller.uid, role: caller.role },
    updated_at: FieldValue.serverTimestamp(),
  });
  return efeito;
}
