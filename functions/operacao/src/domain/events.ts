import { FieldValue, type Firestore, type Transaction } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";
import { z } from "zod";

import { actorPayload, compactValue, digest, type OperacaoActor } from "./operations.js";

/**
 * Eventos do cadastro da Operação em `events` (invariante 2). Gravados na
 * mesma transação, com `source: functions_operacao` e `severity: info`.
 *
 * O payload não leva nome, CPF, telefone, CNH nem placa: interno, wms e
 * suporte leem `events`. Título e descrição saem de um modelo fixo. Nenhum
 * tipo usa as palavras que o roteador de avisos do WMS transforma em aviso
 * ao cliente (notificationKindForEvent em functions/wms/src/index.ts).
 */

export const EVENTS_COLLECTION = "events";
export const OPERACAO_EVENT_SOURCE = "functions_operacao";

const id = z.string().regex(/^(?:col|vei)_[a-f0-9]{16}$/, "Id inválido.");
const osId = z.string().regex(/^\d{5,8}-\d{2}$/, "Id inválido.");
const demandaNumero = z.string().regex(/^\d{5,8}$/, "Demanda inválida.");
const edicao = z.number().int().min(1).max(100_000);

export const OPERACAO_EVENT_TYPES = [
  "collaborator.created",
  "collaborator.updated",
  "collaborator.deactivated",
  "collaborator.reactivated",
  "vehicle.created",
  "vehicle.updated",
  "vehicle.deactivated",
  "vehicle.reactivated",
  "os.created",
  "os.planned",
  "os.scheduled",
  "os.items_changed",
  "os.cancelled",
  "demand.direct_opened",
] as const;
export type OperacaoEventType = (typeof OPERACAO_EVENT_TYPES)[number];

const criado = z.object({ id }).strict();
const alterado = z.object({ id, edicao_antes: edicao, edicao_depois: edicao }).strict();
const osCriada = z.object({ id: osId, demanda: demandaNumero, seq: z.number().int().min(1).max(99), linhas: z.number().int().min(1).max(300) }).strict();
const osCancelada = z.object({ id: osId, demanda: demandaNumero }).strict();
const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const hora = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable();
/**
 * A composição da equipe sem nome: o id do cadastro, o papel e o vínculo. É o
 * que a IA usa para medir equipe por serviço (Fase 5).
 */
const composicao = z
  .array(
    z
      .object({
        colaborador_id: z.string().regex(/^col_[a-f0-9]{16}$/),
        papel: z.enum(["lider", "motorista", "montador", "ajudante"]).nullable(),
        vinculo: z.enum(["proprio", "freelancer", "terceiro"]),
      })
      .strict(),
  )
  .max(20);
const frota = z.array(z.string().regex(/^vei_[a-f0-9]{16}$/)).max(6);
const osPlanejada = z
  .object({
    id: osId,
    demanda: demandaNumero,
    seq: z.number().int().min(1).max(99),
    linhas: z.number().int().min(1).max(300),
    data: data.nullable(),
    equipe: composicao,
    veiculos: frota,
  })
  .strict();
const osAgendada = z
  .object({ id: osId, demanda: demandaNumero, data, inicio: hora, fim: hora, equipe: composicao, veiculos: frota })
  .strict();
const tipoDemanda = z.enum(["planejada", "emergencial", "paraquedas"]);
const demandaDireta = z
  .object({ id: demandaNumero, tipo: tipoDemanda, tipo_calculado: tipoDemanda, linhas: z.number().int().min(1).max(100) })
  .strict();
const osItens = z
  .object({ id: osId, demanda: demandaNumero, linhas: z.number().int().min(1).max(300), edicao_antes: edicao, edicao_depois: edicao })
  .strict();

export const OPERACAO_EVENT_PAYLOADS = {
  "collaborator.created": criado,
  "collaborator.updated": alterado,
  "collaborator.deactivated": criado,
  "collaborator.reactivated": criado,
  "vehicle.created": criado,
  "vehicle.updated": alterado,
  "vehicle.deactivated": criado,
  "vehicle.reactivated": criado,
  "os.created": osCriada,
  "os.planned": osPlanejada,
  "os.scheduled": osAgendada,
  "os.items_changed": osItens,
  "os.cancelled": osCancelada,
  "demand.direct_opened": demandaDireta,
} as const;

const TEXTO: Record<OperacaoEventType, { title: string; description: string }> = {
  "collaborator.created": { title: "Colaborador cadastrado", description: "O cadastro de colaborador foi criado." },
  "collaborator.updated": { title: "Colaborador atualizado", description: "O cadastro de colaborador foi atualizado." },
  "collaborator.deactivated": { title: "Colaborador desativado", description: "O cadastro de colaborador foi desativado." },
  "collaborator.reactivated": { title: "Colaborador reativado", description: "O cadastro de colaborador foi reativado." },
  "vehicle.created": { title: "Veículo cadastrado", description: "O cadastro de veículo foi criado." },
  "vehicle.updated": { title: "Veículo atualizado", description: "O cadastro de veículo foi atualizado." },
  "vehicle.deactivated": { title: "Veículo desativado", description: "O cadastro de veículo foi desativado." },
  "vehicle.reactivated": { title: "Veículo reativado", description: "O cadastro de veículo foi reativado." },
  "os.created": { title: "OS aberta", description: "A OS foi aberta com o saldo da demanda." },
  "os.planned": { title: "OS planejada", description: "A OS foi planejada com uma fatia do saldo da demanda." },
  "os.scheduled": { title: "OS agendada", description: "A OS recebeu janela, equipe e veículos." },
  "os.items_changed": { title: "Itens da OS alterados", description: "A fatia do saldo da demanda nesta OS mudou." },
  "os.cancelled": { title: "OS cancelada", description: "A OS foi cancelada e a fatia voltou ao saldo da demanda." },
  "demand.direct_opened": { title: "Demanda direta aberta", description: "A demanda chegou direto na Operação e se orça depois da execução." },
};

export function isOperacaoEventType(value: string): value is OperacaoEventType {
  return (OPERACAO_EVENT_TYPES as readonly string[]).includes(value);
}

export type OperacaoEventInput<T extends OperacaoEventType> = {
  operation_id: string;
  suffix?: string;
  type: T;
  entity_id: string;
  payload: z.input<(typeof OPERACAO_EVENT_PAYLOADS)[T]>;
  actor: OperacaoActor;
  /** Código do cliente na OS e na demanda. O cadastro da equipe deixa vazio. */
  customer_code?: string | null;
  occurred_at?: string;
};

export type OperacaoEventRecord = {
  id: string;
  type: OperacaoEventType;
  title: string;
  description: string;
  severity: "info";
  entity_type: "collaborator" | "vehicle" | "os" | "demand";
  entity_id: string;
  customer_code: string | null;
  payload: Record<string, unknown>;
  occurred_at: string;
  source: typeof OPERACAO_EVENT_SOURCE;
  operation_id: string;
  actor: Record<string, string>;
};

export function operacaoEventId(operationId: string, suffix: string): string {
  return `evt_${digest({ operationId, suffix })}`;
}

function textoDoCliente(valor: string | null | undefined): string | null {
  const texto = String(valor ?? "").trim();
  return texto || null;
}

export function buildOperacaoEvent<T extends OperacaoEventType>(input: OperacaoEventInput<T>): OperacaoEventRecord {
  if (!isOperacaoEventType(input.type)) throw new HttpsError("internal", `Tipo de evento desconhecido: ${String(input.type)}.`);
  if (input.actor.role === "cliente") throw new HttpsError("permission-denied", "Evento da Operação é sempre de alguém da equipe.");
  const operationId = String(input.operation_id ?? "").trim();
  if (!operationId) throw new HttpsError("internal", `Evento ${input.type} sem a operação de origem.`);
  const payload = OPERACAO_EVENT_PAYLOADS[input.type].safeParse(input.payload);
  if (!payload.success) throw new HttpsError("internal", `Evento ${input.type} com payload inválido.`);
  if (payload.data.id !== input.entity_id) throw new HttpsError("internal", `Evento ${input.type} com entity_id diferente do payload.`);
  const customerCode = textoDoCliente(input.customer_code);
  const doCliente = input.type.startsWith("os.") || input.type.startsWith("demand.");
  if (doCliente && !customerCode) {
    throw new HttpsError("internal", `Evento ${input.type} sem customer_code.`);
  }
  const occurredAt = input.occurred_at ?? new Date().toISOString();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(occurredAt)) {
    throw new HttpsError("internal", `Evento ${input.type} com occurred_at fora do formato ISO em UTC.`);
  }
  const texto = TEXTO[input.type];
  return {
    id: operacaoEventId(operationId, input.suffix ?? input.type),
    type: input.type,
    title: texto.title,
    description: texto.description,
    severity: "info",
    entity_type: input.type.startsWith("vehicle")
      ? "vehicle"
      : input.type.startsWith("os.")
        ? "os"
        : input.type.startsWith("demand.")
          ? "demand"
          : "collaborator",
    entity_id: input.entity_id,
    customer_code: doCliente ? customerCode : null,
    payload: compactValue(payload.data) as Record<string, unknown>,
    occurred_at: occurredAt,
    source: OPERACAO_EVENT_SOURCE,
    operation_id: operationId,
    actor: actorPayload(input.actor),
  };
}

export function createOperacaoEvent<T extends OperacaoEventType>(
  transaction: Transaction,
  db: Firestore,
  input: OperacaoEventInput<T>,
): { id: string; type: OperacaoEventType } {
  const event = buildOperacaoEvent(input);
  transaction.create(db.collection(EVENTS_COLLECTION).doc(event.id), {
    ...event,
    created_at: FieldValue.serverTimestamp(),
  });
  return { id: event.id, type: event.type };
}
