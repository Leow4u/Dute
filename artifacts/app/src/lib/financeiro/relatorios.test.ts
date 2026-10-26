import { describe, expect, it } from "vitest";

import { faturaDoFinanceiro, pagamentoDaNf, type FaturaDoFinanceiro } from "./faturas";
import {
  clientesDasFaturas,
  faixaDeAtraso,
  filtroInicialDoFinanceiro,
  fontesDoRateio,
  linhasDaPlanilhaDoFinanceiro,
  nfsDoPeriodo,
  nfsEmAberto,
  pagamentosDoPeriodo,
  problemaDoFiltroDoFinanceiro,
  ratear,
  receitaPorServico,
  relatorioDoFinanceiroDaBusca,
  resumoAReceber,
  resumoDaReceita,
  resumoDaReceitaPorServico,
  resumoDoFaturamento,
  servicosDaNf,
  tabelaAReceber,
  tabelaDaReceita,
  tabelaDaReceitaPorServico,
  tabelaDoFaturamento,
  type FontesDoRateio,
} from "./relatorios";

/** Os relatórios do Financeiro (parte 4.8b): a receita, as NFs por mês e as contas a receber. Dados sintéticos. */

const HOJE = "2026-10-23";
/** O real da plataforma separa o símbolo com espaço que não quebra; aqui, o espaço comum. */
const sem = (valor: string) => valor.replace(/\u00a0/g, " ");

const nf = (numero: string, extra: Record<string, unknown> = {}): FaturaDoFinanceiro =>
  faturaDoFinanceiro(`fat_${numero.padStart(24, "0")}`, {
    customer_code: "ITAU",
    customer_name: "Itaú Unibanco",
    status: "emitida",
    valor_cents: 1_000_000,
    recebido_cents: 0,
    nf: { numero, serie: "1", emitida_em: "2026-10-01" },
    vencimento: "2026-10-31",
    forma: "boleto",
    demandas: [],
    ...extra,
  })!;

const FATURAS = [
  nf("1001"),
  nf("1002", { valor_cents: 500_000, recebido_cents: 200_000, nf: { numero: "1002", emitida_em: "2026-09-10" }, vencimento: "2026-10-10" }), // 13 dias de atraso
  nf("1003", { customer_code: "SAFRA", customer_name: "Banco Safra", valor_cents: 300_000, nf: { numero: "1003", emitida_em: "2026-08-01" }, vencimento: "2026-07-01" }), // 114 dias
  nf("1004", { status: "paga", recebido_cents: 1_000_000, nf: { numero: "1004", emitida_em: "2026-10-05" } }),
  nf("1005", { status: "cancelada", nf: { numero: "1005", emitida_em: "2026-10-06" } }),
];

const pagamento = (id: string, extra: Record<string, unknown>) => pagamentoDaNf(`pag_${id.padStart(24, "0")}`, { fatura_id: FATURAS[0].id, forma: "pix", ...extra })!;

const PAGAMENTOS = [
  pagamento("1", { customer_code: "ITAU", valor_cents: 1_000_000, recebido_em: "2026-10-05" }),
  pagamento("2", { customer_code: "ITAU", valor_cents: 200_000, recebido_em: "2026-10-12" }),
  pagamento("3", { customer_code: "SAFRA", valor_cents: 50_000, recebido_em: "2026-10-15", status: "estornado", estornado: { motivo: "Duplicado" } }),
  pagamento("4", { customer_code: "SAFRA", valor_cents: 90_000, recebido_em: "2026-07-15" }),
];

describe("a receita por serviço (pergunta 26)", () => {
  // A NF A: a demanda 10045 (RV 2: transporte, montagem e um desconto), a 10046 sem orçamento e a armazenagem de setembro.
  const NF_A = nf("2001", {
    valor_cents: 1_000_000,
    demandas: [
      { numero: "10045", valor_cents: 600_000, rv: 2 },
      { numero: "10046", valor_cents: 100_000, rv: null },
    ],
    armazenagem: [{ competencia: "2026-09", valor_cents: 300_000 }],
  });
  // A NF B: a demanda 10050, faturada pela medição de outubro.
  const NF_B = nf("2002", { valor_cents: 200_000, demandas: [{ numero: "10050", valor_cents: 200_000, rv: null, medicao_id: "ct_1_2026-10" }] });
  const FONTES: FontesDoRateio = {
    revisoes: new Map([
      [
        "10045:2",
        {
          linhas: [
            { id: "l1", origem: "tabela", item: "Cadeira", servico: "Transporte", total_cents: 400_000 },
            { id: "l2", origem: "tabela", item: "Mesa", servico: "Montagem", total_cents: 300_000 },
            { id: "l3", origem: "ajuste", item: "Desconto", servico: null, total_cents: -100_000 },
          ],
        },
      ],
    ]),
    medicoes: new Map([
      [
        "ct_1_2026-10",
        {
          contrato_id: "ct_1",
          competencia: "2026-10",
          status: "aprovada",
          linhas: [
            { id: "m1", demanda_numero: "10050", total_cents: 200_000, itens: [{ lpu_item_id: "lpu_icamento", item: "Içamento", total_cents: 150_000 }, { lpu_item_id: null, item: "Avulso", total_cents: 50_000 }] },
            { id: "m2", demanda_numero: "10051", total_cents: 90_000, itens: [{ lpu_item_id: "lpu_icamento", item: "Içamento", total_cents: 90_000 }] },
          ],
        },
      ],
    ]),
    servicoDoItem: new Map([["lpu_icamento", "Içamento"]]),
  };
  const PAGOS = [
    pagamento("21", { fatura_id: NF_A.id, customer_code: "ITAU", valor_cents: 1_000_000, recebido_em: "2026-10-05" }),
    pagamento("22", { fatura_id: NF_A.id, customer_code: "ITAU", valor_cents: 500_000, recebido_em: "2026-10-06" }),
    pagamento("23", { fatura_id: NF_B.id, customer_code: "ITAU", valor_cents: 200_000, recebido_em: "2026-10-07" }),
  ];

  it("lê a RV faturada de cada demanda, ou a medição dela; a demanda sem RV não pede nada", () => {
    expect(fontesDoRateio([NF_A, NF_B, NF_A])).toEqual([
      { chave: "10045:2", caminho: "quotes/10045/revisoes/2", tipo: "revisoes" },
      { chave: "ct_1_2026-10", caminho: "medicoes/ct_1_2026-10", tipo: "medicoes" },
    ]);
  });

  it("o peso de cada serviço na NF: a armazenagem, as linhas do orçamento (o desconto espalhado) e o que não tem orçamento", () => {
    const pesos = servicosDaNf(NF_A, FONTES);
    expect([...pesos.keys()]).toEqual(["Armazenagem", "Transporte", "Montagem", "Sem orçamento"]);
    expect(pesos.get("Armazenagem")).toBe(300_000);
    expect(pesos.get("Sem orçamento")).toBe(100_000);
    expect(Math.round(pesos.get("Transporte")! + pesos.get("Montagem")!)).toBe(600_000);
    // Na medição, o serviço do item do catálogo; o item sem catálogo fica "Sem serviço"; a outra demanda da medição, de fora.
    expect(servicosDaNf(NF_B, FONTES)).toEqual(new Map([["Içamento", 150_000], ["Sem serviço", 50_000]]));
  });

  it("o rateio em centavos fecha o valor: o que sobra do arredondamento vai aos maiores restos", () => {
    expect(ratear(100, new Map([["A", 1], ["B", 1], ["C", 1]]))).toEqual(new Map([["A", 34], ["B", 33], ["C", 33]]));
    expect(ratear(100, new Map())).toEqual(new Map([["Sem orçamento", 100]]));
  });

  it("cada pagamento rateado pelos serviços da NF dele; a tabela, a participação e os números", () => {
    const linhas = receitaPorServico(PAGOS, [NF_A, NF_B], FONTES);
    expect(linhas.map((linha) => [linha.servico, linha.cents, linha.pagamentos])).toEqual([
      ["Transporte", 514_286, 2],
      ["Armazenagem", 450_000, 2],
      ["Montagem", 385_714, 2],
      ["Içamento", 150_000, 1],
      ["Sem orçamento", 150_000, 2],
      ["Sem serviço", 50_000, 1],
    ]);
    expect(linhas.reduce((soma, linha) => soma + linha.cents, 0)).toBe(1_700_000);
    const tabela = tabelaDaReceitaPorServico(linhas, PAGOS.length);
    expect(tabela.colunas).toEqual(["Serviço", "Pagamentos", "Recebido", "Participação (%)"]);
    expect(tabela.linhas[0].celulas).toEqual(["Transporte", 2, { reais: 514_286 }, 30]);
    expect(tabela.total).toEqual(["Total", 3, { reais: 1_700_000 }, 100]);
    expect(resumoDaReceitaPorServico(linhas, PAGOS.length).map((numero) => [numero.rotulo, sem(numero.valor)])).toEqual([
      ["Recebido", "R$ 17.000,00"],
      ["Serviços", "4"],
      ["Pagamentos", "3"],
      ["Sem orçamento", "R$ 1.500,00"],
    ]);
    expect(relatorioDoFinanceiroDaBusca("?relatorio=servico")).toBe("servico");
  });

  it("a NF que não se leu vai inteira para Sem orçamento; sem pagamento, a tabela fica vazia", () => {
    expect(receitaPorServico([PAGOS[0]], [], FONTES).map((linha) => [linha.servico, linha.cents])).toEqual([["Sem orçamento", 1_000_000]]);
    expect(tabelaDaReceitaPorServico([], 0)).toEqual({ colunas: ["Serviço", "Pagamentos", "Recebido", "Participação (%)"], linhas: [], total: null });
  });
});

describe("a receita por cliente", () => {
  it("os pagamentos do período, sem os estornados, por cliente, com o total em reais", () => {
    const validos = pagamentosDoPeriodo(PAGAMENTOS, "2026-10-01", "2026-10-23");
    expect(validos.map((item) => item.valorCents)).toEqual([1_000_000, 200_000]);
    const tabela = tabelaDaReceita(validos, new Map([["ITAU", "Itaú Unibanco"]]));
    expect(tabela.colunas).toEqual(["Cliente", "Pagamentos", "Recebido"]);
    expect(tabela.linhas.map((linha) => linha.celulas)).toEqual([["Itaú Unibanco", 2, { reais: 1_200_000 }]]);
    expect(tabela.total).toEqual(["Total", 2, { reais: 1_200_000 }]);
    expect(resumoDaReceita(validos, 1).map((item) => ({ ...item, valor: sem(item.valor) }))).toEqual([
      { rotulo: "Recebido", valor: "R$ 12.000,00" },
      { rotulo: "Pagamentos", valor: "2" },
      { rotulo: "Clientes", valor: "1" },
      { rotulo: "Estornos", valor: "1" },
    ]);
  });
});

describe("as NFs emitidas por mês", () => {
  it("pela emissão no período, sem as canceladas, com o emitido, o recebido e o saldo", () => {
    const nfs = nfsDoPeriodo(FATURAS, "2026-09-01", "2026-10-23");
    expect(nfs.map((item) => item.nf.numero)).toEqual(["1001", "1002", "1004"]);
    const tabela = tabelaDoFaturamento(nfs);
    expect(tabela.colunas).toEqual(["Mês", "NFs", "Emitido", "Recebido", "Saldo"]);
    expect(tabela.linhas.map((linha) => linha.celulas)).toEqual([
      ["set/2026", 1, { reais: 500_000 }, { reais: 200_000 }, { reais: 300_000 }],
      ["out/2026", 2, { reais: 2_000_000 }, { reais: 1_000_000 }, { reais: 1_000_000 }],
    ]);
    expect(resumoDoFaturamento(nfs).map((item) => sem(item.valor))).toEqual(["3", "R$ 25.000,00", "R$ 12.000,00", "R$ 13.000,00"]);
  });
});

describe("as contas a receber", () => {
  it("a faixa pelo vencimento: a vencer até o dia; depois, pelos dias de atraso", () => {
    expect(faixaDeAtraso("2026-10-23", HOJE)).toBe("a_vencer");
    expect(faixaDeAtraso("2026-10-22", HOJE)).toBe("ate_30");
    expect(faixaDeAtraso("2026-09-23", HOJE)).toBe("ate_30");
    expect(faixaDeAtraso("2026-09-22", HOJE)).toBe("ate_60");
    expect(faixaDeAtraso("2026-07-25", HOJE)).toBe("ate_90");
    expect(faixaDeAtraso("2026-07-24", HOJE)).toBe("mais_de_90");
  });

  it("só as NFs com saldo, por cliente e faixa, com o total", () => {
    const abertas = nfsEmAberto(FATURAS);
    expect(abertas.map((item) => item.nf.numero)).toEqual(["1001", "1002", "1003"]);
    const tabela = tabelaAReceber(abertas, HOJE);
    expect(tabela.colunas).toEqual(["Cliente", "A vencer", "1 a 30 dias", "31 a 60 dias", "61 a 90 dias", "Mais de 90 dias", "Total"]);
    expect(tabela.linhas.map((linha) => linha.celulas)).toEqual([
      ["Itaú Unibanco", { reais: 1_000_000 }, { reais: 300_000 }, { reais: 0 }, { reais: 0 }, { reais: 0 }, { reais: 1_300_000 }],
      ["Banco Safra", { reais: 0 }, { reais: 0 }, { reais: 0 }, { reais: 0 }, { reais: 300_000 }, { reais: 300_000 }],
    ]);
    expect(tabela.total).toEqual(["Total", { reais: 1_000_000 }, { reais: 300_000 }, { reais: 0 }, { reais: 0 }, { reais: 300_000 }, { reais: 1_600_000 }]);
    expect(resumoAReceber(abertas, HOJE).map((item) => sem(item.valor))).toEqual(["R$ 16.000,00", "R$ 10.000,00", "R$ 6.000,00", "3"]);
  });
});

describe("o filtro e a planilha", () => {
  it("o relatório pela busca; o período começa dois meses atrás; a posição não tem período", () => {
    expect(relatorioDoFinanceiroDaBusca("?relatorio=a_receber")).toBe("a_receber");
    expect(relatorioDoFinanceiroDaBusca("?relatorio=outro")).toBe("receita");
    expect(filtroInicialDoFinanceiro(HOJE)).toEqual({ de: "2026-08-01", ate: HOJE, cliente: null });
    expect(filtroInicialDoFinanceiro("2026-01-15").de).toBe("2025-11-01");
    expect(problemaDoFiltroDoFinanceiro("receita", { de: "2026-10-24", ate: HOJE, cliente: null })).toBe("O início vem antes do fim.");
    expect(problemaDoFiltroDoFinanceiro("a_receber", { de: "", ate: "", cliente: null })).toBeNull();
  });

  it("os clientes das NFs, para o filtro; a planilha leva o valor em reais", () => {
    expect(clientesDasFaturas(FATURAS)).toEqual([
      { code: "SAFRA", nome: "Banco Safra" },
      { code: "ITAU", nome: "Itaú Unibanco" },
    ]);
    expect(linhasDaPlanilhaDoFinanceiro(tabelaDaReceita(pagamentosDoPeriodo(PAGAMENTOS, "2026-10-01", HOJE), new Map()))).toEqual([
      ["ITAU", 2, { reais: 1_200_000 }],
      ["Total", 2, { reais: 1_200_000 }],
    ]);
  });
});
