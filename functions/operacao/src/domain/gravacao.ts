import { FieldValue, type DocumentData, type Firestore, type Transaction } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";

import {
  CATEGORIAS_CNH,
  COLLABORATORS_COLLECTION,
  DONOS_DE_VEICULO,
  PAPEIS_COM_APP,
  PAPEIS_DE_CAMPO,
  VEHICLES_COLLECTION,
  VINCULOS,
  aplicarColaborador,
  aplicarVeiculo,
  conflitoDeCpf,
  conflitoDePlaca,
  conflitoDeUsuario,
  interpretarColaborador,
  interpretarVeiculo,
  novoId,
  type AcaoColaborador,
  type AcaoVeiculo,
  type CategoriaCnh,
  type Cnh,
  type ColaboradorGravado,
  type DonoDeVeiculo,
  type PapelDeCampo,
  type VeiculoGravado,
  type Vinculo,
} from "./cadastro.js";
import { createOperacaoEvent } from "./events.js";
import { runIdempotent, type OperacaoActor } from "./operations.js";
import { operacaoCadastroProblem } from "./platform-roles.js";
import type { OperacaoProfile } from "./profile.js";

/**
 * Gravação do cadastro. A transação lê o documento e a unicidade antes de
 * escrever, grava o evento na mesma transação e deixa o recibo por último
 * (runIdempotent). O navegador não escreve essas coleções.
 */

export type ResultadoDoCadastro = { id: string; edicao: number };

function ator(caller: OperacaoProfile): OperacaoActor {
  return { uid: caller.uid, role: caller.role, email: caller.email, name: caller.name };
}

function exigirPapel(caller: OperacaoProfile): void {
  const problem = operacaoCadastroProblem(caller.role);
  if (problem) throw new HttpsError("permission-denied", problem);
}

function texto(data: DocumentData, campo: string): string {
  const value = data[campo];
  if (typeof value !== "string" || !value) throw new HttpsError("failed-precondition", "Cadastro ilegível.");
  return value;
}

export function colaboradorLido(id: string, data: DocumentData): ColaboradorGravado {
  const cnh = data.cnh;
  let lida: Cnh | null = null;
  if (cnh != null) {
    if (typeof cnh !== "object" || typeof cnh.categoria !== "string" || typeof cnh.validade !== "string") {
      throw new HttpsError("failed-precondition", "Cadastro ilegível.");
    }
    if (!(CATEGORIAS_CNH as readonly string[]).includes(cnh.categoria)) throw new HttpsError("failed-precondition", "Cadastro ilegível.");
    lida = { categoria: cnh.categoria as CategoriaCnh, validade: cnh.validade };
  }
  const telefone = data.telefone;
  if (telefone != null && typeof telefone !== "string") throw new HttpsError("failed-precondition", "Cadastro ilegível.");
  if (typeof data.ativo !== "boolean" || typeof data.edicao !== "number") throw new HttpsError("failed-precondition", "Cadastro ilegível.");
  // Cadastro anterior à parte 3.4: própria, sem papel e sem login do app.
  return {
    id,
    nome: texto(data, "nome"),
    cpf: texto(data, "cpf"),
    funcao: texto(data, "funcao"),
    telefone: telefone ?? null,
    cnh: lida,
    vinculo: (VINCULOS as readonly string[]).includes(data.vinculo) ? (data.vinculo as Vinculo) : "proprio",
    empresa: textoOuNull(data.empresa),
    papeis: Array.isArray(data.papeis) ? PAPEIS_DE_CAMPO.filter((papel): papel is PapelDeCampo => data.papeis.includes(papel)) : [],
    usuario_uid: textoOuNull(data.usuario_uid),
    usuario_email: textoOuNull(data.usuario_email),
    ativo: data.ativo,
    edicao: data.edicao,
  };
}

function textoOuNull(valor: unknown): string | null {
  return typeof valor === "string" && valor.trim() ? valor.trim() : null;
}

export function veiculoLido(id: string, data: DocumentData): VeiculoGravado {
  const modelo = data.modelo;
  if (modelo != null && typeof modelo !== "string") throw new HttpsError("failed-precondition", "Cadastro ilegível.");
  if (typeof data.capacidade_kg !== "number" || typeof data.capacidade_m3 !== "number") {
    throw new HttpsError("failed-precondition", "Cadastro ilegível.");
  }
  if (typeof data.ativo !== "boolean" || typeof data.edicao !== "number") throw new HttpsError("failed-precondition", "Cadastro ilegível.");
  // Veículo anterior à parte 3.4: próprio, sem revisão marcada.
  return {
    id,
    placa: texto(data, "placa"),
    tipo: texto(data, "tipo"),
    modelo: modelo ?? null,
    capacidade_kg: data.capacidade_kg,
    capacidade_m3: data.capacidade_m3,
    dono: (DONOS_DE_VEICULO as readonly string[]).includes(data.dono) ? (data.dono as DonoDeVeiculo) : "proprio",
    empresa: textoOuNull(data.empresa),
    revisao_em: textoOuNull(data.revisao_em),
    ativo: data.ativo,
    edicao: data.edicao,
  };
}

async function idsOnde(transaction: Transaction, db: Firestore, collection: string, campo: string, valor: string): Promise<string[]> {
  const encontrados = await transaction.get(db.collection(collection).where(campo, "==", valor).limit(2));
  return encontrados.docs.map((item) => item.id);
}

function gravar(
  transaction: Transaction,
  db: Firestore,
  collection: string,
  documento: { id: string },
  campos: Record<string, unknown>,
  novo: boolean,
  caller: OperacaoProfile,
): void {
  const ref = db.collection(collection).doc(documento.id);
  const comum = {
    ...campos,
    atualizado_por: { uid: caller.uid, role: caller.role },
    updated_at: FieldValue.serverTimestamp(),
  };
  if (novo) {
    transaction.create(ref, { ...comum, created_at: FieldValue.serverTimestamp() });
    return;
  }
  transaction.set(ref, comum, { merge: true });
}

export async function saveCollaboratorFor(
  db: Firestore,
  caller: OperacaoProfile,
  data: unknown,
): Promise<ResultadoDoCadastro & { replayed?: true }> {
  exigirPapel(caller);
  const acao = interpretarColaborador(data);
  const id = acao.action === "create" ? novoId("col") : acao.id;
  return runIdempotent(db, {
    kind: "collaborator_save",
    scope: acao.action === "create" ? { collection: COLLABORATORS_COLLECTION, action: "create" } : { collection: COLLABORATORS_COLLECTION, id },
    idempotency_key: acao.idempotency_key,
    input: acao,
    actor: ator(caller),
  }, async (transaction, { operationId }) => {
    const atual = await lerColaborador(transaction, db, acao, id);
    const cpf = acao.action === "create" ? acao.cpf : acao.action === "update" ? acao.cpf : undefined;
    if (cpf) {
      const conflito = conflitoDeCpf(acao.action === "create" ? null : id, await idsOnde(transaction, db, COLLABORATORS_COLLECTION, "cpf", cpf));
      if (conflito) throw new HttpsError("already-exists", conflito);
    }
    const email = acao.action === "set_active" ? undefined : acao.usuario_email;
    const usuarioUid = email ? await usuarioDoApp(transaction, db, email, id) : null;
    const efeito = aplicarColaborador(atual, acao, id);
    if (email !== undefined) efeito.documento = { ...efeito.documento, usuario_uid: usuarioUid };
    gravar(transaction, db, COLLABORATORS_COLLECTION, efeito.documento, efeito.documento, acao.action === "create", caller);
    const payload = efeito.evento === "collaborator.updated"
      ? { id: efeito.documento.id, edicao_antes: atual?.edicao ?? efeito.documento.edicao - 1, edicao_depois: efeito.documento.edicao }
      : { id: efeito.documento.id };
    createOperacaoEvent(transaction, db, {
      operation_id: operationId,
      type: efeito.evento,
      entity_id: efeito.documento.id,
      payload,
      actor: ator(caller),
    });
    return { target_id: efeito.documento.id, result: { id: efeito.documento.id, edicao: efeito.documento.edicao } };
  });
}

/**
 * O login do app pelo e-mail: um usuário ativo, de papel com o app do campo,
 * ligado a um colaborador só. A pessoa nunca escolhe o uid.
 */
async function usuarioDoApp(transaction: Transaction, db: Firestore, email: string, colaboradorId: string): Promise<string> {
  const usuarios = await transaction.get(db.collection("users").where("email", "==", email).limit(2));
  if (usuarios.empty) throw new HttpsError("failed-precondition", "Nenhum usuário do app com este e-mail.");
  if (usuarios.size > 1) throw new HttpsError("failed-precondition", "Há mais de um usuário com este e-mail.");
  const usuario = usuarios.docs[0];
  const dados = usuario.data();
  if (dados.access_disabled === true) throw new HttpsError("failed-precondition", "O acesso deste usuário foi removido.");
  if (!(PAPEIS_COM_APP as readonly string[]).includes(String(dados.role))) {
    throw new HttpsError("failed-precondition", "O app do campo é de quem tem o papel campo ou interno.");
  }
  const conflito = conflitoDeUsuario(colaboradorId, await idsOnde(transaction, db, COLLABORATORS_COLLECTION, "usuario_uid", usuario.id));
  if (conflito) throw new HttpsError("already-exists", conflito);
  return usuario.id;
}

async function lerColaborador(transaction: Transaction, db: Firestore, acao: AcaoColaborador, id: string): Promise<ColaboradorGravado | null> {
  if (acao.action === "create") return null;
  const snapshot = await transaction.get(db.collection(COLLABORATORS_COLLECTION).doc(id));
  if (!snapshot.exists) return null;
  return colaboradorLido(id, snapshot.data() ?? {});
}

export async function saveVehicleFor(
  db: Firestore,
  caller: OperacaoProfile,
  data: unknown,
): Promise<ResultadoDoCadastro & { replayed?: true }> {
  exigirPapel(caller);
  const acao = interpretarVeiculo(data);
  const id = acao.action === "create" ? novoId("vei") : acao.id;
  return runIdempotent(db, {
    kind: "vehicle_save",
    scope: acao.action === "create" ? { collection: VEHICLES_COLLECTION, action: "create" } : { collection: VEHICLES_COLLECTION, id },
    idempotency_key: acao.idempotency_key,
    input: acao,
    actor: ator(caller),
  }, async (transaction, { operationId }) => {
    const atual = await lerVeiculo(transaction, db, acao, id);
    const placa = acao.action === "create" ? acao.placa : acao.action === "update" ? acao.placa : undefined;
    if (placa) {
      const conflito = conflitoDePlaca(acao.action === "create" ? null : id, await idsOnde(transaction, db, VEHICLES_COLLECTION, "placa", placa));
      if (conflito) throw new HttpsError("already-exists", conflito);
    }
    const efeito = aplicarVeiculo(atual, acao, id);
    gravar(transaction, db, VEHICLES_COLLECTION, efeito.documento, efeito.documento, acao.action === "create", caller);
    const payload = efeito.evento === "vehicle.updated"
      ? { id: efeito.documento.id, edicao_antes: atual?.edicao ?? efeito.documento.edicao - 1, edicao_depois: efeito.documento.edicao }
      : { id: efeito.documento.id };
    createOperacaoEvent(transaction, db, {
      operation_id: operationId,
      type: efeito.evento,
      entity_id: efeito.documento.id,
      payload,
      actor: ator(caller),
    });
    return { target_id: efeito.documento.id, result: { id: efeito.documento.id, edicao: efeito.documento.edicao } };
  });
}

async function lerVeiculo(transaction: Transaction, db: Firestore, acao: AcaoVeiculo, id: string): Promise<VeiculoGravado | null> {
  if (acao.action === "create") return null;
  const snapshot = await transaction.get(db.collection(VEHICLES_COLLECTION).doc(id));
  if (!snapshot.exists) return null;
  return veiculoLido(id, snapshot.data() ?? {});
}
