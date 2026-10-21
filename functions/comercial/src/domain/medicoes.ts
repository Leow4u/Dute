import { FieldValue, type DocumentReference, type Firestore, type Transaction } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";
import { z } from "zod";

import { idDeDocumentoValido, parseEntrada } from "./cadastro.js";
import { LPU_ITEMS_COLLECTION } from "./catalogo.js";
import { dataValida } from "./contratos-datas.js";
import { ADITIVOS_SUBCOLLECTION, CONTRACTS_COLLECTION } from "./contratos.js";
import { etapaDaDemanda, segundosDesde, type EtapaDemanda } from "./demanda.js";
import { ErroDinheiro } from "./dinheiro.js";
import { createComercialEvent } from "./events.js";
import {
  CLIENT_AUTHORIZATION_SCHEMA_VERSION,
  CLIENT_AUTHORIZATIONS_COLLECTION,
  DIA_TIPOS,
  ErroMedicao,
  JANELAS,
  MAXIMO_DE_DEMANDAS,
  MAXIMO_DE_ITENS_POR_LINHA,
  MAXIMO_DE_LINHAS,
  MEDICAO_SCHEMA_VERSION,
  MEDICOES_COLLECTION,
  ORIGENS_ITEM_MEDICAO,
  STATUS_MEDICAO,
  acaoDaMedicaoJaFeita,
  autorizacaoDaMedicaoId,
  classificarItem,
  competenciaValida,
  contagemDeMarcas,
  contratoComMedicaoMensal,
  demandasDaMedicao,
  destinoNaAprovacaoDaMedicao,
  entradaDaLinhaGravada,
  execucaoNasLinhas,
  linhasReprecificadas,
  medicaoId,
  periodosDosAditivos,
  precificarLinhaDaMedicao,
  problemaDaAcaoNaMedicao,
  problemaDaCompetencia,
  problemaDaDemandaNaAprovacao,
  problemaDaDemandaNaMedicao,
  problemaDaEdicao,
  problemaDasDatasDaLinha,
  rotuloDaCompetencia,
  rotuloDoStatus,
  tabelaDaLinha,
  totalDaMedicao,
  type AcaoMedicao,
  type ContextoDaMedicao,
  type ItemDoCatalogoDaMedicao,
  type LinhaDaMedicao,
  type LinhaEntradaDaMedicao,
  type StatusMedicao,
  type TabelaDaMedicao,
} from "./medicao.js";
import { actorPayload, digest, runIdempotent, type ComercialActor } from "./operations.js";
import type { ComercialProfile } from "./profile.js";
import {
  FOLGA_DO_RELOGIO_MS,
  actorOf,
  assertComercialCaller,
  conferirNaoFuturo,
  conteudo,
  demandRef,
  instanteComFuso,
  lerContato,
  linkDaEntrada,
  marcosComEtapa,
  quoteRef,
  texto,
  textoOuNull,
  type Dados,
  type QuoteOptions,
} from "./quotes.js";
import { ErroTabela, PRICE_TABLES_COLLECTION, STATUS_TABELA, conferirVariante, type PrecoDaTabela, type StatusTabela } from "./tabelas.js";

/**
 * Medição mensal no backend (docs/plataforma/fase-6-comercial.md, parte 16a):
 * as callables saveMedicao (abrir a medição do mês, incluir ou atualizar uma
 * linha e retirar uma linha, só no rascunho) e advanceMedicao (enviar ao
 * cliente, registrar a aprovação ou a contestação dele e reabrir a
 * contestada).
 *
 * - `medicoes/{contrato_id}_{AAAA-MM}`: uma por contrato e competência, só de
 *   contrato com regime medicao_mensal. A competência repetida é recusada.
 * - O servidor precifica de novo todas as linhas a cada gravação, cada uma
 *   pela tabela do contrato vigente na data da solicitação dela
 *   (medicao.ts); o app manda quantidade e item, e preço e motivo só no item
 *   alterado ou avulso. O envio confere os preços e recusa se algum mudou
 *   desde a última gravação: vai ao cliente o que a pessoa viu.
 * - A linha que cita uma demanda prende a demanda à medição
 *   (`demands.medicao_id`): a mesma demanda não entra em duas medições, e só
 *   entra a demanda cobrada por medição mensal.
 * - Aprovada, a medição cria a autorização de faturamento do tipo
 *   medicao_aprovada (`client_authorizations/aut_{medicao_id}`) e leva a "a
 *   faturar" as demandas que o cliente já tinha fechado, que ficam ligadas a
 *   ela; as outras ficam presas à medição, listadas em `demandas_pendentes`,
 *   e ganham a autorização quando forem validadas (demandas.ts).
 * - Como nas outras callables: requireComercialCaller na callable, safeParse,
 *   a situação e a edição vistas conferidas na transação, leituras antes das
 *   escritas, recibo e evento na mesma transação, e evento sem valor nem
 *   dado pessoal.
 */

// --- Entrada -------------------------------------------------------------------------

const requestId = z.string().trim().min(1, "Informe o request_id.").max(200, "request_id longo demais.");
const idDocumento = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{1,120}$/, "Id inválido.")
  .refine(idDeDocumentoValido, "Id inválido.");
const numeroServico = z.string().trim().regex(/^\d{5,8}$/, "Número da demanda inválido.");
const data = z.string().trim().refine(dataValida, "Data inválida (AAAA-MM-DD).");
const competencia = z.string().trim().refine(competenciaValida, "Competência inválida (AAAA-MM).");
const edicaoVista = z.number().int().min(1);
const obrigatorio = (rotulo: string, max: number) =>
  z.string().trim().min(1, `Informe ${rotulo}.`).max(max, `Use até ${max} caracteres em ${rotulo}.`);

/** A área que pediu (Facilities, Infraestrutura), nunca a pessoa: sem e-mail nem telefone. */
const areaSolicitante = obrigatorio("a área solicitante", 60).refine(
  (valor) => !valor.includes("@") && !/\d{8,}/.test(valor.replace(/[\s().-]/g, "")),
  "Área solicitante: só a área (ex.: Facilities), sem nome, e-mail ou telefone de pessoa.",
);

const itemEntrada = z
  .object({
    lpu_item_id: idDocumento.nullable().optional(),
    quantidade: z.string().trim().min(1, "Informe a quantidade.").max(40),
    origem: z.enum(ORIGENS_ITEM_MEDICAO),
    preco: z.string().trim().max(40).nullable().optional(),
    motivo: z.string().trim().max(300, "Use até 300 caracteres no motivo.").nullable().optional(),
    descricao: z.string().trim().max(300, "Use até 300 caracteres na descrição.").nullable().optional(),
  })
  .strict();

const anexo = z.object({ nome: obrigatorio("o nome do anexo", 200), referencia: obrigatorio("a referência do anexo", 500) }).strict();

const linhaEntrada = z
  .object({
    /** Sem id, linha nova (o servidor dá o id); com id, a linha gravada. */
    id: idDocumento.optional(),
    demanda_numero: numeroServico.nullable().optional(),
    /** A OS como o cliente a chama. */
    os: obrigatorio("a OS", 60),
    /** A data-base do preço da linha. */
    solicitada_em: data,
    area_solicitante: areaSolicitante,
    executada_em: data,
    /** Sem ele, sai da data (sábado, domingo ou dia útil); feriado em dia útil é "domingo_feriado". */
    dia_tipo: z.enum(DIA_TIPOS).optional(),
    janela: z.enum(JANELAS).default("diurna"),
    origem: obrigatorio("a origem", 160),
    destino: obrigatorio("o destino", 160),
    mercadoria: obrigatorio("a mercadoria", 300),
    itens: z
      .array(itemEntrada)
      .min(1, "A linha precisa de ao menos um item.")
      .max(MAXIMO_DE_ITENS_POR_LINHA, `Use até ${MAXIMO_DE_ITENS_POR_LINHA} itens por linha.`),
    anexo: anexo.nullable().optional(),
  })
  .strict();

const Criar = z
  .object({
    action: z.literal("create"),
    request_id: requestId,
    contrato_id: idDocumento,
    competencia,
    /** A variante da tabela do contrato. Padrão: Comercial. */
    variante: z.string().max(60).optional(),
  })
  .strict();
const SalvarLinha = z
  .object({ action: z.literal("upsert_line"), request_id: requestId, medicao_id: idDocumento, expected_edicao: edicaoVista, linha: linhaEntrada })
  .strict();
const RetirarLinha = z
  .object({ action: z.literal("remove_line"), request_id: requestId, medicao_id: idDocumento, expected_edicao: edicaoVista, linha_id: idDocumento })
  .strict();

export const SaveMedicaoInput = z.discriminatedUnion("action", [Criar, SalvarLinha, RetirarLinha]);
export type SaveMedicaoInput = z.infer<typeof SaveMedicaoInput>;

const conferencia = {
  request_id: requestId,
  medicao_id: idDocumento,
  /** A situação e a edição que a tela viu. */
  expected_status: z.enum(STATUS_MEDICAO),
  expected_edicao: edicaoVista,
};

const Enviar = z.object({ action: z.literal("send"), ...conferencia }).strict();
const Aprovar = z
  .object({
    action: z.literal("approve"),
    ...conferencia,
    /** Quando o cliente aprovou, com a hora e o fuso. Padrão: agora. */
    em: instanteComFuso("Aprovada em").optional(),
    /** O e-mail ou o portal da aprovação. */
    link: linkDaEntrada,
    /** Quem aprovou: um contato do cliente. */
    contato_id: idDocumento.nullable().optional(),
  })
  .strict();
const Contestar = z
  .object({ action: z.literal("contest"), ...conferencia, em: instanteComFuso("Contestada em").optional(), nota: obrigatorio("o que o cliente contestou", 1000) })
  .strict();
const Reabrir = z.object({ action: z.literal("reopen"), ...conferencia }).strict();

export const AdvanceMedicaoInput = z.discriminatedUnion("action", [Enviar, Aprovar, Contestar, Reabrir]);
export type AdvanceMedicaoInput = z.infer<typeof AdvanceMedicaoInput>;

export type SaveMedicaoResult = {
  ok: true;
  medicao_id: string;
  competencia: string;
  status: StatusMedicao;
  edicao: number;
  total_cents: number;
  linhas: number;
  /** A linha incluída, atualizada ou retirada. */
  linha_id?: string;
  linhas_reprecificadas: number;
  events: string[];
};

export type DemandaPendente = { numero: string; motivo: string };

export type AdvanceMedicaoResult = {
  ok: true;
  medicao_id: string;
  competencia: string;
  status: StatusMedicao;
  edicao: number;
  total_cents: number;
  /** A ação já estava feita: só devolve o estado atual. */
  ja_feito: boolean;
  autorizacao_id?: string;
  demandas_a_faturar?: string[];
  demandas_pendentes?: DemandaPendente[];
  events: string[];
};

// --- Apoio -----------------------------------------------------------------------------

export function medicaoRef(db: Firestore, id: string): DocumentReference {
  return db.collection(MEDICOES_COLLECTION).doc(id);
}

function linhasDaMedicao(medicao: Dados): LinhaDaMedicao[] {
  return Array.isArray(medicao.linhas) ? (medicao.linhas as LinhaDaMedicao[]) : [];
}

/** Erros do domínio puro viram erro da callable em português (nunca "internal"). */
function comoErroDaCallable(error: unknown): never {
  if (error instanceof ErroMedicao || error instanceof ErroDinheiro) throw new HttpsError("invalid-argument", error.message);
  if (error instanceof ErroTabela) throw new HttpsError("failed-precondition", error.message);
  throw error;
}

function tabelaDoDocumento(id: string, dados: Dados): TabelaDaMedicao {
  const status = (STATUS_TABELA as readonly string[]).includes(String(dados.status)) ? (dados.status as StatusTabela) : "ativa";
  return {
    id,
    customer_code: typeof dados.customer_code === "string" ? dados.customer_code : null,
    contract_id: typeof dados.contract_id === "string" ? dados.contract_id : null,
    variante: String(dados.variante ?? ""),
    vigente_de: String(dados.vigente_de ?? ""),
    vigente_ate: typeof dados.vigente_ate === "string" ? dados.vigente_ate : null,
    status,
    precos: dados.precos && typeof dados.precos === "object" ? (dados.precos as Record<string, PrecoDaTabela>) : {},
  };
}

async function lerTabelasDoCliente(transaction: Transaction, db: Firestore, code: string): Promise<TabelaDaMedicao[]> {
  const snapshot = await transaction.get(db.collection(PRICE_TABLES_COLLECTION).where("customer_code", "==", code));
  return snapshot.docs.map((doc) => tabelaDoDocumento(doc.id, doc.data()));
}

async function lerCatalogo(
  transaction: Transaction,
  db: Firestore,
  ids: Iterable<string>,
  catalogo: Map<string, ItemDoCatalogoDaMedicao> = new Map(),
): Promise<Map<string, ItemDoCatalogoDaMedicao>> {
  const faltam = [...new Set(ids)].filter((id) => !catalogo.has(id));
  if (faltam.length === 0) return catalogo;
  const snapshots = await transaction.getAll(...faltam.map((id) => db.collection(LPU_ITEMS_COLLECTION).doc(id)));
  for (const snapshot of snapshots) {
    if (!snapshot.exists) continue;
    const dados = snapshot.data() ?? {};
    catalogo.set(snapshot.id, {
      id: snapshot.id,
      categoria: textoOuNull(dados.categoria),
      item: texto(dados.item),
      descricao: texto(dados.descricao),
      servico: texto(dados.servico),
      unidade: texto(dados.unidade),
      orcavel: dados.orcavel !== false,
      ativo: dados.ativo !== false,
    });
  }
  return catalogo;
}

type Entrada = LinhaEntradaDaMedicao & { id: string };

/**
 * Precifica as linhas (só leituras): as tabelas do cliente, os itens citados
 * e, quando há diária, os itens da tabela da linha (para achar a diária
 * esperada). Cada linha herda os itens que já tinha na versão gravada.
 */
async function precificar(
  transaction: Transaction,
  db: Firestore,
  medicao: Dados,
  entradas: readonly Entrada[],
): Promise<LinhaDaMedicao[]> {
  const contexto = {
    customer_code: texto(medicao.customer_code),
    contrato_id: texto(medicao.contrato_id),
    variante: texto(medicao.variante) || "Comercial",
  };
  const tabelas = await lerTabelasDoCliente(transaction, db, contexto.customer_code);
  const citados = entradas.flatMap((entrada) => entrada.itens.map((item) => item.lpu_item_id).filter((id): id is string => Boolean(id)));
  const catalogo = await lerCatalogo(transaction, db, citados);

  // A diária esperada sai dos itens da tabela da linha: lidos só quando a linha tem diária.
  const daTabela: string[] = [];
  try {
    for (const entrada of entradas) {
      const tabela = tabelaDaLinha({ ...contexto, tabelas }, entrada.solicitada_em, entrada.janela);
      if (!tabela) continue;
      const temDiaria = entrada.itens.some((item) => {
        const doCatalogo = item.lpu_item_id ? catalogo.get(item.lpu_item_id) : undefined;
        const doCliente = item.lpu_item_id ? tabela.precos[item.lpu_item_id]?.descricao_cliente : undefined;
        return classificarItem({ ...doCatalogo, descricao_cliente: doCliente ?? item.descricao ?? null }).diaria !== null;
      });
      if (temDiaria) daTabela.push(...Object.keys(tabela.precos));
    }
  } catch (error) {
    comoErroDaCallable(error);
  }
  await lerCatalogo(transaction, db, daTabela, catalogo);

  const gravadas = new Map(linhasDaMedicao(medicao).map((linha) => [linha.id, linha]));
  try {
    return entradas.map((entrada) => {
      const herdados = new Set((gravadas.get(entrada.id)?.itens ?? []).map((item) => item.lpu_item_id).filter(Boolean));
      const contextoDaLinha: ContextoDaMedicao = { ...contexto, tabelas, catalogo, herdado: (id) => herdados.has(id) };
      return precificarLinhaDaMedicao(entrada, contextoDaLinha);
    });
  } catch (error) {
    comoErroDaCallable(error);
  }
}

/** Em ordem de execução, depois pela OS (a ordem do Diário de Bordo). */
function emOrdem(linhas: readonly LinhaDaMedicao[]): LinhaDaMedicao[] {
  return [...linhas].sort(
    (a, b) => a.executada_em.localeCompare(b.executada_em) || a.os.localeCompare(b.os, "pt-BR") || a.id.localeCompare(b.id),
  );
}

/** O que a medição grava a cada mudança das linhas: linhas, total, demandas e marcas. */
function resumoDasLinhas(linhas: readonly LinhaDaMedicao[]) {
  return {
    linhas,
    total_cents: totalDaMedicao(linhas),
    demandas: demandasDaMedicao(linhas),
    marcas: contagemDeMarcas(linhas),
  };
}

function conferirEdicao(medicao: Dados, id: string, esperada: number): void {
  if (Number(medicao.edicao) !== esperada) {
    throw new HttpsError(
      "failed-precondition",
      `A medição ${id} mudou desde que foi aberta (edição ${medicao.edicao}, não ${esperada}). Abra de novo para não perder a mudança.`,
    );
  }
}

async function lerMedicao(transaction: Transaction, db: Firestore, id: string): Promise<Dados> {
  const snapshot = await transaction.get(medicaoRef(db, id));
  if (!snapshot.exists) throw new HttpsError("not-found", `Medição ${id} não encontrada.`);
  return snapshot.data() ?? {};
}

type Gravacao = {
  transaction: Transaction;
  db: Firestore;
  operationId: string;
  actor: ComercialActor;
  caller: ComercialProfile;
  iso: string;
  instante: Date;
};

function comum(gravacao: Gravacao, medicao: Dados, id: string) {
  return {
    operation_id: gravacao.operationId,
    entity_id: id,
    customer_code: texto(medicao.customer_code),
    actor: gravacao.actor,
    occurred_at: gravacao.iso,
  };
}

/** A demanda presa à medição, ou solta dela (null). */
function prenderDemanda(gravacao: Gravacao, numero: string, medicaoIdValor: string | null): void {
  gravacao.transaction.update(demandRef(gravacao.db, numero), {
    medicao_id: medicaoIdValor,
    updated_at: FieldValue.serverTimestamp(),
    updated_by: gravacao.caller.uid,
  });
}

// --- saveMedicao ---------------------------------------------------------------------------

type CriarInput = z.infer<typeof Criar>;
type SalvarLinhaInput = z.infer<typeof SalvarLinha>;
type RetirarLinhaInput = z.infer<typeof RetirarLinha>;

/** Abre a medição do mês de um contrato por medição mensal: uma por contrato e competência. */
async function criar(gravacao: Gravacao, input: CriarInput): Promise<{ target_id: string; result: SaveMedicaoResult }> {
  const { transaction, db, caller, iso, instante } = gravacao;
  let variante: string;
  try {
    variante = conferirVariante(input.variante ?? "Comercial");
  } catch (error) {
    throw new HttpsError("invalid-argument", error instanceof Error ? error.message : String(error));
  }
  const id = medicaoId(input.contrato_id, input.competencia);

  // Leituras.
  const contratoRef = db.collection(CONTRACTS_COLLECTION).doc(input.contrato_id);
  const [contratoSnap, medicaoSnap] = await transaction.getAll(contratoRef, medicaoRef(db, id));
  if (!contratoSnap.exists) throw new HttpsError("not-found", `Contrato ${input.contrato_id} não encontrado.`);
  const contrato = contratoSnap.data() ?? {};
  if (!contratoComMedicaoMensal(contrato)) {
    throw new HttpsError(
      "failed-precondition",
      `O contrato ${input.contrato_id} não cobra por medição mensal: as demandas dele seguem o regime do contrato.`,
    );
  }
  // A vigência atual e as anteriores (aditivos): a prorrogação reescreve a do contrato.
  const aditivos = await transaction.get(contratoRef.collection(ADITIVOS_SUBCOLLECTION));
  const anteriores = periodosDosAditivos(aditivos.docs.map((aditivo) => aditivo.data()));
  const problema = problemaDaCompetencia(contrato, input.competencia, instante, anteriores);
  if (problema) throw new HttpsError("failed-precondition", problema);
  if (medicaoSnap.exists) {
    throw new HttpsError(
      "already-exists",
      `A medição de ${rotuloDaCompetencia(input.competencia)} deste contrato já existe (${id}). Abra a que existe.`,
    );
  }
  const customerCode = texto(contrato.customer_code);
  if (!customerCode) throw new HttpsError("failed-precondition", `O contrato ${input.contrato_id} está sem cliente.`);

  // Escritas.
  const quem = actorPayload(gravacao.actor);
  const medicao = {
    id,
    schema_version: MEDICAO_SCHEMA_VERSION,
    customer_code: customerCode,
    contrato_id: input.contrato_id,
    competencia: input.competencia,
    variante,
    status: "rascunho" satisfies StatusMedicao,
    status_desde: iso,
    edicao: 1,
    ...resumoDasLinhas([]),
    enviada_em: null,
    aprovada_em: null,
    aprovacao: null,
    contestacao: null,
    contestacoes_anteriores: [],
    autorizacao_id: null,
    marcos: [{ status: "rascunho", em: iso, por_uid: caller.uid }],
    created_at: FieldValue.serverTimestamp(),
    created_by: quem,
    updated_at: FieldValue.serverTimestamp(),
    updated_by: caller.uid,
  };
  transaction.create(medicaoRef(db, id), medicao);
  const event = createComercialEvent(transaction, db, {
    ...comum(gravacao, medicao, id),
    type: "medicao.created",
    payload: { medicao_id: id, contrato_id: input.contrato_id, competencia: input.competencia, demandas: 0 },
  });
  return {
    target_id: id,
    result: {
      ok: true,
      medicao_id: id,
      competencia: input.competencia,
      status: "rascunho",
      edicao: 1,
      total_cents: 0,
      linhas: 0,
      linhas_reprecificadas: 0,
      events: [event.id],
    },
  };
}

/**
 * Inclui ou atualiza uma linha, no rascunho e na edição vista. Todas as
 * linhas são precificadas de novo, cada uma pela data da solicitação. A
 * demanda citada fica presa à medição; a que sai da última linha, solta.
 */
async function salvarLinha(gravacao: Gravacao, input: SalvarLinhaInput): Promise<{ target_id: string; result: SaveMedicaoResult }> {
  const { transaction, db, operationId, instante } = gravacao;
  const id = input.medicao_id;

  // Leituras.
  const medicao = await lerMedicao(transaction, db, id);
  const problemaDaSituacao = problemaDaEdicao(medicao.status as StatusMedicao);
  if (problemaDaSituacao) throw new HttpsError("failed-precondition", problemaDaSituacao);
  conferirEdicao(medicao, id, input.expected_edicao);
  const competenciaDaMedicao = texto(medicao.competencia);
  const problemaDasDatas = problemaDasDatasDaLinha(input.linha, competenciaDaMedicao, instante);
  if (problemaDasDatas) throw new HttpsError("invalid-argument", problemaDasDatas);

  const gravadas = linhasDaMedicao(medicao);
  const anterior = input.linha.id ? gravadas.find((linha) => linha.id === input.linha.id) : undefined;
  if (input.linha.id && !anterior) throw new HttpsError("not-found", `Linha ${input.linha.id} não encontrada na medição ${id}.`);
  const nova = !anterior;
  if (nova && gravadas.length >= MAXIMO_DE_LINHAS) {
    throw new HttpsError("failed-precondition", `A medição já tem ${MAXIMO_DE_LINHAS} linhas.`);
  }
  const linhaId = anterior?.id ?? `ml_${digest({ operationId }, 16)}`;
  const entrada: Entrada = { ...input.linha, id: linhaId, demanda_numero: input.linha.demanda_numero ?? null, anexo: input.linha.anexo ?? null };
  const outras = gravadas.filter((linha) => linha.id !== linhaId);

  const demandaNova = entrada.demanda_numero ?? null;
  const demandaAntiga = anterior?.demanda_numero ?? null;
  const soltar = demandaAntiga && demandaAntiga !== demandaNova && !outras.some((linha) => linha.demanda_numero === demandaAntiga) ? demandaAntiga : null;
  const prender = demandaNova && demandaNova !== demandaAntiga ? demandaNova : null;
  const refs = [prender, soltar].filter((numero): numero is string => Boolean(numero)).map((numero) => demandRef(db, numero));
  const snapshots = refs.length ? await transaction.getAll(...refs) : [];
  const alvo = { id, customer_code: texto(medicao.customer_code), contrato_id: texto(medicao.contrato_id) };
  for (const snapshot of snapshots) {
    if (!snapshot.exists) throw new HttpsError("not-found", `Demanda ${snapshot.id} não encontrada.`);
    if (snapshot.id === prender) {
      const problema = problemaDaDemandaNaMedicao(snapshot.id, snapshot.data() ?? {}, alvo);
      if (problema) throw new HttpsError("failed-precondition", problema);
    }
  }

  const precificadas = await precificar(transaction, db, medicao, [...outras.map(entradaDaLinhaGravada), entrada]);
  const linhas = emOrdem(precificadas);
  const resumo = resumoDasLinhas(linhas);
  if (resumo.demandas.length > MAXIMO_DE_DEMANDAS) {
    throw new HttpsError("failed-precondition", `A medição passa de ${MAXIMO_DE_DEMANDAS} demandas.`);
  }
  const reprecificadas = linhasReprecificadas(outras, precificadas.filter((linha) => linha.id !== linhaId));

  // Escritas.
  const edicao = Number(medicao.edicao) + 1;
  transaction.update(medicaoRef(db, id), {
    ...resumo,
    edicao,
    updated_at: FieldValue.serverTimestamp(),
    updated_by: gravacao.caller.uid,
  });
  for (const snapshot of snapshots) {
    if (snapshot.id === prender && snapshot.get("medicao_id") !== id) prenderDemanda(gravacao, snapshot.id, id);
    if (snapshot.id === soltar && snapshot.get("medicao_id") === id) prenderDemanda(gravacao, snapshot.id, null);
  }
  const salva = precificadas.find((linha) => linha.id === linhaId) as LinhaDaMedicao;
  const event = createComercialEvent(transaction, db, {
    ...comum(gravacao, medicao, id),
    type: "medicao.line_saved",
    payload: {
      medicao_id: id,
      competencia: competenciaDaMedicao,
      linha_id: linhaId,
      nova,
      edicao,
      demanda: salva.demanda_numero ?? undefined,
      dia_tipo: salva.dia_tipo,
      janela: salva.janela,
      itens: salva.itens.length,
      marcas: salva.marcas,
      linhas_reprecificadas: reprecificadas || undefined,
    },
  });
  return {
    target_id: id,
    result: {
      ok: true,
      medicao_id: id,
      competencia: competenciaDaMedicao,
      status: "rascunho",
      edicao,
      total_cents: resumo.total_cents,
      linhas: linhas.length,
      linha_id: linhaId,
      linhas_reprecificadas: reprecificadas,
      events: [event.id],
    },
  };
}

/** Retira uma linha do rascunho; a demanda dela, se não estiver em outra linha, fica solta. */
async function retirarLinha(gravacao: Gravacao, input: RetirarLinhaInput): Promise<{ target_id: string; result: SaveMedicaoResult }> {
  const { transaction, db } = gravacao;
  const id = input.medicao_id;

  // Leituras.
  const medicao = await lerMedicao(transaction, db, id);
  const problemaDaSituacao = problemaDaEdicao(medicao.status as StatusMedicao);
  if (problemaDaSituacao) throw new HttpsError("failed-precondition", problemaDaSituacao);
  conferirEdicao(medicao, id, input.expected_edicao);
  const gravadas = linhasDaMedicao(medicao);
  const retirada = gravadas.find((linha) => linha.id === input.linha_id);
  if (!retirada) throw new HttpsError("not-found", `Linha ${input.linha_id} não encontrada na medição ${id}.`);
  const outras = gravadas.filter((linha) => linha.id !== input.linha_id);
  const soltar =
    retirada.demanda_numero && !outras.some((linha) => linha.demanda_numero === retirada.demanda_numero) ? retirada.demanda_numero : null;
  const demanda = soltar ? await transaction.get(demandRef(db, soltar)) : null;
  const precificadas = await precificar(transaction, db, medicao, outras.map(entradaDaLinhaGravada));
  const linhas = emOrdem(precificadas);
  const resumo = resumoDasLinhas(linhas);
  const reprecificadas = linhasReprecificadas(outras, precificadas);

  // Escritas.
  const edicao = Number(medicao.edicao) + 1;
  transaction.update(medicaoRef(db, id), { ...resumo, edicao, updated_at: FieldValue.serverTimestamp(), updated_by: gravacao.caller.uid });
  if (demanda?.exists && demanda.get("medicao_id") === id) prenderDemanda(gravacao, demanda.id, null);
  const event = createComercialEvent(transaction, db, {
    ...comum(gravacao, medicao, id),
    type: "medicao.line_removed",
    payload: {
      medicao_id: id,
      competencia: texto(medicao.competencia),
      linha_id: input.linha_id,
      edicao,
      demanda: retirada.demanda_numero ?? undefined,
      linhas_reprecificadas: reprecificadas || undefined,
    },
  });
  return {
    target_id: id,
    result: {
      ok: true,
      medicao_id: id,
      competencia: texto(medicao.competencia),
      status: "rascunho",
      edicao,
      total_cents: resumo.total_cents,
      linhas: linhas.length,
      linha_id: input.linha_id,
      linhas_reprecificadas: reprecificadas,
      events: [event.id],
    },
  };
}

/**
 * Callable saveMedicao: abrir a medição do mês (create), incluir ou atualizar
 * uma linha (upsert_line) e retirar uma linha (remove_line), só no rascunho e
 * na edição vista.
 */
export async function saveMedicaoFor(
  db: Firestore,
  caller: ComercialProfile,
  data: unknown,
  opcoes: QuoteOptions = {},
): Promise<SaveMedicaoResult & { replayed?: true }> {
  assertComercialCaller(caller);
  const input = parseEntrada(SaveMedicaoInput, data);
  const agora = opcoes.agora ?? (() => new Date());
  const actor = actorOf(caller);
  const alvo = input.action === "create" ? medicaoId(input.contrato_id, input.competencia) : input.medicao_id;

  return runIdempotent<SaveMedicaoResult>(
    db,
    { kind: `medicao_${input.action}`, scope: { medicao_id: alvo }, idempotency_key: input.request_id, input: conteudo(input), actor },
    async (transaction, { operationId }) => {
      const instante = agora();
      const gravacao: Gravacao = { transaction, db, operationId, actor, caller, instante, iso: instante.toISOString() };
      switch (input.action) {
        case "create":
          return criar(gravacao, input);
        case "upsert_line":
          return salvarLinha(gravacao, input);
        case "remove_line":
          return retirarLinha(gravacao, input);
      }
    },
  );
}

// --- advanceMedicao ------------------------------------------------------------------------

type AprovarInput = z.infer<typeof Aprovar>;
type ContestarInput = z.infer<typeof Contestar>;

type Trabalho = { target_id: string; result: AdvanceMedicaoResult };

function resultado(id: string, medicao: Dados, status: StatusMedicao, edicao: number, events: string[], extra: Partial<AdvanceMedicaoResult> = {}): Trabalho {
  return {
    target_id: id,
    result: {
      ok: true,
      medicao_id: id,
      competencia: texto(medicao.competencia),
      status,
      edicao,
      total_cents: Number(medicao.total_cents ?? 0),
      ja_feito: false,
      events,
      ...extra,
    },
  };
}

/** A situação nova, com o marco e o instante dela. */
function mudarSituacao(gravacao: Gravacao, medicao: Dados, status: StatusMedicao) {
  const marcos = Array.isArray(medicao.marcos) ? medicao.marcos : [];
  return {
    status,
    status_desde: gravacao.iso,
    marcos: [...marcos, { status, em: gravacao.iso, por_uid: gravacao.caller.uid }],
    edicao: Number(medicao.edicao) + 1,
    updated_at: FieldValue.serverTimestamp(),
    updated_by: gravacao.caller.uid,
  };
}

/**
 * Enviar ao cliente o que a pessoa viu: as linhas são precificadas de novo só
 * para conferir. Se alguma mudou de preço desde a última gravação (uma tabela
 * do contrato carregada no meio), o envio é recusado e nada muda: gravar a
 * medição de novo (qualquer linha) precifica todas, e a pessoa confere antes
 * de enviar.
 */
async function enviar(gravacao: Gravacao, id: string, medicao: Dados): Promise<Trabalho> {
  const { transaction, db } = gravacao;
  const gravadas = linhasDaMedicao(medicao);
  const precificadas = await precificar(transaction, db, medicao, gravadas.map(entradaDaLinhaGravada));
  const reprecificadas = linhasReprecificadas(gravadas, precificadas);
  if (reprecificadas > 0) {
    throw new HttpsError(
      "failed-precondition",
      `O preço de ${reprecificadas} ${reprecificadas === 1 ? "linha" : "linhas"} mudou desde a última gravação (tabela do contrato carregada depois). Grave a medição de novo e confira antes de enviar.`,
    );
  }
  const linhas = emOrdem(gravadas);
  const resumo = resumoDasLinhas(linhas);
  const patch = { ...mudarSituacao(gravacao, medicao, "enviada"), enviada_em: gravacao.iso, envio: { em: gravacao.iso, por_uid: gravacao.caller.uid } };
  transaction.update(medicaoRef(db, id), patch);
  const event = createComercialEvent(transaction, db, {
    ...comum(gravacao, medicao, id),
    type: "medicao.sent",
    payload: {
      medicao_id: id,
      competencia: texto(medicao.competencia),
      edicao: patch.edicao,
      linhas: linhas.length,
      demandas: resumo.demandas.length,
      linhas_com_marca: linhas.filter((linha) => linha.marcas.length > 0).length,
      segundos_desde_anterior: segundosDesde(medicao.status_desde, gravacao.instante),
    },
  });
  return resultado(id, medicao, "enviada", patch.edicao, [event.id]);
}

/**
 * O cliente aprovou a medição enviada: grava a aprovação, cria a autorização
 * de faturamento (medicao_aprovada) e leva a "a faturar" as demandas que o
 * cliente já tinha fechado, ligadas à autorização. Cada demanda é conferida de
 * novo (cliente, contrato, a medição e a cobrança por medição mensal). A que
 * não dá para levar fica como está, presa à medição, listada em
 * demandas_pendentes com o motivo; validada depois, ela ganha a autorização
 * desta medição (demandas.ts). A aprovação registra um fato do cliente e não
 * é bloqueada pelas demandas.
 */
async function aprovar(gravacao: Gravacao, id: string, medicao: Dados, input: AprovarInput): Promise<Trabalho> {
  const { transaction, db, caller, iso } = gravacao;
  const code = texto(medicao.customer_code);
  const em = input.em ?? iso;
  const enviadaEm = typeof medicao.enviada_em === "string" ? medicao.enviada_em : null;
  if (enviadaEm && Date.parse(em) < Date.parse(enviadaEm) - FOLGA_DO_RELOGIO_MS) {
    throw new HttpsError("invalid-argument", "Aprovada em não pode ser antes do envio da medição ao cliente.");
  }

  // Leituras.
  const autorizacaoId = autorizacaoDaMedicaoId(id);
  const autorizacaoRef = db.collection(CLIENT_AUTHORIZATIONS_COLLECTION).doc(autorizacaoId);
  const autorizacaoSnap = await transaction.get(autorizacaoRef);
  if (autorizacaoSnap.exists) {
    throw new HttpsError("failed-precondition", `A autorização ${autorizacaoId} desta medição já existe.`);
  }
  const contato = input.contato_id ? await lerContato(transaction, db, input.contato_id, code) : null;
  const linhas = linhasDaMedicao(medicao);
  const numeros = demandasDaMedicao(linhas);
  const refs = numeros.flatMap((numero) => [demandRef(db, numero), quoteRef(db, numero)]);
  const snapshots = refs.length ? await transaction.getAll(...refs) : [];
  const alvo = { id, customer_code: code, contrato_id: texto(medicao.contrato_id) };

  // Escritas.
  const events: string[] = [];
  const aFaturar: string[] = [];
  const pendentes: Array<{ numero: string; motivo: string }> = [];
  for (let indice = 0; indice < numeros.length; indice += 1) {
    const numero = numeros[indice];
    const [demandaSnap, quoteSnap] = [snapshots[indice * 2], snapshots[indice * 2 + 1]];
    if (!demandaSnap.exists) {
      pendentes.push({ numero, motivo: "demanda não encontrada" });
      continue;
    }
    const demanda = demandaSnap.data() ?? {};
    const quote = quoteSnap.exists ? quoteSnap.data() ?? {} : null;
    const etapaAntes = demanda.etapa as EtapaDemanda;
    // A demanda que mudou de contrato ou de cobrança depois de entrar na linha não é tocada.
    const fora = problemaDaDemandaNaAprovacao(demanda, alvo);
    if (fora) {
      pendentes.push({ numero, motivo: fora });
      continue;
    }
    const orcamento = quote ? { status: String(quote.status), tipo_rv: String(quote.tipo_rv), rv: Number(quote.rv ?? 0) } : null;
    const destino = destinoNaAprovacaoDaMedicao({ ...demanda, etapa: etapaAntes }, orcamento, execucaoNasLinhas(numero, linhas));
    if (destino.tipo === "pendente") {
      pendentes.push({ numero, motivo: destino.motivo });
      continue;
    }

    const patch: Record<string, unknown> = { medicao_pendente: false, autorizacao_id: autorizacaoId };
    if (destino.tipo === "validar") {
      if (destino.registrar_execucao) {
        patch.executado_de = destino.registrar_execucao.de;
        patch.executado_ate = destino.registrar_execucao.ate;
        patch.registro_execucao = { etapa_antes: etapaAntes, rv: destino.rv, em: iso, por_uid: caller.uid, origem: "medicao", medicao_id: id };
      }
      patch.validacao = {
        rv: destino.rv,
        etapa: "a_faturar",
        autorizacao: "medicao_aprovada",
        autorizacao_id: autorizacaoId,
        em,
        por_uid: caller.uid,
        origem: "medicao",
        medicao_id: id,
      };
    }
    let etapaDepois: EtapaDemanda = etapaAntes;
    if (destino.tipo !== "ja_a_faturar") {
      try {
        etapaDepois = etapaDaDemanda({ ...demanda, ...patch }, orcamento);
      } catch {
        etapaDepois = etapaAntes;
      }
      if (etapaDepois !== "a_faturar") {
        pendentes.push({ numero, motivo: `demanda ${etapaAntes}` });
        continue;
      }
      patch.etapa = etapaDepois;
      patch.etapa_desde = iso;
      patch.marcos = marcosComEtapa(demanda, etapaDepois, { em: iso, por_uid: caller.uid });
      if (destino.tipo === "validar" && destino.registrar_execucao) {
        events.push(
          createComercialEvent(transaction, db, {
            ...comum(gravacao, medicao, numero),
            suffix: `execucao_${numero}`,
            type: "demand.execution_registered",
            payload: { numero, executado_de: destino.registrar_execucao.de, executado_ate: destino.registrar_execucao.ate },
          }).id,
        );
      }
      events.push(
        createComercialEvent(transaction, db, {
          ...comum(gravacao, medicao, numero),
          suffix: `etapa_${numero}`,
          type: "demand.stage_changed",
          payload: {
            numero,
            etapa_antes: etapaAntes,
            etapa_depois: etapaDepois,
            segundos_desde_anterior: segundosDesde(demanda.etapa_desde, gravacao.instante),
          },
        }).id,
      );
    }
    transaction.update(demandaSnap.ref, { ...patch, updated_at: FieldValue.serverTimestamp(), updated_by: caller.uid });
    aFaturar.push(numero);
  }

  const aprovacao = {
    em,
    link: input.link ?? null,
    contato_id: contato?.contato_id ?? null,
    registrada_por: caller.uid,
    registrada_em: iso,
  };
  transaction.create(autorizacaoRef, {
    id: autorizacaoId,
    schema_version: CLIENT_AUTHORIZATION_SCHEMA_VERSION,
    tipo: "medicao_aprovada",
    origem: "medicao",
    status: "a_faturar",
    customer_code: code,
    contrato_id: texto(medicao.contrato_id),
    medicao_id: id,
    competencia: texto(medicao.competencia),
    // As demandas autorizadas; a pendente entra quando for validada (demandas.ts).
    demandas: aFaturar,
    demandas_a_faturar: aFaturar,
    demandas_pendentes: pendentes,
    total_cents: Number(medicao.total_cents ?? 0),
    recebida_em: em,
    link: aprovacao.link,
    contato_id: aprovacao.contato_id,
    registrada_por: actorPayload(gravacao.actor),
    registrada_em: iso,
    created_at: FieldValue.serverTimestamp(),
  });
  const patch = {
    ...mudarSituacao(gravacao, medicao, "aprovada"),
    aprovada_em: em,
    aprovacao,
    autorizacao_id: autorizacaoId,
    demandas_a_faturar: aFaturar,
    demandas_pendentes: pendentes,
  };
  transaction.update(medicaoRef(db, id), patch);
  events.unshift(
    createComercialEvent(transaction, db, {
      ...comum(gravacao, medicao, id),
      type: "medicao.approved",
      payload: {
        medicao_id: id,
        competencia: texto(medicao.competencia),
        edicao: patch.edicao,
        autorizacao_id: autorizacaoId,
        demandas: numeros.length,
        demandas_a_faturar: aFaturar.length,
        demandas_pendentes: pendentes.length,
        segundos_desde_anterior: segundosDesde(medicao.status_desde, gravacao.instante),
      },
    }).id,
    createComercialEvent(transaction, db, {
      ...comum(gravacao, medicao, autorizacaoId),
      type: "client_authorization.recorded",
      payload: {
        autorizacao_id: autorizacaoId,
        tipo: "medicao_aprovada",
        contrato_id: texto(medicao.contrato_id),
        demandas: aFaturar,
        a_faturar: aFaturar,
        marcas: [],
        medicao_id: id,
      },
    }).id,
  );
  return resultado(id, medicao, "aprovada", patch.edicao, events, {
    autorizacao_id: autorizacaoId,
    demandas_a_faturar: aFaturar,
    demandas_pendentes: pendentes,
  });
}

/** O cliente contestou a medição enviada: a nota fica na medição (nunca no evento). */
function contestar(gravacao: Gravacao, id: string, medicao: Dados, input: ContestarInput): Trabalho {
  const { transaction, db, caller, iso } = gravacao;
  const em = input.em ?? iso;
  const enviadaEm = typeof medicao.enviada_em === "string" ? medicao.enviada_em : null;
  if (enviadaEm && Date.parse(em) < Date.parse(enviadaEm) - FOLGA_DO_RELOGIO_MS) {
    throw new HttpsError("invalid-argument", "Contestada em não pode ser antes do envio da medição ao cliente.");
  }
  const patch = {
    ...mudarSituacao(gravacao, medicao, "contestada"),
    contestacao: { em, nota: input.nota, registrada_por: caller.uid, registrada_em: iso },
  };
  transaction.update(medicaoRef(db, id), patch);
  const event = createComercialEvent(transaction, db, {
    ...comum(gravacao, medicao, id),
    type: "medicao.contested",
    payload: {
      medicao_id: id,
      competencia: texto(medicao.competencia),
      edicao: patch.edicao,
      segundos_desde_anterior: segundosDesde(medicao.status_desde, gravacao.instante),
    },
  });
  return resultado(id, medicao, "contestada", patch.edicao, [event.id]);
}

/** A contestada volta ao rascunho para o ajuste; a contestação vai para o histórico. */
function reabrir(gravacao: Gravacao, id: string, medicao: Dados): Trabalho {
  const { transaction, db, caller, iso } = gravacao;
  const anteriores = Array.isArray(medicao.contestacoes_anteriores) ? medicao.contestacoes_anteriores : [];
  const patch = {
    ...mudarSituacao(gravacao, medicao, "rascunho"),
    contestacao: null,
    contestacoes_anteriores: [...anteriores, { ...(medicao.contestacao as Dados), reaberta_em: iso, reaberta_por: caller.uid }],
    enviada_em: null,
  };
  transaction.update(medicaoRef(db, id), patch);
  const event = createComercialEvent(transaction, db, {
    ...comum(gravacao, medicao, id),
    type: "medicao.reopened",
    payload: { medicao_id: id, competencia: texto(medicao.competencia), edicao: patch.edicao },
  });
  return resultado(id, medicao, "rascunho", patch.edicao, [event.id]);
}

/**
 * Callable advanceMedicao: enviar ao cliente (send), registrar a aprovação
 * (approve) ou a contestação (contest) do cliente e reabrir a contestada
 * (reopen), conferindo a situação e a edição que a tela viu.
 */
export async function advanceMedicaoFor(
  db: Firestore,
  caller: ComercialProfile,
  data: unknown,
  opcoes: QuoteOptions = {},
): Promise<AdvanceMedicaoResult & { replayed?: true }> {
  assertComercialCaller(caller);
  const input = parseEntrada(AdvanceMedicaoInput, data);
  const agora = opcoes.agora ?? (() => new Date());
  if (input.action === "approve" || input.action === "contest") {
    conferirNaoFuturo(input.em, agora(), input.action === "approve" ? "Aprovada em" : "Contestada em");
  }
  const actor = actorOf(caller);
  const id = input.medicao_id;

  return runIdempotent<AdvanceMedicaoResult>(
    db,
    { kind: `medicao_${input.action}`, scope: { medicao_id: id }, idempotency_key: input.request_id, input: conteudo(input), actor },
    async (transaction, { operationId }) => {
      const instante = agora();
      const gravacao: Gravacao = { transaction, db, operationId, actor, caller, instante, iso: instante.toISOString() };
      const medicao = await lerMedicao(transaction, db, id);
      const status = medicao.status as StatusMedicao;
      const edicao = Number(medicao.edicao);
      const acao = input.action as AcaoMedicao;

      if (acaoDaMedicaoJaFeita(acao, input.expected_status, status)) {
        const atual = resultado(id, medicao, status, edicao, []);
        return { ...atual, result: { ...atual.result, ja_feito: true } };
      }
      if (status !== input.expected_status || edicao !== input.expected_edicao) {
        throw new HttpsError(
          "failed-precondition",
          `A medição ${id} mudou: está ${rotuloDoStatus(status)}, na edição ${edicao}. Abra de novo.`,
        );
      }
      const problema = problemaDaAcaoNaMedicao(acao, status, { linhas: linhasDaMedicao(medicao).length });
      if (problema) throw new HttpsError("failed-precondition", problema);

      switch (input.action) {
        case "send":
          return enviar(gravacao, id, medicao);
        case "approve":
          return aprovar(gravacao, id, medicao, input);
        case "contest":
          return contestar(gravacao, id, medicao, input);
        case "reopen":
          return reabrir(gravacao, id, medicao);
      }
    },
  );
}
