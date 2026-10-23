import type { Firestore } from "firebase-admin/firestore";
import { HttpsError, type CallableRequest } from "firebase-functions/https";

import { assertLiberado } from "./liberacao.js";
import { isPlatformRole, type PlatformRole } from "./platform-roles.js";

/**
 * Perfil de quem chama o núcleo. Cópia mínima do getProfile do Financeiro:
 * as codebases não importam umas das outras.
 */

export const USERS_COLLECTION = "users";

export type CoreProfile = {
  uid: string;
  email?: string;
  role: PlatformRole;
  name?: string;
};

export function assertAuth(request: CallableRequest<unknown>) {
  if (!request.auth) throw new HttpsError("unauthenticated", "Faça login para continuar.");
  return request.auth;
}

export async function loadProfile(db: Firestore, uid: string, email?: string, tokenName?: string): Promise<CoreProfile> {
  const snapshot = await db.collection(USERS_COLLECTION).doc(uid).get();
  if (!snapshot.exists) throw new HttpsError("permission-denied", "Usuário sem perfil ativo.");
  const data = snapshot.data() ?? {};
  if (data.access_disabled === true) throw new HttpsError("permission-denied", "Acesso removido.");
  const role = isPlatformRole(data.role) ? data.role : null;
  if (!role) throw new HttpsError("permission-denied", "Perfil sem papel válido.");
  const profile: CoreProfile = { uid, role };
  const profileEmail = email ?? (typeof data.email === "string" ? data.email : undefined);
  if (profileEmail) profile.email = profileEmail;
  const name = typeof data.nome === "string" ? data.nome : tokenName;
  if (name) profile.name = name;
  return profile;
}

/**
 * Entrada de toda callable do núcleo: a liberação do ambiente antes de tudo,
 * depois login e perfil. O papel é da callable: cada uma confere o dela.
 */
export async function requireCoreCaller(db: Firestore, request: CallableRequest<unknown>, projectId: string): Promise<CoreProfile> {
  assertLiberado(projectId);
  const auth = assertAuth(request);
  return loadProfile(db, auth.uid, auth.token.email, auth.token.name);
}
