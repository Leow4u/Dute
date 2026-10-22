import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { CATEGORIAS_CNH, colaboradorDaLeitura, formatarCpf, formatarPlaca, porNome, veiculoDaLeitura } from "./cadastro";

describe("texto do cadastro", () => {
  it("formata CPF, placa e ordena ativo primeiro", () => {
    expect(formatarCpf("52998224725")).toBe("529.982.247-25");
    expect(formatarPlaca("ABC1D23")).toBe("ABC-1D23");
    expect(formatarPlaca("abc1234")).toBe("ABC-1234");
    const ana = colaboradorDaLeitura("col_aaaaaaaaaaaaaaaa", {
      nome: "Ana Souza",
      funcao: "Motorista",
      cpf: "52998224725",
      telefone: "11987654321",
      cnh: { categoria: "C", validade: "2028-04-01" },
      ativo: true,
      edicao: 1,
    });
    expect(ana?.cnh).toBe("C · 01/04/2028");
    expect(ana?.cpf).toBe("529.982.247-25");
    const parado = colaboradorDaLeitura("col_bbbbbbbbbbbbbbbb", {
      nome: "Bruno",
      funcao: "Ajudante",
      cpf: "39053344705",
      ativo: false,
      edicao: 2,
    });
    expect(porNome([parado!, ana!]).map((item) => item.nome)).toEqual(["Ana Souza", "Bruno"]);
  });

  it("ignora documento sem os campos do cadastro e lê o veículo", () => {
    expect(colaboradorDaLeitura("x", { nome: "Ana" })).toBeNull();
    expect(veiculoDaLeitura("vei_aaaaaaaaaaaaaaaa", {
      placa: "ABC1D23",
      tipo: "VUC",
      modelo: "Daily",
      capacidade_kg: 3500,
      capacidade_m3: 12.5,
      ativo: true,
      edicao: 1,
    })?.resumo).toBe("Daily · 3500 kg · 12.5 m³");
  });

  it("as categorias de CNH são as da callable", () => {
    const source = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../functions/operacao/src/domain/cadastro.ts"),
      "utf8",
    );
    const match = source.match(/CATEGORIAS_CNH = \[([^\]]*)\]/);
    expect(match).not.toBeNull();
    const lista = [...match![1].matchAll(/"([^"]+)"/g)].map((item) => item[1]);
    expect(lista).toEqual([...CATEGORIAS_CNH]);
  });
});
