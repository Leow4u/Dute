import { describe, expect, it } from "vitest";

import { compareVariants, displayName, groupFamilies, splitVariant, variantLabel } from "./stock-variants";

describe("variação no fim do código", () => {
  it.each([
    ["A.01.0594.005.P", { base: "A.01.0594.005", variant: "P" }],
    ["A.02.0809.002.GG", { base: "A.02.0809.002", variant: "GG" }],
    ["C.0659.001.U", { base: "C.0659.001", variant: "U" }],
    ["J.0149.003.N3", { base: "J.0149.003", variant: "N3" }],
  ])("%s", (code, expected) => {
    expect(splitVariant(code)).toEqual(expected);
  });

  it("código fora do padrão não tem variação", () => {
    expect(splitVariant("SKU123")).toBeNull();
    expect(splitVariant("A.01")).toBeNull();
    expect(splitVariant("A.01.0594.LONGO-DEMAIS")).toBeNull();
    expect(splitVariant(undefined)).toBeNull();
  });
});

describe("ordem dos tamanhos", () => {
  it("PP, P, M, G, GG e números em ordem natural", () => {
    expect(["G", "P", "GG", "M", "PP"].sort(compareVariants)).toEqual(["PP", "P", "M", "G", "GG"]);
    expect(["N3", "N1", "N10"].sort(compareVariants)).toEqual(["N1", "N3", "N10"]);
    expect(variantLabel("U")).toBe("Único");
  });
});

describe("agrupar em cards", () => {
  const items = [
    { key: "1", code: "A.01.0594.005.M" },
    { key: "2", code: "C.0659.001.U" },
    { key: "3", code: "A.01.0594.005.P" },
    { key: "4", code: "SKU-SOLTO" },
  ];

  it("junta pela base, na ordem em que aparecem, tamanhos em ordem", () => {
    const families = groupFamilies(items, (item) => item.code, (item) => item.key);
    expect(families.map((family) => family.variants.map((entry) => entry.item.key))).toEqual([["3", "1"], ["2"], ["4"]]);
    expect(families[0]).toMatchObject({ key: "familia:A.01.0594.005", base: "A.01.0594.005" });
    expect(families[2].variants[0].variant).toBeNull();
  });

  it("desligado, cada item é um card", () => {
    const families = groupFamilies(items, (item) => item.code, (item) => item.key, false);
    expect(families.map((family) => family.key)).toEqual(["1", "2", "3", "4"]);
  });
});

describe("nome do produto", () => {
  it("tira a caixa alta, mantém o que já está escrito", () => {
    expect(displayName("POLO PIQUET MESCLA")).toBe("Polo piquet mescla");
    expect(displayName("Caneca térmica 500 ml")).toBe("Caneca térmica 500 ml");
    expect(displayName("SACOLA BTG - QUADRICULADA")).toBe("Sacola BTG - quadriculada");
    expect(displayName("CANECA TERMICA 500 ML")).toBe("Caneca termica 500 ml");
    expect(displayName("TOALHA DE ACADEMIA")).toBe("Toalha de academia");
  });
});
