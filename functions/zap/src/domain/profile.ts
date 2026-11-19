import type { Firestore } from "firebase-admin/firestore";
import { HttpsError, type CallableRequest } from "firebase-functions/https";

import { USERS_COLLECTION } from "./colecoes.js";
import { assertZapLiberado } from "./liberacao.js";

/**
 * Quem abre o painel, lido em `users/{uid}` do banco padrão, o mesmo documento
 * que o app lê. Só owner e admin. O painel repete esta conta na tela; a regra
 * do Firestore é a que vale.
 */

export type ZapProfile = {
  uid: string;
  role: "owner" | "admin";
};

export function podeVerZap(role: unknown): role is ZapProfile["role"] {
  return role === "owner" || role === "admin";
}

export async function requireZapCaller(db: Firestore, request: CallableRequest<unknown>, projectId: string): Promise<ZapProfile> {
  assertZapLiberado(projectId);
  if (!request.auth) throw new HttpsError("unauthenticated", "Faça login para continuar.");
  const snapshot = await db.collection(USERS_COLLECTION).doc(request.auth.uid).get();
  if (!snapshot.exists) throw new HttpsError("permission-denied", "Usuário sem perfil ativo.");
  const data = snapshot.data() ?? {};
  if (data.access_disabled === true) throw new HttpsError("permission-denied", "Acesso removido.");
  if (!podeVerZap(data.role)) throw new HttpsError("permission-denied", "O painel do Zap é só da administração.");
  return { uid: request.auth.uid, role: data.role };
}
