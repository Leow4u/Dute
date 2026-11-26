import { randomUUID } from "node:crypto";

import type { Firestore, Transaction } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";
import { z } from "genkit";

import { createEvent, type OperationalActor, type OperationalEventSummary } from "../operations.js";

import { ORIGENS_DO_FEITO, STATUS_DA_EDICAO, TIPOS_DE_MOMENTO } from "./dominio.js";

/**
 * Os eventos de auditoria dos Eventos do portal
 * (docs/superpowers/specs/2026-11-26-eventos-design.md, "Eventos de
 * auditoria"): todo tipo começa com `evento.` (a zeragem guarda só esses da
 * origem functions_client_events; o legado grava a mesma origem com
 * client_event_template.*), o payload é estrito e leva só ids, contagens,
 * instantes, enums e booleanos: nunca valor, nome de pessoa ou contato (o
 * dinheiro mora em client_event_prices). Nenhum tipo leva as palavras que o
 * roteador de avisos do WMS (notificationKindForEvent) casa: por isso o
 * retorno é `evento.retorno_registrado`, sem o "receb" de recebido.
 */

export const EVENTO_EVENT_TYPES = [
  "evento.edicao_salva",
  "evento.edicao_enviada",
  "evento.edicao_confirmada",
  "evento.edicao_separada",
  "evento.edicao_no_evento",
  "evento.momento_registrado",
  "evento.momento_corrigido",
  "evento.foto_anexada",
  "evento.documento_anexado",
  "evento.documento_retirado",
  "evento.retorno_registrado",
  "evento.preco_fechado",
  "evento.edicao_fechada",
  "evento.edicao_cancelada",
  "evento.edicao_excluida",
  "evento.arquivado",
  // Só a adoção de um pedido existente grava (parte 13).
  "evento.pedido_adotado",
] as const;
export type EventoEventType = (typeof EVENTO_EVENT_TYPES)[number];

export const EVENTO_EVENT_SOURCE = "functions_client_events";

const id = z.string().min(1).max(120);
const contagem = z.number().int().min(0);
/** Um instante ISO ou uma data AAAA-MM-DD. */
const instante = z.string().min(1).max(40);

const intervalo = z.object({ inicio: instante, fim: instante.nullable() }).strict();

export const PAYLOAD_DO_EVENTO = {
  "evento.edicao_salva": z.object({ edition_id: id, event_id: id, criada: z.boolean(), itens: contagem, momentos: contagem }).strict(),
  "evento.edicao_enviada": z.object({ edition_id: id, request_id: id.nullable(), itens: contagem, pecas: contagem }).strict(),
  "evento.edicao_confirmada": z.object({ edition_id: id, order_id: id.nullable(), separar_ate: instante.nullable() }).strict(),
  "evento.edicao_separada": z.object({ edition_id: id, order_id: id, volumes: contagem, pecas: contagem }).strict(),
  "evento.edicao_no_evento": z.object({ edition_id: id, order_id: id.nullable(), entregue_em: instante }).strict(),
  "evento.momento_registrado": z
    .object({
      edition_id: id,
      momento_id: id,
      tipo: z.enum(TIPOS_DE_MOMENTO),
      inicio: instante,
      fim: instante.nullable(),
      origem: z.enum(ORIGENS_DO_FEITO),
    })
    .strict(),
  "evento.momento_corrigido": z.object({ edition_id: id, momento_id: id, de: intervalo, para: intervalo }).strict(),
  "evento.foto_anexada": z.object({ edition_id: id, momento_id: id, fotos: contagem }).strict(),
  "evento.documento_anexado": z.object({ edition_id: id, documento_id: id, origem: z.enum(["cliente", "dutelog"]) }).strict(),
  "evento.documento_retirado": z.object({ edition_id: id, documento_id: id }).strict(),
  "evento.retorno_registrado": z
    .object({
      edition_id: id,
      return_id: id.nullable(),
      itens: contagem,
      voltaram: contagem,
      avariadas: contagem,
      nao_voltaram: contagem,
    })
    .strict(),
  "evento.preco_fechado": z.object({ edition_id: id }).strict(),
  "evento.edicao_fechada": z.object({ edition_id: id }).strict(),
  "evento.edicao_cancelada": z.object({ edition_id: id, status_anterior: z.enum(STATUS_DA_EDICAO) }).strict(),
  "evento.edicao_excluida": z.object({ edition_id: id, event_id: id, evento_excluido: z.boolean() }).strict(),
  "evento.arquivado": z.object({ event_id: id, edicoes: contagem }).strict(),
  "evento.pedido_adotado": z.object({ edition_id: id, request_id: id, order_id: id.nullable(), status: z.enum(STATUS_DA_EDICAO) }).strict(),
} satisfies Record<EventoEventType, z.ZodTypeAny>;

export const TITULO_DO_EVENTO: Record<EventoEventType, string> = {
  "evento.edicao_salva": "Edição do evento salva",
  "evento.edicao_enviada": "Edição enviada à Dutelog",
  "evento.edicao_confirmada": "Edição confirmada",
  "evento.edicao_separada": "Edição separada",
  "evento.edicao_no_evento": "Edição no evento",
  "evento.momento_registrado": "Momento registrado",
  "evento.momento_corrigido": "Momento corrigido",
  "evento.foto_anexada": "Foto anexada",
  "evento.documento_anexado": "Documento anexado",
  "evento.documento_retirado": "Documento retirado",
  "evento.retorno_registrado": "Retorno recebido",
  "evento.preco_fechado": "Preço fechado",
  "evento.edicao_fechada": "Edição fechada",
  "evento.edicao_cancelada": "Edição cancelada",
  "evento.edicao_excluida": "Rascunho excluído",
  "evento.arquivado": "Evento arquivado",
  "evento.pedido_adotado": "Pedido adotado pela edição",
};

export type EventoDeAuditoria = {
  type: EventoEventType;
  customer_code: string;
  /** null no evento da capa (o arquivamento): o id vem do `event_id` do payload. */
  edition_id: string | null;
  /** "<nome do evento> · <label>", sem contato nem valor. */
  descricao: string;
  payload: unknown;
};

/**
 * Grava o evento de auditoria na transação de quem chama. O payload que não
 * bate com o tipo é erro de programação (internal), e nada é gravado.
 */
export function createEventoEvent(
  transaction: Transaction,
  db: Firestore,
  evento: EventoDeAuditoria,
  actor: OperationalActor,
): OperationalEventSummary {
  const parsed = PAYLOAD_DO_EVENTO[evento.type].safeParse(evento.payload);
  if (!parsed.success) {
    throw new HttpsError("internal", `Payload inválido para ${evento.type}.`);
  }
  const payload = parsed.data as Record<string, unknown>;
  const entityId = evento.edition_id ?? String(payload.event_id ?? "");
  if (!entityId) throw new HttpsError("internal", `${evento.type} sem edição nem evento.`);
  const sufixo = evento.type.slice("evento.".length);
  return createEvent(
    transaction,
    db,
    `evt_evento_${sufixo}_${entityId}_${randomUUID().slice(0, 8)}`,
    {
      type: evento.type,
      title: TITULO_DO_EVENTO[evento.type],
      description: evento.descricao,
      severity: "info",
      entity_type: evento.edition_id ? "client_event_edition" : "client_event",
      entity_id: entityId,
      customer_code: evento.customer_code,
      payload,
      source: EVENTO_EVENT_SOURCE,
      inbox: false,
    },
    actor,
  );
}
