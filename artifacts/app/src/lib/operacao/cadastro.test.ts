import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  CATEGORIAS_CNH,
  DONOS_DE_VEICULO,
  PAPEIS_DE_CAMPO,
  VINCULOS,
  colaboradorDaLeitura,
  emailDoAppNaAlteracao,
  formatarCpf,
  formatarPlaca,
  porNome,
  veiculoDaLeitura,
} from "./cadastro";

const FONTE_DA_CALLABLE = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../functions/operacao/src/domain/cadastro.ts"),
  "utf8",
);

function listaDaCallable(nome: string): string[] {
  const match = FONTE_DA_CALLABLE.match(new RegExp(`${nome} = \\[([^\\]]*)\\]`));
  expect(match, nome).not.toBeNull();
  return [...match![1].matchAll(/"([^"]+)"/g)].map((item) => item[1]);
}

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

  it("as categorias de CNH, os vínculos, os papéis e os donos são os da callable", () => {
    expect(listaDaCallable("CATEGORIAS_CNH")).toEqual([...CATEGORIAS_CNH]);
    expect(listaDaCallable("VINCULOS")).toEqual([...VINCULOS]);
    expect(listaDaCallable("PAPEIS_DE_CAMPO")).toEqual([...PAPEIS_DE_CAMPO]);
    expect(listaDaCallable("DONOS_DE_VEICULO")).toEqual([...DONOS_DE_VEICULO]);
  });
});

describe("vínculo, papéis e login do app (parte 3.4a)", () => {
  const BASE = { nome: "Ana Souza", funcao: "Motorista", cpf: "52998224725", ativo: true, edicao: 1 };

  it("documento de antes da parte 3.4 é lido como equipe própria, sem papel e fora do app", () => {
    const ana = colaboradorDaLeitura("col_aaaaaaaaaaaaaaaa", BASE);
    expect(ana).toMatchObject({ vinculo: "proprio", empresa: "", papeis: [], usuarioEmail: "", noApp: false });
    const van = veiculoDaLeitura("vei_aaaaaaaaaaaaaaaa", { placa: "ABC1D23", tipo: "VUC", capacidade_kg: 1, capacidade_m3: 1, ativo: true, edicao: 1 });
    expect(van).toMatchObject({ dono: "proprio", empresa: "", revisaoEm: "" });
  });

  it("lê os campos novos e ignora valor fora da lista", () => {
    const bruno = colaboradorDaLeitura("col_bbbbbbbbbbbbbbbb", {
      ...BASE,
      vinculo: "terceiro",
      empresa: "Rota Sul",
      papeis: ["montador", "chefe", "lider"],
      usuario_email: "bruno@rotasul.com.br",
      usuario_uid: "uid-bruno",
    });
    expect(bruno).toMatchObject({ vinculo: "terceiro", empresa: "Rota Sul", papeis: ["lider", "montador"], usuarioEmail: "bruno@rotasul.com.br", noApp: true });
    expect(colaboradorDaLeitura("col_cccccccccccccccc", { ...BASE, vinculo: "socio" })?.vinculo).toBe("proprio");
    const caminhao = veiculoDaLeitura("vei_bbbbbbbbbbbbbbbb", {
      placa: "XYZ9A87", tipo: "Truck", capacidade_kg: 1, capacidade_m3: 1, ativo: true, edicao: 1,
      dono: "terceiro", empresa: "Frota Leste", revisao_em: "2026-12-10",
    });
    expect(caminhao).toMatchObject({ dono: "terceiro", empresa: "Frota Leste", revisaoEm: "2026-12-10" });
  });

  it("o e-mail do app só vai na alteração quando muda", () => {
    expect(emailDoAppNaAlteracao("ana@dutelog.com.br", " Ana@Dutelog.com.br ")).toEqual({});
    expect(emailDoAppNaAlteracao("", "")).toEqual({});
    expect(emailDoAppNaAlteracao("", "ana@dutelog.com.br")).toEqual({ usuario_email: "ana@dutelog.com.br" });
    expect(emailDoAppNaAlteracao("ana@dutelog.com.br", "")).toEqual({ usuario_email: null });
    expect(emailDoAppNaAlteracao("ana@dutelog.com.br", "bia@dutelog.com.br")).toEqual({ usuario_email: "bia@dutelog.com.br" });
  });
});
