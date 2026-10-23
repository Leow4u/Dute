import { createHash } from "node:crypto";

import { FieldValue, type Firestore, type Transaction } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";
import { z } from "zod";

import { EVENTS_COLLECTION } from "./cursor.js";
import type { CoreProfile } from "./profile.js";

/**
 * Os eventos do núcleo em `events` (invariante 2), gravados na mesma
 * transação da decisão, com `source: functions_core` e `severity: info`.
 *
 * O payload não leva valor nem o nome dos itens: só o alerta e quantos itens.
 * Os tipos são `estoque_parado.*`, sem as palavras que o roteador de avisos do
 * WMS transforma em aviso ao cliente (notificationKindForEvent em
 * functions/wms/src/index.ts): o aviso do alerta aprovado é da rotina dos
 * avisos da Operação (parte 5.4f).
 */

export const CORE_EVENT_SOURCE = "functions_core";

export const CORE_EVENT_TYPES = ["estoque_parado.aprovado", "estoque_parado.descartado"] as const;
export type CoreEventType = (typeof CORE_EVENT_TYPES)[number];

const alertaId = z.string().regex(/^alerta_[a-f0-9]{24}$/, "Alerta inválido.");

/** O alerta e quantos itens ele levou ao cliente (o aprovado) ou tinha (o descartado). */
const decisaoDoAlerta = z.object({ id: alertaId, itens: z.number().int().min(0).max(1000) }).strict();

export const CORE_EVENT_PAYLOADS = {
  "estoque_parado.aprovado": decisaoDoAlerta,
  "estoque_parado.descartado": decisaoDoAlerta,
} as const satisfies Record<CoreEventType, z.ZodTypeAny>;

const TEXTO: Record<CoreEventType, { title: string; description: string }> = {
  "estoque_parado.aprovado": { title: "Alerta de item parado aprovado", description: "O alerta dos itens parados foi aprovado e vai ao cliente." },
  "estoque_parado.descartado": { title: "Alerta de item parado descartado", description: "O alerta dos itens parados foi descartado e não vai ao cliente." },
};

export type CoreEventInput<T extends CoreEventType> = {
  type: T;
  payload: z.input<(typeof CORE_EVENT_PAYLOADS)[T]>;
  customer_code: string;
  actor: CoreProfile;
  occurred_at: string;
};

export function coreEventId(type: CoreEventType, entityId: string): string {
  return `evt_${createHash("sha256").update(JSON.stringify([type, entityId])).digest("hex").slice(0, 32)}`;
}

/** Um evento por decisão do alerta: a mesma decisão gravada de novo tem o mesmo id. */
export function buildCoreEvent<T extends CoreEventType>(input: CoreEventInput<T>) {
  if (!(CORE_EVENT_TYPES as readonly string[]).includes(input.type)) throw new HttpsError("internal", `Tipo de evento desconhecido: ${String(input.type)}.`);
  if (input.actor.role === "cliente") throw new HttpsError("permission-denied", "Evento do núcleo é sempre de alguém da equipe.");
  const payload = CORE_EVENT_PAYLOADS[input.type].safeParse(input.payload);
  if (!payload.success) throw new HttpsError("internal", `Evento ${input.type} com payload inválido.`);
  const customerCode = String(input.customer_code ?? "").trim();
  if (!customerCode) throw new HttpsError("internal", `Evento ${input.type} sem customer_code.`);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(input.occurred_at)) {
    throw new HttpsError("internal", `Evento ${input.type} com occurred_at fora do formato ISO em UTC.`);
  }
  const actor: Record<string, string> = { uid: input.actor.uid, role: input.actor.role };
  if (input.actor.name) actor.name = input.actor.name;
  return {
    id: coreEventId(input.type, payload.data.id),
    type: input.type,
    title: TEXTO[input.type].title,
    description: TEXTO[input.type].description,
    severity: "info" as const,
    entity_type: "alerta_parado" as const,
    entity_id: payload.data.id,
    customer_code: customerCode,
    payload: payload.data,
    occurred_at: input.occurred_at,
    source: CORE_EVENT_SOURCE,
    actor,
  };
}

export function createCoreEvent<T extends CoreEventType>(transaction: Transaction, db: Firestore, input: CoreEventInput<T>): { id: string; type: CoreEventType } {
  const event = buildCoreEvent(input);
  transaction.create(db.collection(EVENTS_COLLECTION).doc(event.id), { ...event, created_at: FieldValue.serverTimestamp() });
  return { id: event.id, type: event.type };
}
