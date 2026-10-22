import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";

/**
 * O aviso de envio do cliente (customer_requests, tipo recebimento, status
 * open) aparece no Receber antes da aprovação. A operação vincula a chegada
 * avulsa a ele. Quem aprova continua sendo a coordenação.
 */

const INBOUND = /receb|inbound/i;
const CLOSED_RECEIPT = new Set(["received", "completed", "cancelled"]);

export type NoticeActor = {
  uid: string;
  role: string;
  email?: string;
  name?: string;
};

function text(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

export function receiptDocumentId(value: string) {
  const id = value.trim();
  return id.startsWith("receiving:") ? id.slice("receiving:".length) : id;
}

export function shipmentNoticeProblem(
  request: Record<string, unknown>,
  customerCode: string,
): string | null {
  if (!text(request.customer_code) || text(request.customer_code) !== customerCode) {
    return "Aviso de outro cliente.";
  }
  if (!INBOUND.test(text(request.type))) return "Só avisos de envio podem ser vinculados.";
  if (text(request.status) !== "open") return "Este aviso não está aguardando aprovação.";
  return null;
}

export function receiptLinkProblem(
  receipt: Record<string, unknown>,
  customerCode: string,
): string | null {
  if (!text(receipt.customer_code) || text(receipt.customer_code) !== customerCode) {
    return "Chegada de outro cliente.";
  }
  if (CLOSED_RECEIPT.has(text(receipt.status).toLowerCase())) return "Esta chegada já foi concluída.";
  return null;
}

export async function linkInboundNoticeTransaction(
  db: Firestore,
  input: { receipt_id: string; request_id?: string | null; customer_code: string },
  actor: NoticeActor,
) {
  const receiptId = receiptDocumentId(text(input.receipt_id));
  const requestId = text(input.request_id);
  const customerCode = text(input.customer_code);
  if (!receiptId || receiptId.includes("/")) throw new HttpsError("invalid-argument", "Chegada inválida.");
  if (!customerCode) throw new HttpsError("invalid-argument", "Informe o cliente.");
  const receiptRef = db.collection("inbound_receipts").doc(receiptId);

  return db.runTransaction(async (transaction) => {
    const receiptSnap = await transaction.get(receiptRef);
    if (!receiptSnap.exists) throw new HttpsError("not-found", "Chegada não encontrada.");
    const receipt = receiptSnap.data() ?? {};
    const receiptProblem = receiptLinkProblem(receipt, customerCode);
    if (receiptProblem) throw new HttpsError("failed-precondition", receiptProblem);
    const current = text(receipt.customer_request_id);

    if (!requestId) {
      if (!current) return { ok: true, receipt_id: receiptId, customer_request_id: null, changed: false };
      transaction.update(receiptRef, {
        customer_request_id: FieldValue.delete(),
        request_number: FieldValue.delete(),
        updated_at: FieldValue.serverTimestamp(),
      });
      return { ok: true, receipt_id: receiptId, customer_request_id: null, changed: true };
    }

    if (requestId.includes("/")) throw new HttpsError("invalid-argument", "Aviso inválido.");
    const requestRef = db.collection("customer_requests").doc(requestId);
    const requestSnap = await transaction.get(requestRef);
    if (!requestSnap.exists) throw new HttpsError("not-found", "Aviso não encontrado.");
    const request = requestSnap.data() ?? {};
    const noticeProblem = shipmentNoticeProblem(request, customerCode);
    if (noticeProblem) throw new HttpsError("failed-precondition", noticeProblem);
    if (current === requestId) {
      return { ok: true, receipt_id: receiptId, customer_request_id: requestId, changed: false };
    }

    const supplier = text(request.supplier);
    const invoice = text(request.invoice_number);
    const number = text(request.request_number);
    transaction.update(receiptRef, {
      customer_request_id: requestId,
      ...(supplier ? { supplier } : {}),
      ...(invoice ? { invoice_number: invoice } : {}),
      ...(number ? { request_number: number } : {}),
      updated_at: FieldValue.serverTimestamp(),
    });
    const eventRef = db.collection("events").doc();
    transaction.create(eventRef, {
      id: eventRef.id,
      type: "inbound.notice_linked",
      title: "Chegada vinculada a um aviso de envio",
      description: [number, supplier, invoice && `NF ${invoice}`].filter(Boolean).join(" · "),
      severity: "info",
      entity_type: "inbound_receipt",
      entity_id: receiptId,
      customer_code: customerCode,
      payload: { customer_request_id: requestId, request_number: number || null },
      occurred_at: new Date().toISOString(),
      source: "functions_inbound_notice",
      actor: {
        uid: actor.uid,
        role: actor.role,
        email: actor.email ?? null,
        name: actor.name ?? null,
      },
      created_at: FieldValue.serverTimestamp(),
    });
    return { ok: true, receipt_id: receiptId, customer_request_id: requestId, changed: true };
  });
}
