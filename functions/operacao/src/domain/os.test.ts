import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HttpsError } from "firebase-functions/https";

import {
  aplicarOs,
  interpretarOs,
  itensSemPreco,
  numeroDaOs,
  problemaParaAbrirOs,
  proximaSequencia,
  type OsGravada,
} from "./os.js";

/**
 * A OS nasce da demanda em Para planejar (docs/plataforma/fase-3-operacao.md,
 * parte 2). O número é o da demanda com o sufixo (10045-01). Os itens saem
 * da revisão fechada, sem preço.
 */

const LINHA = {
  id: "ln_1",
  lpu_item_id: "lpu_mesa",
  codigo: "DTL-10",
  item: "Estação",
  descricao: "Montagem de estação",
  servico: "Montagem",
  unidade: "UN",
  quantidade: "2",
  preco: "88.50",
  preco_tabela: "80.00",
  preco_anterior: "70.00",
  origem: "alterado",
  motivo: "negociado",
  origem_local: "loc_a",
  destino_local: "loc_b",
  total_cents: 17700,
};

const DEMANDA = {
  customer_code: "ITAU",
  escopo_rv: 0,
  executado_de: null,
  perda: null,
  cancelamento: null,
  validacao: null,
  origem: { local_id: "loc_ceic", complemento: "portaria" },
  destino: { local_id: "loc_faria", complemento: null },
  customer_name: "Itaú Unibanco",
};

const ORCAMENTO = { status: "enviado", rv: 0, customer_code: "ITAU" };

function rejeita(fn: () => unknown): HttpsError {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof HttpsError, `esperava HttpsError, veio ${String(error)}`);
    return error;
  }
  assert.fail("deveria recusar");
}

describe("abrir OS a partir da demanda", () => {
  it("Para planejar, com a RV fechada igual à em curso, pode abrir", () => {
    assert.equal(problemaParaAbrirOs(DEMANDA, ORCAMENTO), null);
  });

  it("recusa demanda que saiu de Para planejar, sem revisão ou de outro cliente", () => {
    assert.match(problemaParaAbrirOs(DEMANDA, null) ?? "", /orçamento/);
    assert.match(problemaParaAbrirOs(DEMANDA, { ...ORCAMENTO, status: "rascunho" }) ?? "", /Para planejar/);
    assert.match(problemaParaAbrirOs({ ...DEMANDA, escopo_rv: 1 }, ORCAMENTO) ?? "", /Para planejar/);
    assert.match(problemaParaAbrirOs({ ...DEMANDA, executado_de: "2026-10-16" }, ORCAMENTO) ?? "", /Para planejar/);
    assert.match(problemaParaAbrirOs({ ...DEMANDA, perda: { motivo: "preco" } }, ORCAMENTO) ?? "", /Para planejar/);
    assert.match(problemaParaAbrirOs({ ...DEMANDA, validacao: { rv: 0, etapa: "a_faturar" } }, ORCAMENTO) ?? "", /Para planejar/);
    assert.match(problemaParaAbrirOs(DEMANDA, { ...ORCAMENTO, customer_code: "SAFRA" }) ?? "", /cliente/);
  });

  it("o número é o da demanda com o sufixo, e a sequência segue o contador", () => {
    assert.equal(numeroDaOs("10045", 1), "10045-01");
    assert.equal(numeroDaOs("10045", 12), "10045-12");
    assert.equal(proximaSequencia(undefined), 1);
    assert.equal(proximaSequencia(0), 1);
    assert.equal(proximaSequencia(2), 3);
    assert.throws(() => proximaSequencia(99), /sequência/);
    assert.throws(() => numeroDaOs("1045", 1), /demanda/);
  });
});

describe("itens da OS sem preço", () => {
  it("copia o serviço e descarta preço, motivo e ajuste", () => {
    const itens = itensSemPreco([
      LINHA,
      { id: "ln_2", origem: "ajuste", item: "Ajuste comercial", descricao: "Ajuste comercial", quantidade: "1", preco: "-10.00", total_cents: -1000 },
    ]);
    assert.equal(itens.length, 1);
    assert.deepEqual(itens[0], {
      id: "ln_1",
      lpu_item_id: "lpu_mesa",
      codigo: "DTL-10",
      item: "Estação",
      descricao: "Montagem de estação",
      servico: "Montagem",
      unidade: "UN",
      quantidade: "2",
      origem_local: "loc_a",
      destino_local: "loc_b",
    });
    const texto = JSON.stringify(itens);
    assert.equal(texto.includes("88.50"), false);
    assert.equal(texto.includes("17700"), false);
    assert.equal(texto.includes("negociado"), false);
    assert.equal(texto.includes("Ajuste"), false);
  });

  it("item avulso entra sem preço; revisão sem serviço é recusada", () => {
    const avulso = itensSemPreco([
      { id: "ln_3", origem: "avulso", lpu_item_id: null, item: "Frete extra", descricao: "Frete extra", quantidade: "1", preco: "200.00", total_cents: 20000 },
    ]);
    assert.equal(avulso[0].lpu_item_id, null);
    assert.equal(JSON.stringify(avulso).includes("200.00"), false);
    const vazio = rejeita(() => itensSemPreco([{ id: "ln_2", origem: "ajuste", item: "Ajuste", quantidade: "1", preco: "-1.00" }]));
    assert.equal(vazio.code, "failed-precondition");
  });
});

describe("documento da OS", () => {
  it("criar nasce aberta, na edição 1, sem o nome do cliente", () => {
    const acao = interpretarOs({ action: "create", idempotency_key: "k1", demanda: "10045" });
    const efeito = aplicarOs(null, acao, {
      numero: "10045-01",
      seq: 1,
      customer_code: "ITAU",
      escopo_rv: 0,
      itens: itensSemPreco([LINHA]),
      origem_local_id: "loc_ceic",
      destino_local_id: "loc_faria",
    });
    assert.equal(efeito.evento, "os.created");
    assert.equal(efeito.documento.status, "aberta");
    assert.equal(efeito.documento.edicao, 1);
    assert.equal(efeito.documento.numero, "10045-01");
    assert.equal(JSON.stringify(efeito.documento).includes("Itaú"), false);
    assert.equal(JSON.stringify(efeito.documento).includes("88.50"), false);
  });

  it("cancelar pede motivo e a edição vista, e não repete", () => {
    const aberta: OsGravada = {
      numero: "10045-01",
      demanda: "10045",
      seq: 1,
      customer_code: "ITAU",
      status: "aberta",
      escopo_rv: 0,
      itens: itensSemPreco([LINHA]),
      origem_local_id: null,
      destino_local_id: null,
      edicao: 1,
      cancelamento: null,
    };
    const efeito = aplicarOs(
      aberta,
      interpretarOs({ action: "cancel", idempotency_key: "k2", numero: "10045-01", expected_edicao: 1, motivo: "Cliente adiou" }),
      null,
    );
    assert.equal(efeito.evento, "os.cancelled");
    assert.equal(efeito.documento.status, "cancelada");
    assert.equal(efeito.documento.edicao, 2);
    assert.equal(efeito.documento.cancelamento?.motivo, "Cliente adiou");
    const deNovo = rejeita(() =>
      aplicarOs(
        efeito.documento,
        interpretarOs({ action: "cancel", idempotency_key: "k3", numero: "10045-01", expected_edicao: 2, motivo: "De novo" }),
        null,
      ),
    );
    assert.match(deNovo.message, /cancelada/);
    const velha = rejeita(() =>
      aplicarOs(
        aberta,
        interpretarOs({ action: "cancel", idempotency_key: "k4", numero: "10045-01", expected_edicao: 9, motivo: "Tarde" }),
        null,
      ),
    );
    assert.equal(velha.code, "failed-precondition");
  });
});
