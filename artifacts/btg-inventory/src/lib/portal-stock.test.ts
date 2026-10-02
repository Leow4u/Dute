import { describe, expect, it } from "vitest";

import { overviewLine, productTitle, productType, stockOverview, typeOptions, typeValue } from "./portal-stock";

const products = [
  { name: "POLO", category: "Polo piquet riscos", available: 67, total: 67, minimum: 80 },
  { name: "POLO", category: "Polo piquet", available: 207, total: 210 },
  { name: "SACOLA", category: "Sacola BTG - quadrada", available: 435, total: 435 },
  { name: "TOALHA", category: "Toalha de academia", available: 0, total: 0 },
  { name: "CABIDE", category: "", available: 12, total: 12 },
  { name: "POLO", category: "Polo antigo", available: 0, total: 0, archived: true },
];

describe("estoque do portal", () => {
  it("título é a categoria (nome legível); sem ela, o nome", () => {
    expect(productTitle(products[0]!)).toBe("Polo piquet riscos");
    expect(productTitle(products[4]!)).toBe("Cabide");
    expect(productTitle({ name: "CANECA", category: "Sem categoria" })).toBe("Caneca");
    expect(productType(products[2]!)).toBe("Sacola");
  });

  it("filtro por tipo agrupa pelo nome do produto, do mais comum ao menos", () => {
    const options = typeOptions(products);
    expect(options[0]).toEqual({ value: "todos", label: "Todos os tipos", count: 6 });
    expect(options[1]).toEqual({ value: "polo", label: "Polo", count: 3 });
    expect(options.map((option) => option.value)).toEqual(["todos", "polo", "cabide", "sacola", "toalha"]);
    expect(typeValue({ name: "Camiseta Fio Egípcio" })).toBe("camiseta-fio-egipcio");
  });

  it("resumo do topo e contagens, sem arquivados", () => {
    const overview = stockOverview(products);
    expect(overview).toEqual({ items: 5, pieces: 724, withStock: 4, low: 1, zero: 1, archived: 1 });
    expect(overviewLine(overview)).toBe("724 peças em 5 itens · 1 abaixo do mínimo · 1 sem saldo");
    expect(overviewLine(stockOverview([products[2]!]))).toBe("435 peças em 1 item");
  });
});
