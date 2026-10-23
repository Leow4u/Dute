import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HttpsError } from "firebase-functions/https";

import { ITENS_POR_ALERTA, chaveDoItemDecidido, idDoAlerta, interpretarRespostaDoAlerta, itemDaMemoria, itensEscolhidos, itensParaAlertar, type ItemDaMemoria } from "./alertas-parados.js";
import { buildCoreEvent } from "./eventos.js";
import { regraDoModelo } from "./parados.js";

/**
 * O alerta do item parado (parte 5.4d): os itens que a proposta leva, o item
 * decidido que não volta enquanto não se mexe, a escolha na aprovação e o
 * evento sem valor. Dados sintéticos; hoje é 2026-10-20.
 */

const HOJE = "2026-10-20";
const REGRA = regraDoModelo("uniformes");

function item(sku: string, ultima: string | null, saldo = 10, saida: string | null = null): ItemDaMemoria {
  return { sku_code: sku, client_item_code: `${sku}-CLI`, product_name: `Produto ${sku}`, saldo, relogio: { primeira_entrada: ultima, ultima_entrada: ultima, ultima_saida: saida } };
}

describe("os itens da proposta", () => {
  it("só os parados pela regra, com saldo, os mais parados primeiro", () => {
    const itens = [
      item("SKU-A", "2026-07-22T15:00:00.000Z"),
      item("SKU-B", "2026-07-23T15:00:00.000Z"),
      item("SKU-C", "2026-04-03T15:00:00.000Z"),
      item("SKU-D", "2026-04-03T15:00:00.000Z", 0),
      item("SKU-E", null),
    ];
    assert.deepEqual(
      itensParaAlertar(itens, REGRA, HOJE, new Set()).map((alertado) => [alertado.sku_code, alertado.dias_parado, alertado.ultima_movimentacao]),
      [
        ["SKU-C", 200, "2026-04-03T15:00:00.000Z"],
        ["SKU-A", 90, "2026-07-22T15:00:00.000Z"],
      ],
    );
  });

  it("o último movimento é a entrada ou a saída mais nova", () => {
    const [alertado] = itensParaAlertar([item("SKU-A", "2026-04-03T15:00:00.000Z", 10, "2026-07-12T15:00:00.000Z")], REGRA, HOJE, new Set());
    assert.deepEqual([alertado?.ultima_movimentacao, alertado?.dias_parado], ["2026-07-12T15:00:00.000Z", 100]);
  });

  it("o item decidido não volta; o que se mexeu depois da decisão volta quando passa do limite de novo", () => {
    const decidido = item("SKU-A", "2026-04-03T15:00:00.000Z");
    const [alertado] = itensParaAlertar([decidido], REGRA, HOJE, new Set());
    assert.ok(alertado);
    const decididos = new Set([chaveDoItemDecidido(alertado)]);
    assert.deepEqual(itensParaAlertar([decidido], REGRA, HOJE, decididos), []);
    assert.equal(itensParaAlertar([item("SKU-A", "2026-07-01T15:00:00.000Z")], REGRA, HOJE, decididos).length, 1);
  });

  it(`no máximo ${ITENS_POR_ALERTA} itens por alerta`, () => {
    const muitos = Array.from({ length: ITENS_POR_ALERTA + 5 }, (_, indice) => item(`SKU-${String(indice).padStart(3, "0")}`, "2026-04-03T15:00:00.000Z"));
    assert.equal(itensParaAlertar(muitos, REGRA, HOJE, new Set()).length, ITENS_POR_ALERTA);
  });

  it("lê o item da memória; sem SKU, nada", () => {
    assert.deepEqual(itemDaMemoria({ sku_code: "SKU-A", saldo: "4", relogio: { ultima_saida: "2026-07-12T15:00:00.000Z" } }), {
      sku_code: "SKU-A",
      client_item_code: null,
      product_name: null,
      saldo: 4,
      relogio: { primeira_entrada: null, ultima_entrada: null, ultima_saida: "2026-07-12T15:00:00.000Z" },
    });
    assert.equal(itemDaMemoria({ saldo: 3 }), null);
  });
});

describe("a decisão", () => {
  const proposta = itensParaAlertar([item("SKU-A", "2026-04-03T15:00:00.000Z"), item("SKU-B", "2026-07-01T15:00:00.000Z")], REGRA, HOJE, new Set());

  it("a aprovação leva os itens escolhidos, na ordem da proposta", () => {
    assert.deepEqual(itensEscolhidos(proposta, ["SKU-B", "SKU-A"]).map((escolhido) => escolhido.sku_code), ["SKU-A", "SKU-B"]);
    assert.deepEqual(itensEscolhidos(proposta, ["SKU-B"]).map((escolhido) => escolhido.sku_code), ["SKU-B"]);
  });

  it("o item fora da proposta e a aprovação sem item recusam", () => {
    assert.throws(() => itensEscolhidos(proposta, ["SKU-Z"]), (erro: unknown) => erro instanceof HttpsError && erro.message === "O item SKU-Z não está no alerta.");
    assert.throws(() => itensEscolhidos(proposta, []), (erro: unknown) => erro instanceof HttpsError && erro.message === "Escolha os itens do alerta.");
  });

  it("a resposta só com o alerta, a decisão e os itens", () => {
    const alerta = idDoAlerta("ITAU", HOJE);
    assert.match(alerta, /^alerta_[a-f0-9]{24}$/);
    assert.deepEqual(interpretarRespostaDoAlerta({ alerta_id: alerta, decisao: "descartar" }), { alerta_id: alerta, decisao: "descartar", itens: [] });
    assert.throws(() => interpretarRespostaDoAlerta({ alerta_id: "x", decisao: "aprovar" }), HttpsError);
    assert.throws(() => interpretarRespostaDoAlerta({ alerta_id: alerta, decisao: "enviar" }), HttpsError);
    assert.throws(() => interpretarRespostaDoAlerta({ alerta_id: alerta, decisao: "aprovar", texto: "oi" }), HttpsError);
  });
});

describe("o evento da decisão", () => {
  const alerta = idDoAlerta("ITAU", HOJE);
  const actor = { uid: "ops-1", role: "interno" as const, name: "Ops" };

  it("sem valor nem nome de item: o alerta e quantos itens; o mesmo id para a mesma decisão", () => {
    const evento = buildCoreEvent({ type: "estoque_parado.aprovado", payload: { id: alerta, itens: 2 }, customer_code: "ITAU", actor, occurred_at: "2026-10-20T12:00:00.000Z" });
    assert.deepEqual(evento.payload, { id: alerta, itens: 2 });
    assert.equal(evento.source, "functions_core");
    assert.equal(evento.entity_id, alerta);
    assert.deepEqual(evento.actor, { uid: "ops-1", role: "interno", name: "Ops" });
    assert.equal(evento.id, buildCoreEvent({ type: "estoque_parado.aprovado", payload: { id: alerta, itens: 1 }, customer_code: "ITAU", actor, occurred_at: "2026-10-21T12:00:00.000Z" }).id);
    assert.notEqual(evento.id, buildCoreEvent({ type: "estoque_parado.descartado", payload: { id: alerta, itens: 2 }, customer_code: "ITAU", actor, occurred_at: "2026-10-20T12:00:00.000Z" }).id);
  });

  it("o payload com outro campo, o evento sem cliente e o do papel cliente recusam", () => {
    const base = { type: "estoque_parado.aprovado" as const, customer_code: "ITAU", actor, occurred_at: "2026-10-20T12:00:00.000Z" };
    assert.throws(() => buildCoreEvent({ ...base, payload: { id: alerta, itens: 2, nomes: ["Camisa"] } as never }), HttpsError);
    assert.throws(() => buildCoreEvent({ ...base, customer_code: " ", payload: { id: alerta, itens: 2 } }), HttpsError);
    assert.throws(() => buildCoreEvent({ ...base, actor: { uid: "c", role: "cliente" }, payload: { id: alerta, itens: 2 } }), HttpsError);
  });
});
