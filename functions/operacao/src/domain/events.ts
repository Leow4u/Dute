import { FieldValue, type Firestore, type Transaction } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";
import { z } from "zod";

import { actorPayload, compactValue, digest, type OperacaoActor } from "./operations.js";
import { MAX_OS_DO_LOGIN } from "./os.js";

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
  "os.started",
  "os.step_recorded",
  "os.occurrence_recorded",
  "os.item_executed",
  "os.item_added_in_field",
  "os.photo_attached",
  "os.presence_recorded",
  "os.completed",
  "os.signed",
  "os.completed_without_acceptance",
  "os.reviewed",
  "os.addendum_requested",
  "os.reopened",
  "os.survey_opened",
  "os.survey_sent",
  "os.warehouse_return_due",
  "demand.direct_opened",
  "demand.storage_opened",
  "demand.execution_reviewed",
  "collaborator.cnh_expiring",
  "vehicle.maintenance_due",
  "portal.service_requested",
  "portal.service_accepted",
  "portal.service_declined",
] as const;
export type OperacaoEventType = (typeof OPERACAO_EVENT_TYPES)[number];

const criado = z.object({ id }).strict();
const alterado = z.object({ id, edicao_antes: edicao, edicao_depois: edicao }).strict();
/** O colaborador alterado; com o login do app trocado, as OS que ainda vão a campo e passaram a ter o login novo. */
const colaboradorAlterado = alterado.extend({ os_com_acesso: z.array(osId).min(1).max(MAX_OS_DO_LOGIN).optional() }).strict();
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

/** O instante em UTC, como o servidor grava (parte 3.7a). */
const instante = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
const canal = z.enum(["escritorio", "celular"]);
const osIniciada = z.object({ id: osId, demanda: demandaNumero, instante }).strict();
/** A etapa, quando aconteceu, por onde chegou e quem da equipe informou (id do cadastro). */
const etapaRegistrada = z
  .object({
    id: osId,
    demanda: demandaNumero,
    etapa: z.enum(["saida_patio", "chegada_origem", "carregamento", "saida_origem", "chegada_destino", "montagem", "fim"]),
    instante,
    canal,
    informado_por: z.string().regex(/^col_[a-f0-9]{16}$/).nullable(),
  })
  .strict();
/** A ocorrência sem a descrição: o texto é livre e pode ter nome; fica só na OS. */
const ocorrenciaRegistrada = z
  .object({ id: osId, demanda: demandaNumero, ocorrencia: z.string().regex(/^oc_\d{2,3}$/), instante, canal })
  .strict();

const linhaDaOs = z.string().min(1).max(64);
const quantidadeDoItem = z.string().regex(/^\d{1,9}(\.\d{1,3})?$/);
const informante = z.string().regex(/^col_[a-f0-9]{16}$/).nullable();
/** O feito da linha (absoluto) e o de antes: a IA mede quanto e quando (parte 3.7b). */
const itemExecutado = z
  .object({ id: osId, demanda: demandaNumero, linha: linhaDaOs, quantidade: quantidadeDoItem, anterior: quantidadeDoItem.nullable(), instante, canal, informado_por: informante })
  .strict();
/** A inclusão em campo sem quem pediu nem o motivo (texto livre, fica na OS). */
const itemIncluido = z
  .object({
    id: osId,
    demanda: demandaNumero,
    linha: linhaDaOs,
    quantidade: quantidadeDoItem,
    nova_linha: z.boolean(),
    lpu_item_id: z.string().min(1).max(120).nullable(),
    instante,
    canal,
    informado_por: informante,
  })
  .strict();

/** A foto anexada (id do arquivo) e a que se refere, sem a legenda (parte 3.7c). */
const fotoAnexada = z
  .object({
    id: osId,
    demanda: demandaNumero,
    foto: z.string().regex(/^ft_[a-f0-9]{16}$/),
    etapa: z.enum(["saida_patio", "chegada_origem", "carregamento", "saida_origem", "chegada_destino", "montagem", "fim"]).nullable(),
    ocorrencia: z.string().regex(/^oc_\d{2,3}$/).nullable(),
    linha: linhaDaOs.nullable(),
    instante,
    canal,
  })
  .strict();

/** A entrada ou a saída de alguém da equipe, pelo id do cadastro (parte 3.8a): o que paga a diária. */
const presencaRegistrada = z
  .object({ id: osId, demanda: demandaNumero, colaborador_id: z.string().regex(/^col_[a-f0-9]{16}$/), tipo: z.enum(["entrada", "saida"]), instante, canal })
  .strict();

/**
 * A conclusão (parte 3.9a): o fim, por onde, quem informou, o aceite, quantos
 * itens ficaram a menos e quantas fotos do final. Sem o nome nem o documento
 * do responsável do cliente (ficam só na OS).
 */
const osConcluida = z
  .object({
    id: osId,
    demanda: demandaNumero,
    instante,
    canal,
    informado_por: informante,
    aceite: z.enum(["assinatura", "sem_aceite"]),
    itens_a_menos: z.number().int().min(0).max(300),
    fotos_do_final: z.number().int().min(1).max(200),
  })
  .strict();

/** O aceite no local: a assinatura do responsável ou a falta dela. */
const aceiteNoLocal = z.object({ id: osId, demanda: demandaNumero, instante, canal }).strict();

/**
 * A revisão (parte 3.10a): quantas linhas, quantas divergiam e a decisão de
 * cada uma, quantas foram corrigidas, as horas planejadas e reais e o tamanho
 * da equipe. É a matéria do erro do planejamento (Fase 5). Sem motivo nem nota.
 */
const contagem = z.number().int().min(0).max(300);
const osRevisada = z
  .object({
    id: osId,
    demanda: demandaNumero,
    linhas: contagem,
    divergencias: contagem,
    corrigidas: contagem,
    decisoes: z.object({ cobrar: contagem, aditivo: contagem, absorver: contagem, proxima_os: contagem, encerrar: contagem }).strict(),
    minutos_planejados: z.number().int().min(0).max(100_000).nullable(),
    minutos_reais: z.number().int().min(0).max(100_000).nullable(),
    pessoas: z.number().int().min(0).max(20),
  })
  .strict();
const aditivoPedido = z.object({ id: osId, demanda: demandaNumero, linhas: z.number().int().min(1).max(300) }).strict();
const osReaberta = z.object({ id: osId, demanda: demandaNumero, demanda_reaberta: z.boolean() }).strict();
/** A vistoria aberta (parte 3.11a): a OS sem itens, com a janela e a equipe quando já vem agendada. */
const vistoriaAberta = z
  .object({ id: osId, demanda: demandaNumero, seq: z.number().int().min(1).max(99), data: data.nullable(), equipe: composicao, veiculos: frota })
  .strict();
/**
 * A vistoria enviada ao Comercial: quando, por onde e quantos ambientes,
 * itens levantados, fotos e medidas. Os nomes, as medidas e as observações
 * ficam só na OS e na demanda.
 */
const vistoriaEnviada = z
  .object({
    id: osId,
    demanda: demandaNumero,
    instante,
    canal,
    informado_por: z.string().regex(/^col_[a-f0-9]{16}$/).nullable(),
    ambientes: z.number().int().min(1).max(30),
    itens: z.number().int().min(1).max(300),
    fotos: z.number().int().min(1).max(200),
    medidas: z.number().int().min(0).max(30),
  })
  .strict();
/**
 * O alerta da rotina diária (parte 3.13a): o dia da rotina e quantos dias
 * faltam (negativo: já passou). Sem a validade, a categoria nem a placa.
 */
// O cadastro aceita a validade e a revisão de 1980 a 2100: ±50 mil dias cobrem o intervalo inteiro.
const alertaDoDia = z.object({ id, dia: data, dias: z.number().int().min(-50_000).max(50_000) }).strict();
/** A demanda direta foi executada e revisada: vai ao Comercial orçar a execução. */
const execucaoRevisada = z.object({ id: demandaNumero, de: data, ate: data, os: z.number().int().min(1).max(99) }).strict();

/**
 * A solicitação do portal (parte 4.4a): o tipo de serviço, o dia pedido e
 * quantos anexos. Os locais, o que será feito, o nome dos anexos e o motivo
 * da recusa são texto livre do cliente ou da coordenação: ficam só na
 * solicitação.
 */
const solicitacaoId = z.string().regex(/^sol_[a-f0-9]{16}$/, "Id inválido.");
const servicoPedido = z
  .object({ id: solicitacaoId, tipo_servico: z.enum(["transporte", "armazenagem", "servico_em_campo", "mudanca"]), data, anexos: z.number().int().min(0).max(3) })
  .strict();
const servicoAceito = z.object({ id: solicitacaoId, demanda: demandaNumero }).strict();
/** A volta da entrega do WMS concluída (parte 4.5d): o retorno a receber no pedido de saída. */
const retornoAoArmazem = z
  .object({ id: osId, demanda: demandaNumero, instante, pedido: z.string().min(1).max(200).regex(/^[^/]+$/) })
  .strict();
/** A entrega do pedido de saída do WMS (parte 4.5b): o tipo, quantas linhas e OS, e se tem o retorno ao armazém. */
const demandaDoArmazem = z
  .object({ id: demandaNumero, tipo: tipoDemanda, linhas: z.number().int().min(1).max(10), os: z.number().int().min(1).max(2), retorno: z.boolean() })
  .strict();
const servicoRecusado = z.object({ id: solicitacaoId }).strict();

export const OPERACAO_EVENT_PAYLOADS = {
  "collaborator.created": criado,
  "collaborator.updated": colaboradorAlterado,
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
  "os.started": osIniciada,
  "os.step_recorded": etapaRegistrada,
  "os.occurrence_recorded": ocorrenciaRegistrada,
  "os.item_executed": itemExecutado,
  "os.item_added_in_field": itemIncluido,
  "os.photo_attached": fotoAnexada,
  "os.presence_recorded": presencaRegistrada,
  "os.completed": osConcluida,
  "os.signed": aceiteNoLocal,
  "os.completed_without_acceptance": aceiteNoLocal,
  "os.reviewed": osRevisada,
  "os.addendum_requested": aditivoPedido,
  "os.reopened": osReaberta,
  "os.survey_opened": vistoriaAberta,
  "os.survey_sent": vistoriaEnviada,
  "os.warehouse_return_due": retornoAoArmazem,
  "demand.direct_opened": demandaDireta,
  "demand.storage_opened": demandaDoArmazem,
  "demand.execution_reviewed": execucaoRevisada,
  "collaborator.cnh_expiring": alertaDoDia,
  "vehicle.maintenance_due": alertaDoDia,
  "portal.service_requested": servicoPedido,
  "portal.service_accepted": servicoAceito,
  "portal.service_declined": servicoRecusado,
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
  "os.started": { title: "OS em execução", description: "A primeira etapa da OS foi registrada." },
  "os.step_recorded": { title: "Etapa da OS registrada", description: "Uma etapa da execução da OS foi registrada com o instante em que aconteceu." },
  "os.occurrence_recorded": { title: "Ocorrência na OS", description: "Uma ocorrência foi registrada na execução da OS." },
  "os.item_executed": { title: "Item da OS executado", description: "O feito de um item da OS foi informado." },
  "os.item_added_in_field": { title: "Item incluído em campo", description: "Um item foi executado além do planejado na OS." },
  "os.photo_attached": { title: "Foto anexada à OS", description: "Uma foto da execução foi anexada à OS." },
  "os.presence_recorded": { title: "Presença na OS", description: "A entrada ou a saída de alguém da equipe foi registrada na OS." },
  "os.completed": { title: "OS concluída", description: "A execução da OS terminou no local e a OS foi para a revisão interna." },
  "os.signed": { title: "Aceite assinado no local", description: "O responsável do cliente assinou o aceite dos itens executados." },
  "os.completed_without_acceptance": {
    title: "OS concluída sem aceite no local",
    description: "Não havia responsável para assinar; o aceite vem pela validação do cliente no Comercial.",
  },
  "os.reviewed": { title: "OS revisada", description: "A coordenação revisou a OS e decidiu cada divergência entre o planejado e o executado." },
  "os.addendum_requested": { title: "Aditivo pedido ao Comercial", description: "A revisão da OS pediu ao Comercial o aditivo do que passou do orçado." },
  "os.reopened": { title: "OS reaberta", description: "A OS revisada voltou à execução." },
  "os.survey_opened": { title: "Vistoria aberta", description: "A vistoria da demanda foi aberta como OS, antes do orçamento fechado." },
  "os.survey_sent": {
    title: "Vistoria enviada ao Comercial",
    description: "A vistoria levantou ambientes, itens e medidas no local e foi direto ao Comercial, sem revisão.",
  },
  "os.warehouse_return_due": {
    title: "Retorno ao armazém",
    description: "A OS de volta da entrega do WMS terminou: o WMS confere e recebe o que voltou.",
  },
  "demand.direct_opened": { title: "Demanda direta aberta", description: "A demanda chegou direto na Operação e se orça depois da execução." },
  "demand.storage_opened": {
    title: "Entrega do armazém aberta",
    description: "A entrega pela Dutelog de um pedido de saída do WMS virou demanda, com a OS de ida e, com o retorno, a de volta.",
  },
  "demand.execution_reviewed": { title: "Execução revisada", description: "A última OS da demanda direta foi revisada: a execução vai ao Comercial para orçar." },
  "collaborator.cnh_expiring": { title: "CNH vencendo", description: "A CNH de um colaborador ativo vence em até 30 dias ou já venceu." },
  "vehicle.maintenance_due": { title: "Revisão do veículo", description: "A revisão preventiva de um veículo ativo é em até 15 dias ou a data já passou." },
  "portal.service_requested": { title: "OS pedida pelo portal", description: "O cliente pediu uma OS pelo portal; a solicitação está em Para planejar." },
  "portal.service_accepted": { title: "Solicitação do portal atendida", description: "A coordenação abriu a demanda direta a partir da solicitação do portal." },
  "portal.service_declined": { title: "Solicitação do portal recusada", description: "A coordenação recusou a solicitação do portal com o motivo, que o cliente lê." },
};

/** O único evento da Operação gravado pelo cliente: a solicitação dele pelo portal. */
export const EVENTOS_DO_CLIENTE: readonly OperacaoEventType[] = ["portal.service_requested"];

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
  entity_type: "collaborator" | "vehicle" | "os" | "demand" | "service_request";
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
  const doPortal = EVENTOS_DO_CLIENTE.includes(input.type);
  if ((input.actor.role === "cliente") !== doPortal) {
    throw new HttpsError("permission-denied", doPortal ? "A solicitação do portal é sempre do cliente." : "Evento da Operação é sempre de alguém da equipe.");
  }
  const operationId = String(input.operation_id ?? "").trim();
  if (!operationId) throw new HttpsError("internal", `Evento ${input.type} sem a operação de origem.`);
  const payload = OPERACAO_EVENT_PAYLOADS[input.type].safeParse(input.payload);
  if (!payload.success) throw new HttpsError("internal", `Evento ${input.type} com payload inválido.`);
  if (payload.data.id !== input.entity_id) throw new HttpsError("internal", `Evento ${input.type} com entity_id diferente do payload.`);
  const customerCode = textoDoCliente(input.customer_code);
  const doCliente = input.type.startsWith("os.") || input.type.startsWith("demand.") || input.type.startsWith("portal.");
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
          : input.type.startsWith("portal.")
            ? "service_request"
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
