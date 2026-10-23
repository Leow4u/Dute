import { FieldValue, type DocumentData, type Firestore, type Transaction } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";

import { createOperacaoEvent } from "./events.js";
import { runIdempotent, type OperacaoActor } from "./operations.js";
import { operacaoCadastroProblem } from "./platform-roles.js";
import type { OperacaoProfile } from "./profile.js";
import {
  SERVICE_REQUESTS_COLLECTION,
  caminhoDoAnexo,
  documentoDaSolicitacao,
  idDaSolicitacao,
  interpretarPedidoDeServico,
  interpretarRecusa,
  problemaDaData,
  problemaDaSolicitacao,
  problemaDoAnexo,
  solicitacaoLida,
  type AnexoGravado,
  type ArquivoDoAnexo,
} from "./solicitacao.js";

/**
 * A solicitação de OS pelo portal (parte 4.4a). `requestService` é do
 * cliente: confere os anexos no Storage e grava a solicitação recebida com o
 * evento `portal.service_requested`, na mesma transação. Nada mais: nem
 * demanda, nem OS. `declineServiceRequest` é de quem coordena: recusa a
 * solicitação recebida com o motivo. A demanda sai de `openDirectDemand`, com
 * a solicitação (demanda-direta-gravacao.ts).
 */

const CUSTOMERS = "customers";

/** O tipo e o tamanho do arquivo no bucket, ou null quando ele não existe. */
export type ConferirAnexo = (caminho: string) => Promise<ArquivoDoAnexo | null>;

export type ResultadoDaSolicitacao = { solicitacao_id: string };

function ator(caller: OperacaoProfile): OperacaoActor {
  return { uid: caller.uid, role: caller.role, email: caller.email, name: caller.name };
}

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

/** O nome do cliente pelo cadastro (customer_code e, sem ele, code); sem cadastro único, o código. */
async function nomeDoCliente(transaction: Transaction, db: Firestore, code: string): Promise<string> {
  const customers = db.collection(CUSTOMERS);
  let docs = (await transaction.get(customers.where("customer_code", "==", code))).docs;
  if (!docs.length) docs = (await transaction.get(customers.where("code", "==", code))).docs;
  const dados: DocumentData = docs.length === 1 ? (docs[0].data() ?? {}) : {};
  return texto(dados.name) || code;
}

export async function requestServiceFor(
  db: Firestore,
  caller: OperacaoProfile,
  data: unknown,
  conferirAnexo: ConferirAnexo,
  agora: () => Date = () => new Date(),
): Promise<ResultadoDaSolicitacao & { replayed?: true }> {
  if (caller.role !== "cliente") throw new HttpsError("permission-denied", "Só o cliente pede OS pelo portal.");
  const code = caller.customer_code ?? "";
  if (!code) throw new HttpsError("permission-denied", "Seu acesso não está ligado a um cliente.");
  const pedido = interpretarPedidoDeServico(data);
  const problema = problemaDaData(pedido.data, pedido.horario, agora());
  if (problema) throw new HttpsError("invalid-argument", problema);

  // O Storage fica fora da transação: o arquivo não muda depois de subir (sem sobrescrever).
  const anexos: AnexoGravado[] = [];
  for (const anexo of pedido.anexos) {
    const caminho = caminhoDoAnexo(code, anexo.arquivo);
    const noStorage = await conferirAnexo(caminho);
    const problemaDoArquivo = problemaDoAnexo(anexo.arquivo, noStorage);
    if (problemaDoArquivo || !noStorage) throw new HttpsError("failed-precondition", problemaDoArquivo ?? "O anexo não chegou.");
    anexos.push({ arquivo: anexo.arquivo, caminho, nome: anexo.nome, tipo: noStorage.contentType, tamanho: noStorage.size });
  }

  return runIdempotent(
    db,
    { kind: "service_request", scope: { customer_code: code, uid: caller.uid }, idempotency_key: pedido.idempotency_key, input: pedido, actor: ator(caller) },
    async (transaction, { operationId }) => {
      const iso = agora().toISOString();
      const id = idDaSolicitacao(operationId);
      const ref = db.collection(SERVICE_REQUESTS_COLLECTION).doc(id);
      const existente = await transaction.get(ref);
      if (existente.exists) throw new HttpsError("failed-precondition", `A solicitação ${id} já existe.`);
      const customerName = await nomeDoCliente(transaction, db, code);

      transaction.create(ref, {
        ...documentoDaSolicitacao({
          id,
          customer_code: code,
          customer_name: customerName,
          pedido,
          anexos,
          contato: { uid: caller.uid, nome: texto(caller.name) || texto(caller.email) || "Cliente", email: texto(caller.email) || null },
          iso,
        }),
        operation_id: operationId,
        created_at: FieldValue.serverTimestamp(),
        created_by: caller.uid,
        updated_at: FieldValue.serverTimestamp(),
        updated_by: caller.uid,
      });
      createOperacaoEvent(transaction, db, {
        operation_id: operationId,
        type: "portal.service_requested",
        entity_id: id,
        customer_code: code,
        payload: { id, tipo_servico: pedido.tipo_servico, data: pedido.data, anexos: anexos.length },
        occurred_at: iso,
        actor: ator(caller),
      });
      return { target_id: id, result: { solicitacao_id: id } };
    },
  );
}

export async function declineServiceRequestFor(
  db: Firestore,
  caller: OperacaoProfile,
  data: unknown,
  agora: () => Date = () => new Date(),
): Promise<ResultadoDaSolicitacao & { replayed?: true }> {
  const problemaDoPapel = operacaoCadastroProblem(caller.role);
  if (problemaDoPapel) throw new HttpsError("permission-denied", problemaDoPapel);
  const recusa = interpretarRecusa(data);

  return runIdempotent(
    db,
    { kind: "service_request_decline", scope: { solicitacao_id: recusa.solicitacao_id }, idempotency_key: recusa.idempotency_key, input: recusa, actor: ator(caller) },
    async (transaction, { operationId }) => {
      const iso = agora().toISOString();
      const ref = db.collection(SERVICE_REQUESTS_COLLECTION).doc(recusa.solicitacao_id);
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) throw new HttpsError("not-found", "Solicitação do portal não encontrada.");
      const solicitacao = solicitacaoLida(snapshot.id, snapshot.data() ?? {});
      const problema = problemaDaSolicitacao(solicitacao, null);
      if (problema) throw new HttpsError("failed-precondition", problema);

      transaction.update(ref, {
        status: "recusada",
        recusa: { motivo: recusa.motivo, em: iso, por_uid: caller.uid },
        updated_at: FieldValue.serverTimestamp(),
        updated_by: caller.uid,
      });
      createOperacaoEvent(transaction, db, {
        operation_id: operationId,
        type: "portal.service_declined",
        entity_id: solicitacao.id,
        customer_code: solicitacao.customer_code,
        payload: { id: solicitacao.id },
        occurred_at: iso,
        actor: ator(caller),
      });
      return { target_id: solicitacao.id, result: { solicitacao_id: solicitacao.id } };
    },
  );
}
