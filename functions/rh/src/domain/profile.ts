import type { Firestore } from "firebase-admin/firestore";
import { HttpsError, type CallableRequest } from "firebase-functions/https";

import { assertLiberado } from "./liberacao.js";
import { isPlatformRole, rhProblem, type PlatformRole } from "./platform-roles.js";

/**
 * Perfil de quem abre o RH, lido no `users` do banco padrão. Cópia mínima do
 * getProfile das outras codebases: as codebases não importam umas das outras.
 */

export const USERS_COLLECTION = "users";

export type RhProfile = {
  uid: string;
  email?: string;
  role: PlatformRole;
  name?: string;
};

export function assertAuth(request: CallableRequest<unknown>) {
  if (!request.auth) throw new HttpsError("unauthenticated", "Faça login para continuar.");
  return request.auth;
}

export async function loadProfile(db: Firestore, uid: string, email?: string, tokenName?: string): Promise<RhProfile> {
  const snapshot = await db.collection(USERS_COLLECTION).doc(uid).get();
  if (!snapshot.exists) throw new HttpsError("permission-denied", "Usuário sem perfil ativo.");
  const data = snapshot.data() ?? {};
  if (data.access_disabled === true) throw new HttpsError("permission-denied", "Acesso removido.");
  const role = isPlatformRole(data.role) ? data.role : null;
  if (!role) throw new HttpsError("permission-denied", "Perfil sem papel válido.");
  const profile: RhProfile = { uid, role };
  const profileEmail = email ?? (typeof data.email === "string" ? data.email : undefined);
  if (profileEmail) profile.email = profileEmail;
  const name = typeof data.nome === "string" ? data.nome : tokenName;
  if (name) profile.name = name;
  return profile;
}

export async function getProfile(db: Firestore, request: CallableRequest<unknown>): Promise<RhProfile> {
  const auth = assertAuth(request);
  const profile = await loadProfile(db, auth.uid, auth.token.email, auth.token.name);
  const problem = rhProblem(profile.role);
  if (problem) throw new HttpsError("permission-denied", problem);
  return profile;
}

/**
 * Entrada de toda callable: a liberação do ambiente antes de tudo, depois
 * login, perfil e papel. `db` é o banco padrão, onde mora o `users`.
 */
export async function requireRhCaller(db: Firestore, request: CallableRequest<unknown>, projectId: string): Promise<RhProfile> {
  assertLiberado(projectId);
  return getProfile(db, request);
}
