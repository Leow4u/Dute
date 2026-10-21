import { FieldValue, type DocumentReference, type Firestore, type Transaction } from "firebase-admin/firestore";
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
  TIPOS_DEMANDA,
  dataDeHoje,
  etapaDaDemanda,
  proximoNumero,
  rotuloDoOrcamento,
  segundosDesde,
  type EtapaDemanda,
  type StatusOrcamento,
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
  type ItemDoCatalogo,
  type LinhaDoOrcamento,
  type LinhaEntrada,
  type MarcaOrcamento,
  type Precificado,
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
 * Demanda e orçamento no backend, até a aprovação
 * (docs/plataforma/fase-6-comercial.md, parte 9): as callables saveQuote
 * (criar, editar o rascunho e duplicar) e advanceQuote (enviar para
 * aprovação, devolver, aprovar e editar o aprovado).
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
const data = z.string().trim().refine(dataValida, "Data inválida (AAAA-MM-DD).");
/** Instante com data, hora e fuso (o app manda o de São Paulo: 2026-10-14T09:42-03:00); grava em UTC. */
const INSTANTE = /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
const recebidaEm = z
  .string()
  .trim()
  .refine((value) => {
    const partes = INSTANTE.exec(value);
    return partes !== null && dataValida(partes[1]) && !Number.isNaN(Date.parse(value));
  }, "Recebido em: informe a data e a hora, com o fuso (ex.: 2026-10-14T09:42-03:00).")
  .transform((value) => new Date(value).toISOString());
/** Folga do relógio do aparelho para "Recebido em" no futuro. */
const FOLGA_DO_RELOGIO_MS = 5 * 60 * 1000;
const linkDoEmail = textoOpcional(2000).refine(
  (value) => value == null || /^https?:\/\/\S+$/i.test(value),
  "Link do e-mail inválido: use o endereço que começa com https://.",
);
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

export const SaveQuoteInput = z.discriminatedUnion("action", [CriarOrcamento, AtualizarOrcamento, DuplicarOrcamento]);
export type SaveQuoteInput = z.infer<typeof SaveQuoteInput>;

export const AdvanceQuoteInput = z
  .object({
    action: z.enum(ACOES_ORCAMENTO),
    request_id: requestId,
    numero: numeroServico,
    expected_status: z.enum(STATUS_ORCAMENTO),
    expected_edicao: z.number().int().min(1),
    nota: textoOpcional(1000),
  })
  .strict();
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

type Dados = Record<string, unknown>;

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

function textoOuNull(valor: unknown): string | null {
  return texto(valor) || null;
}

function actorOf(caller: ComercialProfile): ComercialActor {
  const actor: ComercialActor = { uid: caller.uid, role: caller.role };
  if (caller.email) actor.email = caller.email;
  if (caller.name) actor.name = caller.name;
  return actor;
}

/** Os testes chamam as funções de domínio direto: a barreira do módulo vale aqui também. */
function assertComercialCaller(caller: ComercialProfile): void {
  const problem = comercialAccessProblem(caller.role);
  if (problem) throw new HttpsError("permission-denied", problem);
}

/** Conteúdo da chamada para o hash do recibo: tudo menos a chave. */
function conteudo<T extends { request_id: string }>(input: T): Omit<T, "request_id"> {
  const { request_id: _chave, ...rest } = input;
  return rest;
}

function demandRef(db: Firestore, numero: string): DocumentReference {
  return db.collection(DEMANDS_COLLECTION).doc(numero);
}

function quoteRef(db: Firestore, numero: string): DocumentReference {
  return db.collection(QUOTES_COLLECTION).doc(numero);
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
  if (recebida !== undefined && Date.parse(recebida) > agora.getTime() + FOLGA_DO_RELOGIO_MS) {
    throw new HttpsError("invalid-argument", "Recebido em não pode ser depois de agora.");
  }
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

type Solicitante = { contato_id: string; empresa: string | null };

/** O "Para": contato ativo do mesmo cliente, com a empresa dele (a gerenciadora). Sem contato, null. */
async function lerContato(
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

type TabelaLida = {
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

async function lerTabelaPorId(transaction: Transaction, db: Firestore, id: string): Promise<TabelaLida> {
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
): Precificado {
  try {
    return precificarLinhas(entradas, {
      tabela: tabela ? { id: tabela.id, precos: tabela.precos } : null,
      itens,
      novoId: (indice) => novoIdDeLinha(operationId, indice),
    });
  } catch (error) {
    comoErroDaCallable(error);
  }
}

function tabelaDoOrcamento(tabela: TabelaLida | null, variante: string) {
  return { id: tabela?.id ?? null, nome: tabela?.nome ?? null, variante: tabela?.variante || variante };
}

function linhasGravadas(valor: unknown): LinhaDoOrcamento[] {
  return Array.isArray(valor) ? (valor as LinhaDoOrcamento[]) : [];
}

const QUOTE_EVENT: Record<AcaoOrcamento, ComercialEventType> = {
  submit: "quote.submitted",
  return: "quote.returned",
  approve: "quote.approved",
  edit: "quote.edited",
};

const ROTULO_DA_ACAO: Record<AcaoOrcamento, string> = {
  submit: "enviar para aprovação",
  return: "devolver",
  approve: "aprovar",
  edit: "editar",
};

// --- saveQuote: criar --------------------------------------------------------------------

type CriarInput = z.infer<typeof CriarOrcamento>;
type AtualizarInput = z.infer<typeof AtualizarOrcamento>;
type DuplicarInput = z.infer<typeof DuplicarOrcamento>;

async function criar(db: Firestore, caller: ComercialProfile, input: CriarInput, agora: () => Date) {
  const actor = actorOf(caller);
  const code = input.customer_code;
  const entradas: LinhaEntrada[] = input.linhas ?? [];
  if (entradas.some((linha) => linha.id)) {
    throw new HttpsError("invalid-argument", "Linha nova não leva id: o servidor dá o id da linha.");
  }
  const variante = varianteConferida(input.variante);
  if (input.entrada === "direta") {
    // A demanda direta já foi executada: abre o orçamento da execução ("Orçar execução"), com executado_de/ate e a
    // data-base da solicitação. Entra com a RV de execução; até lá, recusa em vez de abrir uma proposta incoerente.
    throw new HttpsError(
      "failed-precondition",
      "Demanda direta (executada antes do orçamento) ainda não entra: ela abre o orçamento da execução, que vem numa próxima parte.",
    );
  }
  conferirRecebidaEm(input.recebida_em, agora());

  return runIdempotent<SaveQuoteResult>(
    db,
    { kind: "quote_create", scope: { acao: "create" }, idempotency_key: input.request_id, input: conteudo(input), actor },
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
      const demanda = {
        ...demandaNova({
          numero,
          code,
          cadastroNome: texto(cadastro.data.name) || code,
          contrato,
          entrada: "comercial",
          canal: input.canal ?? "email",
          tipo: input.tipo ?? "planejada",
          titulo: input.titulo ?? null,
          ref_cliente: input.ref_cliente ?? null,
          solicitante,
          recebida_em: input.recebida_em ?? iso,
          email_assunto: input.email_assunto ?? null,
          email_link: input.email_link ?? null,
          origem: localDoc(input.origem),
          destino: localDoc(input.destino),
          execucao: input.execucao ?? null,
          numero_legado: numeroLegado,
          duplicado_de: null,
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
          condicoes: input.condicoes !== undefined ? input.condicoes : (tabela?.condicoes ?? null),
          validade_dias: input.validade_dias !== undefined ? input.validade_dias : (tabela?.validade_dias ?? null),
          observacoes_internas: input.observacoes_internas ?? null,
          duplicado_de: null,
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
  iso: string;
  uid: string;
};

/** A demanda nova, sem preço, com os campos reservados para as próximas partes. */
function demandaNova(dados: DemandaNova): Record<string, unknown> {
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
    etapa: "em_montagem",
    etapa_desde: dados.iso,
    marcos: [{ etapa: "em_montagem", em: dados.iso, por_uid: dados.uid }],
    numero_legado: dados.numero_legado,
    duplicado_de: dados.duplicado_de,
    // Reservados: escopo fechado (parte 10), execução e OS (Fase 3), perda e cancelamento (parte 10).
    escopo_rv: null,
    escopo: [],
    executado_de: null,
    executado_ate: null,
    os_seq: 0,
    os_ids: [],
    perda: null,
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
    tipo_rv: "proposta",
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
    devolucao: null,
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
  },
): string[] {
  const { demanda } = dados;
  const comum = { operation_id: dados.operationId, entity_id: dados.numero, customer_code: dados.code, actor: dados.actor, occurred_at: dados.iso };
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
      tipo_rv: "proposta",
      edicao: 1,
      etapa: "em_montagem",
      tabela_id: dados.tabela?.id ?? null,
      variante: normalizarVariante(dados.tabela?.variante || dados.variante),
      linhas: dados.precificado.por_origem,
      marcas: dados.marcas,
      duplicado_de: dados.duplicado_de,
      linhas_reprecificadas: dados.linhas_reprecificadas,
    },
  });
  return [criada.id, orcamento.id];
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

      // Conta.
      const precificado = precificar(entradas, tabela, itens, operationId);
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

/** Callable saveQuote: criar (demanda e orçamento juntos), editar o rascunho e duplicar. */
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
      return criar(db, caller, input, agora);
    case "update":
      return atualizar(db, caller, input, agora);
    case "duplicate":
      return duplicar(db, caller, input, agora);
  }
}

// --- advanceQuote ------------------------------------------------------------------------------

/** A RV congelada na aprovação: o que o Leonardo aprovou, com a solicitação da demanda. */
function revisaoCongelada(quote: Dados, demanda: Dados, aprovacao: Record<string, unknown>): Record<string, unknown> {
  return {
    numero: quote.numero,
    rotulo: quote.rotulo ?? rotuloDoOrcamento(String(quote.numero), Number(quote.rv ?? 0)),
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
    aprovacao,
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
      numero_legado: demanda.numero_legado ?? null,
    },
    // O envio (parte 10) congela a RV de vez.
    enviado: null,
    schema_version: QUOTE_SCHEMA_VERSION,
    gravada_em: FieldValue.serverTimestamp(),
  };
}

/** Callable advanceQuote: enviar para aprovação, devolver, aprovar e editar o aprovado. */
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

      // Papel antes de tudo (quem não pode, não fica sabendo se já foi feito); a situação, depois da conferência.
      const problema = problemaDaAcao(acao, { uid: caller.uid, role: caller.role }, {
        status,
        autor_uid: textoOuNull(quote.autor_uid),
      });
      if (problema?.codigo === "permission-denied") throw new HttpsError(problema.codigo, problema.mensagem);
      if (acaoJaFeita(acao, { status, edicao, aprovacao }, { status: input.expected_status, edicao: input.expected_edicao })) {
        return { target_id: numero, result: estado(true, []) };
      }
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
      let marcas = (Array.isArray(quote.marcas) ? quote.marcas : []) as MarcaOrcamento[];
      if (acao === "submit" || acao === "approve") {
        const faltam = pendenciasParaAprovar(demanda, { linhas: linhasGravadas(quote.linhas) });
        if (faltam.length) {
          throw new HttpsError("failed-precondition", `Falta ${faltam.join(", ")} para ${ROTULO_DA_ACAO[acao]}.`);
        }
        // A tabela pode ter deixado de cobrir a data-base desde o último salvamento (carga retroativa): a aprovação
        // e a RV congelada veem as marcas de agora.
        const tabelaId = textoOuNull((quote.tabela as { id?: unknown } | null)?.id);
        const tabela = tabelaId ? await lerTabelaPorId(transaction, db, tabelaId) : null;
        marcas = marcasDoOrcamento({
          linhas: linhasGravadas(quote.linhas),
          tabela,
          data_base: String(quote.data_base),
          numero_legado: textoOuNull(demanda.numero_legado),
        });
      }

      // Escritas.
      const statusDepois = TRANSICOES[acao].para;
      const etapaAntes = demanda.etapa as EtapaDemanda;
      const etapaDepois = etapaDaDemanda(demanda, { status: statusDepois, tipo_rv: String(quote.tipo_rv) });
      const quotePatch: Record<string, unknown> = {
        status: statusDepois,
        marcas,
        passo_em: iso,
        updated_at: FieldValue.serverTimestamp(),
        updated_by: caller.uid,
      };
      if (acao === "approve") {
        const aprovada = { por_uid: caller.uid, em: iso, edicao };
        quotePatch.aprovacao = aprovada;
        // Regravada a cada aprovação da mesma RV; o envio (parte 10) a congela de vez.
        transaction.set(
          quoteRef(db, numero).collection(REVISOES_SUBCOLLECTION).doc(String(rv)),
          revisaoCongelada({ ...quote, marcas }, demanda, aprovada),
        );
      }
      if (acao === "return") quotePatch.devolucao = { nota: input.nota ?? null, por_uid: caller.uid, em: iso };
      if (acao === "edit") quotePatch.aprovacao = null;
      transaction.update(quoteRef(db, numero), quotePatch);

      const mudouEtapa = etapaDepois !== etapaAntes;
      const demandaPatch: Record<string, unknown> = { updated_at: FieldValue.serverTimestamp(), updated_by: caller.uid };
      if (mudouEtapa) {
        const marcos = Array.isArray(demanda.marcos) ? demanda.marcos : [];
        demandaPatch.etapa = etapaDepois;
        demandaPatch.etapa_desde = iso;
        demandaPatch.marcos = [...marcos, { etapa: etapaDepois, em: iso, por_uid: caller.uid }];
      }
      transaction.update(demandRef(db, numero), demandaPatch);

      const code = texto(demanda.customer_code);
      const comum = { operation_id: operationId, entity_id: numero, customer_code: code, actor, occurred_at: iso };
      const events = [
        createComercialEvent(transaction, db, {
          ...comum,
          type: QUOTE_EVENT[acao],
          payload: {
            numero,
            rv,
            edicao,
            status_antes: status,
            status_depois: statusDepois,
            etapa_antes: etapaAntes,
            etapa_depois: etapaDepois,
            segundos_desde_anterior: segundosDesde(quote.passo_em, instante),
            linhas: linhasPorOrigem(linhasGravadas(quote.linhas)),
            marcas,
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
