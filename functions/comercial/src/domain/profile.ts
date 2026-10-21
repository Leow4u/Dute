import type { Firestore } from "firebase-admin/firestore";
import { HttpsError, type CallableRequest } from "firebase-functions/https";

import { assertLiberado, comercialLiberado } from "./liberacao.js";
import {
  canApproveQuote,
  comercialAccessProblem,
  isPlatformRole,
  type AcessoComercial,
  type PlatformRole,
} from "./platform-roles.js";

/**
 * Perfil de quem chama o Comercial. Cópia mínima do getProfile do WMS
 * (functions/wms/src/index.ts, assertAuth e loadProfile): as codebases não
 * importam umas das outras. Sem perfil, com acesso removido ou com papel
 * inválido, permission-denied; depois, a barreira do módulo
 * (comercialAccessProblem).
 */

export const USERS_COLLECTION = "users";

export type ComercialProfile = {
  uid: string;
  email?: string;
  role: PlatformRole;
  customer_code?: string;
  name?: string;
};

export type ComercialStatus = {
  liberado: boolean;
  papel: PlatformRole;
  pode_aprovar: boolean;
};

export function assertAuth(request: CallableRequest<unknown>) {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Faça login para continuar.");
  }
  return request.auth;
}

export async function loadProfile(
  db: Firestore,
  uid: string,
  email?: string,
  tokenName?: string,
): Promise<ComercialProfile> {
  const snapshot = await db.collection(USERS_COLLECTION).doc(uid).get();
  if (!snapshot.exists) {
    throw new HttpsError("permission-denied", "Usuário sem perfil ativo.");
  }
  const data = snapshot.data() ?? {};
  // Acesso removido em Pessoas e acessos: o perfil fica para o histórico.
  if (data.access_disabled === true) {
    throw new HttpsError("permission-denied", "Acesso removido.");
  }
  const role = isPlatformRole(data.role) ? data.role : null;
  if (!role) {
    throw new HttpsError("permission-denied", "Perfil sem papel válido.");
  }
  const profile: ComercialProfile = { uid, role };
  const profileEmail = email ?? (typeof data.email === "string" ? data.email : undefined);
  if (profileEmail) profile.email = profileEmail;
  if (typeof data.customer_code === "string") profile.customer_code = data.customer_code;
  const name = typeof data.nome === "string" ? data.nome : tokenName;
  if (name) profile.name = name;
  return profile;
}

/**
 * Perfil com acesso ao Comercial; os outros papéis, inclusive cliente, dão
 * permission-denied. `acesso` abre ao financeiro só quando a callable pede.
 */
export async function getProfile(
  db: Firestore,
  request: CallableRequest<unknown>,
  acesso: AcessoComercial = {},
): Promise<ComercialProfile> {
  const auth = assertAuth(request);
  const profile = await loadProfile(db, auth.uid, auth.token.email, auth.token.name);
  const problem = comercialAccessProblem(profile.role, acesso);
  if (problem) throw new HttpsError("permission-denied", problem);
  return profile;
}

/**
 * Entrada de toda callable de negócio do Comercial: a liberação do ambiente
 * antes de tudo (não lê nada), depois login, perfil e papel. Sem `acesso`,
 * owner, admin e comercial; `{ financeiro: true }` abre também ao financeiro,
 * e só a recordAuthorization pede (callables.test.ts trava).
 */
export async function requireComercialCaller(
  db: Firestore,
  request: CallableRequest<unknown>,
  projectId: string,
  acesso: AcessoComercial = {},
): Promise<ComercialProfile> {
  assertLiberado(projectId);
  return getProfile(db, request, acesso);
}

/**
 * O que o comercialStatus devolve ao app: o Comercial aparece para a pessoa
 * quando o ambiente está liberado e o papel é do Comercial. Fora disso,
 * ninguém aprova.
 */
export function comercialStatusFor(projectId: string, role: PlatformRole): ComercialStatus {
  const liberado = comercialLiberado(projectId) && comercialAccessProblem(role) === null;
  return { liberado, papel: role, pode_aprovar: liberado && canApproveQuote(role) };
}
