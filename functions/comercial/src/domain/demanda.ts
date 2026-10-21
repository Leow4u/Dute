import {
  CANAIS_DEMANDA,
  ENTRADAS_DEMANDA,
  ETAPAS_DEMANDA,
  STATUS_ORCAMENTO,
  TIPOS_DEMANDA,
  TIPOS_RV,
} from "./events.js";

/**
 * A Demanda no domínio (docs/plataforma/fase-6-comercial.md, "Decisões" e
 * "Etapas da demanda"; parte 9).
 *
 * - A Demanda é o serviço pedido, do e-mail à NF. Não tem preço: o preço
 *   mora em `quotes/{numero}`, com o mesmo número.
 * - Um número só por serviço, a partir de 10001, num contador lido e gravado
 *   na transação que cria a demanda (`demand_counters/geral`, campo
 *   `ultimo`). "10045" é a demanda e a RV 0 do orçamento; as revisões são
 *   "10045 – RV01", "10045 – RV02".
 * - A etapa sai da situação do orçamento (etapaDaDemanda); perda e
 *   cancelamento valem sobre ela.
 */

export {
  CANAIS_DEMANDA,
  ENTRADAS_DEMANDA,
  ETAPAS_DEMANDA,
  STATUS_ORCAMENTO,
  TIPOS_DEMANDA,
  TIPOS_RV,
};

export type EtapaDemanda = (typeof ETAPAS_DEMANDA)[number];
export type StatusOrcamento = (typeof STATUS_ORCAMENTO)[number];
export type TipoRv = (typeof TIPOS_RV)[number];
export type EntradaDemanda = (typeof ENTRADAS_DEMANDA)[number];
export type CanalDemanda = (typeof CANAIS_DEMANDA)[number];
export type TipoDemanda = (typeof TIPOS_DEMANDA)[number];

export const DEMANDS_COLLECTION = "demands";
export const DEMAND_COUNTERS_COLLECTION = "demand_counters";
export const DEMAND_COUNTER_ID = "geral";
export const DEMAND_SCHEMA_VERSION = 1;

/** O primeiro número: a faixa nova não colide com as séries antigas (até 4 dígitos, ou 105xxx e 106xxx). */
export const PRIMEIRO_NUMERO = 10001;
/** O maior número que cabe no formato dos eventos (até 8 algarismos). */
export const ULTIMO_NUMERO = 99_999_999;

/**
 * O próximo número a partir do que o contador guarda (o último usado). Sem
 * contador, ou com um valor abaixo da faixa nova, é 10001. Valor que não é
 * inteiro, negativo ou no fim da faixa para a criação: um contador quebrado
 * nunca vira número repetido.
 */
export function proximoNumero(ultimo: unknown): string {
  if (ultimo === undefined || ultimo === null) return String(PRIMEIRO_NUMERO);
  if (typeof ultimo !== "number" || !Number.isSafeInteger(ultimo) || ultimo < 0) {
    throw new Error(`O contador de demandas está com um valor inválido (${JSON.stringify(ultimo) ?? String(ultimo)}).`);
  }
  if (ultimo >= ULTIMO_NUMERO) {
    throw new Error(`O contador de demandas chegou ao fim da faixa (${ultimo}).`);
  }
  return String(Math.max(ultimo + 1, PRIMEIRO_NUMERO));
}

/** "10045" na RV 0; "10045 – RV01" em diante, como o cliente cita no pedido e no aceite. */
export function rotuloDoOrcamento(numero: string, rv: number): string {
  return rv === 0 ? numero : `${numero} – RV${String(rv).padStart(2, "0")}`;
}

function preenchido(valor: unknown): boolean {
  return valor !== undefined && valor !== null && valor !== false;
}

/**
 * A etapa da demanda a partir da demanda e do orçamento (a RV em curso).
 *
 * - Perda e cancelamento valem sobre o orçamento.
 * - Proposta: rascunho é "em montagem", para aprovar, aprovado é "para
 *   enviar", enviado é "aguardando cliente".
 * - Aditivo e execução enviados esperam a validação do cliente ("aguardando
 *   autorização"); a RV de execução em rascunho é "execução a orçar".
 *
 * As etapas depois do fechamento (para planejar, a faturar) entram com o
 * resultado do orçamento, na parte 10.
 */
export function etapaDaDemanda(
  demanda: { perda?: unknown; cancelamento?: unknown },
  orcamento: { status: string; tipo_rv: string } | null,
): EtapaDemanda {
  if (preenchido(demanda.cancelamento)) return "cancelada";
  if (preenchido(demanda.perda)) return "perdida";
  if (!orcamento) return "em_montagem";
  if (!(STATUS_ORCAMENTO as readonly string[]).includes(orcamento.status)) {
    throw new Error(`Situação do orçamento desconhecida: ${orcamento.status}.`);
  }
  if (!(TIPOS_RV as readonly string[]).includes(orcamento.tipo_rv)) {
    throw new Error(`Tipo de RV desconhecido: ${orcamento.tipo_rv}.`);
  }
  const status = orcamento.status as StatusOrcamento;
  const tipo = orcamento.tipo_rv as TipoRv;
  switch (status) {
    case "rascunho":
      return tipo === "execucao" ? "execucao_a_orcar" : "em_montagem";
    case "para_aprovar":
      return "para_aprovar";
    case "aprovado":
      return "para_enviar";
    case "enviado":
      return tipo === "proposta" ? "aguardando_cliente" : "aguardando_autorizacao";
  }
}

const DIA_EM_SAO_PAULO = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** O dia (AAAA-MM-DD) em São Paulo: 29/06 às 23:30 ainda é 29/06, mesmo já sendo 30/06 em UTC. */
export function dataDeHoje(agora: Date): string {
  return DIA_EM_SAO_PAULO.format(agora);
}

/** Segundos inteiros desde um instante ISO; nunca negativo. Sem instante válido, undefined. */
export function segundosDesde(antes: unknown, agora: Date): number | undefined {
  if (typeof antes !== "string") return undefined;
  const inicio = Date.parse(antes);
  if (Number.isNaN(inicio)) return undefined;
  return Math.max(0, Math.floor((agora.getTime() - inicio) / 1000));
}
