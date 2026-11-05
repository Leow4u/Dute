import { createHash } from "node:crypto";
import { FieldValue, type Firestore, type Transaction, type DocumentReference, type QueryDocumentSnapshot } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";
import { z } from "genkit";
import { assertInventoryOperationsEnabled, createEvent, type OperationalActor } from "./operations.js";
import { BOX_COUNTER_DOC, WAREHOUSE_COUNTERS_COLLECTION } from "./warehouse-boxes.js";

export type InboundCancellation = {
  receipt_id: string;
  customer_code: string;
  expected_status: "created" | "checking";
  reason: "duplicate" | "mistake" | "other";
  note?: string;
  duplicate_of_receipt_id?: string;
  idempotency_key: string;
};

const identity = z.string().trim().min(1).max(200).refine((value) => !value.includes("/"), "Identificador inválido.");
const schema = z.object({
  receipt_id: identity,
  customer_code: z.string().trim().min(1).max(160),
  expected_status: z.enum(["created", "checking"]),
  reason: z.enum(["duplicate", "mistake", "other"]),
  note: z.string().trim().max(500, "Use até 500 caracteres na observação.").optional(),
  duplicate_of_receipt_id: identity.optional(),
  idempotency_key: z.string().trim().min(8).max(200),
}).strict().superRefine((input, context) => {
  if (input.reason === "duplicate" && (!input.duplicate_of_receipt_id || input.duplicate_of_receipt_id === input.receipt_id)) {
    context.addIssue({ code: "custom", path: ["duplicate_of_receipt_id"], message: "Selecione a chegada original, diferente desta." });
  }
  if (input.reason !== "duplicate" && input.duplicate_of_receipt_id) {
    context.addIssue({ code: "custom", path: ["duplicate_of_receipt_id"], message: "A chegada original só se informa no motivo Duplicado." });
  }
  if (input.reason === "other" && !input.note) {
    context.addIssue({ code: "custom", path: ["note"], message: "Explique o motivo do cancelamento." });
  }
});

export function parseInboundCancellation(raw: unknown): InboundCancellation {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new HttpsError("invalid-argument", parsed.error.issues[0]?.message ?? "Cancelamento inválido.");
  return parsed.data;
}

type Row = Record<string, unknown>;
const text = (value: unknown): string => typeof value === "string" ? value.trim() : "";
const row = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const actorFields = (actor: OperationalActor) => Object.fromEntries(Object.entries({ uid: actor.uid, role: actor.role, name: actor.name, email: actor.email }).filter(([, value]) => value !== undefined));
const cancelled = (status: unknown) => ["cancelled", "canceled"].includes(text(status).toLowerCase());

function requireOwner(data: Row, customer: string) {
  if (text(data.customer_code) !== customer) throw new HttpsError("permission-denied", "Chegada ou vínculo de outro cliente. Confira o cliente ativo.");
}
function unavailable(message = "A entrada desta chegada já foi concluída ou possui movimentação. O cancelamento só vale antes da entrada."): never {
  throw new HttpsError("failed-precondition", message);
}
function saveOperation(tx: Transaction, ref: DocumentReference, input: InboundCancellation, inputHash: string, actor: OperationalActor, result: Row) {
  tx.create(ref, {
    id: ref.id, kind: "inbound.cancel", target_id: input.receipt_id, customer_code: input.customer_code,
    input_hash: inputHash, status: "completed", actor: actorFields(actor), result,
    created_at: FieldValue.serverTimestamp(), completed_at: FieldValue.serverTimestamp(),
  });
}

/** Cancela somente a intenção anterior à entrada. Nunca estorna razão, saldo ou cobrança. */
export async function cancelInboundReceiptTransaction(db: Firestore, raw: unknown, actor: OperationalActor): Promise<Record<string, unknown>> {
  if (!["owner", "admin", "interno", "wms"].includes(actor.role)) {
    throw new HttpsError("permission-denied", "Ação permitida somente para administração ou operação de armazém.");
  }
  const input = parseInboundCancellation(raw);
  const receiptRef = db.collection("inbound_receipts").doc(input.receipt_id);
  const operationRef = db.collection("operational_operations").doc(`op_inbound_cancel_${hash({ receipt: input.receipt_id, nonce: input.idempotency_key }).slice(0, 32)}`);
  const inputHash = hash(input);
  const occurredAt = new Date().toISOString();
  return db.runTransaction(async (tx) => {
    // O dono é conferido até no replay, antes de devolver seu resultado.
    const [operationSnapshot, receiptSnapshot] = await Promise.all([tx.get(operationRef), tx.get(receiptRef)]);
    if (!receiptSnapshot.exists) throw new HttpsError("not-found", "Chegada não encontrada.");
    const receipt = receiptSnapshot.data()!;
    requireOwner(receipt, input.customer_code);
    if (operationSnapshot.exists) {
      if (operationSnapshot.get("input_hash") !== inputHash) throw new HttpsError("already-exists", "A chave de idempotência já foi usada com outro conteúdo.");
      const result = operationSnapshot.get("result");
      if (!result || typeof result !== "object") unavailable("O recibo deste cancelamento não possui resultado válido.");
      return result as Row;
    }
    await assertInventoryOperationsEnabled(tx, db);
    const source = text(receipt.source);
    if (source !== "wms_unplanned_receipt" && (source || !input.receipt_id.startsWith("inb_avulso_"))) unavailable("Só a chegada avulsa pode ser cancelada aqui.");
    const result: Row = { ok: true, receipt_id: input.receipt_id, status: "cancelled" };
    if (cancelled(receipt.status)) {
      result.already_cancelled = true;
      saveOperation(tx, operationRef, input, inputHash, actor, result);
      return result;
    }
    const status = text(receipt.status);
    if (!["created", "checking"].includes(status)) unavailable();
    if (status !== input.expected_status) throw new HttpsError("aborted", "A chegada mudou em outra tela. Atualize antes de cancelar.");
    if (receipt.putaway_status || receipt.arrival_stored_event_id || Number(receipt.boxes_stored ?? 0) > 0) unavailable();

    const requestId = text(receipt.customer_request_id);
    const [itemsSnapshot, boxesSnapshot, originBoxesSnapshot, movements, putaways, originalSnapshot, noticeSnapshot] = await Promise.all([
      tx.get(db.collection("inbound_items").where("receipt_id", "==", input.receipt_id).limit(401)),
      tx.get(db.collection("warehouse_boxes").where("receipt_id", "==", input.receipt_id).limit(401)),
      tx.get(db.collection("warehouse_boxes").where("origin.receipt_id", "==", input.receipt_id).limit(401)),
      tx.get(db.collection("movements").where("receipt_id", "==", input.receipt_id).limit(1)),
      tx.get(db.collection("putaway_tasks").where("receipt_id", "==", input.receipt_id).limit(1)),
      input.duplicate_of_receipt_id ? tx.get(db.collection("inbound_receipts").doc(input.duplicate_of_receipt_id)) : undefined,
      requestId ? tx.get(db.collection("customer_requests").doc(requestId)) : undefined,
      // Iniciar caixa não grava a chegada. Este contador serializa criação × cancelamento,
      // como faz a conclusão da entrada (operations.ts).
      tx.get(db.collection(WAREHOUSE_COUNTERS_COLLECTION).doc(BOX_COUNTER_DOC)),
    ]);
    if (!movements.empty || !putaways.empty) unavailable();
    const items = itemsSnapshot.docs;
    const boxes = [...new Map<string, QueryDocumentSnapshot>([...boxesSnapshot.docs, ...originBoxesSnapshot.docs].map((box) => [box.id, box])).values()];
    if (items.length + boxes.length > 350) unavailable("Esta chegada excede o limite de cancelamento em uma operação. Peça revisão à coordenação.");
    for (const item of items) {
      requireOwner(item.data(), input.customer_code);
      if (!["expected", "checked", "divergence"].includes(text(item.get("status")))) unavailable();
    }
    if (originalSnapshot) {
      if (!originalSnapshot.exists) throw new HttpsError("not-found", "Chegada original não encontrada.");
      requireOwner(originalSnapshot.data()!, input.customer_code);
      if (cancelled(originalSnapshot.get("status"))) unavailable("A chegada original está cancelada. Selecione a chegada correta.");
    }
    if (requestId) {
      if (!noticeSnapshot?.exists) unavailable("O aviso vinculado não foi encontrado. Peça revisão à coordenação.");
      const notice = noticeSnapshot!.data()!;
      requireOwner(notice, input.customer_code);
      if (text(notice.status) === "approved" || text(row(notice.created_entities).inbound_id)) {
        unavailable("O aviso vinculado já foi aprovado com um recebimento. Peça revisão à coordenação.");
      }
      if (!/receb|inbound/i.test(text(notice.type))) unavailable("O vínculo da chegada não é um aviso de envio. Peça revisão à coordenação.");
    }

    const positions = new Set<string>();
    for (const box of boxes) {
      const data = box.data(), origin = row(data.origin);
      requireOwner(data, input.customer_code);
      if (text(data.receipt_id) !== input.receipt_id || text(origin.receipt_id) !== input.receipt_id || origin.kind !== "receipt") unavailable("Uma caixa tem vínculo inconsistente com esta chegada. Peça revisão à coordenação.");
      if (!["counting", "reviewed", "committing"].includes(text(data.status)) || Number(data.line_count ?? 0) > 0 || Number(data.unit_count ?? 0) > 0) unavailable();
      const location = text(data.location_id), destination = text(data.destination_location_id);
      if (data.status === "committing") {
        if (!location || location.includes("/") || (destination && destination !== location)) unavailable("Uma caixa tem reserva de posição inconsistente. Peça revisão à coordenação.");
        positions.add(location);
      } else if (location || destination) unavailable("Uma caixa tem reserva de posição inconsistente. Peça revisão à coordenação.");
    }
    if (items.length + boxes.length + positions.size > 400) unavailable("Esta chegada excede o limite de cancelamento em uma operação. Peça revisão à coordenação.");
    const [positionSnapshots, supported] = await Promise.all([
      Promise.all([...positions].map((code) => tx.get(db.collection("warehouse_positions").doc(code)))),
      // Uma igualdade, como removeWarehouseBox: dispensa índice composto novo.
      Promise.all(boxes.map((box) => tx.get(db.collection("warehouse_boxes").where("support_box_code", "==", box.id).limit(401)))),
    ]);
    if (supported.some((snapshot) => snapshot.size >= 401 || snapshot.docs.some((box) => ["committing", "stored"].includes(text(box.get("status")))))) unavailable("Uma caixa desta chegada serve de apoio para outra. Peça revisão à coordenação.");

    const cancellation = {
      status: "cancelled", cancelled_at: occurredAt, cancelled_by: actorFields(actor),
      cancellation_reason: input.reason, cancellation_note: input.note || null, cancellation_operation_id: operationRef.id,
      updated_at: FieldValue.serverTimestamp(),
    };
    tx.update(receiptRef, {
      ...cancellation, cancellation_previous_status: status,
      ...(originalSnapshot ? { duplicate_of_receipt_id: originalSnapshot.id, duplicate_of_receipt_number: text(originalSnapshot.get("receipt_number")) || originalSnapshot.id } : {}),
      // Mantém os dados visíveis e prelink no histórico. Só o vínculo ativo sai;
      // o aviso do cliente e seu portal continuam exatamente como estavam.
      ...(requestId ? { cancelled_customer_request_id: requestId, customer_request_id: FieldValue.delete() } : {}),
    });
    for (const item of items) tx.update(item.ref, { ...cancellation, cancellation_previous_status: item.get("status") });
    for (const box of boxes) tx.update(box.ref, {
      ...cancellation, cancellation_previous_status: box.get("status"),
      cancellation_previous_location_id: text(box.get("location_id")) || null,
      cancellation_previous_destination_location_id: text(box.get("destination_location_id")) || null,
      cancellation_previous_placement: {
        front_m: box.get("front_m") ?? null, depth_m: box.get("depth_m") ?? null,
        placed_height_m: box.get("placed_height_m") ?? null, orientation: box.get("orientation") ?? null,
        support_box_code: box.get("support_box_code") ?? null, base_height_m: box.get("base_height_m") ?? null,
      },
      location_id: "", destination_location_id: null, front_m: null, depth_m: null,
      placed_height_m: null, orientation: null, support_box_code: null, base_height_m: null,
      conference_revision: Number(box.get("conference_revision") ?? 0) + 1,
    });
    for (const position of positionSnapshots) if (position.exists) tx.update(position.ref, { occupancy_revision: FieldValue.increment(1) });
    createEvent(tx, db, `evt_inbound_cancel_${hash(input.receipt_id).slice(0, 32)}`, {
      type: "inbound.cancelled", title: `Chegada ${text(receipt.receipt_number) || input.receipt_id} cancelada`,
      description: input.note || (input.reason === "duplicate" ? "Chegada registrada em duplicidade." : "Erro no cadastro da chegada."),
      severity: "info", inbox: false, entity_type: "recebimento", entity_id: input.receipt_id,
      customer_code: input.customer_code, source: "functions", occurred_at: occurredAt,
      payload: {
        receipt_id: input.receipt_id, receipt_number: text(receipt.receipt_number), previous_status: status,
        reason: input.reason, note: input.note || null, item_count: items.length,
        box_codes: boxes.map((box) => box.id).sort(), released_positions: [...positions].sort(),
        duplicate_of_receipt_id: input.duplicate_of_receipt_id || null,
        duplicate_of_receipt_number: originalSnapshot ? text(originalSnapshot.get("receipt_number")) || originalSnapshot.id : null,
        customer_request_id: requestId || null,
      },
    }, actor);
    saveOperation(tx, operationRef, input, inputHash, actor, result);
    return result;
  });
}
