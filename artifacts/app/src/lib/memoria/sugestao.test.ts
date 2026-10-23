import { describe, expect, it } from "vitest";

import type { LinhaDoSaldo } from "../operacao/demandas";
import type { FormularioDoPlano } from "../operacao/planejar";
import {
  chaveDoPedido,
  decisaoDaSugestao,
  divisaoEmTexto,
  duracaoEmTexto,
  duracaoSugeridaEmTexto,
  itemEmTexto,
  janelaComSugestao,
  minutosDaJanela,
  pedidoDaSugestao,
  planoOtimistaEmTexto,
  respostaDaSugestao,
  somarMinutos,
  type Sugestao,
} from "./sugestao";

/**
 * A duração sugerida no Planejar OS (parte 5.2b): o pedido de cada OS (a
 * equipe dela e as linhas com quantidade), os textos com a base e a decisão
 * da pessoa. Dados sintéticos.
 */

const linha = (id: string, item: string, lpuItemId: string | null): LinhaDoSaldo => ({ id, lpuItemId, item, unidade: "UN", escopo: "100", nasOs: "0", osNumeros: [], saldo: "100" });
const SALDO = [linha("ln_1", "Mesa", "lpu_mesa"), linha("ln_2", "Cadeira", "lpu_cadeira"), linha("ln_3", "Paletes", null)];

const FORM: FormularioDoPlano = {
  ordens: [
    { data: "2026-10-24", inicio: "09:00", fim: "", itens: { ln_1: "12", ln_2: "4,5", ln_3: "2" } },
    { data: "2026-10-25", inicio: "", fim: "", itens: { ln_3: "8" } },
  ],
  equipe: [
    { colaboradorId: "col_a", papel: "lider", ordens: [0, 1] },
    { colaboradorId: "col_b", papel: "montador", ordens: [0] },
  ],
  veiculos: [],
  instrucoes: "",
  contatoOrigem: { nome: "", telefone: "" },
  contatoDestino: { nome: "", telefone: "" },
};

const SUGESTAO: Sugestao = {
  pessoas: 2,
  itens: [
    { lpu_item_id: "lpu_mesa", item: "Mesa", quantidade: "12", minutos: 120, base: { escopo: "cliente", execucoes: 6, homem_minuto_por_unidade: 20, os_recentes: ["10041-01", "10040-01", "10039-01", "10038-01"] } },
    { lpu_item_id: "lpu_cadeira", item: "Cadeira", quantidade: "4.5", minutos: null, base: null },
  ],
  minutos_total: 150,
  completa: false,
  divisao: null,
  plano_otimista: null,
};

describe("o pedido de cada OS", () => {
  it("a equipe da OS e as linhas com quantidade, com o item da tabela; a vírgula vira ponto", () => {
    expect(pedidoDaSugestao(FORM, 0, SALDO, "10045")).toEqual({
      demanda: "10045",
      pessoas: 2,
      itens: [
        { lpu_item_id: "lpu_mesa", item: "Mesa", quantidade: "12" },
        { lpu_item_id: "lpu_cadeira", item: "Cadeira", quantidade: "4.5" },
        { lpu_item_id: null, item: "Paletes", quantidade: "2" },
      ],
    });
  });

  it("sem item da tabela ou sem equipe, não há o que sugerir", () => {
    // A OS 2 só tem o item livre.
    expect(pedidoDaSugestao(FORM, 1, SALDO, "10045")).toBeNull();
    expect(pedidoDaSugestao({ ...FORM, equipe: [] }, 0, SALDO, "10045")).toBeNull();
    expect(pedidoDaSugestao(FORM, 5, SALDO, "10045")).toBeNull();
  });
});

describe("os textos da sugestão", () => {
  it("a duração, o item com a base e as OS de onde veio, o item sem base", () => {
    expect([duracaoEmTexto(45), duracaoEmTexto(120), duracaoEmTexto(150), duracaoEmTexto(185)]).toEqual(["45 min", "2h", "2h30", "3h05"]);
    expect(duracaoSugeridaEmTexto(SUGESTAO)).toBe("Duração sugerida 2h30 com 2 pessoas");
    expect(duracaoSugeridaEmTexto({ ...SUGESTAO, minutos_total: null })).toBeNull();
    expect(itemEmTexto(SUGESTAO.itens[0], 2)).toBe("Mesa · 10 min por unidade com 2 pessoas · 6 execuções do cliente: 10041-01, 10040-01, 10039-01");
    expect(itemEmTexto(SUGESTAO.itens[1], 2)).toBe("Cadeira · sem base");
    const geral = { ...SUGESTAO.itens[0], base: { escopo: "geral" as const, execucoes: 1, homem_minuto_por_unidade: 25, os_recentes: [] } };
    expect(itemEmTexto(geral, 1)).toBe("Mesa · 25 min por unidade com 1 pessoa · 1 execução na média interna");
  });

  it("a divisão acima de 8h e o aviso do plano otimista", () => {
    expect(divisaoEmTexto({ os: 2, minutos_por_os: 300 })).toBe("Passa de 8h: 2 OS de 5h");
    expect(planoOtimistaEmTexto({ escopo: "cliente", execucoes: 6, erro_medio_pct: 22, acima_da_janela: 5 })).toBe("Os planos deste cliente passam da janela em 22%, na média de 6 OS.");
    expect(planoOtimistaEmTexto({ escopo: "geral", execucoes: 30, erro_medio_pct: 18, acima_da_janela: 20 })).toBe("Os planos passam da janela em 18%, na média de 30 OS.");
  });
});

describe("usar a sugestão e a decisão", () => {
  it("usar põe o fim a partir do início, ou do começo do dia; o que passa do dia não entra", () => {
    expect(janelaComSugestao(FORM.ordens[0], 150)).toEqual({ ...FORM.ordens[0], inicio: "09:00", fim: "11:30" });
    expect(janelaComSugestao(FORM.ordens[1], 90)).toEqual({ ...FORM.ordens[1], inicio: "08:00", fim: "09:30" });
    expect(janelaComSugestao({ ...FORM.ordens[0], inicio: "22:00" }, 150)).toBeNull();
    expect([somarMinutos("23:00", 59), somarMinutos("23:00", 60), somarMinutos("9h", 10)]).toEqual(["23:59", null, null]);
    expect([minutosDaJanela("09:00", "11:30"), minutosDaJanela("09:00", ""), minutosDaJanela("11:00", "09:00")]).toEqual([150, null, null]);
  });

  it("ignorou é recusou; usou e manteve o fim é aceitou; o resto, e a decisão de outro pedido, é mudou", () => {
    const pedido = pedidoDaSugestao(FORM, 0, SALDO, "10045")!;
    const chave = chaveDoPedido(pedido);
    expect(decisaoDaSugestao({ chave, usou: null, ignorou: true }, chave, "11:30")).toBe("recusou");
    expect(decisaoDaSugestao({ chave, usou: "11:30", ignorou: false }, chave, "11:30")).toBe("aceitou");
    expect(decisaoDaSugestao({ chave, usou: "11:30", ignorou: false }, chave, "12:00")).toBe("mudou");
    expect(decisaoDaSugestao({ chave: "outro", usou: "11:30", ignorou: false }, chave, "11:30")).toBe("mudou");
    expect(decisaoDaSugestao(undefined, chave, "11:30")).toBe("mudou");
  });

  it("a resposta leva o pedido, a OS salva, a decisão e a janela em minutos", () => {
    const pedido = pedidoDaSugestao(FORM, 0, SALDO, "10045")!;
    const os = { ...FORM.ordens[0], fim: "11:30" };
    expect(respostaDaSugestao(pedido, "10045-01", os, { chave: chaveDoPedido(pedido), usou: "11:30", ignorou: false }, "chave-1")).toEqual({
      idempotency_key: "chave-1",
      ...pedido,
      os: "10045-01",
      decisao: "aceitou",
      minutos_escolhidos: 150,
    });
  });
});
