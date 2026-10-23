import { describe, expect, it } from "vitest";

import { faturaDoFinanceiro, type FaturaDoFinanceiro } from "./faturas";
import { chaveDaRevisao, demonstrativoDaNf, type FontesDoDemonstrativo } from "./nf-documento";

/**
 * A via comercial da NF (parte 4.2d): o valor de cada demanda e o total são
 * os da fatura; as linhas da RV congelada (ou da medição aprovada) mostram de
 * onde ele saiu, com a autorização do cliente. Dados sintéticos.
 */

/** O R$ de formatarReais (lib/dominio) vem com espaço que não quebra. */
const reais = (texto: string) => texto.replace(/R\$ /g, "R$ ");

const FATURA: FaturaDoFinanceiro = faturaDoFinanceiro("fat_000000000000000000001234", {
  customer_code: "ITAU",
  customer_name: "Itaú Unibanco",
  status: "emitida",
  valor_cents: 1_076_500,
  nf: { numero: "1234", serie: "1", emitida_em: "2026-10-20" },
  vencimento: "2026-11-20",
  forma: "boleto",
  observacao: "Depósito na conta 1234-5",
  demandas: [
    { numero: "10045", rv: 2, medicao_id: null, autorizacao_ids: ["aut_itau"], valor_cents: 1_034_000 },
    { numero: "10050", rv: null, medicao_id: "ctr_itau_2026-10", autorizacao_ids: ["aut_ctr_itau_2026-10"], valor_cents: 42_500 },
  ],
})!;

function fontes(extra: Partial<FontesDoDemonstrativo> = {}): FontesDoDemonstrativo {
  return {
    demandas: new Map([
      ["10045", { titulo: "Título de hoje", ref_cliente: "CE0045" }],
      ["10050", { titulo: "Transporte de arquivo", ref_cliente: null }],
    ]),
    revisoes: new Map([
      [
        chaveDaRevisao("10045", 2),
        {
          total_cents: 1_034_000,
          demanda: { titulo: "Desmontagem de mobiliário", ref_cliente: "CE0045" },
          linhas: [
            { id: "l1", origem: "tabela", codigo: "M01", item: "Montador", descricao: "Montador de móveis", unidade: "h", quantidade: "12", preco: "88.50", total_cents: 106_200 },
            { id: "l2", origem: "tabela", codigo: "C02", item: "Caminhão 3/4", descricao: "Caminhão", unidade: "diária", quantidade: "2", preco: "4638.90", total_cents: 927_800 },
          ],
        },
      ],
    ]),
    medicoes: new Map([
      [
        "ctr_itau_2026-10",
        {
          contrato_id: "ctr_itau",
          customer_code: "ITAU",
          competencia: "2026-10",
          status: "aprovada",
          linhas: [
            { id: "m1", demanda_numero: "10050", os: "10050-01", executada_em: "2026-10-05", mercadoria: "Arquivo", itens: [], total_cents: 30_000 },
            { id: "m2", demanda_numero: "10051", os: "10051-01", executada_em: "2026-10-06", itens: [], total_cents: 99_000 },
            { id: "m3", demanda_numero: "10050", os: "10050-02", executada_em: "2026-10-12", itens: [], total_cents: 12_500 },
          ],
        },
      ],
    ]),
    autorizacoes: new Map([
      ["aut_itau", { pedido: "4500000009", aceite: "ACE-1" }],
      ["aut_ctr_itau_2026-10", { tipo: "medicao_aprovada" }],
    ]),
    ...extra,
  };
}

describe("a via comercial da NF", () => {
  it("o valor de cada demanda e o total são os da fatura; as linhas da RV e da medição batem com eles", () => {
    const documento = demonstrativoDaNf(FATURA, fontes());
    expect([documento.titulo, documento.cliente, documento.total, documento.observacao]).toEqual(["NF 1234", "Itaú Unibanco", reais("R$ 10.765,00"), "Depósito na conta 1234-5"]);
    expect(documento.campos).toEqual([
      { rotulo: "Emissão", valor: "20/10/2026" },
      { rotulo: "Vencimento", valor: "20/11/2026" },
      { rotulo: "Forma de pagamento", valor: "Boleto" },
    ]);
    const [rv, medicao] = documento.demandas;
    // A RV congelada guarda a demanda como foi enviada: o título dela vale mais que o de hoje.
    expect([rv.rotulo, rv.titulo, rv.refCliente, rv.autorizacao, rv.total, rv.confere]).toEqual(["10045 – RV02", "Desmontagem de mobiliário", "CE0045", "Pedido 4500000009 · aceite ACE-1", reais("R$ 10.340,00"), true]);
    expect(rv.linhas.map((linha) => [linha.item, linha.unidade, linha.quantidade, linha.valorUnitario, linha.total])).toEqual([
      ["Montador", "h", "12", "88,50", "1.062,00"],
      ["Caminhão 3/4", "diária", "2", "4.638,90", "9.278,00"],
    ]);
    expect([medicao.rotulo, medicao.titulo, medicao.autorizacao, medicao.total, medicao.confere]).toEqual(["10050 · Medição 10/2026", "Transporte de arquivo", null, reais("R$ 425,00"), true]);
    expect(medicao.linhas.map((linha) => [linha.item, linha.total])).toEqual([
      ["OS 10050-01 · executada em 05/10/2026 · Arquivo", "300,00"],
      ["OS 10050-02 · executada em 12/10/2026", "125,00"],
    ]);
  });

  it("sem as linhas (documento que não chegou), a demanda mostra só o valor da fatura e não confere", () => {
    const documento = demonstrativoDaNf(FATURA, fontes({ revisoes: new Map(), medicoes: new Map() }));
    expect(documento.demandas.map((demanda) => [demanda.linhas.length, demanda.total, demanda.confere])).toEqual([
      [0, reais("R$ 10.340,00"), false],
      [0, reais("R$ 425,00"), false],
    ]);
    // O título cai para o da demanda de hoje.
    expect(documento.demandas[0].titulo).toBe("Título de hoje");
    expect(documento.total).toBe(reais("R$ 10.765,00"));
  });

  it("o nome do PDF tem a NF e o cliente, sem caracteres que o sistema de arquivos recusa", () => {
    expect(demonstrativoDaNf(FATURA, fontes()).nomeDoArquivo).toBe("NF 1234 - Itaú Unibanco");
    const comSerie = faturaDoFinanceiro("fat_x", { customer_name: "A/B: Cia", nf: { numero: "77", serie: "2", emitida_em: "2026-10-20" }, vencimento: "2026-11-20", demandas: [] })!;
    expect(demonstrativoDaNf(comSerie, fontes()).nomeDoArquivo).toBe("NF 77 série 2 - A B  Cia");
  });
});
