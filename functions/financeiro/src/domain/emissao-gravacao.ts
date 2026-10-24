import { FieldValue, type DocumentReference, type Firestore, type Transaction } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";
import { z } from "zod";

import { BILLING_PERIODS_COLLECTION, rotuloDaCompetencia } from "./armazenagem.js";
import {
  CAMPO_DA_RESERVA,
  DADOS_DA_OMIE_VAZIOS,
  EMISSOES_COLLECTION,
  ETAPAS_QUE_RESERVAM,
  ID_DA_EMISSAO,
  comAcao,
  emissaoLida,
  emissaoReservada,
  novoIdDeEmissao,
  omieLiberada,
  totalDaEmissao,
  type Emissao,
  type EtapaDaEmissao,
  type ItemDaEmissao,
  type MensagemDaPrefeitura,
  type MotivoDaParada,
} from "./emissao-omie.js";
import { createFinanceiroEvent } from "./events.js";
import { DEMANDS_COLLECTION, interpretarEmissao } from "./fatura.js";
import { lerParaFaturar } from "./fatura-gravacao.js";
import { runIdempotent, type FinanceiroActor } from "./operations.js";
import { financeiroProblem } from "./platform-roles.js";
import type { FinanceiroProfile } from "./profile.js";

/**
 * A emissão da NFS-e pela Omie no Firestore (parte 7.4c; desenho em
 * docs/plataforma/fase-7-financeiro-unificado.md, "A NFS-e pela Omie").
 *
 * - `emitNfOmie` confere como o `registerNf` (a mesma lerParaFaturar), acha
 *   o CNPJ no cadastro do cliente, grava a emissão na fila, reserva as
 *   demandas e as competências (`emissao_nf`, parte 7.4b) e grava o evento.
 * - `actOnNfEmission` é a pessoa retomando ou desistindo da emissão parada
 *   ou rejeitada; desistir sem a OS na Omie solta as reservas na hora.
 * - `listNfEmissions` dá as emissões à tela.
 *
 * Quem chama a Omie é a rotina (parte 7.4d), nunca a callable.
 */

const DIA_EM_SAO_PAULO = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" });

const CUSTOMERS_COLLECTION = "customers";

function exigirFinanceiro(caller: FinanceiroProfile): void {
  const problema = financeiroProblem(caller.role);
  if (problema) throw new HttpsError("permission-denied", problema);
}

function atorDe(caller: FinanceiroProfile): FinanceiroActor {
  return { uid: caller.uid, role: caller.role, ...(caller.email ? { email: caller.email } : {}), ...(caller.name ? { name: caller.name } : {}) };
}

function exigirLiberacao(projectId: string): void {
  if (!omieLiberada(projectId)) {
    throw new HttpsError("failed-precondition", `A emissão pela Omie ainda não está liberada neste ambiente (${projectId || "projeto não identificado"}).`);
  }
}

/** O CNPJ (ou o CPF) do cadastro do cliente, só os dígitos: é por ele que a Omie acha o cliente. */
async function cnpjDoCliente(transaction: Transaction, db: Firestore, codigo: string): Promise<string> {
  const clientes = db.collection(CUSTOMERS_COLLECTION);
  let docs = (await transaction.get(clientes.where("customer_code", "==", codigo))).docs;
  if (!docs.length) docs = (await transaction.get(clientes.where("code", "==", codigo))).docs;
  if (docs.length !== 1) throw new HttpsError("failed-precondition", `O cadastro do cliente ${codigo} não foi encontrado, ou há mais de um.`);
  const digitos = String(docs[0].get("document") ?? "").replace(/\D/g, "");
  if (!/^\d{11}(\d{3})?$/.test(digitos)) {
    throw new HttpsError("failed-precondition", `O cliente ${codigo} não tem CNPJ no cadastro: a Omie acha o cliente por ele.`);
  }
  return digitos;
}

export type ResultadoDaEmissao = { id: string; etapa: EtapaDaEmissao };

/** emitNfOmie: a NFS-e pedida à Omie para as demandas e as competências de um cliente. */
export async function emitNfOmieFor(
  db: Firestore,
  caller: FinanceiroProfile,
  dados: unknown,
  opcoes: { projectId: string; agora?: () => Date; novoId?: () => string },
): Promise<ResultadoDaEmissao & { replayed?: true }> {
  exigirFinanceiro(caller);
  exigirLiberacao(opcoes.projectId);
  const instante = (opcoes.agora ?? (() => new Date()))();
  const pedido = interpretarEmissao(dados, DIA_EM_SAO_PAULO.format(instante));
  const ator = atorDe(caller);
  return runIdempotent<ResultadoDaEmissao>(
    db,
    { kind: "nf_emissao_omie", scope: { demandas: pedido.demandas, armazenagem: pedido.armazenagem }, idempotency_key: pedido.idempotency_key, input: pedido, actor: ator },
    async (transaction, { operationId }) => {
      const lido = await lerParaFaturar(transaction, db, pedido);
      const cnpj = await cnpjDoCliente(transaction, db, lido.cliente);
      const id = (opcoes.novoId ?? novoIdDeEmissao)();
      const iso = instante.toISOString();
      const itens: ItemDaEmissao[] = [
        ...lido.naFatura.map((demanda) => ({ origem: "demanda" as const, referencia: demanda.numero, descricao: `Demanda ${demanda.numero}`, valor_cents: demanda.valor_cents })),
        ...lido.periodos.map((periodo) => ({
          origem: "armazenagem" as const,
          referencia: periodo.id,
          descricao: `Armazenagem de ${rotuloDaCompetencia(periodo.competencia)}`,
          valor_cents: periodo.valor_cents ?? 0,
        })),
      ];
      const emissao: Emissao = {
        id,
        customer_code: lido.cliente,
        customer_name: lido.customer_name,
        cnpj,
        itens,
        vencimento: pedido.vencimento,
        forma: pedido.forma,
        observacao: pedido.observacao || null,
        etapa: "na_fila",
        etapa_anterior: null,
        motivo_da_parada: null,
        mensagem: null,
        mensagens_da_prefeitura: [],
        omie: DADOS_DA_OMIE_VAZIOS,
        tentativas: 0,
        consultas: 0,
        proxima_em: iso,
        na_prefeitura_desde: null,
        conferir: false,
        edicao: 1,
      };
      transaction.create(db.collection(EMISSOES_COLLECTION).doc(id), {
        ...emissao,
        total_cents: totalDaEmissao(emissao),
        criada_em: iso,
        criada_por: ator,
        operation_id: operationId,
        created_at: FieldValue.serverTimestamp(),
        updated_at: FieldValue.serverTimestamp(),
      });
      const reserva = { [CAMPO_DA_RESERVA]: { id, desde: iso } };
      for (const ref of lido.demandaRefs) transaction.update(ref, { ...reserva, updated_at: FieldValue.serverTimestamp(), updated_by: caller.uid });
      for (const ref of lido.periodoRefs) transaction.update(ref, { ...reserva, updated_at: FieldValue.serverTimestamp() });
      createFinanceiroEvent(transaction, db, {
        operation_id: operationId,
        type: "nf.emission_requested",
        entity_id: id,
        customer_code: lido.cliente,
        payload: {
          id,
          demandas: lido.naFatura.map((demanda) => demanda.numero),
          competencias: lido.periodos.map((periodo) => periodo.competencia),
          vencimento: pedido.vencimento,
          forma: pedido.forma,
        },
        actor: ator,
        occurred_at: iso,
      });
      return { target_id: id, result: { id, etapa: emissao.etapa } };
    },
  );
}

// --- As reservas -----------------------------------------------------------------------------

export type ReservasLidas = { refs: DocumentReference[]; demandas: string[]; competencias: string[] };

function refDoItem(db: Firestore, item: ItemDaEmissao): DocumentReference {
  return item.origem === "demanda" ? db.collection(DEMANDS_COLLECTION).doc(item.referencia) : db.collection(BILLING_PERIODS_COLLECTION).doc(item.referencia);
}

/** As demandas e as competências que ainda estão reservadas por esta emissão (leitura, antes das escritas). */
export async function lerReservas(transaction: Transaction, db: Firestore, emissao: Emissao): Promise<ReservasLidas> {
  const refs = emissao.itens.map((item) => refDoItem(db, item));
  const snaps = await transaction.getAll(...refs);
  const presas = emissao.itens.flatMap((item, indice) => (snaps[indice].exists && emissaoReservada(snaps[indice].data() ?? {}) === emissao.id ? [{ item, ref: refs[indice], dados: snaps[indice].data() ?? {} }] : []));
  return {
    refs: presas.map((presa) => presa.ref),
    demandas: presas.filter((presa) => presa.item.origem === "demanda").map((presa) => presa.item.referencia),
    competencias: presas.filter((presa) => presa.item.origem === "armazenagem").map((presa) => String(presa.dados.competencia ?? presa.item.referencia.slice(-7))),
  };
}

/** Solta as reservas lidas: a demanda e a competência voltam a A faturar. */
export function soltarReservas(transaction: Transaction, reservas: ReservasLidas): void {
  for (const ref of reservas.refs) transaction.update(ref, { [CAMPO_DA_RESERVA]: FieldValue.delete(), updated_at: FieldValue.serverTimestamp() });
}

export function gravarEmissao(transaction: Transaction, db: Firestore, emissao: Emissao, extra: Record<string, unknown> = {}): void {
  transaction.update(db.collection(EMISSOES_COLLECTION).doc(emissao.id), {
    ...emissao,
    total_cents: totalDaEmissao(emissao),
    ...extra,
    updated_at: FieldValue.serverTimestamp(),
  });
}

// --- A pessoa retoma ou desiste --------------------------------------------------------------

const AcaoNaEmissao = z
  .object({
    idempotency_key: z.string().trim().min(1, "Informe a chave de idempotência.").max(200),
    id: z.string().regex(ID_DA_EMISSAO, "Emissão inválida."),
    acao: z.enum(["retomar", "desistir"], { errorMap: () => ({ message: "Ação: use retomar ou desistir." }) }),
    expected_edicao: z.number().int().min(1),
  })
  .strict();

export type ResultadoDaAcao = { id: string; etapa: EtapaDaEmissao; edicao: number };

export async function actOnNfEmissionFor(
  db: Firestore,
  caller: FinanceiroProfile,
  dados: unknown,
  opcoes: { projectId: string; agora?: () => Date },
): Promise<ResultadoDaAcao & { replayed?: true }> {
  exigirFinanceiro(caller);
  exigirLiberacao(opcoes.projectId);
  const lido = AcaoNaEmissao.safeParse(dados);
  if (!lido.success) throw new HttpsError("invalid-argument", lido.error.issues[0]?.message ?? "Pedido inválido.");
  const pedido = lido.data;
  const ator = atorDe(caller);
  const instante = (opcoes.agora ?? (() => new Date()))();
  return runIdempotent<ResultadoDaAcao>(
    db,
    { kind: "nf_emissao_acao", scope: { id: pedido.id }, idempotency_key: pedido.idempotency_key, input: pedido, actor: ator },
    async (transaction, { operationId }) => {
      const snap = await transaction.get(db.collection(EMISSOES_COLLECTION).doc(pedido.id));
      if (!snap.exists) throw new HttpsError("not-found", "Emissão não encontrada.");
      let atual: Emissao;
      try {
        atual = emissaoLida(snap.id, snap.data() ?? {});
      } catch {
        throw new HttpsError("failed-precondition", "Emissão ilegível.");
      }
      if (atual.edicao !== pedido.expected_edicao) throw new HttpsError("failed-precondition", "A emissão mudou. Abra de novo.");
      const avanco = comAcao(atual, pedido.acao, instante);
      if ("problema" in avanco) throw new HttpsError("failed-precondition", avanco.problema);
      const iso = instante.toISOString();
      const reservas = pedido.acao === "desistir" ? await lerReservas(transaction, db, atual) : null;
      gravarEmissao(transaction, db, avanco.emissao, pedido.acao === "desistir" ? { desistida_por: ator, desistida_em: iso } : { retomada_por: ator, retomada_em: iso });
      if (pedido.acao === "retomar") {
        createFinanceiroEvent(transaction, db, {
          operation_id: operationId,
          type: "nf.emission_resumed",
          entity_id: atual.id,
          customer_code: atual.customer_code,
          payload: { id: atual.id, etapa_antes: atual.etapa as "parada" | "rejeitada", etapa_depois: avanco.emissao.etapa as "na_fila" },
          actor: ator,
          occurred_at: iso,
        });
      } else {
        const itens = { demandas: atual.itens.filter((item) => item.origem === "demanda").map((item) => item.referencia), competencias: reservas?.competencias ?? [] };
        if (avanco.efeito === "liberar_reservas" && reservas) soltarReservas(transaction, reservas);
        createFinanceiroEvent(transaction, db, {
          operation_id: operationId,
          type: "nf.emission_abandoned",
          entity_id: atual.id,
          customer_code: atual.customer_code,
          payload: { id: atual.id, ...itens, cancela_na_omie: avanco.emissao.etapa === "cancelando" },
          actor: ator,
          occurred_at: iso,
        });
      }
      return { target_id: atual.id, result: { id: atual.id, etapa: avanco.emissao.etapa, edicao: avanco.emissao.edicao } };
    },
  );
}

// --- A leitura -------------------------------------------------------------------------------

export type EmissaoNaLista = {
  id: string;
  customer_code: string;
  customer_name: string | null;
  etapa: EtapaDaEmissao;
  motivo_da_parada: MotivoDaParada | null;
  mensagem: string | null;
  mensagens_da_prefeitura: MensagemDaPrefeitura[];
  demandas: string[];
  armazenagem: string[];
  total_cents: number;
  vencimento: string;
  nfse: string | null;
  url_nfse: string | null;
  url_pdf: string | null;
  criada_em: string;
  edicao: number;
  reserva: boolean;
};

/** Quantas emissões a tela lista, das mais novas. */
export const EMISSOES_NA_LISTA = 50;

/** listNfEmissions: as emissões mais novas, para a tela do Financeiro. */
export async function listNfEmissionsFor(db: Firestore, caller: FinanceiroProfile): Promise<{ emissoes: EmissaoNaLista[] }> {
  exigirFinanceiro(caller);
  const snapshot = await db.collection(EMISSOES_COLLECTION).orderBy("criada_em", "desc").limit(EMISSOES_NA_LISTA).get();
  const emissoes = snapshot.docs.flatMap((doc) => {
    let emissao: Emissao;
    try {
      emissao = emissaoLida(doc.id, doc.data());
    } catch {
      return [];
    }
    return [
      {
        id: emissao.id,
        customer_code: emissao.customer_code,
        customer_name: emissao.customer_name,
        etapa: emissao.etapa,
        motivo_da_parada: emissao.motivo_da_parada,
        mensagem: emissao.mensagem,
        mensagens_da_prefeitura: emissao.mensagens_da_prefeitura,
        demandas: emissao.itens.filter((item) => item.origem === "demanda").map((item) => item.referencia),
        armazenagem: emissao.itens.filter((item) => item.origem === "armazenagem").map((item) => item.referencia),
        total_cents: totalDaEmissao(emissao),
        vencimento: emissao.vencimento,
        nfse: emissao.omie.nfse,
        url_nfse: emissao.omie.url_nfse,
        url_pdf: emissao.omie.url_pdf,
        criada_em: String(doc.get("criada_em") ?? ""),
        edicao: emissao.edicao,
        reserva: ETAPAS_QUE_RESERVAM.includes(emissao.etapa),
      },
    ];
  });
  return { emissoes };
}
