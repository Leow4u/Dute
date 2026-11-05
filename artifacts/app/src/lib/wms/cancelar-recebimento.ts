import { httpsCallable } from "firebase/functions";
import { firebaseApp } from "../firebase";
import { functionsDoApp } from "../firebase-functions";
import { mensagemDoErro } from "../operacao/api";
import type { WarehouseTask } from "../warehouse-ops/model";

export type MotivoDoCancelamento = "duplicate" | "mistake" | "other";
export type CancelarRecebimentoInput = {
  receipt_id: string;
  customer_code: string;
  expected_status: "created" | "checking";
  reason: MotivoDoCancelamento;
  note?: string;
  duplicate_of_receipt_id?: string;
  idempotency_key: string;
};
export type CancelarRecebimentoResult = { ok: true; receipt_id: string; status: "cancelled"; already_cancelled?: boolean };

export function idDoRecebimento(task: WarehouseTask): string {
  return task.reference || task.id.replace(/^receiving:/, "");
}

/** A interface só oferece o pré-cancelamento; o servidor valida o estado transacional. */
export function podeCancelarRecebimento(task: WarehouseTask): boolean {
  return task.id.startsWith("receiving:") &&
    (task.source === "wms_unplanned_receipt" || (!task.source && idDoRecebimento(task).startsWith("inb_avulso_"))) &&
    (task.status === "created" || task.status === "checking") &&
    !(task.items ?? []).some((item) => item.status === "received") &&
    !(task.boxes ?? []).some((box) => box.status === "stored");
}

export function opcoesDeRecebimentoOriginal(task: WarehouseTask, receipts: WarehouseTask[], customerCode: string): WarehouseTask[] {
  return receipts.filter((candidate) =>
    candidate.id.startsWith("receiving:") && candidate.customer === customerCode &&
    idDoRecebimento(candidate) !== idDoRecebimento(task) &&
    !["cancelled", "canceled"].includes(candidate.status ?? ""),
  ).sort((left, right) => {
    const sameInvoice = (candidate: WarehouseTask) => Boolean(task.invoice_number && candidate.invoice_number === task.invoice_number);
    return Number(sameInvoice(right)) - Number(sameInvoice(left)) ||
      (left.receipt_number ?? left.id).localeCompare(right.receipt_number ?? right.id);
  });
}

export function montarCancelamento({ task, customerCode, reason, note, originalId, key }: {
  task: WarehouseTask; customerCode: string; reason: MotivoDoCancelamento; note: string; originalId: string; key: string;
}): CancelarRecebimentoInput {
  if (!podeCancelarRecebimento(task)) throw new Error("Este recebimento não pode mais ser cancelado.");
  if (!customerCode || (task.customer && task.customer !== customerCode)) throw new Error("Recebimento de outro cliente.");
  if (reason === "duplicate" && (!originalId || originalId === idDoRecebimento(task))) throw new Error("Selecione o recebimento original.");
  if (reason === "other" && !note.trim()) throw new Error("Informe o motivo na observação.");
  if (note.trim().length > 500) throw new Error("Use até 500 caracteres na observação.");
  return {
    receipt_id: idDoRecebimento(task), customer_code: customerCode,
    expected_status: task.status === "checking" ? "checking" : "created", reason,
    ...(note.trim() ? { note: note.trim() } : {}),
    ...(reason === "duplicate" ? { duplicate_of_receipt_id: originalId } : {}),
    idempotency_key: key,
  };
}

export async function cancelarRecebimento(input: CancelarRecebimentoInput): Promise<CancelarRecebimentoResult> {
  if (!firebaseApp) throw new Error("Firebase não configurado.");
  try {
    return (await httpsCallable<CancelarRecebimentoInput, CancelarRecebimentoResult>(functionsDoApp(firebaseApp), "cancelInboundReceipt")(input)).data;
  } catch (error) {
    throw new Error(mensagemDoErro(error));
  }
}
