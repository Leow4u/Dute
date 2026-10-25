import { FieldValue, type DocumentData, type Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";

import { conclusaoLida } from "./conclusao.js";
import { DEMANDS_COLLECTION, QUOTES_COLLECTION } from "./demanda-direta.js";
import { createOperacaoEvent } from "./events.js";
import { execucaoLida } from "./execucao.js";
import type { ResultadoDoRegistro } from "./execucao-gravacao.js";
import { itensEmExecucao } from "./itens-executados.js";
import { runIdempotent } from "./operations.js";
import { ator, autoria, exigirPapel, lerEscopo } from "./os-gravacao.js";
import { SERVICE_ORDERS_COLLECTION, osLida, saldoDoEscopo, type StatusDaOs } from "./os.js";
import type { OperacaoProfile } from "./profile.js";
import {
  DECISOES,
  diretaExecutada,
  exigirQuemReabre,
  fechamentoDaDireta,
  interpretarReabertura,
  interpretarRevisao,
  paraResumo,
  resumoDaOperacao,
  revisarOs,
  type ResumoDaOperacao,
} from "./revisao.js";

/**
 * A revisão interna e a reabertura da OS (parte 3.10a). Lê a OS, a demanda,
 * o escopo e todas as OS dela e grava na mesma transação: a revisão (ou a
 * volta à execução) na OS, o resumo da Operação na demanda
 * (`demands/{numero}.operacao`, que o Comercial só lê) e os eventos. A
 * demanda direta aberta pela Operação vai à Execução a orçar quando a última
 * OS dela é revisada, e volta a Para planejar se a OS é reaberta antes do
 * orçamento da execução.
 */

function dataDe(snapshot: { exists: boolean; data: () => DocumentData | undefined }, mensagem: string): DocumentData {
  if (!snapshot.exists) throw new HttpsError("not-found", mensagem);
  return snapshot.data() ?? {};
}

function marcos(demanda: DocumentData): unknown[] {
  return Array.isArray(demanda.marcos) ? demanda.marcos : [];
}

export async function reviewServiceOrderFor(
  db: Firestore,
  caller: OperacaoProfile,
  data: unknown,
  agora: () => Date = () => new Date(),
): Promise<ResultadoDoRegistro & { replayed?: true }> {
  exigirPapel(caller);
  const pedido = interpretarRevisao(data);
  return runIdempotent(
    db,
    { kind: "os_review", scope: { numero: pedido.numero }, idempotency_key: pedido.idempotency_key, input: pedido, actor: ator(caller) },
    async (transaction, { operationId }) => {
      const instante = agora();
      const iso = instante.toISOString();

      // Leituras.
      const ref = db.collection(SERVICE_ORDERS_COLLECTION).doc(pedido.numero);
      const bruto = dataDe(await transaction.get(ref), "OS não encontrada.");
      const os = osLida(pedido.numero, bruto);
      const demandaRef = db.collection(DEMANDS_COLLECTION).doc(os.demanda);
      const demanda = dataDe(await transaction.get(demandaRef), "Demanda da OS não encontrada.");
      const { escopo, ordens, brutos } = await lerEscopo(transaction, db, os.demanda, demanda);

      // Conta: o saldo livre conta todas as OS (esta ainda pelo planejado).
      const saldoLivre = saldoDoEscopo(escopo, ordens);
      const { revisao, itens } = revisarOs(
        os,
        {
          itens: itensEmExecucao(bruto),
          etapas: execucaoLida(bruto).etapas,
          conclusao: conclusaoLida(bruto),
          demanda: { direta: demanda.entrada === "direta" && demanda.escopo_rv == null, saldoLivre },
        },
        pedido,
        { agora: instante, registrado_por: { uid: caller.uid, role: caller.role } },
      );
      const status: StatusDaOs = "revisada";
      const edicao = os.edicao + 1;
      const resumo: ResumoDaOperacao = resumoDaOperacao(paraResumo(ordens, brutos, os.numero, status, { ...bruto, revisao, status }), instante);
      const executada = diretaExecutada(demanda, resumo);

      // Escritas.
      transaction.update(ref, { itens, revisao, status, edicao, ...autoria(caller) });
      const patch: Record<string, unknown> = { operacao: resumo, updated_at: FieldValue.serverTimestamp(), updated_by: caller.uid };
      if (executada && resumo.periodo) Object.assign(patch, fechamentoDaDireta(demanda, resumo.periodo, iso, caller.uid));
      transaction.update(demandaRef, patch);

      const comum = { operation_id: operationId, customer_code: os.customer_code, actor: ator(caller), occurred_at: iso };
      const decisoes = Object.fromEntries(DECISOES.map((decisao) => [decisao, revisao.linhas.filter((linha) => linha.decisao === decisao).length])) as Record<
        (typeof DECISOES)[number],
        number
      >;
      createOperacaoEvent(transaction, db, {
        ...comum,
        type: "os.reviewed",
        entity_id: os.numero,
        payload: {
          id: os.numero,
          demanda: os.demanda,
          linhas: revisao.linhas.length,
          divergencias: revisao.linhas.filter((linha) => linha.sinal !== "igual").length,
          corrigidas: revisao.linhas.filter((linha) => linha.corrigido !== null).length,
          decisoes,
          minutos_planejados: revisao.minutos_planejados,
          minutos_reais: revisao.minutos_reais,
          pessoas: revisao.pessoas,
        },
      });
      if (revisao.aditivo.length) {
        createOperacaoEvent(transaction, db, {
          ...comum,
          type: "os.addendum_requested",
          entity_id: os.numero,
          payload: { id: os.numero, demanda: os.demanda, linhas: revisao.aditivo.length },
        });
      }
      if (executada && resumo.periodo) {
        createOperacaoEvent(transaction, db, {
          ...comum,
          type: "demand.execution_reviewed",
          entity_id: os.demanda,
          payload: { id: os.demanda, de: resumo.periodo.de, ate: resumo.periodo.ate, os: resumo.os_revisadas.length },
        });
      }
      return { target_id: os.numero, result: { numero: os.numero, edicao, status } };
    },
  );
}

export async function reopenServiceOrderFor(
  db: Firestore,
  caller: OperacaoProfile,
  data: unknown,
  agora: () => Date = () => new Date(),
): Promise<ResultadoDoRegistro & { replayed?: true }> {
  exigirPapel(caller);
  exigirQuemReabre(caller.role);
  const pedido = interpretarReabertura(data);
  return runIdempotent(
    db,
    { kind: "os_reopen", scope: { numero: pedido.numero }, idempotency_key: pedido.idempotency_key, input: pedido, actor: ator(caller) },
    async (transaction, { operationId }) => {
      const instante = agora();
      const iso = instante.toISOString();

      // Leituras.
      const ref = db.collection(SERVICE_ORDERS_COLLECTION).doc(pedido.numero);
      const bruto = dataDe(await transaction.get(ref), "OS não encontrada.");
      const os = osLida(pedido.numero, bruto);
      if (os.status !== "revisada") throw new HttpsError("failed-precondition", "Só a OS revisada se reabre.");
      if (os.tipo === "vistoria") {
        throw new HttpsError("failed-precondition", "A vistoria enviada ao Comercial não se reabre: abra outra vistoria da demanda.");
      }
      const demandaRef = db.collection(DEMANDS_COLLECTION).doc(os.demanda);
      const demanda = dataDe(await transaction.get(demandaRef), "Demanda da OS não encontrada.");
      if (demanda.validacao) throw new HttpsError("failed-precondition", "O cliente já validou a execução desta demanda: o Comercial reabre antes.");
      const registro = demanda.registro_execucao as { origem?: unknown } | null | undefined;
      const executadaPelaOperacao = demanda.entrada === "direta" && registro?.origem === "operacao" && demanda.etapa === "execucao_a_orcar";
      if (executadaPelaOperacao && (await transaction.get(db.collection(QUOTES_COLLECTION).doc(os.demanda))).exists) {
        throw new HttpsError("failed-precondition", "O Comercial já abriu o orçamento da execução desta demanda.");
      }
      const { ordens, brutos } = await lerEscopo(transaction, db, os.demanda, demanda);

      // Conta: a OS volta à execução sem a revisão nem a conclusão (guardadas no histórico dela).
      const status: StatusDaOs = "em_execucao";
      const edicao = os.edicao + 1;
      const itens = itensEmExecucao(bruto).map(({ consumido: _consumido, ...item }) => item);
      const reaberta = { instante: iso, registrado_por: { uid: caller.uid, role: caller.role }, motivo: pedido.motivo };
      const anteriores = Array.isArray(bruto.revisoes_anteriores) ? bruto.revisoes_anteriores : [];
      const dadosDepois = { ...bruto, status, revisao: null };
      const resumo = resumoDaOperacao(paraResumo(ordens, brutos, os.numero, status, dadosDepois), instante);

      // Escritas.
      transaction.update(ref, {
        itens,
        status,
        edicao,
        revisao: FieldValue.delete(),
        conclusao: FieldValue.delete(),
        revisoes_anteriores: [...anteriores, { revisao: bruto.revisao ?? null, conclusao: bruto.conclusao ?? null, reaberta }],
        ...autoria(caller),
      });
      const patch: Record<string, unknown> = { operacao: resumo, updated_at: FieldValue.serverTimestamp(), updated_by: caller.uid };
      if (executadaPelaOperacao) {
        Object.assign(patch, {
          executado_de: null,
          executado_ate: null,
          registro_execucao: null,
          etapa: "para_planejar",
          etapa_desde: iso,
          marcos: [...marcos(demanda), { etapa: "para_planejar", em: iso, por_uid: caller.uid }],
        });
      }
      transaction.update(demandaRef, patch);
      createOperacaoEvent(transaction, db, {
        operation_id: operationId,
        type: "os.reopened",
        entity_id: os.numero,
        customer_code: os.customer_code,
        payload: { id: os.numero, demanda: os.demanda, demanda_reaberta: executadaPelaOperacao },
        actor: ator(caller),
        occurred_at: iso,
      });
      return { target_id: os.numero, result: { numero: os.numero, edicao, status } };
    },
  );
}
