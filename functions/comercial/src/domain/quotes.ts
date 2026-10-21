import { FieldValue, type DocumentReference, type DocumentSnapshot, type Firestore, type Transaction } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";
import { z } from "zod";

import {
  CUSTOMER_CONTACTS_COLLECTION,
  CUSTOMER_LOCATIONS_COLLECTION,
  cadastroPeloCodigo,
  idDeDocumentoValido,
  parseEntrada,
} from "./cadastro.js";
import { LPU_ITEMS_COLLECTION } from "./catalogo.js";
import { dataValida } from "./contratos-datas.js";
import { CONTRACTS_COLLECTION } from "./contratos.js";
import { cadastroArquivado } from "./customer-identity.js";
import {
  CANAIS_DEMANDA,
  DEMAND_COUNTERS_COLLECTION,
  DEMAND_COUNTER_ID,
  DEMAND_SCHEMA_VERSION,
  DEMANDS_COLLECTION,
  ENTRADAS_DEMANDA,
  MOTIVOS_REVISAO,
  TIPOS_DEMANDA,
  TIPOS_RV,
  dataDeHoje,
  etapaDaDemanda,
  problemaDaRevisao,
  proximoNumero,
  rotuloDoOrcamento,
  rvFechada,
  segundosDesde,
  tipoDaRevisao,
  type EtapaDemanda,
  type OrigemRevisao,
  type StatusOrcamento,
  type TipoRv,
} from "./demanda.js";
import { ErroDinheiro } from "./dinheiro.js";
import { REGIMES_COBRANCA, createComercialEvent, type ComercialEventType } from "./events.js";
import { digest, runIdempotent, type ComercialActor } from "./operations.js";
import {
  ACOES_ORCAMENTO,
  ErroOrcamento,
  ORIGENS_LINHA,
  QUOTE_SCHEMA_VERSION,
  QUOTES_COLLECTION,
  REVISOES_SUBCOLLECTION,
  STATUS_ORCAMENTO,
  TRANSICOES,
  VARIANTE_PADRAO,
  acaoJaFeita,
  dispensaDaAprovacao,
  entradaDaLinha,
  entradasNaTabelaNova,
  linhasPorOrigem,
  marcasDoOrcamento,
  mesmoPreco,
  pendenciasParaAprovar,
  precificarLinhas,
  problemaDaAcao,
  type AcaoOrcamento,
  type CausaDoAvulso,
  type Dispensa,
  type ItemDoCatalogo,
  type LinhaDoOrcamento,
  type LinhaEntrada,
  type MarcaOrcamento,
  type Precificado,
  type RvParaComparar,
} from "./orcamento.js";
import { canApproveQuote, comercialAccessProblem } from "./platform-roles.js";
import type { ComercialProfile } from "./profile.js";
import {
  ErroTabela,
  PRICE_TABLES_COLLECTION,
  STATUS_TABELA,
  conferirVariante,
  normalizarVariante,
  tabelaVigente,
  type PrecoDaTabela,
  type StatusTabela,
} from "./tabelas.js";

/**
 * Demanda e orçamento no backend (docs/plataforma/fase-6-comercial.md,
 * partes 9 e 10): as callables saveQuote (criar, orçar a execução da demanda
 * direta, editar o rascunho e duplicar) e advanceQuote (enviar para
 * aprovação, devolver, aprovar, editar o aprovado, enviar ao cliente, aprovar
 * e enviar, abrir a RV seguinte da enviada e descartá-la antes do envio). O
 * que o cliente responde e o que acontece com a demanda depois (fechar,
 * perder, reabrir, registrar a execução, validar, recusar o aditivo) fica em
 * demandas.ts (advanceDemand).
 *
 * - Até o envio, corrigir regrava a mesma RV (e `revisoes/{rv}` na
 *   aprovação). O envio congela `revisoes/{rv}` de vez; mudar depois é a RV
 *   seguinte ("revise"), com as mesmas linhas e ids, a mesma data-base e a
 *   mesma tabela. A edição continua subindo de uma RV para a outra. A RV
 *   seguinte ainda não enviada pode ser descartada ("discard"): o orçamento
 *   volta à RV enviada de onde ela saiu.
 * - A RV de execução guarda em `dispensa` se o envio dispensa a aprovação
 *   (calculada contra a RV fechada a cada passo); quem decide é o envio, que
 *   calcula de novo.
 *
 * - `demands/{numero}` não tem preço; `quotes/{numero}` tem, com o mesmo
 *   número, tirado de `demand_counters/geral` na transação que cria os dois.
 * - O servidor sempre recalcula preço e totais (orcamento.ts), pela tabela
 *   da data-base: a data de criação da RV 0, em São Paulo, que todas as RVs
 *   herdam. Editar depois da troca de tabela continua na tabela antiga.
 * - Toda escrita passa por runIdempotent (recibo em comercial_operations,
 *   chave `request_id` do app) com o evento na mesma transação, sem valor e
 *   sem nome, e-mail ou telefone. A situação e a edição que a tela viu são
 *   conferidas na transação, e todas as leituras vêm antes das escritas.
 */

export const SITUACAO_ROTULO: Record<StatusOrcamento, string> = {
  rascunho: "em rascunho",
  para_aprovar: "para aprovar",
  aprovado: "aprovado",
  enviado: "enviado",
};

// --- Entrada -------------------------------------------------------------------------

const requestId = z.string().trim().min(1, "Informe o request_id.").max(200, "request_id longo demais.");
const numeroServico = z.string().trim().regex(/^\d{5,8}$/, "Número do orçamento inválido.");
const idDocumento = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{1,120}$/, "Id inválido.")
  .refine(idDeDocumentoValido, "Id inválido.");
const codigoCliente = z.string().trim().min(1, "Informe o cliente.").max(200);
/** Texto opcional: vazio vira null (limpa o campo). */
const textoOpcional = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use até ${max} caracteres.`)
    .nullable()
    .optional()
    .transform((value) => (value === undefined ? undefined : value || null));
export const dataDaEntrada = z.string().trim().refine(dataValida, "Data inválida (AAAA-MM-DD).");
const data = dataDaEntrada;
/** Instante com data, hora e fuso (o app manda o de São Paulo: 2026-10-14T09:42-03:00); grava em UTC. */
const INSTANTE = /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
/** Instante informado pela pessoa (recebido em, fechado em, validado em), gravado em UTC. */
export function instanteComFuso(rotulo: string) {
  return z
    .string()
    .trim()
    .refine((value) => {
      const partes = INSTANTE.exec(value);
      return partes !== null && dataValida(partes[1]) && !Number.isNaN(Date.parse(value));
    }, `${rotulo}: informe a data e a hora, com o fuso (ex.: 2026-10-14T09:42-03:00).`)
    .transform((value) => new Date(value).toISOString());
}
const recebidaEm = instanteComFuso("Recebido em");
/** Folga do relógio do aparelho para instante informado no futuro (ou antes do envio). */
export const FOLGA_DO_RELOGIO_MS = 5 * 60 * 1000;
/** Link de e-mail ou de portal: só https:// (ou http://). */
export const linkDaEntrada = textoOpcional(2000).refine(
  (value) => value == null || /^https?:\/\/\S+$/i.test(value),
  "Link do e-mail inválido: use o endereço que começa com https://.",
);
const linkDoEmail = linkDaEntrada;
const numeroLegado = textoOpcional(40).refine(
  (value) => value == null || /^[A-Za-z0-9][A-Za-z0-9 ./-]{0,39}$/.test(value),
  "Número legado: letras, números, espaço, ponto, barra e hífen.",
);
const local = z
  .object({
    local_id: idDocumento.nullable().default(null),
    complemento: z.string().trim().max(200, "Use até 200 caracteres no complemento.").nullable().default(null),
  })
  .strict();
const execucao = z
  .object({
    datas: z.array(data).max(60, "Use até 60 datas.").default([]),
    de: data.nullable().default(null),
    ate: data.nullable().default(null),
    a_definir: z.boolean().default(false),
    visita_tecnica: data.nullable().default(null),
  })
  .strict()
  .refine((value) => value.de === null || value.ate === null || value.de <= value.ate, {
    message: "Execução: o fim vem antes do início.",
    path: ["ate"],
  });

/** A linha como o app manda: quantidade e item; preço e motivo só na alterada, na avulsa e no ajuste. */
const linhaEntrada = z
  .object({
    id: idDocumento.optional(),
    origem: z.enum(ORIGENS_LINHA),
    lpu_item_id: idDocumento.nullable().optional(),
    quantidade: z.string().trim().min(1, "Informe a quantidade.").max(40),
    preco: z.string().trim().max(40).nullable().optional(),
    motivo: z.string().trim().max(300, "Use até 300 caracteres no motivo.").nullable().optional(),
    descricao: z.string().trim().max(300, "Use até 300 caracteres na descrição.").nullable().optional(),
    item: z.string().trim().max(200).nullable().optional(),
    servico: z.string().trim().max(120).nullable().optional(),
    unidade: z.string().trim().max(20).nullable().optional(),
    origem_local: idDocumento.nullable().optional(),
    destino_local: idDocumento.nullable().optional(),
  })
  .strict();

const camposDaDemanda = {
  contrato_id: idDocumento.nullable().optional(),
  canal: z.enum(CANAIS_DEMANDA).optional(),
  tipo: z.enum(TIPOS_DEMANDA).optional(),
  titulo: textoOpcional(160),
  ref_cliente: textoOpcional(80),
  /** O "Para": um contato do cliente (customer_contacts). */
  contato_id: idDocumento.nullable().optional(),
  /** Quando o pedido chegou, com a hora: o tempo até o orçamento fica gravado desde o primeiro dia. */
  recebida_em: recebidaEm.optional(),
  email_assunto: textoOpcional(300),
  email_link: linkDoEmail,
  origem: local.nullable().optional(),
  destino: local.nullable().optional(),
  execucao: execucao.optional(),
  numero_legado: numeroLegado,
};

const camposDoOrcamento = {
  variante: z.string().max(60).optional(),
  linhas: z.array(linhaEntrada).max(300, "Use até 300 linhas.").optional(),
  condicoes: textoOpcional(4000),
  validade_dias: z.number().int("Validade em dias inteiros.").min(1).max(365).nullable().optional(),
  observacoes_internas: textoOpcional(4000),
};

const CriarOrcamento = z
  .object({
    action: z.literal("create"),
    request_id: requestId,
    customer_code: codigoCliente,
    entrada: z.enum(ENTRADAS_DEMANDA).optional(),
    ...camposDaDemanda,
    ...camposDoOrcamento,
  })
  .strict();

const AtualizarOrcamento = z
  .object({
    action: z.literal("update"),
    request_id: requestId,
    numero: numeroServico,
    expected_edicao: z.number().int().min(1),
    ...camposDaDemanda,
    ...camposDoOrcamento,
  })
  .strict();

const DuplicarOrcamento = z
  .object({ action: z.literal("duplicate"), request_id: requestId, origem_numero: numeroServico })
  .strict();

/**
 * "Orçar execução": a demanda direta (paraquedas), já executada, nasce com a
 * RV 0 de execução. Entrada e tipo são do servidor (direta, paraquedas); o
 * app manda o período executado.
 */
const { tipo: _tipoDaDemanda, ...camposDaDemandaDireta } = camposDaDemanda;
const CriarExecucao = z
  .object({
    action: z.literal("create_execution"),
    request_id: requestId,
    customer_code: codigoCliente,
    executado_de: data,
    executado_ate: data,
    ...camposDaDemandaDireta,
    ...camposDoOrcamento,
  })
  .strict();

export const SaveQuoteInput = z.discriminatedUnion("action", [CriarOrcamento, AtualizarOrcamento, DuplicarOrcamento, CriarExecucao]);
export type SaveQuoteInput = z.infer<typeof SaveQuoteInput>;

export const AdvanceQuoteInput = z
  .object({
    action: z.enum(ACOES_ORCAMENTO),
    request_id: requestId,
    numero: numeroServico,
    expected_status: z.enum(STATUS_ORCAMENTO),
    expected_edicao: z.number().int().min(1),
    nota: textoOpcional(1000),
    /** Só em "revise": por que a RV enviada ganha a seguinte. */
    motivo: z.enum(MOTIVOS_REVISAO).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.action === "revise" && !value.motivo) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["motivo"], message: `Revisar pede o motivo: ${MOTIVOS_REVISAO.join(", ")}.` });
    }
    if (value.action !== "revise" && value.motivo !== undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["motivo"], message: "O motivo é só da revisão (revise)." });
    }
  });
export type AdvanceQuoteInput = z.infer<typeof AdvanceQuoteInput>;

export type QuoteOptions = {
  /** O relógio da operação (os testes fixam a data-base). Padrão: agora. */
  agora?: () => Date;
};

export type SaveQuoteResult = {
  ok: true;
  numero: string;
  rotulo: string;
  rv: number;
  edicao: number;
  status: StatusOrcamento;
  etapa: EtapaDemanda;
  total_cents: number;
  events: string[];
};

export type AdvanceQuoteResult = {
  ok: true;
  numero: string;
  rotulo: string;
  rv: number;
  edicao: number;
  status: StatusOrcamento;
  etapa: EtapaDemanda;
  /** A ação já estava feita: só devolve o estado atual. */
  ja_feito: boolean;
  events: string[];
};

// --- Apoio ----------------------------------------------------------------------------

export type Dados = Record<string, unknown>;

export function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

export function textoOuNull(valor: unknown): string | null {
  return texto(valor) || null;
}

export function actorOf(caller: ComercialProfile): ComercialActor {
  const actor: ComercialActor = { uid: caller.uid, role: caller.role };
  if (caller.email) actor.email = caller.email;
  if (caller.name) actor.name = caller.name;
  return actor;
}

/** Os testes chamam as funções de domínio direto: a barreira do módulo vale aqui também. */
export function assertComercialCaller(caller: ComercialProfile): void {
  const problem = comercialAccessProblem(caller.role);
  if (problem) throw new HttpsError("permission-denied", problem);
}

/** Conteúdo da chamada para o hash do recibo: tudo menos a chave. */
export function conteudo<T extends { request_id: string }>(input: T): Omit<T, "request_id"> {
  const { request_id: _chave, ...rest } = input;
  return rest;
}

export function demandRef(db: Firestore, numero: string): DocumentReference {
  return db.collection(DEMANDS_COLLECTION).doc(numero);
}

export function quoteRef(db: Firestore, numero: string): DocumentReference {
  return db.collection(QUOTES_COLLECTION).doc(numero);
}

/** A RV congelada: `quotes/{numero}/revisoes/{rv}` ("0", "1", ...). */
export function revisaoRef(db: Firestore, numero: string, rv: number): DocumentReference {
  return quoteRef(db, numero).collection(REVISOES_SUBCOLLECTION).doc(String(rv));
}

/** Instante informado depois de agora (além da folga do relógio) é engano de digitação: recusa. */
export function conferirNaoFuturo(instante: string | undefined, agora: Date, rotulo: string): void {
  if (instante !== undefined && Date.parse(instante) > agora.getTime() + FOLGA_DO_RELOGIO_MS) {
    throw new HttpsError("invalid-argument", `${rotulo} não pode ser depois de agora.`);
  }
}

/** Período executado: início até o fim, e o fim até hoje (São Paulo). */
export function conferirPeriodoExecutado(de: string, ate: string, agora: Date): void {
  if (de > ate) throw new HttpsError("invalid-argument", "Executado: o fim vem antes do início.");
  if (ate > dataDeHoje(agora)) throw new HttpsError("invalid-argument", "Executado: o fim não pode ser depois de hoje.");
}

/** A demanda perdida ou cancelada não anda: reabra antes. */
export function conferirDemandaAtiva(demanda: Dados, numero: string): void {
  if (demanda.cancelamento) throw new HttpsError("failed-precondition", `A demanda ${numero} está cancelada.`);
  if (demanda.perda) {
    throw new HttpsError("failed-precondition", `A demanda ${numero} está perdida: reabra a demanda antes de mexer no orçamento.`);
  }
}

/** Os marcos da demanda com a etapa nova (e os marcos nomeados antes dela, como a aprovação dispensada). */
export function marcosComEtapa(
  demanda: Dados,
  etapa: EtapaDemanda | null,
  quem: { em: string; por_uid: string },
  nomeados: Array<Record<string, unknown>> = [],
): unknown[] {
  const marcos = Array.isArray(demanda.marcos) ? demanda.marcos : [];
  return [...marcos, ...nomeados, ...(etapa ? [{ etapa, em: quem.em, por_uid: quem.por_uid }] : [])];
}

function counterRef(db: Firestore): DocumentReference {
  return db.collection(DEMAND_COUNTERS_COLLECTION).doc(DEMAND_COUNTER_ID);
}

/** Erros do domínio puro viram erro da callable com mensagem em português (nunca "internal"). */
function comoErroDaCallable(error: unknown): never {
  if (error instanceof ErroOrcamento || error instanceof ErroDinheiro) {
    throw new HttpsError("invalid-argument", error.message);
  }
  if (error instanceof ErroTabela) {
    throw new HttpsError(error.codigo === "VARIANTE_INVALIDA" ? "invalid-argument" : "failed-precondition", error.message);
  }
  throw error;
}

function varianteConferida(valor: string | undefined): string {
  try {
    return conferirVariante(valor ?? VARIANTE_PADRAO);
  } catch (error) {
    comoErroDaCallable(error);
  }
}

/** "Recebido em" depois de agora (além da folga do relógio) é engano de digitação: recusa. */
function conferirRecebidaEm(recebida: string | undefined, agora: Date): void {
  conferirNaoFuturo(recebida, agora, "Recebido em");
}

function novoIdDeLinha(operationId: string, indice: number): string {
  return `ln_${digest({ operationId, indice }, 16)}`;
}

/** O próximo número, lido do contador na transação. */
async function reservarNumero(transaction: Transaction, db: Firestore): Promise<string> {
  const contador = await transaction.get(counterRef(db));
  let numero: string;
  try {
    numero = proximoNumero(contador.exists ? contador.get("ultimo") : undefined);
  } catch (error) {
    throw new HttpsError("failed-precondition", error instanceof Error ? error.message : String(error));
  }
  const [demanda, orcamento] = await transaction.getAll(demandRef(db, numero), quoteRef(db, numero));
  if (demanda.exists || orcamento.exists) {
    throw new HttpsError(
      "failed-precondition",
      `O número ${numero} já existe. Confira o contador demand_counters/${DEMAND_COUNTER_ID} antes de continuar.`,
    );
  }
  return numero;
}

type ContratoLido = { id: string; regime: (typeof REGIMES_COBRANCA)[number] };

async function lerContrato(
  transaction: Transaction,
  db: Firestore,
  contratoId: string | null,
  code: string,
): Promise<ContratoLido | null> {
  if (!contratoId) return null;
  const snapshot = await transaction.get(db.collection(CONTRACTS_COLLECTION).doc(contratoId));
  if (!snapshot.exists) throw new HttpsError("not-found", `Contrato ${contratoId} não encontrado.`);
  const dados = snapshot.data() ?? {};
  if (texto(dados.customer_code) !== code) {
    throw new HttpsError("failed-precondition", `O contrato ${contratoId} é de outro cliente.`);
  }
  if (dados.status === "encerrado") {
    throw new HttpsError(
      "failed-precondition",
      `O contrato ${contratoId} está encerrado. Sem contrato vigente, o orçamento sai sem contrato.`,
    );
  }
  const regime = (REGIMES_COBRANCA as readonly string[]).includes(String(dados.regime_padrao))
    ? (dados.regime_padrao as ContratoLido["regime"])
    : "por_demanda";
  return { id: snapshot.id, regime };
}

/**
 * O contrato do orçamento de origem, para a cópia: só se ainda vale (existe,
 * é do mesmo cliente e não está encerrado). Senão a cópia sai sem contrato
 * (por demanda), e o rascunho deixa escolher o contrato vigente.
 */
async function lerContratoDaOrigem(
  transaction: Transaction,
  db: Firestore,
  contratoId: string | null,
  code: string,
): Promise<ContratoLido | null> {
  if (!contratoId) return null;
  try {
    return await lerContrato(transaction, db, contratoId, code);
  } catch (error) {
    if (error instanceof HttpsError) return null;
    throw error;
  }
}

export type Solicitante = { contato_id: string; empresa: string | null };

/** O "Para": contato ativo do mesmo cliente, com a empresa dele (a gerenciadora). Sem contato, null. */
export async function lerContato(
  transaction: Transaction,
  db: Firestore,
  contatoId: string | null,
  code: string,
): Promise<Solicitante | null> {
  if (!contatoId) return null;
  const snapshot = await transaction.get(db.collection(CUSTOMER_CONTACTS_COLLECTION).doc(contatoId));
  if (!snapshot.exists) throw new HttpsError("not-found", `Contato ${contatoId} não encontrado.`);
  const dados = snapshot.data() ?? {};
  if (texto(dados.customer_code) !== code) {
    throw new HttpsError("failed-precondition", "O contato é de outro cliente. A mesma pessoa em outro cliente é outro contato.");
  }
  if (dados.ativo === false) throw new HttpsError("failed-precondition", "O contato está inativo.");
  return { contato_id: snapshot.id, empresa: textoOuNull(dados.empresa) };
}

type LocalEntrada = { local_id: string | null; complemento: string | null } | null | undefined;

function localDoc(valor: LocalEntrada): { local_id: string | null; complemento: string | null } | null {
  if (!valor) return null;
  return { local_id: valor.local_id ?? null, complemento: textoOuNull(valor.complemento) };
}

function idsDeLocais(locais: readonly LocalEntrada[], linhas: readonly LinhaEntrada[]): string[] {
  const ids = new Set<string>();
  for (const valor of locais) if (valor?.local_id) ids.add(valor.local_id);
  for (const linha of linhas) {
    if (linha.origem_local) ids.add(linha.origem_local);
    if (linha.destino_local) ids.add(linha.destino_local);
  }
  return [...ids];
}

/** Os locais citados existem e são do mesmo cliente. */
async function conferirLocais(transaction: Transaction, db: Firestore, ids: readonly string[], code: string): Promise<void> {
  if (ids.length === 0) return;
  const refs = ids.map((id) => db.collection(CUSTOMER_LOCATIONS_COLLECTION).doc(id));
  const snapshots = await transaction.getAll(...refs);
  for (const snapshot of snapshots) {
    if (!snapshot.exists) throw new HttpsError("not-found", `Local ${snapshot.id} não encontrado.`);
    if (texto(snapshot.get("customer_code")) !== code) {
      throw new HttpsError("failed-precondition", `O local ${snapshot.id} é de outro cliente.`);
    }
  }
}

export type TabelaLida = {
  id: string;
  nome: string | null;
  customer_code: string | null;
  contract_id: string | null;
  variante: string;
  vigente_de: string;
  vigente_ate: string | null;
  status: StatusTabela;
  condicoes: string | null;
  validade_dias: number | null;
  precos: Record<string, PrecoDaTabela>;
};

function tabelaDoDocumento(id: string, dados: Dados): TabelaLida {
  const status = (STATUS_TABELA as readonly string[]).includes(String(dados.status)) ? (dados.status as StatusTabela) : "ativa";
  const precos = dados.precos && typeof dados.precos === "object" ? (dados.precos as Record<string, PrecoDaTabela>) : {};
  return {
    id,
    nome: textoOuNull(dados.nome),
    customer_code: typeof dados.customer_code === "string" ? dados.customer_code : null,
    contract_id: typeof dados.contract_id === "string" ? dados.contract_id : null,
    variante: String(dados.variante ?? ""),
    vigente_de: String(dados.vigente_de ?? ""),
    vigente_ate: typeof dados.vigente_ate === "string" ? dados.vigente_ate : null,
    status,
    condicoes: textoOuNull(dados.condicoes),
    validade_dias: typeof dados.validade_dias === "number" ? dados.validade_dias : null,
    precos,
  };
}

/** As tabelas do cliente (de qualquer contrato e variante) e as da Padrão Dutelog (sem cliente). */
async function lerTabelas(transaction: Transaction, db: Firestore, code: string): Promise<TabelaLida[]> {
  const tables = db.collection(PRICE_TABLES_COLLECTION);
  const [doCliente, padrao] = await Promise.all([
    transaction.get(tables.where("customer_code", "==", code)),
    transaction.get(tables.where("customer_code", "==", null)),
  ]);
  return [...doCliente.docs, ...padrao.docs].map((doc) => tabelaDoDocumento(doc.id, doc.data()));
}

export async function lerTabelaPorId(transaction: Transaction, db: Firestore, id: string): Promise<TabelaLida> {
  const snapshot = await transaction.get(db.collection(PRICE_TABLES_COLLECTION).doc(id));
  if (!snapshot.exists) {
    throw new HttpsError("failed-precondition", `A tabela ${id} do orçamento não existe mais. Confira as tabelas antes de editar.`);
  }
  return tabelaDoDocumento(snapshot.id, snapshot.data() ?? {});
}

/** A tabela que vale na data-base para o cliente, o contrato e a variante (tabelas.ts), ou null. */
function escolherTabela(
  tabelas: readonly TabelaLida[],
  filtro: { customer_code: string; contrato_id: string | null; variante: string; data_base: string },
): TabelaLida | null {
  try {
    const escolhida = tabelaVigente(tabelas, {
      customer_code: filtro.customer_code,
      contract_id: filtro.contrato_id,
      variante: filtro.variante,
      data: filtro.data_base,
    });
    return escolhida?.tabela ?? null;
  } catch (error) {
    comoErroDaCallable(error);
  }
}

/** Os itens do catálogo que as linhas citam (os que não existem ficam de fora: a linha é recusada). */
async function lerItens(
  transaction: Transaction,
  db: Firestore,
  linhas: readonly { lpu_item_id?: string | null }[],
): Promise<Map<string, ItemDoCatalogo>> {
  const ids = [...new Set(linhas.map((linha) => linha.lpu_item_id).filter((id): id is string => Boolean(id)))];
  const itens = new Map<string, ItemDoCatalogo>();
  if (ids.length === 0) return itens;
  const snapshots = await transaction.getAll(...ids.map((id) => db.collection(LPU_ITEMS_COLLECTION).doc(id)));
  for (const snapshot of snapshots) {
    if (!snapshot.exists) continue;
    const dados = snapshot.data() ?? {};
    itens.set(snapshot.id, {
      id: snapshot.id,
      item: texto(dados.item),
      descricao: texto(dados.descricao),
      servico: texto(dados.servico),
      unidade: texto(dados.unidade),
      orcavel: dados.orcavel !== false,
      ativo: dados.ativo !== false,
    });
  }
  return itens;
}

function precificar(
  entradas: readonly LinhaEntrada[],
  tabela: TabelaLida | null,
  itens: ReadonlyMap<string, ItemDoCatalogo>,
  operationId: string,
  gravadas: readonly LinhaDoOrcamento[] = [],
): Precificado {
  // A linha já gravada com o mesmo item continua com ele, mesmo inativo depois (orcamento.ts, herdada).
  const herdadas = new Set(gravadas.filter((linha) => linha.lpu_item_id).map((linha) => `${linha.id}|${linha.lpu_item_id}`));
  try {
    return precificarLinhas(entradas, {
      tabela: tabela ? { id: tabela.id, precos: tabela.precos } : null,
      itens,
      novoId: (indice) => novoIdDeLinha(operationId, indice),
      herdada: (linhaId, lpuItemId) => linhaId !== undefined && herdadas.has(`${linhaId}|${lpuItemId}`),
    });
  } catch (error) {
    comoErroDaCallable(error);
  }
}

function tabelaDoOrcamento(tabela: TabelaLida | null, variante: string) {
  return { id: tabela?.id ?? null, nome: tabela?.nome ?? null, variante: tabela?.variante || variante };
}

export function linhasGravadas(valor: unknown): LinhaDoOrcamento[] {
  return Array.isArray(valor) ? (valor as LinhaDoOrcamento[]) : [];
}

const QUOTE_EVENT: Record<Exclude<AcaoOrcamento, "approve_and_send" | "revise" | "discard">, ComercialEventType> = {
  submit: "quote.submitted",
  return: "quote.returned",
  approve: "quote.approved",
  edit: "quote.edited",
  send: "quote.sent",
};

const ROTULO_DA_ACAO: Record<AcaoOrcamento, string> = {
  submit: "enviar para aprovação",
  return: "devolver",
  approve: "aprovar",
  edit: "editar",
  send: "enviar ao cliente",
  approve_and_send: "aprovar e enviar",
  revise: "revisar",
  discard: "descartar a RV",
};

// --- saveQuote: criar --------------------------------------------------------------------

type CriarInput = z.infer<typeof CriarOrcamento>;
type CriarExecucaoInput = z.infer<typeof CriarExecucao>;
type AtualizarInput = z.infer<typeof AtualizarOrcamento>;
type DuplicarInput = z.infer<typeof DuplicarOrcamento>;

/**
 * Cria a demanda e o orçamento juntos. "create" abre a proposta (RV 0 em
 * montagem). "create_execution" ("Orçar execução") abre a demanda direta,
 * tipo paraquedas, já executada: a RV 0 é de execução ("execução a orçar") e
 * a data-base é a da criação, como em toda RV 0.
 */
async function criar(db: Firestore, caller: ComercialProfile, input: CriarInput | CriarExecucaoInput, agora: () => Date) {
  const actor = actorOf(caller);
  const code = input.customer_code;
  const entradas: LinhaEntrada[] = input.linhas ?? [];
  if (entradas.some((linha) => linha.id)) {
    throw new HttpsError("invalid-argument", "Linha nova não leva id: o servidor dá o id da linha.");
  }
  const variante = varianteConferida(input.variante);
  const direta = input.action === "create_execution";
  if (input.action === "create" && input.entrada === "direta") {
    // A demanda direta já foi executada: não abre proposta, abre o orçamento da execução.
    throw new HttpsError(
      "failed-precondition",
      "Demanda direta (executada antes do orçamento) abre por \"Orçar execução\" (create_execution), com o período executado.",
    );
  }
  conferirRecebidaEm(input.recebida_em, agora());
  if (direta) conferirPeriodoExecutado(input.executado_de, input.executado_ate, agora());

  return runIdempotent<SaveQuoteResult>(
    db,
    {
      kind: direta ? "quote_create_execution" : "quote_create",
      scope: { acao: input.action },
      idempotency_key: input.request_id,
      input: conteudo(input),
      actor,
    },
    async (transaction, { operationId }) => {
      const instante = agora();
      const iso = instante.toISOString();
      const hoje = dataDeHoje(instante);

      // Leituras.
      const numero = await reservarNumero(transaction, db);
      const cadastro = await cadastroPeloCodigo(transaction, db, code);
      if (cadastroArquivado(cadastro.data)) {
        throw new HttpsError("failed-precondition", `O cadastro ${code} está arquivado.`);
      }
      const contrato = await lerContrato(transaction, db, input.contrato_id ?? null, code);
      const solicitante = await lerContato(transaction, db, input.contato_id ?? null, code);
      await conferirLocais(transaction, db, idsDeLocais([input.origem, input.destino], entradas), code);
      const tabelas = await lerTabelas(transaction, db, code);
      const itens = await lerItens(transaction, db, entradas);

      // Conta.
      const tabela = escolherTabela(tabelas, { customer_code: code, contrato_id: contrato?.id ?? null, variante, data_base: hoje });
      const precificado = precificar(entradas, tabela, itens, operationId);
      const numeroLegado = input.numero_legado ?? null;
      const marcas = marcasDoOrcamento({ linhas: precificado.linhas, tabela, data_base: hoje, numero_legado: numeroLegado });

      // Escritas.
      const executado = direta ? { de: input.executado_de, ate: input.executado_ate } : null;
      const demanda = {
        ...demandaNova({
          numero,
          code,
          cadastroNome: texto(cadastro.data.name) || code,
          contrato,
          entrada: direta ? "direta" : "comercial",
          canal: input.canal ?? "email",
          tipo: direta ? "paraquedas" : (input.tipo ?? "planejada"),
          titulo: input.titulo ?? null,
          ref_cliente: input.ref_cliente ?? null,
          solicitante,
          recebida_em: input.recebida_em ?? iso,
          email_assunto: input.email_assunto ?? null,
          email_link: input.email_link ?? null,
          origem: localDoc(input.origem),
          destino: localDoc(input.destino),
          execucao:
            input.execucao ??
            (executado ? { datas: [], de: executado.de, ate: executado.ate, a_definir: false, visita_tecnica: null } : null),
          numero_legado: numeroLegado,
          duplicado_de: null,
          executado,
          iso,
          uid: caller.uid,
        }),
        request_id: input.request_id,
        operation_id: operationId,
      };
      const quote = {
        ...orcamentoNovo({
          numero,
          code,
          hoje,
          tipo_rv: direta ? "execucao" : "proposta",
          tabela,
          variante,
          precificado,
          marcas,
          condicoes: input.condicoes !== undefined ? input.condicoes : (tabela?.condicoes ?? null),
          validade_dias: input.validade_dias !== undefined ? input.validade_dias : (tabela?.validade_dias ?? null),
          observacoes_internas: input.observacoes_internas ?? null,
          duplicado_de: null,
          iso,
          uid: caller.uid,
        }),
        // A RV de execução da demanda direta não tem RV fechada para comparar: passa pela aprovação.
        ...(direta
          ? {
              dispensa: dispensaDaAprovacao(
                { linhas: precificado.linhas, total_cents: precificado.total_cents, tabela_id: tabela?.id ?? null, tipo_rv: "execucao" },
                null,
              ),
            }
          : {}),
        request_id: input.request_id,
        operation_id: operationId,
      };
      transaction.set(counterRef(db), { ultimo: Number(numero), updated_at: FieldValue.serverTimestamp() }, { merge: true });
      transaction.create(demandRef(db, numero), demanda);
      transaction.create(quoteRef(db, numero), quote);
      const events = eventosDaCriacao(transaction, db, {
        operationId,
        actor,
        numero,
        code,
        demanda,
        tabela,
        variante,
        precificado,
        marcas,
        iso,
        executado: executado ?? undefined,
      });
      return {
        target_id: numero,
        result: {
          ok: true,
          numero,
          rotulo: rotuloDoOrcamento(numero, 0),
          rv: 0,
          edicao: 1,
          status: "rascunho",
          etapa: direta ? "execucao_a_orcar" : "em_montagem",
          total_cents: precificado.total_cents,
          events,
        },
      };
    },
  );
}

type DemandaNova = {
  numero: string;
  code: string;
  cadastroNome: string;
  contrato: ContratoLido | null;
  entrada: (typeof ENTRADAS_DEMANDA)[number];
  canal: (typeof CANAIS_DEMANDA)[number];
  tipo: (typeof TIPOS_DEMANDA)[number];
  titulo: string | null;
  ref_cliente: string | null;
  solicitante: Solicitante | null;
  recebida_em: string;
  email_assunto: string | null;
  email_link: string | null;
  origem: { local_id: string | null; complemento: string | null } | null;
  destino: { local_id: string | null; complemento: string | null } | null;
  execucao: { datas: string[]; de: string | null; ate: string | null; a_definir: boolean; visita_tecnica: string | null } | null;
  numero_legado: string | null;
  duplicado_de: string | null;
  /** Só na demanda direta: o período já executado. */
  executado?: { de: string; ate: string } | null;
  iso: string;
  uid: string;
};

/**
 * A demanda nova, sem preço, com os campos das próximas etapas vazios. A
 * direta (paraquedas) nasce executada, na execução a orçar.
 */
function demandaNova(dados: DemandaNova): Record<string, unknown> {
  const etapa: EtapaDemanda = dados.executado ? "execucao_a_orcar" : "em_montagem";
  return {
    numero: dados.numero,
    customer_code: dados.code,
    customer_name: dados.cadastroNome,
    contrato_id: dados.contrato?.id ?? null,
    cobranca: dados.contrato?.regime ?? "por_demanda",
    entrada: dados.entrada,
    canal: dados.canal,
    tipo: dados.tipo,
    titulo: dados.titulo,
    ref_cliente: dados.ref_cliente,
    solicitante: dados.solicitante,
    recebida_em: dados.recebida_em,
    email_assunto: dados.email_assunto,
    email_link: dados.email_link,
    origem: dados.origem,
    destino: dados.destino,
    execucao: dados.execucao ?? { datas: [], de: null, ate: null, a_definir: true, visita_tecnica: null },
    etapa,
    etapa_desde: dados.iso,
    marcos: [{ etapa, em: dados.iso, por_uid: dados.uid }],
    numero_legado: dados.numero_legado,
    duplicado_de: dados.duplicado_de,
    // Escopo fechado, execução, validação e perda (parte 10); OS (Fase 3); cancelamento (reservado).
    escopo_rv: null,
    escopo_origem: null,
    escopo: [],
    executado_de: dados.executado?.de ?? null,
    executado_ate: dados.executado?.ate ?? null,
    registro_execucao: null,
    aditivos_recusados: [],
    validacao: null,
    medicao_pendente: false,
    os_seq: 0,
    os_ids: [],
    perda: null,
    perdas_anteriores: [],
    cancelamento: null,
    schema_version: DEMAND_SCHEMA_VERSION,
    created_at: FieldValue.serverTimestamp(),
    created_by: dados.uid,
    updated_at: FieldValue.serverTimestamp(),
    updated_by: dados.uid,
  };
}

type OrcamentoNovo = {
  numero: string;
  code: string;
  hoje: string;
  tipo_rv?: TipoRv;
  tabela: TabelaLida | null;
  variante: string;
  precificado: Precificado;
  marcas: MarcaOrcamento[];
  condicoes: string | null;
  validade_dias: number | null;
  observacoes_internas: string | null;
  duplicado_de: string | null;
  iso: string;
  uid: string;
};

/** O orçamento novo, RV 0 em rascunho, com a data-base de hoje. */
function orcamentoNovo(dados: OrcamentoNovo): Record<string, unknown> {
  return {
    numero: dados.numero,
    rotulo: rotuloDoOrcamento(dados.numero, 0),
    customer_code: dados.code,
    rv: 0,
    tipo_rv: dados.tipo_rv ?? "proposta",
    status: "rascunho",
    edicao: 1,
    data_base: dados.hoje,
    tabela: tabelaDoOrcamento(dados.tabela, dados.variante),
    linhas: dados.precificado.linhas,
    subtotal_cents: dados.precificado.subtotal_cents,
    ajustes_cents: dados.precificado.ajustes_cents,
    total_cents: dados.precificado.total_cents,
    marcas: dados.marcas,
    condicoes: dados.condicoes,
    validade_dias: dados.validade_dias,
    observacoes_internas: dados.observacoes_internas,
    autor_uid: dados.uid,
    aprovacao: null,
    aprovacao_dispensada: null,
    devolucao: null,
    envio: null,
    revisao_de: null,
    duplicado_de: dados.duplicado_de,
    passo_em: dados.iso,
    schema_version: QUOTE_SCHEMA_VERSION,
    created_at: FieldValue.serverTimestamp(),
    updated_at: FieldValue.serverTimestamp(),
    updated_by: dados.uid,
  };
}

function eventosDaCriacao(
  transaction: Transaction,
  db: Firestore,
  dados: {
    operationId: string;
    actor: ComercialActor;
    numero: string;
    code: string;
    demanda: Record<string, unknown>;
    tabela: TabelaLida | null;
    variante: string;
    precificado: Precificado;
    marcas: MarcaOrcamento[];
    iso: string;
    duplicado_de?: string;
    linhas_reprecificadas?: number;
    /** Demanda direta: o período executado vai no evento de execução. */
    executado?: { de: string; ate: string };
  },
): string[] {
  const { demanda } = dados;
  const comum = { operation_id: dados.operationId, entity_id: dados.numero, customer_code: dados.code, actor: dados.actor, occurred_at: dados.iso };
  const tipoRv: TipoRv = dados.executado ? "execucao" : "proposta";
  const criada = createComercialEvent(transaction, db, {
    ...comum,
    type: "demand.created",
    payload: {
      numero: dados.numero,
      entrada: demanda.entrada as (typeof ENTRADAS_DEMANDA)[number],
      canal: demanda.canal as (typeof CANAIS_DEMANDA)[number],
      tipo: demanda.tipo as (typeof TIPOS_DEMANDA)[number],
      cobranca: demanda.cobranca as (typeof REGIMES_COBRANCA)[number],
      contrato_id: (demanda.contrato_id as string | null) ?? null,
      duplicado_de: dados.duplicado_de,
    },
  });
  const orcamento = createComercialEvent(transaction, db, {
    ...comum,
    type: "quote.created",
    payload: {
      numero: dados.numero,
      rv: 0,
      tipo_rv: tipoRv,
      edicao: 1,
      etapa: demanda.etapa as EtapaDemanda,
      tabela_id: dados.tabela?.id ?? null,
      variante: normalizarVariante(dados.tabela?.variante || dados.variante),
      linhas: dados.precificado.por_origem,
      marcas: dados.marcas,
      duplicado_de: dados.duplicado_de,
      linhas_reprecificadas: dados.linhas_reprecificadas,
    },
  });
  const ids = [criada.id, orcamento.id];
  if (dados.executado) {
    ids.push(
      createComercialEvent(transaction, db, {
        ...comum,
        type: "demand.execution_registered",
        payload: { numero: dados.numero, executado_de: dados.executado.de, executado_ate: dados.executado.ate, direta: true },
      }).id,
    );
  }
  return ids;
}

// --- saveQuote: editar o rascunho ------------------------------------------------------

async function atualizar(db: Firestore, caller: ComercialProfile, input: AtualizarInput, agora: () => Date) {
  const actor = actorOf(caller);
  const numero = input.numero;
  const variantePedida = input.variante === undefined ? undefined : varianteConferida(input.variante);
  conferirRecebidaEm(input.recebida_em, agora());

  return runIdempotent<SaveQuoteResult>(
    db,
    { kind: "quote_update", scope: { numero }, idempotency_key: input.request_id, input: conteudo(input), actor },
    async (transaction, { operationId }) => {
      const instante = agora();
      const iso = instante.toISOString();

      // Leituras.
      const [demandaSnap, quoteSnap] = await transaction.getAll(demandRef(db, numero), quoteRef(db, numero));
      if (!demandaSnap.exists || !quoteSnap.exists) throw new HttpsError("not-found", `Orçamento ${numero} não encontrado.`);
      const demanda = demandaSnap.data() ?? {};
      const quote = quoteSnap.data() ?? {};
      const dataBase = String(quote.data_base);
      const status = quote.status as StatusOrcamento;
      conferirDemandaAtiva(demanda, numero);
      if (status !== "rascunho") {
        throw new HttpsError(
          "failed-precondition",
          `O orçamento ${numero} está ${SITUACAO_ROTULO[status] ?? status}: só o rascunho se edita.`,
        );
      }
      const edicao = Number(quote.edicao);
      if (edicao !== input.expected_edicao) {
        throw new HttpsError(
          "failed-precondition",
          `O orçamento mudou desde que foi aberto (edição ${edicao}, não ${input.expected_edicao}). Abra de novo para não perder a mudança.`,
        );
      }
      const code = texto(demanda.customer_code);
      const contratoAntes = textoOuNull(demanda.contrato_id);
      const contratoId = input.contrato_id !== undefined ? input.contrato_id : contratoAntes;
      const contratoMudou = contratoId !== contratoAntes;
      const contrato = contratoMudou ? await lerContrato(transaction, db, contratoId, code) : null;
      const solicitante =
        input.contato_id !== undefined ? await lerContato(transaction, db, input.contato_id, code) : undefined;

      const linhasAntes = linhasGravadas(quote.linhas);
      const idsAntes = new Set(linhasAntes.map((linha) => linha.id));
      if (input.linhas) {
        for (const [indice, linha] of input.linhas.entries()) {
          if (linha.id && !idsAntes.has(linha.id)) {
            throw new HttpsError("invalid-argument", `Linha ${indice + 1}: a linha ${linha.id} não é deste orçamento.`);
          }
        }
      }
      await conferirLocais(transaction, db, idsDeLocais([input.origem, input.destino], input.linhas ?? []), code);

      const tabelaAntes = (quote.tabela ?? {}) as { id?: string | null; variante?: string };
      const varianteAntes = String(tabelaAntes.variante ?? VARIANTE_PADRAO);
      const variante = variantePedida ?? varianteAntes;
      const varianteMudou = normalizarVariante(variante) !== normalizarVariante(varianteAntes);
      const trocouTabela = contratoMudou || varianteMudou;
      let tabela: TabelaLida | null;
      if (trocouTabela) {
        const tabelas = await lerTabelas(transaction, db, code);
        tabela = escolherTabela(tabelas, { customer_code: code, contrato_id: contratoId, variante, data_base: dataBase });
      } else {
        tabela = tabelaAntes.id ? await lerTabelaPorId(transaction, db, tabelaAntes.id) : null;
      }
      const itens = await lerItens(transaction, db, input.linhas ?? linhasAntes);
      // As linhas que o app manda valem como vieram; as gravadas, numa tabela trocada, seguem a tabela nova sem recusar.
      const entradas: LinhaEntrada[] =
        input.linhas ??
        (trocouTabela
          ? entradasNaTabelaNova(linhasAntes, { tabela, itens }, {
              comId: true,
              motivo: (causa) => motivoDoAvulso(causa, { data_base: dataBase, preco: "preço anterior da linha" }),
            })
          : linhasAntes.map((linha) => entradaDaLinha(linha, true)));

      // A RV de execução compara com a RV fechada: a tela sabe se o envio dispensa a aprovação.
      const escopoRv = rvFechada(demanda);
      const fechadaSnap =
        quote.tipo_rv === "execucao" && escopoRv !== null ? await transaction.get(revisaoRef(db, numero, escopoRv)) : null;

      // Conta. O item da linha que já estava gravada com ele vale, mesmo inativo depois no catálogo.
      const precificado = precificar(entradas, tabela, itens, operationId, linhasAntes);
      // A marca da duplicação fica enquanto a linha mantém o preço.
      const anteriores = new Map(linhasAntes.map((linha) => [linha.id, linha]));
      for (const linha of precificado.linhas) {
        const antes = anteriores.get(linha.id);
        if (antes?.preco_anterior && antes.preco === linha.preco) linha.preco_anterior = antes.preco_anterior;
      }
      const numeroLegado = input.numero_legado !== undefined ? input.numero_legado : textoOuNull(demanda.numero_legado);
      const marcas = marcasDoOrcamento({ linhas: precificado.linhas, tabela, data_base: dataBase, numero_legado: numeroLegado });

      // Escritas.
      const demandaPatch: Record<string, unknown> = {};
      const copiar = (campo: keyof AtualizarInput & string, valor: unknown) => {
        if (valor !== undefined) demandaPatch[campo] = valor;
      };
      copiar("titulo", input.titulo);
      copiar("ref_cliente", input.ref_cliente);
      copiar("canal", input.canal);
      copiar("tipo", input.tipo);
      copiar("recebida_em", input.recebida_em);
      copiar("email_assunto", input.email_assunto);
      copiar("email_link", input.email_link);
      copiar("numero_legado", input.numero_legado);
      if (input.origem !== undefined) demandaPatch.origem = localDoc(input.origem);
      if (input.destino !== undefined) demandaPatch.destino = localDoc(input.destino);
      if (input.execucao !== undefined) demandaPatch.execucao = input.execucao;
      if (solicitante !== undefined) demandaPatch.solicitante = solicitante;
      if (contratoMudou) {
        demandaPatch.contrato_id = contrato?.id ?? null;
        demandaPatch.cobranca = contrato?.regime ?? "por_demanda";
      }
      transaction.update(demandRef(db, numero), {
        ...demandaPatch,
        updated_at: FieldValue.serverTimestamp(),
        updated_by: caller.uid,
      });

      const edicaoNova = edicao + 1;
      const quotePatch: Record<string, unknown> = {
        edicao: edicaoNova,
        tabela: tabelaDoOrcamento(tabela, variante),
        linhas: precificado.linhas,
        subtotal_cents: precificado.subtotal_cents,
        ajustes_cents: precificado.ajustes_cents,
        total_cents: precificado.total_cents,
        marcas,
        passo_em: iso,
        updated_at: FieldValue.serverTimestamp(),
        updated_by: caller.uid,
      };
      if (input.condicoes !== undefined) quotePatch.condicoes = input.condicoes;
      if (input.validade_dias !== undefined) quotePatch.validade_dias = input.validade_dias;
      if (input.observacoes_internas !== undefined) quotePatch.observacoes_internas = input.observacoes_internas;
      if (quote.tipo_rv === "execucao") {
        const fechada = fechadaSnap?.exists ? rvParaComparar(fechadaSnap.data() ?? {}) : null;
        quotePatch.dispensa = dispensaDaAprovacao(
          { linhas: precificado.linhas, total_cents: precificado.total_cents, tabela_id: tabela?.id ?? null, tipo_rv: "execucao" },
          fechada,
        );
      }
      transaction.update(quoteRef(db, numero), quotePatch);

      const rv = Number(quote.rv ?? 0);
      const event = createComercialEvent(transaction, db, {
        operation_id: operationId,
        type: "quote.updated",
        entity_id: numero,
        customer_code: code,
        actor,
        occurred_at: iso,
        payload: {
          numero,
          rv,
          edicao_antes: edicao,
          edicao_depois: edicaoNova,
          tabela_id: tabela?.id ?? null,
          variante: normalizarVariante(tabela?.variante || variante),
          linhas: precificado.por_origem,
          marcas,
          segundos_desde_anterior: segundosDesde(quote.passo_em, instante),
        },
      });
      return {
        target_id: numero,
        result: {
          ok: true,
          numero,
          rotulo: rotuloDoOrcamento(numero, rv),
          rv,
          edicao: edicaoNova,
          status: "rascunho",
          etapa: (demanda.etapa as EtapaDemanda) ?? "em_montagem",
          total_cents: precificado.total_cents,
          events: [event.id],
        },
      };
    },
  );
}

// --- saveQuote: duplicar -----------------------------------------------------------------

function dataRotulo(valor: string): string {
  const [ano, mes, dia] = valor.split("-");
  return `${dia}/${mes}/${ano}`;
}

/** O motivo da linha que virou avulsa na troca de tabela (fica na linha e na aprovação). */
function motivoDoAvulso(causa: CausaDoAvulso, contexto: { data_base: string; preco: string }): string {
  const fora = causa === "fora_da_tabela" ? "Fora da tabela vigente" : "Item fora do catálogo ativo";
  return `${fora} em ${dataRotulo(contexto.data_base)}; ${contexto.preco}.`;
}

async function duplicar(db: Firestore, caller: ComercialProfile, input: DuplicarInput, agora: () => Date) {
  const actor = actorOf(caller);
  const origemNumero = input.origem_numero;

  return runIdempotent<SaveQuoteResult>(
    db,
    {
      kind: "quote_duplicate",
      scope: { origem_numero: origemNumero },
      idempotency_key: input.request_id,
      input: conteudo(input),
      actor,
    },
    async (transaction, { operationId }) => {
      const instante = agora();
      const iso = instante.toISOString();
      const hoje = dataDeHoje(instante);

      // Leituras.
      const [demandaSnap, quoteSnap] = await transaction.getAll(demandRef(db, origemNumero), quoteRef(db, origemNumero));
      if (!demandaSnap.exists || !quoteSnap.exists) {
        throw new HttpsError("not-found", `Orçamento ${origemNumero} não encontrado.`);
      }
      const origem = demandaSnap.data() ?? {};
      const origemQuote = quoteSnap.data() ?? {};
      const numero = await reservarNumero(transaction, db);
      const code = texto(origem.customer_code);
      const cadastro = await cadastroPeloCodigo(transaction, db, code);
      if (cadastroArquivado(cadastro.data)) {
        throw new HttpsError("failed-precondition", `O cadastro ${code} está arquivado.`);
      }
      const contrato = await lerContratoDaOrigem(transaction, db, textoOuNull(origem.contrato_id), code);
      // O "Para" vem junto enquanto o contato continua valendo; senão, fica para escolher de novo.
      let solicitante: Solicitante | null = null;
      const solicitanteAntes = origem.solicitante as { contato_id?: string } | null;
      if (solicitanteAntes?.contato_id) {
        try {
          solicitante = await lerContato(transaction, db, solicitanteAntes.contato_id, code);
        } catch (error) {
          if (!(error instanceof HttpsError)) throw error;
        }
      }
      const origemLocal = origem.origem as LocalEntrada;
      const destinoLocal = origem.destino as LocalEntrada;
      await conferirLocais(transaction, db, idsDeLocais([origemLocal, destinoLocal], []), code);
      const tabelas = await lerTabelas(transaction, db, code);
      const tabelaAntes = (origemQuote.tabela ?? {}) as { id?: string | null; variante?: string };
      const variante = String(tabelaAntes.variante ?? VARIANTE_PADRAO);
      const tabela = escolherTabela(tabelas, { customer_code: code, contrato_id: contrato?.id ?? null, variante, data_base: hoje });

      const linhasOrigem = linhasGravadas(origemQuote.linhas);
      const itens = await lerItens(transaction, db, linhasOrigem);
      // Duplicar vale a partir de qualquer orçamento: cada linha segue a tabela de hoje (orcamento.ts).
      const entradas = entradasNaTabelaNova(linhasOrigem, { tabela, itens }, {
        comId: false,
        motivo: (causa) => motivoDoAvulso(causa, { data_base: hoje, preco: `preço do orçamento ${origemNumero}` }),
      });
      // As condições e a validade citam a tabela: com outra tabela, valem as dela, como na criação.
      const mesmaTabela = (tabela?.id ?? null) === textoOuNull(tabelaAntes.id);
      const condicoes = mesmaTabela ? textoOuNull(origemQuote.condicoes) : (tabela?.condicoes ?? null);
      let validadeDias = tabela?.validade_dias ?? null;
      if (mesmaTabela) validadeDias = typeof origemQuote.validade_dias === "number" ? origemQuote.validade_dias : null;

      // Conta.
      const precificado = precificar(entradas, tabela, itens, operationId);
      let reprecificadas = 0;
      precificado.linhas.forEach((linha, indice) => {
        const antes = linhasOrigem[indice];
        if (antes && !mesmoPreco(antes.preco, linha.preco)) {
          linha.preco_anterior = antes.preco;
          reprecificadas += 1;
        }
      });
      const marcas = marcasDoOrcamento({ linhas: precificado.linhas, tabela, data_base: hoje, numero_legado: null });

      // Escritas.
      const demanda = {
        ...demandaNova({
          numero,
          code,
          cadastroNome: texto(cadastro.data.name) || code,
          contrato,
          entrada: "comercial",
          canal: (CANAIS_DEMANDA as readonly string[]).includes(String(origem.canal))
            ? (origem.canal as (typeof CANAIS_DEMANDA)[number])
            : "email",
          tipo: (TIPOS_DEMANDA as readonly string[]).includes(String(origem.tipo))
            ? (origem.tipo as (typeof TIPOS_DEMANDA)[number])
            : "planejada",
          titulo: textoOuNull(origem.titulo),
          ref_cliente: null,
          solicitante,
          recebida_em: iso,
          email_assunto: null,
          email_link: null,
          origem: localDoc(origemLocal),
          destino: localDoc(destinoLocal),
          execucao: null,
          numero_legado: null,
          duplicado_de: origemNumero,
          iso,
          uid: caller.uid,
        }),
        request_id: input.request_id,
        operation_id: operationId,
      };
      const quote = {
        ...orcamentoNovo({
          numero,
          code,
          hoje,
          tabela,
          variante,
          precificado,
          marcas,
          condicoes,
          validade_dias: validadeDias,
          observacoes_internas: null,
          duplicado_de: origemNumero,
          iso,
          uid: caller.uid,
        }),
        request_id: input.request_id,
        operation_id: operationId,
      };
      transaction.set(counterRef(db), { ultimo: Number(numero), updated_at: FieldValue.serverTimestamp() }, { merge: true });
      transaction.create(demandRef(db, numero), demanda);
      transaction.create(quoteRef(db, numero), quote);
      const events = eventosDaCriacao(transaction, db, {
        operationId,
        actor,
        numero,
        code,
        demanda,
        tabela,
        variante,
        precificado,
        marcas,
        iso,
        duplicado_de: origemNumero,
        linhas_reprecificadas: reprecificadas,
      });
      return {
        target_id: numero,
        result: {
          ok: true,
          numero,
          rotulo: rotuloDoOrcamento(numero, 0),
          rv: 0,
          edicao: 1,
          status: "rascunho",
          etapa: "em_montagem",
          total_cents: precificado.total_cents,
          events,
        },
      };
    },
  );
}

/**
 * Callable saveQuote: criar (demanda e orçamento juntos), orçar a execução
 * da demanda direta (create_execution), editar o rascunho e duplicar.
 */
export async function saveQuoteFor(
  db: Firestore,
  caller: ComercialProfile,
  data: unknown,
  opcoes: QuoteOptions = {},
): Promise<SaveQuoteResult & { replayed?: true }> {
  assertComercialCaller(caller);
  const input = parseEntrada(SaveQuoteInput, data);
  const agora = opcoes.agora ?? (() => new Date());
  switch (input.action) {
    case "create":
    case "create_execution":
      return criar(db, caller, input, agora);
    case "update":
      return atualizar(db, caller, input, agora);
    case "duplicate":
      return duplicar(db, caller, input, agora);
  }
}

// --- advanceQuote ------------------------------------------------------------------------------

/** O que a RV congelada registra além do conteúdo: a aprovação (ou a dispensa dela) e o envio. */
type Congelamento = {
  aprovacao: unknown;
  aprovacao_dispensada?: unknown;
  enviado_por?: string | null;
  enviado_em?: string | null;
};

/**
 * A RV congelada em `revisoes/{rv}`: o que o Leonardo aprovou (ou o que foi
 * enviado com a aprovação dispensada), com a solicitação da demanda e sem as
 * observações internas. É regravada a cada aprovação da mesma RV; o envio a
 * congela de vez (enviado_por e enviado_em) e, depois dele, só a resposta do
 * cliente entra (resposta_cliente, demandas.ts).
 */
export function revisaoCongelada(quote: Dados, demanda: Dados, congelamento: Congelamento): Record<string, unknown> {
  return {
    numero: quote.numero,
    rotulo: rotuloDoOrcamento(String(quote.numero), Number(quote.rv ?? 0)),
    rv: quote.rv,
    tipo_rv: quote.tipo_rv,
    edicao: quote.edicao,
    customer_code: quote.customer_code,
    data_base: quote.data_base,
    tabela: quote.tabela,
    linhas: quote.linhas,
    subtotal_cents: quote.subtotal_cents,
    ajustes_cents: quote.ajustes_cents,
    total_cents: quote.total_cents,
    marcas: quote.marcas,
    condicoes: quote.condicoes ?? null,
    validade_dias: quote.validade_dias ?? null,
    autor_uid: quote.autor_uid ?? null,
    revisao_de: quote.revisao_de ?? null,
    aprovacao: congelamento.aprovacao ?? null,
    aprovacao_dispensada: congelamento.aprovacao_dispensada ?? null,
    demanda: {
      customer_name: demanda.customer_name ?? null,
      contrato_id: demanda.contrato_id ?? null,
      cobranca: demanda.cobranca ?? null,
      titulo: demanda.titulo ?? null,
      ref_cliente: demanda.ref_cliente ?? null,
      solicitante: demanda.solicitante ?? null,
      recebida_em: demanda.recebida_em ?? null,
      origem: demanda.origem ?? null,
      destino: demanda.destino ?? null,
      execucao: demanda.execucao ?? null,
      executado_de: demanda.executado_de ?? null,
      executado_ate: demanda.executado_ate ?? null,
      numero_legado: demanda.numero_legado ?? null,
    },
    // O envio congela a RV de vez; depois dele, só a resposta do cliente.
    enviado_por: congelamento.enviado_por ?? null,
    enviado_em: congelamento.enviado_em ?? null,
    resposta_cliente: null,
    validacao_cliente: null,
    schema_version: QUOTE_SCHEMA_VERSION,
    gravada_em: FieldValue.serverTimestamp(),
  };
}

/** A RV gravada (o orçamento ou uma RV congelada) para comparar na dispensa da aprovação. */
function rvParaComparar(dados: Dados): RvParaComparar {
  return {
    linhas: linhasGravadas(dados.linhas),
    total_cents: Number(dados.total_cents ?? 0),
    tabela_id: textoOuNull((dados.tabela as { id?: unknown } | null)?.id),
  };
}

export type RvSeguinte = {
  rv: number;
  rv_anterior: number;
  tipo_rv: TipoRv;
  edicao: number;
  patch: Record<string, unknown>;
};

/**
 * A maior RV já enviada ao cliente, quando o orçamento voltou a uma RV mais
 * antiga (o aditivo recusado volta ao escopo fechado): a RV seguinte nunca
 * reusa o número de uma RV que o cliente recebeu. -1 quando não há.
 */
function ultimaRvEnviada(quote: Dados): number {
  const valor = quote.ultima_rv_enviada;
  return typeof valor === "number" && Number.isInteger(valor) ? valor : -1;
}

/**
 * A RV seguinte da enviada, em rascunho, no mesmo `quotes/{numero}`: as
 * mesmas linhas (com os mesmos ids), a mesma data-base, a mesma tabela, as
 * mesmas condições. Quem abre passa a ser o autor. A edição continua subindo
 * (nunca volta a 1), para uma tela aberta na RV anterior não gravar na nova.
 * A RV enviada fica como está em `revisoes/{rv}`. O número segue a maior RV
 * já enviada (ultima_rv_enviada), quando o orçamento voltou a uma anterior.
 */
export function rvSeguinte(numero: string, quote: Dados, motivo: OrigemRevisao, quem: { uid: string; iso: string }): RvSeguinte {
  const rvAnterior = Number(quote.rv ?? 0);
  const rv = Math.max(rvAnterior, ultimaRvEnviada(quote)) + 1;
  if (rv > 99) throw new HttpsError("failed-precondition", `O orçamento ${numero} chegou à RV99: abra um orçamento novo.`);
  const tipoAtual = (TIPOS_RV as readonly string[]).includes(String(quote.tipo_rv)) ? (quote.tipo_rv as TipoRv) : "proposta";
  const tipo = tipoDaRevisao(motivo, tipoAtual);
  const edicaoAnterior = Number(quote.edicao);
  const edicao = edicaoAnterior + 1;
  return {
    rv,
    rv_anterior: rvAnterior,
    tipo_rv: tipo,
    edicao,
    patch: {
      rv,
      rotulo: rotuloDoOrcamento(numero, rv),
      tipo_rv: tipo,
      status: "rascunho",
      edicao,
      autor_uid: quem.uid,
      aprovacao: null,
      aprovacao_dispensada: null,
      dispensa: null,
      devolucao: null,
      envio: null,
      revisao_de: { rv: rvAnterior, edicao: edicaoAnterior, motivo },
      passo_em: quem.iso,
      updated_at: FieldValue.serverTimestamp(),
      updated_by: quem.uid,
    },
  };
}

export type RvRestaurada = {
  rv: number;
  tipo_rv: TipoRv;
  edicao: number;
  patch: Record<string, unknown>;
};

/**
 * O orçamento de volta a uma RV já enviada, como ela está em `revisoes/{rv}`
 * (linhas, totais, tabela, aprovação e envio): a RV seguinte descartada antes
 * do envio, ou o aditivo recusado pelo cliente. A edição continua subindo, e
 * ultima_rv_enviada guarda a maior RV que o cliente recebeu, para a próxima
 * RV não reusar o número. As observações internas ficam como estão.
 */
export function rvRestaurada(
  numero: string,
  quote: Dados,
  enviada: Dados,
  rvsEnviadas: readonly number[],
  quem: { uid: string; iso: string },
): RvRestaurada {
  const rv = Number(enviada.rv);
  const tipo = (TIPOS_RV as readonly string[]).includes(String(enviada.tipo_rv)) ? (enviada.tipo_rv as TipoRv) : "proposta";
  const edicao = Number(quote.edicao) + 1;
  return {
    rv,
    tipo_rv: tipo,
    edicao,
    patch: {
      rv,
      rotulo: rotuloDoOrcamento(numero, rv),
      tipo_rv: tipo,
      status: "enviado",
      edicao,
      data_base: enviada.data_base,
      tabela: enviada.tabela,
      linhas: enviada.linhas,
      subtotal_cents: enviada.subtotal_cents,
      ajustes_cents: enviada.ajustes_cents,
      total_cents: enviada.total_cents,
      marcas: enviada.marcas,
      condicoes: enviada.condicoes ?? null,
      validade_dias: enviada.validade_dias ?? null,
      autor_uid: enviada.autor_uid ?? null,
      aprovacao: enviada.aprovacao ?? null,
      aprovacao_dispensada: enviada.aprovacao_dispensada ?? null,
      dispensa: null,
      devolucao: null,
      envio: { por_uid: enviada.enviado_por ?? null, em: enviada.enviado_em ?? null, edicao: Number(enviada.edicao) },
      revisao_de: enviada.revisao_de ?? null,
      ultima_rv_enviada: Math.max(ultimaRvEnviada(quote), rv, ...rvsEnviadas),
      passo_em: quem.iso,
      updated_at: FieldValue.serverTimestamp(),
      updated_by: quem.uid,
    },
  };
}

/** A RV congelada que serve de volta: tem de existir e ter sido enviada ao cliente. */
export function rvEnviadaParaVoltar(snapshot: DocumentSnapshot, numero: string, rv: number): Dados {
  if (!snapshot.exists || !snapshot.get("enviado_em")) {
    throw new HttpsError("failed-precondition", `A ${rotuloDoOrcamento(numero, rv)} não está congelada como enviada: não há RV para voltar.`);
  }
  return snapshot.data() ?? {};
}

type ContextoDoPasso = {
  transaction: Transaction;
  db: Firestore;
  operationId: string;
  actor: ComercialActor;
  caller: ComercialProfile;
  numero: string;
  demanda: Dados;
  quote: Dados;
  instante: Date;
  iso: string;
};

/**
 * "Revisar": a RV enviada ganha a seguinte, em rascunho. A RV de execução já
 * sai com a dispensa da aprovação calculada contra a RV fechada.
 */
function revisar(
  contexto: ContextoDoPasso,
  motivo: OrigemRevisao,
  dispensa: Dispensa | null,
): { target_id: string; result: AdvanceQuoteResult } {
  const { transaction, db, numero, demanda, quote, caller, iso } = contexto;
  const seguinte = rvSeguinte(numero, quote, motivo, { uid: caller.uid, iso });
  const etapaAntes = demanda.etapa as EtapaDemanda;
  const etapaDepois = etapaDaDemanda(demanda, { status: "rascunho", tipo_rv: seguinte.tipo_rv, rv: seguinte.rv });
  transaction.update(quoteRef(db, numero), { ...seguinte.patch, dispensa });

  const mudouEtapa = etapaDepois !== etapaAntes;
  const demandaPatch: Record<string, unknown> = { updated_at: FieldValue.serverTimestamp(), updated_by: caller.uid };
  if (mudouEtapa) {
    demandaPatch.etapa = etapaDepois;
    demandaPatch.etapa_desde = iso;
    demandaPatch.marcos = marcosComEtapa(demanda, etapaDepois, { em: iso, por_uid: caller.uid });
  }
  transaction.update(demandRef(db, numero), demandaPatch);

  const comum = {
    operation_id: contexto.operationId,
    entity_id: numero,
    customer_code: texto(demanda.customer_code),
    actor: contexto.actor,
    occurred_at: iso,
  };
  const events = [
    createComercialEvent(transaction, db, {
      ...comum,
      type: "quote.revised",
      payload: {
        numero,
        rv: seguinte.rv,
        rv_anterior: seguinte.rv_anterior,
        tipo_rv: seguinte.tipo_rv,
        motivo,
        edicao: seguinte.edicao,
        etapa_antes: etapaAntes,
        etapa_depois: etapaDepois,
      },
    }).id,
  ];
  if (mudouEtapa) {
    events.push(
      createComercialEvent(transaction, db, {
        ...comum,
        type: "demand.stage_changed",
        payload: {
          numero,
          etapa_antes: etapaAntes,
          etapa_depois: etapaDepois,
          segundos_desde_anterior: segundosDesde(demanda.etapa_desde, contexto.instante),
        },
      }).id,
    );
  }
  return {
    target_id: numero,
    result: {
      ok: true,
      numero,
      rotulo: rotuloDoOrcamento(numero, seguinte.rv),
      rv: seguinte.rv,
      edicao: seguinte.edicao,
      status: "rascunho",
      etapa: etapaDepois,
      ja_feito: false,
      events,
    },
  };
}

/**
 * "Descartar": a RV seguinte, ainda não enviada (rascunho, para aprovar ou
 * aprovada), sai, e o orçamento volta à RV enviada de onde ela saiu
 * (revisao_de), como está em `revisoes/{rv}`. Serve para o aditivo aberto por
 * engano, a revisão de que o cliente desistiu e a reabertura em que o cliente
 * volta aceitando a RV que recebeu. A RV descartada nunca chegou ao cliente:
 * o número fica livre, e a cópia gravada na aprovação, sem envio, sai junto.
 */
function descartar(
  contexto: ContextoDoPasso,
  enviada: Dados,
  revisaoAtual: DocumentSnapshot | null,
): { target_id: string; result: AdvanceQuoteResult } {
  const { transaction, db, numero, demanda, quote, caller, iso } = contexto;
  const rvDescartada = Number(quote.rv ?? 0);
  const tipoDescartado = (TIPOS_RV as readonly string[]).includes(String(quote.tipo_rv)) ? (quote.tipo_rv as TipoRv) : "proposta";
  if (revisaoAtual?.exists && revisaoAtual.get("enviado_em")) {
    throw new HttpsError("failed-precondition", `A ${rotuloDoOrcamento(numero, rvDescartada)} já foi enviada ao cliente: não se descarta.`);
  }
  const restaurada = rvRestaurada(numero, quote, enviada, [], { uid: caller.uid, iso });
  const etapaAntes = demanda.etapa as EtapaDemanda;
  const etapaDepois = etapaDaDemanda(demanda, { status: "enviado", tipo_rv: restaurada.tipo_rv, rv: restaurada.rv });
  transaction.update(quoteRef(db, numero), {
    ...restaurada.patch,
    descarte: {
      rv: rvDescartada,
      tipo_rv: tipoDescartado,
      status: quote.status,
      edicao: Number(quote.edicao),
      por_uid: caller.uid,
      em: iso,
    },
  });
  if (revisaoAtual?.exists) transaction.delete(revisaoAtual.ref);

  const mudouEtapa = etapaDepois !== etapaAntes;
  const demandaPatch: Record<string, unknown> = { updated_at: FieldValue.serverTimestamp(), updated_by: caller.uid };
  if (mudouEtapa) {
    demandaPatch.etapa = etapaDepois;
    demandaPatch.etapa_desde = iso;
    demandaPatch.marcos = marcosComEtapa(demanda, etapaDepois, { em: iso, por_uid: caller.uid });
  }
  transaction.update(demandRef(db, numero), demandaPatch);

  const comum = {
    operation_id: contexto.operationId,
    entity_id: numero,
    customer_code: texto(demanda.customer_code),
    actor: contexto.actor,
    occurred_at: iso,
  };
  const events = [
    createComercialEvent(transaction, db, {
      ...comum,
      type: "quote.discarded",
      payload: {
        numero,
        rv: rvDescartada,
        tipo_rv: tipoDescartado,
        rv_restaurada: restaurada.rv,
        edicao: restaurada.edicao,
        status_antes: quote.status as StatusOrcamento,
        etapa_antes: etapaAntes,
        etapa_depois: etapaDepois,
      },
    }).id,
  ];
  if (mudouEtapa) {
    events.push(
      createComercialEvent(transaction, db, {
        ...comum,
        type: "demand.stage_changed",
        payload: {
          numero,
          etapa_antes: etapaAntes,
          etapa_depois: etapaDepois,
          segundos_desde_anterior: segundosDesde(demanda.etapa_desde, contexto.instante),
        },
      }).id,
    );
  }
  return {
    target_id: numero,
    result: {
      ok: true,
      numero,
      rotulo: rotuloDoOrcamento(numero, restaurada.rv),
      rv: restaurada.rv,
      edicao: restaurada.edicao,
      status: "enviado",
      etapa: etapaDepois,
      ja_feito: false,
      events,
    },
  };
}

/**
 * Callable advanceQuote: enviar para aprovação, devolver, aprovar, editar o
 * aprovado, enviar ao cliente (do aprovado; do rascunho, só a RV de execução
 * com a aprovação dispensada), aprovar e enviar (owner), revisar (a RV
 * enviada ganha a seguinte) e descartar a RV seguinte ainda não enviada. A
 * demanda perdida não anda até ser reaberta.
 */
export async function advanceQuoteFor(
  db: Firestore,
  caller: ComercialProfile,
  data: unknown,
  opcoes: QuoteOptions = {},
): Promise<AdvanceQuoteResult & { replayed?: true }> {
  assertComercialCaller(caller);
  const input = parseEntrada(AdvanceQuoteInput, data);
  if (input.action === "approve" && !canApproveQuote(caller.role)) {
    throw new HttpsError("permission-denied", "Só o aprovador (owner) aprova o orçamento.");
  }
  if (input.action === "approve_and_send" && !canApproveQuote(caller.role)) {
    throw new HttpsError("permission-denied", "Só o aprovador (owner) aprova e envia o orçamento.");
  }
  const agora = opcoes.agora ?? (() => new Date());
  const actor = actorOf(caller);
  const numero = input.numero;
  const acao = input.action;

  return runIdempotent<AdvanceQuoteResult>(
    db,
    { kind: `quote_${acao}`, scope: { numero }, idempotency_key: input.request_id, input: conteudo(input), actor },
    async (transaction, { operationId }) => {
      const instante = agora();
      const iso = instante.toISOString();

      // Leituras.
      const [demandaSnap, quoteSnap] = await transaction.getAll(demandRef(db, numero), quoteRef(db, numero));
      if (!demandaSnap.exists || !quoteSnap.exists) throw new HttpsError("not-found", `Orçamento ${numero} não encontrado.`);
      const demanda = demandaSnap.data() ?? {};
      const quote = quoteSnap.data() ?? {};
      const status = quote.status as StatusOrcamento;
      const edicao = Number(quote.edicao);
      const rv = Number(quote.rv ?? 0);
      const tipoRv = String(quote.tipo_rv) as TipoRv;
      const linhas = linhasGravadas(quote.linhas);
      const aprovacao = (quote.aprovacao ?? null) as { edicao: number } | null;
      const estado = (jaFeito: boolean, events: string[]) => ({
        ok: true as const,
        numero,
        rotulo: rotuloDoOrcamento(numero, rv),
        rv,
        edicao,
        status,
        etapa: demanda.etapa as EtapaDemanda,
        ja_feito: jaFeito,
        events,
      });

      // Enviar do rascunho só com a aprovação dispensada: a RV de execução contra a RV fechada pelo cliente.
      // A RV de execução aberta pela revisão já sai com a dispensa calculada (a tela sabe o que oferecer).
      const escopoRv = rvFechada(demanda);
      const tipoDepois = acao === "revise" && input.motivo ? tipoDaRevisao(input.motivo, tipoRv) : tipoRv;
      const comparaComFechada =
        tipoDepois === "execucao" && escopoRv !== null && ((acao === "send" && status === "rascunho") || acao === "revise");
      const fechadaSnap = comparaComFechada ? await transaction.get(revisaoRef(db, numero, escopoRv)) : null;
      const fechada: RvParaComparar | null = fechadaSnap?.exists ? rvParaComparar(fechadaSnap.data() ?? {}) : null;
      let dispensa: Dispensa | undefined;
      if (acao === "send" && status === "rascunho") {
        dispensa = dispensaDaAprovacao({ ...rvParaComparar(quote), tipo_rv: tipoRv }, fechada);
      }
      const revisaoAtual = acao === "send" || acao === "discard" ? await transaction.get(revisaoRef(db, numero, rv)) : null;
      // Descartar volta à RV enviada de onde a atual saiu (revisao_de).
      const origem = (quote.revisao_de ?? null) as { rv?: unknown } | null;
      const rvDeVolta = acao === "discard" && typeof origem?.rv === "number" ? origem.rv : null;
      const deVoltaSnap = rvDeVolta !== null ? await transaction.get(revisaoRef(db, numero, rvDeVolta)) : null;

      // Papel antes de tudo (quem não pode, não fica sabendo se já foi feito); a situação, depois da conferência.
      const problema = problemaDaAcao(acao, { uid: caller.uid, role: caller.role }, {
        status,
        autor_uid: textoOuNull(quote.autor_uid),
        aprovacao_dispensada: dispensa,
      });
      if (problema?.codigo === "permission-denied") throw new HttpsError(problema.codigo, problema.mensagem);
      const jaFeita = acaoJaFeita(
        acao,
        {
          status,
          edicao,
          aprovacao,
          envio: (quote.envio ?? null) as { edicao: number } | null,
          revisao_de: (quote.revisao_de ?? null) as { edicao: number; motivo: string } | null,
          descarte: (quote.descarte ?? null) as { edicao: number } | null,
        },
        { status: input.expected_status, edicao: input.expected_edicao, motivo: input.motivo ?? null },
      );
      if (jaFeita) return { target_id: numero, result: estado(true, []) };
      conferirDemandaAtiva(demanda, numero);
      if (status !== input.expected_status) {
        throw new HttpsError(
          "failed-precondition",
          `O orçamento ${numero} mudou: está ${SITUACAO_ROTULO[status] ?? status}, não ${SITUACAO_ROTULO[input.expected_status]}. Abra de novo.`,
        );
      }
      if (edicao !== input.expected_edicao) {
        throw new HttpsError(
          "failed-precondition",
          `O orçamento mudou desde que foi aberto (edição ${edicao}, não ${input.expected_edicao}). Abra de novo.`,
        );
      }
      if (problema) throw new HttpsError(problema.codigo, problema.mensagem);
      if (acao === "return" && !input.nota && quote.autor_uid !== caller.uid) {
        throw new HttpsError("invalid-argument", "Devolver pede uma nota para quem montou o orçamento.");
      }
      const contexto: ContextoDoPasso = { transaction, db, operationId, actor, caller, numero, demanda, quote, instante, iso };
      if (acao === "revise") {
        // O schema exige o motivo na revisão.
        const motivo = input.motivo as (typeof MOTIVOS_REVISAO)[number];
        const problemaRevisao = problemaDaRevisao(motivo, { ...demanda, etapa: demanda.etapa as EtapaDemanda });
        if (problemaRevisao) throw new HttpsError("failed-precondition", problemaRevisao);
        const dispensaPrevista =
          tipoDepois === "execucao" ? dispensaDaAprovacao({ ...rvParaComparar(quote), tipo_rv: "execucao" }, fechada) : null;
        return revisar(contexto, motivo, dispensaPrevista);
      }
      if (acao === "discard") {
        if (rvDeVolta === null || !deVoltaSnap) {
          throw new HttpsError(
            "failed-precondition",
            `A ${rotuloDoOrcamento(numero, rv)} é a primeira RV: não há RV enviada para voltar. Para desistir do serviço, perca a demanda.`,
          );
        }
        return descartar(contexto, rvEnviadaParaVoltar(deVoltaSnap, numero, rvDeVolta), revisaoAtual);
      }

      const dispensada = acao === "send" && status === "rascunho";
      let marcas = (Array.isArray(quote.marcas) ? quote.marcas : []) as MarcaOrcamento[];
      if (acao === "submit" || acao === "approve" || acao === "approve_and_send" || dispensada) {
        const faltam = pendenciasParaAprovar(demanda, { linhas });
        if (faltam.length) {
          throw new HttpsError("failed-precondition", `Falta ${faltam.join(", ")} para ${ROTULO_DA_ACAO[acao]}.`);
        }
        // A tabela pode ter deixado de cobrir a data-base desde o último salvamento (carga retroativa): a aprovação
        // e a RV congelada veem as marcas de agora.
        const tabelaId = textoOuNull((quote.tabela as { id?: unknown } | null)?.id);
        const tabela = tabelaId ? await lerTabelaPorId(transaction, db, tabelaId) : null;
        marcas = marcasDoOrcamento({
          linhas,
          tabela,
          data_base: String(quote.data_base),
          numero_legado: textoOuNull(demanda.numero_legado),
        });
      }

      // Escritas.
      const statusDepois = TRANSICOES[acao].para;
      const etapaAntes = demanda.etapa as EtapaDemanda;
      const etapaDepois = etapaDaDemanda(demanda, { status: statusDepois, tipo_rv: tipoRv, rv });
      const quotePatch: Record<string, unknown> = {
        status: statusDepois,
        marcas,
        passo_em: iso,
        updated_at: FieldValue.serverTimestamp(),
        updated_by: caller.uid,
      };
      const congelada = { ...quote, marcas };
      const aprovada = acao === "approve" || acao === "approve_and_send" ? { por_uid: caller.uid, em: iso, edicao } : null;
      if (aprovada) quotePatch.aprovacao = aprovada;
      const dispensaGravada = dispensada ? { por_uid: caller.uid, em: iso, edicao, rv_fechada: escopoRv } : null;
      if (dispensaGravada) quotePatch.aprovacao_dispensada = dispensaGravada;
      const enviada = acao === "send" || acao === "approve_and_send";
      if (enviada) quotePatch.envio = { por_uid: caller.uid, em: iso, edicao };

      const revisao = revisaoRef(db, numero, rv);
      if (acao === "approve") {
        // Regravada a cada aprovação da mesma RV; o envio a congela de vez.
        transaction.set(revisao, revisaoCongelada(congelada, demanda, { aprovacao: aprovada }));
      } else if (acao === "approve_and_send" || dispensada) {
        transaction.set(
          revisao,
          revisaoCongelada(congelada, demanda, {
            aprovacao: aprovada,
            aprovacao_dispensada: dispensaGravada,
            enviado_por: caller.uid,
            enviado_em: iso,
          }),
        );
      } else if (acao === "send") {
        // Do aprovado: a RV congelada na aprovação recebe o envio e fica assim para sempre.
        if (revisaoAtual?.exists && Number(revisaoAtual.get("edicao")) === edicao) {
          transaction.update(revisao, { enviado_por: caller.uid, enviado_em: iso });
        } else {
          transaction.set(
            revisao,
            revisaoCongelada(congelada, demanda, { aprovacao: quote.aprovacao ?? null, enviado_por: caller.uid, enviado_em: iso }),
          );
        }
      }
      if (acao === "return") quotePatch.devolucao = { nota: input.nota ?? null, por_uid: caller.uid, em: iso };
      if (acao === "edit") quotePatch.aprovacao = null;
      transaction.update(quoteRef(db, numero), quotePatch);

      const mudouEtapa = etapaDepois !== etapaAntes;
      const nomeados = dispensada ? [{ marco: "aprovacao_dispensada", rv, em: iso, por_uid: caller.uid }] : [];
      const demandaPatch: Record<string, unknown> = { updated_at: FieldValue.serverTimestamp(), updated_by: caller.uid };
      if (mudouEtapa || nomeados.length) {
        demandaPatch.marcos = marcosComEtapa(demanda, mudouEtapa ? etapaDepois : null, { em: iso, por_uid: caller.uid }, nomeados);
      }
      if (mudouEtapa) {
        demandaPatch.etapa = etapaDepois;
        demandaPatch.etapa_desde = iso;
      }
      transaction.update(demandRef(db, numero), demandaPatch);

      const code = texto(demanda.customer_code);
      const comum = { operation_id: operationId, entity_id: numero, customer_code: code, actor, occurred_at: iso };
      const base = {
        numero,
        rv,
        edicao,
        linhas: linhasPorOrigem(linhas),
        marcas,
      };
      const segundos = segundosDesde(quote.passo_em, instante);
      const events: string[] = [];
      if (acao === "approve_and_send") {
        events.push(
          createComercialEvent(transaction, db, {
            ...comum,
            type: "quote.approved",
            payload: { ...base, status_antes: status, status_depois: "aprovado", segundos_desde_anterior: segundos },
          }).id,
          createComercialEvent(transaction, db, {
            ...comum,
            type: "quote.sent",
            payload: { ...base, status_antes: "aprovado", status_depois: "enviado", etapa_antes: etapaAntes, etapa_depois: etapaDepois },
          }).id,
        );
      } else if (dispensada) {
        events.push(
          createComercialEvent(transaction, db, {
            ...comum,
            type: "quote.approval_waived",
            payload: { ...base, status_antes: status, segundos_desde_anterior: segundos },
          }).id,
          createComercialEvent(transaction, db, {
            ...comum,
            type: "quote.sent",
            payload: { ...base, status_antes: status, status_depois: "enviado", etapa_antes: etapaAntes, etapa_depois: etapaDepois },
          }).id,
        );
      } else {
        events.push(
          createComercialEvent(transaction, db, {
            ...comum,
            type: QUOTE_EVENT[acao as keyof typeof QUOTE_EVENT],
            payload: {
              ...base,
              status_antes: status,
              status_depois: statusDepois,
              etapa_antes: etapaAntes,
              etapa_depois: etapaDepois,
              segundos_desde_anterior: segundos,
            },
          }).id,
        );
      }
      if (mudouEtapa) {
        events.push(
          createComercialEvent(transaction, db, {
            ...comum,
            type: "demand.stage_changed",
            payload: {
              numero,
              etapa_antes: etapaAntes,
              etapa_depois: etapaDepois,
              segundos_desde_anterior: segundosDesde(demanda.etapa_desde, instante),
            },
          }).id,
        );
      }
      return {
        target_id: numero,
        result: { ...estado(false, events), status: statusDepois, etapa: etapaDepois },
      };
    },
  );
}
