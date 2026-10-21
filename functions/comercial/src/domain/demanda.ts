import {
  CANAIS_DEMANDA,
  ENTRADAS_DEMANDA,
  ETAPAS_DEMANDA,
  MOTIVOS_PERDA,
  MOTIVOS_REVISAO,
  ORIGENS_REVISAO,
  STATUS_ORCAMENTO,
  TIPOS_DEMANDA,
  TIPOS_RV,
} from "./events.js";

/**
 * A Demanda no domínio (docs/plataforma/fase-6-comercial.md, "Decisões" e
 * "Etapas da demanda"; partes 9 e 10).
 *
 * - A Demanda é o serviço pedido, do e-mail à NF. Não tem preço: o preço
 *   mora em `quotes/{numero}`, com o mesmo número.
 * - Um número só por serviço, a partir de 10001, num contador lido e gravado
 *   na transação que cria a demanda (`demand_counters/geral`, campo
 *   `ultimo`). "10045" é a demanda e a RV 0 do orçamento; as revisões são
 *   "10045 – RV01", "10045 – RV02".
 * - A etapa sai da situação do orçamento e do que a demanda já registrou
 *   (fechamento, execução, validação; etapaDaDemanda); perda e cancelamento
 *   valem sobre ela.
 */

export {
  CANAIS_DEMANDA,
  ENTRADAS_DEMANDA,
  ETAPAS_DEMANDA,
  MOTIVOS_PERDA,
  MOTIVOS_REVISAO,
  ORIGENS_REVISAO,
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
export type MotivoPerda = (typeof MOTIVOS_PERDA)[number];
export type MotivoRevisao = (typeof MOTIVOS_REVISAO)[number];
export type OrigemRevisao = (typeof ORIGENS_REVISAO)[number];

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

/** As etapas que a validação do cliente leva: espera a autorização de faturamento, ou já pode faturar. */
export const ETAPAS_DA_VALIDACAO = ["aguardando_autorizacao", "a_faturar"] as const satisfies readonly EtapaDemanda[];
export type EtapaDaValidacao = (typeof ETAPAS_DA_VALIDACAO)[number];

/** De onde veio o escopo da demanda: o fechamento da proposta, ou o aditivo validado antes da execução. */
export const ORIGENS_DO_ESCOPO = ["fechamento", "aditivo"] as const;
export type OrigemDoEscopo = (typeof ORIGENS_DO_ESCOPO)[number];

/** O que a demanda já registrou e muda a etapa (partes 9 e 10). */
export type EstadoDaDemanda = {
  perda?: unknown;
  cancelamento?: unknown;
  /** A RV fechada pelo cliente (o escopo); null antes do fechamento. */
  escopo_rv?: unknown;
  /** De onde veio o escopo (ORIGENS_DO_ESCOPO). */
  escopo_origem?: unknown;
  /** Início da execução registrada; null antes dela. */
  executado_de?: unknown;
  /** A RV validada pelo cliente e a etapa a que a validação levou. */
  validacao?: unknown;
  /** As autorizações de faturamento registradas (e não canceladas) que cobrem a demanda (parte 15). */
  autorizacao_ids?: unknown;
};

/** As autorizações de faturamento ativas da demanda (ids de client_authorizations). */
export function autorizacoesDaDemanda(demanda: Pick<EstadoDaDemanda, "autorizacao_ids">): string[] {
  const ids = demanda.autorizacao_ids;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string" && id.length > 0) : [];
}

/** A RV fechada pelo cliente, ou null. */
export function rvFechada(demanda: Pick<EstadoDaDemanda, "escopo_rv">): number | null {
  return typeof demanda.escopo_rv === "number" && Number.isInteger(demanda.escopo_rv) ? demanda.escopo_rv : null;
}

/** O serviço já foi executado (registrado na demanda ou na demanda direta). */
export function demandaExecutada(demanda: Pick<EstadoDaDemanda, "executado_de">): boolean {
  return typeof demanda.executado_de === "string" && demanda.executado_de.length > 0;
}

/** A validação gravada (a RV e a etapa a que levou), ou null. */
export function validacaoDaDemanda(demanda: Pick<EstadoDaDemanda, "validacao">): { rv: number; etapa: EtapaDaValidacao } | null {
  const valor = demanda.validacao as { rv?: unknown; etapa?: unknown } | null | undefined;
  if (!valor || typeof valor.rv !== "number") return null;
  if (!(ETAPAS_DA_VALIDACAO as readonly unknown[]).includes(valor.etapa)) return null;
  return { rv: valor.rv, etapa: valor.etapa as EtapaDaValidacao };
}

/**
 * A etapa da demanda a partir da demanda e do orçamento (a RV em curso).
 *
 * - Perda e cancelamento valem sobre o orçamento.
 * - Rascunho é "em montagem" ("execução a orçar" na RV de execução), para
 *   aprovar é "para aprovar", aprovado é "para enviar".
 * - Enviado espera o cliente ("aguardando cliente"): a proposta, o fechamento;
 *   a RV de execução ou de aditivo, a validação.
 * - A RV enviada que o cliente fechou (o escopo) é "para planejar" e, depois
 *   da execução registrada, "execução a orçar".
 * - A RV validada pelo cliente leva à etapa gravada na validação: "aguardando
 *   autorização" ou "a faturar". Aguardando, com uma autorização de
 *   faturamento registrada (autorizacao_ids, parte 15), é "a faturar";
 *   cancelada a última, volta a aguardar.
 */
export function etapaDaDemanda(
  demanda: EstadoDaDemanda,
  orcamento: { status: string; tipo_rv: string; rv?: number } | null,
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
    case "enviado": {
      const rv = orcamento.rv;
      const validacao = validacaoDaDemanda(demanda);
      if (rv !== undefined && validacao?.rv === rv) {
        if (validacao.etapa === "aguardando_autorizacao" && autorizacoesDaDemanda(demanda).length > 0) return "a_faturar";
        return validacao.etapa;
      }
      if (rv !== undefined && rvFechada(demanda) === rv) {
        return demandaExecutada(demanda) ? "execucao_a_orcar" : "para_planejar";
      }
      return "aguardando_cliente";
    }
  }
}

// --- Perda e reabertura -------------------------------------------------------------------

/** As etapas de onde a demanda pode ser perdida: qualquer uma antes de faturar. */
export const ETAPAS_QUE_PERDEM = [
  "em_montagem",
  "para_aprovar",
  "para_enviar",
  "aguardando_cliente",
  "para_planejar",
  "execucao_a_orcar",
  "aguardando_autorizacao",
] as const satisfies readonly EtapaDemanda[];

const ETAPA_ROTULO: Record<EtapaDemanda, string> = {
  em_montagem: "em montagem",
  para_aprovar: "para aprovar",
  para_enviar: "para enviar",
  aguardando_cliente: "aguardando o cliente",
  para_planejar: "para planejar",
  execucao_a_orcar: "com a execução a orçar",
  aguardando_autorizacao: "aguardando autorização",
  a_faturar: "a faturar",
  perdida: "perdida",
  cancelada: "cancelada",
};

export function rotuloDaEtapa(etapa: EtapaDemanda): string {
  return ETAPA_ROTULO[etapa];
}

/**
 * O cliente já disse sim: fechou a proposta, ou o serviço já foi executado
 * (a demanda direta nasce executada). Daí em diante, perder é só
 * "cancelado_cliente".
 */
export function demandaComprometida(demanda: EstadoDaDemanda): boolean {
  return rvFechada(demanda) !== null || demandaExecutada(demanda) || validacaoDaDemanda(demanda) !== null;
}

/**
 * Por que a demanda não pode ser perdida com este motivo, ou null.
 * - De qualquer etapa antes de "a faturar".
 * - Depois do fechamento (ou da execução, na demanda direta), só
 *   "cancelado_cliente": preço e prazo já foram aceitos.
 * - "outro" pede uma nota.
 */
export function problemaDaPerda(
  motivo: MotivoPerda,
  demanda: EstadoDaDemanda & { etapa: EtapaDemanda },
  nota: string | null | undefined,
): string | null {
  if (!(ETAPAS_QUE_PERDEM as readonly string[]).includes(demanda.etapa)) {
    return `A demanda está ${ETAPA_ROTULO[demanda.etapa]}: só se perde antes de faturar.`;
  }
  if (demandaComprometida(demanda) && motivo !== "cancelado_cliente") {
    return "Depois do fechamento, a demanda só se perde por cancelamento do cliente (cancelado_cliente).";
  }
  if (motivo === "outro" && !(nota ?? "").trim()) return "Perda por outro motivo pede uma nota.";
  return null;
}

/**
 * A reabertura abre a RV seguinte? Sim quando a RV atual já foi enviada e o
 * cliente ainda não tinha dito sim (nem fechamento nem validação): a proposta
 * recusada volta a ser montada numa RV nova, porque a enviada não muda. A
 * demanda fechada (ou validada) e cancelada pelo cliente volta à etapa de
 * antes com a mesma RV: o escopo fechado continua valendo.
 */
export function reaberturaAbreRv(demanda: EstadoDaDemanda, orcamento: { status: string }): boolean {
  return orcamento.status === "enviado" && rvFechada(demanda) === null && validacaoDaDemanda(demanda) === null;
}

// --- Revisão (RV+1) -----------------------------------------------------------------------

/**
 * O tipo da RV seguinte: "execucao" e "aditivo" pelo motivo; o pedido do
 * cliente, a correção e a reabertura seguem o tipo da RV revisada (a
 * proposta continua proposta; a execução corrigida continua execução).
 */
export function tipoDaRevisao(motivo: OrigemRevisao, tipoAtual: TipoRv): TipoRv {
  if (motivo === "execucao") return "execucao";
  if (motivo === "aditivo") return "aditivo";
  return tipoAtual;
}

/**
 * Por que a RV enviada não pode ganhar a RV seguinte com este motivo, ou null.
 * - Pedido do cliente e correção: enquanto a RV enviada espera o cliente.
 * - Execução: depois da execução registrada, sobre a RV fechada ("execução a
 *   orçar").
 * - Aditivo: depois do fechamento, antes da execução orçada ("para planejar"
 *   ou "execução a orçar").
 */
export function problemaDaRevisao(motivo: MotivoRevisao, demanda: EstadoDaDemanda & { etapa: EtapaDemanda }): string | null {
  const etapa = demanda.etapa;
  if (etapa === "perdida" || etapa === "cancelada") return `A demanda está ${ETAPA_ROTULO[etapa]}: reabra antes de revisar.`;
  switch (motivo) {
    case "pedido_cliente":
    case "correcao":
      return etapa === "aguardando_cliente"
        ? null
        : `A demanda está ${ETAPA_ROTULO[etapa]}: pedido do cliente e correção valem enquanto a RV enviada espera o cliente.`;
    case "execucao":
      if (!demandaExecutada(demanda)) return "Registre a execução antes de orçá-la.";
      return etapa === "execucao_a_orcar" ? null : `A demanda está ${ETAPA_ROTULO[etapa]}: a RV de execução sai da execução a orçar.`;
    case "aditivo":
      if (rvFechada(demanda) === null) return "Aditivo é de demanda fechada: antes do fechamento, revise a proposta.";
      return etapa === "para_planejar" || etapa === "execucao_a_orcar"
        ? null
        : `A demanda está ${ETAPA_ROTULO[etapa]}: o aditivo sai de para planejar ou da execução a orçar.`;
  }
}

// --- Aditivo em negociação ----------------------------------------------------------------

/**
 * A RV em curso é um aditivo ainda sem o sim do cliente, sobre a demanda
 * fechada: em montagem, para aprovar, para enviar ou esperando o cliente. O
 * escopo fechado continua valendo enquanto ele é negociado.
 */
export function aditivoEmNegociacao(
  demanda: EstadoDaDemanda,
  orcamento: { tipo_rv: string; rv: number; status?: string },
): boolean {
  const fechada = rvFechada(demanda);
  return orcamento.tipo_rv === "aditivo" && fechada !== null && fechada !== orcamento.rv && validacaoDaDemanda(demanda) === null;
}

/**
 * Por que a execução não pode ser registrada agora, ou null. Na demanda
 * fechada e ainda não executada: em "para planejar" ou com um aditivo em
 * negociação (o serviço não espera o aditivo).
 */
export function problemaDoRegistroDaExecucao(
  demanda: EstadoDaDemanda & { etapa: EtapaDemanda },
  orcamento: { tipo_rv: string; rv: number; status?: string },
): string | null {
  if (demandaExecutada(demanda)) return "A execução desta demanda já foi registrada.";
  if (demanda.etapa === "para_planejar") return null;
  if (
    aditivoEmNegociacao(demanda, orcamento) &&
    (["em_montagem", "para_aprovar", "para_enviar", "aguardando_cliente"] as readonly string[]).includes(demanda.etapa)
  ) {
    return null;
  }
  return `A demanda está ${ETAPA_ROTULO[demanda.etapa]}: a execução se registra na demanda fechada, para planejar (ou com o aditivo em negociação).`;
}

/**
 * Por que o cliente não pode recusar a RV atual como aditivo, ou null: só o
 * aditivo enviado, esperando o cliente, sobre a demanda fechada. Recusado, a
 * demanda volta ao escopo fechado.
 */
export function problemaDaRecusaDoAditivo(
  demanda: EstadoDaDemanda & { etapa: EtapaDemanda },
  orcamento: { status: string; tipo_rv: string; rv: number },
): string | null {
  if (orcamento.tipo_rv !== "aditivo") return "Só o aditivo se recusa assim: a proposta recusada é perdida (lose); a execução se revisa.";
  if (orcamento.status !== "enviado" || demanda.etapa !== "aguardando_cliente") {
    return `A demanda está ${ETAPA_ROTULO[demanda.etapa]}: a recusa é do aditivo enviado, esperando o cliente. O que não foi enviado se descarta (discard).`;
  }
  if (!aditivoEmNegociacao(demanda, orcamento)) return "O aditivo já tem a resposta do cliente.";
  return null;
}

// --- Validação do cliente -----------------------------------------------------------------

/** Autorizações do contrato que fazem a demanda esperar o "pode faturar" do cliente (parte 15). */
export const AUTORIZACOES_QUE_ESPERAM = ["pedido_aceite", "portal"] as const;

/**
 * Para onde a validação do cliente leva a demanda.
 * - Contrato por medição mensal: "a faturar", marcada medicao_pendente (a
 *   medição é a parte 16).
 * - Contrato que exige autorização (pedido e aceite, ou portal): "aguardando
 *   autorização".
 * - Sem contrato, ou contrato sem autorização: "a faturar".
 */
export function destinoDaValidacao(entrada: { cobranca: unknown; autorizacao: unknown }): {
  etapa: EtapaDaValidacao;
  autorizacao_exigida: boolean;
  medicao_pendente: boolean;
} {
  if (entrada.cobranca === "medicao_mensal") return { etapa: "a_faturar", autorizacao_exigida: false, medicao_pendente: true };
  const exige = (AUTORIZACOES_QUE_ESPERAM as readonly unknown[]).includes(entrada.autorizacao);
  return { etapa: exige ? "aguardando_autorizacao" : "a_faturar", autorizacao_exigida: exige, medicao_pendente: false };
}

/**
 * Por que a RV atual não pode ser validada pelo cliente, ou null.
 * - A RV de execução ou de aditivo enviada, esperando o cliente; ou
 * - sem desvio: a RV fechada, depois da execução registrada ("execução a
 *   orçar"), validada como está, sem RV de execução.
 */
export function problemaDaValidacao(
  demanda: EstadoDaDemanda & { etapa: EtapaDemanda },
  orcamento: { status: string; tipo_rv: string; rv: number },
): string | null {
  if (orcamento.status !== "enviado") return "Só a RV enviada ao cliente é validada.";
  if (demanda.etapa === "aguardando_cliente") {
    return orcamento.tipo_rv === "proposta"
      ? "Proposta não se valida: o cliente fecha a proposta (close)."
      : null;
  }
  if (demanda.etapa === "execucao_a_orcar" && rvFechada(demanda) === orcamento.rv) return null;
  return `A demanda está ${ETAPA_ROTULO[demanda.etapa]}: a validação é da RV de execução ou de aditivo enviada, ou da RV fechada depois da execução.`;
}

// --- Escopo fechado -----------------------------------------------------------------------

/** Uma linha do escopo fechado: o que foi contratado, sem preço (vai para a OS). */
export type LinhaDoEscopo = {
  linha_id: string;
  lpu_item_id: string | null;
  codigo: string | null;
  item: string;
  descricao: string;
  servico: string | null;
  unidade: string | null;
  quantidade: string;
  origem_local: string | null;
  destino_local: string | null;
};

/**
 * O escopo da demanda a partir das linhas da RV fechada: item, quantidade e
 * locais, com o id da linha, sem preço, total, origem do preço nem motivo. O
 * ajuste é só dinheiro e fica de fora.
 */
export function escopoDasLinhas(
  linhas: readonly {
    id: string;
    origem: string;
    lpu_item_id?: string | null;
    codigo?: string | null;
    item?: string;
    descricao?: string;
    servico?: string | null;
    unidade?: string | null;
    quantidade: string;
    origem_local?: string | null;
    destino_local?: string | null;
  }[],
): LinhaDoEscopo[] {
  return linhas
    .filter((linha) => linha.origem !== "ajuste")
    .map((linha) => ({
      linha_id: linha.id,
      lpu_item_id: linha.lpu_item_id ?? null,
      codigo: linha.codigo ?? null,
      item: linha.item ?? linha.descricao ?? "",
      descricao: linha.descricao ?? linha.item ?? "",
      servico: linha.servico ?? null,
      unidade: linha.unidade ?? null,
      quantidade: linha.quantidade,
      origem_local: linha.origem_local ?? null,
      destino_local: linha.destino_local ?? null,
    }));
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
