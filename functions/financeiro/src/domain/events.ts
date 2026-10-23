import { FieldValue, type Firestore, type Transaction } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";
import { z } from "zod";

import { actorPayload, compactValue, digest, type FinanceiroActor } from "./operations.js";

/**
 * Eventos do Financeiro em `events` (invariante 2), gravados na mesma
 * transação, com `source: functions_financeiro` e `severity: info`.
 *
 * O payload não leva valor, número da NF nem dado de cliente além do código:
 * interno, wms e suporte leem `events`, e a operação nunca vê valor. O valor
 * fica em `faturas` e `pagamentos`, que só quem lê preço lê. Os tipos são
 * `nf.*` e `cobranca.*`, sem as
 * palavras que o roteador de avisos do WMS transforma em aviso ao cliente
 * (notificationKindForEvent em functions/wms/src/index.ts).
 */

export const EVENTS_COLLECTION = "events";
export const FINANCEIRO_EVENT_SOURCE = "functions_financeiro";

const faturaId = z.string().regex(/^fat_[a-f0-9]{24}$/, "Fatura inválida.");
const demanda = z.string().regex(/^\d{5,8}$/, "Demanda inválida.");
const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const FINANCEIRO_EVENT_TYPES = ["nf.registered", "nf.sent", "nf.cancelled", "cobranca.payment_registered", "cobranca.payment_reversed"] as const;
export type FinanceiroEventType = (typeof FINANCEIRO_EVENT_TYPES)[number];

/**
 * A NF registrada (parte 4.1a): a fatura, as demandas que ela fecha, quantas
 * autorizações cita, a emissão, o vencimento e a forma de pagamento. Sem
 * valor e sem o número da NF.
 */
const nfRegistrada = z
  .object({
    id: faturaId,
    demandas: z.array(demanda).min(1).max(50),
    autorizacoes: z.number().int().min(0).max(50),
    emitida_em: data,
    vencimento: data,
    forma: z.enum(["boleto", "pix", "transferencia", "cartao", "dinheiro"]),
  })
  .strict();

const pagamentoId = z.string().regex(/^pag_[a-f0-9]{24}$/, "Pagamento inválido.");

/** A NF enviada ao cliente (parte 4.2a): o dia e o meio. */
const nfEnviada = z
  .object({ id: faturaId, enviada_em: data, meio: z.enum(["email", "portal_do_cliente", "correio", "em_maos"]) })
  .strict();

/** O registro da NF cancelado: as demandas voltam a A faturar. Sem o motivo, que é texto livre. */
const nfCancelada = z.object({ id: faturaId, demandas: z.array(demanda).min(1).max(50) }).strict();

/** Um pagamento da fatura (parcial ou o que quita), sem o valor. */
const pagamentoRegistrado = z
  .object({ id: faturaId, pagamento_id: pagamentoId, recebido_em: data, forma: z.enum(["boleto", "pix", "transferencia", "cartao", "dinheiro"]), quitada: z.boolean() })
  .strict();

/** O estorno de um pagamento lançado errado; `reaberta` quando a fatura estava paga. Sem o motivo. */
const pagamentoEstornado = z.object({ id: faturaId, pagamento_id: pagamentoId, reaberta: z.boolean() }).strict();

export const FINANCEIRO_EVENT_PAYLOADS = {
  "nf.registered": nfRegistrada,
  "nf.sent": nfEnviada,
  "nf.cancelled": nfCancelada,
  "cobranca.payment_registered": pagamentoRegistrado,
  "cobranca.payment_reversed": pagamentoEstornado,
} as const;

const TEXTO: Record<FinanceiroEventType, { title: string; description: string }> = {
  "nf.registered": { title: "NF registrada", description: "A NF emitida fora do sistema foi registrada e as demandas dela ficaram faturadas." },
  "nf.sent": { title: "NF enviada", description: "A NF foi enviada ao cliente." },
  "nf.cancelled": { title: "Registro da NF cancelado", description: "O registro da NF foi cancelado e as demandas dela voltaram a A faturar." },
  "cobranca.payment_registered": { title: "Pagamento registrado", description: "Um pagamento da NF foi registrado." },
  "cobranca.payment_reversed": { title: "Pagamento estornado", description: "Um pagamento lançado na NF foi estornado." },
};

export function isFinanceiroEventType(value: string): value is FinanceiroEventType {
  return (FINANCEIRO_EVENT_TYPES as readonly string[]).includes(value);
}

export type FinanceiroEventInput<T extends FinanceiroEventType> = {
  operation_id: string;
  suffix?: string;
  type: T;
  entity_id: string;
  payload: z.input<(typeof FINANCEIRO_EVENT_PAYLOADS)[T]>;
  actor: FinanceiroActor;
  customer_code: string;
  occurred_at?: string;
};

export type FinanceiroEventRecord = {
  id: string;
  type: FinanceiroEventType;
  title: string;
  description: string;
  severity: "info";
  entity_type: "fatura";
  entity_id: string;
  customer_code: string;
  payload: Record<string, unknown>;
  occurred_at: string;
  source: typeof FINANCEIRO_EVENT_SOURCE;
  operation_id: string;
  actor: Record<string, string>;
};

export function financeiroEventId(operationId: string, suffix: string): string {
  return `evt_${digest({ operationId, suffix })}`;
}

export function buildFinanceiroEvent<T extends FinanceiroEventType>(input: FinanceiroEventInput<T>): FinanceiroEventRecord {
  if (!isFinanceiroEventType(input.type)) throw new HttpsError("internal", `Tipo de evento desconhecido: ${String(input.type)}.`);
  if (input.actor.role === "cliente") throw new HttpsError("permission-denied", "Evento do Financeiro é sempre de alguém da equipe.");
  const operationId = String(input.operation_id ?? "").trim();
  if (!operationId) throw new HttpsError("internal", `Evento ${input.type} sem a operação de origem.`);
  const payload = FINANCEIRO_EVENT_PAYLOADS[input.type].safeParse(input.payload);
  if (!payload.success) throw new HttpsError("internal", `Evento ${input.type} com payload inválido.`);
  if (payload.data.id !== input.entity_id) throw new HttpsError("internal", `Evento ${input.type} com entity_id diferente do payload.`);
  const customerCode = String(input.customer_code ?? "").trim();
  if (!customerCode) throw new HttpsError("internal", `Evento ${input.type} sem customer_code.`);
  const occurredAt = input.occurred_at ?? new Date().toISOString();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(occurredAt)) {
    throw new HttpsError("internal", `Evento ${input.type} com occurred_at fora do formato ISO em UTC.`);
  }
  const texto = TEXTO[input.type];
  return {
    id: financeiroEventId(operationId, input.suffix ?? input.type),
    type: input.type,
    title: texto.title,
    description: texto.description,
    severity: "info",
    entity_type: "fatura",
    entity_id: input.entity_id,
    customer_code: customerCode,
    payload: compactValue(payload.data) as Record<string, unknown>,
    occurred_at: occurredAt,
    source: FINANCEIRO_EVENT_SOURCE,
    operation_id: operationId,
    actor: actorPayload(input.actor),
  };
}

export function createFinanceiroEvent<T extends FinanceiroEventType>(
  transaction: Transaction,
  db: Firestore,
  input: FinanceiroEventInput<T>,
): { id: string; type: FinanceiroEventType } {
  const event = buildFinanceiroEvent(input);
  transaction.create(db.collection(EVENTS_COLLECTION).doc(event.id), {
    ...event,
    created_at: FieldValue.serverTimestamp(),
  });
  return { id: event.id, type: event.type };
}
