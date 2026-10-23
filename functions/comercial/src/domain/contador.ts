import { FieldValue, type Firestore, type Transaction } from "firebase-admin/firestore";

import { DEMAND_COUNTERS_COLLECTION, DEMAND_COUNTER_ID, DEMANDS_COLLECTION, PRIMEIRO_NUMERO, ULTIMO_NUMERO } from "./demanda.js";
import { createComercialEvent } from "./events.js";
import { digest, type ComercialActor } from "./operations.js";

/**
 * O ponto de partida do contador das demandas (parte 6.21 do plano de
 * implantação; `docs/plataforma/comercial-producao.md`, passo do contador).
 *
 * O contador guarda o último número usado (`demand_counters/geral`, campo
 * `ultimo`); a próxima demanda é `ultimo + 1`. Ajustar o contador serve para
 * a numeração continuar a da planilha. Ele nunca fica:
 * - abaixo de 10000 (a próxima seria menor que 10001, a faixa nova);
 * - abaixo do maior `demands/{numero}` (a próxima repetiria um número);
 * - abaixo do que já guarda (o contador não anda para trás: um número já
 *   tirado pode estar num evento ou num PDF mesmo sem demanda).
 */

/** O menor valor gravável: a próxima demanda é a 10001. */
export const ULTIMO_MINIMO = PRIMEIRO_NUMERO - 1;

export type EstadoDoContador = {
  /** O que o contador guarda hoje, ou null sem o documento. */
  atual: number | null;
  /** O maior número de demanda que existe, ou null sem demanda. */
  maiorDemanda: number | null;
};

export type AcaoDoContador = "gravar" | "sem_mudanca";

/** O valor pedido é um último número válido, sem olhar o banco. */
export function problemaDoValor(ultimo: number): string | null {
  if (!Number.isSafeInteger(ultimo)) return "O último número precisa ser inteiro.";
  if (ultimo < ULTIMO_MINIMO) return `O último número fica em ${ULTIMO_MINIMO} ou mais: a próxima demanda é a ${PRIMEIRO_NUMERO} no mínimo.`;
  if (ultimo >= ULTIMO_NUMERO) return `O último número fica abaixo de ${ULTIMO_NUMERO}, o fim da faixa.`;
  return null;
}

/** O que o banco impede: ficar abaixo da maior demanda ou do que o contador já guarda. */
export function problemaDoUltimo(ultimo: number, estado: EstadoDoContador): string | null {
  const doValor = problemaDoValor(ultimo);
  if (doValor) return doValor;
  if (estado.maiorDemanda !== null && ultimo < estado.maiorDemanda) {
    return `A demanda ${estado.maiorDemanda} já existe: o contador não pode ficar abaixo dela.`;
  }
  if (estado.atual !== null && ultimo < estado.atual) {
    return `O contador já está em ${estado.atual}: ele não anda para trás.`;
  }
  return null;
}

export function acaoDoContador(ultimo: number, estado: EstadoDoContador): AcaoDoContador {
  return estado.atual === ultimo ? "sem_mudanca" : "gravar";
}

/** O maior número entre os ids das demandas ("10045"), comparados como número. */
export function maiorNumero(ids: readonly string[]): number | null {
  let maior: number | null = null;
  for (const id of ids) {
    if (!/^\d{1,8}$/.test(id)) continue;
    const numero = Number(id);
    if (maior === null || numero > maior) maior = numero;
  }
  return maior;
}

function valorDoContador(valor: unknown): number | null {
  if (valor === undefined || valor === null) return null;
  if (typeof valor !== "number" || !Number.isSafeInteger(valor) || valor < 0) {
    throw new Error(`O contador de demandas está com um valor inválido (${JSON.stringify(valor) ?? String(valor)}).`);
  }
  return valor;
}

function contadorRef(db: Firestore) {
  return db.collection(DEMAND_COUNTERS_COLLECTION).doc(DEMAND_COUNTER_ID);
}

/** Lê o contador e os ids das demandas (só os ids: `select()` sem campos). */
export async function lerEstadoDoContador(db: Firestore, transaction?: Transaction): Promise<EstadoDoContador> {
  const demandas = db.collection(DEMANDS_COLLECTION).select();
  const [contador, ids] = transaction
    ? await Promise.all([transaction.get(contadorRef(db)), transaction.get(demandas)])
    : await Promise.all([contadorRef(db).get(), demandas.get()]);
  return {
    atual: valorDoContador(contador.exists ? contador.get("ultimo") : undefined),
    maiorDemanda: maiorNumero(ids.docs.map((doc) => doc.id)),
  };
}

export type ResultadoDoContador = { acao: AcaoDoContador; anterior: number | null; ultimo: number; evento: string | null };

/**
 * Grava o último número numa transação que relê o contador e as demandas: a
 * conferência vale no instante da gravação, não só no dry-run. Mesmo valor
 * não grava nem gera evento. O evento `demand_counter.set` vai junto.
 */
export async function gravarUltimo(db: Firestore, ultimo: number, ator: ComercialActor, agora: Date = new Date()): Promise<ResultadoDoContador> {
  return db.runTransaction(async (transaction) => {
    const estado = await lerEstadoDoContador(db, transaction);
    const problema = problemaDoUltimo(ultimo, estado);
    if (problema) throw new Error(problema);
    if (acaoDoContador(ultimo, estado) === "sem_mudanca") {
      return { acao: "sem_mudanca", anterior: estado.atual, ultimo, evento: null };
    }
    const operacao = `op_demand_counter_${digest({ ultimo, anterior: estado.atual, em: agora.toISOString() })}`;
    transaction.set(
      contadorRef(db),
      { ultimo, updated_at: FieldValue.serverTimestamp(), ajustado_por: ator.uid },
      { merge: true },
    );
    const evento = createComercialEvent(transaction, db, {
      operation_id: operacao,
      type: "demand_counter.set",
      entity_id: DEMAND_COUNTER_ID,
      customer_code: null,
      payload: { anterior: estado.atual, ultimo, maior_demanda: estado.maiorDemanda },
      occurred_at: agora.toISOString(),
      actor: ator,
    });
    return { acao: "gravar", anterior: estado.atual, ultimo, evento: evento.id };
  });
}
