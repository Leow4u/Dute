import { createHash, randomBytes } from "node:crypto";

import { FieldValue, type DocumentReference, type Firestore, type Transaction } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";

import type { OperationalActor } from "../operations.js";

import { ROTULO_DO_MOMENTO, TIPOS_DE_MOMENTO, edicaoAberta, labelPadrao, type MomentoPrevisto, type StatusDaEdicao, type TipoDeMomento } from "./dominio.js";
import {
  problemaDaFormaDoCronograma,
  problemaDoPatch,
  problemaParaEnviar,
  viewDaEdicao,
  type ActorRef,
  type ArquivarEvento,
  type CancelarEdicao,
  type Conteudo,
  type CriarEdicao,
  type EdicaoView,
  type EnviarEdicao,
  type ItemDaEdicao,
  type MomentoPrevistoEntrada,
  type PatchDaEdicao,
} from "./edicao.js";
import { createEventoEvent } from "./eventos-auditoria.js";

/**
 * A gravação da edição do evento (docs/superpowers/specs/2026-11-26-eventos-design.md,
 * "O evento e a edição", "Os status e quem move cada um" e "As callables"):
 * nascer, mudar, enviar, cancelar ou excluir, e arquivar o evento. Uma
 * transação por ação, as leituras antes de qualquer escrita, o evento de
 * auditoria na mesma transação. A criação tem o id pela chave de
 * idempotência e o patch, o CAS por `edicao`; enviar, cancelar e arquivar
 * gravam o recibo em operational_operations, no molde de count-rounds.ts.
 * O dinheiro (o valor declarado da coleta) vai a client_event_prices, nunca
 * à edição. Nesta parte o envio ainda não cria a solicitação (parte 6).
 */

export const EVENTOS_COLLECTION = "client_events";
export const EDICOES_COLLECTION = "client_event_editions";
export const PRECOS_COLLECTION = "client_event_prices";
export const OPERATIONS_COLLECTION = "operational_operations";
const CLIENT_INVENTORY_COLLECTION = "client_inventory";
/** O limite de valores de um filtro `in` do Firestore. */
const BLOCO_DO_IN = 30;

const COORDENACAO = ["owner", "admin", "interno"];

type Data = Record<string, unknown>;

export type { ActorRef } from "./edicao.js";
/** A entrada já com o cliente que a callable resolveu (requireCustomerScope). */
export type NoCliente<T> = T & { customer_code: string };
export type AtorDoCliente = OperationalActor & { customer_code: string };

// ------------------------------------------------------------------ apoio

/** Quem grava `created_by`, `updated_by` e companhia: o formato do actorRef de client-events.ts. */
export function actorRef(actor: OperationalActor): ActorRef {
  return { uid: actor.uid, name: actor.name ?? null, role: actor.role };
}

/** O ator do recibo, como count-rounds.ts. */
function actorFields(actor: OperationalActor) {
  return Object.fromEntries(
    Object.entries({ uid: actor.uid, role: actor.role, email: actor.email, name: actor.name }).filter(([, value]) => value !== undefined),
  );
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Data)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  }
  return value;
}

function digest(value: unknown, length = 32) {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex").slice(0, length);
}

function registro(value: unknown): Data {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Data) : {};
}

function lista(value: unknown): Data[] {
  return Array.isArray(value) ? value.map(registro) : [];
}

function texto(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** O id que a callable recebe vira caminho de documento: barra e os nomes reservados não são id de nada. */
function idDeDocumento(id: string): boolean {
  return Boolean(id) && !id.includes("/") && id !== "." && id !== ".." && !/^__.*__$/.test(id);
}

/**
 * Os carimbos desta escrita: no documento, a hora do servidor
 * (FieldValue.serverTimestamp); na resposta, a hora desta chamada, o mesmo
 * `agora` que a view converte em ISO.
 */
function carimbar(dados: Data, agora: Date): Data {
  return Object.fromEntries(Object.entries(dados).map(([chave, valor]) => [chave, valor === agora ? FieldValue.serverTimestamp() : valor]));
}

const edicaoNaoEncontrada = () => new HttpsError("not-found", "Edição não encontrada.");
const eventoNaoEncontrado = () => new HttpsError("not-found", "Evento não encontrado.");

/** "<nome do evento> · <label>", a descrição dos eventos de auditoria, sem contato nem valor (também a dos arquivos, parte 3). */
export function descricaoDaEdicao(nome: unknown, label: unknown): string {
  const rotulo = texto(label);
  return rotulo ? `${String(nome ?? "")} · ${rotulo}` : String(nome ?? "");
}

/** A edição do cliente, lida na transação: a de outro cliente não existe para ele. */
export async function lerEdicaoDoCliente(
  transaction: Transaction,
  db: Firestore,
  editionId: string,
  customerCode: string,
): Promise<{ ref: DocumentReference; data: Data }> {
  if (!idDeDocumento(editionId)) throw edicaoNaoEncontrada();
  const ref = db.collection(EDICOES_COLLECTION).doc(editionId);
  const snapshot = await transaction.get(ref);
  const data = snapshot.data();
  if (!snapshot.exists || !data || data.customer_code !== customerCode) throw edicaoNaoEncontrada();
  return { ref, data };
}

/**
 * O tamanho e o tipo de cada SKU, de client_inventory do cliente, lidos na
 * transação (antes de qualquer escrita), em blocos do `in`.
 */
export async function tamanhoETipoDosItens(
  transaction: Transaction,
  db: Firestore,
  customerCode: string,
  skuCodes: readonly string[],
): Promise<Map<string, { size: string | null; category: string | null }>> {
  const unicos = [...new Set(skuCodes.filter((sku) => typeof sku === "string" && sku))];
  const mapa = new Map<string, { size: string | null; category: string | null }>();
  for (let inicio = 0; inicio < unicos.length; inicio += BLOCO_DO_IN) {
    const bloco = unicos.slice(inicio, inicio + BLOCO_DO_IN);
    const snapshot = await transaction.get(
      db.collection(CLIENT_INVENTORY_COLLECTION).where("customer_code", "==", customerCode).where("sku_code", "in", bloco),
    );
    for (const documento of snapshot.docs) {
      const dados = documento.data();
      mapa.set(String(dados.sku_code), { size: texto(dados.size), category: texto(dados.category) });
    }
  }
  return mapa;
}

// ------------------------------------------------------- o documento gravado

function ondeGravada(onde: Conteudo["onde"]) {
  return {
    local: onde?.local ?? null,
    endereco: onde?.endereco ?? null,
    contato: { nome: onde?.contato?.nome ?? null, telefone: onde?.contato?.telefone ?? null },
  };
}

function coletaGravada(coleta: Conteudo["coleta"]) {
  return { onde: coleta?.onde ?? null, quantidade: coleta?.quantidade ?? 0, voltou: null, distribuidos: null };
}

/** Os itens com o tamanho e o tipo da projeção; o que veio no patch só vale sem o campo lá. */
function itensGravados(itens: readonly ItemDaEdicao[], projecao: Map<string, { size: string | null; category: string | null }>) {
  return itens.map((item) => {
    const daProjecao = projecao.get(item.sku_code);
    return {
      sku_code: item.sku_code,
      client_item_code: item.client_item_code ?? null,
      product_name: item.product_name,
      size: daProjecao?.size ?? item.size ?? null,
      category: daProjecao?.category ?? item.category ?? null,
      quantity: item.quantity,
      foi: null,
      voltou: null,
      avariadas: null,
      nao_voltaram: null,
      observacao: null,
    };
  });
}

function pecas(itens: ReadonlyArray<{ quantity: number }>): number {
  return itens.reduce((soma, item) => soma + item.quantity, 0);
}

function previstoGravado(linha: MomentoPrevistoEntrada) {
  return { data: linha.data, hora: linha.hora ?? null, ate: linha.ate ?? null, local: linha.local ?? null, observacao: linha.observacao ?? null };
}

/** O cronograma gravado como o domínio o lê (labelPadrao). */
function previstos(cronograma: readonly Data[]): MomentoPrevisto[] {
  return cronograma.map((momento) => {
    const previsto = registro(momento.previsto);
    return { tipo: momento.tipo as TipoDeMomento, data: String(previsto.data ?? ""), hora: texto(previsto.hora) };
  });
}

function nomeDoMomento(momento: Data): string {
  if (momento.tipo === "outro") return texto(momento.rotulo) ?? ROTULO_DO_MOMENTO.outro;
  return ROTULO_DO_MOMENTO[momento.tipo as TipoDeMomento] ?? "O momento";
}

/** Os momentos que uma foto ou um documento citam (parte 3): não saem do cronograma. */
function momentosLigados(edicao: Data): Set<string> {
  const ids = [...lista(edicao.fotos), ...lista(edicao.documentos)].map((arquivo) => texto(arquivo.momento_id));
  return new Set(ids.filter((id): id is string => Boolean(id)));
}

/**
 * O cronograma novo sobre o gravado: cada linha casa com o momento do mesmo
 * id (e do mesmo tipo) ou, sem id e fora do outro, com o do mesmo tipo; o
 * casado mantém o id e o feito e troca só o previsto (e o rótulo, no outro);
 * a linha sem par ganha id novo e feito null. O momento gravado que fica sem
 * linha e tem feito, foto ou documento recusa. Grava na ordem dos tipos, com
 * os outros por último, como o formulário mostra: a ordem das datas do
 * domínio (problemaDoCronograma) lê a ordem da lista.
 */
export function fundirCronograma(gravado: readonly Data[], linhas: readonly MomentoPrevistoEntrada[], ligados: ReadonlySet<string>): Data[] {
  const usados = new Set<string>();
  const ids = new Set(gravado.map((momento) => String(momento.id ?? "")));
  const novoId = () => {
    let id: string;
    do id = `mo_${randomBytes(4).toString("hex")}`;
    while (ids.has(id));
    ids.add(id);
    return id;
  };
  const fundido = linhas.map((linha) => {
    const par = gravado.find(
      (momento) => !usados.has(String(momento.id)) && momento.tipo === linha.tipo && (linha.id ? momento.id === linha.id : linha.tipo !== "outro"),
    );
    if (par) usados.add(String(par.id));
    return {
      id: par ? String(par.id) : novoId(),
      tipo: linha.tipo,
      rotulo: linha.tipo === "outro" ? linha.rotulo ?? null : null,
      previsto: previstoGravado(linha),
      feito: par ? par.feito ?? null : null,
    };
  });
  for (const momento of gravado) {
    if (usados.has(String(momento.id))) continue;
    if (momento.feito != null || ligados.has(String(momento.id))) {
      throw new HttpsError("failed-precondition", `${nomeDoMomento(momento)} já tem registro e não sai do cronograma`);
    }
  }
  const ordem = (tipo: TipoDeMomento) => TIPOS_DE_MOMENTO.indexOf(tipo);
  return fundido.sort((a, b) => ordem(a.tipo) - ordem(b.tipo));
}

/**
 * O label depois do patch, ou undefined quando não muda: o que veio (o vazio
 * volta ao padrão) ou, com o cronograma novo, o ano do evento enquanto o
 * label for o padrão (o vazio ou o ano da data de antes).
 */
function labelDoPatch(edicao: Data, patch: Conteudo, cronogramaNovo: readonly Data[] | null): string | null | undefined {
  const cronograma = cronogramaNovo ?? lista(edicao.cronograma);
  if (patch.label !== undefined) return texto(patch.label) ?? labelPadrao(previstos(cronograma));
  if (!cronogramaNovo) return undefined;
  const atual = texto(edicao.label);
  if (atual !== null && atual !== labelPadrao(previstos(lista(edicao.cronograma)))) return undefined;
  const novo = labelPadrao(previstos(cronogramaNovo));
  return novo === atual ? undefined : novo;
}

/** O que o patch muda na capa: só o nome e a descrição que diferem do gravado. */
function mudancaDaCapa(capa: Data, evento: Conteudo["evento"]): Data {
  const mudanca: Data = {};
  if (!evento) return mudanca;
  if (evento.name !== undefined && evento.name !== capa.name) mudanca.name = evento.name;
  if (evento.description !== undefined) {
    const descricao = texto(evento.description);
    if (descricao !== texto(capa.description)) mudanca.description = descricao;
  }
  return mudanca;
}

// ------------------------------------------------------------------ salvar

export type ResultadoDoSalvar = { id: string; edicao: number; created: boolean; edition: EdicaoView };

/** Sem `id`, cria o evento (ou usa o existente) e a edição em rascunho; com `id`, aplica o patch. */
export async function saveEventEditionTransaction(
  db: Firestore,
  input: NoCliente<CriarEdicao> | NoCliente<PatchDaEdicao>,
  actor: AtorDoCliente,
): Promise<ResultadoDoSalvar> {
  return "idempotency_key" in input ? criarEdicao(db, input, actor) : mudarEdicao(db, input, actor);
}

function conferirForma(conteudo: Conteudo) {
  if (!conteudo.cronograma) return;
  const forma = problemaDaFormaDoCronograma(conteudo.cronograma);
  if (forma) throw new HttpsError("invalid-argument", forma);
}

async function criarEdicao(db: Firestore, input: NoCliente<CriarEdicao>, actor: AtorDoCliente): Promise<ResultadoDoSalvar> {
  const customerCode = input.customer_code;
  const conteudo: Conteudo = input.patch ?? {};
  const problema = problemaDoPatch("rascunho", actor.role, conteudo);
  if (problema) throw new HttpsError("failed-precondition", problema);
  conferirForma(conteudo);
  const editionId = `ced_${digest({ customer: customerCode, nonce: input.idempotency_key }, 16)}`;
  const eventId = input.event_id ?? `cve_${digest({ customer: customerCode, nonce: `evento:${input.idempotency_key}` }, 16)}`;
  if (!idDeDocumento(eventId)) throw eventoNaoEncontrado();
  const editionRef = db.collection(EDICOES_COLLECTION).doc(editionId);
  const eventRef = db.collection(EVENTOS_COLLECTION).doc(eventId);
  const priceRef = db.collection(PRECOS_COLLECTION).doc(editionId);

  return db.runTransaction(async (transaction) => {
    const existente = await transaction.get(editionRef);
    if (existente.exists) {
      const data = existente.data() ?? {};
      if (data.customer_code !== customerCode) throw edicaoNaoEncontrada();
      // A repetição da criação (clique duplo, nova tentativa) devolve a edição que já nasceu.
      return { id: editionId, edicao: Number(data.edicao ?? 1), created: false, edition: viewDaEdicao(editionId, data) };
    }
    const capaLida = await transaction.get(eventRef);
    const capa = capaLida.data();
    // O evento dado (ou o desta chave, que ficou com outra edição) tem de ser do cliente e ativo.
    if ((input.event_id || capaLida.exists) && (!capaLida.exists || !capa || capa.customer_code !== customerCode || capa.status !== "active")) {
      throw eventoNaoEncontrado();
    }
    if (input.origem_edicao_id) await lerEdicaoDoCliente(transaction, db, input.origem_edicao_id, customerCode);
    const projecao = conteudo.itens?.length
      ? await tamanhoETipoDosItens(transaction, db, customerCode, conteudo.itens.map((item) => item.sku_code))
      : new Map<string, { size: string | null; category: string | null }>();

    const agora = new Date();
    const autor = actorRef(actor);
    const cronograma = conteudo.cronograma ? fundirCronograma([], conteudo.cronograma, new Set()) : [];
    const itens = conteudo.itens ? itensGravados(conteudo.itens, projecao) : [];
    const label = texto(conteudo.label) ?? labelPadrao(previstos(cronograma));

    let nomeDoEvento: string;
    if (capa) {
      const mudanca = mudancaDaCapa(capa, conteudo.evento);
      nomeDoEvento = String(mudanca.name ?? capa.name ?? "");
      transaction.update(
        eventRef,
        carimbar(
          { ...mudanca, editions_count: Number(capa.editions_count ?? 0) + 1, last_edition_id: editionId, last_edition_label: label, updated_by: autor, updated_at: agora },
          agora,
        ),
      );
    } else {
      nomeDoEvento = conteudo.evento?.name ?? input.name ?? "";
      const descricao = conteudo.evento?.description !== undefined ? texto(conteudo.evento.description) : input.description ?? null;
      transaction.create(
        eventRef,
        carimbar(
          {
            id: eventId,
            customer_code: customerCode,
            name: nomeDoEvento,
            description: descricao,
            status: "active",
            editions_count: 1,
            last_edition_id: editionId,
            last_edition_label: label,
            created_by: autor,
            created_at: agora,
            updated_by: autor,
            updated_at: agora,
            archived_by: null,
            archived_at: null,
          },
          agora,
        ),
      );
    }

    const documento: Data = {
      id: editionId,
      customer_code: customerCode,
      event_id: eventId,
      event_name: nomeDoEvento,
      label,
      status: "rascunho",
      edicao: 1,
      origem_edicao_id: input.origem_edicao_id ?? null,
      onde: ondeGravada(conteudo.onde),
      cronograma,
      itens,
      itens_total: itens.length,
      pecas_total: pecas(itens),
      coleta: coletaGravada(conteudo.coleta),
      observacoes: texto(conteudo.observacoes),
      observacoes_dutelog: null,
      documentos: [],
      fotos: [],
      equipe: { estoquistas: null, do_cliente: null, veiculo: null, contato_no_local: null },
      separar_ate: null,
      pedido: null,
      retorno: null,
      enviada_em: null,
      confirmada_em: null,
      fechada_em: null,
      cancelada_em: null,
      cancelada_por: null,
      cancelamento_motivo: null,
      created_by: autor,
      created_at: agora,
      updated_by: autor,
      updated_at: agora,
    };
    transaction.create(editionRef, carimbar(documento, agora));
    // set, não create: um preço órfão desta chave (de um rascunho excluído) é deste rascunho.
    transaction.set(
      priceRef,
      carimbar(
        {
          id: editionId,
          edition_id: editionId,
          event_id: eventId,
          customer_code: customerCode,
          valor_declarado_cents: conteudo.coleta?.valor_declarado_cents ?? null,
          fechado_cents: null,
          fechado_observacao: null,
          fechado_por: null,
          fechado_em: null,
          documentos: [],
          updated_at: agora,
        },
        agora,
      ),
    );
    createEventoEvent(
      transaction,
      db,
      {
        type: "evento.edicao_salva",
        customer_code: customerCode,
        edition_id: editionId,
        descricao: descricaoDaEdicao(nomeDoEvento, label),
        payload: { edition_id: editionId, event_id: eventId, criada: true, itens: itens.length, momentos: cronograma.length },
      },
      actor,
    );
    return { id: editionId, edicao: 1, created: true, edition: viewDaEdicao(editionId, documento) };
  });
}

async function mudarEdicao(db: Firestore, input: NoCliente<PatchDaEdicao>, actor: AtorDoCliente): Promise<ResultadoDoSalvar> {
  const customerCode = input.customer_code;
  const patch = input.patch;
  conferirForma(patch);

  return db.runTransaction(async (transaction) => {
    const { ref, data } = await lerEdicaoDoCliente(transaction, db, input.id, customerCode);
    if (Number(data.edicao) !== input.expected_edicao) throw new HttpsError("failed-precondition", "A edição mudou em outra aba");
    const problema = problemaDoPatch(String(data.status ?? "") as StatusDaEdicao, actor.role, patch);
    if (problema) throw new HttpsError("failed-precondition", problema);
    const eventId = String(data.event_id ?? "");
    const eventRef = idDeDocumento(eventId) ? db.collection(EVENTOS_COLLECTION).doc(eventId) : null;
    const precisaDaCapa = patch.evento !== undefined || patch.label !== undefined || patch.cronograma !== undefined;
    const capaLida = precisaDaCapa && eventRef ? await transaction.get(eventRef) : null;
    const capa = capaLida?.exists ? capaLida.data() ?? null : null;
    const projecao = patch.itens?.length
      ? await tamanhoETipoDosItens(transaction, db, customerCode, patch.itens.map((item) => item.sku_code))
      : new Map<string, { size: string | null; category: string | null }>();

    const agora = new Date();
    const autor = actorRef(actor);
    const mudancas: Data = {};
    let cronogramaNovo: Data[] | null = null;
    if (patch.onde !== undefined) mudancas.onde = ondeGravada(patch.onde);
    if (patch.cronograma !== undefined) {
      cronogramaNovo = fundirCronograma(lista(data.cronograma), patch.cronograma, momentosLigados(data));
      mudancas.cronograma = cronogramaNovo;
    }
    if (patch.itens !== undefined) {
      const itens = itensGravados(patch.itens, projecao);
      mudancas.itens = itens;
      mudancas.itens_total = itens.length;
      mudancas.pecas_total = pecas(itens);
    }
    if (patch.coleta !== undefined) mudancas.coleta = coletaGravada(patch.coleta);
    if (patch.observacoes !== undefined) mudancas.observacoes = texto(patch.observacoes);
    // Na raiz da edição, nunca em `pedido`.
    if (patch.separar_ate !== undefined) mudancas.separar_ate = texto(patch.separar_ate);
    const label = labelDoPatch(data, patch, cronogramaNovo);
    if (label !== undefined) mudancas.label = label;
    // O nome que vem vai ao event_name desta edição; as outras edições guardam o que tinham.
    if (patch.evento?.name !== undefined && patch.evento.name !== data.event_name) mudancas.event_name = patch.evento.name;
    mudancas.edicao = Number(data.edicao) + 1;
    mudancas.updated_by = autor;
    mudancas.updated_at = agora;
    const depois = { ...data, ...mudancas };
    // Depois do envio, a coordenação ajusta onde e o cronograma sem tirar o que o envio exigiu.
    if (data.status !== "rascunho" && (patch.onde !== undefined || patch.cronograma !== undefined)) {
      const falta = problemaParaEnviar(viewDaEdicao(ref.id, depois));
      if (falta) throw new HttpsError("failed-precondition", falta);
    }
    transaction.update(ref, carimbar(mudancas, agora));

    // O valor declarado só muda quando vem (o null apaga): quem não lê valores (o interno, em nome do
    // cliente) muda a coleta sem saber o valor, e a coleta sem a chave não o apaga.
    if (patch.coleta === null || patch.coleta?.valor_declarado_cents !== undefined) {
      transaction.set(
        db.collection(PRECOS_COLLECTION).doc(ref.id),
        carimbar(
          { id: ref.id, edition_id: ref.id, event_id: eventId, customer_code: customerCode, valor_declarado_cents: patch.coleta?.valor_declarado_cents ?? null, updated_at: agora },
          agora,
        ),
        { merge: true },
      );
    }
    if (capa && eventRef) {
      const mudancaDaCapaAgora = mudancaDaCapa(capa, patch.evento);
      if (label !== undefined && capa.last_edition_id === ref.id && label !== texto(capa.last_edition_label)) mudancaDaCapaAgora.last_edition_label = label;
      if (Object.keys(mudancaDaCapaAgora).length) {
        transaction.update(eventRef, carimbar({ ...mudancaDaCapaAgora, updated_by: autor, updated_at: agora }, agora));
      }
    }

    createEventoEvent(
      transaction,
      db,
      {
        type: "evento.edicao_salva",
        customer_code: customerCode,
        edition_id: ref.id,
        descricao: descricaoDaEdicao(depois.event_name, depois.label),
        payload: { edition_id: ref.id, event_id: eventId, criada: false, itens: lista(depois.itens).length, momentos: lista(depois.cronograma).length },
      },
      actor,
    );
    return { id: ref.id, edicao: Number(mudancas.edicao), created: false, edition: viewDaEdicao(ref.id, depois) };
  });
}

// ------------------------------------------------------------------ enviar

export type ResultadoDoEnvio = { id: string; status: "enviado"; request_id: string | null; edition: EdicaoView };

export type DepsDoEnvio = {
  /** A solicitação da edição, na mesma transação (parte 6): lê e grava depois das leituras do envio. */
  criarSolicitacao?: (transaction: Transaction, edicao: EdicaoView) => Promise<{ request_id: string; request_number: string }>;
};

/**
 * rascunho → enviado. O recibo guarda só o id, o status e a solicitação (a
 * edição tem o contato no local): a repetição com a mesma chave devolve o
 * mesmo resultado, com a edição de agora.
 */
export async function sendEventEditionTransaction(
  db: Firestore,
  input: NoCliente<EnviarEdicao>,
  actor: AtorDoCliente,
  deps: DepsDoEnvio = {},
): Promise<ResultadoDoEnvio> {
  const customerCode = input.customer_code;
  const opRef = db.collection(OPERATIONS_COLLECTION).doc(`op_evento_send_${digest({ customer: customerCode, nonce: input.idempotency_key })}`);
  const inputHash = digest(input, 64);

  return db.runTransaction(async (transaction) => {
    const previous = await transaction.get(opRef);
    if (previous.exists) {
      if (previous.get("input_hash") !== inputHash) {
        throw new HttpsError("already-exists", "A chave de idempotência já foi usada com outro conteúdo.");
      }
      const { ref, data } = await lerEdicaoDoCliente(transaction, db, input.id, customerCode);
      return { ...(previous.get("result") as Omit<ResultadoDoEnvio, "edition">), edition: viewDaEdicao(ref.id, data) };
    }
    const { ref, data } = await lerEdicaoDoCliente(transaction, db, input.id, customerCode);
    if (data.status !== "rascunho") throw new HttpsError("failed-precondition", "A edição já foi enviada.");
    if (Number(data.edicao) !== input.expected_edicao) throw new HttpsError("failed-precondition", "A edição mudou em outra aba");
    const view = viewDaEdicao(ref.id, data);
    const problema = problemaParaEnviar(view);
    if (problema) throw new HttpsError("failed-precondition", problema);
    const solicitacao = deps.criarSolicitacao && view.itens.length ? await deps.criarSolicitacao(transaction, view) : null;

    const agora = new Date();
    const autor = actorRef(actor);
    const mudancas: Data = {
      status: "enviado",
      enviada_em: agora,
      edicao: Number(data.edicao) + 1,
      updated_by: autor,
      updated_at: agora,
    };
    if (solicitacao) {
      mudancas.pedido = {
        request_id: solicitacao.request_id,
        request_number: solicitacao.request_number,
        order_id: null,
        order_number: null,
        separado_em: null,
        lacre: null,
        volumes_total: null,
        volumes: [],
        entregue_em: null,
        entregue_por: null,
        comprovante: null,
        cancelado_em: null,
      };
    }
    transaction.update(ref, carimbar(mudancas, agora));
    createEventoEvent(
      transaction,
      db,
      {
        type: "evento.edicao_enviada",
        customer_code: customerCode,
        edition_id: ref.id,
        descricao: descricaoDaEdicao(data.event_name, data.label),
        payload: { edition_id: ref.id, request_id: solicitacao?.request_id ?? null, itens: view.itens.length, pecas: view.pecas_total },
      },
      actor,
    );
    const result = { id: ref.id, status: "enviado" as const, request_id: solicitacao?.request_id ?? null };
    transaction.create(opRef, {
      id: opRef.id,
      kind: "evento.send",
      target_id: ref.id,
      customer_code: customerCode,
      input_hash: inputHash,
      status: "completed",
      actor: actorFields(actor),
      result,
      created_at: FieldValue.serverTimestamp(),
      completed_at: FieldValue.serverTimestamp(),
    });
    return { ...result, edition: viewDaEdicao(ref.id, { ...data, ...mudancas }) };
  });
}

// ---------------------------------------------------------------- cancelar

export type ResultadoDoCancelamento = { id: string; resultado: "excluida" | "cancelada" };

/**
 * O rascunho é excluído (pelo cliente ou pela coordenação em nome dele): a
 * edição e o preço somem, e o evento que fica sem edição some junto. A
 * enviada é cancelada; a coordenação diz o motivo. Confirmada em diante,
 * nesta parte, não cancela por aqui (a parte 7 traz o pedido).
 */
export async function cancelEventEditionTransaction(
  db: Firestore,
  input: NoCliente<CancelarEdicao>,
  actor: AtorDoCliente,
): Promise<ResultadoDoCancelamento> {
  const customerCode = input.customer_code;
  const opRef = db.collection(OPERATIONS_COLLECTION).doc(`op_evento_cancel_${digest({ customer: customerCode, nonce: input.idempotency_key })}`);
  const inputHash = digest(input, 64);

  return db.runTransaction(async (transaction) => {
    const previous = await transaction.get(opRef);
    if (previous.exists) {
      if (previous.get("input_hash") !== inputHash) {
        throw new HttpsError("already-exists", "A chave de idempotência já foi usada com outro conteúdo.");
      }
      return previous.get("result") as ResultadoDoCancelamento;
    }
    const { ref, data } = await lerEdicaoDoCliente(transaction, db, input.id, customerCode);
    const status = String(data.status ?? "");
    const agora = new Date();
    const autor = actorRef(actor);
    let result: ResultadoDoCancelamento;

    if (status === "rascunho") {
      const eventId = String(data.event_id ?? "");
      const eventRef = idDeDocumento(eventId) ? db.collection(EVENTOS_COLLECTION).doc(eventId) : null;
      const capaLida = eventRef ? await transaction.get(eventRef) : null;
      const capa = capaLida?.exists ? capaLida.data() ?? null : null;
      // Duas igualdades: os índices de campo único bastam.
      const doEvento = eventRef
        ? await transaction.get(db.collection(EDICOES_COLLECTION).where("event_id", "==", eventId).where("customer_code", "==", customerCode))
        : null;
      const outras = (doEvento?.docs ?? []).filter((documento) => documento.id !== ref.id);

      transaction.delete(ref);
      transaction.delete(db.collection(PRECOS_COLLECTION).doc(ref.id));
      const eventoExcluido = Boolean(capa && eventRef && outras.length === 0);
      if (capa && eventRef) {
        if (eventoExcluido) {
          transaction.delete(eventRef);
        } else {
          const mudanca: Data = { editions_count: outras.length, updated_by: autor, updated_at: agora };
          if (capa.last_edition_id === ref.id) {
            const maisRecente = [...outras].sort((a, b) => milis(b.get("created_at")) - milis(a.get("created_at")))[0]!;
            mudanca.last_edition_id = maisRecente.id;
            mudanca.last_edition_label = texto(maisRecente.get("label"));
          }
          transaction.update(eventRef, carimbar(mudanca, agora));
        }
      }
      createEventoEvent(
        transaction,
        db,
        {
          type: "evento.edicao_excluida",
          customer_code: customerCode,
          edition_id: ref.id,
          descricao: descricaoDaEdicao(data.event_name, data.label),
          payload: { edition_id: ref.id, event_id: eventId, evento_excluido: eventoExcluido },
        },
        actor,
      );
      result = { id: ref.id, resultado: "excluida" };
    } else if (status === "enviado") {
      if (COORDENACAO.includes(actor.role) && !input.motivo) throw new HttpsError("invalid-argument", "Informe o motivo");
      transaction.update(
        ref,
        carimbar(
          {
            status: "cancelado",
            cancelada_em: agora,
            cancelada_por: autor,
            cancelamento_motivo: input.motivo ?? null,
            edicao: Number(data.edicao) + 1,
            updated_by: autor,
            updated_at: agora,
          },
          agora,
        ),
      );
      createEventoEvent(
        transaction,
        db,
        {
          type: "evento.edicao_cancelada",
          customer_code: customerCode,
          edition_id: ref.id,
          descricao: descricaoDaEdicao(data.event_name, data.label),
          payload: { edition_id: ref.id, status_anterior: "enviado" },
        },
        actor,
      );
      result = { id: ref.id, resultado: "cancelada" };
    } else if (status === "confirmado" || status === "separado") {
      throw new HttpsError("failed-precondition", "Só a coordenação cancela uma edição confirmada.");
    } else if (status === "no_evento" || status === "retornado") {
      throw new HttpsError("failed-precondition", "Os itens já saíram: registre o retorno e feche a edição.");
    } else if (status === "cancelado") {
      throw new HttpsError("failed-precondition", "A edição já foi cancelada.");
    } else {
      throw new HttpsError("failed-precondition", "A edição já está fechada.");
    }

    transaction.create(opRef, {
      id: opRef.id,
      kind: "evento.cancel",
      target_id: ref.id,
      customer_code: customerCode,
      input_hash: inputHash,
      status: "completed",
      actor: actorFields(actor),
      result,
      created_at: FieldValue.serverTimestamp(),
      completed_at: FieldValue.serverTimestamp(),
    });
    return result;
  });
}

function milis(value: unknown): number {
  if (value && typeof value === "object" && typeof (value as { toMillis?: unknown }).toMillis === "function") {
    return (value as { toMillis: () => number }).toMillis();
  }
  return 0;
}

// ---------------------------------------------------------------- arquivar

export type ResultadoDoArquivamento = { event_id: string; changed: boolean };

/** Arquiva o evento sem edição aberta (de rascunho a retornado): o rascunho precisa ser excluído antes. */
export async function archiveClientEventTransaction(
  db: Firestore,
  input: NoCliente<ArquivarEvento>,
  actor: AtorDoCliente,
): Promise<ResultadoDoArquivamento> {
  const customerCode = input.customer_code;
  if (!idDeDocumento(input.event_id)) throw eventoNaoEncontrado();
  const opRef = db.collection(OPERATIONS_COLLECTION).doc(`op_evento_archive_${digest({ customer: customerCode, nonce: input.idempotency_key })}`);
  const inputHash = digest(input, 64);
  const eventRef = db.collection(EVENTOS_COLLECTION).doc(input.event_id);

  return db.runTransaction(async (transaction) => {
    const previous = await transaction.get(opRef);
    if (previous.exists) {
      if (previous.get("input_hash") !== inputHash) {
        throw new HttpsError("already-exists", "A chave de idempotência já foi usada com outro conteúdo.");
      }
      return previous.get("result") as ResultadoDoArquivamento;
    }
    const capaLida = await transaction.get(eventRef);
    const capa = capaLida.data();
    if (!capaLida.exists || !capa || capa.customer_code !== customerCode) throw eventoNaoEncontrado();
    let result: ResultadoDoArquivamento = { event_id: input.event_id, changed: false };
    if (capa.status === "active") {
      // Duas igualdades: os índices de campo único bastam.
      const edicoes = await transaction.get(
        db.collection(EDICOES_COLLECTION).where("event_id", "==", input.event_id).where("customer_code", "==", customerCode),
      );
      if (edicoes.docs.some((documento) => edicaoAberta(documento.get("status")))) {
        throw new HttpsError("failed-precondition", "O evento tem uma edição aberta: termine ou exclua antes de arquivar.");
      }
      const agora = new Date();
      const autor = actorRef(actor);
      transaction.update(eventRef, carimbar({ status: "archived", archived_by: autor, archived_at: agora, updated_by: autor, updated_at: agora }, agora));
      createEventoEvent(
        transaction,
        db,
        {
          type: "evento.arquivado",
          customer_code: customerCode,
          edition_id: null,
          descricao: String(capa.name ?? ""),
          payload: { event_id: input.event_id, edicoes: edicoes.size },
        },
        actor,
      );
      result = { event_id: input.event_id, changed: true };
    }
    transaction.create(opRef, {
      id: opRef.id,
      kind: "evento.archive",
      target_id: input.event_id,
      customer_code: customerCode,
      input_hash: inputHash,
      status: "completed",
      actor: actorFields(actor),
      result,
      created_at: FieldValue.serverTimestamp(),
      completed_at: FieldValue.serverTimestamp(),
    });
    return result;
  });
}
