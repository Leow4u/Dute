import { HttpsError } from "firebase-functions/https";
import { z } from "zod";

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

const DATA = /^\d{4}-\d{2}-\d{2}$/;

function invalid(message: string): never {
  throw new HttpsError("invalid-argument", message);
}

export function falha(message: string): never {
  throw new HttpsError("failed-precondition", message);
}

// --- Entrada ------------------------------------------------------------------------------

const data = (rotulo: string) =>
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
      .min(1, "Informe ao menos uma demanda.")
      .max(MAX_DEMANDAS_POR_NF, `Uma NF fecha até ${MAX_DEMANDAS_POR_NF} demandas.`)
      .refine((lista) => new Set(lista).size === lista.length, "A mesma demanda aparece duas vezes."),
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
  if (pedido.vencimento < pedido.nf.emitida_em) invalid("O vencimento vem depois da emissão.");
  return { ...pedido, nf: { ...pedido.nf, numero: pedido.nf.numero.replace(/^0+(?=\d)/, ""), serie: (pedido.nf.serie ?? "1").toUpperCase() } };
}

/** O id da fatura sai da série e do número da NF: a mesma NF não se registra duas vezes. */
export function faturaIdDaNf(serie: string, numero: string): string {
  return `fat_${digest({ serie: serie.toUpperCase(), numero: numero.replace(/^0+(?=\d)/, "") }, 24)}`;
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
    faturada: Boolean(dados.faturamento) || texto(dados.etapa) === "faturada",
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
export function problemaParaFaturar(demanda: DemandaParaFaturar): string | null {
  if (demanda.faturada) return `A demanda ${demanda.numero} já está faturada.`;
  if (demanda.etapa !== "a_faturar") return `A demanda ${demanda.numero} não está A faturar.`;
  if (demanda.medicao_pendente) return `A demanda ${demanda.numero} espera a medição aprovada.`;
  return null;
}

/**
 * As autorizações que a fatura cita para a demanda: as registradas, do mesmo
 * cliente. Recusa a demanda que o contrato manda autorizar e não tem
 * autorização registrada, e a autorização que cita outra RV da demanda.
 */
export function autorizacoesDaFatura(demanda: DemandaParaFaturar, lidas: ReadonlyMap<string, AutorizacaoLida>): string[] {
  const validas = demanda.autorizacao_ids.flatMap((id) => {
    const autorizacao = lidas.get(id);
    if (!autorizacao || !autorizacao.registrada || autorizacao.customer_code !== demanda.customer_code) return [];
    return [autorizacao];
  });
  if ((AUTORIZACOES_EXIGIDAS as readonly string[]).includes(demanda.autorizacao ?? "") && validas.length === 0) {
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
  nf: { numero: string; serie: string; emitida_em: string };
  vencimento: string;
  forma: FormaDePagamento;
  observacao: string | null;
  registrada_por: { uid: string; role: string };
  registrada_em: string;
  operation_id: string;
};

export const FATURA_SCHEMA_VERSION = 1;

/** O documento de `faturas/{id}`: emitida, com o valor de cada demanda e o total. */
export function documentoDaFatura(entrada: FaturaNova): Record<string, unknown> {
  const autorizacoes = [...new Set(entrada.demandas.flatMap((demanda) => demanda.autorizacao_ids))];
  return {
    id: entrada.id,
    customer_code: entrada.customer_code,
    customer_name: entrada.customer_name,
    status: "emitida",
    demandas: entrada.demandas,
    demanda_numeros: entrada.demandas.map((demanda) => demanda.numero),
    autorizacao_ids: autorizacoes,
    valor_cents: entrada.demandas.reduce((soma, demanda) => soma + demanda.valor_cents, 0),
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
