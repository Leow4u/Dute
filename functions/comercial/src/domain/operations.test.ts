import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { DocumentReference, Transaction } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";

import {
  COMERCIAL_OPERATIONS_COLLECTION,
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
  it("a coleção é comercial_operations", () => {
    assert.equal(COMERCIAL_OPERATIONS_COLLECTION, "comercial_operations");
  });

  it("o digest não depende da ordem das chaves nem de campo indefinido", () => {
    assert.equal(digest({ a: 1, b: { c: 2, d: 3 } }), digest({ b: { d: 3, c: 2 }, a: 1, e: undefined }));
    assert.notEqual(digest({ a: 1 }), digest({ a: 2 }));
    assert.equal(digest({ a: 1 }).length, 32);
    assert.equal(inputHash({ a: 1 }).length, 64);
  });

  it("o id do recibo é determinístico pelo tipo, escopo e chave", () => {
    const id = operationDocId("quote_save", { numero: "10045" }, "chave-1");
    assert.match(id, /^op_quote_save_[0-9a-f]{32}$/);
    assert.equal(operationDocId("quote_save", { numero: "10045" }, " chave-1 "), id);
    assert.notEqual(operationDocId("quote_save", { numero: "10046" }, "chave-1"), id);
    assert.notEqual(operationDocId("quote_save", { numero: "10045" }, "chave-2"), id);
    assert.notEqual(operationDocId("quote_send", { numero: "10045" }, "chave-1"), id);
  });

  it("chave vazia é invalid-argument", () => {
    for (const key of ["", "   "]) {
      assert.throws(
        () => operationDocId("quote_save", {}, key),
        (error: unknown) => error instanceof HttpsError && error.code === "invalid-argument",
      );
    }
  });

  it("tipo de operação fora do formato é erro de programação", () => {
    for (const kind of ["", "Quote", "quote save", "quote/save", "1quote"]) {
      assert.throws(() => operationDocId(kind, {}, "chave"), /Tipo de operação inválido/, kind);
    }
  });
});

describe("recibo de idempotência: leitura na transação", () => {
  it("sem recibo, segue a operação", async () => {
    assert.equal(await readReceipt(fakeTransaction(null), ref, "h1"), undefined);
  });

  it("mesmo conteúdo devolve o resultado gravado", async () => {
    const result = { ok: true, numero: "10045" };
    assert.deepEqual(await readReceipt(fakeTransaction({ input_hash: "h1", result }), ref, "h1"), result);
  });

  it("mesma chave com outro conteúdo é already-exists", async () => {
    const error = await rejection(readReceipt(fakeTransaction({ input_hash: "h1", result: { ok: true } }), ref, "h2"));
    assert.equal(error.code, "already-exists");
  });

  it("recibo sem resultado é failed-precondition", async () => {
    const error = await rejection(readReceipt(fakeTransaction({ input_hash: "h1" }), ref, "h1"));
    assert.equal(error.code, "failed-precondition");
  });
});

describe("ator gravado no recibo e no evento", () => {
  it("leva só uid, e-mail, nome, papel e cliente, sem campo indefinido", () => {
    assert.deepEqual(actorPayload({ uid: "u1", role: "comercial", email: "g@dutelog.com.br", name: undefined }), {
      uid: "u1",
      email: "g@dutelog.com.br",
      role: "comercial",
    });
  });
});
