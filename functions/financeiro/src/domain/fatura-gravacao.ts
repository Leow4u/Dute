import { FieldValue, type DocumentReference, type Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";

import {
  BILLING_PERIODS_COLLECTION,
  armazenagemNaFatura,
  periodoLido,
  problemaDaArmazenagem,
  rotuloDaCompetencia,
} from "./armazenagem.js";
import { createFinanceiroEvent } from "./events.js";
import {
  AUTHORIZATIONS_COLLECTION,
  DEMANDS_COLLECTION,
  FATURAS_COLLECTION,
  MEDICOES_COLLECTION,
  autorizacaoLida,
  autorizacoesDaFatura,
  demandaLida,
  documentoDaFatura,
  falha,
  faturaIdDaNf,
  interpretarRegistro,
  problemaParaFaturar,
  valorDaRv,
  valorNaMedicao,
  type AutorizacaoLida,
  type DemandaNaFatura,
} from "./fatura.js";
import { runIdempotent } from "./operations.js";
import { CLIENT_FATURAS_COLLECTION, demandaParaOCliente, projecaoDaFatura } from "./projecao.js";
import { financeiroProblem } from "./platform-roles.js";
import type { FinanceiroProfile } from "./profile.js";

/**
 * Registrar a NF (parte 4.1a): numa transação, confere cada demanda (A
 * faturar, do mesmo cliente, com a autorização que o contrato pede), lê o
 * valor no servidor, grava `faturas/{id}`, leva as demandas a Faturada com o
 * marco e o resumo `faturamento`, marca as autorizações citadas (`nf_ids`,
 * reservado desde a parte 15 do Comercial) e grava o evento `nf.registered`.
 * A NF cujo registro foi cancelado (parte 4.2a) se registra de novo por cima,
 * guardando o registro anterior em `anteriores`. A projeção do portal
 * (`client_faturas`, parte 4.3a) nasce na mesma transação.
 *
 * A competência de armazenagem emitida no WMS (parte 7.2a) entra pelo total
 * congelado na emissão e ganha o mesmo resumo `faturamento` da demanda. O
 * status do WMS fica `emitido` até o pagamento.
 */

const DIA_EM_SAO_PAULO = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" });

export type ResultadoDoRegistro = { id: string; valor_cents: number; demandas: string[]; armazenagem: string[] };

export async function registerNfFor(
  db: Firestore,
  caller: FinanceiroProfile,
  dados: unknown,
  agora: () => Date = () => new Date(),
): Promise<ResultadoDoRegistro & { replayed?: true }> {
  const problema = financeiroProblem(caller.role);
  if (problema) throw new HttpsError("permission-denied", problema);
  const pedido = interpretarRegistro(dados);
  const instante = agora();
  if (pedido.nf.emitida_em > DIA_EM_SAO_PAULO.format(instante)) {
    throw new HttpsError("invalid-argument", "A data de emissão da NF ainda não chegou.");
  }
  const serie = pedido.nf.serie ?? "1";
  const id = faturaIdDaNf(serie, pedido.nf.numero);
  const ator = { uid: caller.uid, role: caller.role, ...(caller.email ? { email: caller.email } : {}), ...(caller.name ? { name: caller.name } : {}) };

  return runIdempotent<ResultadoDoRegistro>(
    db,
    { kind: "nf_register", scope: { fatura: id }, idempotency_key: pedido.idempotency_key, input: pedido, actor: ator },
    async (transaction, { operationId }) => {
      const faturaRef = db.collection(FATURAS_COLLECTION).doc(id);
      // A NF cujo registro foi cancelado (parte 4.2a) pode ser registrada de novo; o registro anterior fica em `anteriores`.
      const existente = await transaction.get(faturaRef);
      const anterior = existente.exists ? (existente.data() ?? {}) : null;
      if (anterior && anterior.status !== "cancelada") falha(`A NF ${pedido.nf.numero} da série ${serie} já está registrada.`);

      const demandaRefs = pedido.demandas.map((numero) => db.collection(DEMANDS_COLLECTION).doc(numero));
      const demandaSnaps = demandaRefs.length ? await transaction.getAll(...demandaRefs) : [];
      const demandas = demandaSnaps.map((snap, indice) => {
        if (!snap.exists) throw new HttpsError("not-found", `Demanda ${pedido.demandas[indice]} não encontrada.`);
        return demandaLida(snap.id, snap.data() ?? {});
      });
      const periodoRefs = pedido.armazenagem.map((periodo) => db.collection(BILLING_PERIODS_COLLECTION).doc(periodo));
      const periodoSnaps = periodoRefs.length ? await transaction.getAll(...periodoRefs) : [];
      const periodos = periodoSnaps.map((snap, indice) => {
        if (!snap.exists) throw new HttpsError("not-found", `Competência de armazenagem ${pedido.armazenagem[indice]} não encontrada.`);
        return periodoLido(snap.id, snap.data() ?? {});
      });
      for (const periodo of periodos) {
        const motivo = problemaDaArmazenagem(periodo);
        if (motivo) falha(motivo);
      }
      const cliente = demandas.length ? demandas[0].customer_code : periodos[0].customer_code;
      if (demandas.length && !cliente) falha(`A demanda ${demandas[0].numero} não tem cliente.`);
      if (demandas.some((demanda) => demanda.customer_code !== cliente)) {
        throw new HttpsError("invalid-argument", "As demandas são de clientes diferentes: uma NF é de um cliente só.");
      }
      const deOutro = periodos.find((periodo) => periodo.customer_code !== cliente);
      if (deOutro) {
        throw new HttpsError("invalid-argument", `A armazenagem de ${rotuloDaCompetencia(deOutro.competencia)} é de outro cliente: uma NF é de um cliente só.`);
      }
      for (const demanda of demandas) {
        const motivo = problemaParaFaturar(demanda);
        if (motivo) falha(motivo);
      }

      // Todas as leituras antes de qualquer escrita: autorizações, RVs e medições.
      const idsDasAutorizacoes = [...new Set(demandas.flatMap((demanda) => demanda.autorizacao_ids))];
      const autorizacoes = new Map<string, AutorizacaoLida>();
      if (idsDasAutorizacoes.length) {
        const snaps = await transaction.getAll(...idsDasAutorizacoes.map((autorizacao) => db.collection(AUTHORIZATIONS_COLLECTION).doc(autorizacao)));
        for (const snap of snaps) if (snap.exists) autorizacoes.set(snap.id, autorizacaoLida(snap.id, snap.data() ?? {}));
      }
      const fontes = new Map<string, DocumentReference>();
      for (const demanda of demandas) {
        if (demanda.medicao_id) fontes.set(`medicao:${demanda.medicao_id}`, db.collection(MEDICOES_COLLECTION).doc(demanda.medicao_id));
        else if (demanda.rv !== null) fontes.set(`rv:${demanda.numero}`, db.doc(`quotes/${demanda.numero}/revisoes/${demanda.rv}`));
      }
      const lidas = new Map<string, Record<string, unknown> | null>();
      if (fontes.size) {
        const chaves = [...fontes.keys()];
        const snaps = await transaction.getAll(...fontes.values());
        snaps.forEach((snap, indice) => lidas.set(chaves[indice], snap.exists ? (snap.data() ?? {}) : null));
      }

      const naFatura: DemandaNaFatura[] = demandas.map((demanda) => ({
        numero: demanda.numero,
        rv: demanda.medicao_id ? null : demanda.rv,
        medicao_id: demanda.medicao_id,
        autorizacao_ids: autorizacoesDaFatura(demanda, autorizacoes),
        valor_cents: demanda.medicao_id
          ? valorNaMedicao(demanda.numero, lidas.get(`medicao:${demanda.medicao_id}`) ?? null)
          : valorDaRv(demanda, lidas.get(`rv:${demanda.numero}`) ?? null),
      }));

      const iso = instante.toISOString();
      const documento = documentoDaFatura({
        id,
        customer_code: cliente,
        customer_name: demandas[0]?.customer_name ?? null,
        demandas: naFatura,
        armazenagem: periodos.map(armazenagemNaFatura),
        nf: { numero: pedido.nf.numero, serie, emitida_em: pedido.nf.emitida_em },
        vencimento: pedido.vencimento,
        forma: pedido.forma,
        observacao: pedido.observacao || null,
        registrada_por: { uid: caller.uid, role: caller.role },
        registrada_em: iso,
        operation_id: operationId,
      });
      transaction.set(
        db.collection(CLIENT_FATURAS_COLLECTION).doc(id),
        projecaoDaFatura(documento, { demandas: new Map(demandaSnaps.map((snap) => [snap.id, demandaParaOCliente(snap.data() ?? {})])), atualizadaEm: iso }),
      );
      if (anterior) {
        const resumo = { registrada_em: anterior.registrada_em ?? null, cancelada: anterior.cancelada ?? null, demanda_numeros: anterior.demanda_numeros ?? [], periodo_ids: anterior.periodo_ids ?? [], operation_id: anterior.operation_id ?? null };
        const anteriores = Array.isArray(anterior.anteriores) ? anterior.anteriores : [];
        transaction.set(faturaRef, { ...documento, anteriores: [...anteriores, resumo], created_at: anterior.created_at ?? FieldValue.serverTimestamp(), updated_at: FieldValue.serverTimestamp() });
      } else {
        transaction.create(faturaRef, { ...documento, created_at: FieldValue.serverTimestamp() });
      }

      const faturamento = { fatura_id: id, nf: { numero: pedido.nf.numero, serie, emitida_em: pedido.nf.emitida_em }, vencimento: pedido.vencimento, registrada_em: iso };
      for (const ref of demandaRefs) {
        transaction.update(ref, {
          etapa: "faturada",
          etapa_desde: iso,
          marcos: FieldValue.arrayUnion({ etapa: "faturada", em: iso, por_uid: caller.uid }),
          faturamento,
          updated_at: FieldValue.serverTimestamp(),
          updated_by: caller.uid,
        });
      }
      for (const ref of periodoRefs) {
        transaction.update(ref, { faturamento, updated_at: FieldValue.serverTimestamp() });
      }
      const citadas = documento.autorizacao_ids as string[];
      for (const autorizacao of citadas) {
        transaction.update(db.collection(AUTHORIZATIONS_COLLECTION).doc(autorizacao), { nf_ids: FieldValue.arrayUnion(id) });
      }

      createFinanceiroEvent(transaction, db, {
        operation_id: operationId,
        type: "nf.registered",
        entity_id: id,
        customer_code: cliente,
        payload: {
          id,
          demandas: pedido.demandas,
          competencias: periodos.map((periodo) => periodo.competencia),
          autorizacoes: citadas.length,
          emitida_em: pedido.nf.emitida_em,
          vencimento: pedido.vencimento,
          forma: pedido.forma,
        },
        actor: ator,
        occurred_at: iso,
      });

      return { target_id: id, result: { id, valor_cents: documento.valor_cents as number, demandas: pedido.demandas, armazenagem: pedido.armazenagem } };
    },
  );
}
