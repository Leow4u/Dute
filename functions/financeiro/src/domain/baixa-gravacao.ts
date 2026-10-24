import { FieldValue, type DocumentSnapshot, type Firestore, type Transaction } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";
import { z } from "zod";

import {
  BAIXAS_COLLECTION,
  ID_DA_BAIXA,
  baixaLida,
  baixaNoEstorno,
  comAcaoNaBaixa,
  idDaBaixa,
  novaBaixa,
  osDaFatura,
  type Baixa,
  type EtapaDaBaixa,
  type MotivoDaParadaDaBaixa,
} from "./baixa-omie.js";
import { omieLiberada } from "./emissao-omie.js";
import { createFinanceiroEvent } from "./events.js";
import { runIdempotent, type FinanceiroActor } from "./operations.js";
import { financeiroProblem } from "./platform-roles.js";
import type { FinanceiroProfile } from "./profile.js";

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
  const nf = (fatura.nf ?? {}) as Record<string, unknown>;
  transaction.create(db.collection(BAIXAS_COLLECTION).doc(baixa.id), {
    ...baixa,
    // Só para a tela (parte 7.4h): a máquina da baixa não lê.
    customer_name: typeof fatura.customer_name === "string" ? fatura.customer_name : null,
    nf_numero: typeof nf.numero === "string" ? nf.numero : null,
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

// --- A pessoa retoma ou dispensa (parte 7.4h) ---------------------------------------------

function exigirFinanceiro(caller: FinanceiroProfile): void {
  const problema = financeiroProblem(caller.role);
  if (problema) throw new HttpsError("permission-denied", problema);
}

function atorDe(caller: FinanceiroProfile): FinanceiroActor {
  return { uid: caller.uid, role: caller.role, ...(caller.email ? { email: caller.email } : {}), ...(caller.name ? { name: caller.name } : {}) };
}

const AcaoNaBaixa = z
  .object({
    idempotency_key: z.string().trim().min(1, "Informe a chave de idempotência.").max(200),
    id: z.string().regex(ID_DA_BAIXA, "Baixa inválida."),
    acao: z.enum(["retomar", "dispensar"], { errorMap: () => ({ message: "Ação: use retomar ou dispensar." }) }),
    expected_edicao: z.number().int().min(1),
  })
  .strict();

export type ResultadoDaAcaoNaBaixa = { id: string; etapa: EtapaDaBaixa; edicao: number };

/** actOnNfSettlement: a baixa parada volta à fila (retomar) ou acaba resolvida à mão (dispensar), com a edição que a tela viu. */
export async function actOnNfSettlementFor(
  db: Firestore,
  caller: FinanceiroProfile,
  dados: unknown,
  opcoes: { projectId: string; agora?: () => Date },
): Promise<ResultadoDaAcaoNaBaixa & { replayed?: true }> {
  exigirFinanceiro(caller);
  if (!omieLiberada(opcoes.projectId)) {
    throw new HttpsError("failed-precondition", `A baixa na Omie ainda não está liberada neste ambiente (${opcoes.projectId || "projeto não identificado"}).`);
  }
  const lido = AcaoNaBaixa.safeParse(dados);
  if (!lido.success) throw new HttpsError("invalid-argument", lido.error.issues[0]?.message ?? "Pedido inválido.");
  const pedido = lido.data;
  const ator = atorDe(caller);
  const instante = (opcoes.agora ?? (() => new Date()))();
  return runIdempotent<ResultadoDaAcaoNaBaixa>(
    db,
    { kind: "nf_baixa_acao", scope: { id: pedido.id }, idempotency_key: pedido.idempotency_key, input: pedido, actor: ator },
    async (transaction, { operationId }) => {
      const snap = await transaction.get(db.collection(BAIXAS_COLLECTION).doc(pedido.id));
      if (!snap.exists) throw new HttpsError("not-found", "Baixa não encontrada.");
      let atual: Baixa;
      try {
        atual = baixaLida(snap.id, snap.data() ?? {});
      } catch {
        throw new HttpsError("failed-precondition", "Baixa ilegível.");
      }
      if (atual.edicao !== pedido.expected_edicao) throw new HttpsError("failed-precondition", "A baixa mudou. Abra de novo.");
      const nova = comAcaoNaBaixa(atual, pedido.acao, instante);
      if ("problema" in nova) throw new HttpsError("failed-precondition", nova.problema);
      const iso = instante.toISOString();
      const evento = { operation_id: operationId, entity_id: atual.id, customer_code: atual.customer_code, actor: ator, occurred_at: iso };
      if (pedido.acao === "retomar") {
        gravarBaixa(transaction, db, nova, { retomada_por: ator, retomada_em: iso });
        createFinanceiroEvent(transaction, db, { ...evento, type: "nf.settlement_resumed", payload: { id: atual.id, etapa_depois: nova.etapa as "na_fila" | "cancelando" } });
      } else {
        const motivo: MotivoDaParadaDaBaixa = atual.motivo_da_parada ?? "falhas_seguidas";
        gravarBaixa(transaction, db, nova, { dispensada: { por: ator, em: iso, motivo_da_parada: motivo } });
        createFinanceiroEvent(transaction, db, { ...evento, type: "nf.settlement_dismissed", payload: { id: atual.id, motivo } });
      }
      return { target_id: atual.id, result: { id: atual.id, etapa: nova.etapa, edicao: nova.edicao } };
    },
  );
}

// --- A leitura -------------------------------------------------------------------------------

/** As baixas que a tela mostra: as paradas, que esperam uma pessoa, e as que a rotina ainda anda. */
export const ETAPAS_NA_LISTA: readonly EtapaDaBaixa[] = ["parada", "na_fila", "cancelando"];

/** Quantas baixas abertas a tela lista. */
export const BAIXAS_NA_LISTA = 100;

export type BaixaNaLista = {
  id: string;
  pagamento_id: string;
  fatura_id: string;
  customer_code: string;
  customer_name: string | null;
  nf_numero: string | null;
  etapa: EtapaDaBaixa;
  motivo_da_parada: MotivoDaParadaDaBaixa | null;
  mensagem: string | null;
  valor_cents: number;
  recebido_em: string;
  criada_em: string;
  edicao: number;
};

/** listNfSettlements: as baixas abertas, as mais novas primeiro. As lançadas, canceladas e dispensadas acabaram. */
export async function listNfSettlementsFor(db: Firestore, caller: FinanceiroProfile): Promise<{ baixas: BaixaNaLista[] }> {
  exigirFinanceiro(caller);
  const snapshot = await db.collection(BAIXAS_COLLECTION).where("etapa", "in", [...ETAPAS_NA_LISTA]).limit(BAIXAS_NA_LISTA).get();
  const baixas = snapshot.docs.flatMap((doc) => {
    let baixa: Baixa;
    try {
      baixa = baixaLida(doc.id, doc.data());
    } catch {
      return [];
    }
    const texto = (campo: string) => {
      const valor = doc.get(campo);
      return typeof valor === "string" && valor ? valor : null;
    };
    return [
      {
        id: baixa.id,
        pagamento_id: baixa.pagamento_id,
        fatura_id: baixa.fatura_id,
        customer_code: baixa.customer_code,
        customer_name: texto("customer_name"),
        nf_numero: texto("nf_numero"),
        etapa: baixa.etapa,
        motivo_da_parada: baixa.motivo_da_parada,
        mensagem: baixa.mensagem,
        valor_cents: baixa.valor_cents,
        recebido_em: baixa.recebido_em,
        criada_em: texto("criada_em") ?? "",
        edicao: baixa.edicao,
      },
    ];
  });
  baixas.sort((a, b) => b.criada_em.localeCompare(a.criada_em) || a.id.localeCompare(b.id));
  return { baixas };
}
