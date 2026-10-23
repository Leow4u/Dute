import type { Firestore } from "firebase-admin/firestore";
import { HttpsError, type CallableRequest } from "firebase-functions/https";

import { assertLiberado } from "./liberacao.js";
import { isPlatformRole, operacaoCadastroProblem, tvProblem, type PlatformRole } from "./platform-roles.js";

/**
 * Perfil de quem grava o cadastro da Operação. Cópia mínima do getProfile do
 * Comercial: as codebases não importam umas das outras.
 */

export const USERS_COLLECTION = "users";

export type OperacaoProfile = {
  uid: string;
  email?: string;
  role: PlatformRole;
  name?: string;
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
  return profile;
}

/**
 * `campo`: a callable de execução também atende o campo (que só grava na OS
 * em que está escalado, parte 3.8a). `painel`: a leitura da TV (parte 3.12)
 * atende o painel e quem coordena; nenhuma outra callable atende o painel.
 */
export type OpcoesDoCaller = { campo?: true; painel?: true };

export async function getProfile(db: Firestore, request: CallableRequest<unknown>, opcoes: OpcoesDoCaller = {}): Promise<OperacaoProfile> {
  const auth = assertAuth(request);
  const profile = await loadProfile(db, auth.uid, auth.token.email, auth.token.name);
  if (opcoes.campo && profile.role === "campo") return profile;
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
