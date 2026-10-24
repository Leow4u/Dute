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
/** A competência da armazenagem (parte 7.2a), só o mês: o cliente já está no evento. */
const competencia = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

export const FINANCEIRO_EVENT_TYPES = [
  "nf.registered",
  "nf.sent",
  "nf.cancelled",
  "cobranca.payment_registered",
  "cobranca.payment_reversed",
  "nf.emission_requested",
  "nf.emission_resumed",
  "nf.emission_abandoned",
  "nf.emission_authorized",
  "nf.emission_rejected",
  "nf.emission_stopped",
  "nf.emission_released",
  "nf.settlement_posted",
  "nf.settlement_cancelled",
  "nf.settlement_stopped",
  "nf.settlement_resumed",
  "nf.settlement_dismissed",
] as const;
export type FinanceiroEventType = (typeof FINANCEIRO_EVENT_TYPES)[number];

/**
 * A NF registrada (parte 4.1a): a fatura, as demandas e as competências de
 * armazenagem que ela fecha (parte 7.2a), quantas autorizações cita, a
 * emissão, o vencimento e a forma de pagamento. Sem valor e sem o número da
 * NF.
 */
const nfRegistrada = z
  .object({
    id: faturaId,
    demandas: z.array(demanda).max(50),
    competencias: z.array(competencia).max(12).default([]),
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

/** O registro da NF cancelado: as demandas voltam a A faturar e as competências, à fila. Sem o motivo, que é texto livre. */
const nfCancelada = z
  .object({ id: faturaId, demandas: z.array(demanda).max(50), competencias: z.array(competencia).max(12).default([]) })
  .strict();

/** Um pagamento da fatura (parcial ou o que quita), sem o valor; `competencias`, a armazenagem que ficou paga no WMS (parte 7.2c). */
const pagamentoRegistrado = z
  .object({
    id: faturaId,
    pagamento_id: pagamentoId,
    recebido_em: data,
    forma: z.enum(["boleto", "pix", "transferencia", "cartao", "dinheiro"]),
    quitada: z.boolean(),
    competencias: z.array(competencia).max(12).default([]),
  })
  .strict();

/** O estorno de um pagamento lançado errado; `reaberta` quando a fatura estava paga, e `competencias`, a armazenagem que voltou a emitida. Sem o motivo. */
const pagamentoEstornado = z
  .object({ id: faturaId, pagamento_id: pagamentoId, reaberta: z.boolean(), competencias: z.array(competencia).max(12).default([]) })
  .strict();

const emissaoId = z.string().regex(/^nfe_[a-f0-9]{20}$/, "Emissão inválida.");
const forma = z.enum(["boleto", "pix", "transferencia", "cartao", "dinheiro"]);

/** A emissão da NFS-e pela Omie pedida (parte 7.4c): o que ela reserva, o vencimento e a forma. Sem valor. */
const emissaoPedida = z
  .object({ id: emissaoId, demandas: z.array(demanda).max(50), competencias: z.array(competencia).max(12).default([]), vencimento: data, forma })
  .strict();

/** A emissão parada ou rejeitada que uma pessoa retomou, e a etapa em que ela volta. */
const emissaoRetomada = z
  .object({ id: emissaoId, etapa_antes: z.enum(["parada", "rejeitada"]), etapa_depois: z.enum(["na_fila", "os_incluida", "na_prefeitura", "reenviando", "cancelando"]) })
  .strict();

/** A desistência da emissão: as reservas que voltam a A faturar e se a OS ainda vai ser cancelada na Omie. */
const emissaoDesistida = z
  .object({ id: emissaoId, demandas: z.array(demanda).max(50), competencias: z.array(competencia).max(12).default([]), cancela_na_omie: z.boolean() })
  .strict();

/** A NFS-e autorizada pela prefeitura, e a fatura que nasceu dela (parte 7.4d). Sem o número da nota. */
const emissaoAutorizada = z.object({ id: emissaoId, fatura_id: faturaId }).strict();

/** A prefeitura recusou a RPS; a mensagem fica na emissão, não no evento. */
const emissaoRejeitada = z.object({ id: emissaoId }).strict();

/** A emissão parou e espera uma pessoa. */
const emissaoParada = z
  .object({
    id: emissaoId,
    motivo: z.enum([
      "cliente_nao_achado",
      "cliente_repetido",
      "ambiente_errado",
      "chave",
      "sem_chaves",
      "falhas_seguidas",
      "cancelada_na_omie",
      "prefeitura_demorou",
      "fatura_recusada",
    ]),
  })
  .strict();

/** A OS cancelada na Omie depois da desistência: as reservas voltaram a A faturar. */
const emissaoSolta = z
  .object({ id: emissaoId, demandas: z.array(demanda).max(50), competencias: z.array(competencia).max(12).default([]) })
  .strict();

const baixaId = z.string().regex(/^bxa_[a-f0-9]{24}$/, "Baixa inválida.");

/** O recebimento do pagamento lançado no título da OS na Omie (parte 7.4g). */
const baixaLancada = z.object({ id: baixaId, pagamento_id: pagamentoId }).strict();

/** O recebimento estornado na Dute saiu da Omie, ou nunca chegou a sair. */
const baixaCancelada = z.object({ id: baixaId, pagamento_id: pagamentoId }).strict();

/** A baixa parou e espera uma pessoa. */
const baixaParada = z
  .object({
    id: baixaId,
    motivo: z.enum(["titulo_nao_achado", "titulo_repetido", "titulo_liquidado", "sem_conta_corrente", "chave", "sem_chaves", "falhas_seguidas"]),
  })
  .strict();

/** Alguém do Financeiro retomou a baixa parada: ela volta a lançar ou a cancelar (parte 7.4h). */
const baixaRetomada = z.object({ id: baixaId, etapa_depois: z.enum(["na_fila", "cancelando"]) }).strict();

/** Alguém do Financeiro dispensou a baixa parada: resolveu na Omie à mão. O motivo é o da parada. */
const baixaDispensada = z.object({ id: baixaId, motivo: baixaParada.shape.motivo }).strict();

export const FINANCEIRO_EVENT_PAYLOADS = {
  "nf.registered": nfRegistrada,
  "nf.sent": nfEnviada,
  "nf.cancelled": nfCancelada,
  "cobranca.payment_registered": pagamentoRegistrado,
  "cobranca.payment_reversed": pagamentoEstornado,
  "nf.emission_requested": emissaoPedida,
  "nf.emission_resumed": emissaoRetomada,
  "nf.emission_abandoned": emissaoDesistida,
  "nf.emission_authorized": emissaoAutorizada,
  "nf.emission_rejected": emissaoRejeitada,
  "nf.emission_stopped": emissaoParada,
  "nf.emission_released": emissaoSolta,
  "nf.settlement_posted": baixaLancada,
  "nf.settlement_cancelled": baixaCancelada,
  "nf.settlement_stopped": baixaParada,
  "nf.settlement_resumed": baixaRetomada,
  "nf.settlement_dismissed": baixaDispensada,
} as const;

const TEXTO: Record<FinanceiroEventType, { title: string; description: string }> = {
  "nf.registered": { title: "NF registrada", description: "A NF emitida fora do sistema foi registrada e as demandas dela ficaram faturadas." },
  "nf.sent": { title: "NF enviada", description: "A NF foi enviada ao cliente." },
  "nf.cancelled": { title: "Registro da NF cancelado", description: "O registro da NF foi cancelado e as demandas dela voltaram a A faturar." },
  "cobranca.payment_registered": { title: "Pagamento registrado", description: "Um pagamento da NF foi registrado." },
  "cobranca.payment_reversed": { title: "Pagamento estornado", description: "Um pagamento lançado na NF foi estornado." },
  "nf.emission_requested": { title: "NFS-e pedida à Omie", description: "As demandas e a armazenagem ficaram reservadas para a NFS-e que a Omie vai emitir." },
  "nf.emission_resumed": { title: "Emissão da NFS-e retomada", description: "Alguém do Financeiro retomou a emissão parada ou rejeitada." },
  "nf.emission_abandoned": { title: "Emissão da NFS-e desistida", description: "Alguém do Financeiro desistiu da emissão; as reservas voltam a A faturar." },
  "nf.emission_authorized": { title: "NFS-e autorizada", description: "A prefeitura autorizou a NFS-e emitida pela Omie, e a fatura nasceu dela." },
  "nf.emission_rejected": { title: "NFS-e rejeitada pela prefeitura", description: "A prefeitura recusou a NFS-e; corrija na Omie e tente de novo, ou desista." },
  "nf.emission_stopped": { title: "Emissão da NFS-e parada", description: "A emissão espera alguém do Financeiro." },
  "nf.emission_released": { title: "OS cancelada na Omie", description: "A OS da emissão desistida foi cancelada na Omie, e as reservas voltaram a A faturar." },
  "nf.settlement_posted": { title: "Baixa lançada na Omie", description: "O pagamento registrado na Dute foi lançado no título da OS na Omie." },
  "nf.settlement_cancelled": { title: "Baixa cancelada na Omie", description: "O pagamento estornado na Dute não está mais no título da OS na Omie." },
  "nf.settlement_stopped": { title: "Baixa na Omie parada", description: "A baixa do pagamento na Omie espera alguém do Financeiro." },
  "nf.settlement_resumed": { title: "Baixa na Omie retomada", description: "Alguém do Financeiro retomou a baixa parada." },
  "nf.settlement_dismissed": { title: "Baixa na Omie dispensada", description: "Alguém do Financeiro resolveu a baixa na Omie à mão." },
};

/** A entidade do evento: a fatura, a emissão da NFS-e pela Omie ou a baixa do pagamento na Omie. */
export function entidadeDoEvento(type: FinanceiroEventType): "fatura" | "nf_emissao" | "nf_baixa" {
  if (type.startsWith("nf.emission_")) return "nf_emissao";
  return type.startsWith("nf.settlement_") ? "nf_baixa" : "fatura";
}

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
  entity_type: "fatura" | "nf_emissao" | "nf_baixa";
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
    entity_type: entidadeDoEvento(input.type),
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
