import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  DIAS_PARA_FATURAR,
  autorizacaoDoFinanceiro,
  competenciaDoFinanceiro,
  demandaDoFinanceiro,
  diasNaEtapa,
  filtrarLinhas,
  fonteDoValor,
  formComVencimento,
  formInicial,
  gruposPorCliente,
  linhaAFaturar,
  linhaDaArmazenagem,
  numerosDaFila,
  pagamentoDoContrato,
  pedidoDaNf,
  pendenciasDoFinanceiro,
  podeMarcarNaNf,
  problemasDaNf,
  rotuloDaLinha,
  textoDoRegistro,
  valorDaFonte,
  type AutorizacaoDoFinanceiro,
  type DemandaDoFinanceiro,
  type FormDaNf,
} from "./a-faturar";
import { LEGACY_CUSTOMER_CODE } from "../operations";
import { CALLABLES_DO_FINANCEIRO } from "./api";

/**
 * A fila A faturar do Financeiro (parte 4.1b): a mesma regra de registerNf
 * (functions/financeiro/src/domain/fatura.ts), para a tela só deixar marcar
 * o que o servidor fatura. Dados sintéticos.
 */

const AGORA = new Date("2026-10-23T15:00:00.000Z");
/** O R$ de formatarReais (lib/dominio) vem com espaço que não quebra. */
const reais = (texto: string) => texto.replace(/R\$ /g, "R$\u00a0");
const HOJE = "2026-10-23";

function demanda(numero: string, extra: Record<string, unknown> = {}): DemandaDoFinanceiro {
  const lida = demandaDoFinanceiro(numero, {
    customer_code: "ITAU",
    customer_name: "Itaú Unibanco",
    contrato_id: "ctr_itau",
    titulo: `Serviço ${numero}`,
    etapa: "a_faturar",
    etapa_desde: "2026-10-20T12:00:00.000Z",
    validacao: { rv: 2, autorizacao: "pedido_aceite" },
    autorizacao_ids: ["aut_itau"],
    ...extra,
  });
  if (!lida) throw new Error(`demanda ${numero} fora da fila`);
  return lida;
}

function autorizacoes(...lista: Array<[string, Record<string, unknown>]>): Map<string, AutorizacaoDoFinanceiro> {
  return new Map(lista.map(([id, dados]) => [id, autorizacaoDoFinanceiro(id, dados)]));
}

const ITAU = autorizacoes([
  "aut_itau",
  { customer_code: "ITAU", status: "registrada", tipo: "pedido_aceite", pedido: "4500000009", aceite: "ACE-1", demandas: [{ numero: "10045", rv: 2 }] },
]);

describe("a demanda na fila do Financeiro", () => {
  it("lê só A faturar e Aguardando autorização; faturada, perdida e as outras ficam fora", () => {
    expect(demanda("10045")).toMatchObject({ numero: "10045", customerCode: "ITAU", cliente: "Itaú Unibanco", rv: 2, autorizacao: "pedido_aceite", autorizacaoIds: ["aut_itau"] });
    for (const etapa of ["faturada", "perdida", "para_planejar", "cancelada"]) expect(demandaDoFinanceiro("1", { etapa }), etapa).toBeNull();
    // O campo antigo autorizacao_id também vale, sem repetir.
    expect(demanda("10046", { autorizacao_id: "aut_itau", autorizacao_ids: ["aut_itau", "aut_2"] }).autorizacaoIds).toEqual(["aut_itau", "aut_2"]);
  });

  it("pronta quando o contrato pede autorização e ela está registrada, do mesmo cliente e citando a RV validada", () => {
    const linha = linhaAFaturar(demanda("10045"), ITAU, 1_234_500);
    expect([linha.situacao, linha.origem, linha.autorizacaoTexto, rotuloDaLinha(linha)]).toEqual(["pronta", "RV 2", "Pedido 4500000009 · aceite ACE-1", "10045 – RV02"]);
  });

  it("não fica pronta pelos mesmos motivos que registerNf recusa", () => {
    const cancelada = autorizacoes(["aut_itau", { customer_code: "ITAU", status: "cancelada" }]);
    const deOutroCliente = autorizacoes(["aut_itau", { customer_code: "SAFRA", status: "registrada" }]);
    const outraRv = autorizacoes(["aut_itau", { customer_code: "ITAU", status: "registrada", demandas: [{ numero: "10045", rv: 1 }] }]);
    expect(linhaAFaturar(demanda("10045"), cancelada, 100).situacao).toBe("sem_autorizacao");
    expect(linhaAFaturar(demanda("10045"), deOutroCliente, 100).situacao).toBe("sem_autorizacao");
    expect(linhaAFaturar(demanda("10045"), outraRv, 100).situacao).toBe("rv_diferente");
    expect(linhaAFaturar(demanda("10045", { etapa: "aguardando_autorizacao" }), ITAU, 100).situacao).toBe("aguardando_autorizacao");
    expect(linhaAFaturar(demanda("10045", { medicao_pendente: true }), ITAU, 100).situacao).toBe("medicao_pendente");
    expect(linhaAFaturar(demanda("10045"), ITAU, null).situacao).toBe("sem_valor");
  });

  it("sem exigência de autorização no contrato, a validação do cliente basta", () => {
    const linha = linhaAFaturar(demanda("10060", { validacao: { rv: 0, autorizacao: "nenhuma" }, autorizacao_ids: [] }), new Map(), 50_000);
    expect([linha.situacao, linha.autorizacaoTexto, rotuloDaLinha(linha)]).toEqual(["pronta", "Sem exigência de autorização", "10060"]);
  });

  it("o valor sai da RV validada ou da soma das linhas da demanda na medição aprovada", () => {
    const daRv = demanda("10045");
    expect(fonteDoValor(daRv)).toBe("quotes/10045/revisoes/2");
    expect(valorDaFonte(daRv, { total_cents: 1_234_500 })).toBe(1_234_500);
    expect(valorDaFonte(daRv, { total_cents: "1234" })).toBeNull();
    const daMedicao = demanda("10050", { validacao: { autorizacao: "medicao_aprovada", medicao_id: "ctr_safra_2026-10" } });
    expect(fonteDoValor(daMedicao)).toBe("medicoes/ctr_safra_2026-10");
    const medicao = { status: "aprovada", linhas: [{ demanda_numero: "10050", total_cents: 30_000 }, { demanda_numero: "10051", total_cents: 99_000 }, { demanda_numero: "10050", total_cents: 12_500 }] };
    expect(valorDaFonte(daMedicao, medicao)).toBe(42_500);
    expect(valorDaFonte(daMedicao, { ...medicao, status: "enviada" })).toBeNull();
    const comAprovacao = linhaAFaturar(
      demanda("10050", { validacao: { autorizacao: "medicao_aprovada", medicao_id: "ctr_safra_2026-10" }, autorizacao_ids: ["aut_ctr_safra_2026-10"] }),
      autorizacoes(["aut_ctr_safra_2026-10", { customer_code: "ITAU", status: "registrada", tipo: "medicao_aprovada" }]),
      42_500,
    );
    expect([comAprovacao.situacao, comAprovacao.origem, comAprovacao.autorizacaoTexto, rotuloDaLinha(comAprovacao)]).toEqual(["pronta", "Medição 10/2026", "Medição aprovada", "10050"]);
    // Sem a aprovação registrada, a medição não fatura e a tela não diz que ela foi aprovada.
    expect(linhaAFaturar(daMedicao, new Map(), 42_500).autorizacaoTexto).toBe("Sem autorização registrada");
    expect(fonteDoValor(demanda("10070", { validacao: { autorizacao: "pedido_aceite" } }))).toBeNull();
  });
});

describe("a NF", () => {
  const prontaItau = linhaAFaturar(demanda("10045"), ITAU, 1_234_500);
  const outraItau = linhaAFaturar(demanda("10046", { validacao: { rv: 0, autorizacao: "pedido_aceite" } }), ITAU, 250_000);
  const safra = linhaAFaturar(demanda("10060", { customer_code: "SAFRA", customer_name: "Banco Safra", validacao: { rv: 0, autorizacao: "nenhuma" }, autorizacao_ids: [] }), new Map(), 50_000);

  it("é de um cliente só: com uma demanda marcada, só as prontas do mesmo cliente entram", () => {
    expect(podeMarcarNaNf(prontaItau, [])).toBe(true);
    expect(podeMarcarNaNf(outraItau, [prontaItau])).toBe(true);
    expect(podeMarcarNaNf(safra, [prontaItau])).toBe(false);
    expect(podeMarcarNaNf(linhaAFaturar(demanda("10047"), new Map(), 100), [])).toBe(false);
  });

  it("os grupos vêm por cliente, com o total; a busca acha número, cliente, título ou pedido", () => {
    expect(gruposPorCliente([safra, outraItau, prontaItau]).map((grupo) => [grupo.cliente, grupo.linhas.map((linha) => linha.demanda.numero), grupo.totalCents])).toEqual([
      ["Banco Safra", ["10060"], 50_000],
      ["Itaú Unibanco", ["10045", "10046"], 1_484_500],
    ]);
    expect(filtrarLinhas([prontaItau, safra], "safra").map((linha) => linha.demanda.numero)).toEqual(["10060"]);
    expect(filtrarLinhas([prontaItau, safra], "4500000009").map((linha) => linha.demanda.numero)).toEqual(["10045"]);
    expect(filtrarLinhas([prontaItau, safra], "  ")).toHaveLength(2);
  });

  it("o formulário confere número, série, emissão (não no futuro), vencimento depois da emissão e a observação", () => {
    const form: FormDaNf = { ...formInicial(HOJE, null), numero: "1234", vencimento: "2026-11-20" };
    expect(problemasDaNf(form, [prontaItau], HOJE)).toEqual([]);
    expect(problemasDaNf({ ...form, numero: "12a" }, [], HOJE)).toEqual(["Marque ao menos uma demanda.", "Informe o número da NF, só dígitos."]);
    expect(problemasDaNf({ ...form, emissao: "2026-10-24" }, [prontaItau], HOJE)).toEqual(["A data de emissão ainda não chegou."]);
    expect(problemasDaNf({ ...form, vencimento: "2026-10-22" }, [prontaItau], HOJE)).toEqual(["O vencimento vem depois da emissão."]);
    expect(problemasDaNf({ ...form, vencimento: "2026-02-31" }, [prontaItau], HOJE)).toEqual(["Informe o vencimento."]);
    expect(problemasDaNf({ ...form, serie: "" }, [prontaItau], HOJE)).toEqual(["Informe a série da NF."]);
    expect(problemasDaNf({ ...form, observacao: "x".repeat(301) }, [prontaItau], HOJE)).toEqual(["Use até 300 caracteres na observação."]);
  });

  it("o pedido para registerNf leva as demandas e a NF, nunca o valor", () => {
    const form: FormDaNf = { ...formInicial(HOJE, null), numero: " 1234 ", serie: "a1", vencimento: "2026-11-20", forma: "pix", observacao: "  " };
    const pedido = pedidoDaNf(form, [prontaItau, outraItau], "chave-1");
    expect(pedido).toEqual({
      idempotency_key: "chave-1",
      demandas: ["10045", "10046"],
      nf: { numero: "1234", serie: "A1", emitida_em: HOJE },
      vencimento: "2026-11-20",
      forma: "pix",
    });
    expect(JSON.stringify(pedido)).not.toMatch(/cents|valor/);
    expect(textoDoRegistro(form, { valor_cents: 1_484_500, demandas: ["10045", "10046"] })).toBe(reais("NF 1234 registrada: 2 demandas faturadas · R$ 14.845,00"));
  });

  it("o vencimento segue a regra de pagamento do contrato até a pessoa mexer nele", () => {
    const dias = pagamentoDoContrato({ pagamento: { tipo: "dias_apos_nf", dias: 28, faixas: [] } });
    const faixas = pagamentoDoContrato({
      pagamento: {
        tipo: "faixas_do_dia_da_nf",
        faixas: [
          { de: 1, ate: 15, dia: 30, mes: "mesmo" },
          { de: 16, ate: 31, dia: 15, mes: "seguinte" },
        ],
      },
    });
    const base = formInicial(HOJE, null);
    expect(base.vencimento).toBe("");
    expect(formComVencimento(base, false, dias).vencimento).toBe("2026-11-20");
    expect(formComVencimento(base, false, faixas).vencimento).toBe("2026-11-15");
    expect(formComVencimento({ ...base, vencimento: "2026-12-01" }, true, dias).vencimento).toBe("2026-12-01");
    expect(formComVencimento(base, false, pagamentoDoContrato({ pagamento: { tipo: "texto", texto: "Conforme pedido" } })).vencimento).toBe("");
    expect(pagamentoDoContrato({ pagamento: { tipo: "outro" } })).toBeNull();
    expect(pagamentoDoContrato(null)).toBeNull();
  });
});

describe("o Início do Financeiro", () => {
  const pronta = (numero: string, desde: string, extra: Record<string, unknown> = {}) =>
    linhaAFaturar(demanda(numero, { etapa_desde: desde, ...extra }), ITAU, 100_000);

  it("as prontas viram um item, crítico depois de alguns dias; as que esperam, itens de informação", () => {
    const linhas = [
      pronta("10045", "2026-10-20T12:00:00.000Z"),
      linhaAFaturar(demanda("10046", { etapa: "aguardando_autorizacao" }), ITAU, 100),
      linhaAFaturar(demanda("10047", { medicao_pendente: true }), ITAU, 100),
    ];
    expect(pendenciasDoFinanceiro(linhas, AGORA, "/financeiro/a-faturar").map((item) => [item.tone, item.title, item.detail, item.actionLabel, item.href])).toEqual([
      ["attention", "1 demanda a faturar", reais("Itaú Unibanco · R$ 1.000,00"), "Faturar", "/financeiro/a-faturar"],
      ["info", "1 demanda aguardando autorização", "Itaú Unibanco", "Ver", "/financeiro/a-faturar"],
      ["info", "1 demanda sem valor para faturar", "Itaú Unibanco", "Ver", "/financeiro/a-faturar"],
    ]);
    const antiga = pronta("10040", new Date(AGORA.getTime() - (DIAS_PARA_FATURAR + 1) * 86_400_000).toISOString());
    expect(pendenciasDoFinanceiro([antiga], AGORA, "/x")[0].tone).toBe("critical");
    expect(diasNaEtapa(antiga, AGORA)).toBe(DIAS_PARA_FATURAR + 1);
    expect(pendenciasDoFinanceiro([], AGORA, "/x")).toEqual([]);
    expect(numerosDaFila(linhas)).toEqual({ prontas: 1, prontasCents: 100_000, aguardando: 1, semValor: 1 });
  });
});

describe("a armazenagem do WMS na fila (parte 7.2b)", () => {
  const EMITIDA = {
    customer_code: "ITAU",
    competencia: "2026-09",
    status: "emitido",
    emitido_em: "2026-10-02T12:00:00.000Z",
    total_cents: 99,
    invoice_snapshot: { competencia: "2026-09", status: "emitido", total_cents: 7_508 },
  };
  const armazenagem = linhaDaArmazenagem(competenciaDoFinanceiro("ITAU__2026-09", EMITIDA)!);
  const demanda = linhaAFaturar(demandaDoFinanceiro("10060", { customer_code: "ITAU", customer_name: "Itaú Unibanco", etapa: "a_faturar", validacao: { rv: 0, autorizacao: "nenhuma" } })!, new Map(), 50_000);

  it("só a emitida e fora de NF entra, pelo total da foto da emissão", () => {
    expect(competenciaDoFinanceiro("ITAU__2026-09", EMITIDA)).toEqual({ periodoId: "ITAU__2026-09", customerCode: "ITAU", competencia: "2026-09", emitidaEm: "2026-10-02T12:00:00.000Z", valorCents: 7_508 });
    expect(competenciaDoFinanceiro("ITAU__2026-09", { ...EMITIDA, status: "aberto" })).toBeNull();
    expect(competenciaDoFinanceiro("ITAU__2026-09", { ...EMITIDA, status: "pago" })).toBeNull();
    expect(competenciaDoFinanceiro("ITAU__2026-09", { ...EMITIDA, faturamento: { fatura_id: "fat_1" } })).toBeNull();
    expect(competenciaDoFinanceiro("ITAU__2026-09", { ...EMITIDA, invoice_snapshot: null })?.valorCents).toBeNull();
    // O id antigo é só da BTG.
    expect(competenciaDoFinanceiro("2026-08", { status: "emitido", invoice_snapshot: { total_cents: 1_234 } })?.customerCode).toBe(LEGACY_CUSTOMER_CODE);
    expect(competenciaDoFinanceiro("SAFRA__2026-09", { status: "emitido" })).toBeNull();
    expect(competenciaDoFinanceiro("qualquer", EMITIDA)).toBeNull();
  });

  it("vira uma linha pronta, com o rótulo do mês e o dia da emissão; sem a foto, espera", () => {
    expect([armazenagem.periodoId, armazenagem.situacao, armazenagem.valorCents, rotuloDaLinha(armazenagem)]).toEqual(["ITAU__2026-09", "pronta", 7_508, "Armazenagem 09/2026"]);
    expect([armazenagem.origem, armazenagem.autorizacaoTexto, armazenagem.demanda.desde]).toEqual(["Fatura do WMS", "Emitida na Armazenagem", "2026-10-02T12:00:00.000Z"]);
    expect(linhaDaArmazenagem(competenciaDoFinanceiro("ITAU__2026-09", { ...EMITIDA, invoice_snapshot: null })!).situacao).toBe("sem_valor");
    expect(filtrarLinhas([armazenagem, demanda], "armazenagem")).toEqual([armazenagem]);
  });

  it("entra na NF com as demandas do mesmo cliente, no grupo dele e com o nome da demanda", () => {
    expect(podeMarcarNaNf(armazenagem, [demanda])).toBe(true);
    const safra = linhaDaArmazenagem(competenciaDoFinanceiro("SAFRA__2026-09", { ...EMITIDA, customer_code: "SAFRA" })!);
    expect(podeMarcarNaNf(safra, [demanda])).toBe(false);
    const [grupo] = gruposPorCliente([armazenagem, demanda]);
    expect([grupo.cliente, grupo.totalCents, grupo.linhas.length]).toEqual(["Itaú Unibanco", 57_508, 2]);
  });

  it("o pedido leva a armazenagem à parte, e só quando há", () => {
    const form: FormDaNf = { ...formInicial(HOJE, null), numero: "500", vencimento: "2026-11-20" };
    expect(pedidoDaNf(form, [demanda, armazenagem], "k")).toMatchObject({ demandas: ["10060"], armazenagem: ["ITAU__2026-09"] });
    expect(pedidoDaNf(form, [armazenagem], "k")).toMatchObject({ demandas: [], armazenagem: ["ITAU__2026-09"] });
    expect(pedidoDaNf(form, [demanda], "k")).not.toHaveProperty("armazenagem");
  });

  it("a confirmação diz a armazenagem de cada mês", () => {
    const form: FormDaNf = { ...formInicial(HOJE, null), numero: "500" };
    expect(textoDoRegistro(form, { valor_cents: 7_508, demandas: [], armazenagem: ["ITAU__2026-09"] })).toBe(reais("NF 500 registrada: a armazenagem de 09/2026 faturada · R$ 75,08"));
    expect(textoDoRegistro(form, { valor_cents: 57_508, demandas: ["10060"], armazenagem: ["2026-08", "ITAU__2026-09"] })).toBe(
      reais("NF 500 registrada: 1 demanda e a armazenagem de 08/2026 e 09/2026 faturadas · R$ 575,08"),
    );
    expect(textoDoRegistro(form, { demandas: ["10060"] })).toBe("NF 500 registrada: 1 demanda faturada");
  });

  it("no Início, a armazenagem conta à parte da demanda", () => {
    expect(pendenciasDoFinanceiro([demanda, armazenagem], AGORA, "/x")[0]?.title).toBe("1 demanda e 1 armazenagem a faturar");
    expect(pendenciasDoFinanceiro([armazenagem], AGORA, "/x")[0]?.title).toBe("1 armazenagem a faturar");
  });
});

describe("as callables", () => {
  it("toda callable que o app chama existe em functions/financeiro", () => {
    const fonte = readFileSync(new URL("../../../../../functions/financeiro/src/index.ts", import.meta.url), "utf8");
    const exportadas = Array.from(fonte.matchAll(/^export const (\w+) = onCall\(/gm), (match) => match[1]);
    expect([...CALLABLES_DO_FINANCEIRO].sort()).toEqual([...exportadas].sort());
  });
});
