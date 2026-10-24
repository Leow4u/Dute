import { FieldValue, type DocumentReference, type Firestore, type Transaction } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";

import {
  PAGAMENTOS_COLLECTION,
  aplicarEstorno,
  aplicarPagamento,
  centavosDoTexto,
  conferirCancelamento,
  conferirDemandaDaFatura,
  conferirEnvio,
  faturaLida,
  interpretarAvanco,
  pagamentoIdDaOperacao,
  pagamentoLido,
  type AcaoDaFatura,
  type FaturaLida,
  type StatusDaFatura,
} from "./cobranca.js";
import { BILLING_PERIODS_COLLECTION, CLIENT_INVOICES_COLLECTION, idsDoPortal, periodoLido, problemaDoPeriodoNaFatura } from "./armazenagem.js";
import { estornarBaixa, lerBaixaDoPagamento, porNaFila } from "./baixa-gravacao.js";
import { createFinanceiroEvent } from "./events.js";
import { AUTHORIZATIONS_COLLECTION, DEMANDS_COLLECTION, FATURAS_COLLECTION } from "./fatura.js";
import { runIdempotent, type FinanceiroActor } from "./operations.js";
import { CLIENT_FATURAS_COLLECTION, projecaoDaFatura } from "./projecao.js";
import { financeiroProblem } from "./platform-roles.js";
import type { FinanceiroProfile } from "./profile.js";

/**
 * A cobrança da fatura (parte 4.2a), numa transação por ação, com recibo de
 * idempotência e o evento sem valor:
 *
 * - send: a NF enviada ao cliente (o dia e o meio).
 * - pay: um pagamento; quitada, a fatura fica paga e as demandas também, e a
 *   armazenagem dela fica paga no WMS (parte 7.2c). Na fatura que saiu pela
 *   Omie, a baixa do pagamento entra na fila da Omie (parte 7.4g).
 * - reverse_payment: estorna um pagamento; a paga volta a enviada (ou
 *   emitida), as demandas, a faturada, e a armazenagem, a emitida no WMS. A
 *   baixa na Omie do pagamento vai a cancelar.
 * - cancel: cancela o registro sem pagamento; as demandas voltam a A
 *   faturar, a armazenagem volta à fila (parte 7.2a) e as autorizações
 *   perdem a NF.
 *
 * Cada ação regrava a projeção do portal (`client_faturas`, parte 4.3a) a
 * partir da fatura como ela fica; o cancelamento a apaga.
 */

const DIA_EM_SAO_PAULO = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" });

export type ResultadoDaCobranca = {
  id: string;
  acao: AcaoDaFatura;
  status: StatusDaFatura;
  recebido_cents: number;
  saldo_cents: number;
  pagamento_id?: string;
};

type Contexto = {
  db: Firestore;
  transaction: Transaction;
  caller: FinanceiroProfile;
  ator: FinanceiroActor;
  operationId: string;
  fatura: FaturaLida;
  iso: string;
};

/** Lê as demandas da fatura e confere a etapa de cada uma antes de qualquer escrita. */
async function demandasDaFatura({ db, transaction, fatura }: Contexto, etapa: "faturada" | "paga") {
  const refs = fatura.demanda_numeros.map((numero) => db.collection(DEMANDS_COLLECTION).doc(numero));
  if (!refs.length) return refs;
  const snaps = await transaction.getAll(...refs);
  snaps.forEach((snap, indice) => conferirDemandaDaFatura(fatura.demanda_numeros[indice], snap.exists ? (snap.data() ?? {}) : null, fatura.id, etapa));
  return refs;
}

type PeriodoDaFatura = { ref: DocumentReference; competencia: string; portal: DocumentReference };

/**
 * Lê a armazenagem da fatura e confere que cada competência está nesta NF, no
 * status do WMS que a ação pede, antes de qualquer escrita. Acha também o
 * documento do portal (`client_invoices`) como o WMS acha: o id novo e, na
 * BTG, o antigo; sem nenhum, o novo.
 */
async function periodosDaFatura({ db, transaction, fatura }: Contexto, status: "emitido" | "pago"): Promise<PeriodoDaFatura[]> {
  const refs = fatura.periodo_ids.map((id) => db.collection(BILLING_PERIODS_COLLECTION).doc(id));
  if (!refs.length) return [];
  const snaps = await transaction.getAll(...refs);
  const lidos = snaps.map((snap, indice) => {
    const dados = snap.exists ? (snap.data() ?? {}) : null;
    const problema = problemaDoPeriodoNaFatura(fatura.periodo_ids[indice], dados, fatura.id, status);
    if (problema) throw new HttpsError("failed-precondition", problema);
    const periodo = periodoLido(snap.id, dados ?? {});
    return { ref: refs[indice], competencia: periodo.competencia, candidatos: idsDoPortal(periodo.customer_code, periodo.competencia).map((id) => db.collection(CLIENT_INVOICES_COLLECTION).doc(id)) };
  });
  const portais = await transaction.getAll(...lidos.flatMap((lido) => lido.candidatos));
  const existe = new Set(portais.filter((snap) => snap.exists).map((snap) => snap.ref.path));
  return lidos.map(({ ref, competencia, candidatos }) => ({ ref, competencia, portal: candidatos.find((candidato) => existe.has(candidato.path)) ?? candidatos[0] }));
}

/** A competência paga (ou de volta a emitida) no WMS e no portal, como o payBillingInvoice do WMS grava. */
function marcarArmazenagem({ transaction, caller, fatura, iso }: Contexto, periodos: readonly PeriodoDaFatura[], paga: { recebidoEm: string } | null) {
  for (const periodo of periodos) {
    transaction.update(periodo.ref, paga
      ? { status: "pago", pago_em: iso, paid_by: caller.uid, "faturamento.paga_em": paga.recebidoEm, updated_at: FieldValue.serverTimestamp() }
      : { status: "emitido", pago_em: FieldValue.delete(), paid_by: FieldValue.delete(), "faturamento.paga_em": FieldValue.delete(), updated_at: FieldValue.serverTimestamp() });
    transaction.set(
      periodo.portal,
      {
        customer_code: fatura.customer_code,
        status: paga ? "pago" : "emitido",
        payment_status: paga ? "paid" : "issued",
        pago_em: paga ? iso : FieldValue.delete(),
        published_at: FieldValue.serverTimestamp(),
        updated_at: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }
}

function moverDemandas({ transaction, caller, iso }: Contexto, refs: DocumentReference[], etapa: string, extra: Record<string, unknown>) {
  for (const ref of refs) {
    transaction.update(ref, {
      etapa,
      etapa_desde: iso,
      marcos: FieldValue.arrayUnion({ etapa, em: iso, por_uid: caller.uid }),
      ...extra,
      updated_at: FieldValue.serverTimestamp(),
      updated_by: caller.uid,
    });
  }
}

export async function advanceFaturaFor(
  db: Firestore,
  caller: FinanceiroProfile,
  dados: unknown,
  agora: () => Date = () => new Date(),
): Promise<ResultadoDaCobranca & { replayed?: true }> {
  const problema = financeiroProblem(caller.role);
  if (problema) throw new HttpsError("permission-denied", problema);
  const pedido = interpretarAvanco(dados);
  const instante = agora();
  const hoje = DIA_EM_SAO_PAULO.format(instante);
  const ator: FinanceiroActor = { uid: caller.uid, role: caller.role, ...(caller.email ? { email: caller.email } : {}), ...(caller.name ? { name: caller.name } : {}) };

  return runIdempotent<ResultadoDaCobranca>(
    db,
    { kind: `fatura_${pedido.acao}`, scope: { fatura: pedido.fatura_id }, idempotency_key: pedido.idempotency_key, input: pedido, actor: ator },
    async (transaction, { operationId }) => {
      const faturaRef = db.collection(FATURAS_COLLECTION).doc(pedido.fatura_id);
      const snap = await transaction.get(faturaRef);
      if (!snap.exists) throw new HttpsError("not-found", "NF não encontrada.");
      const dadosAtuais = snap.data() ?? {};
      const fatura = faturaLida(snap.id, dadosAtuais);
      const iso = instante.toISOString();
      const projecaoRef = db.collection(CLIENT_FATURAS_COLLECTION).doc(fatura.id);
      const projecaoAnterior = (await transaction.get(projecaoRef)).data() ?? null;
      const projetar = (mudancas: Record<string, unknown>) =>
        transaction.set(projecaoRef, projecaoDaFatura({ ...dadosAtuais, ...mudancas }, { anterior: projecaoAnterior, atualizadaEm: iso }));
      const contexto: Contexto = { db, transaction, caller, ator, operationId, fatura, iso };
      const evento = { operation_id: operationId, entity_id: fatura.id, customer_code: fatura.customer_code, actor: ator, occurred_at: iso };
      const atualizado = { updated_at: FieldValue.serverTimestamp(), updated_by: caller.uid };

      if (pedido.acao === "send") {
        conferirEnvio(fatura, pedido.enviada_em, hoje);
        const enviada = { em: pedido.enviada_em, meio: pedido.meio, por_uid: caller.uid, registrada_em: iso };
        transaction.update(faturaRef, { status: "enviada", enviada, ...atualizado });
        projetar({ status: "enviada", enviada });
        createFinanceiroEvent(transaction, db, { ...evento, type: "nf.sent", payload: { id: fatura.id, enviada_em: pedido.enviada_em, meio: pedido.meio } });
        const result = { id: fatura.id, acao: pedido.acao, status: "enviada" as const, recebido_cents: fatura.recebido_cents, saldo_cents: fatura.valor_cents - fatura.recebido_cents };
        return { target_id: fatura.id, result };
      }

      if (pedido.acao === "pay") {
        const valorCents = centavosDoTexto(pedido.valor);
        const resultado = aplicarPagamento(fatura, valorCents, pedido.recebido_em, hoje);
        const demandas = resultado.quitada ? await demandasDaFatura(contexto, "faturada") : [];
        const periodos = resultado.quitada ? await periodosDaFatura(contexto, "emitido") : [];
        const pagamentoId = pagamentoIdDaOperacao(fatura.id, operationId);
        porNaFila(transaction, db, dadosAtuais, {
          pagamento_id: pagamentoId,
          fatura_id: fatura.id,
          customer_code: fatura.customer_code,
          valor_cents: valorCents,
          recebido_em: pedido.recebido_em,
          iso,
          instante,
        });
        transaction.create(db.collection(PAGAMENTOS_COLLECTION).doc(pagamentoId), {
          id: pagamentoId,
          fatura_id: fatura.id,
          customer_code: fatura.customer_code,
          status: "registrado",
          valor_cents: valorCents,
          recebido_em: pedido.recebido_em,
          forma: pedido.forma,
          observacao: pedido.observacao || null,
          registrado_por: { uid: caller.uid, role: caller.role },
          registrado_em: iso,
          operation_id: operationId,
          created_at: FieldValue.serverTimestamp(),
        });
        transaction.update(faturaRef, {
          status: resultado.status,
          recebido_cents: resultado.recebido_cents,
          pagamento_ids: FieldValue.arrayUnion(pagamentoId),
          ...(resultado.quitada ? { paga_em: pedido.recebido_em } : {}),
          ...atualizado,
        });
        projetar({ status: resultado.status, recebido_cents: resultado.recebido_cents, ...(resultado.quitada ? { paga_em: pedido.recebido_em } : {}) });
        if (resultado.quitada) moverDemandas(contexto, demandas, "paga", { "faturamento.paga_em": pedido.recebido_em });
        marcarArmazenagem(contexto, periodos, { recebidoEm: pedido.recebido_em });
        createFinanceiroEvent(transaction, db, {
          ...evento,
          type: "cobranca.payment_registered",
          payload: {
            id: fatura.id,
            pagamento_id: pagamentoId,
            recebido_em: pedido.recebido_em,
            forma: pedido.forma,
            quitada: resultado.quitada,
            competencias: periodos.map((periodo) => periodo.competencia),
          },
        });
        return { target_id: pagamentoId, result: { id: fatura.id, acao: pedido.acao, status: resultado.status, recebido_cents: resultado.recebido_cents, saldo_cents: resultado.saldo_cents, pagamento_id: pagamentoId } };
      }

      if (pedido.acao === "reverse_payment") {
        const pagamentoRef = db.collection(PAGAMENTOS_COLLECTION).doc(pedido.pagamento_id);
        const pagamentoSnap = await transaction.get(pagamentoRef);
        const resultado = aplicarEstorno(fatura, pagamentoSnap.exists ? pagamentoLido(pagamentoSnap.id, pagamentoSnap.data() ?? {}) : null);
        const demandas = resultado.reaberta ? await demandasDaFatura(contexto, "paga") : [];
        const periodos = resultado.reaberta ? await periodosDaFatura(contexto, "pago") : [];
        const baixa = await lerBaixaDoPagamento(transaction, db, dadosAtuais, pedido.pagamento_id);
        transaction.update(pagamentoRef, { status: "estornado", estornado: { em: iso, por_uid: caller.uid, motivo: pedido.motivo }, updated_at: FieldValue.serverTimestamp() });
        transaction.update(faturaRef, {
          status: resultado.status,
          recebido_cents: resultado.recebido_cents,
          ...(resultado.reaberta ? { paga_em: FieldValue.delete() } : {}),
          ...atualizado,
        });
        projetar({ status: resultado.status, recebido_cents: resultado.recebido_cents, ...(resultado.reaberta ? { paga_em: null } : {}) });
        if (resultado.reaberta) moverDemandas(contexto, demandas, "faturada", { "faturamento.paga_em": FieldValue.delete() });
        marcarArmazenagem(contexto, periodos, null);
        estornarBaixa(transaction, db, baixa, { instante, iso, operationId, ator });
        createFinanceiroEvent(transaction, db, {
          ...evento,
          type: "cobranca.payment_reversed",
          payload: { id: fatura.id, pagamento_id: pedido.pagamento_id, reaberta: resultado.reaberta, competencias: periodos.map((periodo) => periodo.competencia) },
        });
        return { target_id: pedido.pagamento_id, result: { id: fatura.id, acao: pedido.acao, status: resultado.status, recebido_cents: resultado.recebido_cents, saldo_cents: resultado.saldo_cents, pagamento_id: pedido.pagamento_id } };
      }

      // cancel
      conferirCancelamento(fatura);
      const demandas = await demandasDaFatura(contexto, "faturada");
      const periodos = await periodosDaFatura(contexto, "emitido");
      transaction.update(faturaRef, { status: "cancelada", cancelada: { em: iso, por_uid: caller.uid, motivo: pedido.motivo }, ...atualizado });
      moverDemandas(contexto, demandas, "a_faturar", { faturamento: FieldValue.delete() });
      for (const periodo of periodos) {
        transaction.update(periodo.ref, { faturamento: FieldValue.delete(), updated_at: FieldValue.serverTimestamp() });
      }
      // O registro cancelado era um erro: some do portal.
      transaction.delete(projecaoRef);
      for (const autorizacao of fatura.autorizacao_ids) {
        transaction.update(db.collection(AUTHORIZATIONS_COLLECTION).doc(autorizacao), { nf_ids: FieldValue.arrayRemove(fatura.id) });
      }
      createFinanceiroEvent(transaction, db, {
        ...evento,
        type: "nf.cancelled",
        payload: { id: fatura.id, demandas: fatura.demanda_numeros, competencias: periodos.map((periodo) => periodo.competencia) },
      });
      return { target_id: fatura.id, result: { id: fatura.id, acao: pedido.acao, status: "cancelada", recebido_cents: 0, saldo_cents: fatura.valor_cents } };
    },
  );
}
