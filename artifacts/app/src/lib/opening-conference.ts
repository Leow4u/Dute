import type { AnyRecord } from "@/lib/warehouse-ops/model";
import type { WarehouseBox } from "@/lib/warehouse-boxes";

export type OpeningConferenceLine = {
  id: string;
  status: "pending" | "processing" | "committed" | "failed";
  sku_code?: string;
  client_item_code?: string;
  product_name?: string;
  product_registration?: string;
  category?: string;
  genero?: string;
  grupo?: string;
  barcode?: string;
  brand?: string;
  size?: string;
  color?: string;
  photo_urls?: string[];
  photo_storage_paths?: string[];
  counted_qty: number;
  unit_cost: number;
  reference?: string;
  error?: string;
};

export type OpeningConferenceResult = {
  ok?: boolean;
  box: AnyRecord;
  lines?: OpeningConferenceLine[];
  line?: OpeningConferenceLine;
};

export function conferenceStatusLabel(box: Pick<WarehouseBox, "status" | "opening_closed">) {
  switch (box.status) {
    case "counting": return "Em conferência";
    case "reviewed": return "Conferida · falta guardar";
    case "committing": return "Guarda em andamento";
    case "stored": return box.opening_closed ? "Guardada · fechada" : "Guardada";
    default: return box.status;
  }
}

export function isConferencePending(box: Pick<WarehouseBox, "status">) {
  return ["counting", "reviewed", "committing"].includes(box.status);
}

export function conferenceCanEditLine(box: Pick<WarehouseBox, "status">, line: OpeningConferenceLine) {
  return (box.status === "counting" || box.status === "committing") &&
    (line.status === "pending" || line.status === "failed");
}

export function conferenceSkus(lines: OpeningConferenceLine[], products: Array<{ clientCode: string; skuCode: string }>) {
  const byCode = new Map(products.map((product) => [product.clientCode.trim().toUpperCase(), product.skuCode]));
  return [...new Set(lines.map((line) => line.sku_code ||
    byCode.get((line.client_item_code ?? "").trim().toUpperCase())).filter((sku): sku is string => Boolean(sku)))];
}

export type MutationAttempt = { fingerprint: string; key: string; payload: Record<string, unknown> };
/** A network retry keeps its operation key even after a refetch advances the revision. */
export function conferenceAttempt(
  previous: MutationAttempt | undefined,
  operation: string,
  payload: Record<string, unknown>,
  newKey: () => string,
): MutationAttempt {
  const identity = { ...payload };
  delete identity.expected_revision;
  delete identity.occurred_at;
  const fingerprint = JSON.stringify({ operation, ...identity });
  return previous?.fingerprint === fingerprint ? previous : {
    fingerprint, key: newKey(), payload: JSON.parse(JSON.stringify(payload)) as Record<string, unknown>,
  };
}

/** Only the server's explicit revision rejection is safe to start as a new attempt. */
export function isConferenceRevisionConflict(message: string) {
  return message.includes("A caixa mudou em outra tela. Atualize antes de continuar.");
}
