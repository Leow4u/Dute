import { FieldValue, type Firestore } from "firebase-admin/firestore";
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
    const snapshot = await transaction.get(userRef);
    if (!snapshot.exists) {
      throw new HttpsError("not-found", "Pessoa não encontrada.");
    }
    const user = snapshot.data() ?? {};
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
