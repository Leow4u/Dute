import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HttpsError } from "firebase-functions/https";

import { linhasParaConcluir, progressoDaSeparacao, separadoDaLinha, type LinhaDoProgresso } from "./pick-progress.js";

/**
 * Separar com o progresso salvo (separação com caixas, partes 2a e 5): a
 * regra sem banco. O progresso do pedido, o separado de uma linha e as
 * linhas que a conclusão manda conferir.
 */

const POLO: LinhaDoProgresso = { id: "pli_1", produto: "Polo Masculino Piquet Preto", pedido: 60, separado: 60 };
const CALCA: LinhaDoProgresso = { id: "pli_2", produto: "Calça Social Masculino Preta", pedido: 40, separado: null };
const COPO: LinhaDoProgresso = { id: "pli_3", produto: "Copo Café", pedido: 2, separado: null };
const CALCA_A_MENOS: LinhaDoProgresso = { ...CALCA, separado: 38, motivo: "falta", detalhe: "A-05 tinha 38" };
const COPO_ZERADO: LinhaDoProgresso = { ...COPO, separado: 0, motivo: "avaria" };

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
  it("conta as linhas e as unidades separadas do pedido, e as linhas com diferença", () => {
    assert.deepEqual(progressoDaSeparacao([POLO, CALCA, COPO]), { lines: 3, separated_lines: 1, units: 102, separated_units: 60, short_lines: 0 });
    assert.deepEqual(progressoDaSeparacao([POLO, CALCA_A_MENOS, COPO_ZERADO]), { lines: 3, separated_lines: 3, units: 102, separated_units: 98, short_lines: 2 });
    assert.deepEqual(progressoDaSeparacao([]), { lines: 0, separated_lines: 0, units: 0, separated_units: 0, short_lines: 0 });
  });
});

describe("o separado de uma linha (Separar e Separar menos)", () => {
  it("sem quantidade, a linha inteira; a quantidade igual ao pedido não pede motivo", () => {
    assert.deepEqual(separadoDaLinha(60, {}, "Polo"), { separado: 60 });
    assert.deepEqual(separadoDaLinha(60, { separated_qty: 60, shortage_reason: "falta" }, "Polo"), { separado: 60 });
  });

  it("a menos, com o motivo e o detalhe sem espaço sobrando; zero também vale", () => {
    assert.deepEqual(separadoDaLinha(40, { separated_qty: 38, shortage_reason: " Falta ", shortage_detail: "  A-05   tinha 38 " }, "Calça"), {
      separado: 38,
      motivo: "falta",
      detalhe: "A-05 tinha 38",
    });
    assert.deepEqual(separadoDaLinha(2, { separated_qty: 0, shortage_reason: "avaria" }, "Copo"), { separado: 0, motivo: "avaria", detalhe: undefined });
  });

  it("a menos sem motivo, ou com motivo de fora da lista, é recusado", () => {
    assert.equal(recusa(() => separadoDaLinha(40, { separated_qty: 38 }, "Calça Social")).message, "Informe o motivo da diferença em Calça Social.");
    assert.equal(recusa(() => separadoDaLinha(40, { separated_qty: 38, shortage_reason: "sumiu" }, "Calça Social")).code, "invalid-argument");
  });

  it("mais que o pedido, ou quantidade inválida, é recusado", () => {
    const erro = recusa(() => separadoDaLinha(40, { separated_qty: 41 }, "Calça Social"));
    assert.equal(erro.code, "failed-precondition");
    assert.equal(erro.message, "Calça Social: o pedido é de 40 un. e o separado informado é 41.");
    assert.equal(recusa(() => separadoDaLinha(40, { separated_qty: Number.NaN }, "Calça Social")).code, "invalid-argument");
    assert.equal(recusa(() => separadoDaLinha(40, { separated_qty: -1 }, "Calça Social")).code, "invalid-argument");
  });
});

describe("as linhas para concluir a separação", () => {
  it("com todas separadas, cada linha vai conferida no que foi separado, para quem opera e para a coordenação", () => {
    for (const papel of ["wms", "interno"]) {
      assert.deepEqual(linhasParaConcluir([POLO, { ...CALCA, separado: 40 }], papel), [
        { pick_line_id: "pli_1", qty_picked: 60, status: "confirmed" },
        { pick_line_id: "pli_2", qty_picked: 40, status: "confirmed" },
      ]);
    }
  });

  it("cada linha leva o registro lido (`separated_at`), para a transação recusar a que mudou depois", () => {
    const lidas = linhasParaConcluir(
      [
        { ...POLO, separadoEm: "2026-11-12T13:05:00.000Z" },
        { ...CALCA_A_MENOS, separadoEm: "2026-11-13T09:40:00.000Z" },
      ],
      "interno",
    );
    assert.deepEqual(lidas, [
      { pick_line_id: "pli_1", qty_picked: 60, status: "confirmed", separated_at: "2026-11-12T13:05:00.000Z" },
      { pick_line_id: "pli_2", qty_picked: 38, status: "confirmed", shortage_reason: "falta", shortage_detail: "A-05 tinha 38", separated_at: "2026-11-13T09:40:00.000Z" },
    ]);
  });

  it("a linha que ninguém separou barra a conclusão, com o nome quando é uma só", () => {
    const uma = recusa(() => linhasParaConcluir([POLO, CALCA], "interno"));
    assert.equal(uma.code, "failed-precondition");
    assert.equal(uma.message, "Falta separar 1 item: Calça Social Masculino Preta.");
    const duas = recusa(() => linhasParaConcluir([POLO, CALCA, COPO], "wms"));
    assert.equal(duas.message, "Faltam 2 itens por separar.");
    assert.deepEqual(duas.details, { code: "SEPARATION_PENDING_LINES", pending: 2 });
  });

  it("o pedido com diferença só conclui com a coordenação", () => {
    const umaLinha = recusa(() => linhasParaConcluir([POLO, CALCA_A_MENOS], "wms"));
    assert.equal(umaLinha.code, "permission-denied");
    assert.equal(umaLinha.message, "O pedido tem 1 linha com diferença: só a coordenação conclui.");
    const duasLinhas = recusa(() => linhasParaConcluir([POLO, CALCA_A_MENOS, COPO_ZERADO], "wms"));
    assert.equal(duasLinhas.message, "O pedido tem 2 linhas com diferença: só a coordenação conclui.");
    assert.deepEqual(duasLinhas.details, { code: "SEPARATION_SHORT_LINES", short: 2 });
    for (const papel of ["owner", "admin", "interno"]) {
      assert.deepEqual(linhasParaConcluir([POLO, CALCA_A_MENOS, COPO_ZERADO], papel), [
        { pick_line_id: "pli_1", qty_picked: 60, status: "confirmed" },
        { pick_line_id: "pli_2", qty_picked: 38, status: "confirmed", shortage_reason: "falta", shortage_detail: "A-05 tinha 38" },
        { pick_line_id: "pli_3", qty_picked: 0, status: "confirmed", shortage_reason: "avaria" },
      ]);
    }
  });
});
