import { FieldValue, type DocumentReference, type Firestore, type Transaction } from "firebase-admin/firestore";

/**
 * Número que as pessoas leem: PED-0043 para pedido do estoque, ENV-0012 para
 * aviso de envio. Sequencial por cliente e por tipo, gerado no backend na
 * mesma transação que cria a solicitação. O id interno (creq_…) continua
 * sendo a chave; o número é só o nome.
 */

export const REQUEST_COUNTERS = "request_counters";

export type RequestNumberPrefix = "PED" | "ENV" | "SOL";

function text(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

export function requestNumberPrefix(type: unknown): RequestNumberPrefix {
  const normalized = text(type).toLowerCase();
  if (normalized.includes("retirada") || normalized.includes("ajuste")) return "PED";
  if (normalized.includes("receb") || normalized.includes("inbound")) return "ENV";
  return "SOL";
}

export function formatRequestNumber(prefix: RequestNumberPrefix, sequence: number) {
  return `${prefix}-${String(Math.max(1, Math.trunc(sequence))).padStart(4, "0")}`;
}

export function requestCounterRef(db: Firestore, customerCode: string, prefix: RequestNumberPrefix) {
  return db.collection(REQUEST_COUNTERS).doc(`${customerCode.replace(/[^\w.-]/g, "_")}_${prefix}`);
}

/** Lê o contador (leitura da transação); a escrita fica com commitRequestNumber. */
export async function reserveRequestNumber(
  transaction: Transaction,
  db: Firestore,
  customerCode: string,
  prefix: RequestNumberPrefix,
) {
  const ref = requestCounterRef(db, customerCode, prefix);
  const snapshot = await transaction.get(ref);
  const last = Number(snapshot.data()?.last ?? 0);
  const sequence = (Number.isFinite(last) ? last : 0) + 1;
  return { ref, sequence, number: formatRequestNumber(prefix, sequence) };
}

export function commitRequestNumber(
  transaction: Transaction,
  reserved: { ref: DocumentReference; sequence: number },
  customerCode: string,
  prefix: RequestNumberPrefix,
) {
  transaction.set(
    reserved.ref,
    { customer_code: customerCode, prefix, last: reserved.sequence, updated_at: FieldValue.serverTimestamp() },
    { merge: true },
  );
}

/** O que o portal mostra de cada item: sem custo, local ou dado interno. */
export function portalRequestItems(items: unknown[]) {
  return items.slice(0, 300).map((value, index) => {
    const item = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
    const entry: Record<string, unknown> = {
      line_number: Number(item.line_number) || index + 1,
      product_name: text(item.product_name) || text(item.client_item_code) || text(item.sku_code) || "Item",
      quantity: Number(item.quantity) || 0,
    };
    const code = text(item.client_item_code) || text(item.sku_code);
    if (code) entry.client_item_code = code;
    if (text(item.product_registration) === "unknown") entry.code_pending = true;
    return entry;
  });
}

// ------------------------------------------------------- pedidos antigos

type Row = { ref: DocumentReference; data: Record<string, unknown> };

function createdMillis(data: Record<string, unknown>) {
  const value = data.created_at as { toMillis?: () => number } | string | undefined;
  if (value && typeof value === "object" && typeof value.toMillis === "function") return value.toMillis();
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Solicitações criadas antes do número sequencial ganham número na ordem em
 * que foram criadas, continuando o contador de cada cliente. Idempotente:
 * quem já tem número fica como está. O portal recebe também a lista de itens.
 */
export async function assignMissingRequestNumbers(db: Firestore, options: { dryRun: boolean }) {
  const snapshot = await db.collection("customer_requests").get();
  const pending: Row[] = snapshot.docs
    .map((doc) => ({ ref: doc.ref, data: doc.data() as Record<string, unknown> }))
    .filter((row) => !text(row.data.request_number))
    .sort((a, b) => createdMillis(a.data) - createdMillis(b.data) || a.ref.id.localeCompare(b.ref.id));
  const assigned: Array<{ id: string; request_number: string }> = [];
  const CHUNK = 150;
  for (let start = 0; start < pending.length; start += CHUNK) {
    const chunk = pending.slice(start, start + CHUNK);
    const result = await db.runTransaction(async (transaction) => {
      const counters = new Map<string, { ref: DocumentReference; last: number; customer: string; prefix: RequestNumberPrefix }>();
      const fresh = await Promise.all(chunk.map((row) => transaction.get(row.ref)));
      for (const row of chunk) {
        const customer = text(row.data.customer_code) || "BTG Pactual";
        const prefix = requestNumberPrefix(row.data.type);
        const key = `${customer}|${prefix}`;
        if (!counters.has(key)) {
          const ref = requestCounterRef(db, customer, prefix);
          const counter = await transaction.get(ref);
          counters.set(key, { ref, last: Number(counter.data()?.last ?? 0) || 0, customer, prefix });
        }
      }
      const out: Array<{ id: string; request_number: string }> = [];
      chunk.forEach((row, index) => {
        const current = fresh[index]?.data() ?? {};
        if (text(current.request_number)) return;
        const customer = text(current.customer_code) || "BTG Pactual";
        const prefix = requestNumberPrefix(current.type);
        const counter = counters.get(`${customer}|${prefix}`)!;
        counter.last += 1;
        const number = formatRequestNumber(prefix, counter.last);
        out.push({ id: row.ref.id, request_number: number });
        if (options.dryRun) return;
        transaction.update(row.ref, { request_number: number, updated_at: FieldValue.serverTimestamp() });
        transaction.set(
          db.collection("client_request_status").doc(row.ref.id),
          {
            request_number: number,
            items: portalRequestItems(Array.isArray(current.items) ? current.items : []),
          },
          { merge: true },
        );
      });
      if (!options.dryRun) {
        for (const counter of counters.values()) {
          transaction.set(
            counter.ref,
            { customer_code: counter.customer, prefix: counter.prefix, last: counter.last, updated_at: FieldValue.serverTimestamp() },
            { merge: true },
          );
        }
      }
      return out;
    });
    assigned.push(...result);
  }
  return { dry_run: options.dryRun, assigned_count: assigned.length, assigned };
}
