import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { LEGACY_CUSTOMER_CODE } from "./customer-scope.js";
import { assertReceiptTakesBoxes, boxContentWith, type InboundBoxLine } from "./inbound-boxes.js";

/** A caixa do recebimento sem o banco (recebimento com caixas, parte 3). */

const source = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

function line(id: string, qty: number, sku = `UNI-${id}`): InboundBoxLine {
  return { inbound_item_id: id, line_number: Number(id.replace(/\D/g, "")) || 1, sku_code: sku, client_item_code: sku, product_name: sku, size: null, counted_qty: qty };
}

describe("o conteúdo da caixa", () => {
  it("acrescenta no fim, substitui no lugar e tira com zero", () => {
    const first = boxContentWith([], line("i1", 29));
    assert.deepEqual(first.lines.map((item) => item.inbound_item_id), ["i1"]);
    assert.equal(first.previous_qty, 0);
    const second = boxContentWith(first.lines, line("i2", 12));
    assert.deepEqual([second.draft_line_count, second.draft_unit_count], [2, 41]);
    const replaced = boxContentWith(second.lines, line("i1", 31));
    assert.deepEqual(replaced.lines.map((item) => [item.inbound_item_id, item.counted_qty]), [["i1", 31], ["i2", 12]]);
    assert.equal(replaced.previous_qty, 29);
    assert.equal(replaced.draft_unit_count, 43);
    const removed = boxContentWith(replaced.lines, line("i1", 0));
    assert.deepEqual(removed.lines.map((item) => item.inbound_item_id), ["i2"]);
    assert.deepEqual([removed.draft_line_count, removed.draft_unit_count, removed.previous_qty], [1, 12, 31]);
  });

  it("tirar o que não está na caixa e passar de 100 produtos são recusados", () => {
    assert.throws(() => boxContentWith([line("i1", 5)], line("i9", 0)), { code: "not-found", message: "Este produto não está nesta caixa." });
    const full = Array.from({ length: 100 }, (_, index) => line(`i${index + 1}`, 1));
    assert.throws(() => boxContentWith(full, line("i101", 1)), {
      code: "failed-precondition",
      message: "Limite de 100 produtos por caixa. Inicie outra caixa.",
    });
    // A linha que já está na caixa cheia continua editável.
    assert.equal(boxContentWith(full, line("i100", 3)).draft_unit_count, 102);
  });

  it("a soma das unidades fica em três casas", () => {
    assert.equal(boxContentWith([line("i1", 0.1)], line("i2", 0.2)).draft_unit_count, 0.3);
  });
});

describe("a chegada que aceita caixa", () => {
  const porCaixa = { id: "inb_1", receipt_number: "AVL-0D0E620B", customer_code: "Uniformes Alfa", conference_mode: "per_box", status: "created" };

  it("só a chegada por caixa, a conferir ou em conferência, devolvendo o cliente dela", () => {
    assert.equal(assertReceiptTakesBoxes(porCaixa), "Uniformes Alfa");
    assert.equal(assertReceiptTakesBoxes({ ...porCaixa, status: "checking" }, "Uniformes Alfa"), "Uniformes Alfa");
    assert.equal(assertReceiptTakesBoxes(porCaixa, "  "), "Uniformes Alfa");
    for (const receipt of [{ ...porCaixa, conference_mode: "per_line" }, { ...porCaixa, conference_mode: undefined }]) {
      assert.throws(() => assertReceiptTakesBoxes(receipt), {
        code: "failed-precondition",
        message: "A chegada AVL-0D0E620B é conferida por linha: use a conferência da chegada.",
        details: { code: "RECEIPT_CONFERRED_PER_LINE" },
      });
    }
    for (const status of ["received", "completed", "cancelled"]) {
      assert.throws(() => assertReceiptTakesBoxes({ ...porCaixa, status }), {
        code: "failed-precondition",
        message: `A chegada AVL-0D0E620B não está em conferência (${status}): as caixas dela não mudam.`,
        details: { code: "RECEIPT_NOT_OPEN" },
      });
    }
  });

  it("o cliente ativo diferente é recusado; a chegada sem cliente é do cliente legado", () => {
    assert.throws(() => assertReceiptTakesBoxes(porCaixa, "Uniformes Beta"), {
      code: "permission-denied",
      message: "Chegada de outro cliente. Troque o cliente ativo para Uniformes Alfa.",
    });
    assert.equal(assertReceiptTakesBoxes({ ...porCaixa, customer_code: undefined }), LEGACY_CUSTOMER_CODE);
  });
});

describe("as travas de fonte", () => {
  const modulo = source("../../src/domain/inbound-boxes.ts");
  const index = source("../../src/index.ts");

  it("o módulo usa o encaixe estrito: nada da abertura nem da liberação", () => {
    for (const proibido of [/resolveOpeningPlacement/, /openingSessionDocId/, /opening_inventory/, /session_id/, /opening-inventory-conference/, /boxReceivingEnabled/, /RECEBIMENTO_POR_CAIXA/]) {
      assert.doesNotMatch(modulo, proibido);
    }
  });

  it("as callables entram pelo papel do armazém e passam o pedido cru: o cliente vem da chegada", () => {
    const nomes = ["startInboundBox", "saveInboundBoxLine", "setInboundBoxState", "suggestInboundBoxPosition", "refuseInboundBoxPosition", "confirmInboundBoxDestination", "removeInboundBox", "markInboundBoxShortage", "completeInboundBoxReceipt"];
    for (const nome of nomes) {
      assert.match(
        index,
        new RegExp(`export const ${nome} = onCall\\(async \\(request\\) => \\{\\s*const profile = await getProfile\\(request\\);\\s*requireWarehouseWrite\\(profile\\);\\s*return ${nome}For\\(db, request\\.data, profile\\);\\s*\\}\\);`),
        nome,
      );
    }
  });
});
