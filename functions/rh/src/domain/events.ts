import { FieldValue, type Firestore, type Transaction } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";
import { z } from "zod";

import { CATEGORIAS, DIAS_PARA_O_VENCIMENTO, ID_COLABORADOR, ID_REGISTRO, SITUACOES } from "./ficha.js";
import { actorPayload, compactValue, digest, type RhActor } from "./operations.js";

/**
 * Eventos do RH em `events` do banco `rh` (invariante 2), não no do banco
 * padrão: lá leem interno, wms e suporte, e um evento de exame já diz coisa
 * de saúde (docs/plataforma/fase-8-rh.md). Gravados na mesma transação da
 * mudança, com `source: functions_rh`.
 *
 * O payload leva o id do colaborador, a categoria, o tipo e as datas, nunca
 * o nome do registro "outro", o resultado do exame nem o arquivo. Os eventos
 * de vencimento são da rotina diária; os outros, de quem grava no RH.
 */

export const EVENTS_COLLECTION = "events";
export const RH_EVENT_SOURCE = "functions_rh";

export const RH_EVENT_TYPES = [
  "rh.record_created",
  "rh.record_updated",
  "rh.record_archived",
  "rh.record_status_changed",
  "rh.record_expiring",
  "rh.record_expired",
] as const;
export type RhEventType = (typeof RH_EVENT_TYPES)[number];

/** Os eventos da rotina diária, gravados pelo ator `sistema`. */
export const EVENTOS_DA_ROTINA: readonly RhEventType[] = ["rh.record_expiring", "rh.record_expired"];

const id = z.string().regex(ID_REGISTRO);
const colaboradorId = z.string().regex(ID_COLABORADOR);
const categoria = z.enum(CATEGORIAS);
const tipo = z.string().regex(/^[a-z0-9_]{2,40}$/);
const dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const situacao = z.enum(SITUACOES);
const edicao = z.number().int().min(1).max(100_000);

const doRegistro = { id, colaborador_id: colaboradorId, categoria, tipo };

export const RH_EVENT_PAYLOADS = {
  "rh.record_created": z.object({ ...doRegistro, emitido_em: dia, vence_em: dia.nullable(), situacao }).strict(),
  "rh.record_updated": z
    .object({ ...doRegistro, emitido_em: dia, vence_em: dia.nullable(), edicao_antes: edicao, edicao_depois: edicao })
    .strict(),
  "rh.record_archived": z.object(doRegistro).strict(),
  /** O vigente que passou a substituído (ou voltou a vigente) por causa de outro registro do mesmo tipo. */
  "rh.record_status_changed": z
    .object({ ...doRegistro, antes: situacao, depois: situacao, por: id.nullable() })
    .strict(),
  "rh.record_expiring": z.object({ ...doRegistro, vence_em: dia, dias: z.number().int().min(0).max(DIAS_PARA_O_VENCIMENTO) }).strict(),
  "rh.record_expired": z.object({ ...doRegistro, vence_em: dia, dias: z.number().int().min(-36_600).max(-1) }).strict(),
} as const satisfies Record<RhEventType, z.ZodObject<z.ZodRawShape>>;

const TEXTO: Record<RhEventType, { title: string; description: string }> = {
  "rh.record_created": { title: "Registro incluído na ficha", description: "Um documento, exame ou treinamento entrou na ficha do colaborador." },
  "rh.record_updated": { title: "Registro da ficha alterado", description: "As datas ou o resultado do registro mudaram." },
  "rh.record_archived": { title: "Registro da ficha arquivado", description: "O registro saiu da ficha e ficou no histórico." },
  "rh.record_status_changed": { title: "Registro vigente mudou", description: "O registro mais recente do tipo passou a ser o vigente." },
  "rh.record_expiring": { title: "Registro vencendo", description: `O vencimento está a ${DIAS_PARA_O_VENCIMENTO} dias ou menos.` },
  "rh.record_expired": { title: "Registro vencido", description: "O vencimento já passou." },
};

export function isRhEventType(value: string): value is RhEventType {
  return (RH_EVENT_TYPES as readonly string[]).includes(value);
}

export type RhEventInput<T extends RhEventType> = {
  operation_id: string;
  suffix?: string;
  type: T;
  entity_id: string;
  payload: z.input<(typeof RH_EVENT_PAYLOADS)[T]>;
  actor: RhActor;
  occurred_at?: string;
};

export type RhEventRecord = {
  id: string;
  type: RhEventType;
  title: string;
  description: string;
  severity: "info";
  entity_type: "rh_record";
  entity_id: string;
  payload: Record<string, unknown>;
  occurred_at: string;
  source: typeof RH_EVENT_SOURCE;
  operation_id: string;
  actor: Record<string, string>;
};

export function rhEventId(operationId: string, suffix: string): string {
  return `evt_${digest({ operationId, suffix })}`;
}

export function buildRhEvent<T extends RhEventType>(input: RhEventInput<T>): RhEventRecord {
  if (!isRhEventType(input.type)) throw new HttpsError("internal", `Tipo de evento desconhecido: ${String(input.type)}.`);
  const daRotina = EVENTOS_DA_ROTINA.includes(input.type);
  if ((input.actor.role === "sistema") !== daRotina) {
    throw new HttpsError("internal", daRotina ? "O vencimento é sempre da rotina diária." : "Evento do RH é sempre de quem grava no RH.");
  }
  if (!daRotina && input.actor.role !== "rh") throw new HttpsError("internal", "Evento do RH é sempre de quem grava no RH.");
  const operationId = String(input.operation_id ?? "").trim();
  if (!operationId) throw new HttpsError("internal", `Evento ${input.type} sem a operação de origem.`);
  const payload = RH_EVENT_PAYLOADS[input.type].safeParse(input.payload);
  if (!payload.success) throw new HttpsError("internal", `Evento ${input.type} com payload inválido.`);
  if (payload.data.id !== input.entity_id) throw new HttpsError("internal", `Evento ${input.type} com entity_id diferente do payload.`);
  const occurredAt = input.occurred_at ?? new Date().toISOString();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(occurredAt)) {
    throw new HttpsError("internal", `Evento ${input.type} com occurred_at fora do formato ISO em UTC.`);
  }
  return {
    id: rhEventId(operationId, input.suffix ?? input.type),
    type: input.type,
    title: TEXTO[input.type].title,
    description: TEXTO[input.type].description,
    severity: "info",
    entity_type: "rh_record",
    entity_id: input.entity_id,
    payload: compactValue(payload.data) as Record<string, unknown>,
    occurred_at: occurredAt,
    source: RH_EVENT_SOURCE,
    operation_id: operationId,
    actor: actorPayload(input.actor),
  };
}

/** Grava o evento na transação do banco `rh` (`rh` é esse banco). */
export function createRhEvent<T extends RhEventType>(transaction: Transaction, rh: Firestore, input: RhEventInput<T>): { id: string; type: RhEventType } {
  const event = buildRhEvent(input);
  transaction.create(rh.collection(EVENTS_COLLECTION).doc(event.id), {
    ...event,
    created_at: FieldValue.serverTimestamp(),
  });
  return { id: event.id, type: event.type };
}
