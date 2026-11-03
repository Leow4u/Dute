import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { TEMPLATES_WITH_BOX_RECEIVING } from "./customer-profile.js";
import {
  INBOUND_CONFERENCE_MODES,
  RECEBIMENTO_POR_CAIXA_PROJECTS,
  assertLineConference,
  assertLinePutaway,
  boxReceiptLineLocation,
  putawayQuantityWithinTask,
  boxReceivingEnabled,
  conferenceModeOf,
  requestedConferenceMode,
} from "./inbound-mode.js";

/** O modo da chegada e a liberação do recebimento por caixa (recebimento com caixas, parte 2), sem o banco. */

const index = readFileSync(fileURLToPath(new URL("../../src/index.ts", import.meta.url)), "utf8");

describe("o modo da chegada", () => {
  it("por linha ou por caixa; a chegada sem o campo é por linha", () => {
    assert.deepEqual([...INBOUND_CONFERENCE_MODES], ["per_line", "per_box"]);
    assert.equal(conferenceModeOf({ conference_mode: "per_box" }), "per_box");
    assert.equal(conferenceModeOf({ conference_mode: "per_line" }), "per_line");
    for (const value of [undefined, null, "", "box", "PER_BOX", 1]) {
      assert.equal(conferenceModeOf({ conference_mode: value }), "per_line", String(value));
    }
    assert.equal(conferenceModeOf({}), "per_line");
    assert.equal(conferenceModeOf(undefined), "per_line");
  });

  it("a chegada nova sem modo é por linha; modo fora da lista é recusado", () => {
    for (const value of [undefined, null, "", "  "]) assert.equal(requestedConferenceMode(value), "per_line", String(value));
    assert.equal(requestedConferenceMode("per_box"), "per_box");
    assert.equal(requestedConferenceMode(" per_line "), "per_line");
    for (const value of ["box", "PER_BOX", "caixa", 1]) {
      assert.throws(() => requestedConferenceMode(value), { code: "invalid-argument" }, String(value));
    }
  });

  it("só o modelo de uniformes confere a chegada por caixa (decisão 1)", () => {
    assert.deepEqual([...TEMPLATES_WITH_BOX_RECEIVING], ["uniformes"]);
  });

  it("a conferência e a entrada por linha recusam a chegada por caixa, pelo modo gravado", () => {
    const porCaixa = { id: "inb_1", receipt_number: "AVL-0D0E620B", conference_mode: "per_box" };
    assert.throws(() => assertLineConference(porCaixa, "conferir"), {
      code: "failed-precondition",
      message: "A chegada AVL-0D0E620B é conferida por caixa: a quantidade de cada linha vem das caixas.",
    });
    assert.throws(() => assertLineConference(porCaixa, "concluir"), {
      code: "failed-precondition",
      message: "A chegada AVL-0D0E620B é conferida por caixa: a entrada é concluída pelas caixas, na ficha da chegada.",
    });
    for (const receipt of [{ conference_mode: "per_line" }, { receipt_number: "AVL-1" }, {}]) {
      assert.doesNotThrow(() => assertLineConference(receipt, "conferir"));
      assert.doesNotThrow(() => assertLineConference(receipt, "concluir"));
    }
  });
});

describe("as linhas da chegada por caixa (parte 4a)", () => {
  it("toda linha passa pela área de recebimento, gravada como RECEBIMENTO", () => {
    for (const local of ["RECEBIMENTO", "recebimento", " Recebimento ", "", undefined]) {
      assert.equal(boxReceiptLineLocation("per_box", 1, local), "RECEBIMENTO", String(local));
    }
  });

  it("a linha que vai direto para outro local é recusada, com o número e o local", () => {
    for (const [local, mostrado] of [["A-02", "A-02"], ["a-02", "A-02"], ["EXPEDICAO", "EXPEDICAO"], ["DEVOLUCAO", "DEVOLUCAO"]]) {
      assert.throws(() => boxReceiptLineLocation("per_box", 3, local), {
        code: "failed-precondition",
        message: `A linha 3 vai direto para ${mostrado}: na chegada por caixa, toda linha passa pela área de recebimento.`,
        details: { code: "BOX_RECEIPT_LINE_OUTSIDE_RECEIVING" },
      }, local);
    }
  });

  it("a chegada por linha guarda o local como veio", () => {
    assert.equal(boxReceiptLineLocation("per_line", 1, "A-02"), "A-02");
    assert.equal(boxReceiptLineLocation("per_line", 1, "recebimento"), "recebimento");
  });
});

describe("a guarda genérica (parte 4b)", () => {
  it("a tarefa de guarda da caixa não anda pela guarda por linha", () => {
    assert.throws(() => assertLinePutaway({ id: "put_cx", box_code: "CX-000132" }), {
      code: "failed-precondition",
      message: "A guarda da caixa CX-000132 é feita pela guarda da caixa: a prateleira e o conteúdo vêm dela.",
      details: { code: "PUTAWAY_IS_BY_BOX" },
    });
    for (const task of [{ id: "put_1" }, { id: "put_2", box_code: "" }, { id: "put_3", box_code: null }]) {
      assert.doesNotThrow(() => assertLinePutaway(task));
    }
  });

  it("a guarda por linha move no máximo a quantidade da tarefa (decisão 23)", () => {
    assert.throws(() => putawayQuantityWithinTask({ quantity: 4, sku_code: "UNI-000001" }, 5), {
      code: "failed-precondition",
      message: "A tarefa guarda no máximo 4 un. de UNI-000001.",
      details: { code: "PUTAWAY_ABOVE_TASK", limit: 4 },
    });
    assert.doesNotThrow(() => putawayQuantityWithinTask({ quantity: 4, sku_code: "UNI-000001" }, 4));
    assert.doesNotThrow(() => putawayQuantityWithinTask({ quantity: 4, sku_code: "UNI-000001" }, 3));
    assert.doesNotThrow(() => putawayQuantityWithinTask({ total_units: 6, sku_code: "UNI-000001" }, 6));
    assert.throws(() => putawayQuantityWithinTask({ total_units: 6, sku_code: "UNI-000001" }, 7), { code: "failed-precondition" });
    // A tarefa sem quantidade gravada não tem teto.
    assert.doesNotThrow(() => putawayQuantityWithinTask({ sku_code: "UNI-000001" }, 9));
  });
});

describe("a liberação do recebimento por caixa", () => {
  it("a homologação e a produção (OK do Leonardo em 03/11/2026); o dute-btg fica de fora", () => {
    assert.deepEqual(RECEBIMENTO_POR_CAIXA_PROJECTS, ["dute-homolog", "dute-prod"]);
    assert.equal(boxReceivingEnabled("dute-homolog"), true);
    assert.equal(boxReceivingEnabled("dute-prod"), true);
    for (const project of ["dute-btg", "demo-dute-operations", "", undefined]) {
      assert.equal(boxReceivingEnabled(project), false, String(project));
    }
  });

  it("a callable da chegada passa a liberação do ambiente ao domínio", () => {
    assert.match(
      index,
      /export const createInboundReceipt = onCall\(async \(request\) => \{(?:(?!export const)[\s\S])*?createInboundReceiptTransaction\(\s*db,\s*\{ \.\.\.input, customer_code \},\s*profile,\s*\{ boxReceivingEnabled: boxReceivingEnabled\(PROJECT_ID\) \},?\s*\);\s*\}\);/,
    );
  });

  it("as outras portas criam por linha: o Documentos não passa a liberação nem o modo", () => {
    const calls = [...index.matchAll(/createInboundReceiptTransaction\(/g)];
    assert.equal(calls.length, 2, "a callable da tela e a ação create_receiving do Documentos");
    const documentos = index.match(/const receipt = await createInboundReceiptTransaction\(([\s\S]*?)\n {4}\);/);
    assert.ok(documentos, "a chamada do Documentos");
    assert.match(documentos[1], /idempotency_key: `document_receiving_\$\{documentId\}_\$\{operationNonce\}`,\s*items,\s*\},\s*profile,$/);
    assert.doesNotMatch(documentos[1], /boxReceivingEnabled|conference_mode/);
  });
});
