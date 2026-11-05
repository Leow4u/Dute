import { describe, expect, it } from "vitest";

import {
  bloqueiosDaConclusao,
  bloqueiosDaTela,
  caixasGuardadas,
  chegadaPorCaixa,
  esperaJustificativa,
  modoDaChegadaAvulsa,
  emTresCasas,
  estadoDaCaixa,
  pedeJustificativa,
  situacaoDaLinha,
  totaisDaChegada,
  type CaixaDaChegada,
  type LinhaDaNf,
} from "./caixas-do-recebimento";

/**
 * As regras da chegada por caixa que a tela mostra antes de chamar o
 * servidor (recebimento com caixas, parte 5). Espelham entradaPorCaixa, em
 * functions/wms/src/domain/inbound-box-entry.ts.
 */

function caixa(code: string, status: string, unidades: number[], location_id = ""): CaixaDaChegada {
  return {
    code,
    status,
    location_id,
    lines: unidades.map((counted_qty, indice) => ({
      inbound_item_id: `item_${indice + 1}`,
      line_number: indice + 1,
      sku_code: `BTG-00008${indice + 6}`,
      client_item_code: `A.01.0806.004.${indice ? "GG" : "XG"}`,
      product_name: `POLO ${indice ? "GG" : "XG"}`,
      size: indice ? "GG" : "XG",
      counted_qty,
    })),
    unit_count: unidades.reduce((soma, valor) => soma + valor, 0),
    length_m: null,
    width_m: null,
    height_m: null,
    gross_weight_kg: null,
    allow_tilt: false,
    allow_stacking: false,
    conference_revision: 1,
    refused_positions: [],
  };
}

function linha(line_number: number, expected: number, boxed: number, shortage?: LinhaDaNf["shortage"]): LinhaDaNf {
  return { id: `item_${line_number}`, line_number, expected_quantity: expected, boxed_qty: boxed, shortage };
}

describe("a situação da linha da NF", () => {
  it("o que está nas caixas contra o que a NF pede: OK, faltam e sobram", () => {
    expect(situacaoDaLinha(linha(2, 30, 30))).toEqual({ tipo: "ok" });
    expect(situacaoDaLinha(linha(1, 41, 29))).toEqual({ tipo: "faltam", quantidade: 12 });
    expect(situacaoDaLinha(linha(1, 41, 43))).toEqual({ tipo: "sobram", quantidade: 2 });
  });

  it("a falta marcada vale para o que estava nas caixas; mudou, a marca fica velha", () => {
    const marca = { qty: 12, boxed_qty: 29, expected_qty: 41, reason: "avaria" as const, detail: "Volume 3 molhado" };
    expect(situacaoDaLinha(linha(1, 41, 29, marca))).toEqual({
      tipo: "falta_marcada",
      quantidade: 12,
      motivo: "avaria",
      detalhe: "Volume 3 molhado",
    });
    expect(situacaoDaLinha(linha(1, 41, 30, marca))).toEqual({ tipo: "marca_velha", quantidade: 11 });
    // A linha que passou a ser coberta não depende da marca.
    expect(situacaoDaLinha(linha(1, 41, 41, marca))).toEqual({ tipo: "ok" });
  });

  it("três casas, como o servidor conta", () => {
    expect(emTresCasas(0.1 + 0.2)).toBe(0.3);
    expect(situacaoDaLinha(linha(1, 0.3, 0.1 + 0.2))).toEqual({ tipo: "ok" });
    expect(situacaoDaLinha({ id: "item_1", line_number: 1, quantity: 5, boxed_qty: null })).toEqual({ tipo: "faltam", quantidade: 5 });
  });
});

describe("o que impede concluir a entrada", () => {
  it("sem caixa nenhuma, só isso (decisão 19)", () => {
    expect(bloqueiosDaConclusao([], [linha(1, 41, 0)])).toEqual(["Nenhuma caixa"]);
  });

  it("a caixa vazia, a caixa em conferência e a linha sem falta marcada, na ordem do servidor", () => {
    const caixas = [caixa("CX-000133", "counting", []), caixa("CX-000132", "counting", [0, 18]), caixa("CX-000131", "committing", [29, 12], "B-02")];
    const linhas = [linha(2, 30, 30), linha(1, 41, 29)];
    expect(bloqueiosDaConclusao(caixas, linhas)).toEqual(["CX-000132 em conferência", "CX-000133 vazia", "linha 1 sem falta marcada"]);
  });

  it("a caixa fechada sem prateleira não impede (decisão 14), e a marca velha é como a falta sem marca", () => {
    const caixas = [caixa("CX-000131", "committing", [29, 12], "B-02"), caixa("CX-000132", "reviewed", [0, 18])];
    const marcada = { qty: 12, boxed_qty: 29, expected_qty: 41, reason: "falta" as const };
    expect(bloqueiosDaConclusao(caixas, [linha(1, 41, 29, marcada), linha(2, 30, 30)])).toEqual([]);
    expect(bloqueiosDaConclusao(caixas, [linha(1, 41, 28, marcada), linha(2, 30, 30)])).toEqual(["linha 1 sem falta marcada"]);
  });

  it("com falta marcada ou sobra, a conclusão pede a justificativa", () => {
    expect(pedeJustificativa([linha(1, 41, 41), linha(2, 30, 30)])).toBe(false);
    expect(pedeJustificativa([linha(1, 41, 29, { qty: 12, boxed_qty: 29, expected_qty: 41, reason: "falta" }), linha(2, 30, 30)])).toBe(true);
    expect(pedeJustificativa([linha(1, 41, 43)])).toBe(true);
  });
});

describe("os totais e o concluir na tela", () => {
  it("linha a linha: a sobra de uma linha não cobre a falta de outra, e a falta marcada sai do sem caixa", () => {
    const marcada = { qty: 12, boxed_qty: 29, expected_qty: 41, reason: "avaria" as const };
    expect(totaisDaChegada([linha(1, 41, 0), linha(2, 30, 36)])).toEqual({ esperado: 71, emCaixas: 36, semCaixa: 41, faltaMarcada: 0 });
    expect(totaisDaChegada([linha(1, 41, 29, marcada), linha(2, 30, 30)])).toEqual({ esperado: 71, emCaixas: 59, semCaixa: 0, faltaMarcada: 12 });
    // A marca velha volta ao sem caixa.
    expect(totaisDaChegada([linha(1, 41, 28, marcada), linha(2, 30, 30)])).toEqual({ esperado: 71, emCaixas: 58, semCaixa: 13, faltaMarcada: 0 });
  });

  it("com divergência, a justificativa em branco também impede concluir", () => {
    const caixas = [caixa("CX-000131", "committing", [29, 12], "B-02")];
    const marcada = { qty: 12, boxed_qty: 29, expected_qty: 41, reason: "falta" as const };
    const linhas = [linha(1, 41, 29, marcada), linha(2, 30, 30)];
    expect(bloqueiosDaTela(caixas, linhas, "  ")).toEqual(["divergência sem justificativa"]);
    expect(bloqueiosDaTela(caixas, linhas, "Fornecedor envia o volume 3 na próxima NF.")).toEqual([]);
    expect(bloqueiosDaTela(caixas, [linha(1, 41, 41), linha(2, 30, 30)], "")).toEqual([]);
    expect(bloqueiosDaTela([], linhas, "")).toEqual(["Nenhuma caixa"]);
  });

  it("a justificativa só entra quando as caixas e as linhas já estão tratadas", () => {
    const emConferencia = [caixa("CX-000131", "committing", [29, 12], "B-02"), caixa("CX-000132", "counting", [0, 18])];
    const linhas = [linha(1, 41, 29), linha(2, 30, 30)];
    expect(esperaJustificativa(emConferencia, linhas)).toBe(false);
    expect(bloqueiosDaTela(emConferencia, linhas, "")).toEqual(["CX-000132 em conferência", "linha 1 sem falta marcada"]);
    const prontas = [caixa("CX-000131", "committing", [29, 12], "B-02")];
    expect(esperaJustificativa(prontas, [linha(1, 41, 43), linha(2, 30, 30)])).toBe(true);
    expect(esperaJustificativa(prontas, [linha(1, 41, 41), linha(2, 30, 30)])).toBe(false);
  });
});

describe("a caixa e a chegada na tela", () => {
  it("o selo da caixa pelo estado dela", () => {
    expect(estadoDaCaixa({ status: "counting", location_id: "" })).toEqual({ rotulo: "em conferência", tom: "amb" });
    expect(estadoDaCaixa({ status: "reviewed", location_id: "" })).toEqual({ rotulo: "sem prateleira", tom: "amb" });
    expect(estadoDaCaixa({ status: "committing", location_id: "B-02" })).toEqual({ rotulo: "destino confirmado", tom: "grn" });
    expect(estadoDaCaixa({ status: "stored", location_id: "B-02" })).toEqual({ rotulo: "guardada em B-02", tom: "mut" });
    expect(estadoDaCaixa({ status: "cancelled", location_id: "" })).toEqual({ rotulo: "cancelada", tom: "mut" });
  });

  it("as caixas guardadas da chegada recebida (decisão 5)", () => {
    expect(caixasGuardadas({ box_count: 2, boxes_stored: 0 })).toBe("0 de 2 caixas guardadas");
    expect(caixasGuardadas({ box_count: 1, boxes_stored: 1 })).toBe("1 de 1 caixa guardada");
    expect(caixasGuardadas({ box_count: 2, boxes_stored: 5 })).toBe("2 de 2 caixas guardadas");
  });

  it("a chegada avulsa pede por caixa só com a liberação e o modelo que confere por caixa (parte 5g, decisão 1)", () => {
    expect(modoDaChegadaAvulsa(true, { inboundConference: "per_box" })).toBe("per_box");
    expect(modoDaChegadaAvulsa(false, { inboundConference: "per_box" })).toBeUndefined();
    expect(modoDaChegadaAvulsa(true, { inboundConference: "per_line" })).toBeUndefined();
    expect(modoDaChegadaAvulsa(true, null)).toBeUndefined();
  });

  it("só a chegada gravada por caixa vai para a tela da caixa", () => {
    expect(chegadaPorCaixa({ conference_mode: "per_box" })).toBe(true);
    expect(chegadaPorCaixa({ conference_mode: null })).toBe(false);
    expect(chegadaPorCaixa(undefined)).toBe(false);
  });
});
