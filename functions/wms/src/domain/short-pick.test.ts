import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { conferirSeparacao, type ConferenciaDaLinha } from "./short-pick.js";

const LINHAS = [
  { id: "pli_1", produto: "Camiseta polo G", pedido: 20 },
  { id: "pli_2", produto: "Boné", pedido: 10 },
];

function conferencias(entradas: Record<string, ConferenciaDaLinha>) {
  return new Map(Object.entries(entradas));
}

describe("o separado de cada linha (pergunta 59)", () => {
  it("o separado completo segue sem motivo, para quem opera e para a coordenação", () => {
    const completas = conferencias({ pli_1: { qty_picked: 20, status: "confirmed" }, pli_2: { qty_picked: 10 } });
    for (const papel of ["wms", "interno"]) {
      assert.deepEqual(conferirSeparacao(LINHAS, completas, papel), [
        { id: "pli_1", pedido: 20, separado: 20, diferenca: 0 },
        { id: "pli_2", pedido: 10, separado: 10, diferenca: 0 },
      ]);
    }
  });

  it("a coordenação separa a menos com o motivo e o detalhe, sem espaço sobrando", () => {
    const linhas = conferirSeparacao(
      LINHAS,
      conferencias({
        pli_1: { qty_picked: 18, shortage_reason: "Falta", shortage_detail: "  A posição   A-04-1 tinha 18 " },
        pli_2: { qty_picked: 0, shortage_reason: "avaria" },
      }),
      "interno",
    );
    assert.deepEqual(linhas, [
      { id: "pli_1", pedido: 20, separado: 18, diferenca: 2, motivo: "falta", detalhe: "A posição A-04-1 tinha 18" },
      { id: "pli_2", pedido: 10, separado: 0, diferenca: 10, motivo: "avaria", detalhe: undefined },
    ]);
    for (const papel of ["owner", "admin"]) {
      assert.equal(conferirSeparacao(LINHAS, conferencias({ pli_1: { qty_picked: 19, shortage_reason: "falta" }, pli_2: { qty_picked: 10 } }), papel)[0]?.diferenca, 1);
    }
  });

  it("quem opera o armazém não separa a menos: registra a falta pelo Tratar", () => {
    assert.throws(
      () => conferirSeparacao(LINHAS, conferencias({ pli_1: { qty_picked: 18, shortage_reason: "falta" }, pli_2: { qty_picked: 10 } }), "wms"),
      { code: "permission-denied", message: "Só a coordenação separa a menos. Registre a falta pelo Tratar." },
    );
  });

  it("recusa a linha a menos sem motivo, com motivo de fora ou com o detalhe longo", () => {
    const recusa = (pli_1: ConferenciaDaLinha, message: string) =>
      assert.throws(() => conferirSeparacao(LINHAS, conferencias({ pli_1, pli_2: { qty_picked: 10 } }), "interno"), {
        code: "invalid-argument",
        message,
      });
    recusa({ qty_picked: 18 }, "Informe o motivo da diferença em Camiseta polo G.");
    recusa({ qty_picked: 18, shortage_reason: "perdido" }, "Informe o motivo da diferença em Camiseta polo G.");
    recusa({ qty_picked: 18, shortage_reason: "falta", shortage_detail: "x".repeat(301) }, "Use até 300 caracteres no detalhe.");
  });

  it("recusa o separado a mais, negativo ou que não é número, a linha sem conferência e a que não está OK", () => {
    const base = { pli_2: { qty_picked: 10 } };
    assert.throws(() => conferirSeparacao(LINHAS, conferencias({ ...base, pli_1: { qty_picked: 21 } }), "interno"), {
      code: "failed-precondition",
      message: "Linha pli_1 tem 21 unidade(s) físicas, mas esperava 20. Registre exceção antes de concluir.",
    });
    for (const qty_picked of [-1, "dez", undefined, Number.POSITIVE_INFINITY]) {
      assert.throws(() => conferirSeparacao(LINHAS, conferencias({ ...base, pli_1: { qty_picked } }), "interno"), {
        code: "invalid-argument",
        message: "Quantidade física de pli_1 inválida.",
      });
    }
    assert.throws(() => conferirSeparacao(LINHAS, conferencias(base), "interno"), {
      code: "failed-precondition",
      message: "Linha pli_1 não foi conferida fisicamente.",
    });
    assert.throws(() => conferirSeparacao(LINHAS, conferencias({ ...base, pli_1: { qty_picked: 20, status: "shortage" } }), "interno"), {
      code: "failed-precondition",
      message: "Linha pli_1 não está OK para concluir o picking.",
    });
  });

  it("sem nada separado o pedido não segue: para desistir dele, é Cancelar pedido", () => {
    assert.throws(
      () =>
        conferirSeparacao(
          LINHAS,
          conferencias({ pli_1: { qty_picked: 0, shortage_reason: "falta" }, pli_2: { qty_picked: 0, shortage_reason: "falta" } }),
          "interno",
        ),
      { code: "failed-precondition", message: "Nada foi separado. Para desistir do pedido, use Cancelar pedido." },
    );
  });
});
