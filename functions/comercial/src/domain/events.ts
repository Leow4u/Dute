import { FieldValue, type Firestore, type Transaction } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";
import { z } from "zod";

import { STATUS_CONTRATO } from "./contratos-datas.js";
import { actorPayload, compactValue, digest, type ComercialActor } from "./operations.js";

/**
 * Eventos do Comercial em `events` (docs/plataforma/fase-6-comercial.md,
 * "Eventos"; invariante 2 do CLAUDE.md).
 *
 * - Gravados na mesma transação da operação, com id determinístico
 *   (operação + sufixo), `source: functions_comercial` e `severity` sempre
 *   `info`: com `attention` o WMS abriria item em `ai_agent_inbox`, que a
 *   operação lê.
 * - `occurred_at` é texto ISO (o WMS ordena e filtra por ele como texto) e
 *   `created_at` é serverTimestamp. `customer_code` é o código real do
 *   cliente, nunca o id do documento.
 * - Nunca levam preço, total, desconto, nem nome, e-mail ou telefone de
 *   cliente ou contato: o Agent Dute mostra eventos a interno e suporte. Por
 *   isso cada tipo tem payload zod `.strict()`, e título e descrição saem de
 *   um modelo fixo, só com número, RV e situação.
 * - Nenhum tipo usa as palavras que o roteador de avisos do WMS transforma em
 *   aviso ao cliente ("order", "invoice", "receb"...; notificationKindForEvent
 *   em functions/wms/src/index.ts). O teste events.test.ts lê essas palavras.
 *
 * Os payloads são o mínimo; cada parte do Comercial completa o seu tipo
 * (sempre com o teste do contrato passando).
 */

export const EVENTS_COLLECTION = "events";
export const COMERCIAL_EVENT_SOURCE = "functions_comercial";

// --- Valores que podem ir num payload --------------------------------------

/** Número do serviço (demanda e orçamento), a partir de 10001. */
const numero = z.string().regex(/^\d{5,8}$/, "Número do serviço inválido.");
/** Revisão: 0 é o orçamento original ("10045"); 1 em diante, "10045 – RV01". */
const rv = z.number().int().min(0).max(99);
const edicao = z.number().int().min(1).max(100_000);
/** Id de documento (contato, local, contrato, tabela...). Sem espaço: não cabe nome nem valor. */
const id = z.string().regex(/^[A-Za-z0-9_-]{1,120}$/, "Id inválido.");
/** Código de lista (nome de campo), em snake_case e sem algarismo: não cabe valor. */
const codigo = z.string().regex(/^(?=.{1,60}$)[a-z]+(?:_[a-z]+)*$/, "Código inválido.");
const contagem = z.number().int().min(0).max(1_000_000);
const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida (AAAA-MM-DD).");
const competencia = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Competência inválida (AAAA-MM).");

export const ETAPAS_DEMANDA = [
  "em_montagem",
  "para_aprovar",
  "para_enviar",
  "aguardando_cliente",
  "para_planejar",
  "execucao_a_orcar",
  "aguardando_autorizacao",
  "a_faturar",
  "perdida",
] as const;
const etapa = z.enum(ETAPAS_DEMANDA);

export const TIPOS_RV = ["proposta", "aditivo", "execucao"] as const;
const tipoRv = z.enum(TIPOS_RV);

export const ESTAGIOS_CADASTRO = ["prospect", "cliente"] as const;
export const REGIMES_COBRANCA = ["por_demanda", "medicao_mensal", "wms"] as const;
/** Tipos de aditivo do contrato (contracts/{id}/aditivos). */
export const TIPOS_ADITIVO = ["formalizacao", "prorrogacao", "preco", "escopo", "outro"] as const;

/**
 * Variante da tabela de preço: na tabela é texto livre de letras ("Comercial",
 * "Noturna", "Fim de semana"); no evento vai normalizada (normalizarVariante
 * em tabelas.ts: "fim_de_semana"), como código, sem algarismo.
 */
const variante = codigo;

const quoteStep = z.object({ numero, rv, edicao }).strict();

// --- Payload de cada tipo -----------------------------------------------------

export const COMERCIAL_EVENT_PAYLOADS = {
  "demand.created": z.object({ numero }).strict(),
  "demand.stage_changed": z
    .object({
      numero,
      etapa_antes: etapa,
      etapa_depois: etapa,
      segundos_desde_anterior: contagem.optional(),
    })
    .strict(),
  "demand.won": z.object({ numero, rv }).strict(),
  // O motivo entra na parte 10, como z.enum da lista de motivos.
  "demand.lost": z.object({ numero, etapa_antes: etapa }).strict(),

  "quote.created": z.object({ numero, rv, tipo_rv: tipoRv, edicao }).strict(),
  "quote.updated": z.object({ numero, rv, edicao_antes: edicao, edicao_depois: edicao }).strict(),
  "quote.submitted": quoteStep,
  "quote.returned": quoteStep,
  "quote.approved": quoteStep,
  "quote.approval_waived": quoteStep,
  "quote.sent": quoteStep,
  "quote.revised": z.object({ numero, rv, rv_anterior: rv, tipo_rv: tipoRv }).strict(),

  "commercial_customer.created": z.object({ stage: z.enum(ESTAGIOS_CADASTRO) }).strict(),
  "commercial_customer.updated": z.object({ campos: z.array(codigo).min(1).max(40) }).strict(),
  "commercial_customer.became_client": z.object({ numero: numero.optional() }).strict(),
  "commercial_customer.archived": z.object({}).strict(),

  "customer_contact.saved": z.object({ contato_id: id, novo: z.boolean() }).strict(),
  "customer_location.saved": z.object({ local_id: id, novo: z.boolean() }).strict(),

  // Contrato (parte 8): ids, tipos, datas e contagens. Nunca o número do
  // contrato no cliente, o objeto, o documento nem valor.
  "contract.created": z
    .object({ contrato_id: id, regime: z.enum(REGIMES_COBRANCA), vigente_de: data, vigente_ate: data.nullable() })
    .strict(),
  "contract.updated": z
    .object({ contrato_id: id, campos: z.array(codigo).min(1).max(40), edicao, status: z.enum(STATUS_CONTRATO) })
    .strict(),
  "contract.amendment_added": z
    .object({
      contrato_id: id,
      aditivo_id: id,
      tipo: z.enum(TIPOS_ADITIVO),
      vigencia_alterada: z.boolean(),
      /** O fim novo do contrato, quando o aditivo prorrogou. */
      vigente_ate: data.optional(),
      tabelas: contagem,
      documento_localizado: z.boolean(),
    })
    .strict(),

  "price_table.imported": z
    .object({
      tabela_id: id,
      variante,
      /** Itens com preço na tabela. */
      linhas: contagem,
      /** Itens que a carga criou no catálogo (os outros já existiam). */
      itens_novos: contagem.optional(),
      vigencia_inicio: data,
      vigencia_fim: data.nullable(),
      contrato_id: id.nullable().optional(),
      /** A tabela anterior, que esta carga encerrou (price_table.closed na mesma operação). */
      substitui: id.nullable().optional(),
    })
    .strict(),
  "price_table.closed": z
    .object({
      tabela_id: id,
      variante,
      vigencia_fim: data,
      substituida_por: id,
      contrato_id: id.nullable().optional(),
    })
    .strict(),

  "client_authorization.recorded": z
    .object({ autorizacao_id: id, demandas: z.array(numero).min(1).max(200) })
    .strict(),

  "medicao.created": z.object({ medicao_id: id, contrato_id: id, competencia, demandas: contagem }).strict(),
  "medicao.sent": z.object({ medicao_id: id, competencia }).strict(),
  "medicao.approved": z.object({ medicao_id: id, competencia }).strict(),
} as const;

export type ComercialEventType = keyof typeof COMERCIAL_EVENT_PAYLOADS;
export type ComercialEventPayload<T extends ComercialEventType> = z.infer<(typeof COMERCIAL_EVENT_PAYLOADS)[T]>;

export const COMERCIAL_EVENT_TYPES = Object.keys(COMERCIAL_EVENT_PAYLOADS) as ComercialEventType[];

/** entity_type de cada família de eventos. */
const ENTITY_TYPES: Record<string, string> = {
  demand: "demand",
  quote: "quote",
  commercial_customer: "customer",
  customer_contact: "customer_contact",
  customer_location: "customer_location",
  contract: "contract",
  price_table: "price_table",
  client_authorization: "client_authorization",
  medicao: "medicao",
};

/**
 * Evento sem cliente: só a carga e o encerramento de tabela sem contrato (a
 * Padrão Dutelog, que é de todos). Tabela com contrato é de um cliente.
 */
function semClienteAceito(type: ComercialEventType, payload: Record<string, unknown>): boolean {
  return (type === "price_table.imported" || type === "price_table.closed") && !payload.contrato_id;
}

/** Instante em ISO, em UTC e com milissegundos (o formato de toISOString): o WMS ordena e filtra por ele como texto. */
const instante = z.string().datetime({ precision: 3 });

// --- Título e descrição: modelo fixo por tipo ---------------------------------

const ETAPA_ROTULO: Record<(typeof ETAPAS_DEMANDA)[number], string> = {
  em_montagem: "Em montagem",
  para_aprovar: "Para aprovar",
  para_enviar: "Para enviar",
  aguardando_cliente: "Aguardando cliente",
  para_planejar: "Para planejar",
  execucao_a_orcar: "Execução a orçar",
  aguardando_autorizacao: "Aguardando autorização",
  a_faturar: "A faturar",
  perdida: "Perdida",
};

const TIPO_RV_ROTULO: Record<(typeof TIPOS_RV)[number], string> = {
  proposta: "proposta",
  aditivo: "aditivo",
  execucao: "execução",
};

const REGIME_ROTULO: Record<(typeof REGIMES_COBRANCA)[number], string> = {
  por_demanda: "por demanda",
  medicao_mensal: "medição mensal",
  wms: "fatura do WMS",
};

/** "fim_de_semana" → "fim de semana". */
function varianteRotulo(value: string): string {
  return value.replace(/_/g, " ");
}

function orcamento(numeroServico: string, revisao: number): string {
  return revisao === 0 ? `Orçamento ${numeroServico}` : `Orçamento ${numeroServico} – RV${String(revisao).padStart(2, "0")}`;
}

function revisaoRotulo(revisao: number): string {
  return revisao === 0 ? "o orçamento original" : `a RV${String(revisao).padStart(2, "0")}`;
}

function dataRotulo(value: string): string {
  const [ano, mes, dia] = value.split("-");
  return `${dia}/${mes}/${ano}`;
}

function vigenciaRotulo(de: string, ate: string | null): string {
  return ate === null ? `vigente desde ${dataRotulo(de)}, por prazo indeterminado` : `vigência de ${dataRotulo(de)} a ${dataRotulo(ate)}`;
}

const TIPO_ADITIVO_ROTULO: Record<(typeof TIPOS_ADITIVO)[number], string> = {
  formalizacao: "formalização",
  prorrogacao: "prorrogação",
  preco: "preço",
  escopo: "escopo",
  outro: "outro tipo",
};

function competenciaRotulo(value: string): string {
  const [ano, mes] = value.split("-");
  return `${mes}/${ano}`;
}

type Text = { title: string; description: string };
type Templates = { [T in ComercialEventType]: (payload: ComercialEventPayload<T>) => Text };

const TEMPLATES: Templates = {
  "demand.created": (p) => ({ title: `Demanda ${p.numero} aberta`, description: "Demanda aberta no Comercial." }),
  "demand.stage_changed": (p) => ({
    title: `Demanda ${p.numero}: ${ETAPA_ROTULO[p.etapa_depois]}`,
    description: `Etapa: ${ETAPA_ROTULO[p.etapa_antes]} → ${ETAPA_ROTULO[p.etapa_depois]}.`,
  }),
  "demand.won": (p) => ({ title: `Demanda ${p.numero} fechada`, description: `Fechada com ${revisaoRotulo(p.rv)}.` }),
  "demand.lost": (p) => ({
    title: `Demanda ${p.numero} perdida`,
    description: `Perdida na etapa ${ETAPA_ROTULO[p.etapa_antes]}.`,
  }),

  "quote.created": (p) => ({
    title: `${orcamento(p.numero, p.rv)} criado`,
    description: `Revisão de ${TIPO_RV_ROTULO[p.tipo_rv]} em montagem.`,
  }),
  "quote.updated": (p) => ({
    title: `${orcamento(p.numero, p.rv)} atualizado`,
    description: `Edição ${p.edicao_antes} → ${p.edicao_depois}.`,
  }),
  "quote.submitted": (p) => ({
    title: `${orcamento(p.numero, p.rv)} enviado para aprovação`,
    description: `Edição ${p.edicao}.`,
  }),
  "quote.returned": (p) => ({
    title: `${orcamento(p.numero, p.rv)} devolvido para ajuste`,
    description: `Edição ${p.edicao}.`,
  }),
  "quote.approved": (p) => ({ title: `${orcamento(p.numero, p.rv)} aprovado`, description: `Edição ${p.edicao}.` }),
  "quote.approval_waived": (p) => ({
    title: `${orcamento(p.numero, p.rv)} com aprovação dispensada`,
    description: `Edição ${p.edicao}.`,
  }),
  "quote.sent": (p) => ({ title: `${orcamento(p.numero, p.rv)} enviado ao cliente`, description: `Edição ${p.edicao}.` }),
  "quote.revised": (p) => ({
    title: `${orcamento(p.numero, p.rv)} aberto`,
    description: `Revisão de ${TIPO_RV_ROTULO[p.tipo_rv]} a partir de ${revisaoRotulo(p.rv_anterior)}.`,
  }),

  "commercial_customer.created": (p) => ({
    title: "Cadastro comercial criado",
    description: p.stage === "prospect" ? "Entrou como prospect." : "Entrou como cliente.",
  }),
  "commercial_customer.updated": (p) => ({
    title: "Cadastro comercial atualizado",
    description: `${p.campos.length} ${p.campos.length === 1 ? "campo alterado" : "campos alterados"}.`,
  }),
  "commercial_customer.became_client": (p) => ({
    title: "Prospect virou cliente",
    description: p.numero ? `No fechamento da demanda ${p.numero}.` : "Marcado como cliente.",
  }),
  "commercial_customer.archived": () => ({ title: "Cadastro comercial arquivado", description: "Cadastro arquivado." }),

  "customer_contact.saved": (p) => ({
    title: p.novo ? "Contato cadastrado" : "Contato atualizado",
    description: "Contato do cliente no Comercial.",
  }),
  "customer_location.saved": (p) => ({
    title: p.novo ? "Local cadastrado" : "Local atualizado",
    description: "Local do cliente no Comercial.",
  }),

  "contract.created": (p) => ({
    title: "Contrato cadastrado",
    description: `Cobrança ${REGIME_ROTULO[p.regime]}; ${vigenciaRotulo(p.vigente_de, p.vigente_ate)}.`,
  }),
  "contract.updated": (p) => ({
    title: p.status === "encerrado" && p.campos.includes("status") ? "Contrato encerrado" : "Contrato atualizado",
    description: `${p.campos.length} ${p.campos.length === 1 ? "campo alterado" : "campos alterados"}; edição ${p.edicao}.`,
  }),
  "contract.amendment_added": (p) => ({
    title: `Aditivo ${p.aditivo_id} registrado no contrato`,
    description: [
      `Aditivo de ${TIPO_ADITIVO_ROTULO[p.tipo]}`,
      p.vigente_ate ? `vigência prorrogada até ${dataRotulo(p.vigente_ate)}` : "vigência mantida",
      p.tabelas > 0 ? `${p.tabelas} ${p.tabelas === 1 ? "tabela ligada" : "tabelas ligadas"}` : null,
      p.documento_localizado ? null : "documento não localizado",
    ]
      .filter(Boolean)
      .join("; ")
      .concat("."),
  }),

  "price_table.imported": (p) => ({
    title: "Tabela de preço importada",
    description: `Variante ${varianteRotulo(p.variante)}, ${p.linhas} itens, vigente desde ${dataRotulo(p.vigencia_inicio)}.`,
  }),
  "price_table.closed": (p) => ({
    title: "Tabela de preço encerrada",
    description: `Variante ${varianteRotulo(p.variante)}, vigente até ${dataRotulo(p.vigencia_fim)}, substituída por outra tabela.`,
  }),

  "client_authorization.recorded": (p) => ({
    title: "Autorização do cliente registrada",
    description: `Ligada a ${p.demandas.length} ${p.demandas.length === 1 ? "demanda" : "demandas"}.`,
  }),

  "medicao.created": (p) => ({
    title: `Medição ${competenciaRotulo(p.competencia)} aberta`,
    description: `${p.demandas} ${p.demandas === 1 ? "demanda" : "demandas"} na medição.`,
  }),
  "medicao.sent": (p) => ({
    title: `Medição ${competenciaRotulo(p.competencia)} enviada ao cliente`,
    description: "Aguardando a aprovação do cliente.",
  }),
  "medicao.approved": (p) => ({
    title: `Medição ${competenciaRotulo(p.competencia)} aprovada pelo cliente`,
    description: "Medição aprovada.",
  }),
};

function isComercialEventType(value: unknown): value is ComercialEventType {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(COMERCIAL_EVENT_PAYLOADS, value);
}

function parsePayload<T extends ComercialEventType>(type: T, payload: unknown): ComercialEventPayload<T> {
  const parsed = COMERCIAL_EVENT_PAYLOADS[type].safeParse(payload);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? ` (${issue.path.join(".")})` : "";
    throw new HttpsError("internal", `Evento ${type} fora do contrato${where}: ${issue?.message ?? "payload inválido"}.`);
  }
  return parsed.data as ComercialEventPayload<T>;
}

function templateText<T extends ComercialEventType>(type: T, payload: ComercialEventPayload<T>): Text {
  const template = TEMPLATES[type] as unknown as (value: ComercialEventPayload<T>) => Text;
  return template(payload);
}

/** Título e descrição do evento, do modelo fixo do tipo. */
export function comercialEventText<T extends ComercialEventType>(type: T, payload: ComercialEventPayload<T>): Text {
  if (!isComercialEventType(type)) throw new HttpsError("internal", `Tipo de evento desconhecido: ${String(type)}.`);
  return templateText(type, parsePayload(type, payload));
}

export function comercialEventId(operationId: string, suffix: string): string {
  return `evt_${digest({ operationId, suffix })}`;
}

export type ComercialEventInput<T extends ComercialEventType> = {
  /** Recibo (comercial_operations) da operação que gerou o evento. */
  operation_id: string;
  /** Diferencia eventos da mesma operação. Padrão: o tipo. */
  suffix?: string;
  type: T;
  entity_id: string;
  /** Código real do cliente (customer_code); null só na tabela sem contrato. */
  customer_code: string | null;
  payload: z.input<(typeof COMERCIAL_EVENT_PAYLOADS)[T]>;
  actor: ComercialActor;
  /** ISO em UTC com milissegundos (toISOString). Padrão: agora. */
  occurred_at?: string;
};

export type ComercialEventRecord = {
  id: string;
  type: ComercialEventType;
  title: string;
  description: string;
  severity: "info";
  entity_type: string;
  entity_id: string;
  customer_code: string | null;
  payload: Record<string, unknown>;
  occurred_at: string;
  source: typeof COMERCIAL_EVENT_SOURCE;
  operation_id: string;
  actor: Record<string, string>;
};

/** Monta o evento (sem created_at, que é serverTimestamp na gravação). Recusa o que foge do contrato. */
export function buildComercialEvent<T extends ComercialEventType>(input: ComercialEventInput<T>): ComercialEventRecord {
  const type = input.type;
  if (!isComercialEventType(type)) throw new HttpsError("internal", `Tipo de evento desconhecido: ${String(type)}.`);
  if (input.actor.role === "cliente") {
    throw new HttpsError("permission-denied", "Evento do Comercial é sempre de alguém da equipe.");
  }
  const operationId = String(input.operation_id ?? "").trim();
  if (!operationId) throw new HttpsError("internal", `Evento ${type} sem a operação de origem.`);
  if (!id.safeParse(input.entity_id).success) {
    throw new HttpsError("internal", `Evento ${type} com entity_id fora do formato de id.`);
  }
  const payload = parsePayload(type, input.payload);
  const customerCode = input.customer_code === null ? null : String(input.customer_code ?? "").trim();
  if (customerCode === "" || (customerCode === null && !semClienteAceito(type, payload as Record<string, unknown>))) {
    throw new HttpsError("internal", `Evento ${type} sem customer_code.`);
  }
  const occurredAt = input.occurred_at ?? new Date().toISOString();
  if (!instante.safeParse(occurredAt).success) {
    throw new HttpsError("internal", `Evento ${type} com occurred_at fora do formato ISO em UTC (AAAA-MM-DDTHH:MM:SS.sssZ).`);
  }
  const { title, description } = templateText(type, payload);
  return {
    id: comercialEventId(operationId, input.suffix ?? type),
    type,
    title,
    description,
    severity: "info",
    entity_type: ENTITY_TYPES[type.split(".")[0]],
    entity_id: input.entity_id,
    customer_code: customerCode,
    payload: compactValue(payload) as Record<string, unknown>,
    occurred_at: occurredAt,
    source: COMERCIAL_EVENT_SOURCE,
    operation_id: operationId,
    actor: actorPayload(input.actor),
  };
}

/** Grava o evento na transação da operação. Id repetido derruba a transação (create). */
export function createComercialEvent<T extends ComercialEventType>(
  transaction: Transaction,
  db: Firestore,
  input: ComercialEventInput<T>,
): { id: string; type: ComercialEventType } {
  const event = buildComercialEvent(input);
  transaction.create(db.collection(EVENTS_COLLECTION).doc(event.id), {
    ...event,
    created_at: FieldValue.serverTimestamp(),
  });
  return { id: event.id, type: event.type };
}
