import { createHash } from "node:crypto";

import type { DocumentReference, DocumentSnapshot, Firestore, Transaction } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";

import { AI_MEASURES_COLLECTION, idDaMedida, minutosDeTrabalho } from "./medidas.js";
import { planejamentoProblem } from "./platform-roles.js";
import type { CoreProfile } from "./profile.js";
import {
  AI_SUGGESTIONS_COLLECTION,
  baseDoItem,
  erroDaSugestao,
  historicoQueVale,
  interpretarPedido,
  interpretarResposta,
  sugerirDuracao,
  type BaseDoItem,
  type HistoricoDoPlanejamento,
  type MedidaLida,
  type PedidoDeSugestao,
  type Sugestao,
} from "./sugestao.js";

/**
 * A duração sugerida no Planejar OS e a resposta da pessoa
 * (docs/plataforma/fase-5-memoria.md, parte 5.2a).
 *
 * - `suggestDuration` só lê: a demanda (de onde vem o cliente, nunca do
 *   pedido) e as medidas. Nada grava.
 * - `answerSuggestion` grava, quando a OS é salva, o que foi sugerido
 *   (recalculado no servidor, nunca o que a tela mandou), o que a pessoa fez
 *   e o que ela escolheu. Não toca na OS: quem salva a OS é a callable da
 *   Operação.
 * - A rotina das medidas grava o valor real quando a OS é revisada
 *   (registrarValoresReais).
 */

const DEMANDS_COLLECTION = "demands";
const SERVICE_ORDERS_COLLECTION = "service_orders";

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

function exigirPlanejamento(caller: CoreProfile): void {
  const problema = planejamentoProblem(caller.role);
  if (problema) throw new HttpsError("permission-denied", problema);
}

function hashDe(valor: unknown): string {
  return createHash("sha256").update(JSON.stringify(valor)).digest("hex");
}

type Leitor = { getAll: (...refs: DocumentReference[]) => Promise<DocumentSnapshot[]> };

function medidaLida(snapshot: DocumentSnapshot | undefined): MedidaLida | null {
  if (!snapshot?.exists) return null;
  const dados = snapshot.data() ?? {};
  const porUnidade = dados.homem_minuto_por_unidade;
  const execucoes = dados.execucoes;
  if (typeof porUnidade !== "number" || typeof execucoes !== "number") return null;
  return { homemMinutoPorUnidade: porUnidade, execucoes, osRecentes: Array.isArray(dados.os_recentes) ? dados.os_recentes.map(texto).filter(Boolean) : [] };
}

function historicoLido<E extends "cliente" | "geral">(snapshot: DocumentSnapshot | undefined, escopo: E): (HistoricoDoPlanejamento & { escopo: E }) | null {
  if (!snapshot?.exists) return null;
  const dados = snapshot.data() ?? {};
  if (typeof dados.execucoes !== "number" || typeof dados.erro_medio_pct !== "number") return null;
  return { escopo, execucoes: dados.execucoes, erro_medio_pct: dados.erro_medio_pct, acima_da_janela: typeof dados.acima_da_janela === "number" ? dados.acima_da_janela : 0 };
}

/** Lê as medidas dos itens e do planejamento do cliente e calcula a sugestão. */
async function calcular(leitor: Leitor, db: Firestore, customerCode: string, pedido: Pick<PedidoDeSugestao, "pessoas" | "itens">): Promise<Sugestao> {
  const lpus = [...new Set(pedido.itens.map((item) => item.lpu_item_id).filter((id): id is string => Boolean(id)))];
  const medida = (id: string) => db.collection(AI_MEASURES_COLLECTION).doc(id);
  const refs = [
    medida(idDaMedida("erro_planejamento", customerCode, "os")),
    medida(idDaMedida("erro_planejamento", null, "os")),
    ...lpus.flatMap((lpu) => [medida(idDaMedida("duracao_item", customerCode, lpu)), medida(idDaMedida("duracao_item", null, lpu))]),
  ];
  const lidos = await leitor.getAll(...refs);
  const bases = new Map<string, BaseDoItem | null>(lpus.map((lpu, indice) => [lpu, baseDoItem(medidaLida(lidos[2 + indice * 2]), medidaLida(lidos[3 + indice * 2]))]));
  const historico = historicoQueVale(historicoLido(lidos[0], "cliente"), historicoLido(lidos[1], "geral"));
  return sugerirDuracao(pedido, bases, historico);
}

function clienteDaDemanda(snapshot: DocumentSnapshot, numero: string): string {
  if (!snapshot.exists) throw new HttpsError("not-found", `A demanda ${numero} não existe.`);
  const customerCode = texto(snapshot.get("customer_code"));
  if (!customerCode) throw new HttpsError("failed-precondition", `A demanda ${numero} não tem cliente.`);
  return customerCode;
}

/** A duração sugerida para a OS em planejamento. Só lê. */
export async function suggestDurationFor(db: Firestore, caller: CoreProfile, data: unknown): Promise<Sugestao> {
  exigirPlanejamento(caller);
  const pedido = interpretarPedido(data);
  const customerCode = clienteDaDemanda(await db.collection(DEMANDS_COLLECTION).doc(pedido.demanda).get(), pedido.demanda);
  return calcular(db, db, customerCode, pedido);
}

export type ResultadoDaResposta = { sugestao_id: string | null; gravada: boolean; replayed?: true };

/**
 * A resposta da pessoa, gravada quando a OS é salva: o que foi sugerido
 * (recalculado aqui), a decisão e o escolhido. Sem base, não houve sugestão e
 * nada se grava. Repetir a mesma chave devolve a mesma; a chave com outra
 * resposta recusa.
 */
export async function answerSuggestionFor(db: Firestore, caller: CoreProfile, data: unknown, agora: () => Date = () => new Date()): Promise<ResultadoDaResposta> {
  exigirPlanejamento(caller);
  const resposta = interpretarResposta(data);
  const id = `sug_${hashDe({ uid: caller.uid, chave: resposta.idempotency_key }).slice(0, 24)}`;
  const entradaHash = hashDe({ ...resposta, idempotency_key: undefined });
  return db.runTransaction(async (transaction: Transaction) => {
    const ref = db.collection(AI_SUGGESTIONS_COLLECTION).doc(id);
    const existente = await transaction.get(ref);
    if (existente.exists) {
      if (existente.get("entrada_hash") !== entradaHash) throw new HttpsError("already-exists", "A chave já foi usada em outra resposta.");
      return { sugestao_id: id, gravada: true, replayed: true };
    }
    const [demanda, os] = await transaction.getAll(db.collection(DEMANDS_COLLECTION).doc(resposta.demanda), db.collection(SERVICE_ORDERS_COLLECTION).doc(resposta.os));
    const customerCode = clienteDaDemanda(demanda, resposta.demanda);
    if (!os.exists) throw new HttpsError("not-found", `A OS ${resposta.os} não existe.`);
    if (texto(os.get("demanda")) !== resposta.demanda || texto(os.get("customer_code")) !== customerCode) {
      throw new HttpsError("failed-precondition", `A OS ${resposta.os} não é da demanda ${resposta.demanda}.`);
    }
    const sugestao = await calcular(transaction, db, customerCode, resposta);
    if (sugestao.minutos_total === null) return { sugestao_id: null, gravada: false };
    transaction.create(ref, {
      id,
      tipo: "duracao_os",
      customer_code: customerCode,
      demanda: resposta.demanda,
      os: resposta.os,
      pedida_por: { uid: caller.uid, role: caller.role },
      criada_em: agora().toISOString(),
      entrada_hash: entradaHash,
      entrada: { pessoas: resposta.pessoas, itens: resposta.itens },
      sugestao,
      decisao: resposta.decisao,
      minutos_escolhidos: resposta.minutos_escolhidos,
      valor_real: null,
      real_em: null,
      erro_pct: null,
    });
    return { sugestao_id: id, gravada: true };
  });
}

/**
 * O valor real das sugestões das OS revisadas: o tempo de trabalho da OS,
 * com a mesma conta das medidas, e o erro contra o sugerido. Revisada de
 * novo (depois de reaberta), vale a última revisão.
 */
export async function registrarValoresReais(db: Firestore, numeros: readonly string[], agora: Date): Promise<number> {
  let registrados = 0;
  for (const numero of [...new Set(numeros)].sort()) {
    const os = await db.collection(SERVICE_ORDERS_COLLECTION).doc(numero).get();
    if (!os.exists || texto(os.get("status")) !== "revisada") continue;
    const reais = minutosDeTrabalho(Array.isArray(os.get("etapas")) ? os.get("etapas") : []);
    if (reais === null) continue;
    const sugestoes = await db.collection(AI_SUGGESTIONS_COLLECTION).where("os", "==", numero).get();
    for (const sugestao of sugestoes.docs) {
      const sugeridos = sugestao.get("sugestao.minutos_total");
      if (typeof sugeridos !== "number" || sugeridos <= 0) continue;
      await sugestao.ref.update({ valor_real: reais, real_em: agora.toISOString(), erro_pct: erroDaSugestao(sugeridos, reais) });
      registrados += 1;
    }
  }
  return registrados;
}
