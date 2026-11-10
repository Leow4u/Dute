import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HttpsError } from "firebase-functions/https";

import { linhasParaConcluir, progressoDaSeparacao, type LinhaDoProgresso } from "./pick-progress.js";

/**
 * Separar com o progresso salvo (separação com caixas, parte 2a): a regra sem
 * banco. O progresso do pedido e as linhas que a conclusão manda conferir.
 */

const POLO: LinhaDoProgresso = { id: "pli_1", produto: "Polo Masculino Piquet Preto", pedido: 60, separado: 60 };
const CALCA: LinhaDoProgresso = { id: "pli_2", produto: "Calça Social Masculino Preta", pedido: 40, separado: null };
const COPO: LinhaDoProgresso = { id: "pli_3", produto: "Copo Café", pedido: 1, separado: null };

function recusa(acao: () => unknown): HttpsError {
  try {
    acao();
  } catch (error) {
    assert.ok(error instanceof HttpsError);
    return error;
  }
  throw new assert.AssertionError({ message: "Deveria ter recusado." });
}

describe("o progresso da separação", () => {
  it("conta as linhas e as unidades separadas do pedido", () => {
    assert.deepEqual(progressoDaSeparacao([POLO, CALCA, COPO]), { lines: 3, separated_lines: 1, units: 101, separated_units: 60 });
    assert.deepEqual(progressoDaSeparacao([]), { lines: 0, separated_lines: 0, units: 0, separated_units: 0 });
  });
});

describe("as linhas para concluir a separação", () => {
  it("com todas separadas, cada linha vai conferida no que foi separado", () => {
    assert.deepEqual(linhasParaConcluir([POLO, { ...CALCA, separado: 40 }]), [
      { pick_line_id: "pli_1", qty_picked: 60, status: "confirmed" },
      { pick_line_id: "pli_2", qty_picked: 40, status: "confirmed" },
    ]);
  });

  it("a linha que ninguém separou barra a conclusão, com o nome quando é uma só", () => {
    const uma = recusa(() => linhasParaConcluir([POLO, CALCA]));
    assert.equal(uma.code, "failed-precondition");
    assert.equal(uma.message, "Falta separar 1 item: Calça Social Masculino Preta.");
    const duas = recusa(() => linhasParaConcluir([POLO, CALCA, COPO]));
    assert.equal(duas.message, "Faltam 2 itens por separar.");
    assert.deepEqual(duas.details, { code: "SEPARATION_PENDING_LINES", pending: 2 });
  });

  it("a linha que a coordenação informou a menos vai com o motivo, mesmo sem ter sido separada", () => {
    assert.deepEqual(
      linhasParaConcluir(
        [POLO, CALCA, COPO],
        [
          { pick_line_id: "pli_2", qty_picked: 38, shortage_reason: "falta", shortage_detail: "A-05 tinha 38" },
          { pick_line_id: "pli_3", qty_picked: 0, shortage_reason: "avaria" },
        ],
      ),
      [
        { pick_line_id: "pli_1", qty_picked: 60, status: "confirmed" },
        { pick_line_id: "pli_2", qty_picked: 38, status: "confirmed", shortage_reason: "falta", shortage_detail: "A-05 tinha 38" },
        { pick_line_id: "pli_3", qty_picked: 0, status: "confirmed", shortage_reason: "avaria" },
      ],
    );
  });

  it("o informado a menos vale mais que o separado da linha", () => {
    assert.deepEqual(linhasParaConcluir([POLO], [{ pick_line_id: "pli_1", qty_picked: 58, shortage_reason: "falta" }]), [
      { pick_line_id: "pli_1", qty_picked: 58, status: "confirmed", shortage_reason: "falta" },
    ]);
  });

  it("a linha de outro pedido é recusada", () => {
    const erro = recusa(() => linhasParaConcluir([POLO], [{ pick_line_id: "pli_9", qty_picked: 1, shortage_reason: "falta" }]));
    assert.equal(erro.code, "invalid-argument");
    assert.equal(erro.message, "A linha pli_9 não é deste pedido.");
  });
});
