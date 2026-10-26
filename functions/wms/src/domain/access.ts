import { FieldValue, type Firestore, type Transaction } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";

/**
 * Remover / devolver o acesso de uma pessoa. O perfil fica (histórico e
 * auditoria), marcado com access_disabled; as Firestore Rules (hasProfile) e
 * o getProfile das Functions passam a recusá-lo. O bloqueio do login no
 * Firebase Auth é feito pelo callable, depois desta transação.
 */

export type AccessActor = {
  uid: string;
  role: string;
  email?: string;
  name?: string;
};

export type SetUserAccessInput = {
  user_id: string;
  active: boolean;
  reason?: string;
};

export type SetUserAccessResult = {
  ok: true;
  user_id: string;
  active: boolean;
  changed: boolean;
};

const PRIVILEGED = ["owner", "admin"];

/**
 * Quem administra o acesso, relido na transação: a decisão vale com o perfil
 * de agora, não com o lido antes dela. Duas pessoas que mexem uma na outra ao
 * mesmo tempo não passam as duas: a transação da segunda relê o perfil que a
 * primeira mudou e recomeça. Senão dois owners que se tiram ao mesmo tempo
 * deixariam o sistema sem nenhum.
 */
export async function assertAccessActorCurrent(
  transaction: Transaction,
  db: Firestore,
  actor: AccessActor,
): Promise<void> {
  const snapshot = await transaction.get(db.collection("users").doc(actor.uid));
  const current = snapshot.data() ?? {};
  if (!snapshot.exists || current.access_disabled === true || String(current.role) !== actor.role) {
    throw new HttpsError("permission-denied", "Seu acesso mudou: entre de novo para administrar acessos.");
  }
}

export async function setUserAccessTransaction(
  db: Firestore,
  input: SetUserAccessInput,
  actor: AccessActor,
): Promise<SetUserAccessResult> {
  if (!PRIVILEGED.includes(actor.role)) {
    throw new HttpsError(
      "permission-denied",
      "Ação permitida somente para administradores de acesso.",
    );
  }
  if (input.user_id === actor.uid) {
    throw new HttpsError(
      "failed-precondition",
      "Você não pode remover o próprio acesso.",
    );
  }

  const userRef = db.collection("users").doc(input.user_id);
  return db.runTransaction(async (transaction) => {
    const [snapshot] = await Promise.all([
      transaction.get(userRef),
      assertAccessActorCurrent(transaction, db, actor),
    ]);
    if (!snapshot.exists) {
      throw new HttpsError("not-found", "Pessoa não encontrada.");
    }
    const user = snapshot.data() ?? {};
    // A conta anonimizada (LGPD, decisão 8, parte 8c) não tem login, nome nem e-mail: volta só por convite novo.
    if (input.active && user.anonymized_at) {
      throw new HttpsError(
        "failed-precondition",
        "O acesso desta conta saiu há mais de 12 meses e ela ficou anônima. Convide a pessoa de novo.",
      );
    }
    if (actor.role === "admin" && PRIVILEGED.includes(String(user.role))) {
      throw new HttpsError(
        "permission-denied",
        "Somente o owner pode remover o acesso de administradores.",
      );
    }

    const disabled = user.access_disabled === true;
    if (disabled === !input.active) {
      return { ok: true, user_id: input.user_id, active: input.active, changed: false };
    }

    const now = new Date().toISOString();
    const reason = input.reason?.trim() || null;
    transaction.update(userRef, {
      access_disabled: !input.active,
      access_changed_at: now,
      access_changed_by: actor.uid,
      access_change_reason: reason,
      updated_at: FieldValue.serverTimestamp(),
    });
    const eventRef = db.collection("events").doc();
    const who = String(user.nome ?? user.email ?? input.user_id);
    transaction.create(eventRef, {
      id: eventRef.id,
      type: input.active ? "user.access_restored" : "user.access_revoked",
      title: input.active ? "Acesso devolvido" : "Acesso removido",
      description: `${who}${reason ? ` — ${reason}` : ""}`,
      severity: "info",
      entity_type: "user",
      entity_id: input.user_id,
      payload: { role: user.role ?? null, email: user.email ?? null, reason },
      occurred_at: now,
      source: "functions_access",
      actor: {
        uid: actor.uid,
        role: actor.role,
        email: actor.email ?? null,
        name: actor.name ?? null,
      },
      created_at: FieldValue.serverTimestamp(),
    });
    return { ok: true, user_id: input.user_id, active: input.active, changed: true };
  });
}

/** O que, em cada cadastro, decide o que a pessoa ou o cliente passa a ver. */
const ACCESS_FIELDS: Record<string, readonly string[]> = {
  users: ["role"],
  customers: ["status", "portal_status", "operation_template", "sku_prefix"],
};

/**
 * O antes e o depois do que muda o acesso, para o evento da alteração
 * (`role_before`, `role_after`...): sem eles, a linha do tempo não
 * reconstrói quem passou a ver o quê. O que a alteração não manda fica com o
 * valor de antes.
 */
export function accessChangeFromTo(
  resource: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Record<string, unknown> {
  const fromTo: Record<string, unknown> = {};
  for (const field of ACCESS_FIELDS[resource] ?? []) {
    fromTo[`${field}_before`] = before[field] ?? null;
    fromTo[`${field}_after`] = after[field] ?? before[field] ?? null;
  }
  return fromTo;
}

/** O Firebase Auth que o acesso usa: o getAuth() no callable, um falso nos testes. */
export type AccessAuth = {
  updateUser(uid: string, properties: { disabled: boolean }): Promise<unknown>;
  revokeRefreshTokens(uid: string): Promise<void>;
};

/**
 * Remove ou devolve o acesso: o perfil na transação e, a cada chamada, o
 * login no Firebase Auth acompanhando o perfil, mesmo quando o perfil já
 * estava assim. A falha no Auth volta como erro, e a nova tentativa refaz o
 * passo. O bloqueio pelo perfil (Rules e getProfile) já vale sem o Auth; o
 * login liberado, não.
 */
export async function setUserAccessFor(
  db: Firestore,
  auth: AccessAuth,
  input: SetUserAccessInput,
  actor: AccessActor,
): Promise<SetUserAccessResult & { auth_updated: true }> {
  const result = await setUserAccessTransaction(db, input, actor);
  try {
    await auth.updateUser(input.user_id, { disabled: !input.active });
    if (!input.active) await auth.revokeRefreshTokens(input.user_id);
  } catch (error) {
    const semConta = (error as { code?: unknown } | null)?.code === "auth/user-not-found";
    // Sem a conta no Auth, não há login para bloquear.
    if (semConta && !input.active) return { ...result, auth_updated: true };
    // Nem para liberar: outra tentativa não adianta.
    if (semConta) {
      throw new HttpsError("failed-precondition", "O acesso voltou no sistema, mas a pessoa não tem login. Convide-a de novo.");
    }
    console.error("[setUserAccess] Firebase Auth não atualizado", error);
    throw new HttpsError(
      "unavailable",
      input.active
        ? "O acesso voltou no sistema, mas o login da pessoa não foi liberado. Tente de novo."
        : "O acesso saiu do sistema, mas o login da pessoa não foi bloqueado. Tente de novo.",
    );
  }
  return { ...result, auth_updated: true };
}
