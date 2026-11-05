import assert from "node:assert/strict";
import { test } from "node:test";
import { parseInboundCancellation } from "./inbound-cancel.js";

const input = {
  receipt_id: "inb_avulso_test", customer_code: "Cliente A", expected_status: "created",
  reason: "mistake", idempotency_key: "cancel-0001",
};

test("cancelamento normaliza texto sem aceitar caminho de documento ou estado após entrada", () => {
  assert.deepEqual(parseInboundCancellation({ ...input, receipt_id: " inb_avulso_test ", note: "  digitado errado  " }), { ...input, note: "digitado errado" });
  for (const patch of [{ receipt_id: "a/b" }, { duplicate_of_receipt_id: "a/b" }, { customer_code: " " }, { expected_status: "received" }, { reason: "unknown" }, { idempotency_key: "" }, { actor: { uid: "outro" } }]) {
    assert.throws(() => parseInboundCancellation({ ...input, ...patch }), { code: "invalid-argument" });
  }
});

test("duplicidade exige chegada original distinta e outros motivos não a vinculam", () => {
  for (const duplicate_of_receipt_id of [undefined, "", input.receipt_id]) {
    assert.throws(() => parseInboundCancellation({ ...input, reason: "duplicate", duplicate_of_receipt_id }), { code: "invalid-argument" });
  }
  assert.throws(() => parseInboundCancellation({ ...input, duplicate_of_receipt_id: "inb_original" }), { code: "invalid-argument" });
  assert.equal(parseInboundCancellation({ ...input, reason: "duplicate", duplicate_of_receipt_id: "inb_original" }).duplicate_of_receipt_id, "inb_original");
});

test("outro motivo exige a explicação, enquanto erro de cadastro aceita nota opcional", () => {
  for (const note of [undefined, "", "   "]) {
    assert.throws(() => parseInboundCancellation({ ...input, reason: "other", note }), { code: "invalid-argument" });
  }
  assert.equal(parseInboundCancellation({ ...input, reason: "other", note: "Fornecedor não entregou." }).note, "Fornecedor não entregou.");
  assert.equal(parseInboundCancellation(input).reason, "mistake");
});

test("a nota respeita o limite de 500 caracteres da confirmação", () => {
  assert.equal(parseInboundCancellation({ ...input, note: "a".repeat(500) }).note?.length, 500);
  assert.throws(() => parseInboundCancellation({ ...input, note: "a".repeat(501) }), { code: "invalid-argument" });
});
