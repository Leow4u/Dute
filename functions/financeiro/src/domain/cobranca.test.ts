import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HttpsError } from "firebase-functions/https";

import {
  aplicarEstorno,
  aplicarPagamento,
  centavosDoTexto,
  conferirCancelamento,
  conferirDemandaDaFatura,
  conferirEnvio,
  faturaLida,
  interpretarAvanco,
  pagamentoIdDaOperacao,
  pagamentoLido,
  saldoDaFatura,
  type FaturaLida,
} from "./cobranca.js";

/**
 * A cobrança da fatura (parte 4.2a): pagamento parcial, o que quita, o que
 * passa do saldo, o estorno e o cancelamento só sem pagamento. Dados
 * sintéticos.
 */

const HOJE = "2026-10-23";
const ID = "fat_0123456789abcdef01234567";

function fatura(extra: Record<string, unknown> = {}): FaturaLida {
  return faturaLida(ID, {
    customer_code: "ITAU",
    status: "emitida",
    valor_cents: 1_484_500,
    nf: { numero: "1234", serie: "1", emitida_em: "2026-10-20" },
    vencimento: "2026-11-20",
    demanda_numeros: ["10045", "10046"],
    autorizacao_ids: ["aut_itau"],
    ...extra,
  });
}

function recusa(fn: () => unknown, codigo: string, mensagem: string | RegExp) {
  assert.throws(fn, (error: unknown) => {
    assert.ok(error instanceof HttpsError, String(error));
    assert.equal(error.code, codigo);
    if (typeof mensagem === "string") assert.equal(error.message, mensagem);
    else assert.match(error.message, mensagem);
    return true;
  });
}

describe("o pedido da cobrança", () => {
  it("cada ação tem os campos dela, e nada mais", () => {
    assert.equal(interpretarAvanco({ acao: "send", idempotency_key: "k", fatura_id: ID, enviada_em: HOJE, meio: "email" }).acao, "send");
    assert.equal(interpretarAvanco({ acao: "pay", idempotency_key: "k", fatura_id: ID, valor: "1234.5", recebido_em: HOJE, forma: "pix" }).acao, "pay");
    recusa(() => interpretarAvanco({ acao: "pay", idempotency_key: "k", fatura_id: ID, valor: "1.234,50", recebido_em: HOJE, forma: "pix" }), "invalid-argument", /decimal com ponto/);
    recusa(() => interpretarAvanco({ acao: "pay", idempotency_key: "k", fatura_id: ID, valor: "10", recebido_em: HOJE, forma: "pix", valor_cents: 1000 }), "invalid-argument", "Campo não aceito: valor_cents.");
    recusa(() => interpretarAvanco({ acao: "cancel", idempotency_key: "k", fatura_id: ID, motivo: "erro" }), "invalid-argument", "Conte o motivo em ao menos 5 caracteres.");
    recusa(() => interpretarAvanco({ acao: "apagar", idempotency_key: "k", fatura_id: ID }), "invalid-argument", "Ação inválida: use send, pay, reverse_payment ou cancel.");
    recusa(() => interpretarAvanco({ acao: "send", idempotency_key: "k", fatura_id: "1234", enviada_em: HOJE, meio: "email" }), "invalid-argument", "Fatura inválida.");
  });

  it("o valor vira centavos sem float", () => {
    assert.equal(centavosDoTexto("1234.5"), 123_450);
    assert.equal(centavosDoTexto("0.07"), 7);
    assert.equal(centavosDoTexto("14845"), 1_484_500);
    assert.equal(centavosDoTexto("9999999999999.99"), 999_999_999_999_999);
  });
});

describe("o pagamento", () => {
  it("parcial deixa o saldo e o status; o que completa quita e deixa a fatura paga", () => {
    const parcial = aplicarPagamento(fatura(), 500_000, "2026-10-22", HOJE);
    assert.deepEqual(parcial, { recebido_cents: 500_000, saldo_cents: 984_500, quitada: false, status: "emitida" });
    const enviada = fatura({ status: "enviada", enviada: { em: "2026-10-21" }, recebido_cents: 500_000 });
    assert.equal(saldoDaFatura(enviada), 984_500);
    assert.deepEqual(aplicarPagamento(enviada, 984_500, HOJE, HOJE), { recebido_cents: 1_484_500, saldo_cents: 0, quitada: true, status: "paga" });
  });

  it("não passa do saldo, não é zero, não vem antes da emissão nem depois de hoje", () => {
    const comSaldo = fatura({ recebido_cents: 1_400_000 });
    recusa(() => aplicarPagamento(comSaldo, 84_501, HOJE, HOJE), "invalid-argument", /^O pagamento passa do saldo da NF, de R\$\s845,00\.$/);
    recusa(() => aplicarPagamento(comSaldo, 0, HOJE, HOJE), "invalid-argument", "O valor do pagamento precisa ser maior que zero.");
    recusa(() => aplicarPagamento(comSaldo, 100, "2026-10-19", HOJE), "invalid-argument", "A data do pagamento vem antes da emissão da NF (20/10/2026).");
    recusa(() => aplicarPagamento(comSaldo, 100, "2026-10-24", HOJE), "invalid-argument", "A data do pagamento ainda não chegou.");
  });

  it("a paga e a cancelada não recebem pagamento", () => {
    recusa(() => aplicarPagamento(fatura({ status: "paga", recebido_cents: 1_484_500 }), 1, HOJE, HOJE), "failed-precondition", "A NF já está paga.");
    recusa(() => aplicarPagamento(fatura({ status: "cancelada" }), 1, HOJE, HOJE), "failed-precondition", "A NF está cancelada.");
  });

  it("o id do pagamento sai da fatura e da operação", () => {
    assert.match(pagamentoIdDaOperacao(ID, "op_1"), /^pag_[a-f0-9]{24}$/);
    assert.notEqual(pagamentoIdDaOperacao(ID, "op_1"), pagamentoIdDaOperacao(ID, "op_2"));
  });
});

describe("o estorno", () => {
  const pago = (status: string) => pagamentoLido("pag_0123456789abcdef01234567", { fatura_id: ID, status, valor_cents: 500_000 });

  it("tira o valor do recebido; a paga volta a enviada, ou a emitida sem envio", () => {
    const paga = fatura({ status: "paga", recebido_cents: 1_484_500, enviada: { em: "2026-10-21" } });
    assert.deepEqual(aplicarEstorno(paga, pago("registrado")), { recebido_cents: 984_500, saldo_cents: 500_000, quitada: false, status: "enviada", reaberta: true });
    const semEnvio = fatura({ status: "paga", recebido_cents: 1_484_500 });
    assert.equal(aplicarEstorno(semEnvio, pago("registrado")).status, "emitida");
    assert.equal(aplicarEstorno(fatura({ recebido_cents: 500_000 }), pago("registrado")).reaberta, false);
  });

  it("recusa o pagamento já estornado, de outra fatura ou que não existe", () => {
    recusa(() => aplicarEstorno(fatura({ recebido_cents: 500_000 }), pago("estornado")), "failed-precondition", "O pagamento já foi estornado.");
    const deOutra = pagamentoLido("pag_0123456789abcdef01234567", { fatura_id: "fat_ffffffffffffffffffffffff", valor_cents: 1 });
    recusa(() => aplicarEstorno(fatura(), deOutra), "not-found", "Pagamento não encontrado nesta NF.");
    recusa(() => aplicarEstorno(fatura(), null), "not-found", "Pagamento não encontrado nesta NF.");
  });
});

describe("o envio e o cancelamento", () => {
  it("envia a emitida uma vez, num dia entre a emissão e hoje", () => {
    conferirEnvio(fatura(), HOJE, HOJE);
    conferirEnvio(fatura({ recebido_cents: 100 }), HOJE, HOJE);
    recusa(() => conferirEnvio(fatura({ status: "enviada" }), HOJE, HOJE), "failed-precondition", "A NF já foi enviada ao cliente.");
    recusa(() => conferirEnvio(fatura({ status: "paga" }), HOJE, HOJE), "failed-precondition", "A NF já está paga.");
    recusa(() => conferirEnvio(fatura({ status: "cancelada" }), HOJE, HOJE), "failed-precondition", "A NF está cancelada.");
    recusa(() => conferirEnvio(fatura(), "2026-10-19", HOJE), "invalid-argument", "A data do envio vem antes da emissão da NF (20/10/2026).");
  });

  it("cancela só sem pagamento", () => {
    conferirCancelamento(fatura());
    conferirCancelamento(fatura({ status: "enviada" }));
    recusa(() => conferirCancelamento(fatura({ recebido_cents: 1 })), "failed-precondition", "A NF tem pagamento registrado: estorne os pagamentos antes de cancelar.");
    recusa(() => conferirCancelamento(fatura({ status: "cancelada" })), "failed-precondition", "A NF já está cancelada.");
  });

  it("a NF que saiu pela Omie não se cancela pelo registro: só com a NFS-e cancelada lá", () => {
    assert.equal(fatura().origem_nf, null);
    assert.equal(fatura({ origem_nf: "omie" }).origem_nf, "omie");
    recusa(() => conferirCancelamento(fatura({ origem_nf: "omie" })), "failed-precondition", "A NF saiu pela Omie: o registro só se desfaz com a NFS-e cancelada na Omie.");
  });

  it("a demanda precisa ser desta NF e estar na etapa esperada", () => {
    conferirDemandaDaFatura("10045", { etapa: "faturada", faturamento: { fatura_id: ID } }, ID, "faturada");
    recusa(() => conferirDemandaDaFatura("10045", { etapa: "faturada", faturamento: { fatura_id: "fat_outra" } }, ID, "faturada"), "failed-precondition", "A demanda 10045 não está nesta NF.");
    recusa(() => conferirDemandaDaFatura("10045", { etapa: "a_faturar", faturamento: { fatura_id: ID } }, ID, "faturada"), "failed-precondition", "A demanda 10045 não está faturada.");
    recusa(() => conferirDemandaDaFatura("10045", null, ID, "paga"), "not-found", "Demanda 10045 não encontrada.");
  });
});
