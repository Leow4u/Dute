import { describe, expect, it } from "vitest";

import { formDaTabela, payloadDaTabela, problemasDaTabela, type FormDaTabela } from "./tabela-do-contrato";

function preenchido(mudancas: Partial<FormDaTabela> = {}): FormDaTabela {
  return {
    ...formDaTabela(),
    nome: "Serviços 2026",
    codigo: "LPU-2026",
    itens: [{ chave: "1", codigo: "3.05", descricao: "Transporte de cadeira", unidade: "UN", preco: "1.234,5678" }],
    ...mudancas,
  };
}

describe("tabela de preço do contrato", () => {
  it("envia os itens com código e preço decimal exato, e deixa a vigência opcional", () => {
    expect(payloadDaTabela("ct_itau", preenchido(), "intencao-1")).toEqual({
      contrato_id: "ct_itau",
      idempotency_key: "intencao-1",
      nome: "Serviços 2026",
      codigo: "LPU-2026",
      variante: "Comercial",
      vigente_de: null,
      vigente_ate: null,
      itens: [{ codigo: "3.05", descricao: "Transporte de cadeira", unidade: "UN", preco: "1234.5678" }],
    });
    expect(problemasDaTabela(preenchido())).toEqual([]);
  });

  it("recusa preço negativo, excesso de casas e campos de item ausentes", () => {
    const base = preenchido();
    const problemas = (preco: string) => problemasDaTabela({ ...base, itens: [{ ...base.itens[0], preco }] });
    expect(problemas("-0,01")).toContain("Item 1: informe um preço a partir de zero, com até 4 casas decimais.");
    expect(problemas("1,12345")).toContain("Item 1: informe um preço a partir de zero, com até 4 casas decimais.");
    expect(problemas("0")).toEqual([]);
    expect(problemasDaTabela(formDaTabela())).toEqual(expect.arrayContaining(["Informe o nome da tabela.", "Item 1: informe o código, a descrição e a unidade."]));
  });

  it("confere as datas opcionais e não perde precisão ao preparar o pedido", () => {
    expect(problemasDaTabela(preenchido({ vigenteDe: "2026-02-30" }))).toContain("Informe uma data de início válida.");
    expect(problemasDaTabela(preenchido({ vigenteDe: "2026-11-01", vigenteAte: "2026-10-31" }))).toContain("O fim da vigência deve ser igual ou posterior ao início.");
    const form = preenchido({ codigo: "  ", vigenteAte: "2027-01-31" });
    expect(payloadDaTabela("ct", form, "chave")).toMatchObject({ codigo: null, vigente_de: null, vigente_ate: "2027-01-31" });
  });
});
