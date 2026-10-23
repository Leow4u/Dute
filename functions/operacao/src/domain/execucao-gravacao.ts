import type { Firestore, Transaction } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";

import { createOperacaoEvent } from "./events.js";
import {
  execucaoLida,
  interpretarEtapa,
  interpretarOcorrencia,
  registrarEtapa,
  registrarOcorrencia,
  type CanalDoRegistro,
  type ContextoDoRegistro,
} from "./execucao.js";
import { runIdempotent } from "./operations.js";
import { ator, autoria, exigirPapel } from "./os-gravacao.js";
import { SERVICE_ORDERS_COLLECTION, osLida, type StatusDaOs } from "./os.js";
import type { OperacaoProfile } from "./profile.js";

/**
 * Registra o andamento da OS pelo escritório (parte 3.7a): a etapa, com o
 * instante em que aconteceu, e a ocorrência. Lê a OS e grava na mesma
 * transação, com o evento; cada registro tem a própria chave de idempotência
 * (o celular da parte 3.8 reenvia sem duplicar). A descrição da ocorrência
 * fica só na OS: o evento leva o número dela.
 */

export type ResultadoDoRegistro = { numero: string; edicao: number; status: StatusDaOs };

/** No escritório, quem registra é a coordenação; o celular (parte 3.8) é do campo. */
function contexto(caller: OperacaoProfile, agora: Date): ContextoDoRegistro {
  const canal: CanalDoRegistro = caller.role === "campo" ? "celular" : "escritorio";
  return { agora, canal, registrado_por: { uid: caller.uid, role: caller.role } };
}

async function lerParaRegistrar(transaction: Transaction, db: Firestore, numero: string) {
  const ref = db.collection(SERVICE_ORDERS_COLLECTION).doc(numero);
  const snapshot = await transaction.get(ref);
  if (!snapshot.exists) throw new HttpsError("not-found", "OS não encontrada.");
  const data = snapshot.data() ?? {};
  return { ref, os: osLida(numero, data), execucao: execucaoLida(data) };
}

export async function registerStepFor(
  db: Firestore,
  caller: OperacaoProfile,
  data: unknown,
  agora: () => Date = () => new Date(),
): Promise<ResultadoDoRegistro & { replayed?: true }> {
  exigirPapel(caller);
  const pedido = interpretarEtapa(data);
  return runIdempotent(
    db,
    { kind: "os_step", scope: { numero: pedido.numero }, idempotency_key: pedido.idempotency_key, input: pedido, actor: ator(caller) },
    async (transaction, { operationId }) => {
      const { ref, os, execucao } = await lerParaRegistrar(transaction, db, pedido.numero);
      const { etapas, registro, iniciou } = registrarEtapa(os, execucao.etapas, pedido, contexto(caller, agora()));
      const status: StatusDaOs = "em_execucao";
      const edicao = os.edicao + 1;
      transaction.update(ref, { etapas, status, edicao, ...autoria(caller) });
      if (iniciou) {
        createOperacaoEvent(transaction, db, {
          operation_id: operationId,
          suffix: "os.started",
          type: "os.started",
          entity_id: os.numero,
          customer_code: os.customer_code,
          payload: { id: os.numero, demanda: os.demanda, instante: registro.instante },
          actor: ator(caller),
          occurred_at: registro.instante,
        });
      }
      createOperacaoEvent(transaction, db, {
        operation_id: operationId,
        type: "os.step_recorded",
        entity_id: os.numero,
        customer_code: os.customer_code,
        payload: {
          id: os.numero,
          demanda: os.demanda,
          etapa: registro.etapa,
          instante: registro.instante,
          canal: registro.canal,
          informado_por: registro.informado_por,
        },
        actor: ator(caller),
        occurred_at: registro.instante,
      });
      return { target_id: os.numero, result: { numero: os.numero, edicao, status } };
    },
  );
}

export async function registerOccurrenceFor(
  db: Firestore,
  caller: OperacaoProfile,
  data: unknown,
  agora: () => Date = () => new Date(),
): Promise<ResultadoDoRegistro & { ocorrencia: string; replayed?: true }> {
  exigirPapel(caller);
  const pedido = interpretarOcorrencia(data);
  return runIdempotent(
    db,
    { kind: "os_occurrence", scope: { numero: pedido.numero }, idempotency_key: pedido.idempotency_key, input: pedido, actor: ator(caller) },
    async (transaction, { operationId }) => {
      const { ref, os, execucao } = await lerParaRegistrar(transaction, db, pedido.numero);
      const { ocorrencias, registro } = registrarOcorrencia(os, execucao.ocorrencias, pedido, contexto(caller, agora()));
      const edicao = os.edicao + 1;
      transaction.update(ref, { ocorrencias, edicao, ...autoria(caller) });
      createOperacaoEvent(transaction, db, {
        operation_id: operationId,
        type: "os.occurrence_recorded",
        entity_id: os.numero,
        customer_code: os.customer_code,
        payload: { id: os.numero, demanda: os.demanda, ocorrencia: registro.id, instante: registro.instante, canal: registro.canal },
        actor: ator(caller),
        occurred_at: registro.instante,
      });
      return { target_id: os.numero, result: { numero: os.numero, edicao, status: os.status, ocorrencia: registro.id } };
    },
  );
}
