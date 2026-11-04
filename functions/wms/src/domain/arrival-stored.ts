import { areaDePassagem } from "./areas-de-passagem.js";

type RecordData = Record<string, unknown>;

export type ArrivalLine = RecordData & { id: string };
export type StoredArrivalPayload = {
  notification_model: "estoque_disponivel";
  id: string;
  receipt_id: string;
  receipt_number: string;
  invoice_number?: string;
  items: Array<{ sku_code: string; client_item_code?: string; product_name?: string; size?: string; quantity: number }>;
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function shelf(value: unknown) {
  return Boolean(text(value)) && areaDePassagem(value) === null;
}

/**
 * Prova a guarda pela própria chegada, nunca pelo saldo total do SKU: outra
 * chegada, saída ou descarte pode zerar o RECEBIMENTO. A guarda parcial
 * encerra a tarefa com o que moveu; o restante sem vínculo não autoriza aviso.
 */
export function lineArrivalStored(
  receiptId: string,
  receipt: RecordData,
  lines: readonly ArrivalLine[],
  putaways: readonly RecordData[],
): StoredArrivalPayload | null {
  const customer = text(receipt.customer_code);
  if (!customer || receipt.status !== "received" || receipt.conference_mode === "per_box") return null;
  const items: StoredArrivalPayload["items"] = [];
  for (const line of [...lines].sort((a, b) => Number(a.line_number ?? 0) - Number(b.line_number ?? 0))) {
    const quantity = Number(line.received_qty);
    if (!Number.isFinite(quantity) || quantity < 0) return null;
    if (quantity === 0) continue;
    const sku = text(line.sku_code);
    if (!sku || (text(line.customer_code) && text(line.customer_code) !== customer)) return null;
    if (!shelf(line.location_id)) {
      if (areaDePassagem(line.location_id) !== "RECEBIMENTO") return null;
      const stored = putaways.reduce((sum, task) => {
        if (task.status !== "completed" || text(task.box_code) || task.source !== "wms_receiving" ||
          text(task.receipt_id) !== receiptId || text(task.inbound_item_id) !== line.id ||
          text(task.customer_code) !== customer || text(task.sku_code) !== sku ||
          areaDePassagem(task.source_location_id) !== "RECEBIMENTO" ||
          !shelf(task.destination_location_id || task.location_id)) return sum;
        const moved = Number(task.quantity ?? task.total_units);
        return Number.isFinite(moved) && moved > 0 ? sum + moved : sum;
      }, 0);
      if (!(stored > 0) || quantity - stored > Number.EPSILON * (Math.abs(stored) + quantity) * 8) return null;
    }
    items.push({
      sku_code: sku,
      ...(text(line.client_item_code) ? { client_item_code: text(line.client_item_code) } : {}),
      ...(text(line.product_name) ? { product_name: text(line.product_name) } : {}),
      ...(text(line.size) ? { size: text(line.size) } : {}),
      quantity,
    });
  }
  if (!items.length) return null;
  return {
    notification_model: "estoque_disponivel",
    id: receiptId,
    receipt_id: receiptId,
    receipt_number: text(receipt.receipt_number) || receiptId,
    ...(text(receipt.invoice_number) ? { invoice_number: text(receipt.invoice_number) } : {}),
    items,
  };
}
