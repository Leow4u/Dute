import { describe, expect, it } from "vitest";

import { overviewLine, productGender, productTitle, productType, stockOverview, typeOptions, typeValue } from "./portal-stock";

// Como a Contagem e o Receber gravam: nome é a descrição, categoria é o tipo.
const products = [
  { name: "Polo masculino pima preta SW", category: "Polo", available: 67, total: 67, minimum: 80 },
  { name: "Polo feminina piquet rosa OUT", category: "POLO", available: 207, total: 210 },
  { name: "SACOLA QUADRADA - BTG", category: "Sacola", available: 435, total: 435 },
  { name: "Toalha de academia", category: "Toalha", available: 0, total: 0 },
  { name: "CABIDE", category: "", available: 12, total: 12 },
  { name: "Polo antigo", category: "Polo", available: 0, total: 0, archived: true },
];

describe("estoque do portal", () => {
  it("título é o nome (descrição); a categoria é o tipo", () => {
    expect(productTitle(products[0]!)).toBe("Polo masculino pima preta SW");
    expect(productTitle(products[2]!)).toBe("Sacola quadrada - BTG");
    expect(productType(products[2]!)).toBe("Sacola");
    expect(productType(products[1]!)).toBe("Polo");
    expect(productType(products[4]!)).toBe("Outros");
    expect(productType({ category: "Sem categoria" })).toBe("Outros");
  });

  it("filtro por tipo agrupa pela categoria, do mais comum ao menos", () => {
    const options = typeOptions(products);
    expect(options[0]).toEqual({ value: "todos", label: "Todos os tipos", count: 6 });
    expect(options[1]).toEqual({ value: "polo", label: "Polo", count: 3 });
    expect(options.map((option) => option.value)).toEqual(["todos", "polo", "outros", "sacola", "toalha"]);
    expect(typeValue({ category: "Camiseta Fio Egípcio" })).toBe("camiseta-fio-egipcio");
    expect(typeValue({ category: "Sem categoria" })).toBe("outros");
  });

  it("resumo do topo e contagens, sem arquivados", () => {
    const overview = stockOverview(products);
    expect(overview).toEqual({ items: 5, pieces: 724, withStock: 4, low: 1, zero: 1, archived: 1 });
    expect(overviewLine(overview)).toBe("724 peças em 5 itens · 1 abaixo do mínimo · 1 sem saldo");
    expect(overviewLine(stockOverview([products[2]!]))).toBe("435 peças em 1 item");
  });
});

describe("gênero do produto, pelo nome que o cartão mostra", () => {
  it("lê feminino e masculino no nome, com ou sem acento, em qualquer caixa e abreviado", () => {
    expect(productGender(products[1]!)).toBe("feminino");
    expect(productGender(products[0]!)).toBe("masculino");
    expect(productGender({ name: "Polo feminina piquet azul marinho PP", category: "Polo" })).toBe("feminino");
    expect(productGender({ name: "Camiseta feminino piquet preto GG", category: "Camiseta" })).toBe("feminino");
    expect(productGender({ name: "CAMISETA MASCULINA FIO EGÍPCIO", category: "" })).toBe("masculino");
    expect(productGender({ name: "Jaqueta copa masculina azul G", category: "Jaqueta" })).toBe("masculino");
    expect(productGender({ name: "Blusa Femínina de tricot", category: "" })).toBe("feminino");
    expect(productGender({ name: "Camiseta fem. piquet", category: "" })).toBe("feminino");
    expect(productGender({ name: "Polo MASC azul", category: "" })).toBe("masculino");
  });

  it("sem gênero no nome, ou com os dois, não marca", () => {
    expect(productGender(products[2]!)).toBeNull();
    expect(productGender(products[3]!)).toBeNull();
    expect(productGender({ name: "Tricot meio zíper preto M", category: "Tricot" })).toBeNull();
    expect(productGender({ name: "Kit polo masculina e feminina", category: "" })).toBeNull();
    expect(productGender({ name: "Polo unissex", category: "" })).toBeNull();
    expect(productGender({ name: "Máscara de proteção", category: "" })).toBeNull();
    expect(productGender({ name: "Femme Fatale", category: "" })).toBeNull();
  });

  it("a categoria só conta quando o nome falta, como no título", () => {
    expect(productGender({ name: "", category: "Polo feminina" })).toBe("feminino");
    expect(productGender({ name: "Polo piquet", category: "Feminino" })).toBeNull();
  });
});
