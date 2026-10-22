import { randomUUID } from "node:crypto";

import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";

import { createEvent, type OperationalActor } from "./operations.js";

/**
 * O aviso de envio do cliente (customer_requests, tipo recebimento, status
 * open) aparece no Receber antes da aprovação. A operação vincula a chegada
 * avulsa a ele. Quem aprova continua sendo a coordenação; a aprovação usa a
 * chegada vinculada em vez de abrir outro recebimento (domain/operations.ts).
 */

const INBOUND = /receb|inbound/i;
const CLOSED_RECEIPT = new Set(["received", "completed", "cancelled"]);
const UNPLANNED_SOURCE = "wms_unplanned_receipt";

/** Campos que o aviso empresta à chegada enquanto estão vinculados. */
const NOTICE_FIELDS = ["supplier", "invoice_number", "request_number"] as const;

function text(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
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
  // A chegada prevista já nasceu do aviso aprovado; só a avulsa recebe vínculo.
  if (text(receipt.source) !== UNPLANNED_SOURCE && !text(receipt.id).startsWith("inb_avulso_")) {
    return "Só a chegada avulsa pode ser vinculada a um aviso.";
  }
  if (CLOSED_RECEIPT.has(text(receipt.status).toLowerCase())) return "Esta chegada já foi concluída.";
  return null;
}

/**
 * Fornecedor, NF e número da chegada antes do primeiro vínculo. Trocar de
 * aviso mantém os originais; o desvínculo devolve a chegada a eles.
 */
export function prelinkFields(receipt: Record<string, unknown>): Record<string, unknown> {
  if (text(receipt.customer_request_id) && receipt.notice_prelink !== undefined) {
    return asRecord(receipt.notice_prelink);
  }
  return Object.fromEntries(
    NOTICE_FIELDS.filter((field) => receipt[field] !== undefined).map((field) => [field, receipt[field]]),
  );
}

/**
 * Valor de cada campo na chegada: o do aviso; sem aviso, ou no que ele não
 * informa, o original. Campo que a chegada não tinha sai.
 */
export function noticeFields(
  prelink: Record<string, unknown>,
  notice?: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    NOTICE_FIELDS.map((field) => {
      const fromNotice = notice ? text(notice[field]) : "";
      if (fromNotice) return [field, fromNotice];
      return [field, field in prelink ? prelink[field] : FieldValue.delete()];
    }),
  );
}

export async function linkInboundNoticeTransaction(
  db: Firestore,
  input: { receipt_id: string; request_id?: string | null; customer_code: string },
  actor: OperationalActor,
) {
  const receiptId = receiptDocumentId(text(input.receipt_id));
  const requestId = text(input.request_id);
  const customerCode = text(input.customer_code);
  if (!receiptId || receiptId.includes("/")) throw new HttpsError("invalid-argument", "Chegada inválida.");
  if (requestId.includes("/")) throw new HttpsError("invalid-argument", "Aviso inválido.");
  if (!customerCode) throw new HttpsError("invalid-argument", "Informe o cliente.");
  const receiptRef = db.collection("inbound_receipts").doc(receiptId);

  return db.runTransaction(async (transaction) => {
    const receiptSnap = await transaction.get(receiptRef);
    if (!receiptSnap.exists) throw new HttpsError("not-found", "Chegada não encontrada.");
    const receipt = receiptSnap.data() ?? {};
    const receiptProblem = receiptLinkProblem(receipt, customerCode);
    if (receiptProblem) throw new HttpsError("failed-precondition", receiptProblem);
    const current = text(receipt.customer_request_id);
    if (current === requestId) {
      return { ok: true, receipt_id: receiptId, customer_request_id: requestId || null, changed: false };
    }

    // Todas as leituras antes da primeira escrita.
    const [currentSnap, requestSnap, linkedSnap] = await Promise.all([
      current ? transaction.get(db.collection("customer_requests").doc(current)) : undefined,
      requestId ? transaction.get(db.collection("customer_requests").doc(requestId)) : undefined,
      requestId
        ? transaction.get(db.collection("inbound_receipts").where("customer_request_id", "==", requestId))
        : undefined,
    ]);

    // Aviso aprovado com esta chegada: ela é o recebimento dele e não se solta.
    const currentRequest = currentSnap?.data() ?? {};
    const currentNumber = text(currentRequest.request_number);
    if (text(asRecord(currentRequest.created_entities).inbound_id) === receiptId) {
      throw new HttpsError(
        "failed-precondition",
        `O aviso ${currentNumber || current} já foi aprovado com esta chegada.`,
      );
    }

    let request: Record<string, unknown> | undefined;
    if (requestId) {
      if (!requestSnap?.exists) throw new HttpsError("not-found", "Aviso não encontrado.");
      request = requestSnap.data() ?? {};
      const noticeProblem = shipmentNoticeProblem(request, customerCode);
      if (noticeProblem) throw new HttpsError("failed-precondition", noticeProblem);
      const other = linkedSnap?.docs.find(
        (doc) => doc.id !== receiptId && text(doc.get("status")).toLowerCase() !== "cancelled",
      );
      if (other) {
        throw new HttpsError(
          "failed-precondition",
          `Este aviso já está vinculado à chegada ${text(other.get("receipt_number")) || other.id}.`,
        );
      }
    }

    const prelink = prelinkFields(receipt);
    const fields = noticeFields(prelink, request);
    const receiptNumber = text(receipt.receipt_number) || receiptId;

    if (!requestId) {
      transaction.update(receiptRef, {
        ...fields,
        customer_request_id: FieldValue.delete(),
        notice_prelink: FieldValue.delete(),
        updated_at: FieldValue.serverTimestamp(),
      });
      createEvent(
        transaction,
        db,
        `evt_inbound_notice_unlinked_${receiptId}_${randomUUID().slice(0, 8)}`,
        {
          type: "inbound.notice_unlinked",
          title: "Chegada desvinculada do aviso de envio",
          description: [currentNumber, receiptNumber].filter(Boolean).join(" · "),
          severity: "info",
          entity_type: "recebimento",
          entity_id: receiptId,
          customer_code: customerCode,
          payload: { customer_request_id: current, request_number: currentNumber || null },
          source: "functions_inbound_notice",
        },
        actor,
      );
      return { ok: true, receipt_id: receiptId, customer_request_id: null, changed: true };
    }

    const number = text(request?.request_number);
    const supplier = text(request?.supplier);
    const invoice = text(request?.invoice_number);
    transaction.update(receiptRef, {
      ...fields,
      customer_request_id: requestId,
      notice_prelink: prelink,
      updated_at: FieldValue.serverTimestamp(),
    });
    createEvent(
      transaction,
      db,
      `evt_inbound_notice_linked_${receiptId}_${randomUUID().slice(0, 8)}`,
      {
        type: "inbound.notice_linked",
        title: "Chegada vinculada a um aviso de envio",
        description: [number, supplier, invoice && `NF ${invoice}`].filter(Boolean).join(" · "),
        severity: "info",
        entity_type: "recebimento",
        entity_id: receiptId,
        customer_code: customerCode,
        payload: {
          customer_request_id: requestId,
          request_number: number || null,
          previous_customer_request_id: current || null,
        },
        source: "functions_inbound_notice",
      },
      actor,
    );
    return { ok: true, receipt_id: receiptId, customer_request_id: requestId, changed: true };
  });
}
