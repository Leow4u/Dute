import {
  FieldValue,
  type Firestore,
  type Transaction,
} from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";
import type { AccessActor } from "./access.js";

export function assertDirectoryPersonManageable(
  id: string,
  target: Record<string, unknown>,
  actor: AccessActor,
) {
  if (!["owner", "admin"].includes(actor.role)) {
    throw new HttpsError(
      "permission-denied",
      "Ação permitida somente para administradores de acesso.",
    );
  }
  if (id === actor.uid)
    throw new HttpsError(
      "failed-precondition",
      "Você não pode remover o próprio perfil.",
    );
  if (
    actor.role === "admin" &&
    ["owner", "admin"].includes(String(target.role))
  ) {
    throw new HttpsError(
      "permission-denied",
      "Somente o owner pode administrar perfis owner ou admin.",
    );
  }
}

/** Ocultar não exclui a identidade referenciada no histórico operacional. */
export function userDirectoryArchivePayload(
  id: string,
  target: Record<string, unknown>,
  actor: AccessActor,
) {
  assertDirectoryPersonManageable(id, target, actor);
  if (target.access_disabled !== true) {
    throw new HttpsError(
      "failed-precondition",
      "Revogue o acesso antes de remover a pessoa da lista.",
    );
  }
  return {
    directory_hidden: true,
    directory_hidden_by: actor.uid,
    directory_hidden_at: FieldValue.serverTimestamp(),
    pending_invite_id: FieldValue.delete(),
    updated_at: FieldValue.serverTimestamp(),
  };
}

/** Um convite novo pode reutilizar uma identidade removida, nunca um perfil ativo. */
export async function readReinvitedUser(
  transaction: Transaction,
  db: Firestore,
  email: string,
  actor: AccessActor,
) {
  const pending = await transaction.get(
    db.collection("invites").where("email", "==", email),
  );
  if (pending.docs.some((item) => item.get("status") === "pending")) {
    throw new HttpsError(
      "already-exists",
      "Já existe um convite pendente para este e-mail. Use Reenviar convite.",
    );
  }
  const matches = await transaction.get(
    db.collection("users").where("email", "==", email).limit(2),
  );
  if (matches.size > 1)
    throw new HttpsError(
      "failed-precondition",
      "Há mais de um perfil com este e-mail. Revise os acessos antes de convidar.",
    );
  const existing = matches.docs[0];
  if (!existing) return undefined;
  const target = existing.data();
  assertDirectoryPersonManageable(existing.id, target, actor);
  if (target.access_disabled !== true) {
    throw new HttpsError(
      "already-exists",
      "Esta pessoa já tem acesso. Para mudar o perfil, use as ações da pessoa.",
    );
  }
  return existing;
}

/** Habilita só o login para aceitar o convite; Rules e Functions continuam negando o perfil. */
export async function enableReinvitedLoginFor(
  db: Firestore,
  auth: {
    updateUser(uid: string, input: { disabled: boolean }): Promise<unknown>;
  },
  token: string,
  actor?: AccessActor,
): Promise<void> {
  const invite = (await db.collection("invites").doc(token).get()).data();
  if (
    invite?.status !== "pending" ||
    typeof invite.reinvite_user_id !== "string"
  )
    return;
  const user = (
    await db.collection("users").doc(invite.reinvite_user_id).get()
  ).data();
  if (user?.access_disabled !== true || user.pending_invite_id !== token)
    return;
  if (actor) assertDirectoryPersonManageable(invite.reinvite_user_id, user, actor);
  try {
    await auth.updateUser(invite.reinvite_user_id, { disabled: false });
  } catch (error) {
    // Sem conta no Auth, o aceite cria uma nova; a identidade antiga continua no histórico.
    if ((error as { code?: string })?.code !== "auth/user-not-found")
      throw new HttpsError(
        "unavailable",
        "O convite foi criado, mas o login não ficou pronto. Use Reenviar convite para tentar novamente.",
      );
  }
  await db.runTransaction(async (transaction) => {
    const inviteRef = db.collection("invites").doc(token);
    const [currentInvite, currentUser] = await Promise.all([
      transaction.get(inviteRef),
      transaction.get(db.collection("users").doc(invite.reinvite_user_id)),
    ]);
    if (
      currentInvite.get("status") === "pending" &&
      currentUser.get("pending_invite_id") === token
    ) {
      transaction.update(inviteRef, { login_preparation_pending: false });
    }
  });
}
