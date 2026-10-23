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
/** Segundos desde o passo anterior: um orçamento pode esperar meses. */
const segundos = z.number().int().min(0).max(1_000_000_000);
const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida (AAAA-MM-DD).");
const competencia = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Competência inválida (AAAA-MM).");
/** O que o contador das demandas guarda: o último número usado (até 8 algarismos). */
const numeroDoContador = z.number().int().min(0).max(99_999_999);

// --- Listas da Demanda e do orçamento (domain/demanda.ts e orcamento.ts) -------
// Ficam aqui porque vão nos eventos; os módulos de domínio reexportam.

export const ETAPAS_DEMANDA = [
  "em_montagem",
  "para_aprovar",
  "para_enviar",
  "aguardando_cliente",
  "para_planejar",
  "execucao_a_orcar",
  "aguardando_autorizacao",
  "a_faturar",
  // A NF registrada no Financeiro (functions/financeiro, Fase 4): só o Financeiro leva a demanda a esta etapa.
  "faturada",
  // A NF quitada (parte 4.2a): também só o Financeiro.
  "paga",
  "perdida",
  "cancelada",
] as const;
const etapa = z.enum(ETAPAS_DEMANDA);

export const TIPOS_RV = ["proposta", "aditivo", "execucao"] as const;
const tipoRv = z.enum(TIPOS_RV);

/** Como a demanda nasce: pelo Comercial (orçamento antes) ou direta (executada antes do orçamento). */
export const ENTRADAS_DEMANDA = ["comercial", "direta"] as const;
export const CANAIS_DEMANDA = ["email", "telefone", "whatsapp", "portal", "wms"] as const;
export const TIPOS_DEMANDA = ["planejada", "emergencial", "paraquedas"] as const;

/** Situação da RV em curso. */
export const STATUS_ORCAMENTO = ["rascunho", "para_aprovar", "aprovado", "enviado"] as const;
const statusOrcamento = z.enum(STATUS_ORCAMENTO);

/** De onde vem o preço de cada linha do orçamento. */
export const ORIGENS_LINHA = ["tabela", "alterado", "avulso", "ajuste"] as const;

/** O que a aprovação precisa ver marcado. */
export const MARCAS_ORCAMENTO = [
  "preco_alterado",
  "item_avulso",
  "ajuste",
  "tabela_vencida",
  "sem_tabela",
  "legado",
] as const;
const marcas = z.array(z.enum(MARCAS_ORCAMENTO)).max(MARCAS_ORCAMENTO.length);

/** Por que a demanda foi perdida (parte 10). Depois do fechamento, só "cancelado_cliente". */
export const MOTIVOS_PERDA = ["preco", "prazo", "desistencia", "sem_resposta", "cancelado_cliente", "outro"] as const;

/** Por que uma RV enviada ganha a RV seguinte ("Revisar", parte 10). */
export const MOTIVOS_REVISAO = ["pedido_cliente", "correcao", "execucao", "aditivo"] as const;
/** Os motivos da revisão e a reabertura da demanda perdida, que também abre RV nova. */
export const ORIGENS_REVISAO = [...MOTIVOS_REVISAO, "reabertura"] as const;

/**
 * Autorização de faturamento do cliente (parte 15; domain/autorizacao.ts).
 * O tipo do registro: "outro" cobre o "pode faturar" que não é pedido e
 * aceite, medição aprovada nem portal (no contrato, a lista tem "nenhuma").
 */
export const TIPOS_AUTORIZACAO_CLIENTE = ["pedido_aceite", "medicao_aprovada", "portal", "outro"] as const;
/** O que a autorização registrada pede para conferir (nunca o valor). */
export const MARCAS_AUTORIZACAO = ["valor_diverge", "tomador_outra_raiz", "rv_nao_validada"] as const;

export const ESTAGIOS_CADASTRO = ["prospect", "cliente"] as const;
export const REGIMES_COBRANCA = ["por_demanda", "medicao_mensal", "wms"] as const;
/** Tipos de aditivo do contrato (contracts/{id}/aditivos). */
export const TIPOS_ADITIVO = ["formalizacao", "prorrogacao", "preco", "escopo", "outro"] as const;
/** Como o cliente autoriza o faturamento (contrato e client_authorizations; contratos.ts reexporta). */
export const TIPOS_AUTORIZACAO = ["pedido_aceite", "medicao_aprovada", "portal", "nenhuma"] as const;

// --- Listas da medição mensal (parte 16a; domain/medicao.ts reexporta) ----------

/** O dia da execução para a tarifa: seg–sex, sábado, ou domingo e feriado. */
export const DIA_TIPOS = ["util", "sabado", "domingo_feriado"] as const;
/** A janela da execução para a tarifa. */
export const JANELAS = ["diurna", "noturna"] as const;
/** O que a linha da medição mostra marcado para conferir antes do envio. */
export const MARCAS_MEDICAO = ["dia_nao_bate_tarifa", "rota_fora_da_tabela", "sem_pedido_anexo"] as const;

/**
 * Variante da tabela de preço: na tabela é texto livre de letras ("Comercial",
 * "Noturna", "Fim de semana"); no evento vai normalizada (normalizarVariante
 * em tabelas.ts: "fim_de_semana"), como código, sem algarismo.
 */
const variante = codigo;

/** Quantas linhas de cada origem (nunca o preço nem o total delas). */
const linhasPorOrigem = z
  .object({ tabela: contagem, alterado: contagem, avulso: contagem, ajuste: contagem })
  .strict();

/**
 * Um passo do orçamento: número, RV e edição; a situação e a etapa da demanda
 * antes e depois, os segundos desde o passo anterior, as linhas por origem e
 * as marcas. Nunca valor.
 */
const quoteStep = z
  .object({
    numero,
    rv,
    edicao,
    status_antes: statusOrcamento.optional(),
    status_depois: statusOrcamento.optional(),
    etapa_antes: etapa.optional(),
    etapa_depois: etapa.optional(),
    segundos_desde_anterior: segundos.optional(),
    linhas: linhasPorOrigem.optional(),
    marcas: marcas.optional(),
  })
  .strict();

// --- Payload de cada tipo -----------------------------------------------------

export const COMERCIAL_EVENT_PAYLOADS = {
  "demand.created": z
    .object({
      numero,
      entrada: z.enum(ENTRADAS_DEMANDA).optional(),
      canal: z.enum(CANAIS_DEMANDA).optional(),
      tipo: z.enum(TIPOS_DEMANDA).optional(),
      cobranca: z.enum(REGIMES_COBRANCA).optional(),
      contrato_id: id.nullable().optional(),
      /** Demanda nova a partir de outra ("Duplicar"). */
      duplicado_de: numero.optional(),
    })
    .strict(),
  "demand.stage_changed": z
    .object({
      numero,
      etapa_antes: etapa,
      etapa_depois: etapa,
      segundos_desde_anterior: segundos.optional(),
    })
    .strict(),
  /** Fechado pelo cliente: a RV fechada vira o escopo; o prospect vira cliente na mesma operação. */
  "demand.won": z
    .object({
      numero,
      rv,
      virou_cliente: z.boolean().optional(),
      segundos_desde_anterior: segundos.optional(),
    })
    .strict(),
  "demand.lost": z
    .object({
      numero,
      rv,
      etapa_antes: etapa,
      motivo: z.enum(MOTIVOS_PERDA),
      segundos_desde_anterior: segundos.optional(),
    })
    .strict(),
  /** Perdida → a etapa de antes, com RV nova quando a atual já tinha sido enviada. */
  "demand.reopened": z
    .object({ numero, rv, etapa_antes: etapa, etapa_depois: etapa, rv_aberta: z.boolean() })
    .strict(),
  /** O serviço foi executado (o período), antes do orçamento da execução. */
  "demand.execution_registered": z
    .object({ numero, executado_de: data, executado_ate: data, direta: z.boolean().optional() })
    .strict(),

  "quote.created": z
    .object({
      numero,
      rv,
      tipo_rv: tipoRv,
      edicao,
      etapa: etapa.optional(),
      tabela_id: id.nullable().optional(),
      variante: variante.optional(),
      linhas: linhasPorOrigem.optional(),
      marcas: marcas.optional(),
      duplicado_de: numero.optional(),
      /** Na duplicação: linhas cujo preço unitário mudou com a tabela da data-base nova. */
      linhas_reprecificadas: contagem.optional(),
    })
    .strict(),
  "quote.updated": z
    .object({
      numero,
      rv,
      edicao_antes: edicao,
      edicao_depois: edicao,
      tabela_id: id.nullable().optional(),
      variante: variante.optional(),
      linhas: linhasPorOrigem.optional(),
      marcas: marcas.optional(),
      segundos_desde_anterior: segundos.optional(),
      /** A vistoria da Operação cujos itens a montagem carregou (parte 3.11e). */
      vistoria_os: z.string().regex(/^\d{5,8}-\d{2}$/).optional(),
    })
    .strict(),
  "quote.submitted": quoteStep,
  "quote.returned": quoteStep,
  "quote.approved": quoteStep,
  /** Aprovado → rascunho, na mesma RV ("Editar"). */
  "quote.edited": quoteStep,
  /** RV de execução enviada sem nova aprovação: só quantidades de linhas de tabela, sem passar o total fechado. */
  "quote.approval_waived": quoteStep,
  "quote.sent": quoteStep,
  "quote.revised": z
    .object({
      numero,
      rv,
      rv_anterior: rv,
      tipo_rv: tipoRv,
      motivo: z.enum(ORIGENS_REVISAO),
      edicao: edicao.optional(),
      etapa_antes: etapa.optional(),
      etapa_depois: etapa.optional(),
    })
    .strict(),
  /** A RV seguinte, ainda não enviada, descartada: o orçamento volta à RV enviada de onde ela saiu. */
  "quote.discarded": z
    .object({
      numero,
      rv,
      tipo_rv: tipoRv,
      rv_restaurada: rv,
      edicao,
      status_antes: statusOrcamento,
      etapa_antes: etapa,
      etapa_depois: etapa,
    })
    .strict(),
  /** O aditivo enviado, recusado pelo cliente: a demanda volta ao escopo fechado (rv_restaurada). */
  "quote.refused": z
    .object({
      numero,
      rv,
      tipo_rv: tipoRv,
      rv_restaurada: rv,
      etapa_antes: etapa,
      etapa_depois: etapa,
      segundos_desde_anterior: segundos.optional(),
    })
    .strict(),
  /** RV de execução ou de aditivo validada pelo cliente. */
  "quote.validated": z
    .object({
      numero,
      rv,
      tipo_rv: tipoRv,
      etapa_antes: etapa,
      etapa_depois: etapa,
      autorizacao_exigida: z.boolean(),
      medicao_pendente: z.boolean(),
      virou_cliente: z.boolean().optional(),
      /** A demanda presa à medição já aprovada: a validação fica com a autorização dela (parte 16a). */
      autorizacao_id: id.optional(),
    })
    .strict(),

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
  // A cobrança do WMS do cliente passa a tirar o preço desta tabela (Fase 7,
  // parte 7.3b): quantos itens foram ligados. Sem preço.
  "price_table.wms_linked": z
    .object({
      tabela_id: id,
      variante,
      itens: contagem,
    })
    .strict(),

  // Autorização de faturamento (parte 15): o id interno, o tipo, o contrato,
  // as demandas e as marcas. Nunca o pedido, o aceite, o tomador, o centro de
  // custo nem o valor. A da medição aprovada (tipo medicao_aprovada, parte
  // 16a) traz o id da medição e pode não ter demanda: a medição é que se
  // fatura, e as linhas sem demanda também entram nela.
  "client_authorization.recorded": z
    .object({
      autorizacao_id: id,
      tipo: z.enum(TIPOS_AUTORIZACAO_CLIENTE),
      contrato_id: id.nullable(),
      demandas: z.array(numero).max(200),
      /** Demandas que esta autorização levou a "a faturar" (as outras já estavam: complemento). */
      a_faturar: z.array(numero).max(200),
      marcas: z.array(z.enum(MARCAS_AUTORIZACAO)).max(MARCAS_AUTORIZACAO.length),
      medicao_id: id.optional(),
    })
    .strict(),
  /**
   * Cancelada: as demandas sem outra autorização voltam a aguardar (devolvidas).
   * A da medição aprovada (parte 15b) pode não ter demanda e traz a medição; as
   * demandas dela voltam a esperar a medição.
   */
  "client_authorization.cancelled": z
    .object({
      autorizacao_id: id,
      tipo: z.enum(TIPOS_AUTORIZACAO_CLIENTE),
      contrato_id: id.nullable(),
      demandas: z.array(numero).max(200),
      devolvidas: z.array(numero).max(200),
      marcas: z.array(z.enum(MARCAS_AUTORIZACAO)).max(MARCAS_AUTORIZACAO.length),
      medicao_id: id.optional(),
    })
    .strict(),

  // Medição mensal (parte 16a): ids, competência, contagens e marcas. Nunca o
  // valor, a OS do cliente, a área, os locais, a mercadoria nem a nota da
  // contestação.
  "medicao.created": z.object({ medicao_id: id, contrato_id: id, competencia, demandas: contagem }).strict(),
  "medicao.line_saved": z
    .object({
      medicao_id: id,
      competencia,
      linha_id: id,
      nova: z.boolean(),
      edicao,
      /** A demanda da linha, quando há. */
      demanda: numero.optional(),
      dia_tipo: z.enum(DIA_TIPOS),
      janela: z.enum(JANELAS),
      itens: contagem,
      marcas: z.array(z.enum(MARCAS_MEDICAO)).max(MARCAS_MEDICAO.length),
      /** Outras linhas cujo preço mudou ao precificar de novo (tabela carregada depois). */
      linhas_reprecificadas: contagem.optional(),
    })
    .strict(),
  "medicao.line_removed": z
    .object({ medicao_id: id, competencia, linha_id: id, edicao, demanda: numero.optional(), linhas_reprecificadas: contagem.optional() })
    .strict(),
  "medicao.sent": z
    .object({
      medicao_id: id,
      competencia,
      edicao: edicao.optional(),
      linhas: contagem.optional(),
      demandas: contagem.optional(),
      linhas_com_marca: contagem.optional(),
      linhas_reprecificadas: contagem.optional(),
      segundos_desde_anterior: segundos.optional(),
    })
    .strict(),
  "medicao.approved": z
    .object({
      medicao_id: id,
      competencia,
      edicao: edicao.optional(),
      autorizacao_id: id.optional(),
      /** Demandas ligadas à medição; as que foram a "a faturar"; as que ficaram para alguém resolver. */
      demandas: contagem.optional(),
      demandas_a_faturar: contagem.optional(),
      demandas_pendentes: contagem.optional(),
      segundos_desde_anterior: segundos.optional(),
    })
    .strict(),
  "medicao.contested": z
    .object({ medicao_id: id, competencia, edicao, segundos_desde_anterior: segundos.optional() })
    .strict(),
  "medicao.reopened": z.object({ medicao_id: id, competencia, edicao }).strict(),

  // Contador das demandas (parte 6.21 do plano de implantação): a ferramenta
  // da máquina do responsável grava o último número já usado, nunca abaixo
  // do que o banco já tem. Sem cliente.
  "demand_counter.set": z
    .object({
      anterior: numeroDoContador.nullable(),
      ultimo: numeroDoContador,
      maior_demanda: numeroDoContador.nullable(),
    })
    .strict(),
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
  demand_counter: "demand_counter",
};

/**
 * Evento sem cliente: a carga e o encerramento de tabela sem contrato (a
 * Padrão Dutelog, que é de todos) e o contador das demandas, que é de todas.
 * Tabela com contrato é de um cliente.
 */
function semClienteAceito(type: ComercialEventType, payload: Record<string, unknown>): boolean {
  if (type === "demand_counter.set") return true;
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
  faturada: "Faturada",
  paga: "Paga",
  perdida: "Perdida",
  cancelada: "Cancelada",
};

const TIPO_RV_ROTULO: Record<(typeof TIPOS_RV)[number], string> = {
  proposta: "proposta",
  aditivo: "aditivo",
  execucao: "execução",
};

const MOTIVO_PERDA_ROTULO: Record<(typeof MOTIVOS_PERDA)[number], string> = {
  preco: "preço",
  prazo: "prazo",
  desistencia: "desistência do cliente",
  sem_resposta: "sem resposta do cliente",
  cancelado_cliente: "cancelado pelo cliente",
  outro: "outro motivo",
};

const ORIGEM_REVISAO_ROTULO: Record<(typeof ORIGENS_REVISAO)[number], string> = {
  pedido_cliente: "pedido do cliente",
  correcao: "correção",
  execucao: "orçamento da execução",
  aditivo: "aditivo",
  reabertura: "reabertura da demanda",
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

/** "do orçamento original", "da RV01". */
function daRevisao(revisao: number): string {
  return revisao === 0 ? "do orçamento original" : `da RV${String(revisao).padStart(2, "0")}`;
}

/** "ao orçamento original", "à RV01". */
function aRevisao(revisao: number): string {
  return revisao === 0 ? "ao orçamento original" : `à RV${String(revisao).padStart(2, "0")}`;
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

const TIPO_AUTORIZACAO_ROTULO: Record<(typeof TIPOS_AUTORIZACAO_CLIENTE)[number], string> = {
  pedido_aceite: "Pedido e aceite",
  medicao_aprovada: "Medição aprovada",
  portal: "Portal do fornecedor",
  outro: "Outro registro do cliente",
};

const MARCA_AUTORIZACAO_ROTULO: Record<(typeof MARCAS_AUTORIZACAO)[number], string> = {
  valor_diverge: "valor diferente da soma das RVs",
  tomador_outra_raiz: "tomador de outra raiz de CNPJ",
  rv_nao_validada: "RV diferente da validada",
};

function demandasRotulo(quantidade: number): string {
  return `${quantidade} ${quantidade === 1 ? "demanda" : "demandas"}`;
}

function competenciaRotulo(value: string): string {
  const [ano, mes] = value.split("-");
  return `${mes}/${ano}`;
}

const DIA_TIPO_ROTULO: Record<(typeof DIA_TIPOS)[number], string> = {
  util: "seg–sex",
  sabado: "sábado",
  domingo_feriado: "domingo ou feriado",
};

const JANELA_ROTULO: Record<(typeof JANELAS)[number], string> = { diurna: "diurna", noturna: "noturna" };

const MARCA_MEDICAO_ROTULO: Record<(typeof MARCAS_MEDICAO)[number], string> = {
  dia_nao_bate_tarifa: "dia não bate com a tarifa",
  rota_fora_da_tabela: "rota fora da tabela",
  sem_pedido_anexo: "sem pedido anexo",
};

type Text = { title: string; description: string };
type Templates = { [T in ComercialEventType]: (payload: ComercialEventPayload<T>) => Text };

const TEMPLATES: Templates = {
  "demand.created": (p) => ({
    title: `Demanda ${p.numero} aberta`,
    description: p.duplicado_de ? `Demanda aberta no Comercial a partir da ${p.duplicado_de}.` : "Demanda aberta no Comercial.",
  }),
  "demand.stage_changed": (p) => ({
    title: `Demanda ${p.numero}: ${ETAPA_ROTULO[p.etapa_depois]}`,
    description: `Etapa: ${ETAPA_ROTULO[p.etapa_antes]} → ${ETAPA_ROTULO[p.etapa_depois]}.`,
  }),
  "demand.won": (p) => ({
    title: `Demanda ${p.numero} fechada`,
    description: `Fechada com ${revisaoRotulo(p.rv)}${p.virou_cliente ? "; o prospect virou cliente" : ""}.`,
  }),
  "demand.lost": (p) => ({
    title: `Demanda ${p.numero} perdida`,
    description: `Perdida na etapa ${ETAPA_ROTULO[p.etapa_antes]}. Motivo: ${MOTIVO_PERDA_ROTULO[p.motivo]}.`,
  }),
  "demand.reopened": (p) => ({
    title: `Demanda ${p.numero} reaberta`,
    description: p.rv_aberta
      ? `Volta para ${ETAPA_ROTULO[p.etapa_depois]}, com ${revisaoRotulo(p.rv)} aberta.`
      : `Volta para ${ETAPA_ROTULO[p.etapa_depois]}.`,
  }),
  "demand.execution_registered": (p) => ({
    title: `Demanda ${p.numero} executada`,
    description: `${p.direta ? "Demanda direta executada" : "Executada"} de ${dataRotulo(p.executado_de)} a ${dataRotulo(p.executado_ate)}.`,
  }),

  "quote.created": (p) => ({
    title: `${orcamento(p.numero, p.rv)} criado`,
    description: p.duplicado_de
      ? `Revisão de ${TIPO_RV_ROTULO[p.tipo_rv]} em montagem, duplicada do orçamento ${p.duplicado_de}.`
      : `Revisão de ${TIPO_RV_ROTULO[p.tipo_rv]} em montagem.`,
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
  "quote.edited": (p) => ({
    title: `${orcamento(p.numero, p.rv)} reaberto para edição`,
    description: `Edição ${p.edicao}; volta à montagem na mesma revisão.`,
  }),
  "quote.approval_waived": (p) => ({
    title: `${orcamento(p.numero, p.rv)} com aprovação dispensada`,
    description: `Edição ${p.edicao}.`,
  }),
  "quote.sent": (p) => ({ title: `${orcamento(p.numero, p.rv)} enviado ao cliente`, description: `Edição ${p.edicao}.` }),
  "quote.revised": (p) => ({
    title: `${orcamento(p.numero, p.rv)} aberto`,
    description: `Revisão de ${TIPO_RV_ROTULO[p.tipo_rv]} a partir ${daRevisao(p.rv_anterior)}. Motivo: ${ORIGEM_REVISAO_ROTULO[p.motivo]}.`,
  }),
  "quote.discarded": (p) => ({
    title: `${orcamento(p.numero, p.rv)} descartado`,
    description: `Revisão de ${TIPO_RV_ROTULO[p.tipo_rv]} descartada antes do envio; o orçamento volta ${aRevisao(p.rv_restaurada)}.`,
  }),
  "quote.refused": (p) => ({
    title: `${orcamento(p.numero, p.rv)} recusado pelo cliente`,
    description: `Revisão de ${TIPO_RV_ROTULO[p.tipo_rv]} recusada; a demanda volta ao escopo ${daRevisao(p.rv_restaurada)}.`,
  }),
  "quote.validated": (p) => ({
    title: `${orcamento(p.numero, p.rv)} validado pelo cliente`,
    description: `Revisão de ${TIPO_RV_ROTULO[p.tipo_rv]}; etapa: ${ETAPA_ROTULO[p.etapa_antes]} → ${ETAPA_ROTULO[p.etapa_depois]}${
      p.autorizacao_id ? "; com a autorização da medição aprovada" : ""
    }.`,
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
  "price_table.wms_linked": (p) => ({
    title: "Tabela ligada à armazenagem",
    description: `Variante ${varianteRotulo(p.variante)}: ${p.itens} ${p.itens === 1 ? "item da cobrança do WMS passa" : "itens da cobrança do WMS passam"} a tirar o preço desta tabela.`,
  }),

  "client_authorization.recorded": (p) => ({
    title: "Autorização do cliente registrada",
    description: [
      p.demandas.length === 0
        ? `${TIPO_AUTORIZACAO_ROTULO[p.tipo]}, sem demanda ligada`
        : `${TIPO_AUTORIZACAO_ROTULO[p.tipo]}, ligada a ${demandasRotulo(p.demandas.length)}`,
      p.a_faturar.length > 0 ? `${demandasRotulo(p.a_faturar.length)} a faturar` : p.demandas.length > 0 ? "complemento de outra autorização" : null,
      ...p.marcas.map((marca) => `conferir: ${MARCA_AUTORIZACAO_ROTULO[marca]}`),
    ]
      .filter(Boolean)
      .join("; ")
      .concat("."),
  }),
  "client_authorization.cancelled": (p) => ({
    title: "Autorização do cliente cancelada",
    description:
      p.tipo === "medicao_aprovada"
        ? p.demandas.length === 0
          ? `${TIPO_AUTORIZACAO_ROTULO[p.tipo]} cancelada, sem demanda ligada.`
          : `${TIPO_AUTORIZACAO_ROTULO[p.tipo]} desligada de ${demandasRotulo(p.demandas.length)}; ${p.devolvidas.length === 1 ? "1 volta" : `${p.devolvidas.length} voltam`} a esperar a medição.`
        : p.devolvidas.length > 0
        ? `${TIPO_AUTORIZACAO_ROTULO[p.tipo]} desligada de ${demandasRotulo(p.demandas.length)}; ${demandasRotulo(p.devolvidas.length)} volta${p.devolvidas.length === 1 ? "" : "m"} a aguardar autorização.`
        : `${TIPO_AUTORIZACAO_ROTULO[p.tipo]} desligada de ${demandasRotulo(p.demandas.length)}; todas seguem com outra autorização.`,
  }),

  "medicao.created": (p) => ({
    title: `Medição ${competenciaRotulo(p.competencia)} aberta`,
    description: `${p.demandas} ${p.demandas === 1 ? "demanda" : "demandas"} na medição.`,
  }),
  "medicao.line_saved": (p) => ({
    title: `Medição ${competenciaRotulo(p.competencia)}: linha ${p.nova ? "incluída" : "atualizada"}`,
    description: [
      `${p.itens} ${p.itens === 1 ? "item" : "itens"}, ${DIA_TIPO_ROTULO[p.dia_tipo]}, ${JANELA_ROTULO[p.janela]}`,
      p.demanda ? `demanda ${p.demanda}` : "sem demanda",
      p.marcas.length > 0 ? `marcas: ${p.marcas.map((marca) => MARCA_MEDICAO_ROTULO[marca]).join(", ")}` : null,
      `edição ${p.edicao}`,
    ]
      .filter(Boolean)
      .join("; ")
      .concat("."),
  }),
  "medicao.line_removed": (p) => ({
    title: `Medição ${competenciaRotulo(p.competencia)}: linha retirada`,
    description: `${p.demanda ? `Demanda ${p.demanda} fora da medição` : "Linha sem demanda"}; edição ${p.edicao}.`,
  }),
  "medicao.sent": (p) => ({
    title: `Medição ${competenciaRotulo(p.competencia)} enviada ao cliente`,
    description:
      p.linhas === undefined
        ? "Aguardando a aprovação do cliente."
        : `${p.linhas} ${p.linhas === 1 ? "linha" : "linhas"}; aguardando a aprovação do cliente.`,
  }),
  "medicao.approved": (p) => ({
    title: `Medição ${competenciaRotulo(p.competencia)} aprovada pelo cliente`,
    description:
      p.demandas === undefined
        ? "Medição aprovada."
        : `Medição aprovada; ${p.demandas_a_faturar ?? 0} de ${p.demandas} ${p.demandas === 1 ? "demanda" : "demandas"} a faturar.`,
  }),
  "medicao.contested": (p) => ({
    title: `Medição ${competenciaRotulo(p.competencia)} contestada pelo cliente`,
    description: `Edição ${p.edicao}; reabra para ajustar.`,
  }),
  "medicao.reopened": (p) => ({
    title: `Medição ${competenciaRotulo(p.competencia)} reaberta`,
    description: `Volta ao rascunho; edição ${p.edicao}.`,
  }),

  "demand_counter.set": (p) => ({
    title: "Contador das demandas ajustado",
    description: `A próxima demanda é a ${p.ultimo + 1}.`,
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
