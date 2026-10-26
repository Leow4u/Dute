import { FieldValue, Timestamp, type Firestore } from "firebase-admin/firestore";

import { ROUTINES_COLLECTION } from "./agent-routines.js";

/**
 * Conta removida há mais de 12 meses (LGPD, decisão 8 do Leonardo,
 * 26/10/2026, docs/plataforma/lgpd.md, seção 6, parte 8c): a conta do
 * Firebase Auth sai e o perfil fica anônimo.
 *
 * O perfil continua, com o papel, o cliente e as datas do acesso, porque os
 * eventos e os registros dos módulos apontam para o uid; saem o nome, o
 * e-mail e o motivo da remoção. O convite que a pessoa usou perde o nome e o
 * e-mail, e as rotinas do Agent Dute dela, paradas desde que o acesso saiu,
 * saem. Os eventos ficam como foram gravados: são a trilha de quem fez o quê.
 */

/** Onde a rotina anonimiza: só a homologação, até o OK do Leonardo para a produção. */
export const ACCOUNT_RETENTION_PROJECTS = ["dute-homolog"];

export function accountRetentionEnabled(projectId: string | undefined) {
  return !!projectId && ACCOUNT_RETENTION_PROJECTS.includes(projectId);
}

export const MONTHS_AFTER_REMOVAL = 12;

/** O acesso removido antes deste instante vence: o mesmo dia, 12 meses antes. */
export function removalLimit(now: Date): Date {
  const limit = new Date(now.getTime());
  limit.setUTCMonth(limit.getUTCMonth() - MONTHS_AFTER_REMOVAL);
  return limit;
}

/** São Paulo não tem horário de verão desde 2019. */
const SAO_PAULO_OFFSET_MS = -3 * 60 * 60 * 1000;

function dayInSaoPaulo(instant: Date) {
  return new Date(instant.getTime() + SAO_PAULO_OFFSET_MS).toISOString().slice(0, 10);
}

/** Quando o acesso saiu: o `access_changed_at` do setUserAccess (texto ISO) ou uma data do Firestore. */
export function removedAt(value: unknown): number | null {
  if (value instanceof Timestamp) return value.toMillis();
  if (typeof value !== "string") return null;
  const millis = Date.parse(value);
  return Number.isNaN(millis) ? null : millis;
}

export type AccountState = "anonymize" | "keep" | "no_date";

/** O perfil com o acesso removido há mais de 12 meses e ainda com nome e e-mail é o que sai. */
export function accountState(profile: Record<string, unknown>, limit: Date): AccountState {
  if (profile.access_disabled !== true || profile.anonymized_at) return "keep";
  const removed = removedAt(profile.access_changed_at);
  if (removed === null) return "no_date";
  return removed < limit.getTime() ? "anonymize" : "keep";
}

/** O Firebase Auth que a rotina usa: o getAuth() no index, um falso nos testes. */
export type AccountAuth = {
  deleteUser(uid: string): Promise<void>;
};

export const ACCOUNT_RETENTION_ACTOR = { uid: "rotina-retencao-contas", role: "sistema", email: null, name: "Rotina de retenção das contas" };

/** Quantas contas por rodada: o resto fica para o dia seguinte. */
const ACCOUNTS_PER_RUN = 100;

export type AccountRetentionResult = {
  antes_de: string;
  contas: number;
  convites: number;
  rotinas: number;
  sem_data: number;
  falhas: number;
  completo: boolean;
};

/**
 * Anonimiza uma conta: o perfil, o convite usado, as rotinas e o evento numa
 * transação, que relê o perfil e desiste se o acesso voltou. Devolve o que
 * mudou, ou null.
 */
async function anonymizeAccount(db: Firestore, uid: string, limit: Date, nowIso: string) {
  const userRef = db.collection("users").doc(uid);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(userRef);
    const profile = snapshot.data() ?? {};
    if (!snapshot.exists || accountState(profile, limit) !== "anonymize") return null;
    const inviteId = typeof profile.invite_id === "string" ? profile.invite_id.trim() : "";
    const inviteRef = inviteId ? db.collection("invites").doc(inviteId) : null;
    const invite = inviteRef ? await transaction.get(inviteRef) : null;
    const routines = await transaction.get(db.collection(ROUTINES_COLLECTION).where("user_id", "==", uid));
    // Só o convite que esta conta usou; outro convite com o mesmo token não é dela.
    const inviteOfAccount = invite?.exists && invite.get("used_by") === uid ? invite : null;

    transaction.update(userRef, {
      nome: FieldValue.delete(),
      email: FieldValue.delete(),
      access_change_reason: FieldValue.delete(),
      anonymized_at: nowIso,
      updated_at: FieldValue.serverTimestamp(),
    });
    if (inviteOfAccount) {
      transaction.update(inviteOfAccount.ref, { nome: FieldValue.delete(), email: FieldValue.delete(), anonymized_at: nowIso });
    }
    for (const routine of routines.docs) transaction.delete(routine.ref);
    const eventRef = db.collection("events").doc();
    transaction.create(eventRef, {
      id: eventRef.id,
      type: "user.account_anonymized",
      title: "Conta anonimizada",
      description: "O acesso saiu há mais de 12 meses: o login foi apagado e o perfil ficou sem nome e e-mail.",
      severity: "info",
      entity_type: "user",
      entity_id: uid,
      payload: {
        role: profile.role ?? null,
        removido_em: dayInSaoPaulo(new Date(removedAt(profile.access_changed_at)!)),
        convite: !!inviteOfAccount,
        rotinas: routines.size,
      },
      occurred_at: nowIso,
      source: "functions_access",
      actor: ACCOUNT_RETENTION_ACTOR,
      created_at: FieldValue.serverTimestamp(),
    });
    return { invite: !!inviteOfAccount, routines: routines.size };
  });
}

/**
 * A rotina diária: para cada conta vencida, apaga o login no Auth e depois
 * anonimiza o perfil. Nessa ordem, a falha no meio repete os dois passos no
 * dia seguinte (a conta que já não está no Auth conta como apagada).
 */
export async function anonymizeRemovedAccounts(
  db: Firestore,
  auth: AccountAuth,
  options: { now?: Date; perRun?: number } = {},
): Promise<AccountRetentionResult> {
  const now = options.now ?? new Date();
  const perRun = options.perRun ?? ACCOUNTS_PER_RUN;
  const limit = removalLimit(now);
  const nowIso = now.toISOString();
  const result: AccountRetentionResult = { antes_de: dayInSaoPaulo(limit), contas: 0, convites: 0, rotinas: 0, sem_data: 0, falhas: 0, completo: true };
  const removed = await db.collection("users").where("access_disabled", "==", true).get();
  const due: string[] = [];
  for (const user of removed.docs) {
    const state = accountState(user.data(), limit);
    if (state === "no_date") result.sem_data += 1;
    if (state === "anonymize") due.push(user.id);
  }
  if (due.length > perRun) result.completo = false;
  for (const uid of due.slice(0, perRun)) {
    // Relê antes de apagar o login: o acesso pode ter voltado desde a leitura.
    const fresh = await db.collection("users").doc(uid).get();
    if (accountState(fresh.data() ?? {}, limit) !== "anonymize") continue;
    try {
      await auth.deleteUser(uid);
    } catch (error) {
      if ((error as { code?: unknown } | null)?.code !== "auth/user-not-found") {
        console.error("[runAccountRetention] login não apagado", { uid, error });
        result.falhas += 1;
        continue;
      }
    }
    const changed = await anonymizeAccount(db, uid, limit, nowIso);
    if (!changed) continue;
    result.contas += 1;
    if (changed.invite) result.convites += 1;
    result.rotinas += changed.routines;
  }
  return result;
}
