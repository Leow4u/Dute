import { describe, expect, it } from "vitest";

import {
  CABECALHO_DA_PLANILHA,
  acoesDaNf,
  diasDoMes,
  linhasDaPlanilha,
  nomeDaPlanilha,
  receitaPorCliente,
  rotuloDoMes,
  faturaDoFinanceiro,
  faturasDoFiltro,
  formDoEnvio,
  formDoPagamento,
  numerosDaCobranca,
  pagamentoDaNf,
  pagamentosDaNf,
  pedidoDoCancelamento,
  pedidoDoEnvio,
  pedidoDoEstorno,
  pedidoDoPagamento,
  pendenciasDaCobranca,
  problemasDoEnvio,
  problemasDoMotivo,
  problemasDoPagamento,
  rotuloDaNf,
  situacaoDaCobranca,
  textoDaSituacao,
  textoDoPagamento,
  totalDaLista,
  type FaturaDoFinanceiro,
} from "./faturas";

/**
 * A cobrança das NFs (parte 4.2b): vencida calculada do vencimento (não é
 * status gravado), o pagamento parcial com o saldo, as listas e os pedidos
 * para advanceFatura, que nunca levam o saldo nem o status. Dados sintéticos.
 */

const HOJE = "2026-10-23";
/** O R$ de formatarReais (lib/dominio) vem com espaço que não quebra. */
const reais = (texto: string) => texto.replace(/R\$ /g, "R$ ");

function fatura(numero: string, extra: Record<string, unknown> = {}): FaturaDoFinanceiro {
  const lida = faturaDoFinanceiro(`fat_${numero.padStart(24, "0")}`, {
    customer_code: "ITAU",
    customer_name: "Itaú Unibanco",
    status: "emitida",
    valor_cents: 1_484_500,
    nf: { numero, serie: "1", emitida_em: "2026-10-01" },
    vencimento: "2026-10-30",
    forma: "boleto",
    demandas: [
      { numero: "10045", rv: 1, valor_cents: 1_000_000 },
      { numero: "10046", rv: 0, valor_cents: 484_500 },
    ],
    ...extra,
  });
  if (!lida) throw new Error("fatura sem NF");
  return lida;
}

describe("a situação da NF", () => {
  it("vencida é a NF com saldo e vencimento antes de hoje; no dia do vencimento ainda não venceu", () => {
    expect(situacaoDaCobranca(fatura("1", { vencimento: "2026-10-22" }), HOJE)).toBe("vencida");
    expect(situacaoDaCobranca(fatura("1", { vencimento: HOJE }), HOJE)).toBe("a_vencer");
    expect(situacaoDaCobranca(fatura("1", { vencimento: "2026-10-22", status: "paga", recebido_cents: 1_484_500 }), HOJE)).toBe("paga");
    expect(situacaoDaCobranca(fatura("1", { vencimento: "2026-10-22", status: "cancelada" }), HOJE)).toBe("cancelada");
    // Quitada sem o status gravado ainda: não cobra.
    expect(situacaoDaCobranca(fatura("1", { vencimento: "2026-10-22", recebido_cents: 1_484_500 }), HOJE)).toBe("paga");
  });

  it("o texto diz quanto falta ou quanto passou", () => {
    expect(textoDaSituacao(fatura("1", { vencimento: HOJE }), HOJE)).toBe("Vence hoje");
    expect(textoDaSituacao(fatura("1", { vencimento: "2026-10-24" }), HOJE)).toBe("Vence amanhã");
    expect(textoDaSituacao(fatura("1", { vencimento: "2026-10-30" }), HOJE)).toBe("Vence em 7 dias");
    expect(textoDaSituacao(fatura("1", { vencimento: "2026-10-22" }), HOJE)).toBe("Vencida há 1 dia");
    expect(textoDaSituacao(fatura("1", { vencimento: "2026-09-30" }), HOJE)).toBe("Vencida há 23 dias");
    expect(textoDaSituacao(fatura("1", { status: "paga", recebido_cents: 1_484_500, paga_em: "2026-10-22" }), HOJE)).toBe("Paga em 22/10/2026");
    expect(textoDaSituacao(fatura("1", { status: "cancelada" }), HOJE)).toBe("Cancelada");
  });

  it("o pagamento parcial deixa o saldo; a NF guarda o valor, o recebido e o rótulo com a série fora da 1", () => {
    const parcial = fatura("1234", { recebido_cents: 500_000 });
    expect([parcial.valorCents, parcial.recebidoCents, parcial.saldoCents]).toEqual([1_484_500, 500_000, 984_500]);
    expect(rotuloDaNf(parcial)).toBe("NF 1234");
    expect(rotuloDaNf(fatura("77", { nf: { numero: "77", serie: "2", emitida_em: "2026-10-01" } }))).toBe("NF 77 · série 2");
    expect(faturaDoFinanceiro("fat_x", { nf: {} })).toBeNull();
  });
});

describe("a armazenagem na NF (Fase 7)", () => {
  it("lê a competência e o valor que o WMS emitiu; sem armazenagem, nenhuma; competência inválida fica fora", () => {
    expect(fatura("1301").armazenagem).toEqual([]);
    expect(
      fatura("1302", { armazenagem: [{ periodo_id: "ITAU__2026-09", competencia: "2026-09", valor_cents: 320_000 }, { competencia: "09/2026", valor_cents: 1 }, null] }).armazenagem,
    ).toEqual([{ competencia: "2026-09", valorCents: 320_000 }]);
  });
});

describe("as listas", () => {
  const FATURAS = [
    fatura("1201", { vencimento: "2026-10-30", recebido_cents: 484_500 }),
    fatura("1202", { vencimento: "2026-10-25", customer_code: "SAFRA", customer_name: "Banco Safra", valor_cents: 50_000, demandas: [{ numero: "10060", valor_cents: 50_000 }] }),
    fatura("1203", { vencimento: "2026-10-10", status: "enviada", enviada: { em: "2026-10-02", meio: "email" } }),
    fatura("1204", { vencimento: "2026-09-30" }),
    fatura("1205", { status: "paga", recebido_cents: 1_484_500, paga_em: "2026-10-20", nf: { numero: "1205", emitida_em: "2026-09-01" } }),
    fatura("1206", { status: "paga", recebido_cents: 1_484_500, paga_em: "2026-10-22" }),
    fatura("1207", { status: "cancelada", cancelada: { em: "2026-10-02T12:00:00.000Z", motivo: "Demanda errada" } }),
  ];
  const numeros = (lista: FaturaDoFinanceiro[]) => lista.map((item) => item.nf.numero);

  it("a receber pelo vencimento mais perto; vencidos pelo mais atrasado; pagos pelo pagamento mais recente; todas pela emissão", () => {
    expect(numeros(faturasDoFiltro(FATURAS, "a_receber", HOJE))).toEqual(["1202", "1201"]);
    expect(numeros(faturasDoFiltro(FATURAS, "vencidos", HOJE))).toEqual(["1204", "1203"]);
    expect(numeros(faturasDoFiltro(FATURAS, "pagos", HOJE))).toEqual(["1206", "1205"]);
    // Mesma emissão: pelo cliente e pelo número da NF; a cancelada também aparece.
    expect(numeros(faturasDoFiltro(FATURAS, "todas", HOJE))).toEqual(["1202", "1201", "1203", "1204", "1206", "1207", "1205"]);
  });

  it("a busca acha a NF, o cliente ou a demanda", () => {
    expect(numeros(faturasDoFiltro(FATURAS, "a_receber", HOJE, "safra"))).toEqual(["1202"]);
    expect(numeros(faturasDoFiltro(FATURAS, "todas", HOJE, "10060"))).toEqual(["1202"]);
    expect(numeros(faturasDoFiltro(FATURAS, "pagos", HOJE, "1206"))).toEqual(["1206"]);
  });

  it("o total soma o saldo do que espera pagamento e o valor do que foi pago", () => {
    expect(totalDaLista(faturasDoFiltro(FATURAS, "a_receber", HOJE), "a_receber")).toBe(1_000_000 + 50_000);
    expect(totalDaLista(faturasDoFiltro(FATURAS, "pagos", HOJE), "pagos")).toBe(2 * 1_484_500);
    expect(numerosDaCobranca(FATURAS, HOJE)).toEqual({ aReceber: 2, aReceberCents: 1_050_000, vencidas: 2, vencidoCents: 2 * 1_484_500, paraEnviar: 3 });
  });

  it("no Início, as vencidas são críticas e as NFs a vencer ainda não enviadas pedem o envio", () => {
    const { criticos, outros } = pendenciasDaCobranca(FATURAS, HOJE, { vencidos: "/v", aReceber: "/r" });
    expect(criticos.map((item) => [item.tone, item.title, item.detail, item.actionLabel, item.href])).toEqual([
      ["critical", "2 NFs vencidas", reais("Itaú Unibanco · R$ 29.690,00"), "Cobrar", "/v"],
    ]);
    expect(outros.map((item) => [item.tone, item.title, item.detail, item.actionLabel, item.href])).toEqual([
      ["attention", "2 NFs para enviar ao cliente", "Itaú Unibanco · Banco Safra", "Enviar", "/r"],
    ]);
    expect(pendenciasDaCobranca([], HOJE, { vencidos: "/v", aReceber: "/r" })).toEqual({ criticos: [], outros: [] });
  });
});

describe("o painel da NF", () => {
  const parcial = fatura("1234", { recebido_cents: 500_000, nf: { numero: "1234", emitida_em: "2026-10-20" } });

  it("o pagamento começa pelo saldo, hoje e a forma da NF; confere valor, saldo e datas", () => {
    const form = formDoPagamento(parcial, HOJE);
    expect(form).toEqual({ valor: "9.845,00", recebidoEm: HOJE, forma: "boleto", observacao: "" });
    expect(problemasDoPagamento(form, parcial, HOJE)).toEqual([]);
    expect(problemasDoPagamento({ ...form, valor: "9.845,01" }, parcial, HOJE)).toEqual([reais("O pagamento passa do saldo, de R$ 9.845,00.")]);
    expect(problemasDoPagamento({ ...form, valor: "0" }, parcial, HOJE)).toEqual(["Informe o valor recebido."]);
    expect(problemasDoPagamento({ ...form, valor: "abc" }, parcial, HOJE)).toEqual(["Informe o valor recebido."]);
    expect(problemasDoPagamento({ ...form, recebidoEm: "2026-10-24" }, parcial, HOJE)).toEqual(["A data do pagamento ainda não chegou."]);
    expect(problemasDoPagamento({ ...form, recebidoEm: "2026-10-19" }, parcial, HOJE)).toEqual(["A data do pagamento vem antes da emissão da NF."]);
  });

  it("os pedidos levam a ação, a chave e o que a pessoa informou; nunca o saldo nem o status", () => {
    const pagamento = pedidoDoPagamento({ valor: "R$ 1.234,5", recebidoEm: HOJE, forma: "pix", observacao: " TED do dia " }, parcial, "k1");
    expect(pagamento).toEqual({ acao: "pay", idempotency_key: "k1", fatura_id: parcial.id, valor: "1234.5", recebido_em: HOJE, forma: "pix", observacao: "TED do dia" });
    expect(JSON.stringify(pagamento)).not.toMatch(/saldo|status|cents/);
    expect(pedidoDoEnvio(formDoEnvio(HOJE), parcial, "k2")).toEqual({ acao: "send", idempotency_key: "k2", fatura_id: parcial.id, enviada_em: HOJE, meio: "email" });
    expect(problemasDoEnvio({ enviadaEm: "2026-10-19", meio: "email" }, parcial, HOJE)).toEqual(["A data do envio vem antes da emissão da NF."]);
    expect(pedidoDoEstorno(parcial, "pag_1", " Lançado errado ", "k3")).toEqual({ acao: "reverse_payment", idempotency_key: "k3", fatura_id: parcial.id, pagamento_id: "pag_1", motivo: "Lançado errado" });
    expect(pedidoDoCancelamento(parcial, "Demanda errada", "k4")).toEqual({ acao: "cancel", idempotency_key: "k4", fatura_id: parcial.id, motivo: "Demanda errada" });
    expect(problemasDoMotivo("erro")).toEqual(["Conte o motivo em ao menos 5 caracteres."]);
  });

  it("envia só a emitida sem envio; paga só com saldo; cancela só sem pagamento", () => {
    expect(acoesDaNf(fatura("1"))).toEqual({ enviar: true, pagar: true, cancelar: true });
    expect(acoesDaNf(parcial)).toEqual({ enviar: true, pagar: true, cancelar: false });
    expect(acoesDaNf(fatura("1", { status: "enviada", enviada: { em: HOJE, meio: "email" } }))).toEqual({ enviar: false, pagar: true, cancelar: true });
    expect(acoesDaNf(fatura("1", { status: "paga", recebido_cents: 1_484_500 }))).toEqual({ enviar: false, pagar: false, cancelar: false });
    expect(acoesDaNf(fatura("1", { status: "cancelada" }))).toEqual({ enviar: false, pagar: false, cancelar: false });
    // A NF que saiu pela Omie recebe e se envia, mas o registro não se cancela.
    expect(fatura("1").pelaOmie).toBe(false);
    expect(acoesDaNf(fatura("1", { origem_nf: "omie" }))).toEqual({ enviar: true, pagar: true, cancelar: false });
  });

  it("os pagamentos da NF, o mais antigo primeiro, com o estorno", () => {
    const lidos = [
      pagamentoDaNf("pag_b", { fatura_id: parcial.id, valor_cents: 300_000, recebido_em: "2026-10-22", forma: "pix" })!,
      pagamentoDaNf("pag_a", { fatura_id: parcial.id, valor_cents: 200_000, recebido_em: "2026-10-21", forma: "transferencia", status: "estornado", estornado: { motivo: "Duplicado" } })!,
      pagamentoDaNf("pag_c", { fatura_id: "fat_outra", valor_cents: 1, recebido_em: "2026-10-20", forma: "pix" })!,
    ];
    expect(pagamentosDaNf(lidos, parcial.id).map((pagamento) => [pagamento.id, textoDoPagamento(pagamento), pagamento.estornado?.motivo ?? null])).toEqual([
      ["pag_a", "21/10/2026 · Transferência", "Duplicado"],
      ["pag_b", "22/10/2026 · Pix", null],
    ]);
    expect(pagamentoDaNf("pag_x", {})).toBeNull();
  });
});

describe("a planilha e a receita (parte 4.2c)", () => {
  it("cada NF vira uma linha com reais e datas de verdade, na ordem do cabeçalho", () => {
    const parcial = fatura("1234", { recebido_cents: 500_000, status: "enviada", enviada: { em: "2026-10-02", meio: "email" } });
    const [linha] = linhasDaPlanilha([parcial], HOJE);
    expect(linha).toHaveLength(CABECALHO_DA_PLANILHA.length);
    expect(linha).toEqual([
      "1234",
      "1",
      "Itaú Unibanco",
      { data: "2026-10-01" },
      { data: "2026-10-30" },
      "Vence em 7 dias",
      { reais: 1_484_500 },
      { reais: 500_000 },
      { reais: 984_500 },
      null,
      "Boleto",
      { data: "2026-10-02" },
      "10045, 10046",
    ]);
    expect(nomeDaPlanilha("vencidos", HOJE)).toBe("financeiro-vencidos-2026-10-23.xlsx");
    expect(nomeDaPlanilha("todas", HOJE)).toBe("financeiro-faturas-2026-10-23.xlsx");
  });

  it("o mês vira o intervalo de dias e o rótulo", () => {
    expect(diasDoMes("2026-02")).toEqual({ de: "2026-02-01", ate: "2026-02-28" });
    expect(diasDoMes("2028-02")).toEqual({ de: "2028-02-01", ate: "2028-02-29" });
    expect(diasDoMes("2026-13")).toBeNull();
    expect(diasDoMes("outubro")).toBeNull();
    expect(rotuloDoMes("2026-10")).toBe("outubro de 2026");
  });

  it("a receita soma os pagamentos registrados por cliente; o estorno fica fora; 'Outros' só junta dois ou mais", () => {
    const pagamento = (id: string, cliente: string, cents: number, extra: Record<string, unknown> = {}) =>
      pagamentoDaNf(id, { fatura_id: "fat_x", customer_code: cliente, valor_cents: cents, recebido_em: "2026-10-10", forma: "pix", ...extra })!;
    const nomes = new Map([["ITAU", "Itaú Unibanco"]]);
    const cinco = ["A", "B", "C", "D", "E"].map((cliente, indice) => pagamento(`p${indice}`, cliente, 100 * (indice + 1)));
    expect(receitaPorCliente(cinco, nomes).linhas).toHaveLength(5);
    expect(receitaPorCliente(cinco, nomes).outros).toBeNull();
    const seis = [...cinco, pagamento("p9", "F", 1)];
    expect(receitaPorCliente(seis, nomes).outros).toEqual({ clientes: 2, cents: 101 });
    const comEstorno = receitaPorCliente([pagamento("a", "ITAU", 1000), pagamento("b", "ITAU", 500, { status: "estornado" })], nomes);
    expect(comEstorno).toEqual({ linhas: [{ customerCode: "ITAU", cliente: "Itaú Unibanco", cents: 1000 }], outros: null, totalCents: 1000, pagamentos: 1 });
  });
});
