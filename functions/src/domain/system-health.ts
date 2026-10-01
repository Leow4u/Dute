import type { Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";

/**
 * Seção Sistema da Configuração: o servidor responde, o banco responde, e o
 * ledger de eventos está recebendo dados? Substitui o "API Online" que vinha
 * de um /api/healthz fixo no navegador e nunca falhava.
 */

export const SYSTEM_HEALTH_ROLES = ["owner", "admin", "suporte"];
export const INCIDENT_EVENT_TYPE = "support.incident";
const INCIDENT_LIMIT = 20;

export type SystemHealthActor = { uid: string; role: string };

export type SystemIncident = {
  id: string;
  title: string;
  description: string;
  severity: string;
  occurred_at: string;
  reported_by: string;
};

export type SystemHealth = {
  ok: true;
  checked_at: string;
  firestore_ms: number;
  last_event: { type: string; title: string; occurred_at: string } | null;
  incidents: SystemIncident[];
};

export function assertCanReadSystemHealth(actor: SystemHealthActor) {
  if (!SYSTEM_HEALTH_ROLES.includes(actor.role)) {
    throw new HttpsError(
      "permission-denied",
      "Sistema visível somente para administração ou suporte.",
    );
  }
}

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

export async function readSystemHealth(
  db: Firestore,
  actor: SystemHealthActor,
  now: () => number = Date.now,
): Promise<SystemHealth> {
  assertCanReadSystemHealth(actor);
  const started = now();
  const latest = await db
    .collection("events")
    .orderBy("occurred_at", "desc")
    .limit(1)
    .get();
  const firestoreMs = Math.max(0, now() - started);

  // Igualdade simples (sem índice composto): incidentes são poucos, a
  // ordenação é feita aqui.
  const incidentDocs = await db
    .collection("events")
    .where("type", "==", INCIDENT_EVENT_TYPE)
    .get();
  const incidents = incidentDocs.docs
    .map((document) => {
      const data = document.data();
      const actorData = (data.actor ?? {}) as Record<string, unknown>;
      return {
        id: document.id,
        title: text(data.title),
        description: text(data.description),
        severity: text(data.severity) || "info",
        occurred_at: text(data.occurred_at),
        reported_by: text(actorData.name) || text(actorData.email),
      };
    })
    .sort((left, right) => right.occurred_at.localeCompare(left.occurred_at))
    .slice(0, INCIDENT_LIMIT);

  const last = latest.docs[0]?.data();
  return {
    ok: true,
    checked_at: new Date(now()).toISOString(),
    firestore_ms: firestoreMs,
    last_event: last
      ? {
          type: text(last.type),
          title: text(last.title),
          occurred_at: text(last.occurred_at),
        }
      : null,
    incidents,
  };
}
