import type { Firestore, Transaction } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";

import { lerCatalogo } from "./demanda-direta-gravacao.js";
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
import { interpretarItem, itensEmExecucao, registrarFeito, registrarInclusao } from "./itens-executados.js";
import { digest, runIdempotent } from "./operations.js";
import { ator, autoria, exigirPapel } from "./os-gravacao.js";
import { interpretarPresenca, presencasLidas, registrarPresenca } from "./presencas.js";
import { SERVICE_ORDERS_COLLECTION, osLida, type StatusDaOs } from "./os.js";
import type { OperacaoProfile } from "./profile.js";

/**
 * Registra o andamento da OS (partes 3.7 e 3.8a): a etapa, com o instante em
 * que aconteceu, a ocorrência, os itens e a presença. Lê a OS e grava na
 * mesma transação, com o evento; cada registro tem a própria chave de
 * idempotência (o celular reenvia sem duplicar). Grava quem coordena (pelo
 * escritório) e o campo escalado na OS (pelo celular, informando como o
 * colaborador ligado ao login). A descrição da ocorrência fica só na OS: o
 * evento leva o número dela.
 */

export type ResultadoDoRegistro = { numero: string; edicao: number; status: StatusDaOs };

const COLLABORATORS = "collaborators";

/** Quem registra o andamento: quem coordena a Operação ou o campo (que ainda precisa estar escalado). */
export function exigirQuemExecuta(caller: OperacaoProfile): void {
  if (caller.role === "campo") return;
  exigirPapel(caller);
}

/**
 * Lê a OS para registrar e monta o contexto: o campo só grava na OS em que
 * está escalado (equipe_uids, o mesmo critério das regras) e informa como o
 * colaborador ligado ao login; quem coordena grava pelo escritório.
 */
export async function lerParaRegistrar(transaction: Transaction, db: Firestore, numero: string, caller: OperacaoProfile, agora: Date) {
  const ref = db.collection(SERVICE_ORDERS_COLLECTION).doc(numero);
  const snapshot = await transaction.get(ref);
  if (!snapshot.exists) throw new HttpsError("not-found", "OS não encontrada.");
  const data = snapshot.data() ?? {};
  const os = osLida(numero, data);
  let informante: string | null = null;
  if (caller.role === "campo") {
    if (!os.equipe_uids.includes(caller.uid)) throw new HttpsError("permission-denied", "Você não está escalado nesta OS.");
    const vinculado = await transaction.get(db.collection(COLLABORATORS).where("usuario_uid", "==", caller.uid).limit(1));
    const id = vinculado.docs[0]?.id ?? null;
    informante = id && os.equipe.some((pessoa) => pessoa.colaborador_id === id) ? id : null;
  }
  const canal: CanalDoRegistro = caller.role === "campo" ? "celular" : "escritorio";
  const contexto: ContextoDoRegistro = { agora, canal, registrado_por: { uid: caller.uid, role: caller.role }, informante };
  return { ref, data, os, contexto, execucao: execucaoLida(data), itens: itensEmExecucao(data) };
}

export async function registerStepFor(
  db: Firestore,
  caller: OperacaoProfile,
  data: unknown,
  agora: () => Date = () => new Date(),
): Promise<ResultadoDoRegistro & { replayed?: true }> {
  exigirQuemExecuta(caller);
  const pedido = interpretarEtapa(data);
  return runIdempotent(
    db,
    { kind: "os_step", scope: { numero: pedido.numero }, idempotency_key: pedido.idempotency_key, input: pedido, actor: ator(caller) },
    async (transaction, { operationId }) => {
      const { ref, os, execucao, contexto } = await lerParaRegistrar(transaction, db, pedido.numero, caller, agora());
      const { etapas, registro, iniciou } = registrarEtapa(os, execucao.etapas, pedido, contexto);
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
  exigirQuemExecuta(caller);
  const pedido = interpretarOcorrencia(data);
  return runIdempotent(
    db,
    { kind: "os_occurrence", scope: { numero: pedido.numero }, idempotency_key: pedido.idempotency_key, input: pedido, actor: ator(caller) },
    async (transaction, { operationId }) => {
      const { ref, os, execucao, contexto } = await lerParaRegistrar(transaction, db, pedido.numero, caller, agora());
      const { ocorrencias, registro } = registrarOcorrencia(os, execucao.ocorrencias, pedido, contexto);
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

/**
 * O feito de uma linha (absoluto, até o previsto) ou a inclusão em campo além
 * do planejado (na linha, na linha do mesmo item do catálogo ou numa linha
 * nova). A linha nova ganha o id da operação: repetir dá a mesma.
 */
export async function registerItemFor(
  db: Firestore,
  caller: OperacaoProfile,
  data: unknown,
  agora: () => Date = () => new Date(),
): Promise<ResultadoDoRegistro & { linha: string; replayed?: true }> {
  exigirQuemExecuta(caller);
  const pedido = interpretarItem(data);
  return runIdempotent(
    db,
    {
      kind: pedido.action === "executed" ? "os_item" : "os_item_added",
      scope: { numero: pedido.numero },
      idempotency_key: pedido.idempotency_key,
      input: pedido,
      actor: ator(caller),
    },
    async (transaction, { operationId }) => {
      const catalogo =
        pedido.action === "added" && pedido.lpu_item_id ? (await lerCatalogo(transaction, db, [pedido.lpu_item_id])).get(pedido.lpu_item_id) ?? null : null;
      const { ref, os, itens, contexto } = await lerParaRegistrar(transaction, db, pedido.numero, caller, agora());
      const edicao = os.edicao + 1;
      const base = { id: os.numero, demanda: os.demanda };
      if (pedido.action === "executed") {
        const feito = registrarFeito(os, itens, pedido, contexto);
        transaction.update(ref, { itens: feito.itens, edicao, ...autoria(caller) });
        createOperacaoEvent(transaction, db, {
          operation_id: operationId,
          type: "os.item_executed",
          entity_id: os.numero,
          customer_code: os.customer_code,
          payload: {
            ...base,
            linha: feito.item.id,
            quantidade: feito.item.executado ?? "0",
            anterior: feito.anterior,
            instante: feito.registro.instante,
            canal: feito.registro.canal,
            informado_por: feito.registro.informado_por,
          },
          actor: ator(caller),
          occurred_at: feito.registro.instante,
        });
        return { target_id: os.numero, result: { numero: os.numero, edicao, status: os.status, linha: feito.item.id } };
      }
      const incluido = registrarInclusao(os, itens, pedido, contexto, {
        catalogo,
        idDaLinhaNova: `cp_${digest({ operationId }, 16)}`,
      });
      transaction.update(ref, { itens: incluido.itens, edicao, ...autoria(caller) });
      createOperacaoEvent(transaction, db, {
        operation_id: operationId,
        type: "os.item_added_in_field",
        entity_id: os.numero,
        customer_code: os.customer_code,
        payload: {
          ...base,
          linha: incluido.item.id,
          quantidade: incluido.inclusao.quantidade,
          nova_linha: incluido.nova,
          lpu_item_id: incluido.item.lpu_item_id,
          instante: incluido.inclusao.instante,
          canal: incluido.inclusao.canal,
          informado_por: incluido.inclusao.informado_por,
        },
        actor: ator(caller),
        occurred_at: incluido.inclusao.instante,
      });
      return { target_id: os.numero, result: { numero: os.numero, edicao, status: os.status, linha: incluido.item.id } };
    },
  );
}

/** Marca a entrada ou a saída de alguém da equipe; a marca que já existe fica (vale a primeira). */
export async function registerPresenceFor(
  db: Firestore,
  caller: OperacaoProfile,
  data: unknown,
  agora: () => Date = () => new Date(),
): Promise<ResultadoDoRegistro & { registrada: boolean; replayed?: true }> {
  exigirQuemExecuta(caller);
  const pedido = interpretarPresenca(data);
  return runIdempotent<ResultadoDoRegistro & { registrada: boolean }>(
    db,
    { kind: "os_presence", scope: { numero: pedido.numero }, idempotency_key: pedido.idempotency_key, input: pedido, actor: ator(caller) },
    async (transaction, { operationId }) => {
      const { ref, os, data: bruto, contexto } = await lerParaRegistrar(transaction, db, pedido.numero, caller, agora());
      const { presencas, marca, registrada } = registrarPresenca(os, presencasLidas(bruto), pedido, contexto);
      if (!registrada) return { target_id: os.numero, result: { numero: os.numero, edicao: os.edicao, status: os.status, registrada } };
      const edicao = os.edicao + 1;
      transaction.update(ref, { presencas, edicao, ...autoria(caller) });
      createOperacaoEvent(transaction, db, {
        operation_id: operationId,
        type: "os.presence_recorded",
        entity_id: os.numero,
        customer_code: os.customer_code,
        payload: { id: os.numero, demanda: os.demanda, colaborador_id: pedido.colaborador_id, tipo: pedido.tipo, instante: marca.instante, canal: marca.canal },
        actor: ator(caller),
        occurred_at: marca.instante,
      });
      return { target_id: os.numero, result: { numero: os.numero, edicao, status: os.status, registrada } };
    },
  );
}
