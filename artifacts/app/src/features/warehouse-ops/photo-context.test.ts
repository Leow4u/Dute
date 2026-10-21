import { describe, expect, it } from "vitest";
import {
  suggestMannequin,
  photoContextFromRecord,
  isGeneratedPhoto,
} from "./photo-context";

describe("contexto de fotos de produto", () => {
  it("lê o gênero no cadastro e na descrição sem deduzir pelo tamanho", () => {
    expect(suggestMannequin("POLO MASCULINO PIQUET ÍNDIGO P", {}).value).toBe(
      "male",
    );
    expect(suggestMannequin("Camiseta", { gender: "Feminino" }).value).toBe(
      "female",
    );
    expect(suggestMannequin("Camiseta infantil", {}).value).toBe("child");
    expect(suggestMannequin("Camiseta unissex", {}).value).toBe("neutral");
    expect(suggestMannequin("Camiseta", { size: "P" }).value).toBeUndefined();
    expect(
      suggestMannequin("Cesto", { gender: "Outros" }).value,
    ).toBeUndefined();
  });
  it("não preenche silenciosamente quando descrição e cadastro divergem", () => {
    expect(suggestMannequin("Camiseta", { gender: "Masculino/Feminino" })).toEqual({ value: undefined, conflict: true });
    expect(
      suggestMannequin("Camiseta masculina", { gender: "Feminino" }),
    ).toEqual({ value: undefined, conflict: true });
    expect(suggestMannequin("Camiseta masculina ou feminina", {})).toEqual({
      value: undefined,
      conflict: true,
    });
  });
  it("transporta descrição, gênero, grupo, tamanho, cor e marca dos campos históricos", () => {
    expect(
      photoContextFromRecord({
        descricao: "Fio egípcio",
        genero: "Masculino",
        grupo: "VESTUÁRIO",
        tamanho: "M",
        cor: "Índigo",
        marca: "Marca X",
      }),
    ).toEqual({
      description: "Fio egípcio",
      gender: "Masculino",
      group: "VESTUÁRIO",
      size: "M",
      color: "Índigo",
      brand: "Marca X",
    });
    expect(
      isGeneratedPhoto(
        "https://firebasestorage.googleapis.com/v0/b/demo/o/product-photos%2FCliente%2Fgenerated%2Fphoto.png",
      ),
    ).toBe(true);
    expect(isGeneratedPhoto("https://example.test/original.jpg")).toBe(false);
  });
});
