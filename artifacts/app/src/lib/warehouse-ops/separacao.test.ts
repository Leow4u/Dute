import { describe, expect, it } from "vitest";

import { gruposDaSeparacao } from "./lista-de-separacao";
import type { WarehouseTaskItem } from "./model";
import {
  diferencaValida,
  emSeparacaoDesde,
  estadoDaLinha,
  hrefDaBancada,
  idDaTarefaDeSeparacao,
  itemDaLinhaDeSeparacao,
  itensDoProgresso,
  percentualSeparado,
  podeConcluirSeparacao,
  progressoDoGrupo,
  progressoDoPedido,
  seloDaSeparacao,
  separacaoComecou,
  textoComDiferenca,
  textoDaDiferenca,
  textoPorSeparar,
  unidadesDoProgresso,
} from "./separacao";

/**
 * Separar com o progresso salvo (separação com caixas, partes 2 e 5;
 * docs/mockups/WmsSepararBancada.dc.html): o que a bancada e a fila dizem do
 * pedido em separação. Antes, a tela não sabia o que já tinha sido separado.
 * Dados sintéticos.
 */

function linha(id: string, quantidade: number, progresso: Partial<WarehouseTaskItem> = {}): WarehouseTaskItem {
  return { id, location: "B-09", product_name: `Produto ${id}`, sku_code: `SKU-${id}`, expected_quantity: quantidade, quantity: quantidade, ...progresso };
}

const SEPARADA = { separated_qty: 30, separated_at: "2026-11-10T13:00:00.000Z", separated_by: "Guilherme Dantas" };
const ITENS = [
  linha("1", 30, SEPARADA),
  linha("2", 2, { separated_qty: 1, separated_at: "2026-11-10T13:05:00.000Z", shortage_reason: "avaria", shortage_detail: "1 com o zíper quebrado" }),
  linha("3", 40),
  linha("4", 35),
];

describe("o progresso do pedido em separação", () => {
  it("a linha está pendente, separada ou com diferença", () => {
    expect(ITENS.map(estadoDaLinha)).toEqual(["separada", "com_diferenca", "pendente", "pendente"]);
    // Zero separado, com o motivo, também é linha tratada.
    expect(estadoDaLinha(linha("5", 2, { separated_qty: 0, separated_at: "2026-11-10T13:00:00.000Z", shortage_reason: "falta" }))).toBe("com_diferenca");
  });

  it("conta os itens e as unidades separadas, e as linhas com diferença", () => {
    const progresso = progressoDoPedido(ITENS);
    expect(progresso).toEqual({ itens: 4, separados: 2, unidades: 107, unidadesSeparadas: 31, comDiferenca: 1 });
    expect(itensDoProgresso(progresso)).toBe("2 de 4 itens");
    expect(unidadesDoProgresso(progresso)).toBe("31 de 107 un.");
    expect(textoPorSeparar(progresso)).toBe("2 itens por separar");
    expect(textoComDiferenca(progresso)).toBe("1 linha com diferença");
    expect(percentualSeparado(progresso)).toBe(50);
  });

  it("os números grandes saem com o ponto, e o singular sem o s", () => {
    const grande = { itens: 116, separados: 10, unidades: 3335, unidadesSeparadas: 665, comDiferenca: 0 };
    expect(itensDoProgresso(grande)).toBe("10 de 116 itens");
    expect(unidadesDoProgresso(grande)).toBe("665 de 3.335 un.");
    expect(textoPorSeparar(grande)).toBe("106 itens por separar");
    expect(textoComDiferenca(grande)).toBeNull();
    expect(percentualSeparado(grande)).toBe(9);
    expect(itensDoProgresso({ itens: 1, separados: 0 })).toBe("0 de 1 item");
    expect(textoPorSeparar({ itens: 5, separados: 4 })).toBe("1 item por separar");
    expect(textoPorSeparar({ itens: 5, separados: 5 })).toBeNull();
    expect(textoComDiferenca({ comDiferenca: 2 })).toBe("2 linhas com diferença");
    expect(percentualSeparado({ itens: 0, separados: 0 })).toBe(0);
  });

  it("a linha a menos diz o separado, o pedido e o motivo", () => {
    expect(textoDaDiferenca(ITENS[1])).toBe("separado 1 de 2 · Avaria");
    expect(textoDaDiferenca(linha("6", 12, { separated_qty: 0, separated_at: "x", shortage_reason: "FALTA" }))).toBe("separado 0 de 12 · Falta");
    expect(textoDaDiferenca(linha("7", 12, { separated_qty: 10, separated_at: "x" }))).toBe("separado 10 de 12");
  });

  it("o cabeçalho da prateleira diz quantos itens dela já foram separados", () => {
    const [grupo] = gruposDaSeparacao(ITENS);
    expect(progressoDoGrupo(grupo)).toEqual({ separados: 2, itens: 4, completo: false, texto: "2 de 4" });
    const [completo] = gruposDaSeparacao(ITENS.slice(0, 2));
    expect(progressoDoGrupo(completo)).toMatchObject({ completo: true, texto: "2 de 2" });
  });
});

describe("o selo do pedido em separação na fila", () => {
  it("antes de começar, sem selo; depois, a data do começo no horário de São Paulo e os itens", () => {
    expect(seloDaSeparacao({ status: "planned" }, [linha("1", 5), linha("2", 2)])).toBeNull();
    expect(seloDaSeparacao(undefined, ITENS)).toBeNull();
    // 02:10 UTC do dia 13 ainda é o dia 12 em São Paulo.
    expect(seloDaSeparacao({ status: "in_progress", separation_started_at: "2026-11-13T02:10:00.000Z" }, ITENS)).toBe("em separação desde 12/11 · 2 de 4 itens");
    expect(emSeparacaoDesde("2026-11-10T13:00:00.000Z")).toBe("em separação desde 10/11");
  });

  it("a separação começada sem a data (pela tela antiga) diz só que está em separação", () => {
    expect(seloDaSeparacao({ status: "in_progress" }, [linha("1", 5)])).toBe("em separação · 0 de 1 item");
    expect(emSeparacaoDesde(undefined)).toBe("em separação");
    expect(emSeparacaoDesde("sem data")).toBe("em separação");
    expect(separacaoComecou({ status: "planned" }, [linha("1", 5, SEPARADA)])).toBe(true);
  });
});

describe("concluir a separação e registrar a diferença", () => {
  it("Concluir liga com todas as linhas tratadas; com diferença, só para a coordenação", () => {
    const tudo = progressoDoPedido([linha("1", 30, SEPARADA)]);
    expect(podeConcluirSeparacao(tudo, false)).toBe(true);
    expect(podeConcluirSeparacao(progressoDoPedido(ITENS), true)).toBe(false);
    const comDiferenca = progressoDoPedido(ITENS.slice(0, 2));
    expect(podeConcluirSeparacao(comDiferenca, false)).toBe(false);
    expect(podeConcluirSeparacao(comDiferenca, true)).toBe(true);
    expect(podeConcluirSeparacao(progressoDoPedido([]), true)).toBe(false);
  });

  it("Registrar diferença só com o separado abaixo do pedido e o motivo escolhido", () => {
    expect(diferencaValida(2, 1, "avaria")).toBe(true);
    expect(diferencaValida(2, 0, "falta")).toBe(true);
    expect(diferencaValida(2, 2, "falta")).toBe(false);
    expect(diferencaValida(2, 1, "")).toBe(false);
    expect(diferencaValida(2, 1, "sumiu")).toBe(false);
    expect(diferencaValida(2, -1, "falta")).toBe(false);
    expect(diferencaValida(2, Number.NaN, "falta")).toBe(false);
  });
});

describe("a linha lida do servidor e o endereço da bancada", () => {
  it("a linha da separação vira o item da tela, com o progresso gravado", () => {
    expect(
      itemDaLinhaDeSeparacao("pli_ord_1_02", {
        line_number: 2,
        sku_code: "BTG-000106",
        client_item_code: "C.0612.002.U",
        product_name: "Lancheira Grande AZ",
        location_id: "B-09",
        qty_to_pick: 2,
        qty_picked: 0,
        status: "open",
        separated_qty: 1,
        separated_at: "2026-11-10T13:05:00.000Z",
        separated_by: { uid: "wms-1", name: "Guilherme Dantas", role: "wms" },
        separated_shortage_reason: "avaria",
        separated_shortage_detail: "1 com o zíper quebrado",
      }),
    ).toEqual({
      id: "pli_ord_1_02",
      line_number: 2,
      sku: "BTG-000106",
      sku_code: "BTG-000106",
      client_item_code: "C.0612.002.U",
      name: "Lancheira Grande AZ",
      product_name: "Lancheira Grande AZ",
      quantity: 2,
      expected_quantity: 2,
      picked_quantity: 0,
      status: "open",
      location: "B-09",
      separated_qty: 1,
      separated_at: "2026-11-10T13:05:00.000Z",
      separated_by: "Guilherme Dantas",
      shortage_reason: "avaria",
      shortage_detail: "1 com o zíper quebrado",
    });
  });

  it("a linha sem progresso não leva nenhum campo da separação", () => {
    const item = itemDaLinhaDeSeparacao("pli_1", { sku_code: "BTG-1", product_name: "Copo", location_id: "B-09", qty_to_pick: 1, status: "open" });
    expect(item.separated_at).toBeUndefined();
    expect(item.separated_qty).toBeUndefined();
    expect(estadoDaLinha(item)).toBe("pendente");
    // O item do pedido (sem linha de separação) usa a quantidade pedida.
    expect(itemDaLinhaDeSeparacao("oit_1", { sku_code: "BTG-1", requested_qty: 3 }).expected_quantity).toBe(3);
  });

  it("a linha que a separação já concluiu conta como separada no que a conclusão gravou", () => {
    const concluida = itemDaLinhaDeSeparacao("pli_1", {
      sku_code: "BTG-1",
      product_name: "Copo",
      location_id: "B-09",
      qty_to_pick: 5,
      qty_picked: 3,
      status: "completed",
      shortage_reason: "falta",
      picked_at: { seconds: Date.parse("2026-11-12T13:00:00.000Z") / 1000 },
    });
    expect([concluida.separated_qty, concluida.separated_at, concluida.shortage_reason]).toEqual([3, "2026-11-12T13:00:00.000Z", "falta"]);
    expect(estadoDaLinha(concluida)).toBe("com_diferenca");
    // Sem o carimbo, a linha concluída continua contando como separada.
    expect(estadoDaLinha(itemDaLinhaDeSeparacao("pli_2", { qty_to_pick: 5, qty_picked: 5, status: "completed" }))).toBe("separada");
  });

  it("o id da tarefa de separação no servidor sai da tarefa da fila", () => {
    expect(idDaTarefaDeSeparacao({ id: "picking:pick_ord_1" })).toBe("pick_ord_1");
    expect(idDaTarefaDeSeparacao({ id: "pick_ord_1" })).toBe("pick_ord_1");
    expect(idDaTarefaDeSeparacao(undefined)).toBeNull();
  });

  it("a bancada leva o pedido na busca", () => {
    expect(hrefDaBancada("ord_req 1")).toBe("/pedidos/separar?pedido=ord_req%201");
  });
});
