import { createHash } from "node:crypto";

import { FieldValue, type DocumentReference, type Firestore, type Transaction } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";

/**
 * Recibo de idempotência das operações da Operação, no molde do Comercial
 * (functions/comercial/src/domain/operations.ts). O id é determinístico
 * (tipo, escopo e chave). Repetir a mesma chamada devolve o resultado; a
 * mesma chave com outro conteúdo é already-exists.
 */

export const OPERACAO_OPERATIONS_COLLECTION = "operacao_operations";

export type OperacaoActor = {
  uid: string;
  role: string;
  email?: string;
  name?: string;
};

export type IdempotentOperation = {
  kind: string;
  scope: Record<string, unknown>;
  idempotency_key: string;
  input: unknown;
  actor: OperacaoActor;
};

export type IdempotentWork<R> = { target_id: string; result: R };

const KIND = /^[a-z][a-z0-9_]{0,59}$/;

export function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonical(item)]),
    );
  }
  return value;
}

export function digest(value: unknown, length = 32): string {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex").slice(0, length);
}

export function compactValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(compactValue);
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, compactValue(item)]),
    );
  }
  return value;
}

export function actorPayload(actor: OperacaoActor): Record<string, string> {
  return compactValue({
    uid: actor.uid,
    email: actor.email,
    name: actor.name,
    role: actor.role,
  }) as Record<string, string>;
}

export function inputHash(input: unknown): string {
  return digest(input, 64);
}

export function operationDocId(kind: string, scope: Record<string, unknown>, idempotencyKey: string): string {
  if (!KIND.test(kind)) throw new Error(`Tipo de operação inválido: "${kind}".`);
  const nonce = String(idempotencyKey ?? "").trim();
  if (!nonce) throw new HttpsError("invalid-argument", "Chave de idempotência obrigatória.");
  return `op_${kind}_${digest({ scope, nonce })}`;
}

export async function readReceipt<R>(
  transaction: Transaction,
  ref: DocumentReference,
  hash: string,
): Promise<R | undefined> {
  const snapshot = await transaction.get(ref);
  if (!snapshot.exists) return undefined;
  const data = snapshot.data() ?? {};
  if (data.input_hash !== hash) {
    throw new HttpsError("already-exists", "A chave de idempotência já foi usada com outro conteúdo.");
  }
  if (!data.result || typeof data.result !== "object") {
    throw new HttpsError("failed-precondition", "A operação idempotente existe, mas não tem resultado válido.");
  }
  return data.result as R;
}

export function createReceipt(
  transaction: Transaction,
  ref: DocumentReference,
  receipt: { kind: string; target_id: string; input_hash: string; actor: OperacaoActor; result: unknown },
): void {
  transaction.create(ref, {
    id: ref.id,
    kind: receipt.kind,
    target_id: receipt.target_id,
    input_hash: receipt.input_hash,
    status: "completed",
    actor: actorPayload(receipt.actor),
    result: compactValue(receipt.result),
    created_at: FieldValue.serverTimestamp(),
    completed_at: FieldValue.serverTimestamp(),
  });
}

export async function runIdempotent<R extends Record<string, unknown>>(
  db: Firestore,
  operation: IdempotentOperation,
  work: (transaction: Transaction, context: { operationId: string }) => Promise<IdempotentWork<R>>,
): Promise<R & { replayed?: true }> {
  const operationId = operationDocId(operation.kind, operation.scope, operation.idempotency_key);
  const hash = inputHash(operation.input);
  const ref = db.collection(OPERACAO_OPERATIONS_COLLECTION).doc(operationId);

  return db.runTransaction(async (transaction) => {
    const replay = await readReceipt<R>(transaction, ref, hash);
    if (replay) return { ...replay, replayed: true as const };

    const { target_id, result } = await work(transaction, { operationId });
    const stored = compactValue(result) as R;
    createReceipt(transaction, ref, {
      kind: operation.kind,
      target_id,
      input_hash: hash,
      actor: operation.actor,
      result: stored,
    });
    return stored;
  });
}
