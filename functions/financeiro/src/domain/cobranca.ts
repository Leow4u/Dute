import { HttpsError } from "firebase-functions/https";
import { z } from "zod";

import { FORMAS_DE_PAGAMENTO, data, falha } from "./fatura.js";
import { digest } from "./operations.js";

/**
 * A cobrança da fatura (docs/plataforma/fase-4-financeiro.md, parte 4.2a):
 * depois de registrada, a NF é enviada ao cliente, recebe pagamentos
 * (parciais ou o total) e, se o registro estiver errado e nada tiver sido
 * pago, é cancelada. Um pagamento lançado errado se estorna.
 *
 * - O saldo é o valor da fatura menos o recebido. O pagamento não passa do
 *   saldo; quitado, a fatura fica paga e as demandas dela também.
 * - Vencida não é status gravado: é a fatura com saldo e vencimento antes de
 *   hoje (a tela calcula).
 * - Cancelar devolve as demandas a A faturar, a armazenagem à fila (parte
 *   7.2a) e libera as autorizações (tira a NF de `nf_ids`). A mesma NF pode
 *   ser registrada de novo depois.
 */

export const PAGAMENTOS_COLLECTION = "pagamentos";

export const STATUS_DA_FATURA = ["emitida", "enviada", "paga", "cancelada"] as const;
export type StatusDaFatura = (typeof STATUS_DA_FATURA)[number];

/** Como a NF chegou ao cliente. */
export const MEIOS_DE_ENVIO = ["email", "portal_do_cliente", "correio", "em_maos"] as const;
export type MeioDeEnvio = (typeof MEIOS_DE_ENVIO)[number];

const FATURA_ID = /^fat_[a-f0-9]{24}$/;
const PAGAMENTO_ID = /^pag_[a-f0-9]{24}$/;

function invalid(message: string): never {
  throw new HttpsError("invalid-argument", message);
}

// --- Entrada ------------------------------------------------------------------------------

const base = {
  idempotency_key: z.string().trim().min(1, "Informe a chave de idempotência.").max(200),
  fatura_id: z.string().trim().regex(FATURA_ID, "Fatura inválida."),
};

/** Valor em reais, texto decimal com ponto e até 2 casas (o app converte a vírgula). */
const valor = z
  .string()
  .trim()
  .regex(/^\d{1,13}(?:\.\d{1,2})?$/, "Valor: decimal com ponto e até 2 casas (ex.: 1234.56).");

const motivo = z.string().trim().min(5, "Conte o motivo em ao menos 5 caracteres.").max(300, "Use até 300 caracteres no motivo.");

const AvancarFatura = z.discriminatedUnion("acao", [
  z.object({ acao: z.literal("send"), ...base, enviada_em: data("Envio"), meio: z.enum(MEIOS_DE_ENVIO, { errorMap: () => ({ message: "Meio de envio inválido." }) }) }).strict(),
  z
    .object({
      acao: z.literal("pay"),
      ...base,
      valor,
      recebido_em: data("Data do pagamento"),
      forma: z.enum(FORMAS_DE_PAGAMENTO, { errorMap: () => ({ message: "Forma de pagamento: use boleto, pix, transferencia, cartao ou dinheiro." }) }),
      observacao: z.string().trim().max(300, "Use até 300 caracteres na observação.").optional(),
    })
    .strict(),
  z.object({ acao: z.literal("reverse_payment"), ...base, pagamento_id: z.string().trim().regex(PAGAMENTO_ID, "Pagamento inválido."), motivo }).strict(),
  z.object({ acao: z.literal("cancel"), ...base, motivo }).strict(),
]);

export type PedidoDaFatura = z.infer<typeof AvancarFatura>;
export type AcaoDaFatura = PedidoDaFatura["acao"];

export function interpretarAvanco(dados: unknown): PedidoDaFatura {
  const lido = AvancarFatura.safeParse(dados);
  if (!lido.success) {
    const issue = lido.error.issues[0];
    if (issue?.code === z.ZodIssueCode.unrecognized_keys) invalid(`Campo não aceito: ${issue.keys.join(", ")}.`);
    if (issue?.code === z.ZodIssueCode.invalid_union_discriminator) invalid("Ação inválida: use send, pay, reverse_payment ou cancel.");
    invalid(issue?.message ?? "Pedido inválido.");
  }
  return lido.data;
}

/** Centavos do valor em texto ("1234.5" → 123450), sem float. */
export function centavosDoTexto(texto: string): number {
  const [inteiro, fracao = ""] = texto.split(".");
  return Number(inteiro) * 100 + Number(fracao.padEnd(2, "0"));
}

const REAIS = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function reais(centavos: number): string {
  return REAIS.format(centavos / 100);
}

/** Data AAAA-MM-DD como o Brasil lê. */
export function dataBr(dia: string): string {
  const [ano, mes, diaDoMes] = dia.split("-");
  return `${diaDoMes}/${mes}/${ano}`;
}

// --- Leitura ------------------------------------------------------------------------------

type Registro = Record<string, unknown>;

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

function centavos(valor: unknown): number {
  return typeof valor === "number" && Number.isSafeInteger(valor) && valor >= 0 ? valor : 0;
}

export type FaturaLida = {
  id: string;
  customer_code: string;
  status: StatusDaFatura;
  valor_cents: number;
  recebido_cents: number;
  emitida_em: string;
  vencimento: string;
  demanda_numeros: string[];
  /** As competências de armazenagem da NF (o id de `billing_periods`, parte 7.2a). */
  periodo_ids: string[];
  autorizacao_ids: string[];
  enviada: boolean;
};

export function faturaLida(id: string, dados: Registro): FaturaLida {
  const status = texto(dados.status);
  const nf = dados.nf && typeof dados.nf === "object" ? (dados.nf as Registro) : {};
  const lista = (valor: unknown) => (Array.isArray(valor) ? valor.filter((item): item is string => typeof item === "string" && item.length > 0) : []);
  return {
    id,
    customer_code: texto(dados.customer_code),
    status: (STATUS_DA_FATURA as readonly string[]).includes(status) ? (status as StatusDaFatura) : "emitida",
    valor_cents: centavos(dados.valor_cents),
    recebido_cents: centavos(dados.recebido_cents),
    emitida_em: texto(nf.emitida_em),
    vencimento: texto(dados.vencimento),
    demanda_numeros: lista(dados.demanda_numeros),
    periodo_ids: lista(dados.periodo_ids),
    autorizacao_ids: lista(dados.autorizacao_ids),
    enviada: Boolean(dados.enviada),
  };
}

export type PagamentoLido = { id: string; fatura_id: string; status: "registrado" | "estornado"; valor_cents: number };

export function pagamentoLido(id: string, dados: Registro): PagamentoLido {
  return {
    id,
    fatura_id: texto(dados.fatura_id),
    status: texto(dados.status) === "estornado" ? "estornado" : "registrado",
    valor_cents: centavos(dados.valor_cents),
  };
}

/** O id do pagamento sai da fatura e da operação que o registrou. */
export function pagamentoIdDaOperacao(faturaId: string, operationId: string): string {
  return `pag_${digest({ fatura: faturaId, operation: operationId }, 24)}`;
}

// --- Regras -------------------------------------------------------------------------------

export function saldoDaFatura(fatura: Pick<FaturaLida, "valor_cents" | "recebido_cents">): number {
  return Math.max(0, fatura.valor_cents - fatura.recebido_cents);
}

/** Datas de envio e de pagamento: nunca antes da emissão da NF, nunca depois de hoje. */
function conferirData(dia: string, fatura: FaturaLida, hoje: string, rotulo: string): void {
  if (dia > hoje) invalid(`${rotulo} ainda não chegou.`);
  if (fatura.emitida_em && dia < fatura.emitida_em) invalid(`${rotulo} vem antes da emissão da NF (${dataBr(fatura.emitida_em)}).`);
}

/** Enviar: só a emitida, ainda sem envio. */
export function conferirEnvio(fatura: FaturaLida, enviadaEm: string, hoje: string): void {
  if (fatura.status === "cancelada") falha("A NF está cancelada.");
  if (fatura.status === "paga") falha("A NF já está paga.");
  if (fatura.status === "enviada" || fatura.enviada) falha("A NF já foi enviada ao cliente.");
  conferirData(enviadaEm, fatura, hoje, "A data do envio");
}

export type ResultadoDoPagamento = { recebido_cents: number; saldo_cents: number; quitada: boolean; status: StatusDaFatura };

/** Pagar: a fatura emitida ou enviada, com saldo; o pagamento não passa do saldo. */
export function aplicarPagamento(fatura: FaturaLida, valorCents: number, recebidoEm: string, hoje: string): ResultadoDoPagamento {
  if (fatura.status === "cancelada") falha("A NF está cancelada.");
  const saldo = saldoDaFatura(fatura);
  if (fatura.status === "paga" || saldo === 0) falha("A NF já está paga.");
  if (valorCents <= 0) invalid("O valor do pagamento precisa ser maior que zero.");
  if (valorCents > saldo) invalid(`O pagamento passa do saldo da NF, de ${reais(saldo)}.`);
  conferirData(recebidoEm, fatura, hoje, "A data do pagamento");
  const recebido = fatura.recebido_cents + valorCents;
  const quitada = recebido === fatura.valor_cents;
  return { recebido_cents: recebido, saldo_cents: fatura.valor_cents - recebido, quitada, status: quitada ? "paga" : fatura.status };
}

/** Estornar: o pagamento registrado desta fatura; a paga volta a enviada (ou emitida). */
export function aplicarEstorno(fatura: FaturaLida, pagamento: PagamentoLido | null): ResultadoDoPagamento & { reaberta: boolean } {
  if (!pagamento || pagamento.fatura_id !== fatura.id) throw new HttpsError("not-found", "Pagamento não encontrado nesta NF.");
  if (pagamento.status === "estornado") falha("O pagamento já foi estornado.");
  if (fatura.status === "cancelada") falha("A NF está cancelada.");
  const recebido = Math.max(0, fatura.recebido_cents - pagamento.valor_cents);
  const status: StatusDaFatura = fatura.enviada ? "enviada" : "emitida";
  return { recebido_cents: recebido, saldo_cents: fatura.valor_cents - recebido, quitada: false, status, reaberta: fatura.status === "paga" };
}

/** Cancelar o registro: só sem pagamento. */
export function conferirCancelamento(fatura: FaturaLida): void {
  if (fatura.status === "cancelada") falha("A NF já está cancelada.");
  if (fatura.recebido_cents > 0 || fatura.status === "paga") falha("A NF tem pagamento registrado: estorne os pagamentos antes de cancelar.");
}

/** A demanda desta fatura, na etapa em que a cobrança espera encontrá-la. */
export function conferirDemandaDaFatura(numero: string, dados: Registro | null, faturaId: string, etapa: "faturada" | "paga"): void {
  if (!dados) throw new HttpsError("not-found", `Demanda ${numero} não encontrada.`);
  const faturamento = dados.faturamento && typeof dados.faturamento === "object" ? (dados.faturamento as Registro) : {};
  if (texto(faturamento.fatura_id) !== faturaId) falha(`A demanda ${numero} não está nesta NF.`);
  if (texto(dados.etapa) !== etapa) falha(`A demanda ${numero} não está ${etapa}.`);
}
