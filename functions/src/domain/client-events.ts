import { createHash, randomUUID } from "node:crypto";

import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";
import { z } from "genkit";

import { createEvent, type OperationalActor } from "./operations.js";

/**
 * Eventos do portal: o cliente guarda o que vai para um evento que se repete
 * (um festival, o estande de uma feira), onde é e como a Dutelog leva, monta
 * e traz de volta. É um modelo de pedido e não movimenta estoque: "Usar no
 * pedido" só preenche o pedido no Estoque, que segue o caminho de sempre
 * (createCustomerRequest, aprovação, reserva).
 *
 * Coleção própria (client_event_templates) para não confundir com `events`,
 * a trilha de auditoria. customer_code é a fronteira: o cliente só vê e
 * mexe nos dele; a coordenação (owner, admin, interno) pode cuidar a pedido
 * do cliente. Excluir arquiva (fica para o histórico). Toda gravação gera
 * um registro em `events`.
 */

export const CLIENT_EVENTS_COLLECTION = "client_event_templates";
const INTERNAL_EDITORS = ["owner", "admin", "interno"];
const MAX_ITEMS = 200;
const MAX_LIST = 200;

const optionalText = (max: number) =>
  z.string().trim().max(max).nullish().transform((value) => value || null);

export const ClientEventItemSchema = z.object({
  sku_code: z.string().trim().min(1).max(120),
  client_item_code: optionalText(120),
  product_name: z.string().trim().min(1).max(200),
  quantity: z.number().int().min(1).max(1_000_000),
});

export const ClientEventInputSchema = z.object({
  /** Com id, edita; sem id, cria. */
  id: z.string().trim().max(120).nullish(),
  /** Repetir a criação com a mesma chave não duplica o evento. */
  idempotency_key: z.string().trim().max(120).nullish(),
  name: z.string().trim().min(1).max(120),
  description: optionalText(300),
  venue: z.string().trim().min(1).max(160),
  address: optionalText(300),
  /** Dia da próxima edição (AAAA-MM-DD). */
  next_date: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullish()
    .or(z.literal(""))
    .transform((value) => value || null),
  schedule: optionalText(300),
  logistics: optionalText(300),
  items: z.array(ClientEventItemSchema).min(1).max(MAX_ITEMS),
});

export const ArchiveClientEventSchema = z.object({
  id: z.string().trim().min(1).max(120),
});

export type ClientEventInput = z.infer<typeof ClientEventInputSchema>;
export type ClientEventItem = z.infer<typeof ClientEventItemSchema>;

export type ClientEventView = {
  id: string;
  name: string;
  description: string | null;
  venue: string;
  address: string | null;
  next_date: string | null;
  schedule: string | null;
  logistics: string | null;
  items: ClientEventItem[];
  updated_by_name: string | null;
  updated_at: string | null;
};

export function assertClientEventEditor(actor: { role: string; customer_code?: string }) {
  if (actor.role === "cliente") {
    if (!actor.customer_code) throw new HttpsError("permission-denied", "Cliente sem código operacional.");
    return;
  }
  if (!INTERNAL_EDITORS.includes(actor.role)) {
    throw new HttpsError("permission-denied", "Perfil sem acesso aos eventos do cliente.");
  }
}

/** Mesma chave do mesmo cliente → mesmo documento. */
export function clientEventIdFor(customerCode: string, idempotencyKey?: string | null) {
  if (!idempotencyKey) return `cev_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const hash = createHash("sha256").update(`${customerCode}\u0000${idempotencyKey}`).digest("hex");
  return `cev_${hash.slice(0, 16)}`;
}

const iso = (value: unknown) =>
  value && typeof value === "object" && "toDate" in value
    ? (value as { toDate: () => Date }).toDate().toISOString()
    : null;

const textOrNull = (value: unknown) => (typeof value === "string" && value.trim() ? value : null);

function view(id: string, data: Record<string, unknown>): ClientEventView {
  const items = Array.isArray(data.items) ? (data.items as Array<Record<string, unknown>>) : [];
  return {
    id,
    name: String(data.name ?? ""),
    description: textOrNull(data.description),
    venue: String(data.venue ?? ""),
    address: textOrNull(data.address),
    next_date: textOrNull(data.next_date),
    schedule: textOrNull(data.schedule),
    logistics: textOrNull(data.logistics),
    items: items.map((item) => ({
      sku_code: String(item.sku_code ?? ""),
      client_item_code: textOrNull(item.client_item_code),
      product_name: String(item.product_name ?? ""),
      quantity: Number(item.quantity ?? 0),
    })),
    updated_by_name: (data.updated_by as { name?: string } | undefined)?.name ?? null,
    updated_at: iso(data.updated_at),
  };
}

function actorRef(actor: OperationalActor) {
  return { uid: actor.uid, name: actor.name ?? null, role: actor.role };
}

/**
 * Eventos ativos do cliente, por nome (a tela ordena pela próxima edição).
 * Duas igualdades: o Firestore junta os índices de campo único, sem índice
 * composto (não há orderBy nem desigualdade aqui).
 */
export async function listClientEvents(db: Firestore, customerCode: string, actor: OperationalActor) {
  assertClientEventEditor(actor);
  const snapshot = await db
    .collection(CLIENT_EVENTS_COLLECTION)
    .where("customer_code", "==", customerCode)
    .where("status", "==", "active")
    .limit(MAX_LIST)
    .get();
  return snapshot.docs
    .map((doc) => view(doc.id, doc.data()))
    .sort((left, right) => left.name.localeCompare(right.name, "pt-BR"));
}

/** Cria ou edita um evento do cliente. Grava evento de auditoria. */
export async function saveClientEvent(
  db: Firestore,
  customerCode: string,
  input: ClientEventInput,
  actor: OperationalActor,
) {
  assertClientEventEditor(actor);
  const editing = Boolean(input.id);
  const id = input.id || clientEventIdFor(customerCode, input.idempotency_key);
  const ref = db.collection(CLIENT_EVENTS_COLLECTION).doc(id);
  return db.runTransaction(async (transaction) => {
    const existing = await transaction.get(ref);
    const before = existing.data() ?? {};
    if (existing.exists && before.customer_code !== customerCode) {
      throw new HttpsError("not-found", "Evento não encontrado.");
    }
    if (editing && (!existing.exists || before.status !== "active")) {
      throw new HttpsError("not-found", "Evento não encontrado.");
    }
    // Repetição da mesma criação (clique duplo, nova tentativa): devolve o que já existe.
    if (!editing && existing.exists) {
      return { id, created: false, event: view(id, before) };
    }

    const content = {
      name: input.name,
      description: input.description,
      venue: input.venue,
      address: input.address,
      next_date: input.next_date,
      schedule: input.schedule,
      logistics: input.logistics,
      items: input.items.map((item) => ({
        sku_code: item.sku_code,
        client_item_code: item.client_item_code,
        product_name: item.product_name,
        quantity: item.quantity,
      })),
    };
    if (editing) {
      transaction.update(ref, { ...content, updated_by: actorRef(actor), updated_at: FieldValue.serverTimestamp() });
    } else {
      transaction.create(ref, {
        id,
        customer_code: customerCode,
        ...content,
        status: "active",
        created_by: actorRef(actor),
        updated_by: actorRef(actor),
        created_at: FieldValue.serverTimestamp(),
        updated_at: FieldValue.serverTimestamp(),
      });
    }
    createEvent(
      transaction,
      db,
      `evt_client_event_${editing ? "updated" : "created"}_${id}_${randomUUID().slice(0, 8)}`,
      {
        type: editing ? "client_event_template.updated" : "client_event_template.created",
        title: editing ? "Evento do portal editado" : "Evento do portal criado",
        description: `${input.name} · ${input.venue}`,
        entity_type: "client_event_template",
        entity_id: id,
        customer_code: customerCode,
        payload: {
          items: input.items.length,
          pieces: input.items.reduce((sum, item) => sum + item.quantity, 0),
          next_date: input.next_date,
        },
        source: "functions_client_events",
        inbox: false,
      },
      actor,
    );
    return {
      id,
      created: !editing,
      event: view(id, { ...before, ...content, updated_by: actorRef(actor) }),
    };
  });
}

/** Excluir na tela: arquiva, some da lista e fica para o histórico. */
export async function archiveClientEvent(
  db: Firestore,
  customerCode: string,
  input: z.infer<typeof ArchiveClientEventSchema>,
  actor: OperationalActor,
) {
  assertClientEventEditor(actor);
  const ref = db.collection(CLIENT_EVENTS_COLLECTION).doc(input.id);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const data = snapshot.data();
    if (!snapshot.exists || !data || data.customer_code !== customerCode) {
      throw new HttpsError("not-found", "Evento não encontrado.");
    }
    if (data.status !== "active") return { id: input.id, changed: false };
    transaction.update(ref, {
      status: "archived",
      archived_by: actorRef(actor),
      archived_at: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp(),
    });
    createEvent(
      transaction,
      db,
      `evt_client_event_archived_${input.id}_${randomUUID().slice(0, 8)}`,
      {
        type: "client_event_template.archived",
        title: "Evento do portal excluído",
        description: String(data.name ?? ""),
        entity_type: "client_event_template",
        entity_id: input.id,
        customer_code: customerCode,
        payload: {},
        source: "functions_client_events",
        inbox: false,
      },
      actor,
    );
    return { id: input.id, changed: true };
  });
}
