import { describe, expect, it } from "vitest";

import { buildInvoiceView } from "./invoice-view";

const preview = {
  grupos: [
    {
      grupo: "ad_valorem",
      itens: [
        { item: "Ad Valorem sobre estoque", unidade: "% estoque", qtde: 854773.4, valor_unit: 0.005, total: 4273.87, auto: true, auto_source: "ad_valorem" },
      ],
    },
    {
      grupo: "armazenamento",
      itens: [
        { item: "Movimentação Estoque Sistêmico", unidade: "Evento/mês", qtde: 1, valor_unit: 350, total: 350 },
        { item: "Etiquetagem", unidade: "Etiqueta", qtde: 0, valor_unit: 1.2, total: 0 },
      ],
    },
    { grupo: "expedicao", itens: [{ item: "Expedição – Caixa", unidade: "Caixa", qtde: 0, valor_unit: 10, total: 0 }] },
  ],
};

describe("fatura para a cliente", () => {
  const view = buildInvoiceView(preview);

  it("mostra só serviços com quantidade e esconde grupos vazios", () => {
    expect(view.groups.map((group) => group.label)).toEqual(["Armazenamento", "Ad Valorem"]);
    expect(view.groups[0].lines.map((line) => line.item)).toEqual(["Movimentação Estoque Sistêmico"]);
  });

  it("põe o Ad Valorem por último e soma em centavos", () => {
    expect(view.groups.at(-1)?.lines[0]).toMatchObject({ adValorem: true, qtde: 854773.4 });
    expect(view.total).toBe(4623.87);
  });

  it("aceita o formato do portal (groups/lines)", () => {
    const portal = buildInvoiceView({
      lines: [
        { grupo: "recebimento", item: "Recebimento – Caixa", qtde: 2, valor_unit: 10, total: 20 },
        { grupo: "recebimento", item: "Recebimento – Palete", qtde: 0, valor_unit: 30, total: 0 },
      ],
    });
    expect(portal.groups).toEqual([
      {
        key: "recebimento",
        label: "Recebimento",
        total: 20,
        lines: [{ item: "Recebimento – Caixa", unidade: "", qtde: 2, valorUnit: 10, total: 20, adValorem: false }],
      },
    ]);
  });
});
