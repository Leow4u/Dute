import { HttpsError } from "firebase-functions/https";
import { z } from "zod";

import { MAX_COMPETENCIAS_POR_NF, PERIODO_ID, type ArmazenagemNaFatura } from "./armazenagem.js";
import { emissaoReservada } from "./emissao-omie.js";
import { digest } from "./operations.js";

/**
 * A fatura da demanda (docs/plataforma/fase-4-financeiro.md, parte 4.1a): a
 * NF emitida fora do sistema é registrada aqui, com o número, a série, a
 * emissão, o vencimento e a forma de pagamento. Uma NF fecha uma ou mais
 * demandas do mesmo cliente, todas A faturar. O valor de cada demanda sai do
 * servidor, nunca do pedido: a RV validada pelo cliente (a que as
 * autorizações citam) ou, na medição mensal, a soma das linhas da demanda na
 * medição aprovada. A demanda que espera autorização (pedido e aceite,
 * portal ou medição aprovada) só fatura com a autorização registrada.
 *
 * Desde a parte 7.2a, a NF também fecha a armazenagem que o WMS emitiu
 * (armazenagem.ts), sozinha ou com as demandas do mesmo cliente.
 *
 * A medição aprovada (pergunta 64) entra como um item próprio, pelo total
 * aprovado: a NF dela leva as demandas da medição, cada uma pela soma das
 * linhas dela, e as linhas sem demanda (a equipe fixa do contrato misto),
 * somadas pelo serviço. A demanda da medição não fatura à parte.
 */

export const FATURAS_COLLECTION = "faturas";
export const DEMANDS_COLLECTION = "demands";
export const AUTHORIZATIONS_COLLECTION = "client_authorizations";
export const MEDICOES_COLLECTION = "medicoes";

export const FORMAS_DE_PAGAMENTO = ["boleto", "pix", "transferencia", "cartao", "dinheiro"] as const;
export type FormaDePagamento = (typeof FORMAS_DE_PAGAMENTO)[number];

/** Os tipos de autorização que o contrato exige antes de faturar (a validação guarda o tipo). */
export const AUTORIZACOES_EXIGIDAS = ["pedido_aceite", "portal", "medicao_aprovada"] as const;

/** Quantas demandas uma NF fecha de uma vez. */
export const MAX_DEMANDAS_POR_NF = 50;

/** Quantas medições uma NF fecha de uma vez. */
export const MAX_MEDICOES_POR_NF = 4;

/** Quantas demandas uma NF fecha ao todo, com as das medições (a medição tem até 100). */
export const MAX_DEMANDAS_NA_NF = 200;

/** O id da medição: o contrato e a competência (functions/comercial, medicaoId). */
export const MEDICAO_ID = /^[A-Za-z0-9_-]{1,120}_\d{4}-(?:0[1-9]|1[0-2])$/;

/** O serviço da linha sem demanda cujo item não tem serviço no catálogo. */
export const SEM_SERVICO = "Sem serviço";

const DATA = /^\d{4}-\d{2}-\d{2}$/;

function invalid(message: string): never {
  throw new HttpsError("invalid-argument", message);
}

export function falha(message: string): never {
  throw new HttpsError("failed-precondition", message);
}

// --- Entrada ------------------------------------------------------------------------------

/** Data AAAA-MM-DD que existe no calendário. */
export const data = (rotulo: string) =>
  z
    .string()
    .trim()
    .regex(DATA, `${rotulo}: use AAAA-MM-DD.`)
    .refine((valor) => !Number.isNaN(Date.parse(`${valor}T12:00:00Z`)) && new Date(`${valor}T12:00:00Z`).toISOString().slice(0, 10) === valor, `${rotulo}: a data não existe.`);

const RegistrarNf = z
  .object({
    idempotency_key: z.string().trim().min(1, "Informe a chave de idempotência.").max(200),
    demandas: z
      .array(z.string().trim().regex(/^\d{5,8}$/, "Número da demanda inválido."))
      .max(MAX_DEMANDAS_POR_NF, `Uma NF fecha até ${MAX_DEMANDAS_POR_NF} demandas.`)
      .refine((lista) => new Set(lista).size === lista.length, "A mesma demanda aparece duas vezes.")
      .default([]),
    /** As competências emitidas no WMS (o id de `billing_periods`). */
    armazenagem: z
      .array(z.string().trim().regex(PERIODO_ID, "Competência de armazenagem inválida."))
      .max(MAX_COMPETENCIAS_POR_NF, `Uma NF fecha até ${MAX_COMPETENCIAS_POR_NF} competências de armazenagem.`)
      .refine((lista) => new Set(lista).size === lista.length, "A mesma competência aparece duas vezes.")
      .default([]),
    /**
     * As medições aprovadas (`medicoes`, pergunta 64). Opcional e sem padrão:
     * o pedido sem medição tem o mesmo conteúdo de antes, e o recibo de
     * idempotência gravado antes continua valendo.
     */
    medicoes: z
      .array(z.string().trim().regex(MEDICAO_ID, "Medição inválida."))
      .max(MAX_MEDICOES_POR_NF, `Uma NF fecha até ${MAX_MEDICOES_POR_NF} medições.`)
      .refine((lista) => new Set(lista).size === lista.length, "A mesma medição aparece duas vezes.")
      .optional(),
    nf: z
      .object({
        numero: z.string().trim().regex(/^\d{1,15}$/, "Número da NF: só dígitos, até 15."),
        serie: z.string().trim().regex(/^[A-Za-z0-9]{1,5}$/, "Série da NF: até 5 letras ou dígitos.").optional(),
        emitida_em: data("Emissão"),
      })
      .strict(),
    vencimento: data("Vencimento"),
    forma: z.enum(FORMAS_DE_PAGAMENTO, { errorMap: () => ({ message: "Forma de pagamento: use boleto, pix, transferencia, cartao ou dinheiro." }) }),
    observacao: z.string().trim().max(300, "Use até 300 caracteres na observação.").optional(),
  })
  .strict();

export type PedidoDeNf = z.infer<typeof RegistrarNf>;

export function interpretarRegistro(dados: unknown): PedidoDeNf {
  const lido = RegistrarNf.safeParse(dados);
  if (!lido.success) {
    const issue = lido.error.issues[0];
    if (issue?.code === z.ZodIssueCode.unrecognized_keys) invalid(`Campo não aceito: ${issue.keys.join(", ")}.`);
    invalid(issue?.message ?? "Pedido inválido.");
  }
  const pedido = lido.data;
  if (!pedido.demandas.length && !pedido.armazenagem.length && !pedido.medicoes?.length) invalid("Informe ao menos uma demanda.");
  if (pedido.vencimento < pedido.nf.emitida_em) invalid("O vencimento vem depois da emissão.");
  return { ...pedido, nf: { ...pedido.nf, numero: pedido.nf.numero.replace(/^0+(?=\d)/, ""), serie: (pedido.nf.serie ?? "1").toUpperCase() } };
}

/**
 * O pedido da emissão da NFS-e pela Omie (parte 7.4c): o do `registerNf` sem
 * a NF, que é a Omie que numera. A emissão é hoje, então o vencimento é de
 * hoje em diante.
 */
const EmitirPelaOmie = RegistrarNf.omit({ nf: true });

export type PedidoDeEmissao = z.infer<typeof EmitirPelaOmie>;

export function interpretarEmissao(dados: unknown, hoje: string): PedidoDeEmissao {
  const lido = EmitirPelaOmie.safeParse(dados);
  if (!lido.success) {
    const issue = lido.error.issues[0];
    if (issue?.code === z.ZodIssueCode.unrecognized_keys) invalid(`Campo não aceito: ${issue.keys.join(", ")}.`);
    invalid(issue?.message ?? "Pedido inválido.");
  }
  const pedido = lido.data;
  if (!pedido.demandas.length && !pedido.armazenagem.length && !pedido.medicoes?.length) invalid("Informe ao menos uma demanda.");
  if (pedido.vencimento < hoje) invalid("O vencimento vem de hoje em diante: a NFS-e sai hoje.");
  return pedido;
}

/** O id da fatura sai da série e do número da NF: a mesma NF não se registra duas vezes. */
export function faturaIdDaNf(serie: string, numero: string): string {
  return `fat_${digest({ serie: serie.toUpperCase(), numero: numero.replace(/^0+(?=\d)/, "") }, 24)}`;
}

/**
 * O id da fatura da NFS-e autorizada pela Omie (parte 7.4): o número da nota,
 * à parte do registro à mão. O CT-e e a NF de fora seguem a numeração deles,
 * e o mesmo número com a série 1 não é a mesma nota.
 */
export function faturaIdDaNfse(numero: string): string {
  return `fat_${digest({ nfse_omie: numero.replace(/^0+(?=\d)/, "") }, 24)}`;
}

// --- Leitura ------------------------------------------------------------------------------

type Registro = Record<string, unknown>;

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

function inteiro(valor: unknown): number | null {
  return typeof valor === "number" && Number.isInteger(valor) ? valor : null;
}

export type DemandaParaFaturar = {
  numero: string;
  customer_code: string;
  customer_name: string | null;
  etapa: string;
  medicao_pendente: boolean;
  /** A RV validada pelo cliente; null sem validação (ou na medição). */
  rv: number | null;
  /** O tipo de autorização que a validação guardou (o que o contrato pede). */
  autorizacao: string | null;
  /** A medição aprovada que levou a demanda a A faturar; null fora da medição. */
  medicao_id: string | null;
  autorizacao_ids: string[];
  faturada: boolean;
  /** A emissão da NFS-e pela Omie que reservou a demanda (parte 7.4b); null sem reserva. */
  emissao_nf_id: string | null;
};

export function demandaLida(numero: string, dados: Registro): DemandaParaFaturar {
  const validacao = dados.validacao && typeof dados.validacao === "object" ? (dados.validacao as Registro) : {};
  const ids = Array.isArray(dados.autorizacao_ids) ? dados.autorizacao_ids : [];
  const antigo = typeof dados.autorizacao_id === "string" ? [dados.autorizacao_id] : [];
  return {
    numero,
    customer_code: texto(dados.customer_code),
    customer_name: texto(dados.customer_name) || null,
    etapa: texto(dados.etapa),
    medicao_pendente: dados.medicao_pendente === true,
    rv: inteiro(validacao.rv),
    autorizacao: texto(validacao.autorizacao) || null,
    medicao_id: texto(validacao.medicao_id) || texto(dados.medicao_id) || null,
    autorizacao_ids: [...new Set([...ids, ...antigo].filter((id): id is string => typeof id === "string" && id.length > 0))],
    faturada: Boolean(dados.faturamento) || texto(dados.etapa) === "faturada" || texto(dados.etapa) === "paga",
    emissao_nf_id: emissaoReservada(dados),
  };
}

export type AutorizacaoLida = {
  id: string;
  customer_code: string;
  registrada: boolean;
  /** A RV que a autorização cita para cada demanda. */
  rvs: ReadonlyMap<string, number>;
};

export function autorizacaoLida(id: string, dados: Registro): AutorizacaoLida {
  const status = texto(dados.status);
  const rvs = new Map<string, number>();
  for (const item of Array.isArray(dados.demandas) ? dados.demandas : []) {
    if (!item || typeof item !== "object") continue;
    const numero = texto((item as Registro).numero);
    const rv = inteiro((item as Registro).rv);
    if (numero && rv !== null) rvs.set(numero, rv);
  }
  return { id, customer_code: texto(dados.customer_code), registrada: status === "registrada" || status === "a_faturar", rvs };
}

// --- Regras -------------------------------------------------------------------------------

/** Por que a demanda não fatura agora, ou null. */
/**
 * Por que a demanda não fatura agora, ou null. `emissao` é a emissão da Omie
 * que está faturando (parte 7.4d): a reserva dela não conta contra ela mesma.
 */
export function problemaParaFaturar(demanda: DemandaParaFaturar, emissao: string | null = null): string | null {
  if (demanda.faturada) return `A demanda ${demanda.numero} já está faturada.`;
  if (demanda.emissao_nf_id && demanda.emissao_nf_id !== emissao) return `A demanda ${demanda.numero} está na emissão da NFS-e pela Omie.`;
  if (demanda.etapa !== "a_faturar") return `A demanda ${demanda.numero} não está A faturar.`;
  if (demanda.medicao_pendente) return `A demanda ${demanda.numero} espera a medição aprovada.`;
  return null;
}

/**
 * A demanda espera a autorização registrada: o tipo que a validação guardou é
 * um dos que o contrato exige. A da medição vem com a medição aprovada: a
 * demanda por demanda, num contrato que autoriza pela medição, nunca entra em
 * medição, e a validação a leva direto a A faturar, sem autorização a esperar.
 */
export function autorizacaoExigida(demanda: Pick<DemandaParaFaturar, "autorizacao" | "medicao_id">): boolean {
  if (!(AUTORIZACOES_EXIGIDAS as readonly string[]).includes(demanda.autorizacao ?? "")) return false;
  return demanda.autorizacao !== "medicao_aprovada" || demanda.medicao_id !== null;
}

/**
 * As autorizações que a fatura cita para a demanda: as registradas, do mesmo
 * cliente. Recusa a demanda que espera autorização (autorizacaoExigida) e não
 * tem autorização registrada, e a autorização que cita outra RV da demanda.
 */
export function autorizacoesDaFatura(demanda: DemandaParaFaturar, lidas: ReadonlyMap<string, AutorizacaoLida>): string[] {
  const validas = demanda.autorizacao_ids.flatMap((id) => {
    const autorizacao = lidas.get(id);
    if (!autorizacao || !autorizacao.registrada || autorizacao.customer_code !== demanda.customer_code) return [];
    return [autorizacao];
  });
  if (autorizacaoExigida(demanda) && validas.length === 0) {
    falha(`A demanda ${demanda.numero} não tem autorização de faturamento registrada.`);
  }
  if (!demanda.medicao_id && demanda.rv !== null) {
    for (const autorizacao of validas) {
      const citada = autorizacao.rvs.get(demanda.numero);
      if (citada !== undefined && citada !== demanda.rv) {
        falha(`A autorização cita a RV ${citada} da demanda ${demanda.numero}; a validada pelo cliente é a RV ${demanda.rv}.`);
      }
    }
  }
  return validas.map((autorizacao) => autorizacao.id);
}

/** A soma das linhas da demanda na medição aprovada, em centavos. */
export function valorNaMedicao(numero: string, medicao: Registro | null): number {
  if (!medicao || texto(medicao.status) !== "aprovada") falha(`A medição da demanda ${numero} não está aprovada.`);
  const linhas = (Array.isArray(medicao.linhas) ? medicao.linhas : []).filter(
    (linha): linha is Registro => Boolean(linha) && typeof linha === "object" && texto((linha as Registro).demanda_numero) === numero,
  );
  if (!linhas.length) falha(`A medição aprovada não tem linha da demanda ${numero}.`);
  return linhas.reduce((soma, linha) => {
    const total = inteiro(linha.total_cents);
    if (total === null || total < 0) throw new HttpsError("failed-precondition", `A medição tem uma linha da demanda ${numero} sem valor.`);
    return soma + total;
  }, 0);
}

// --- A medição aprovada (pergunta 64) ------------------------------------------------------

/** "10/2026", pela competência no fim do id da medição (`{contrato}_{AAAA-MM}`). */
export function rotuloDaMedicao(medicaoId: string): string {
  const competencia = /_(\d{4})-(\d{2})$/.exec(medicaoId);
  return competencia ? `${competencia[2]}/${competencia[1]}` : medicaoId;
}

/** As linhas sem demanda, somadas pelo serviço dos itens (functions/comercial, ItemDaMedicao.servico). */
export type SemDemandaNaFatura = { servico: string; valor_cents: number };

export type MedicaoParaFaturar = {
  id: string;
  customer_code: string;
  contrato_id: string | null;
  competencia: string;
  status: string;
  /** A autorização que a aprovação criou (`aut_{medicao}`). */
  autorizacao_id: string;
  /** O total aprovado; null quando uma linha não tem valor ou os itens não somam a linha. */
  total_cents: number | null;
  /** As demandas das linhas, na ordem em que aparecem. */
  demandas: string[];
  sem_demanda: SemDemandaNaFatura[];
  /** A NF em que a medição já está; null fora de NF. */
  fatura_id: string | null;
  /** A emissão da NFS-e pela Omie que reservou a medição; null sem reserva. */
  emissao_nf_id: string | null;
};

function centavosDe(valor: unknown): number | null {
  const lido = inteiro(valor);
  return lido !== null && lido >= 0 && Number.isSafeInteger(lido) ? lido : null;
}

/**
 * A medição como o Financeiro lê de `medicoes/{id}`. As linhas são as que o
 * cliente aprovou: o total é a soma delas e confere com o gravado, e cada
 * linha sem demanda soma os itens dela. Qualquer valor fora disso deixa o
 * total null, e a medição não fatura.
 */
export function medicaoLida(id: string, dados: Registro): MedicaoParaFaturar {
  const linhas = (Array.isArray(dados.linhas) ? dados.linhas : []).map((linha): Registro => (linha && typeof linha === "object" ? (linha as Registro) : {}));
  const demandas: string[] = [];
  const porServico = new Map<string, number>();
  let soma: number | null = 0;
  for (const linha of linhas) {
    const total = centavosDe(linha.total_cents);
    if (total === null || soma === null) {
      soma = null;
      continue;
    }
    soma += total;
    const numero = texto(linha.demanda_numero);
    if (numero) {
      if (!demandas.includes(numero)) demandas.push(numero);
      continue;
    }
    const itens = (Array.isArray(linha.itens) ? linha.itens : []).map((item): Registro => (item && typeof item === "object" ? (item as Registro) : {}));
    const valores = itens.map((item) => centavosDe(item.total_cents));
    if (!itens.length || valores.some((valor) => valor === null) || valores.reduce<number>((total_, valor) => total_ + (valor ?? 0), 0) !== total) {
      soma = null;
      continue;
    }
    itens.forEach((item, indice) => {
      const servico = texto(item.servico) || SEM_SERVICO;
      porServico.set(servico, (porServico.get(servico) ?? 0) + (valores[indice] ?? 0));
    });
  }
  const gravado = centavosDe(dados.total_cents);
  const faturamento = dados.faturamento && typeof dados.faturamento === "object" ? (dados.faturamento as Registro) : {};
  return {
    id,
    customer_code: texto(dados.customer_code),
    contrato_id: texto(dados.contrato_id) || null,
    competencia: texto(dados.competencia) || id.slice(-7),
    status: texto(dados.status),
    autorizacao_id: texto(dados.autorizacao_id) || `aut_${id}`,
    total_cents: soma !== null && linhas.length > 0 && gravado === soma ? soma : null,
    demandas,
    sem_demanda: [...porServico.entries()].filter(([, valor]) => valor > 0).map(([servico, valor_cents]) => ({ servico, valor_cents })),
    fatura_id: texto(faturamento.fatura_id) || null,
    emissao_nf_id: emissaoReservada(dados),
  };
}

/** Por que a medição não entra na NF agora, ou null. `emissao` é a emissão da Omie que está faturando. */
export function problemaDaMedicao(medicao: MedicaoParaFaturar, emissao: string | null = null): string | null {
  const rotulo = `A medição de ${rotuloDaMedicao(medicao.id)}`;
  if (medicao.fatura_id) return `${rotulo} já está numa NF.`;
  if (medicao.emissao_nf_id && medicao.emissao_nf_id !== emissao) return `${rotulo} está na emissão da NFS-e pela Omie.`;
  if (medicao.status !== "aprovada") return `${rotulo} não está aprovada.`;
  if (medicao.total_cents === null) return `${rotulo} tem linha sem valor ou fora do total.`;
  if (!medicao.customer_code) return `${rotulo} não tem cliente.`;
  return null;
}

/** A medição como a fatura guarda: o total aprovado, as demandas dela (que estão em `demandas` da fatura) e as linhas sem demanda. */
export type MedicaoNaFatura = {
  medicao_id: string;
  contrato_id: string | null;
  competencia: string;
  autorizacao_id: string;
  valor_cents: number;
  demandas: string[];
  sem_demanda: SemDemandaNaFatura[];
};

export function medicaoNaFatura(medicao: MedicaoParaFaturar): MedicaoNaFatura {
  return {
    medicao_id: medicao.id,
    contrato_id: medicao.contrato_id,
    competencia: medicao.competencia,
    autorizacao_id: medicao.autorizacao_id,
    valor_cents: medicao.total_cents ?? 0,
    demandas: medicao.demandas,
    sem_demanda: medicao.sem_demanda,
  };
}

/** O que a medição soma à fatura além das demandas dela: as linhas sem demanda. */
export function valorSemDemanda(medicao: Pick<MedicaoNaFatura, "sem_demanda">): number {
  return medicao.sem_demanda.reduce((soma, linha) => soma + linha.valor_cents, 0);
}

/** O total da RV validada, em centavos. */
export function valorDaRv(demanda: Pick<DemandaParaFaturar, "numero" | "rv">, revisao: Registro | null): number {
  if (demanda.rv === null) falha(`A demanda ${demanda.numero} não tem a RV validada pelo cliente.`);
  const total = inteiro(revisao?.total_cents);
  if (total === null || total < 0) falha(`A RV ${demanda.rv} da demanda ${demanda.numero} não tem o total.`);
  return total;
}

export type DemandaNaFatura = {
  numero: string;
  rv: number | null;
  medicao_id: string | null;
  autorizacao_ids: string[];
  valor_cents: number;
};

export type FaturaNova = {
  id: string;
  customer_code: string;
  customer_name: string | null;
  demandas: DemandaNaFatura[];
  armazenagem: ArmazenagemNaFatura[];
  /** As medições aprovadas (pergunta 64); as demandas delas estão em `demandas`. */
  medicoes?: MedicaoNaFatura[];
  nf: { numero: string; serie: string; emitida_em: string };
  vencimento: string;
  forma: FormaDePagamento;
  observacao: string | null;
  registrada_por: { uid: string; role: string };
  registrada_em: string;
  operation_id: string;
};

export const FATURA_SCHEMA_VERSION = 1;

/**
 * O documento de `faturas/{id}`: emitida, com o valor de cada demanda, de
 * cada competência e o total. A medição soma ao total só as linhas sem
 * demanda: as demandas dela já estão em `demandas`, cada uma pelo valor dela.
 * Só a NF com medição ganha `medicoes` e `medicao_ids`.
 */
export function documentoDaFatura(entrada: FaturaNova): Record<string, unknown> {
  const medicoes = entrada.medicoes ?? [];
  const autorizacoes = [...new Set([...entrada.demandas.flatMap((demanda) => demanda.autorizacao_ids), ...medicoes.map((medicao) => medicao.autorizacao_id)])];
  const soma = (linhas: ReadonlyArray<{ valor_cents: number }>) => linhas.reduce((total, linha) => total + linha.valor_cents, 0);
  return {
    id: entrada.id,
    customer_code: entrada.customer_code,
    customer_name: entrada.customer_name,
    status: "emitida",
    demandas: entrada.demandas,
    demanda_numeros: entrada.demandas.map((demanda) => demanda.numero),
    armazenagem: entrada.armazenagem,
    periodo_ids: entrada.armazenagem.map((linha) => linha.periodo_id),
    ...(medicoes.length ? { medicoes, medicao_ids: medicoes.map((medicao) => medicao.medicao_id) } : {}),
    autorizacao_ids: autorizacoes,
    valor_cents: soma(entrada.demandas) + soma(entrada.armazenagem) + medicoes.reduce((total, medicao) => total + valorSemDemanda(medicao), 0),
    nf: entrada.nf,
    nf_chave: `${entrada.nf.serie}:${entrada.nf.numero}`,
    vencimento: entrada.vencimento,
    forma: entrada.forma,
    observacao: entrada.observacao,
    registrada_por: entrada.registrada_por,
    registrada_em: entrada.registrada_em,
    operation_id: entrada.operation_id,
    schema_version: FATURA_SCHEMA_VERSION,
  };
}
