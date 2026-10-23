import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HttpsError } from "firebase-functions/https";

import {
  autorizacaoLida,
  autorizacoesDaFatura,
  demandaLida,
  documentoDaFatura,
  faturaIdDaNf,
  interpretarRegistro,
  problemaParaFaturar,
  valorDaRv,
  valorNaMedicao,
} from "./fatura.js";

/** A fatura da demanda (parte 4.1a): a entrada da NF, a demanda, a autorização e o valor. Dados sintéticos. */

function recusa(fn: () => unknown): HttpsError {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof HttpsError, String(error));
    return error;
  }
  assert.fail("deveria recusar");
}

const PEDIDO = { idempotency_key: "k-1", demandas: ["10045"], nf: { numero: "001234", emitida_em: "2026-10-23" }, vencimento: "2026-11-20", forma: "boleto" };

const demanda = (extra: Record<string, unknown> = {}) =>
  demandaLida("10045", {
    customer_code: "ITAU",
    customer_name: "Itaú Unibanco",
    etapa: "a_faturar",
    validacao: { rv: 2, etapa: "a_faturar", autorizacao: "pedido_aceite" },
    autorizacao_ids: ["aut_1"],
    ...extra,
  });

describe("a entrada da NF", () => {
  it("lê o pedido, tira o zero à esquerda do número e usa a série 1 sem série", () => {
    const pedido = interpretarRegistro(PEDIDO);
    assert.deepEqual(pedido.nf, { numero: "1234", serie: "1", emitida_em: "2026-10-23" });
    assert.equal(interpretarRegistro({ ...PEDIDO, nf: { ...PEDIDO.nf, serie: "a1" } }).nf.serie, "A1");
  });

  it("recusa demanda repetida, data que não existe, vencimento antes da emissão, forma e campo desconhecidos", () => {
    assert.match(recusa(() => interpretarRegistro({ ...PEDIDO, demandas: ["10045", "10045"] })).message, /duas vezes/);
    assert.match(recusa(() => interpretarRegistro({ ...PEDIDO, nf: { ...PEDIDO.nf, emitida_em: "2026-02-30" } })).message, /não existe/);
    assert.equal(recusa(() => interpretarRegistro({ ...PEDIDO, vencimento: "2026-10-22" })).message, "O vencimento vem depois da emissão.");
    assert.match(recusa(() => interpretarRegistro({ ...PEDIDO, forma: "cheque" })).message, /Forma de pagamento/);
    assert.equal(recusa(() => interpretarRegistro({ ...PEDIDO, valor_cents: 100 })).message, "Campo não aceito: valor_cents.");
    assert.match(recusa(() => interpretarRegistro({ ...PEDIDO, nf: { ...PEDIDO.nf, numero: "12-34" } })).message, /só dígitos/);
  });

  it("o id da fatura é o da NF: série e número, com ou sem zero à esquerda", () => {
    assert.equal(faturaIdDaNf("1", "1234"), faturaIdDaNf("1", "0001234"));
    assert.notEqual(faturaIdDaNf("1", "1234"), faturaIdDaNf("2", "1234"));
    assert.match(faturaIdDaNf("1", "1234"), /^fat_[a-f0-9]{24}$/);
  });
});

describe("a demanda e a autorização", () => {
  it("só a demanda A faturar, ainda não faturada e sem medição pendente", () => {
    assert.equal(problemaParaFaturar(demanda()), null);
    assert.equal(problemaParaFaturar(demanda({ etapa: "aguardando_autorizacao" })), "A demanda 10045 não está A faturar.");
    assert.equal(problemaParaFaturar(demanda({ faturamento: { fatura_id: "fat_x" } })), "A demanda 10045 já está faturada.");
    assert.equal(problemaParaFaturar(demanda({ medicao_pendente: true })), "A demanda 10045 espera a medição aprovada.");
  });

  it("a demanda que o contrato manda autorizar fatura só com a autorização registrada do mesmo cliente", () => {
    const registrada = autorizacaoLida("aut_1", { status: "registrada", customer_code: "ITAU", demandas: [{ numero: "10045", rv: 2, valor_cents: 100 }] });
    assert.deepEqual(autorizacoesDaFatura(demanda(), new Map([["aut_1", registrada]])), ["aut_1"]);
    const cancelada = autorizacaoLida("aut_1", { status: "cancelada", customer_code: "ITAU" });
    assert.equal(recusa(() => autorizacoesDaFatura(demanda(), new Map([["aut_1", cancelada]]))).message, "A demanda 10045 não tem autorização de faturamento registrada.");
    const deOutro = autorizacaoLida("aut_1", { status: "registrada", customer_code: "SAFRA" });
    assert.match(recusa(() => autorizacoesDaFatura(demanda(), new Map([["aut_1", deOutro]]))).message, /não tem autorização/);
    // O contrato sem exigência fatura sem autorização.
    assert.deepEqual(autorizacoesDaFatura(demanda({ validacao: { rv: 2, autorizacao: "nenhuma" }, autorizacao_ids: [] }), new Map()), []);
  });

  it("a autorização que cita outra RV da demanda não fatura", () => {
    const outraRv = autorizacaoLida("aut_1", { status: "registrada", customer_code: "ITAU", demandas: [{ numero: "10045", rv: 1, valor_cents: 100 }] });
    assert.equal(
      recusa(() => autorizacoesDaFatura(demanda(), new Map([["aut_1", outraRv]]))).message,
      "A autorização cita a RV 1 da demanda 10045; a validada pelo cliente é a RV 2.",
    );
  });

  it("o formato antigo da medição aprovada (autorizacao_id) também conta", () => {
    const lida = demandaLida("10050", { customer_code: "SAFRA", etapa: "a_faturar", validacao: { autorizacao: "medicao_aprovada", medicao_id: "ctr_1_2026-10" }, autorizacao_id: "aut_ctr_1_2026-10" });
    assert.deepEqual([lida.autorizacao_ids, lida.medicao_id, lida.rv], [["aut_ctr_1_2026-10"], "ctr_1_2026-10", null]);
  });
});

describe("o valor da demanda", () => {
  it("o total da RV validada", () => {
    assert.equal(valorDaRv({ numero: "10045", rv: 2 }, { total_cents: 1_234_500 }), 1_234_500);
    assert.equal(recusa(() => valorDaRv({ numero: "10045", rv: null }, null)).message, "A demanda 10045 não tem a RV validada pelo cliente.");
    assert.equal(recusa(() => valorDaRv({ numero: "10045", rv: 2 }, { linhas: [] })).message, "A RV 2 da demanda 10045 não tem o total.");
  });

  it("na medição aprovada, a soma das linhas da demanda", () => {
    const medicao = {
      status: "aprovada",
      linhas: [
        { demanda_numero: "10050", total_cents: 30_000 },
        { demanda_numero: "10051", total_cents: 99_000 },
        { demanda_numero: "10050", total_cents: 12_500 },
      ],
    };
    assert.equal(valorNaMedicao("10050", medicao), 42_500);
    assert.equal(recusa(() => valorNaMedicao("10050", { ...medicao, status: "enviada" })).message, "A medição da demanda 10050 não está aprovada.");
    assert.equal(recusa(() => valorNaMedicao("10052", medicao)).message, "A medição aprovada não tem linha da demanda 10052.");
  });

  it("o documento da fatura soma as demandas e junta as autorizações sem repetir", () => {
    const documento = documentoDaFatura({
      id: "fat_000000000000000000000001",
      customer_code: "ITAU",
      customer_name: "Itaú Unibanco",
      demandas: [
        { numero: "10045", rv: 2, medicao_id: null, autorizacao_ids: ["aut_1"], valor_cents: 100_000 },
        { numero: "10046", rv: 0, medicao_id: null, autorizacao_ids: ["aut_1", "aut_2"], valor_cents: 25_050 },
      ],
      nf: { numero: "1234", serie: "1", emitida_em: "2026-10-23" },
      vencimento: "2026-11-20",
      forma: "boleto",
      observacao: null,
      registrada_por: { uid: "fin-1", role: "financeiro" },
      registrada_em: "2026-10-23T15:00:00.000Z",
      operation_id: "op_x",
    });
    assert.equal(documento.valor_cents, 125_050);
    assert.deepEqual(documento.autorizacao_ids, ["aut_1", "aut_2"]);
    assert.deepEqual(documento.demanda_numeros, ["10045", "10046"]);
    assert.equal(documento.status, "emitida");
    assert.equal(documento.nf_chave, "1:1234");
  });
});
