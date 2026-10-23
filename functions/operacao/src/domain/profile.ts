import type { Firestore } from "firebase-admin/firestore";
import { HttpsError, type CallableRequest } from "firebase-functions/https";

import { assertLiberado } from "./liberacao.js";
import { contractedModulesFrom, isPlatformRole, operacaoCadastroProblem, tvProblem, type PlatformRole } from "./platform-roles.js";

/**
 * Perfil de quem grava o cadastro da Operação. Cópia mínima do getProfile do
 * Comercial: as codebases não importam umas das outras.
 */

export const USERS_COLLECTION = "users";
export const CLIENT_ACCESS_COLLECTION = "client_access";

export type OperacaoProfile = {
  uid: string;
  email?: string;
  role: PlatformRole;
  name?: string;
  /** O cliente do login de papel `cliente` (a fronteira de isolamento, invariante 4). */
  customer_code?: string;
};

export function assertAuth(request: CallableRequest<unknown>) {
  if (!request.auth) throw new HttpsError("unauthenticated", "Faça login para continuar.");
  return request.auth;
}

export async function loadProfile(db: Firestore, uid: string, email?: string, tokenName?: string): Promise<OperacaoProfile> {
  const snapshot = await db.collection(USERS_COLLECTION).doc(uid).get();
  if (!snapshot.exists) throw new HttpsError("permission-denied", "Usuário sem perfil ativo.");
  const data = snapshot.data() ?? {};
  if (data.access_disabled === true) throw new HttpsError("permission-denied", "Acesso removido.");
  const role = isPlatformRole(data.role) ? data.role : null;
  if (!role) throw new HttpsError("permission-denied", "Perfil sem papel válido.");
  const profile: OperacaoProfile = { uid, role };
  const profileEmail = email ?? (typeof data.email === "string" ? data.email : undefined);
  if (profileEmail) profile.email = profileEmail;
  const name = typeof data.nome === "string" ? data.nome : tokenName;
  if (name) profile.name = name;
  const customerCode = typeof data.customer_code === "string" ? data.customer_code.trim() : "";
  if (role === "cliente" && customerCode) profile.customer_code = customerCode;
  return profile;
}

/** O código serve de id em `client_access`: sem barra, sem `.` ou `..`, sem `__x__` (o critério do WMS). */
function codigoServeDeId(code: string): boolean {
  return Boolean(code) && !code.includes("/") && code !== "." && code !== ".." && !/^__.*__$/.test(code) && Buffer.byteLength(code, "utf8") <= 1500;
}

/**
 * O cliente que pede OS pelo portal (parte 4.4a): o papel `cliente`, com o
 * código no perfil e a Operação no contrato. Sem `client_access` valem os
 * módulos padrão (armazenagem e faturas), que não incluem a Operação.
 */
async function conferirClienteDoPortal(db: Firestore, profile: OperacaoProfile): Promise<OperacaoProfile> {
  if (profile.role !== "cliente") throw new HttpsError("permission-denied", "Só o cliente pede OS pelo portal.");
  const code = profile.customer_code ?? "";
  if (!codigoServeDeId(code)) throw new HttpsError("permission-denied", "Seu acesso não está ligado a um cliente.");
  const acesso = await db.collection(CLIENT_ACCESS_COLLECTION).doc(code).get();
  const modulos = contractedModulesFrom(acesso.exists ? acesso.get("modules") : undefined);
  if (!modulos.includes("operacao")) throw new HttpsError("permission-denied", "A Operação não está no contrato do seu acesso.");
  return profile;
}

/**
 * O cliente do sino do portal (parte 4.6c): o papel `cliente` com o código no
 * perfil, qualquer que seja o módulo no contrato (o aviso da NF vai a quem
 * tem só as faturas).
 */
function conferirClienteDoSino(profile: OperacaoProfile): OperacaoProfile {
  if (profile.role !== "cliente") throw new HttpsError("permission-denied", "Só o cliente marca os avisos do portal.");
  if (!codigoServeDeId(profile.customer_code ?? "")) throw new HttpsError("permission-denied", "Seu acesso não está ligado a um cliente.");
  return profile;
}

/**
 * `campo`: a callable de execução também atende o campo (que só grava na OS
 * em que está escalado, parte 3.8a). `painel`: a leitura da TV (parte 3.12)
 * atende o painel e quem coordena; nenhuma outra callable atende o painel.
 * `portal`: a callable do portal (parte 4.4a) atende só o cliente com a
 * Operação no contrato. `sino`: marcar os avisos como vistos (parte 4.6c)
 * atende só o cliente, com qualquer módulo. Nenhuma outra callable atende o
 * cliente. `wms`: a entrega do pedido de saída (parte 4.5b) também atende a
 * operação do armazém, que define a entrega no WMS.
 */
export type OpcoesDoCaller = { campo?: true; painel?: true; portal?: true; sino?: true; wms?: true };

export async function getProfile(db: Firestore, request: CallableRequest<unknown>, opcoes: OpcoesDoCaller = {}): Promise<OperacaoProfile> {
  const auth = assertAuth(request);
  const profile = await loadProfile(db, auth.uid, auth.token.email, auth.token.name);
  if (opcoes.portal) return conferirClienteDoPortal(db, profile);
  if (opcoes.sino) return conferirClienteDoSino(profile);
  if (opcoes.campo && profile.role === "campo") return profile;
  if (opcoes.wms && profile.role === "wms") return profile;
  const problem = opcoes.painel ? tvProblem(profile.role) : operacaoCadastroProblem(profile.role);
  if (problem) throw new HttpsError("permission-denied", problem);
  return profile;
}

/** Entrada de toda callable: a liberação do ambiente antes de tudo, depois login, perfil e papel. */
export async function requireOperacaoCaller(
  db: Firestore,
  request: CallableRequest<unknown>,
  projectId: string,
  opcoes: OpcoesDoCaller = {},
): Promise<OperacaoProfile> {
  assertLiberado(projectId);
  return getProfile(db, request, opcoes);
}
