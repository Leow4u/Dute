import { describe, expect, it } from "vitest";

import { aditivoAFazer, execucaoDaOperacao, itensDoAditivoEmTexto } from "./aditivos-da-operacao";
import { pendenciasDoComercial } from "./pendencias";

/**
 * O aditivo pedido pela revisão da Operação (parte 3.10c): a fazer até a RV
 * de aditivo (ou uma recusa) vir depois do pedido, só nas etapas que esperam
 * o Comercial; no orçamento, a execução por linha. Sem valor.
 */

const PEDIDO_EM = "2026-10-22T21:10:00.000Z";

const DEMANDA = {
  numero: "10045",
  customer_code: "ITAU",
  customer_name: "Itaú Unibanco",
  etapa: "execucao_a_orcar",
  aditivos_recusados: [],
  operacao: {
    os_revisadas: ["10045-01", "10045-02"],
    os_em_aberto: [],
    periodo: { de: "2026-10-22", ate: "2026-10-23" },
    itens: [
      { linha: "ln_1", item: "Mesa", unidade: "UN", executado: "64", a_cobrar: "60", absorvido: "0", aditivo: "4" },
      { linha: "ln_2", item: "Cadeira", unidade: "UN", executado: "150.5", a_cobrar: "150.5", absorvido: "0", aditivo: "0" },
    ],
    aditivo: [{ os: "10045-01", linha: "ln_1", lpu_item_id: "lpu_mesa", item: "Mesa", unidade: "UN", quantidade: "4", pedido_em: PEDIDO_EM }],
  },
};

const QUOTE_FECHADA = { tipo_rv: "proposta", status: "enviado", passo_em: "2026-10-10T12:00:00.000Z" };

describe("aditivo a fazer", () => {
  it("o pedido da Operação espera o Comercial", () => {
    expect(aditivoAFazer("10045", DEMANDA, QUOTE_FECHADA)).toEqual({
      numero: "10045",
      cliente: "Itaú Unibanco",
      pedidoEm: PEDIDO_EM,
      itens: [{ item: "Mesa", quantidade: "4", unidade: "UN", os: "10045-01" }],
    });
    expect(itensDoAditivoEmTexto([{ item: "Mesa", quantidade: "4.5", unidade: "UN", os: "x" }])).toBe("+4,5 Mesa");
  });

  it("sai com a RV de aditivo depois do pedido, com a recusa depois dele, ou fora das etapas que esperam", () => {
    expect(aditivoAFazer("10045", DEMANDA, { tipo_rv: "aditivo", status: "rascunho", passo_em: "2026-10-23T09:00:00.000Z" })).toBeNull();
    // A RV de aditivo de antes do pedido não conta.
    expect(aditivoAFazer("10045", DEMANDA, { tipo_rv: "aditivo", status: "enviado", passo_em: "2026-10-01T09:00:00.000Z" })).not.toBeNull();
    expect(aditivoAFazer("10045", { ...DEMANDA, aditivos_recusados: [{ rv: 2, registrada_em: "2026-10-24T10:00:00.000Z" }] }, QUOTE_FECHADA)).toBeNull();
    expect(aditivoAFazer("10045", { ...DEMANDA, etapa: "aguardando_cliente" }, QUOTE_FECHADA)).toBeNull();
    expect(aditivoAFazer("10045", { ...DEMANDA, operacao: { ...DEMANDA.operacao, aditivo: [] } }, QUOTE_FECHADA)).toBeNull();
  });

  it("entra no Início do Comercial para quem abre o Comercial", () => {
    const aditivo = aditivoAFazer("10045", DEMANDA, QUOTE_FECHADA)!;
    const [item] = pendenciasDoComercial({ role: "comercial", aditivos: [aditivo], comercialLiberado: true });
    expect([item.title, item.detail, item.href, item.actionLabel]).toEqual([
      "Aditivo a fazer · 10045",
      "Itaú Unibanco · +4 Mesa · pedido pela Operação 22/10/2026",
      "/comercial/orcamento?numero=10045",
      "Abrir orçamento",
    ]);
    expect(pendenciasDoComercial({ role: "interno", aditivos: [aditivo], comercialLiberado: true })).toEqual([]);
  });
});

describe("a execução da Operação no orçamento", () => {
  it("as OS revisadas, o período e, por linha, o executado, o que se cobra, o absorvido e o aditivo", () => {
    const execucao = execucaoDaOperacao("10045", DEMANDA, QUOTE_FECHADA);
    expect(execucao?.titulo).toBe("OS 10045-01 e 10045-02 revisadas · 22/10 a 23/10");
    expect(execucao?.linhas).toEqual([
      { item: "Mesa", unidade: "un", executado: "64", aCobrar: "60", absorvido: "0", aditivo: "4" },
      { item: "Cadeira", unidade: "un", executado: "150,5", aCobrar: "150,5", absorvido: "0", aditivo: "0" },
    ]);
    expect(execucao?.aditivo?.itens.length).toBe(1);
    expect(JSON.stringify(execucao)).not.toMatch(/preco|cents|R\$/);
  });

  it("antes da primeira OS revisada, nada", () => {
    expect(execucaoDaOperacao("10045", { ...DEMANDA, operacao: { os_revisadas: [] } }, null)).toBeNull();
    expect(execucaoDaOperacao("10045", { etapa: "para_planejar" }, null)).toBeNull();
    expect(execucaoDaOperacao("10045", null, null)).toBeNull();
  });
});
