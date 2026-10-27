import { FieldValue, type DocumentData, type Firestore, type Transaction } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";

import type { ColaboradorGravado, VeiculoGravado } from "./cadastro.js";
import { createOperacaoEvent } from "./events.js";
import { colaboradorLido, veiculoLido } from "./gravacao.js";
import { runIdempotent, type OperacaoActor } from "./operations.js";
import {
  SERVICE_ORDERS_COLLECTION,
  SERVICE_ORDER_COUNTERS_COLLECTION,
  agendada,
  cancelada,
  comContatos,
  comItens,
  demandaDiretaSemEscopo,
  equipeDaOs,
  exigirCancelavel,
  exigirPlanejavel,
  fatiaDoSaldo,
  interpretarOs,
  itensSemPreco,
  localDaOs,
  novaOs,
  novaVistoria,
  numeroDaOs,
  osLida,
  problemaDaData,
  problemaParaAbrirOs,
  problemaParaAbrirVistoria,
  problemaParaAgendarOs,
  proximaSequencia,
  referenciaDoLocal,
  saldoDoEscopo,
  todoOSaldo,
  ultimaSequencia,
  veiculosDaOs,
  type AcaoOs,
  type ItemDaOs,
  type LocaisDaOs,
  type OrdemPedida,
  type OsGravada,
  type PessoaDaOs,
} from "./os.js";
import { operacaoCadastroProblem } from "./platform-roles.js";
import type { OperacaoProfile } from "./profile.js";
import { diretaExecutada, fechamentoDaDireta, paraResumo, resumoDaOperacao, type ResumoDaOperacao } from "./revisao.js";

/**
 * Abre, planeja, agenda, muda os itens e cancela a OS
 * (docs/plataforma/fase-3-operacao.md, parte 3.4b). Toda transação lê antes de
 * escrever: a demanda, o orçamento, a revisão fechada, as OS da demanda, os
 * locais e o cadastro da equipe e da frota. Quem muda o saldo (abrir,
 * planejar, mudar itens) grava no contador da demanda: duas transações
 * concorrentes na mesma demanda conflitam ali, e a segunda relê o saldo.
 * O preço da revisão não entra na OS nem no evento. A vistoria (parte
 * 3.11a) nasce aqui também, sem itens, e se agenda e cancela como as outras.
 */

const DEMANDS = "demands";
const QUOTES = "quotes";
const CUSTOMER_LOCATIONS = "customer_locations";
const COLLABORATORS = "collaborators";
const VEHICLES = "vehicles";

export type ResultadoDaOs = { numero: string; edicao: number; demanda: string; numeros: string[] };

export function ator(caller: OperacaoProfile): OperacaoActor {
  return { uid: caller.uid, role: caller.role, email: caller.email, name: caller.name };
}

export function exigirPapel(caller: OperacaoProfile): void {
  const problem = operacaoCadastroProblem(caller.role);
  if (problem) throw new HttpsError("permission-denied", problem);
}

function dados(snapshot: { exists: boolean; data: () => DocumentData | undefined }, mensagem: string): DocumentData {
  if (!snapshot.exists) throw new HttpsError("not-found", mensagem);
  return snapshot.data() ?? {};
}

function textoDoNome(valor: unknown): string | null {
  return typeof valor === "string" && valor.trim() ? valor.trim().slice(0, 160) : null;
}

function hojeEmSaoPaulo(agora = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(agora);
}

const KIND: Record<AcaoOs["action"], string> = {
  create: "os_open",
  survey: "os_survey_open",
  plan: "os_plan",
  schedule: "os_schedule",
  set_items: "os_items",
  cancel: "os_cancel",
};

/** O que a transação fez: as OS gravadas e o evento de cada uma. */
type Efeito =
  | { tipo: "os.created" | "os.planned"; ordens: OsGravada[] }
  | { tipo: "os.survey_opened"; ordens: [OsGravada] }
  | { tipo: "os.scheduled"; ordens: [OsGravada] }
  /** `execucao`: a demanda direta que o cancelamento levou à Execução a orçar. */
  | { tipo: "os.cancelled"; ordens: [OsGravada]; execucao: { id: string; de: string; ate: string; os: number } | null }
  | { tipo: "os.items_changed"; ordens: [OsGravada]; edicaoAntes: number };

export async function saveServiceOrderFor(
  db: Firestore,
  caller: OperacaoProfile,
  data: unknown,
  authorizedCustomer?: string,
): Promise<ResultadoDaOs & { replayed?: true }> {
  exigirPapel(caller);
  const acao = interpretarOs(data);
  return runIdempotent(
    db,
    {
      kind: KIND[acao.action],
      scope: acao.action === "create" || acao.action === "plan" || acao.action === "survey" ? { demanda: acao.demanda } : { numero: acao.numero },
      idempotency_key: acao.idempotency_key,
      input: acao,
      actor: ator(caller),
    },
    async (transaction, { operationId }) => {
      const efeito = await executar(transaction, db, acao, caller);
      for (const os of efeito.ordens) {
        // REST checks the same boundary again in the transaction that writes.
        if (authorizedCustomer !== undefined && os.customer_code !== authorizedCustomer) {
          throw new HttpsError("permission-denied", "Cliente da OS mudou; solicite nova aprovação.");
        }
        createOperacaoEvent(transaction, db, {
          operation_id: operationId,
          suffix: efeito.ordens.length > 1 ? `${efeito.tipo}:${os.numero}` : efeito.tipo,
          type: efeito.tipo,
          entity_id: os.numero,
          customer_code: os.customer_code,
          payload: payloadDoEvento(efeito, os),
          actor: ator(caller),
        });
      }
      if (efeito.tipo === "os.cancelled" && efeito.execucao) {
        createOperacaoEvent(transaction, db, {
          operation_id: operationId,
          suffix: "demand.execution_reviewed",
          type: "demand.execution_reviewed",
          entity_id: efeito.execucao.id,
          customer_code: efeito.ordens[0].customer_code,
          payload: efeito.execucao,
          actor: ator(caller),
        });
      }
      const primeira = efeito.ordens[0];
      return {
        target_id: primeira.numero,
        result: { numero: primeira.numero, edicao: primeira.edicao, demanda: primeira.demanda, numeros: efeito.ordens.map((os) => os.numero) },
      };
    },
  );
}

function composicao(equipe: readonly PessoaDaOs[]) {
  return equipe.map((pessoa) => ({ colaborador_id: pessoa.colaborador_id, papel: pessoa.papel, vinculo: pessoa.vinculo }));
}

function payloadDoEvento(efeito: Efeito, os: OsGravada) {
  switch (efeito.tipo) {
    case "os.created":
      return { id: os.numero, demanda: os.demanda, seq: os.seq, linhas: os.itens.length };
    case "os.survey_opened":
      return {
        id: os.numero,
        demanda: os.demanda,
        seq: os.seq,
        data: os.janela?.data ?? null,
        equipe: composicao(os.equipe),
        veiculos: os.veiculos.map((veiculo) => veiculo.veiculo_id),
      };
    case "os.planned":
      return {
        id: os.numero,
        demanda: os.demanda,
        seq: os.seq,
        linhas: os.itens.length,
        data: os.janela?.data ?? null,
        equipe: composicao(os.equipe),
        veiculos: os.veiculos.map((veiculo) => veiculo.veiculo_id),
      };
    case "os.scheduled":
      return {
        id: os.numero,
        demanda: os.demanda,
        data: os.janela?.data ?? "",
        inicio: os.janela?.inicio ?? null,
        fim: os.janela?.fim ?? null,
        equipe: composicao(os.equipe),
        veiculos: os.veiculos.map((veiculo) => veiculo.veiculo_id),
      };
    case "os.items_changed":
      return { id: os.numero, demanda: os.demanda, linhas: os.itens.length, edicao_antes: efeito.edicaoAntes, edicao_depois: os.edicao };
    case "os.cancelled":
      return { id: os.numero, demanda: os.demanda };
  }
}

async function executar(transaction: Transaction, db: Firestore, acao: AcaoOs, caller: OperacaoProfile): Promise<Efeito> {
  switch (acao.action) {
    case "create":
    case "plan":
      return abrir(transaction, db, acao, caller);
    case "survey":
      return abrirVistoria(transaction, db, acao, caller);
    case "schedule":
      return agendar(transaction, db, acao, caller);
    case "set_items":
      return mudarItens(transaction, db, acao, caller);
    case "cancel":
      return cancelar(transaction, db, acao, caller);
  }
}

// --- Leituras -----------------------------------------------------------------------------

export type Escopo = { demanda: DocumentData; escopoRv: number | null; escopo: ItemDaOs[]; ordens: OsGravada[]; brutos: Map<string, DocumentData> };

/**
 * O escopo da demanda (sem preço) e as OS que já existem dela: a revisão
 * fechada ou, na demanda direta sem escopo fechado, os itens pedidos.
 */
export async function lerEscopo(transaction: Transaction, db: Firestore, numero: string, demanda: DocumentData): Promise<Escopo> {
  const escopoRv = demanda.escopo_rv;
  let linhas: unknown;
  if (typeof escopoRv === "number" && Number.isInteger(escopoRv)) {
    const revisao = dados(
      await transaction.get(db.collection(QUOTES).doc(numero).collection("revisoes").doc(String(escopoRv))),
      "A revisão fechada não está gravada.",
    );
    linhas = revisao.linhas;
  } else if (demandaDiretaSemEscopo(demanda)) {
    linhas = demanda.itens_pedidos;
  } else {
    throw new HttpsError("failed-precondition", "A demanda não tem escopo fechado.");
  }
  const existentes = await transaction.get(db.collection(SERVICE_ORDERS_COLLECTION).where("demanda", "==", numero));
  return {
    demanda,
    escopoRv: typeof escopoRv === "number" ? escopoRv : null,
    escopo: itensSemPreco(linhas),
    ordens: existentes.docs.map((doc) => osLida(doc.id, doc.data())),
    brutos: new Map(existentes.docs.map((doc) => [doc.id, doc.data()])),
  };
}

async function lerLocais(transaction: Transaction, db: Firestore, demanda: DocumentData): Promise<Map<string, DocumentData>> {
  const ids = [referenciaDoLocal(demanda.origem)?.local_id, referenciaDoLocal(demanda.destino)?.local_id].filter(
    (id): id is string => Boolean(id),
  );
  const locais = new Map<string, DocumentData>();
  for (const id of new Set(ids)) {
    const snapshot = await transaction.get(db.collection(CUSTOMER_LOCATIONS).doc(id));
    if (snapshot.exists) locais.set(id, snapshot.data() ?? {});
  }
  return locais;
}

/** O cadastro de quem foi pedido. Quem não existe fica de fora (e a OS recusa). */
async function lerCadastro(
  transaction: Transaction,
  db: Firestore,
  colaboradores: Iterable<string>,
  veiculos: Iterable<string>,
): Promise<{ pessoas: Map<string, ColaboradorGravado>; frota: Map<string, VeiculoGravado> }> {
  const pessoas = new Map<string, ColaboradorGravado>();
  const frota = new Map<string, VeiculoGravado>();
  for (const id of new Set(colaboradores)) {
    const snapshot = await transaction.get(db.collection(COLLABORATORS).doc(id));
    if (snapshot.exists) pessoas.set(id, colaboradorLido(id, snapshot.data() ?? {}));
  }
  for (const id of new Set(veiculos)) {
    const snapshot = await transaction.get(db.collection(VEHICLES).doc(id));
    if (snapshot.exists) frota.set(id, veiculoLido(id, snapshot.data() ?? {}));
  }
  return { pessoas, frota };
}

async function lerOs(transaction: Transaction, db: Firestore, numero: string): Promise<OsGravada> {
  const snapshot = await transaction.get(db.collection(SERVICE_ORDERS_COLLECTION).doc(numero));
  if (!snapshot.exists) throw new HttpsError("not-found", "OS não encontrada.");
  return osLida(numero, snapshot.data() ?? {});
}

export function autoria(caller: OperacaoProfile) {
  return { atualizado_por: { uid: caller.uid, role: caller.role }, updated_at: FieldValue.serverTimestamp() };
}

// --- Abrir e planejar ---------------------------------------------------------------------

async function abrir(
  transaction: Transaction,
  db: Firestore,
  acao: Extract<AcaoOs, { action: "create" | "plan" }>,
  caller: OperacaoProfile,
): Promise<Efeito> {
  const demandaRef = db.collection(DEMANDS).doc(acao.demanda);
  const contadorRef = db.collection(SERVICE_ORDER_COUNTERS_COLLECTION).doc(acao.demanda);
  const demanda = dados(await transaction.get(demandaRef), "Demanda não encontrada.");
  const orcamentoSnap = await transaction.get(db.collection(QUOTES).doc(acao.demanda));
  const contadorSnap = await transaction.get(contadorRef);
  const problema = problemaParaAbrirOs(demanda, orcamentoSnap.exists ? orcamentoSnap.data() ?? {} : null);
  if (problema) throw new HttpsError("failed-precondition", problema);
  const { escopoRv, escopo, ordens: existentes } = await lerEscopo(transaction, db, acao.demanda, demanda);
  const locaisDoCadastro = await lerLocais(transaction, db, demanda);
  const pedidas: OrdemPedida[] = acao.action === "plan" ? acao.ordens : [];
  const { pessoas, frota } = await lerCadastro(
    transaction,
    db,
    pedidas.flatMap((ordem) => (ordem.equipe ?? []).map((pessoa) => pessoa.colaborador_id)),
    pedidas.flatMap((ordem) => ordem.veiculos ?? []),
  );

  const customerCode = String(demanda.customer_code).trim();
  const origem = referenciaDoLocal(demanda.origem);
  const destino = referenciaDoLocal(demanda.destino);
  const locaisDaDemanda = (contatos: OrdemPedida["contatos"]): LocaisDaOs =>
    comContatos(
      {
        origem: localDaOs(origem, origem?.local_id ? locaisDoCadastro.get(origem.local_id) ?? null : null, customerCode, null),
        destino: localDaOs(destino, destino?.local_id ? locaisDoCadastro.get(destino.local_id) ?? null : null, customerCode, null),
      },
      contatos,
    );

  const saldo = saldoDoEscopo(escopo, existentes);
  const hoje = hojeEmSaoPaulo();
  let seq = proximaSequencia(ultimaSequencia(contadorSnap.exists ? contadorSnap.data()?.ultimo : 0, existentes));
  const criadas: OsGravada[] = [];
  const ordens: OrdemPedida[] = acao.action === "plan" ? acao.ordens : [{ itens: [] }];
  for (const [indice, ordem] of ordens.entries()) {
    if (indice > 0) seq = proximaSequencia(seq);
    const itens = acao.action === "plan" ? fatiaDoSaldo(escopo, saldo, ordem.itens) : todoOSaldo(escopo, saldo);
    if (ordem.janela) {
      const problemaDaJanela = problemaDaData(ordem.janela.data, hoje);
      if (problemaDaJanela) throw new HttpsError("invalid-argument", ordens.length > 1 ? `OS ${indice + 1}: ${problemaDaJanela}` : problemaDaJanela);
    }
    const { equipe, equipe_uids } = equipeDaOs(ordem.equipe ?? [], pessoas);
    criadas.push(
      novaOs({
        numero: numeroDaOs(acao.demanda, seq),
        demanda: acao.demanda,
        seq,
        customer_code: customerCode,
        cliente_nome: textoDoNome(demanda.customer_name),
        escopo_rv: escopoRv,
        itens,
        locais: locaisDaDemanda(ordem.contatos),
        janela: ordem.janela ?? null,
        equipe,
        equipe_uids,
        veiculos: veiculosDaOs(ordem.veiculos ?? [], frota, ordem.janela?.data ?? null),
        instrucoes: ordem.instrucoes ?? null,
      }),
    );
  }

  transaction.set(contadorRef, { demanda: acao.demanda, ultimo: seq, updated_at: FieldValue.serverTimestamp() });
  for (const os of criadas) {
    transaction.create(db.collection(SERVICE_ORDERS_COLLECTION).doc(os.numero), {
      ...os,
      id: os.numero,
      ...autoria(caller),
      created_at: FieldValue.serverTimestamp(),
    });
  }
  transaction.update(demandaRef, { os_numeros: FieldValue.arrayUnion(...criadas.map((os) => os.numero)) });
  return { tipo: acao.action === "plan" ? "os.planned" : "os.created", ordens: criadas };
}

// --- Vistoria ----------------------------------------------------------------------------

/**
 * Abre a vistoria da demanda (parte 3.11a): o número vem do mesmo contador
 * das OS, o local da origem da demanda (com o contato no local, se pedido),
 * e, com a janela, a OS já nasce agendada com a equipe e os veículos.
 */
async function abrirVistoria(
  transaction: Transaction,
  db: Firestore,
  acao: Extract<AcaoOs, { action: "survey" }>,
  caller: OperacaoProfile,
): Promise<Efeito> {
  const demandaRef = db.collection(DEMANDS).doc(acao.demanda);
  const contadorRef = db.collection(SERVICE_ORDER_COUNTERS_COLLECTION).doc(acao.demanda);
  const demanda = dados(await transaction.get(demandaRef), "Demanda não encontrada.");
  const contadorSnap = await transaction.get(contadorRef);
  const existentes = (await transaction.get(db.collection(SERVICE_ORDERS_COLLECTION).where("demanda", "==", acao.demanda))).docs.map((doc) =>
    osLida(doc.id, doc.data()),
  );
  const problema = problemaParaAbrirVistoria(demanda, existentes);
  if (problema) throw new HttpsError("failed-precondition", problema);
  if (acao.janela) {
    const problemaDaJanela = problemaDaData(acao.janela.data, hojeEmSaoPaulo());
    if (problemaDaJanela) throw new HttpsError("invalid-argument", problemaDaJanela);
  }
  const locaisDoCadastro = await lerLocais(transaction, db, demanda);
  const { pessoas, frota } = await lerCadastro(
    transaction,
    db,
    (acao.equipe ?? []).map((pessoa) => pessoa.colaborador_id),
    acao.veiculos ?? [],
  );

  const customerCode = String(demanda.customer_code).trim();
  const origem = referenciaDoLocal(demanda.origem);
  const seq = proximaSequencia(ultimaSequencia(contadorSnap.exists ? contadorSnap.data()?.ultimo : 0, existentes));
  const { equipe, equipe_uids } = equipeDaOs(acao.equipe ?? [], pessoas);
  const os = novaVistoria({
    numero: numeroDaOs(acao.demanda, seq),
    demanda: acao.demanda,
    seq,
    customer_code: customerCode,
    cliente_nome: textoDoNome(demanda.customer_name),
    // A vistoria é no local de origem da demanda (onde está o que se vai levantar).
    locais: comContatos(
      { origem: localDaOs(origem, origem?.local_id ? locaisDoCadastro.get(origem.local_id) ?? null : null, customerCode, null), destino: null },
      acao.contatos ? { origem: acao.contatos.origem } : undefined,
    ),
    janela: acao.janela ?? null,
    equipe,
    equipe_uids,
    veiculos: veiculosDaOs(acao.veiculos ?? [], frota, acao.janela?.data ?? null),
    instrucoes: acao.instrucoes ?? null,
  });

  transaction.set(contadorRef, { demanda: acao.demanda, ultimo: seq, updated_at: FieldValue.serverTimestamp() });
  transaction.create(db.collection(SERVICE_ORDERS_COLLECTION).doc(os.numero), {
    ...os,
    id: os.numero,
    ...autoria(caller),
    created_at: FieldValue.serverTimestamp(),
  });
  transaction.update(demandaRef, { os_numeros: FieldValue.arrayUnion(os.numero) });
  return { tipo: "os.survey_opened", ordens: [os] };
}

// --- Agendar ------------------------------------------------------------------------------

async function agendar(
  transaction: Transaction,
  db: Firestore,
  acao: Extract<AcaoOs, { action: "schedule" }>,
  caller: OperacaoProfile,
): Promise<Efeito> {
  const data = problemaDaData(acao.janela.data, hojeEmSaoPaulo());
  if (data) throw new HttpsError("invalid-argument", data);
  const atual = exigirPlanejavel(await lerOs(transaction, db, acao.numero), acao.numero, acao.expected_edicao, "agendada");
  const demanda = dados(await transaction.get(db.collection(DEMANDS).doc(atual.demanda)), "Demanda não encontrada.");
  const problema = problemaParaAgendarOs(demanda);
  if (problema) throw new HttpsError("failed-precondition", problema);
  const { pessoas, frota } = await lerCadastro(
    transaction,
    db,
    acao.equipe.map((pessoa) => pessoa.colaborador_id),
    acao.veiculos,
  );
  const { equipe, equipe_uids } = equipeDaOs(acao.equipe, pessoas);
  const os = agendada(atual, {
    janela: acao.janela,
    equipe,
    equipe_uids,
    veiculos: veiculosDaOs(acao.veiculos, frota, acao.janela.data),
    instrucoes: acao.instrucoes,
    contatos: acao.contatos,
  });
  transaction.update(db.collection(SERVICE_ORDERS_COLLECTION).doc(os.numero), {
    status: os.status,
    edicao: os.edicao,
    // O nome do cliente vem da demanda a cada agendamento (a OS de antes da parte 3.8a ganha o dela).
    cliente_nome: textoDoNome(demanda.customer_name) ?? os.cliente_nome,
    janela: os.janela,
    equipe: os.equipe,
    equipe_uids: os.equipe_uids,
    veiculos: os.veiculos,
    instrucoes: os.instrucoes,
    locais: os.locais,
    // A agenda de antes da parte 3.4 sai: a janela, a equipe e os veículos a substituem.
    agenda: FieldValue.delete(),
    ...autoria(caller),
  });
  return { tipo: "os.scheduled", ordens: [os] };
}

// --- Itens --------------------------------------------------------------------------------

async function mudarItens(
  transaction: Transaction,
  db: Firestore,
  acao: Extract<AcaoOs, { action: "set_items" }>,
  caller: OperacaoProfile,
): Promise<Efeito> {
  const atual = exigirPlanejavel(await lerOs(transaction, db, acao.numero), acao.numero, acao.expected_edicao, "alterada");
  // A vistoria não tem escopo: recusa antes de procurar um.
  if (atual.tipo === "vistoria") comItens(atual, [], null);
  const demanda = dados(await transaction.get(db.collection(DEMANDS).doc(atual.demanda)), "Demanda não encontrada.");
  const contadorRef = db.collection(SERVICE_ORDER_COUNTERS_COLLECTION).doc(atual.demanda);
  await transaction.get(contadorRef);
  const problema = problemaParaAgendarOs(demanda);
  if (problema) throw new HttpsError("failed-precondition", problema);
  const { escopoRv, escopo, ordens } = await lerEscopo(transaction, db, atual.demanda, demanda);
  const saldo = saldoDoEscopo(escopo, ordens, atual.numero);
  const os = comItens(atual, fatiaDoSaldo(escopo, saldo, acao.itens), escopoRv);
  transaction.set(contadorRef, { demanda: atual.demanda, updated_at: FieldValue.serverTimestamp() }, { merge: true });
  transaction.update(db.collection(SERVICE_ORDERS_COLLECTION).doc(os.numero), {
    itens: os.itens,
    servicos: os.servicos,
    escopo_rv: os.escopo_rv,
    edicao: os.edicao,
    ...autoria(caller),
  });
  return { tipo: "os.items_changed", ordens: [os], edicaoAntes: atual.edicao };
}

// --- Cancelar -----------------------------------------------------------------------------

async function cancelar(
  transaction: Transaction,
  db: Firestore,
  acao: Extract<AcaoOs, { action: "cancel" }>,
  caller: OperacaoProfile,
): Promise<Efeito> {
  const atual = exigirCancelavel(await lerOs(transaction, db, acao.numero), acao.numero, acao.expected_edicao);
  const os = cancelada(atual, acao.motivo, { uid: caller.uid, nome: caller.name ?? null }, new Date().toISOString());
  // Com OS já revisada, o resumo da demanda se reconta sem a cancelada; sem
  // outra em aberto, a direta vai à Execução a orçar, como na revisão.
  const demandaRef = db.collection(DEMANDS).doc(os.demanda);
  const demanda = (await transaction.get(demandaRef)).data();
  let resumo: ResumoDaOperacao | null = null;
  if (demanda?.operacao) {
    const existentes = await transaction.get(db.collection(SERVICE_ORDERS_COLLECTION).where("demanda", "==", os.demanda));
    const brutos = new Map(existentes.docs.map((doc) => [doc.id, doc.data()]));
    const dados = { ...brutos.get(os.numero), status: os.status, cancelamento: os.cancelamento };
    resumo = resumoDaOperacao(paraResumo(existentes.docs.map((doc) => osLida(doc.id, doc.data())), brutos, os.numero, os.status, dados), new Date());
  }

  transaction.update(db.collection(SERVICE_ORDERS_COLLECTION).doc(os.numero), {
    status: os.status,
    edicao: os.edicao,
    cancelamento: os.cancelamento,
    ...autoria(caller),
  });
  if (!demanda || !resumo) return { tipo: "os.cancelled", ordens: [os], execucao: null };
  const patch: Record<string, unknown> = { operacao: resumo, updated_at: FieldValue.serverTimestamp(), updated_by: caller.uid };
  const executada = diretaExecutada(demanda, resumo) && resumo.periodo ? resumo.periodo : null;
  if (executada) Object.assign(patch, fechamentoDaDireta(demanda, executada, resumo.atualizado_em, caller.uid));
  transaction.update(demandaRef, patch);
  return { tipo: "os.cancelled", ordens: [os], execucao: executada ? { id: os.demanda, de: executada.de, ate: executada.ate, os: resumo.os_revisadas.length } : null };
}
