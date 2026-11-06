import { describe, expect, it } from "vitest";

import {
  overviewLine,
  productGender,
  productSize,
  productTitle,
  productTitleWithSize,
  productType,
  stockOverview,
  typeOptions,
  typeValue,
} from "./portal-stock";

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
    expect(overview).toEqual({ items: 5, pieces: 724, receiving: 0, withStock: 4, low: 1, zero: 1, archived: 1 });
    expect(overviewLine(overview)).toBe("724 peças em 5 itens · 1 abaixo do mínimo · 1 sem saldo");
    expect(overviewLine(stockOverview([products[2]!]))).toBe("435 peças em 1 item");
  });

  it("o em recebimento entra no resumo do topo quando há peça chegando, fora os arquivados (parte 7d)", () => {
    const chegando = [
      { name: "Camisa polo manga longa GG", category: "Polo", available: 0, receiving: 24, total: 24 },
      { name: "Polo piquet preto XG", category: "Polo", available: 41, receiving: 6, total: 47 },
      { name: "Polo antiga", category: "Polo", available: 0, receiving: 3, total: 3, archived: true },
    ];
    const overview = stockOverview(chegando);
    expect([overview.pieces, overview.receiving, overview.zero]).toEqual([71, 30, 1]);
    expect(overviewLine(overview)).toBe("71 peças em 2 itens · 30 em recebimento · 1 sem saldo");
  });
});

describe("o nome sem o tamanho repetido (padrão de 06/11/2026)", () => {
  // O print do Leonardo: o card trazia "Polo masculino piquet preto - XG" no título ao escolher o XG.
  const xg = { name: "Polo masculino piquet preto - XG", category: "Polo", clientCode: "A.01.0806.005.XG", clientItemCode: "A.01.0806.005.XG" };

  it("o título tira o tamanho do fim quando ele é o do código do cliente, antes e depois da limpeza dos nomes", () => {
    expect(productTitle(xg)).toBe("Polo masculino piquet preto");
    expect(productTitle({ ...xg, name: "Polo Masculino Piquet Preto" })).toBe("Polo Masculino Piquet Preto");
    expect(productTitle({ name: "Polo P", category: "Polo", clientItemCode: "A.01.0805.002.P" })).toBe("Polo");
    expect(productTitle({ name: "Calça social 42", category: "Calça", clientItemCode: "B.02.0110.001.42" })).toBe("Calça social");
    // Sem o código do item, vale o código do card; "Sem cod. cliente" não tem tamanho.
    expect(productTitle({ name: "Polo masculino piquet preto - XG", category: "Polo", clientCode: "A.01.0806.005.XG" })).toBe("Polo masculino piquet preto");
    expect(productTitle({ name: "Polo masculino piquet preto - XG", category: "Polo", clientCode: "Sem cod. cliente" })).toBe("Polo masculino piquet preto - XG");
  });

  it("o título não tira o que é parte do nome nem o tamanho que não é o do código", () => {
    expect(productTitle({ ...xg, name: "Polo masculino piquet preto - G" })).toBe("Polo masculino piquet preto - G");
    expect(productTitle({ name: "Sacola quadrada - BTG", category: "Sacola", clientItemCode: "J.0149.003.N1" })).toBe("Sacola quadrada - BTG");
    expect(productTitle({ name: "Toalha de academia", category: "Toalha", clientItemCode: "C.0659.001.U" })).toBe("Toalha de academia");
    expect(productTitle({ name: "", category: "Polo", clientItemCode: "A.01.0806.005.XG" })).toBe("Polo");
  });

  it("o nome em maiúsculas passa pelo displayName depois de perder o tamanho", () => {
    expect(productTitle({ ...xg, name: "POLO MASCULINO PIQUET PRETO - XG" })).toBe("Polo masculino piquet preto");
    expect(productTitleWithSize({ ...xg, name: "POLO PIQUET PRETO P", clientItemCode: "A.01.0806.005.P" })).toBe("Polo piquet preto · P");
  });

  it("com o tamanho, o nome e o tamanho depois do ponto; tamanho único e produto sem tamanho ficam só com o nome", () => {
    expect(productTitleWithSize(xg)).toBe("Polo masculino piquet preto · XG");
    expect(productTitleWithSize({ ...xg, name: "Polo Masculino Piquet Preto" })).toBe("Polo Masculino Piquet Preto · XG");
    expect(productTitleWithSize({ name: "Toalha de academia", category: "Toalha", clientItemCode: "C.0659.001.U" })).toBe("Toalha de academia");
    expect(productTitleWithSize({ name: "Boné bordado BTG", category: "Boné", clientItemCode: "A.03.0101.001" })).toBe("Boné bordado BTG");
    expect(productTitleWithSize({ name: "Sacola quadrada - BTG", category: "Sacola", clientItemCode: "J.0149.003.N1" })).toBe("Sacola quadrada - BTG · N1");
  });

  it("o tamanho é o fim do código; sem ele, o campo Tamanho da projeção", () => {
    expect(productSize(xg)).toBe("XG");
    expect(productSize({ ...xg, size: "G" })).toBe("XG");
    expect(productSize({ name: "Camiseta básica M", category: "Camiseta", clientItemCode: "C.0700.001", size: "m" })).toBe("M");
    expect(productTitleWithSize({ name: "Camiseta básica M", category: "Camiseta", clientItemCode: "C.0700.001", size: "m" })).toBe("Camiseta básica · M");
    expect(productSize({ name: "Cabide", category: "", clientCode: "Sem cod. cliente" })).toBeNull();
  });

  it("o gênero continua vindo do nome do título", () => {
    expect(productGender({ ...xg, name: "Polo feminina piquet azul marinho - PP", clientItemCode: "A.01.0805.002.PP" })).toBe("feminino");
    expect(productGender(xg)).toBe("masculino");
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
