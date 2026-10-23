import { describe, expect, it } from "vitest";

import { EMISSOR_DO_DOCUMENTO, NOME_DA_DUTELOG, cabecalhoDoEmissor, cnpjValido } from "./emissor";

describe("emissor do documento (parte 6.20)", () => {
  it("CNPJ: os dígitos verificadores fecham, também no alfanumérico", () => {
    // Exemplos fictícios de documentação: 11.222.333/0001-81 e o da Receita para o alfanumérico.
    expect(cnpjValido("11.222.333/0001-81")).toBe(true);
    expect(cnpjValido("11222333000181")).toBe(true);
    expect(cnpjValido("11.222.333/0001-82")).toBe(false);
    expect(cnpjValido("12.ABC.345/01DE-35")).toBe(true);
    expect(cnpjValido("12.ABC.345/01DE-36")).toBe(false);
    expect(cnpjValido("00.000.000/0000-00")).toBe(false);
    expect(cnpjValido("123")).toBe(false);
  });

  it("vazio, o cabeçalho fica com o nome do app e sem linha de CNPJ", () => {
    expect(cabecalhoDoEmissor({ razaoSocial: "", cnpj: "", cidade: "" })).toEqual({ nome: NOME_DA_DUTELOG, linha: null });
  });

  it("preenchido, a razão social e a linha com o CNPJ formatado e a cidade", () => {
    expect(cabecalhoDoEmissor({ razaoSocial: "Empresa Exemplo Ltda.", cnpj: "11222333000181", cidade: "São Paulo/SP" })).toEqual({
      nome: "Empresa Exemplo Ltda.",
      linha: "CNPJ 11.222.333/0001-81 · São Paulo/SP",
    });
    expect(cabecalhoDoEmissor({ razaoSocial: "", cnpj: "", cidade: "São Paulo/SP" }).linha).toBe("São Paulo/SP");
  });

  it("o emissor gravado no código, quando preenchido, tem CNPJ válido e razão social", () => {
    if (!EMISSOR_DO_DOCUMENTO.cnpj) return;
    expect(cnpjValido(EMISSOR_DO_DOCUMENTO.cnpj)).toBe(true);
    expect(EMISSOR_DO_DOCUMENTO.razaoSocial.trim()).not.toBe("");
  });
});
