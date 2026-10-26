import { FieldValue, type DocumentReference, type DocumentSnapshot, type Firestore, type Transaction } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";

import {
  BILLING_PERIODS_COLLECTION,
  armazenagemNaFatura,
  periodoLido,
  problemaDaArmazenagem,
  rotuloDaCompetencia,
  type PeriodoParaFaturar,
} from "./armazenagem.js";
import { CAMPO_DA_RESERVA } from "./emissao-omie.js";
import { createFinanceiroEvent } from "./events.js";
import {
  AUTHORIZATIONS_COLLECTION,
  DEMANDS_COLLECTION,
  FATURAS_COLLECTION,
  MAX_DEMANDAS_NA_NF,
  MEDICOES_COLLECTION,
  autorizacaoLida,
  autorizacoesDaFatura,
  demandaLida,
  documentoDaFatura,
  falha,
  faturaIdDaNf,
  interpretarRegistro,
  medicaoLida,
  medicaoNaFatura,
  problemaDaMedicao,
  problemaParaFaturar,
  rotuloDaMedicao,
  valorDaRv,
  valorNaMedicao,
  type AutorizacaoLida,
  type DemandaNaFatura,
  type DemandaParaFaturar,
  type FormaDePagamento,
  type MedicaoNaFatura,
} from "./fatura.js";
import { runIdempotent, type FinanceiroActor } from "./operations.js";
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
 *
 * A medição aprovada (pergunta 64) entra pelo total aprovado: as demandas
 * dela ficam Faturadas como as outras, e a medição ganha o mesmo
 * `faturamento`.
 */

const DIA_EM_SAO_PAULO = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" });

export type ResultadoDoRegistro = { id: string; valor_cents: number; demandas: string[]; armazenagem: string[]; medicoes?: string[] };

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

      const lido = await lerParaFaturar(transaction, db, pedido);

      const iso = instante.toISOString();
      const gravada = gravarFatura(transaction, db, {
        id,
        lido,
        nf: { numero: pedido.nf.numero, serie, emitida_em: pedido.nf.emitida_em },
        vencimento: pedido.vencimento,
        forma: pedido.forma,
        observacao: pedido.observacao || null,
        anterior,
        iso,
        operationId,
        ator,
      });

      const medicoes = pedido.medicoes?.length ? { medicoes: pedido.medicoes } : {};
      return { target_id: id, result: { id, valor_cents: gravada.valor_cents, demandas: pedido.demandas, armazenagem: pedido.armazenagem, ...medicoes } };
    },
  );
}

export type LidoParaFaturar = {
  cliente: string;
  customer_name: string | null;
  /** As demandas da NF: as pedidas e as das medições. */
  demandaRefs: DocumentReference[];
  demandaSnaps: DocumentSnapshot[];
  periodoRefs: DocumentReference[];
  periodos: PeriodoParaFaturar[];
  medicaoRefs: DocumentReference[];
  medicoes: MedicaoNaFatura[];
  naFatura: DemandaNaFatura[];
};

/**
 * As leituras e as conferências do faturamento, antes de qualquer escrita,
 * na transação de quem fatura: o `registerNf` e a emissão da NFS-e pela Omie
 * (partes 7.4c e 7.4d), que assim conferem e valoram igual. Cada demanda A
 * faturar, do mesmo cliente, com a autorização que o contrato pede; cada
 * competência emitida no WMS e fora de NF; o valor de cada demanda pela RV
 * validada. A medição aprovada (pergunta 64) traz as demandas dela, todas A
 * faturar e presas a ela, cada uma pela soma das linhas dela, e a
 * autorização registrada que a aprovação criou; a demanda da medição pedida
 * sozinha é recusada. `emissao` é a emissão que está faturando: a reserva
 * dela não conta contra ela mesma.
 */
export async function lerParaFaturar(
  transaction: Transaction,
  db: Firestore,
  pedido: { demandas: readonly string[]; armazenagem: readonly string[]; medicoes?: readonly string[] },
  emissao: string | null = null,
): Promise<LidoParaFaturar> {
  const pedidas = pedido.medicoes ?? [];
  const pedidaRefs = pedido.demandas.map((numero) => db.collection(DEMANDS_COLLECTION).doc(numero));
  const pedidaSnaps = pedidaRefs.length ? await transaction.getAll(...pedidaRefs) : [];
  const avulsas = pedidaSnaps.map((snap, indice) => {
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
    const motivo = problemaDaArmazenagem(periodo, emissao);
    if (motivo) falha(motivo);
  }
  const medicaoRefs = pedidas.map((id) => db.collection(MEDICOES_COLLECTION).doc(id));
  const medicaoSnaps = medicaoRefs.length ? await transaction.getAll(...medicaoRefs) : [];
  const medicoes = medicaoSnaps.map((snap, indice) => {
    if (!snap.exists) throw new HttpsError("not-found", `Medição ${pedidas[indice]} não encontrada.`);
    return { lida: medicaoLida(snap.id, snap.data() ?? {}), dados: snap.data() ?? {} };
  });
  for (const { lida } of medicoes) {
    const motivo = problemaDaMedicao(lida, emissao);
    if (motivo) falha(motivo);
  }
  const cliente = avulsas[0]?.customer_code ?? periodos[0]?.customer_code ?? medicoes[0]?.lida.customer_code ?? "";
  if (avulsas.length && !cliente) falha(`A demanda ${avulsas[0].numero} não tem cliente.`);
  if (avulsas.some((demanda) => demanda.customer_code !== cliente)) {
    throw new HttpsError("invalid-argument", "As demandas são de clientes diferentes: uma NF é de um cliente só.");
  }
  const deOutro = periodos.find((periodo) => periodo.customer_code !== cliente);
  if (deOutro) {
    throw new HttpsError("invalid-argument", `A armazenagem de ${rotuloDaCompetencia(deOutro.competencia)} é de outro cliente: uma NF é de um cliente só.`);
  }
  const medicaoDeOutro = medicoes.find(({ lida }) => lida.customer_code !== cliente);
  if (medicaoDeOutro) {
    throw new HttpsError("invalid-argument", `A medição de ${rotuloDaMedicao(medicaoDeOutro.lida.id)} é de outro cliente: uma NF é de um cliente só.`);
  }
  for (const demanda of avulsas) {
    // A demanda da medição fatura com a medição, nunca sozinha.
    const motivo = demanda.medicao_id && !demanda.faturada ? `A demanda ${demanda.numero} é da medição de ${rotuloDaMedicao(demanda.medicao_id)}: ela fatura com a medição.` : problemaParaFaturar(demanda, emissao);
    if (motivo) falha(motivo);
  }

  // As demandas de cada medição: todas A faturar, do cliente e presas a ela.
  const daMedicao = medicoes.flatMap(({ lida }) => lida.demandas.map((numero) => ({ numero, medicao: lida.id })));
  if (avulsas.length + daMedicao.length > MAX_DEMANDAS_NA_NF) {
    throw new HttpsError("invalid-argument", `Uma NF fecha até ${MAX_DEMANDAS_NA_NF} demandas, com as das medições.`);
  }
  const daMedicaoRefs = daMedicao.map(({ numero }) => db.collection(DEMANDS_COLLECTION).doc(numero));
  const daMedicaoSnaps = daMedicaoRefs.length ? await transaction.getAll(...daMedicaoRefs) : [];
  const dasMedicoes = daMedicaoSnaps.map((snap, indice) => {
    const { numero, medicao } = daMedicao[indice];
    if (!snap.exists) falha(`A demanda ${numero} da medição de ${rotuloDaMedicao(medicao)} não foi encontrada.`);
    return { demanda: demandaLida(snap.id, snap.data() ?? {}), medicao };
  });
  for (const { demanda, medicao } of dasMedicoes) {
    const motivo =
      demanda.customer_code !== cliente
        ? `A demanda ${demanda.numero} é de outro cliente.`
        : demanda.medicao_id !== medicao
          ? `A demanda ${demanda.numero} não está presa a esta medição.`
          : problemaParaFaturar(demanda, emissao);
    if (motivo) falha(`${motivo} Ela é da medição de ${rotuloDaMedicao(medicao)}.`);
  }
  const demandas: DemandaParaFaturar[] = [...avulsas, ...dasMedicoes.map(({ demanda }) => demanda)];

  // Todas as leituras antes de qualquer escrita: autorizações e RVs.
  const idsDasAutorizacoes = [...new Set([...demandas.flatMap((demanda) => demanda.autorizacao_ids), ...medicoes.map(({ lida }) => lida.autorizacao_id)])];
  const autorizacoes = new Map<string, AutorizacaoLida>();
  if (idsDasAutorizacoes.length) {
    const snaps = await transaction.getAll(...idsDasAutorizacoes.map((autorizacao) => db.collection(AUTHORIZATIONS_COLLECTION).doc(autorizacao)));
    for (const snap of snaps) if (snap.exists) autorizacoes.set(snap.id, autorizacaoLida(snap.id, snap.data() ?? {}));
  }
  for (const { lida } of medicoes) {
    const autorizacao = autorizacoes.get(lida.autorizacao_id);
    if (!autorizacao?.registrada || autorizacao.customer_code !== cliente) {
      falha(`A medição de ${rotuloDaMedicao(lida.id)} não tem a autorização de faturamento registrada.`);
    }
  }
  const revisoes = avulsas.filter((demanda) => demanda.rv !== null);
  const lidas = new Map<string, Record<string, unknown> | null>();
  if (revisoes.length) {
    const snaps = await transaction.getAll(...revisoes.map((demanda) => db.doc(`quotes/${demanda.numero}/revisoes/${demanda.rv}`)));
    snaps.forEach((snap, indice) => lidas.set(revisoes[indice].numero, snap.exists ? (snap.data() ?? {}) : null));
  }

  const dadosDaMedicao = new Map(medicoes.map(({ lida, dados }) => [lida.id, dados]));
  const naFatura: DemandaNaFatura[] = [
    ...avulsas.map((demanda) => ({
      numero: demanda.numero,
      rv: demanda.rv,
      medicao_id: null,
      autorizacao_ids: autorizacoesDaFatura(demanda, autorizacoes),
      valor_cents: valorDaRv(demanda, lidas.get(demanda.numero) ?? null),
    })),
    ...dasMedicoes.map(({ demanda, medicao }) => ({
      numero: demanda.numero,
      rv: null,
      medicao_id: medicao,
      autorizacao_ids: autorizacoesDaFatura(demanda, autorizacoes),
      valor_cents: valorNaMedicao(demanda.numero, dadosDaMedicao.get(medicao) ?? null),
    })),
  ];

  return {
    cliente,
    customer_name: demandas[0]?.customer_name ?? null,
    demandaRefs: [...pedidaRefs, ...daMedicaoRefs],
    demandaSnaps: [...pedidaSnaps, ...daMedicaoSnaps],
    periodoRefs,
    periodos,
    medicaoRefs,
    medicoes: medicoes.map(({ lida }) => medicaoNaFatura(lida)),
    naFatura,
  };
}

export type GravacaoDaFatura = {
  id: string;
  lido: LidoParaFaturar;
  nf: { numero: string; serie: string; emitida_em: string };
  vencimento: string;
  forma: FormaDePagamento;
  observacao: string | null;
  /** O registro cancelado da mesma NF (parte 4.2a), ou null. */
  anterior: Record<string, unknown> | null;
  iso: string;
  operationId: string;
  ator: FinanceiroActor;
  /** O que a origem acrescenta à fatura (a emissão da Omie, na parte 7.4d). */
  extra?: Record<string, unknown>;
};

/**
 * As escritas da fatura, depois da lerParaFaturar: a fatura e a projeção do
 * portal, as demandas Faturadas, as competências com o faturamento, as
 * autorizações com a NF e o evento `nf.registered`. A reserva da emissão
 * (parte 7.4b) sai junto.
 */
export function gravarFatura(transaction: Transaction, db: Firestore, entrada: GravacaoDaFatura): { valor_cents: number } {
  const { id, lido, nf, iso, operationId, ator, anterior } = entrada;
  const faturaRef = db.collection(FATURAS_COLLECTION).doc(id);
  const { cliente, customer_name, demandaSnaps, demandaRefs, periodoRefs, periodos, medicaoRefs, medicoes, naFatura } = lido;
  const documento = documentoDaFatura({
    id,
    customer_code: cliente,
    customer_name,
    demandas: naFatura,
    armazenagem: periodos.map(armazenagemNaFatura),
    medicoes,
    nf,
    vencimento: entrada.vencimento,
    forma: entrada.forma,
    observacao: entrada.observacao,
    registrada_por: { uid: ator.uid, role: ator.role },
    registrada_em: iso,
    operation_id: operationId,
  });
  Object.assign(documento, entrada.extra ?? {});
  transaction.set(
    db.collection(CLIENT_FATURAS_COLLECTION).doc(id),
    projecaoDaFatura(documento, { demandas: new Map(demandaSnaps.map((snap) => [snap.id, demandaParaOCliente(snap.data() ?? {})])), atualizadaEm: iso }),
  );
  if (anterior) {
    const resumo = {
      registrada_em: anterior.registrada_em ?? null,
      cancelada: anterior.cancelada ?? null,
      demanda_numeros: anterior.demanda_numeros ?? [],
      periodo_ids: anterior.periodo_ids ?? [],
      ...(Array.isArray(anterior.medicao_ids) ? { medicao_ids: anterior.medicao_ids } : {}),
      operation_id: anterior.operation_id ?? null,
    };
    const anteriores = Array.isArray(anterior.anteriores) ? anterior.anteriores : [];
    transaction.set(faturaRef, { ...documento, anteriores: [...anteriores, resumo], created_at: anterior.created_at ?? FieldValue.serverTimestamp(), updated_at: FieldValue.serverTimestamp() });
  } else {
    transaction.create(faturaRef, { ...documento, created_at: FieldValue.serverTimestamp() });
  }

  const faturamento = { fatura_id: id, nf, vencimento: entrada.vencimento, registrada_em: iso };
  for (const ref of demandaRefs) {
    transaction.update(ref, {
      etapa: "faturada",
      etapa_desde: iso,
      marcos: FieldValue.arrayUnion({ etapa: "faturada", em: iso, por_uid: ator.uid }),
      faturamento,
      [CAMPO_DA_RESERVA]: FieldValue.delete(),
      updated_at: FieldValue.serverTimestamp(),
      updated_by: ator.uid,
    });
  }
  for (const ref of [...periodoRefs, ...medicaoRefs]) {
    transaction.update(ref, { faturamento, [CAMPO_DA_RESERVA]: FieldValue.delete(), updated_at: FieldValue.serverTimestamp() });
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
      demandas: naFatura.map((demanda) => demanda.numero),
      competencias: periodos.map((periodo) => periodo.competencia),
      ...(medicoes.length ? { medicoes: medicoes.map((medicao) => medicao.medicao_id) } : {}),
      autorizacoes: citadas.length,
      emitida_em: nf.emitida_em,
      vencimento: entrada.vencimento,
      forma: entrada.forma,
    },
    actor: ator,
    occurred_at: iso,
  });

  return { valor_cents: documento.valor_cents as number };
}
