import { describe, expect, it } from "vitest";

import {
  clientesDoPeriodo,
  doCliente,
  filtroInicial,
  inicioDaSemana,
  linhasDaPlanilha,
  noPrazo,
  osDoRelatorio,
  problemaDoFiltro,
  resumoDasOs,
  solicitacaoDoRelatorio,
  tabelaDaEquipe,
  tabelaDasSolicitacoes,
  tabelaDosVeiculos,
  tabelaPorCliente,
  tabelaPorPeriodo,
  tabelaPorServico,
  type OsDoRelatorio,
} from "./relatorios";

/** Os relatórios da Operação (parte 4.8a): as regras, sem valor. Dados sintéticos. */

const os = (numero: string, extra: Record<string, unknown> = {}) =>
  osDoRelatorio(numero, {
    numero,
    customer_code: "ITAU",
    cliente_nome: "Itaú Unibanco",
    status: "revisada",
    tipo: "servico",
    servicos: ["transporte", "montagem"],
    janela: { data: "2026-10-06", inicio: "08:00", fim: "12:00" },
    conclusao: { instante: "2026-10-06T14:30:00.000Z" }, // 11:30 em São Paulo
    equipe: [{ colaborador_id: "col_ana", nome: "Ana Lima" }],
    veiculos: [{ veiculo_id: "vei_van", placa: "ABC1D23" }],
    // A OS não tem valor; mesmo que viesse um, o relatório não lê.
    valor_cents: 99999,
    ...extra,
  })!;

const OSS: OsDoRelatorio[] = [
  os("10050-01"),
  os("10050-02", { janela: { data: "2026-10-07", fim: "10:00" }, conclusao: { instante: "2026-10-07T14:00:00.000Z" } }), // 11:00, depois do fim
  os("10051-01", { customer_code: "SAFRA", cliente_nome: "Banco Safra", servicos: ["transporte"], janela: { data: "2026-10-13" }, conclusao: { instante: "2026-10-14T12:00:00.000Z" }, equipe: [{ colaborador_id: "col_bruno", nome: "Bruno Teixeira" }, { colaborador_id: "col_ana", nome: "Ana Lima" }] }),
  os("10052-01", { status: "cancelada", conclusao: null, janela: { data: "2026-10-14" }, veiculos: [] }),
  os("10053-01", { status: "agendada", conclusao: null, tipo: "vistoria", servicos: ["vistoria"], janela: { data: "2026-10-15" } }),
];

describe("a OS no relatório", () => {
  it("lê o dia agendado, o fim, a conclusão, a equipe e os veículos; sem o dia, fica de fora", () => {
    expect(OSS[0]).toEqual({
      numero: "10050-01",
      customerCode: "ITAU",
      cliente: "Itaú Unibanco",
      status: "revisada",
      tipo: "servico",
      servicos: ["transporte", "montagem"],
      data: "2026-10-06",
      fim: "12:00",
      concluidaEm: "2026-10-06T14:30:00.000Z",
      equipe: [{ id: "col_ana", nome: "Ana Lima" }],
      veiculos: [{ id: "vei_van", placa: "ABC1D23" }],
    });
    expect(osDoRelatorio("x", { janela: null })).toBeNull();
    expect(JSON.stringify(OSS)).not.toContain("99999");
  });

  it("no prazo: até o dia agendado e, com o fim da janela, até ele; null na não concluída", () => {
    expect(noPrazo(OSS[0])).toBe(true);
    expect(noPrazo(OSS[1])).toBe(false);
    expect(noPrazo(OSS[2])).toBe(false);
    expect(noPrazo({ ...OSS[2], concluidaEm: "2026-10-12T20:00:00.000Z" })).toBe(true);
    expect(noPrazo(OSS[3])).toBeNull();
    expect(noPrazo(OSS[4])).toBeNull();
    // Reaberta: volta à execução e não conta, mesmo com a conclusão de antes.
    expect(noPrazo({ ...OSS[0], status: "em_execucao" })).toBeNull();
  });

  it("o resumo: as OS, as concluídas, as canceladas e a parte no prazo", () => {
    expect(resumoDasOs(OSS)).toEqual({ total: 5, concluidas: 3, canceladas: 1, noPrazo: 33 });
    expect(resumoDasOs([])).toEqual({ total: 0, concluidas: 0, canceladas: 0, noPrazo: null });
  });
});

describe("as tabelas", () => {
  it("por semana, de segunda a domingo, com o total", () => {
    expect(inicioDaSemana("2026-10-07")).toBe("2026-10-05");
    expect(inicioDaSemana("2026-10-05")).toBe("2026-10-05");
    expect(inicioDaSemana("2026-10-11")).toBe("2026-10-05");
    const tabela = tabelaPorPeriodo(OSS, "semana");
    expect(tabela.colunas).toEqual(["Semana", "OS", "Concluídas", "Canceladas", "No prazo (%)"]);
    expect(tabela.linhas.map((linha) => linha.celulas)).toEqual([
      ["05/10 – 11/10", 2, 2, 0, 50],
      ["12/10 – 18/10", 3, 1, 1, 0],
    ]);
    expect(tabela.total).toEqual(["Total", 5, 3, 1, 33]);
  });

  it("por mês", () => {
    expect(tabelaPorPeriodo(OSS, "mes").linhas.map((linha) => linha.celulas[0])).toEqual(["out/2026"]);
  });

  it("por cliente, do maior para o menor", () => {
    expect(tabelaPorCliente(OSS).linhas.map((linha) => linha.celulas)).toEqual([
      ["Itaú Unibanco", 4, 2, 1, 50],
      ["Banco Safra", 1, 1, 0, 0],
    ]);
  });

  it("por serviço: a OS com dois serviços conta nos dois; a vistoria é o serviço dela", () => {
    expect(tabelaPorServico(OSS).linhas.map((linha) => [linha.celulas[0], linha.celulas[1]])).toEqual([
      ["Transporte", 4],
      ["Montagem", 3],
      ["Vistoria", 1],
    ]);
  });

  it("a equipe: as OS de cada pessoa escalada, as concluídas e no prazo", () => {
    expect(tabelaDaEquipe(OSS).linhas.map((linha) => linha.celulas)).toEqual([
      ["Ana Lima", 5, 3, 33],
      ["Bruno Teixeira", 1, 1, 0],
    ]);
  });

  it("os veículos: as OS, os dias em uso e as concluídas", () => {
    expect(tabelaDosVeiculos(OSS).linhas.map((linha) => linha.celulas)).toEqual([["ABC1D23", 4, 4, 3]]);
  });

  it("as solicitações do portal por cliente", () => {
    const solicitacoes = [
      solicitacaoDoRelatorio("sol_1", { status: "aceita", customer_code: "ITAU", customer_name: "Itaú Unibanco", recebida_em: "2026-10-06T12:00:00.000Z" })!,
      solicitacaoDoRelatorio("sol_2", { status: "recebida", customer_code: "ITAU", customer_name: "Itaú Unibanco", recebida_em: "2026-10-07T12:00:00.000Z" })!,
      solicitacaoDoRelatorio("sol_3", { status: "recusada", customer_code: "SAFRA", customer_name: "Banco Safra", recebida_em: "2026-10-08T12:00:00.000Z" })!,
    ];
    expect(solicitacaoDoRelatorio("x", { status: "outra", recebida_em: "2026-10-06T12:00:00.000Z" })).toBeNull();
    const tabela = tabelaDasSolicitacoes(solicitacoes);
    expect(tabela.colunas).toEqual(["Cliente", "Recebidas", "Viraram demanda", "Recusadas", "Em aberto"]);
    expect(tabela.linhas.map((linha) => linha.celulas)).toEqual([
      ["Itaú Unibanco", 2, 1, 0, 1],
      ["Banco Safra", 1, 0, 1, 0],
    ]);
    expect(tabela.total).toEqual(["Total", 3, 1, 1, 1]);
    expect(clientesDoPeriodo(OSS, solicitacoes)).toEqual([
      { code: "SAFRA", nome: "Banco Safra" },
      { code: "ITAU", nome: "Itaú Unibanco" },
    ]);
  });

  it("a planilha leva as linhas e o total, com os números como número", () => {
    expect(linhasDaPlanilha(tabelaPorCliente(OSS)).at(-1)).toEqual(["Total", 5, 3, 1, 33]);
    expect(linhasDaPlanilha(tabelaPorServico([OSS[3]]))).toEqual([["Montagem", 1, 0, 1, null], ["Transporte", 1, 0, 1, null]]);
  });
});

describe("o filtro", () => {
  it("começa nas últimas quatro semanas, por semana, com todos os clientes", () => {
    expect(filtroInicial("2026-10-23")).toEqual({ de: "2026-09-26", ate: "2026-10-23", cliente: null, agrupamento: "semana" });
  });

  it("o período é obrigatório, em ordem e de até um ano", () => {
    expect(problemaDoFiltro({ de: "2026-10-01", ate: "2026-10-23" })).toBeNull();
    expect(problemaDoFiltro({ de: "", ate: "2026-10-23" })).toBe("Informe o período.");
    expect(problemaDoFiltro({ de: "2026-10-24", ate: "2026-10-23" })).toBe("O início vem antes do fim.");
    expect(problemaDoFiltro({ de: "2025-10-01", ate: "2026-10-23" })).toBe("Use um período de até um ano.");
  });

  it("o cliente escolhido filtra as OS", () => {
    expect(doCliente(OSS, "SAFRA").map((item) => item.numero)).toEqual(["10051-01"]);
    expect(doCliente(OSS, null)).toHaveLength(5);
  });
});
