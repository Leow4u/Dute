import { createHash, randomUUID } from "node:crypto";

import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";

import { normalize } from "./agent-dute.js";
import { createEvent, type OperationalActor } from "./operations.js";

/**
 * Memória sugerida do Agent Dute (ideia do Hermes Agent, com aprovação
 * humana). O agente só SUGERE uma anotação ("a BTG prefere entrega pela
 * manhã"); ela fica pendente e não muda nenhuma resposta até alguém da
 * coordenação aprovar. Aprovada, entra no contexto do agente para aquele
 * cliente. Toda sugestão e decisão grava evento em `events`.
 */

export const NOTES_COLLECTION = "ai_agent_notes";
const MAX_TEXT = 300;
const MAX_PENDING = 30;
const MAX_ACTIVE_IN_PROMPT = 30;

export type NoteVisibility = "todos" | "equipe";
export type NoteStatus = "pending" | "active" | "rejected" | "archived";

export const NOTE_REVIEWER_ROLES = ["owner", "admin", "interno", "suporte"];

function key(text: string) {
  return createHash("sha256").update(normalize(text).replace(/\s+/g, " ")).digest("hex").slice(0, 24);
}

function clean(text: string) {
  return text.replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);
}

export async function suggestNote(
  db: Firestore,
  input: {
    customerCode: string;
    text: string;
    reason?: string;
    conversationId: string;
    audience: "customer" | "internal";
    actor: OperationalActor;
  },
) {
  const text = clean(input.text);
  if (text.length < 8) return { sugerida: false, motivo: "Anotação curta demais." };
  const notes = db.collection(NOTES_COLLECTION);
  const id = `note_${key(`${input.customerCode}|${text}`)}`;
  return db.runTransaction(async (transaction) => {
    const existing = await transaction.get(notes.doc(id));
    const status = existing.data()?.status as NoteStatus | undefined;
    if (status === "pending" || status === "active") {
      return { sugerida: false, motivo: status === "active" ? "Já está anotado." : "Já está aguardando aprovação." };
    }
    const pending = await transaction.get(
      notes.where("customer_code", "==", input.customerCode).where("status", "==", "pending").limit(MAX_PENDING),
    );
    if (pending.size >= MAX_PENDING) {
      return { sugerida: false, motivo: "Há muitas anotações aguardando aprovação; tente depois." };
    }
    transaction.set(notes.doc(id), {
      id,
      customer_code: input.customerCode,
      text,
      reason: input.reason ? clean(input.reason) : null,
      // Sugerida na conversa do cliente vale para todos; na da equipe, só para a equipe.
      visibility: (input.audience === "customer" ? "todos" : "equipe") satisfies NoteVisibility,
      status: "pending" satisfies NoteStatus,
      source_conversation_id: input.conversationId,
      suggested_by: { uid: input.actor.uid, name: input.actor.name ?? null, role: input.actor.role },
      created_at: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp(),
    });
    createEvent(
      transaction,
      db,
      `evt_note_suggested_${id}_${randomUUID().slice(0, 8)}`,
      {
        type: "agent.note_suggested",
        title: "Agent Dute sugeriu uma anotação",
        description: text,
        entity_type: "agent_note",
        entity_id: id,
        customer_code: input.customerCode,
        payload: { conversation_id: input.conversationId },
        inbox: false,
      },
      input.actor,
    );
    return {
      sugerida: true,
      instrucao: "Diga à pessoa que a anotação foi sugerida e só passa a valer depois que a equipe Dutelog aprovar.",
    };
  });
}

export async function decideNote(
  db: Firestore,
  input: { id: string; action: "approve" | "reject" | "archive"; text?: string; visibility?: NoteVisibility },
  actor: OperationalActor,
) {
  if (!NOTE_REVIEWER_ROLES.includes(actor.role)) {
    throw new HttpsError("permission-denied", "Só a coordenação aprova anotações do Agent Dute.");
  }
  const ref = db.collection(NOTES_COLLECTION).doc(input.id);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw new HttpsError("not-found", "Anotação não encontrada.");
    const note = snapshot.data() ?? {};
    const status = note.status as NoteStatus;
    const allowed = input.action === "archive" ? status === "active" : status === "pending";
    if (!allowed) {
      throw new HttpsError("failed-precondition", `Esta anotação já está ${status === "active" ? "valendo" : status === "rejected" ? "recusada" : "arquivada"}.`);
    }
    const next: NoteStatus = input.action === "approve" ? "active" : input.action === "reject" ? "rejected" : "archived";
    const text = input.action === "approve" && input.text ? clean(input.text) : String(note.text ?? "");
    if (input.action === "approve" && text.length < 8) throw new HttpsError("invalid-argument", "Anotação curta demais.");
    transaction.update(ref, {
      status: next,
      text,
      visibility: input.action === "approve" && input.visibility ? input.visibility : note.visibility,
      decided_by: { uid: actor.uid, name: actor.name ?? null, role: actor.role },
      decided_at: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp(),
    });
    createEvent(
      transaction,
      db,
      `evt_note_${next}_${input.id}_${randomUUID().slice(0, 8)}`,
      {
        type: `agent.note_${next === "active" ? "approved" : next}`,
        title: next === "active" ? "Anotação do Agent Dute aprovada" : next === "rejected" ? "Anotação do Agent Dute recusada" : "Anotação do Agent Dute arquivada",
        description: text,
        entity_type: "agent_note",
        entity_id: input.id,
        customer_code: String(note.customer_code ?? ""),
        payload: { previous_text: note.text !== text ? note.text : undefined },
        inbox: false,
      },
      actor,
    );
    return { id: input.id, status: next };
  });
}

export async function listNotes(db: Firestore, customerCode: string) {
  const snapshot = await db.collection(NOTES_COLLECTION).where("customer_code", "==", customerCode).limit(300).get();
  const iso = (value: unknown) =>
    value && typeof value === "object" && "toDate" in value ? (value as { toDate: () => Date }).toDate().toISOString() : null;
  return snapshot.docs
    .map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        text: String(data.text ?? ""),
        reason: data.reason ? String(data.reason) : null,
        visibility: (data.visibility === "equipe" ? "equipe" : "todos") as NoteVisibility,
        status: data.status as NoteStatus,
        suggested_by_name: data.suggested_by?.name ?? null,
        suggested_by_role: data.suggested_by?.role ?? null,
        decided_by_name: data.decided_by?.name ?? null,
        created_at: iso(data.created_at),
        decided_at: iso(data.decided_at),
      };
    })
    .filter((note) => note.status === "pending" || note.status === "active")
    .sort((left, right) => String(right.created_at ?? "").localeCompare(String(left.created_at ?? "")));
}

/** Anotações aprovadas que entram no contexto do agente; o cliente só recebe as "todos". */
export async function activeNotesForPrompt(db: Firestore, customerCode: string, audience: "customer" | "internal") {
  const snapshot = await db
    .collection(NOTES_COLLECTION)
    .where("customer_code", "==", customerCode)
    .where("status", "==", "active")
    .limit(MAX_ACTIVE_IN_PROMPT * 2)
    .get();
  return snapshot.docs
    .map((doc) => doc.data())
    .filter((note) => audience === "internal" || note.visibility !== "equipe")
    .map((note) => String(note.text ?? "").trim())
    .filter(Boolean)
    .slice(0, MAX_ACTIVE_IN_PROMPT);
}
