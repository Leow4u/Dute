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
 *
 * As anotações e os playbooks do Agent Dute (parte 5.5f) gravam `agente.*`,
 * só com o id (e, no playbook, quantos passos e para quem): o texto da
 * anotação pode ter o nome de um contato e fica no documento dela. A anotação
 * é o único evento que o cliente grava: ele a envia pelo cartão da conversa.
 */

export const CORE_EVENT_SOURCE = "functions_core";

export const CORE_EVENT_TYPES = [
  "estoque_parado.aprovado",
  "estoque_parado.descartado",
  "agente.anotacao_sugerida",
  "agente.anotacao_aprovada",
  "agente.anotacao_recusada",
  "agente.anotacao_arquivada",
  "agente.playbook_criado",
  "agente.playbook_editado",
  "agente.playbook_aprovado",
  "agente.playbook_recusado",
  "agente.playbook_arquivado",
  "agente.playbooks_carregados",
] as const;
export type CoreEventType = (typeof CORE_EVENT_TYPES)[number];

const alertaId = z.string().regex(/^alerta_[a-f0-9]{24}$/, "Alerta inválido.");
const anotacaoId = z.string().regex(/^note_[a-f0-9]{24}$/, "Anotação inválida.");
const playbookId = z.string().regex(/^pb_[a-z0-9_-]{6,120}$/, "Playbook inválido.");

/** O alerta e quantos itens ele levou ao cliente (o aprovado) ou tinha (o descartado). */
const decisaoDoAlerta = z.object({ id: alertaId, itens: z.number().int().min(0).max(1000) }).strict();
const decisaoDaAnotacao = z.object({ id: anotacaoId }).strict();
const conteudoDoPlaybook = z.object({ id: playbookId, passos: z.number().int().min(1).max(20), publico: z.enum(["equipe", "todos"]) }).strict();
const decisaoDoPlaybook = z.object({ id: playbookId }).strict();

export const CORE_EVENT_PAYLOADS = {
  "estoque_parado.aprovado": decisaoDoAlerta,
  "estoque_parado.descartado": decisaoDoAlerta,
  "agente.anotacao_sugerida": z.object({ id: anotacaoId, conversa: z.string().regex(/^[A-Za-z0-9_-]{1,160}$/) }).strict(),
  "agente.anotacao_aprovada": decisaoDaAnotacao,
  "agente.anotacao_recusada": decisaoDaAnotacao,
  "agente.anotacao_arquivada": decisaoDaAnotacao,
  "agente.playbook_criado": conteudoDoPlaybook,
  "agente.playbook_editado": conteudoDoPlaybook,
  "agente.playbook_aprovado": decisaoDoPlaybook,
  "agente.playbook_recusado": decisaoDoPlaybook,
  "agente.playbook_arquivado": decisaoDoPlaybook,
  "agente.playbooks_carregados": z.object({ id: playbookId, ids: z.array(playbookId).min(1).max(20) }).strict(),
} as const satisfies Record<CoreEventType, z.ZodTypeAny>;

const TEXTO: Record<CoreEventType, { title: string; description: string }> = {
  "estoque_parado.aprovado": { title: "Alerta de item parado aprovado", description: "O alerta dos itens parados foi aprovado e vai ao cliente." },
  "estoque_parado.descartado": { title: "Alerta de item parado descartado", description: "O alerta dos itens parados foi descartado e não vai ao cliente." },
  "agente.anotacao_sugerida": { title: "Anotação sugerida ao Agent Dute", description: "Uma anotação sugerida na conversa aguarda a coordenação." },
  "agente.anotacao_aprovada": { title: "Anotação do Agent Dute aprovada", description: "A anotação passa a valer nas conversas do cliente." },
  "agente.anotacao_recusada": { title: "Anotação do Agent Dute recusada", description: "A anotação sugerida não vale." },
  "agente.anotacao_arquivada": { title: "Anotação do Agent Dute arquivada", description: "A anotação deixa de valer." },
  "agente.playbook_criado": { title: "Playbook do Agent Dute criado", description: "A coordenação escreveu um playbook, que já vale." },
  "agente.playbook_editado": { title: "Playbook do Agent Dute editado", description: "A coordenação editou o playbook." },
  "agente.playbook_aprovado": { title: "Playbook do Agent Dute aprovado", description: "O playbook passa a valer." },
  "agente.playbook_recusado": { title: "Playbook do Agent Dute recusado", description: "O playbook não vale." },
  "agente.playbook_arquivado": { title: "Playbook do Agent Dute arquivado", description: "O playbook deixa de valer." },
  "agente.playbooks_carregados": { title: "Playbooks iniciais do Agent Dute carregados", description: "Os playbooks iniciais aguardam a aprovação da coordenação." },
};

const TIPO_DA_ENTIDADE: Record<CoreEventType, string> = {
  "estoque_parado.aprovado": "alerta_parado",
  "estoque_parado.descartado": "alerta_parado",
  "agente.anotacao_sugerida": "anotacao_do_agente",
  "agente.anotacao_aprovada": "anotacao_do_agente",
  "agente.anotacao_recusada": "anotacao_do_agente",
  "agente.anotacao_arquivada": "anotacao_do_agente",
  "agente.playbook_criado": "playbook_do_agente",
  "agente.playbook_editado": "playbook_do_agente",
  "agente.playbook_aprovado": "playbook_do_agente",
  "agente.playbook_recusado": "playbook_do_agente",
  "agente.playbook_arquivado": "playbook_do_agente",
  "agente.playbooks_carregados": "playbook_do_agente",
};

/** O único evento que o cliente grava: a anotação que ele envia pelo cartão. */
const EVENTOS_DO_CLIENTE: readonly CoreEventType[] = ["agente.anotacao_sugerida"];

export type CoreEventInput<T extends CoreEventType> = {
  type: T;
  payload: z.input<(typeof CORE_EVENT_PAYLOADS)[T]>;
  customer_code: string;
  actor: CoreProfile;
  occurred_at: string;
  /** O que distingue dois eventos do mesmo tipo e da mesma entidade (a edição do playbook). */
  chave?: string;
};

export function coreEventId(type: CoreEventType, entityId: string, chave?: string): string {
  return `evt_${createHash("sha256").update(JSON.stringify(chave ? [type, entityId, chave] : [type, entityId])).digest("hex").slice(0, 32)}`;
}

/** Um evento por decisão: a mesma decisão gravada de novo tem o mesmo id. */
export function buildCoreEvent<T extends CoreEventType>(input: CoreEventInput<T>) {
  if (!(CORE_EVENT_TYPES as readonly string[]).includes(input.type)) throw new HttpsError("internal", `Tipo de evento desconhecido: ${String(input.type)}.`);
  if (input.actor.role === "cliente" && !EVENTOS_DO_CLIENTE.includes(input.type)) throw new HttpsError("permission-denied", "Evento do núcleo é sempre de alguém da equipe.");
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
    id: coreEventId(input.type, payload.data.id, input.chave),
    type: input.type,
    title: TEXTO[input.type].title,
    description: TEXTO[input.type].description,
    severity: "info" as const,
    entity_type: TIPO_DA_ENTIDADE[input.type],
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
