import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { DocumentReference, Transaction } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";

import {
  OPERACAO_OPERATIONS_COLLECTION,
  actorPayload,
  digest,
  inputHash,
  operationDocId,
  readReceipt,
} from "./operations.js";

function fakeTransaction(document: Record<string, unknown> | null): Transaction {
  return {
    get: async () => ({ exists: document !== null, data: () => document ?? undefined }),
  } as unknown as Transaction;
}

const ref = {} as DocumentReference;

async function rejection(promise: Promise<unknown>): Promise<HttpsError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof HttpsError, `esperava HttpsError, veio ${String(error)}`);
    return error;
  }
  assert.fail("deveria recusar");
}

describe("recibo de idempotência: id e hash", () => {
  it("a coleção é operacao_operations", () => {
    assert.equal(OPERACAO_OPERATIONS_COLLECTION, "operacao_operations");
  });

  it("o digest não depende da ordem das chaves nem de campo indefinido", () => {
    assert.equal(digest({ a: 1, b: { c: 2, d: 3 } }), digest({ b: { d: 3, c: 2 }, a: 1, e: undefined }));
    assert.notEqual(digest({ a: 1 }), digest({ a: 2 }));
    assert.equal(digest({ a: 1 }).length, 32);
    assert.equal(inputHash({ a: 1 }).length, 64);
  });

  it("o id do recibo é determinístico pelo tipo, escopo e chave", () => {
    const id = operationDocId("collaborator_save", { id: "col_aaaaaaaaaaaaaaaa" }, "chave-1");
    assert.match(id, /^op_collaborator_save_[0-9a-f]{32}$/);
    assert.equal(operationDocId("collaborator_save", { id: "col_aaaaaaaaaaaaaaaa" }, " chave-1 "), id);
    assert.notEqual(operationDocId("collaborator_save", { id: "col_bbbbbbbbbbbbbbbb" }, "chave-1"), id);
    assert.notEqual(operationDocId("vehicle_save", { id: "col_aaaaaaaaaaaaaaaa" }, "chave-1"), id);
  });

  it("chave vazia é invalid-argument e tipo fora do formato é erro de programação", () => {
    assert.throws(
      () => operationDocId("collaborator_save", {}, "  "),
      (error: unknown) => error instanceof HttpsError && error.code === "invalid-argument",
    );
    assert.throws(() => operationDocId("Collaborator", {}, "chave"), /Tipo de operação inválido/);
  });
});

describe("recibo de idempotência: leitura na transação", () => {
  it("sem recibo, segue a operação; o mesmo conteúdo devolve o resultado", async () => {
    assert.equal(await readReceipt(fakeTransaction(null), ref, "h1"), undefined);
    assert.deepEqual(await readReceipt(fakeTransaction({ input_hash: "h1", result: { id: "col_a" } }), ref, "h1"), { id: "col_a" });
  });

  it("mesma chave com outro conteúdo é already-exists e recibo sem resultado é failed-precondition", async () => {
    const outra = await rejection(readReceipt(fakeTransaction({ input_hash: "h1", result: { id: "col_a" } }), ref, "h2"));
    assert.equal(outra.code, "already-exists");
    const sem = await rejection(readReceipt(fakeTransaction({ input_hash: "h1" }), ref, "h1"));
    assert.equal(sem.code, "failed-precondition");
  });
});

describe("ator gravado no recibo e no evento", () => {
  it("leva só uid, e-mail, nome e papel, sem campo indefinido", () => {
    assert.deepEqual(actorPayload({ uid: "u1", role: "interno", email: "a@dutelog.com.br", name: undefined }), {
      uid: "u1",
      email: "a@dutelog.com.br",
      role: "interno",
    });
  });
});
