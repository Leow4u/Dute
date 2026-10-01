import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";

/**
 * "Envios para a Dutelog" no portal da BTG: o cliente avisa que um
 * fornecedor vai entregar mercadoria no armazém. Aqui ficam o resumo do que
 * chegou de verdade (publicado no portal ao concluir o recebimento) e o
 * cancelamento de um aviso que a Dutelog ainda não confirmou.
 */

function num(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function text(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

export type ReceivedLine = {
  client_item_code?: unknown;
  sku_code?: unknown;
  product_name?: unknown;
  expected_qty?: unknown;
  received_qty?: unknown;
};

export type ReceivedSummary = {
  qty_expected: number;
  qty_received: number;
  received_differences: Array<{ code: string; name: string; expected: number; received: number }>;
};

/**
 * Quanto foi avisado e quanto a conferência contou, com as linhas que
 * divergiram. Sem custo, endereço nem justificativa interna: vai para o
 * portal do cliente.
 */
export function receivedSummary(lines: ReceivedLine[]): ReceivedSummary {
  let expected = 0;
  let received = 0;
  const differences: ReceivedSummary["received_differences"] = [];
  for (const line of lines) {
    const lineExpected = num(line.expected_qty);
    const lineReceived = num(line.received_qty);
    expected += lineExpected;
    received += lineReceived;
    if (lineExpected !== lineReceived && differences.length < 20) {
      differences.push({
        code: text(line.client_item_code) || text(line.sku_code),
        name: text(line.product_name),
        expected: lineExpected,
        received: lineReceived,
      });
    }
  }
  return { qty_expected: expected, qty_received: received, received_differences: differences };
}

export type ShipmentActor = {
  uid: string;
  role: string;
  customer_code?: string;
  email?: string;
  name?: string;
};

const INBOUND = /receb|inbound/i;

export async function cancelShipmentNoticeTransaction(
  db: Firestore,
  input: { request_id: string; reason?: string },
  actor: ShipmentActor,
) {
  if (actor.role !== "cliente") {
    throw new HttpsError("permission-denied", "Só quem avisou o envio pode cancelar o aviso.");
  }
  const id = text(input.request_id);
  if (!id || id.includes("/")) throw new HttpsError("invalid-argument", "Aviso inválido.");
  const requestRef = db.collection("customer_requests").doc(id);
  const statusRef = db.collection("client_request_status").doc(id);

  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(requestRef);
    if (!snapshot.exists) throw new HttpsError("not-found", "Aviso não encontrado.");
    const request = snapshot.data() ?? {};
    if (!actor.customer_code || request.customer_code !== actor.customer_code) {
      throw new HttpsError("permission-denied", "Aviso de outro cliente.");
    }
    if (!INBOUND.test(text(request.type))) {
      throw new HttpsError("failed-precondition", "Só avisos de envio podem ser cancelados aqui.");
    }
    const status = text(request.status);
    if (status === "cancelled") return { ok: true, request_id: id, changed: false };
    if (status !== "open") {
      throw new HttpsError(
        "failed-precondition",
        "A Dutelog já confirmou este aviso. Para mudar, fale com a Dutelog.",
      );
    }

    const now = new Date().toISOString();
    const reason = text(input.reason).slice(0, 500) || undefined;
    const update = {
      status: "cancelled",
      operational_status: "cancelled",
      cancelled_at: now,
      cancelled_by: actor.uid,
      ...(reason ? { cancel_reason: reason } : {}),
      updated_at: FieldValue.serverTimestamp(),
    };
    transaction.update(requestRef, update);
    transaction.set(
      statusRef,
      {
        customer_code: request.customer_code,
        status: "cancelled",
        operational_status: "cancelled",
        cancelled_at: now,
        ...(reason ? { cancel_reason: reason } : {}),
        published_at: FieldValue.serverTimestamp(),
        updated_at: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    const eventRef = db.collection("events").doc();
    transaction.create(eventRef, {
      id: eventRef.id,
      type: "customer_request.cancelled",
      title: "Aviso de envio cancelado pelo cliente",
      description: [text(request.supplier), text(request.invoice_number) && `NF ${text(request.invoice_number)}`, reason]
        .filter(Boolean)
        .join(" · "),
      severity: "info",
      entity_type: "customer_request",
      entity_id: id,
      customer_code: request.customer_code,
      payload: { previous_status: status, reason: reason ?? null },
      occurred_at: now,
      source: "functions_client_shipments",
      actor: {
        uid: actor.uid,
        role: actor.role,
        email: actor.email ?? null,
        name: actor.name ?? null,
        customer_code: actor.customer_code ?? null,
      },
      created_at: FieldValue.serverTimestamp(),
    });
    return { ok: true, request_id: id, changed: true };
  });
}

// ------------------------------------------------------- anexo do aviso

export const SHIPMENT_ATTACHMENT_MAX_BYTES = 8 * 1024 * 1024;

const SIGNATURES: Record<string, (bytes: Buffer) => boolean> = {
  "application/pdf": (bytes) => bytes.subarray(0, 5).toString("latin1") === "%PDF-",
  "image/jpeg": (bytes) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  "image/png": (bytes) => bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  "image/webp": (bytes) =>
    bytes.subarray(0, 4).toString("latin1") === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP",
};

/**
 * O anexo do aviso (nota ou pedido) chega em base64 e o backend grava no
 * Storage. Só PDF ou foto, até 8 MB, e o conteúdo precisa ser mesmo do tipo
 * declarado.
 */
export function decodeShipmentAttachment(input: { content_type: string; data_base64: string }) {
  const contentType = text(input.content_type).toLowerCase();
  const matches = SIGNATURES[contentType];
  if (!matches) throw new HttpsError("invalid-argument", "Anexe a nota ou o pedido em PDF ou foto.");
  const base64 = text(input.data_base64).replace(/^data:[^,]*,/, "");
  if (!base64 || !/^[A-Za-z0-9+/=\s]+$/.test(base64)) {
    throw new HttpsError("invalid-argument", "Arquivo vazio ou corrompido.");
  }
  const buffer = Buffer.from(base64, "base64");
  if (!buffer.length) throw new HttpsError("invalid-argument", "Arquivo vazio ou corrompido.");
  if (buffer.length > SHIPMENT_ATTACHMENT_MAX_BYTES) {
    throw new HttpsError("invalid-argument", "Arquivo grande demais. Use até 8 MB.");
  }
  if (!matches(buffer)) throw new HttpsError("invalid-argument", "O conteúdo do arquivo não confere com o tipo informado.");
  return { contentType, buffer };
}

/**
 * Falha do Storage vira mensagem que diz o que fazer. O 403 de permissão
 * (a conta das Functions sem papel no bucket) aparecia como "Falha interna
 * no servidor" e só se descobria a causa pelo log.
 */
export function storageFailure(error: unknown, action: "gravar" | "ler") {
  const record = (error && typeof error === "object" ? error : {}) as { code?: unknown; message?: unknown };
  const message = typeof record.message === "string" ? record.message : String(error ?? "");
  const forbidden =
    record.code === 403 || /does not have storage\.objects\.(create|get)|permission.*denied|forbidden/i.test(message);
  if (forbidden) {
    return new HttpsError(
      "failed-precondition",
      `O servidor não tem permissão para ${action} arquivos no Storage. Avise o time técnico: a conta das Functions precisa do papel ${
        action === "gravar" ? "roles/storage.objectCreator" : "roles/storage.objectViewer"
      } no bucket.`,
    );
  }
  if (record.code === 404 || /no such object|not found/i.test(message)) {
    return new HttpsError("not-found", "Arquivo não encontrado no Storage. Anexe de novo.");
  }
  return new HttpsError("unavailable", `Não consegui ${action} o arquivo agora. Tente de novo.`);
}
