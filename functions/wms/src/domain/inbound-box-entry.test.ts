import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  boxEntryTarget,
  boxPutawayTaskId,
  entradaPorCaixa,
  type CaixaDaChegada,
  type LinhaDaChegada,
} from "./inbound-box-entry.js";

/** A entrada da chegada por caixa sem o banco (recebimento com caixas, parte 4d). */

const CHEGADA = { receiptId: "inb_1", receiptNumber: "AVL-1", owner: "Uniformes Alfa" };

function linha(id: string, lineNumber: number, previsto: number, naCaixa: number, caixas: string[], extra: Partial<LinhaDaChegada> = {}): LinhaDaChegada {
  return { id, line_number: lineNumber, sku_code: `UNI-00000${lineNumber}`, expected_qty: previsto, boxed_qty: naCaixa, box_codes: caixas, location_id: "RECEBIMENTO", ...extra };
}

function caixa(code: string, status: string, conteudo: Array<[string, number]>, extra: Partial<CaixaDaChegada> = {}): CaixaDaChegada {
  return {
    code,
    status,
    customer_code: "Uniformes Alfa",
    origin: { kind: "receipt", receipt_id: "inb_1" },
    lines: conteudo.map(([id, qtd], index) => ({ inbound_item_id: id, line_number: index + 1, sku_code: id === "xg" ? "UNI-000001" : "UNI-000002", counted_qty: qtd })),
    ...extra,
  };
}

/** XG 41 previsto, 29 em CX-1; GG 30 previsto, 12 em CX-1 e 18 em CX-2. */
function montagem() {
  return {
    linhas: [
      linha("xg", 1, 41, 29, ["CX-000001"], { shortage: { qty: 12, boxed_qty: 29, reason: "falta" } }),
      linha("gg", 2, 30, 30, ["CX-000001", "CX-000002"]),
    ],
    caixas: [
      caixa("CX-000001", "committing", [["xg", 29], ["gg", 12]], { destination_location_id: "A-01" }),
      caixa("CX-000002", "reviewed", [["gg", 18]]),
    ],
  };
}

describe("a porta da conclusão por caixa", () => {
  it("só a chegada por caixa, a conferir ou em conferência, do cliente ativo, vai direto a received", () => {
    for (const status of ["created", "checking", undefined]) {
      assert.equal(boxEntryTarget({ id: "inb_1", customer_code: "Alfa", conference_mode: "per_box", status }, "Alfa"), "received");
    }
    assert.equal(boxEntryTarget({ id: "inb_1", customer_code: "Alfa", conference_mode: "per_box", status: "created" }), "received");
    assert.throws(() => boxEntryTarget({ id: "inb_1", receipt_number: "AVL-1", customer_code: "Alfa", status: "created" }), {
      code: "failed-precondition",
      message: "A chegada AVL-1 é conferida por linha: use a conferência da chegada.",
      details: { code: "RECEIPT_CONFERRED_PER_LINE" },
    });
    assert.throws(() => boxEntryTarget({ id: "inb_1", customer_code: "Alfa", conference_mode: "per_box", status: "created" }, "Beta"), {
      code: "permission-denied",
      message: "Chegada de outro cliente. Troque o cliente ativo para Alfa.",
    });
    assert.throws(() => boxEntryTarget({ id: "inb_1", receipt_number: "AVL-1", customer_code: "Alfa", conference_mode: "per_box", status: "received" }), {
      details: { code: "RECEIPT_NOT_OPEN" },
    });
  });

  it("o id da tarefa de guarda da caixa é sempre o mesmo para a mesma chegada e caixa", () => {
    assert.equal(boxPutawayTaskId("inb_1", "CX-000001"), boxPutawayTaskId("inb_1", "CX-000001"));
    assert.notEqual(boxPutawayTaskId("inb_1", "CX-000001"), boxPutawayTaskId("inb_1", "CX-000002"));
    assert.notEqual(boxPutawayTaskId("inb_1", "CX-000001"), boxPutawayTaskId("inb_2", "CX-000001"));
    assert.match(boxPutawayTaskId("inb_1", "CX-000001"), /^put_box_[0-9a-f]{32}$/);
  });
});

describe("a entrada pelas caixas", () => {
  it("a soma das caixas por linha, com a falta marcada e a divergência justificada", () => {
    const entrada = entradaPorCaixa({ ...CHEGADA, ...montagem(), nota: "Fornecedor mandou 12 XG a menos" });
    assert.deepEqual(Object.fromEntries(entrada.linhas), {
      xg: { received_qty: 29, difference_qty: -12, conference_status: "short", clear_shortage: false },
      gg: { received_qty: 30, difference_qty: 0, conference_status: "ok", clear_shortage: false },
    });
    assert.deepEqual([entrada.qty_received, entrada.qty_difference, entrada.divergence_count, entrada.conference_status], [59, -12, 1, "divergence"]);
    assert.deepEqual(
      entrada.caixas.map((guarda) => [guarda.code, guarda.destination, guarda.unit_count, guarda.sku_codes]),
      [["CX-000001", "A-01", 41, ["UNI-000001", "UNI-000002"]], ["CX-000002", null, 18, ["UNI-000002"]]],
    );
  });

  it("três casas na soma, a sobra é divergência e a marca da linha coberta sai", () => {
    const entrada = entradaPorCaixa({
      ...CHEGADA,
      linhas: [linha("xg", 1, 1.5, 1.6, ["CX-000001"], { shortage: { qty: 1, boxed_qty: 0.5 } })],
      caixas: [caixa("CX-000001", "reviewed", [["xg", 1.1], ["xg", 0.5]])],
      nota: "Sobra de 100 g",
    });
    assert.deepEqual(entrada.linhas.get("xg"), { received_qty: 1.6, difference_qty: 0.1, conference_status: "over", clear_shortage: true });
    const semDivergencia = entradaPorCaixa({ ...CHEGADA, linhas: [linha("xg", 1, 2, 2, ["CX-000001"])], caixas: [caixa("CX-000001", "reviewed", [["xg", 2]])] });
    assert.deepEqual([semDivergencia.divergence_count, semDivergencia.conference_status], [0, "ok"]);
  });

  it("a caixa fechada sem prateleira conclui (decisão 14)", () => {
    const { linhas } = montagem();
    const entrada = entradaPorCaixa({
      ...CHEGADA,
      linhas,
      caixas: [caixa("CX-000001", "reviewed", [["xg", 29], ["gg", 12]]), caixa("CX-000002", "reviewed", [["gg", 18]])],
      nota: "Falta de XG",
    });
    assert.deepEqual(entrada.caixas.map((guarda) => guarda.destination), [null, null]);
  });

  it("recusa a caixa vazia e a caixa ainda em conferência, nomeando a caixa (decisão 18)", () => {
    const { linhas, caixas } = montagem();
    assert.throws(() => entradaPorCaixa({ ...CHEGADA, linhas, caixas: [...caixas, caixa("CX-000003", "counting", [])], nota: "x" }), {
      code: "failed-precondition",
      message: "Remova a caixa CX-000003, vazia, antes de concluir a entrada.",
      details: { code: "BOX_STILL_COUNTING", box_code: "CX-000003" },
    });
    assert.throws(() => entradaPorCaixa({ ...CHEGADA, linhas, caixas: [caixas[0]!, { ...caixas[1]!, status: "counting" }], nota: "x" }), {
      message: "Feche a caixa CX-000002 (medidas e peso) antes de concluir a entrada.",
    });
  });

  it("recusa a chegada sem nenhuma caixa, mesmo com toda falta marcada (decisão 19)", () => {
    assert.throws(
      () => entradaPorCaixa({ ...CHEGADA, linhas: [linha("xg", 1, 41, 0, [], { shortage: { qty: 41, boxed_qty: 0 } })], caixas: [], nota: "Nada veio" }),
      { code: "failed-precondition", message: "A chegada AVL-1 não tem nenhuma caixa: a entrada pede ao menos uma caixa fechada.", details: { code: "BOX_RECEIPT_WITHOUT_BOXES" } },
    );
  });

  it("recusa a falta sem marca e a marca velha", () => {
    const { linhas, caixas } = montagem();
    const semMarca = [{ ...linhas[0]!, shortage: undefined }, linhas[1]!];
    assert.throws(() => entradaPorCaixa({ ...CHEGADA, linhas: semMarca, caixas, nota: "x" }), {
      code: "failed-precondition",
      message: "A linha 1 tem 29 de 41: complete as caixas ou marque a falta.",
      details: { code: "SHORTAGE_NOT_MARKED" },
    });
    const marcaVelha = [{ ...linhas[0]!, shortage: { qty: 21, boxed_qty: 20 } }, linhas[1]!];
    assert.throws(() => entradaPorCaixa({ ...CHEGADA, linhas: marcaVelha, caixas, nota: "x" }), { details: { code: "SHORTAGE_NOT_MARKED" } });
  });

  it("recusa a divergência sem justificativa, com a frase da entrada por linha", () => {
    assert.throws(() => entradaPorCaixa({ ...CHEGADA, ...montagem() }), {
      code: "failed-precondition",
      message: "Recebimento possui 1 linha(s) com divergência. Informe a justificativa operacional antes de concluir.",
    });
    assert.throws(() => entradaPorCaixa({ ...CHEGADA, ...montagem(), nota: "   " }), { code: "failed-precondition" });
  });

  it("recusa a linha que não confere com as caixas", () => {
    const { linhas, caixas } = montagem();
    assert.throws(() => entradaPorCaixa({ ...CHEGADA, linhas: [linhas[0]!, { ...linhas[1]!, boxed_qty: 29 }], caixas, nota: "x" }), {
      message: "A linha 2 não confere com as caixas (29 na linha, 30 nas caixas). Atualize a tela e confira as caixas.",
      details: { code: "BOXED_QTY_MISMATCH" },
    });
    assert.throws(() => entradaPorCaixa({ ...CHEGADA, linhas: [linhas[0]!, { ...linhas[1]!, box_codes: ["CX-000001"] }], caixas, nota: "x" }), {
      details: { code: "BOXED_QTY_MISMATCH" },
    });
  });

  it("recusa a caixa de outra chegada ou cliente e o produto fora da NF", () => {
    const { linhas, caixas } = montagem();
    for (const outra of [
      { ...caixas[1]!, origin: { kind: "receipt", receipt_id: "inb_2" } },
      { ...caixas[1]!, customer_code: "Outro" },
      { ...caixas[1]!, origin: { kind: "opening", session_id: "s" } },
    ]) {
      assert.throws(() => entradaPorCaixa({ ...CHEGADA, linhas, caixas: [caixas[0]!, outra], nota: "x" }), {
        code: "permission-denied",
        message: "A caixa CX-000002 é de outra chegada.",
      });
    }
    assert.throws(
      () => entradaPorCaixa({ ...CHEGADA, linhas, caixas: [caixas[0]!, caixa("CX-000002", "reviewed", [["outra", 1]])], nota: "x" }),
      { message: "A caixa CX-000002 tem um produto que não está na NF da chegada AVL-1.", details: { code: "BOX_LINE_OUTSIDE_RECEIPT", box_code: "CX-000002" } },
    );
  });

  it("recusa a linha fora da área de recebimento; RECEBIMENTO em qualquer grafia passa", () => {
    const { linhas, caixas } = montagem();
    assert.throws(() => entradaPorCaixa({ ...CHEGADA, linhas: [linhas[0]!, { ...linhas[1]!, location_id: "A-02" }], caixas, nota: "x" }), {
      message: "A linha 2 vai direto para A-02: na chegada por caixa, toda linha passa pela área de recebimento.",
    });
    assert.doesNotThrow(() => entradaPorCaixa({ ...CHEGADA, linhas: [linhas[0]!, { ...linhas[1]!, location_id: "recebimento" }], caixas, nota: "x" }));
  });
});
