import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { FieldValue, Timestamp, getFirestore, type Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";

import { comercialEventId, createComercialEvent } from "./events.js";
import { COMERCIAL_OPERATIONS_COLLECTION, runIdempotent, type ComercialActor } from "./operations.js";

/**
 * Recibo de idempotência numa transação de verdade: a primeira chamada grava
 * o documento, o evento e o recibo juntos; a repetição devolve o resultado
 * gravado sem escrever de novo; a mesma chave com outro conteúdo é recusada
 * sem escrever nada.
 */

const PROJECT_ID = "demo-dute-comercial";
const CUSTOMER = "BTG Pactual";
const equipe: ComercialActor = { uid: "com-1", role: "comercial", name: "Guilherme", email: "comercial@dutelog.com.br" };

let db: Firestore;
let app: ReturnType<typeof initializeApp>;

before(() => {
  app = initializeApp({ projectId: PROJECT_ID }, "comercial-operations-test");
  db = getFirestore(app);
});

beforeEach(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error("FIRESTORE_EMULATOR_HOST não definido.");
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
});

after(async () => {
  await deleteApp(app);
});

type Input = { numero: string; titulo: string; idempotency_key: string };
type Result = { ok: true; numero: string; edicao: number; events: string[] };

/** Operação de teste: grava um rascunho de demanda, o evento e o recibo. */
function saveDraft(input: Input, calls: { count: number }) {
  return runIdempotent<Result>(
    db,
    {
      kind: "test_draft_save",
      scope: { customer_code: CUSTOMER, numero: input.numero },
      idempotency_key: input.idempotency_key,
      input,
      actor: equipe,
    },
    async (transaction, { operationId }) => {
      calls.count += 1;
      const ref = db.collection("test_drafts").doc(input.numero);
      const current = await transaction.get(ref);
      const edicao = Number(current.get("edicao") ?? 0) + 1;
      transaction.set(ref, { numero: input.numero, titulo: input.titulo, edicao, updated_at: FieldValue.serverTimestamp() });
      const event = createComercialEvent(transaction, db, {
        operation_id: operationId,
        type: "demand.created",
        entity_id: input.numero,
        customer_code: CUSTOMER,
        payload: { numero: input.numero },
        actor: equipe,
      });
      return { target_id: input.numero, result: { ok: true, numero: input.numero, edicao, events: [event.id] } };
    },
  );
}

async function count(collection: string) {
  return (await db.collection(collection).get()).size;
}

describe("recibo de idempotência na transação", () => {
  it("a primeira chamada grava documento, evento e recibo", async () => {
    const calls = { count: 0 };
    const result = await saveDraft({ numero: "10045", titulo: "Mudança CEIC", idempotency_key: "k1" }, calls);
    assert.deepEqual(result, { ok: true, numero: "10045", edicao: 1, events: [result.events[0]] });
    assert.equal(calls.count, 1);
    assert.equal(await count("test_drafts"), 1);
    assert.equal(await count("events"), 1);

    const receipts = await db.collection(COMERCIAL_OPERATIONS_COLLECTION).get();
    assert.equal(receipts.size, 1);
    const receipt = receipts.docs[0].data();
    assert.match(receipts.docs[0].id, /^op_test_draft_save_[0-9a-f]{32}$/);
    assert.equal(receipt.kind, "test_draft_save");
    assert.equal(receipt.target_id, "10045");
    assert.equal(receipt.status, "completed");
    assert.equal(String(receipt.input_hash).length, 64);
    assert.deepEqual(receipt.result, { ok: true, numero: "10045", edicao: 1, events: result.events });
    assert.deepEqual(receipt.actor, { uid: "com-1", role: "comercial", name: "Guilherme", email: "comercial@dutelog.com.br" });
    assert.ok(receipt.created_at instanceof Timestamp);

    const event = (await db.collection("events").doc(result.events[0]).get()).data() ?? {};
    assert.equal(event.id, comercialEventId(receipts.docs[0].id, "demand.created"));
    assert.equal(event.type, "demand.created");
    assert.equal(event.source, "functions_comercial");
    assert.equal(event.severity, "info");
    assert.equal(event.customer_code, CUSTOMER);
    assert.equal(event.entity_type, "demand");
    assert.equal(event.operation_id, receipts.docs[0].id);
    assert.equal(typeof event.occurred_at, "string");
    assert.ok(event.created_at instanceof Timestamp);
    assert.deepEqual(event.payload, { numero: "10045" });
  });

  it("a repetição devolve o resultado gravado, sem escrever de novo", async () => {
    const calls = { count: 0 };
    const input = { numero: "10045", titulo: "Mudança CEIC", idempotency_key: "k1" };
    const first = await saveDraft(input, calls);
    const second = await saveDraft({ ...input }, calls);
    assert.deepEqual(second, { ...first, replayed: true });
    assert.equal(calls.count, 1, "a operação não pode rodar de novo");
    assert.equal((await db.collection("test_drafts").doc("10045").get()).get("edicao"), 1);
    assert.equal(await count("events"), 1);
    assert.equal(await count(COMERCIAL_OPERATIONS_COLLECTION), 1);
  });

  it("a mesma chave com outro conteúdo é already-exists e não escreve nada", async () => {
    const calls = { count: 0 };
    await saveDraft({ numero: "10045", titulo: "Mudança CEIC", idempotency_key: "k1" }, calls);
    await assert.rejects(
      saveDraft({ numero: "10045", titulo: "Outro título", idempotency_key: "k1" }, calls),
      (error: unknown) => error instanceof HttpsError && error.code === "already-exists",
    );
    assert.equal(calls.count, 1);
    const draft = (await db.collection("test_drafts").doc("10045").get()).data() ?? {};
    assert.equal(draft.titulo, "Mudança CEIC");
    assert.equal(draft.edicao, 1);
    assert.equal(await count("events"), 1);
    assert.equal(await count(COMERCIAL_OPERATIONS_COLLECTION), 1);
  });

  it("chave nova é outra operação", async () => {
    const calls = { count: 0 };
    await saveDraft({ numero: "10045", titulo: "Mudança CEIC", idempotency_key: "k1" }, calls);
    const second = await saveDraft({ numero: "10045", titulo: "Mudança CEIC", idempotency_key: "k2" }, calls);
    assert.equal(second.edicao, 2);
    assert.equal(calls.count, 2);
    assert.equal(await count("events"), 2);
    assert.equal(await count(COMERCIAL_OPERATIONS_COLLECTION), 2);
  });

  it("se a operação falha, nada fica gravado e a mesma chave pode ser usada de novo", async () => {
    await assert.rejects(
      runIdempotent(
        db,
        { kind: "test_draft_save", scope: { numero: "10050" }, idempotency_key: "k9", input: { numero: "10050" }, actor: equipe },
        async (transaction, { operationId }) => {
          transaction.set(db.collection("test_drafts").doc("10050"), { numero: "10050" });
          createComercialEvent(transaction, db, {
            operation_id: operationId,
            type: "demand.created",
            entity_id: "10050",
            customer_code: CUSTOMER,
            payload: { numero: "10050" },
            actor: equipe,
          });
          throw new HttpsError("failed-precondition", "Status divergente.");
        },
      ),
      (error: unknown) => error instanceof HttpsError && error.code === "failed-precondition",
    );
    assert.equal(await count("test_drafts"), 0);
    assert.equal(await count("events"), 0);
    assert.equal(await count(COMERCIAL_OPERATIONS_COLLECTION), 0);

    const calls = { count: 0 };
    const retry = await saveDraft({ numero: "10050", titulo: "Depois", idempotency_key: "k9" }, calls);
    assert.equal(retry.edicao, 1);
  });

  it("evento com payload fora do contrato derruba a transação inteira", async () => {
    await assert.rejects(
      runIdempotent(
        db,
        { kind: "test_draft_save", scope: { numero: "10060" }, idempotency_key: "k1", input: { numero: "10060" }, actor: equipe },
        async (transaction, { operationId }) => {
          transaction.set(db.collection("test_drafts").doc("10060"), { numero: "10060" });
          createComercialEvent(transaction, db, {
            operation_id: operationId,
            type: "demand.created",
            entity_id: "10060",
            customer_code: CUSTOMER,
            payload: { numero: "10060", valor_cents: 150000 } as never,
            actor: equipe,
          });
          return { target_id: "10060", result: { ok: true } };
        },
      ),
      HttpsError,
    );
    assert.equal(await count("test_drafts"), 0);
    assert.equal(await count("events"), 0);
    assert.equal(await count(COMERCIAL_OPERATIONS_COLLECTION), 0);
  });
});
