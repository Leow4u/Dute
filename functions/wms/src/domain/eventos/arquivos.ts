import { createHash } from "node:crypto";

import { FieldValue, type DocumentReference, type Firestore, type Transaction } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";
import { z } from "genkit";

import type { OperationalActor } from "../operations.js";

import { LIMITES, edicaoAberta } from "./dominio.js";
import { EDICOES_COLLECTION, OPERATIONS_COLLECTION, actorRef, descricaoDaEdicao, lerEdicaoDoCliente, type ActorRef } from "./edicao-gravacao.js";
import { createEventoEvent } from "./eventos-auditoria.js";

/**
 * Os arquivos da edição do evento (docs/superpowers/specs/2026-11-26-eventos-design.md,
 * "Fotos e documentos" e "As callables"): o navegador sobe pelo SDK sob o
 * storage.rules, e a callable confere o objeto no bucket (existe, tipo,
 * tamanho) antes de gravar o registro em `documentos[]` ou `fotos[]`, numa
 * transação com o recibo e o evento de auditoria. O arquivo errado é apagado
 * por geração e recusado; o documento retirado sai do registro e o arquivo
 * fica no bucket. O bucket chega por dependência: index.ts o liga ao de
 * verdade, e os testes passam um falso.
 *
 * Os anexos e as fotos não sobem a `edicao`: o CAS protege o que o patch e a
 * equipe gravam, e nenhum dos dois grava `documentos` nem `fotos` (o momento
 * citado se lê dentro das duas transações). Subir a versão aqui só faria o
 * salvamento automático do formulário recusar "A edição mudou em outra aba"
 * numa aba só, logo depois de um anexo.
 */

export const TIPOS_DE_FOTO = ["image/jpeg", "image/png", "image/webp"] as const;
export const TIPOS_DE_DOCUMENTO = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
] as const;
/** A foto fica abaixo disto: a regra é `<`. */
export const TAMANHO_DA_FOTO = 8 * 1024 * 1024;
/** O documento vai até isto: a regra é `<=`. */
export const TAMANHO_DO_DOCUMENTO = 10 * 1024 * 1024;
export const ARQUIVO_DA_FOTO = /^ft_[a-f0-9]{16}\.(jpg|png|webp)$/;
export const ARQUIVO_DO_DOCUMENTO = /^dc_[a-f0-9]{16}\.(pdf|jpg|png|webp|xlsx)$/;
export const ARQUIVO_DO_ANEXO = /^an_[a-f0-9]{16}\.(pdf|jpg|png|webp|xlsx)$/;
export const MOMENTO_ID = /^mo_[a-f0-9]{8}$/;
/** O id de toda edição (o digest de 16 hex da criação), o único que o storage.rules aceita no caminho. */
const ID_DA_EDICAO = /^ced_[a-f0-9]{16}$/;
const NOME_DO_ARQUIVO = 120;
const COORDENACAO = ["owner", "admin", "interno"];

type Data = Record<string, unknown>;

export type OrigemDoDocumento = "cliente" | "dutelog";

/** O documento gravado: o `id` é o nome do arquivo sem a extensão; o tipo e o tamanho vêm do bucket. */
export type DocumentoDaEdicao = {
  id: string;
  caminho: string;
  nome: string;
  tipo: string;
  tamanho: number;
  origem: OrigemDoDocumento;
  momento_id: string | null;
  registrado_por: ActorRef;
  registrado_em: string;
};

/** A foto gravada: sempre de um momento; o instante é o da entrada ou o do registro. */
export type FotoDaEdicao = {
  id: string;
  caminho: string;
  momento_id: string;
  legenda: string | null;
  instante: string;
  registrado_por: ActorRef;
  registrado_em: string;
};

/** O que o bucket diz do arquivo; a geração é a do objeto conferido, a que se apaga quando ele está errado. */
export type ArquivoNoBucket = { contentType: string; size: number; generation?: string };
export type BucketDosEventos = {
  conferir: (caminho: string) => Promise<ArquivoNoBucket | null>;
  /** Apaga só a geração conferida: o que subiu depois no mesmo caminho fica. */
  apagar: (caminho: string, generation: string) => Promise<void>;
};

// ------------------------------------------------------------------ apoio

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

/** O ator do recibo, como count-rounds.ts. */
function actorFields(actor: OperationalActor) {
  return Object.fromEntries(
    Object.entries({ uid: actor.uid, role: actor.role, email: actor.email, name: actor.name }).filter(([, value]) => value !== undefined),
  );
}

function registro(value: unknown): Data {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Data) : {};
}

function texto(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function ator(value: unknown): ActorRef | null {
  const dados = registro(value);
  const uid = texto(dados.uid);
  if (!uid) return null;
  return { uid, name: texto(dados.name), role: String(dados.role ?? "") };
}

const edicaoNaoEncontrada = () => new HttpsError("not-found", "Edição não encontrada.");
const chaveUsada = () => new HttpsError("already-exists", "A chave de idempotência já foi usada com outro conteúdo.");

/** O id do registro: o nome do arquivo sem a extensão. */
function semExtensao(arquivo: string): string {
  return arquivo.replace(/\.[a-z]+$/, "");
}

function momentosDoCronograma(data: Data): Set<string> {
  const cronograma = Array.isArray(data.cronograma) ? data.cronograma.map(registro) : [];
  return new Set(cronograma.map((momento) => texto(momento.id)).filter((id): id is string => Boolean(id)));
}

// ------------------------------------------------------------------ caminhos

/** Onde quem opera sobe a foto (o caminho do storage.rules). */
export function caminhoDaFoto(customerCode: string, editionId: string, arquivo: string): string {
  return `eventos/${customerCode}/${editionId}/fotos/${arquivo}`;
}

/** Onde o documento sobe: o anexo do cliente no portal, o da Dutelog em docs/. */
export function caminhoDoDocumento(origem: OrigemDoDocumento, customerCode: string, editionId: string, arquivo: string): string {
  return origem === "cliente" ? `portal/${customerCode}/eventos/${editionId}/${arquivo}` : `eventos/${customerCode}/${editionId}/docs/${arquivo}`;
}

// ------------------------------------------------------- o arquivo no bucket

export type ProblemaDoArquivo = { mensagem: string; apagar: boolean };

/** O que a foto no bucket tem de errado: a que não chegou não se apaga; a que não é foto ou passa do tamanho, sim. */
export function problemaDaFoto(arquivo: ArquivoNoBucket | null): ProblemaDoArquivo | null {
  if (!arquivo) return { mensagem: "A foto não chegou ao armazenamento. Envie de novo.", apagar: false };
  if (!(TIPOS_DE_FOTO as readonly string[]).includes(arquivo.contentType)) return { mensagem: "O arquivo enviado não é uma foto.", apagar: true };
  if (arquivo.size >= TAMANHO_DA_FOTO) return { mensagem: "A foto passa de 8 MB.", apagar: true };
  return null;
}

/** O mesmo para o documento: PDF, imagem ou planilha, até 10 MB. */
export function problemaDoDocumento(arquivo: ArquivoNoBucket | null): ProblemaDoArquivo | null {
  if (!arquivo) return { mensagem: "O arquivo não chegou ao armazenamento. Envie de novo.", apagar: false };
  if (!(TIPOS_DE_DOCUMENTO as readonly string[]).includes(arquivo.contentType)) {
    return { mensagem: "O arquivo enviado não é PDF, imagem nem planilha.", apagar: true };
  }
  if (arquivo.size > TAMANHO_DO_DOCUMENTO) return { mensagem: "O documento passa de 10 MB.", apagar: true };
  return null;
}

/**
 * Confere o arquivo no bucket, antes da transação. O que não chegou recusa
 * com failed-precondition; o errado é apagado por geração (o que subiu
 * depois no mesmo caminho fica) e recusado com invalid-argument. Sem a
 * geração, nada se apaga; e a falha ao apagar não esconde a recusa.
 */
export async function conferirNoBucket(
  bucket: BucketDosEventos,
  caminho: string,
  problemaDe: (arquivo: ArquivoNoBucket | null) => ProblemaDoArquivo | null,
): Promise<ArquivoNoBucket> {
  const arquivo = await bucket.conferir(caminho);
  const problema = problemaDe(arquivo);
  if (!problema && arquivo) return arquivo;
  if (problema?.apagar && arquivo?.generation && /^\d+$/.test(arquivo.generation)) {
    await bucket.apagar(caminho, arquivo.generation).catch((erro: unknown) => console.warn("[eventos] arquivo recusado não apagado", { caminho, erro }));
  }
  throw new HttpsError(problema?.apagar ? "invalid-argument" : "failed-precondition", problema?.mensagem ?? "O arquivo não chegou ao armazenamento. Envie de novo.");
}

// ------------------------------------------------------------------ status e papel

/** O documento entra em toda edição aberta, de rascunho a retornado, pelo cliente e pela Dutelog. */
export function problemaParaAnexarDocumento(status: string): string | null {
  return edicaoAberta(status) ? null : "A edição já está fechada.";
}

/** A foto é da execução: de confirmado a retornado. */
export function problemaParaAnexarFoto(status: string): string | null {
  if (!edicaoAberta(status)) return "A edição já está fechada.";
  if (status === "rascunho" || status === "enviado") return "A edição ainda não foi confirmada.";
  return null;
}

export type RecusaDaRetirada = { code: "failed-precondition" | "permission-denied"; mensagem: string };

/**
 * Quem tira o documento: quem anexou, ou a coordenação. Do lado do cliente,
 * quem anexou é a empresa (quem muda e exclui o rascunho também tira o layout
 * que a colega anexou), só em rascunho e enviado e nunca o da Dutelog; do
 * lado da Dutelog, a pessoa que anexou, ou a coordenação.
 */
export function problemaParaTirarDocumento(status: string, actor: { uid: string; role: string }, documento: DocumentoDaEdicao): RecusaDaRetirada | null {
  if (!edicaoAberta(status)) return { code: "failed-precondition", mensagem: "A edição já está fechada." };
  if (actor.role === "cliente") {
    if (status !== "rascunho" && status !== "enviado") return { code: "failed-precondition", mensagem: "Depois da confirmação, só a Dutelog retira documentos." };
    if (documento.origem === "dutelog") return { code: "permission-denied", mensagem: "Só a Dutelog retira os documentos dela." };
  }
  if (actor.role !== "cliente" && !COORDENACAO.includes(actor.role) && documento.registrado_por.uid !== actor.uid) {
    return { code: "permission-denied", mensagem: "Só quem anexou o documento, ou a coordenação, o retira." };
  }
  return null;
}

// ------------------------------------------------------------------ entradas

const idempotencyKey = z.string().trim().min(8).max(200);
const idDaEdicao = z.string().trim().min(1).max(120);
const customerCode = z.string().trim().max(120).optional();

/** O cliente manda o an_ e a Dutelog o dc_; o nome é o do arquivo, como a pessoa o vê. */
export const AnexarDocumentoSchema = z
  .object({
    edition_id: idDaEdicao,
    customer_code: customerCode,
    arquivo: z.string().trim().regex(/^(an|dc)_[a-f0-9]{16}\.(pdf|jpg|png|webp|xlsx)$/),
    nome: z.string().trim().min(1).max(NOME_DO_ARQUIVO),
    momento_id: z.string().trim().regex(MOMENTO_ID).optional(),
    idempotency_key: idempotencyKey,
  })
  .strict();

export const TirarDocumentoSchema = z
  .object({
    edition_id: idDaEdicao,
    customer_code: customerCode,
    documento_id: z.string().trim().regex(/^(an|dc)_[a-f0-9]{16}$/),
    idempotency_key: idempotencyKey,
  })
  .strict();

/** Só a Dutelog fotografa; a legenda e o instante são opcionais, sem null. */
export const AnexarFotoSchema = z
  .object({
    edition_id: idDaEdicao,
    arquivo: z.string().trim().regex(ARQUIVO_DA_FOTO),
    momento_id: z.string().trim().regex(MOMENTO_ID),
    legenda: z.string().trim().max(LIMITES.legenda).optional(),
    instante: z.string().datetime({ offset: true }).optional(),
    idempotency_key: idempotencyKey,
  })
  .strict();

export type AnexarDocumento = z.output<typeof AnexarDocumentoSchema>;
export type TirarDocumento = z.output<typeof TirarDocumentoSchema>;
export type AnexarFoto = z.output<typeof AnexarFotoSchema>;

// ------------------------------------------------------------------ leitura

/** Os documentos gravados na edição; o que não se lê fica de fora. */
export function documentosLidos(data: Data): DocumentoDaEdicao[] {
  if (!Array.isArray(data.documentos)) return [];
  return data.documentos.flatMap((bruto): DocumentoDaEdicao[] => {
    const documento = registro(bruto);
    const id = texto(documento.id);
    const caminho = texto(documento.caminho);
    const registradoPor = ator(documento.registrado_por);
    if (!id || !caminho || !registradoPor) return [];
    return [
      {
        id,
        caminho,
        nome: texto(documento.nome) ?? id,
        tipo: String(documento.tipo ?? ""),
        tamanho: typeof documento.tamanho === "number" && Number.isFinite(documento.tamanho) ? documento.tamanho : 0,
        origem: documento.origem === "dutelog" ? "dutelog" : "cliente",
        momento_id: texto(documento.momento_id),
        registrado_por: registradoPor,
        registrado_em: texto(documento.registrado_em) ?? "",
      },
    ];
  });
}

/** As fotos gravadas na edição; a sem momento não se lê. */
export function fotosLidas(data: Data): FotoDaEdicao[] {
  if (!Array.isArray(data.fotos)) return [];
  return data.fotos.flatMap((bruto): FotoDaEdicao[] => {
    const foto = registro(bruto);
    const id = texto(foto.id);
    const caminho = texto(foto.caminho);
    const momentoId = texto(foto.momento_id);
    const registradoPor = ator(foto.registrado_por);
    if (!id || !caminho || !momentoId || !registradoPor) return [];
    const registradoEm = texto(foto.registrado_em) ?? "";
    return [
      {
        id,
        caminho,
        momento_id: momentoId,
        legenda: texto(foto.legenda),
        instante: texto(foto.instante) ?? registradoEm,
        registrado_por: registradoPor,
        registrado_em: registradoEm,
      },
    ];
  });
}

/**
 * O cliente da edição, lido fora da transação, para o caminho e o recibo: a
 * edição de outro cliente não existe para quem é cliente, e o id fora do
 * padrão de toda edição não chega ao bucket.
 */
export async function codigoDaEdicao(db: Firestore, editionId: string, actor: OperationalActor): Promise<string> {
  if (!ID_DA_EDICAO.test(editionId)) throw edicaoNaoEncontrada();
  const snapshot = await db.collection(EDICOES_COLLECTION).doc(editionId).get();
  const codigo = texto(snapshot.get("customer_code"));
  if (!snapshot.exists || !codigo) throw edicaoNaoEncontrada();
  if (actor.role === "cliente" && codigo !== actor.customer_code) throw edicaoNaoEncontrada();
  return codigo;
}

/** A edição na transação: a do cliente por lerEdicaoDoCliente; a equipe lê a de qualquer cliente. */
export async function lerEdicaoParaArquivos(
  transaction: Transaction,
  db: Firestore,
  editionId: string,
  actor: OperationalActor,
): Promise<{ ref: DocumentReference; data: Data }> {
  if (actor.role === "cliente") return lerEdicaoDoCliente(transaction, db, editionId, actor.customer_code ?? "");
  if (!ID_DA_EDICAO.test(editionId)) throw edicaoNaoEncontrada();
  const ref = db.collection(EDICOES_COLLECTION).doc(editionId);
  const snapshot = await transaction.get(ref);
  const data = snapshot.data();
  if (!snapshot.exists || !data) throw edicaoNaoEncontrada();
  return { ref, data };
}

// ------------------------------------------------------------------ gravação

function reciboDe(id: string, kind: string, customerCode: string, inputHash: string, actor: OperationalActor, result: Data) {
  return {
    id,
    kind,
    target_id: result.id,
    customer_code: customerCode,
    input_hash: inputHash,
    status: "completed",
    actor: actorFields(actor),
    result,
    created_at: FieldValue.serverTimestamp(),
    completed_at: FieldValue.serverTimestamp(),
  };
}

export type ResultadoDoAnexo = { id: string; edicao: number; documento: DocumentoDaEdicao; documentos: number };
type ReciboDoAnexo = { id: string; edicao: number; documento_id: string; documentos: number };

/**
 * attachEventDocument: o documento que já subiu entra em `documentos[]`. O
 * cliente anexa o an_ do portal e a Dutelog o dc_, de rascunho a retornado.
 * O recibo guarda só ids e contagens: a repetição da chave relê a edição e
 * devolve o registro e a `edicao` vivos (o documento retirado depois não
 * volta).
 */
export async function attachEventDocumentTransaction(
  db: Firestore,
  input: AnexarDocumento,
  actor: OperationalActor,
  bucket: BucketDosEventos,
): Promise<ResultadoDoAnexo> {
  const origem: OrigemDoDocumento = actor.role === "cliente" ? "cliente" : "dutelog";
  if (!(origem === "cliente" ? ARQUIVO_DO_ANEXO : ARQUIVO_DO_DOCUMENTO).test(input.arquivo)) {
    throw new HttpsError("invalid-argument", "O arquivo não é do caminho de quem anexa.");
  }
  const codigo = await codigoDaEdicao(db, input.edition_id, actor);
  const caminho = caminhoDoDocumento(origem, codigo, input.edition_id, input.arquivo);
  const noBucket = await conferirNoBucket(bucket, caminho, problemaDoDocumento);
  const opRef = db.collection(OPERATIONS_COLLECTION).doc(`op_evento_attach_document_${digest({ customer: codigo, nonce: input.idempotency_key })}`);
  const inputHash = digest({ ...input, customer_code: codigo }, 64);
  const id = semExtensao(input.arquivo);

  return db.runTransaction(async (transaction) => {
    const previous = await transaction.get(opRef);
    const { ref, data } = await lerEdicaoParaArquivos(transaction, db, input.edition_id, actor);
    if (previous.exists) {
      if (previous.get("input_hash") !== inputHash) throw chaveUsada();
      const gravado = previous.get("result") as ReciboDoAnexo;
      const documento = documentosLidos(data).find((registrado) => registrado.id === gravado.documento_id);
      if (!documento) throw new HttpsError("not-found", "Documento não encontrado.");
      return { id: gravado.id, edicao: Number(data.edicao ?? 0), documento, documentos: gravado.documentos };
    }
    const problema = problemaParaAnexarDocumento(String(data.status ?? ""));
    if (problema) throw new HttpsError("failed-precondition", problema);
    if (input.momento_id && !momentosDoCronograma(data).has(input.momento_id)) {
      throw new HttpsError("invalid-argument", "O momento não está no cronograma.");
    }
    const atuais = documentosLidos(data);
    if (atuais.some((registrado) => registrado.id === id)) throw new HttpsError("already-exists", "O arquivo já está na edição.");
    if (atuais.length >= LIMITES.documentos) throw new HttpsError("failed-precondition", `A edição já tem ${LIMITES.documentos} documentos.`);

    const autor = actorRef(actor);
    const documento: DocumentoDaEdicao = {
      id,
      caminho,
      nome: input.nome,
      tipo: noBucket.contentType,
      tamanho: noBucket.size,
      origem,
      momento_id: input.momento_id ?? null,
      registrado_por: autor,
      registrado_em: new Date().toISOString(),
    };
    const documentos = [...atuais, documento];
    const edicao = Number(data.edicao ?? 0);
    transaction.update(ref, { documentos, updated_by: autor, updated_at: FieldValue.serverTimestamp() });
    createEventoEvent(
      transaction,
      db,
      {
        type: "evento.documento_anexado",
        customer_code: codigo,
        edition_id: ref.id,
        descricao: descricaoDaEdicao(data.event_name, data.label),
        payload: { edition_id: ref.id, documento_id: id, origem },
      },
      actor,
    );
    const result: ReciboDoAnexo = { id: ref.id, edicao, documento_id: id, documentos: documentos.length };
    transaction.create(opRef, reciboDe(opRef.id, "evento.documento.attach", codigo, inputHash, actor, result));
    return { id: ref.id, edicao, documento, documentos: documentos.length };
  });
}

export type ResultadoDaRetirada = { id: string; edicao: number; documentos: number };

/**
 * removeEventDocument: o registro sai de `documentos[]`; o arquivo fica no
 * bucket (as regras não apagam, e a retenção é outra decisão).
 */
export async function removeEventDocumentTransaction(db: Firestore, input: TirarDocumento, actor: OperationalActor): Promise<ResultadoDaRetirada> {
  const codigo = await codigoDaEdicao(db, input.edition_id, actor);
  const opRef = db.collection(OPERATIONS_COLLECTION).doc(`op_evento_remove_document_${digest({ customer: codigo, nonce: input.idempotency_key })}`);
  const inputHash = digest({ ...input, customer_code: codigo }, 64);

  return db.runTransaction(async (transaction) => {
    const previous = await transaction.get(opRef);
    if (previous.exists) {
      if (previous.get("input_hash") !== inputHash) throw chaveUsada();
      return previous.get("result") as ResultadoDaRetirada;
    }
    const { ref, data } = await lerEdicaoParaArquivos(transaction, db, input.edition_id, actor);
    const atuais = documentosLidos(data);
    const documento = atuais.find((registrado) => registrado.id === input.documento_id);
    if (!documento) throw new HttpsError("not-found", "Documento não encontrado.");
    const recusa = problemaParaTirarDocumento(String(data.status ?? ""), actor, documento);
    if (recusa) throw new HttpsError(recusa.code, recusa.mensagem);

    const documentos = atuais.filter((registrado) => registrado.id !== documento.id);
    const edicao = Number(data.edicao ?? 0);
    transaction.update(ref, { documentos, updated_by: actorRef(actor), updated_at: FieldValue.serverTimestamp() });
    createEventoEvent(
      transaction,
      db,
      {
        type: "evento.documento_retirado",
        customer_code: codigo,
        edition_id: ref.id,
        descricao: descricaoDaEdicao(data.event_name, data.label),
        payload: { edition_id: ref.id, documento_id: documento.id },
      },
      actor,
    );
    const result: ResultadoDaRetirada = { id: ref.id, edicao, documentos: documentos.length };
    transaction.create(opRef, reciboDe(opRef.id, "evento.documento.remove", codigo, inputHash, actor, result));
    return result;
  });
}

export type ResultadoDaFoto = { id: string; edicao: number; foto: FotoDaEdicao; fotos: number };
type ReciboDaFoto = { id: string; edicao: number; foto_id: string; fotos: number };

/**
 * attachEventPhoto: a foto que já subiu entra em `fotos[]`, no momento dela,
 * de confirmado a retornado. O recibo guarda só ids e contagens (a legenda é
 * texto livre da edição): a repetição relê a edição.
 */
export async function attachEventPhotoTransaction(
  db: Firestore,
  input: AnexarFoto,
  actor: OperationalActor,
  bucket: BucketDosEventos,
): Promise<ResultadoDaFoto> {
  const codigo = await codigoDaEdicao(db, input.edition_id, actor);
  const caminho = caminhoDaFoto(codigo, input.edition_id, input.arquivo);
  await conferirNoBucket(bucket, caminho, problemaDaFoto);
  const opRef = db.collection(OPERATIONS_COLLECTION).doc(`op_evento_attach_photo_${digest({ customer: codigo, nonce: input.idempotency_key })}`);
  const inputHash = digest({ ...input, customer_code: codigo }, 64);
  const id = semExtensao(input.arquivo);

  return db.runTransaction(async (transaction) => {
    const previous = await transaction.get(opRef);
    const { ref, data } = await lerEdicaoParaArquivos(transaction, db, input.edition_id, actor);
    if (previous.exists) {
      if (previous.get("input_hash") !== inputHash) throw chaveUsada();
      const gravado = previous.get("result") as ReciboDaFoto;
      const foto = fotosLidas(data).find((registrada) => registrada.id === gravado.foto_id);
      if (!foto) throw new HttpsError("not-found", "Foto não encontrada.");
      return { id: gravado.id, edicao: Number(data.edicao ?? 0), foto, fotos: gravado.fotos };
    }
    const problema = problemaParaAnexarFoto(String(data.status ?? ""));
    if (problema) throw new HttpsError("failed-precondition", problema);
    if (!momentosDoCronograma(data).has(input.momento_id)) throw new HttpsError("invalid-argument", "O momento não está no cronograma.");
    const atuais = fotosLidas(data);
    if (atuais.some((registrada) => registrada.id === id)) throw new HttpsError("already-exists", "O arquivo já está na edição.");
    if (atuais.length >= LIMITES.fotos) throw new HttpsError("failed-precondition", `A edição já tem ${LIMITES.fotos} fotos.`);

    const autor = actorRef(actor);
    const registradoEm = new Date().toISOString();
    const foto: FotoDaEdicao = {
      id,
      caminho,
      momento_id: input.momento_id,
      legenda: input.legenda || null,
      instante: input.instante ? new Date(input.instante).toISOString() : registradoEm,
      registrado_por: autor,
      registrado_em: registradoEm,
    };
    const fotos = [...atuais, foto];
    const edicao = Number(data.edicao ?? 0);
    transaction.update(ref, { fotos, updated_by: autor, updated_at: FieldValue.serverTimestamp() });
    createEventoEvent(
      transaction,
      db,
      {
        type: "evento.foto_anexada",
        customer_code: codigo,
        edition_id: ref.id,
        descricao: descricaoDaEdicao(data.event_name, data.label),
        payload: { edition_id: ref.id, momento_id: input.momento_id, fotos: fotos.length },
      },
      actor,
    );
    const result: ReciboDaFoto = { id: ref.id, edicao, foto_id: id, fotos: fotos.length };
    transaction.create(opRef, reciboDe(opRef.id, "evento.foto.attach", codigo, inputHash, actor, result));
    return { id: ref.id, edicao, foto, fotos: fotos.length };
  });
}
