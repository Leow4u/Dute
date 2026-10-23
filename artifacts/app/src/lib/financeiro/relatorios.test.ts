import { describe, expect, it } from "vitest";

import { faturaDoFinanceiro, pagamentoDaNf, type FaturaDoFinanceiro } from "./faturas";
import {
  clientesDasFaturas,
  faixaDeAtraso,
  filtroInicialDoFinanceiro,
  linhasDaPlanilhaDoFinanceiro,
  nfsDoPeriodo,
  nfsEmAberto,
  pagamentosDoPeriodo,
  problemaDoFiltroDoFinanceiro,
  relatorioDoFinanceiroDaBusca,
  resumoAReceber,
  resumoDaReceita,
  resumoDoFaturamento,
  tabelaAReceber,
  tabelaDaReceita,
  tabelaDoFaturamento,
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
