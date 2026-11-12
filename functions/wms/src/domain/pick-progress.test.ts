import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HttpsError } from "firebase-functions/https";

import { entradaDaSeparacao, linhasParaConcluir, progressoDaSeparacao, separadoDaLinha, type LinhaDoProgresso } from "./pick-progress.js";

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

describe("a entrada de Dividir em volumes (parte 7a)", () => {
  const SEPARAR = { pick_task_id: "pick_1", pick_line_id: "pli_1", separated: true, idempotency_key: "dividir-000001" };
  const DIVIDIR = {
    ...SEPARAR,
    split_volumes: [
      { number: 16, qty: 54, weight_kg: 11.6 },
      { number: 17, qty: 41 },
    ],
    open_volume_id: "v16",
    open_volume_units: 35,
    line_separated_at: null,
  };

  /** Os campos que a recusa aponta. */
  function campos(raw: unknown): string[] {
    const erro = recusa(() => entradaDaSeparacao(raw));
    assert.equal(erro.code, "invalid-argument");
    assert.equal(erro.message, "Entrada inválida para a separação.");
    return (erro.details as { issues: string[] }).issues;
  }

  it("as partes com o volume aberto que a tela mostrou passam; sem volume aberto, ele vai como null", () => {
    assert.deepEqual(entradaDaSeparacao(DIVIDIR), DIVIDIR);
    const semAberto = { ...DIVIDIR, open_volume_id: null, open_volume_units: 0 };
    assert.deepEqual(entradaDaSeparacao(semAberto), semAberto);
    // Na linha já separada, a tela manda o `separated_at` que mostrou.
    const naSeparada = { ...DIVIDIR, line_separated_at: "2026-11-11T14:02:00.000Z" };
    assert.deepEqual(entradaDaSeparacao(naSeparada), naSeparada);
    // Separar, desfazer e as outras entradas de antes continuam iguais.
    assert.deepEqual(entradaDaSeparacao(SEPARAR), SEPARAR);
    assert.deepEqual(entradaDaSeparacao({ ...SEPARAR, separated: false }), { ...SEPARAR, separated: false });
  });

  it("vale só para separar, sem Outra caixa, Levar a caixa nem Separar menos", () => {
    assert.deepEqual(campos({ ...DIVIDIR, separated: false }), ["separated"]);
    assert.deepEqual(campos({ ...DIVIDIR, take_boxes: true }), ["take_boxes"]);
    assert.deepEqual(campos({ ...DIVIDIR, take_boxes: false }), ["take_boxes"]);
    assert.deepEqual(campos({ ...DIVIDIR, boxes: [{ box_code: "CX-000218", qty: 54 }] }), ["boxes"]);
    assert.deepEqual(campos({ ...DIVIDIR, separated_qty: 95 }), ["separated_qty"]);
    assert.deepEqual(campos({ ...DIVIDIR, shortage_reason: "falta", shortage_detail: "A-07 tinha 90" }), ["shortage_reason", "shortage_detail"]);
  });

  it("leva o volume aberto e a linha que a tela mostrou, e o último volume, que fica aberto, vai sem peso", () => {
    const { open_volume_id: _id, ...semId } = DIVIDIR;
    assert.deepEqual(campos(semId), ["open_volume_id"]);
    const { open_volume_units: _unidades, ...semUnidades } = DIVIDIR;
    assert.deepEqual(campos(semUnidades), ["open_volume_units"]);
    const { line_separated_at: _linha, ...semLinha } = DIVIDIR;
    assert.deepEqual(campos(semLinha), ["line_separated_at"]);
    assert.deepEqual(campos({ ...DIVIDIR, line_separated_at: " " }), ["line_separated_at"]);
    assert.deepEqual(
      campos({
        ...DIVIDIR,
        split_volumes: [
          { number: 16, qty: 54 },
          { number: 17, qty: 41, weight_kg: 9.8 },
        ],
      }),
      ["split_volumes.1.weight_kg"],
    );
  });

  it("de 2 a 20 partes, cada uma com o número e 1 un. ou mais, inteiros, e o peso até 2.000 kg", () => {
    assert.deepEqual(campos({ ...DIVIDIR, split_volumes: [{ number: 16, qty: 95 }] }), ["split_volumes"]);
    assert.deepEqual(campos({ ...DIVIDIR, split_volumes: Array.from({ length: 21 }, (_, index) => ({ number: 16 + index, qty: 1 })) }), ["split_volumes"]);
    assert.equal(entradaDaSeparacao({ ...DIVIDIR, split_volumes: Array.from({ length: 20 }, (_, index) => ({ number: 16 + index, qty: 1 })) }).split_volumes!.length, 20);
    assert.deepEqual(campos({ ...DIVIDIR, split_volumes: [{ number: 16, qty: 0 }, { number: 17, qty: 95 }] }), ["split_volumes.0.qty"]);
    assert.deepEqual(campos({ ...DIVIDIR, split_volumes: [{ number: 16, qty: 54.5 }, { number: 17, qty: 40.5 }] }), ["split_volumes.0.qty", "split_volumes.1.qty"]);
    assert.deepEqual(campos({ ...DIVIDIR, split_volumes: [{ number: 0, qty: 54 }, { number: 17, qty: 41 }] }), ["split_volumes.0.number"]);
    assert.deepEqual(campos({ ...DIVIDIR, split_volumes: [{ number: 16, qty: 54, weight_kg: 2000.5 }, { number: 17, qty: 41 }] }), ["split_volumes.0.weight_kg"]);
    assert.deepEqual(campos({ ...DIVIDIR, split_volumes: [{ number: 16, qty: 54, weight_kg: 0 }, { number: 17, qty: 41 }] }), ["split_volumes.0.weight_kg"]);
    assert.deepEqual(campos({ ...DIVIDIR, split_volumes: [{ number: 16, qty: 54, box_code: "CX-000218" }, { number: 17, qty: 41 }] }), ["split_volumes.0"]);
    assert.deepEqual(campos({ ...DIVIDIR, open_volume_units: -1 }), ["open_volume_units"]);
  });

  it("sem a divisão, o volume aberto e a linha não vêm", () => {
    assert.deepEqual(campos({ ...SEPARAR, open_volume_id: "v16" }), ["open_volume_id"]);
    assert.deepEqual(campos({ ...SEPARAR, open_volume_id: null }), ["open_volume_id"]);
    assert.deepEqual(campos({ ...SEPARAR, open_volume_units: 35 }), ["open_volume_units"]);
    assert.deepEqual(campos({ ...SEPARAR, line_separated_at: null }), ["line_separated_at"]);
    assert.deepEqual(campos({ ...SEPARAR, separated: false, line_separated_at: "2026-11-11T14:02:00.000Z" }), ["line_separated_at"]);
  });
});
