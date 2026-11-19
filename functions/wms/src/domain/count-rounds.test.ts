import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HttpsError } from "firebase-functions/https";

import {
  LEGACY_ROUND_ID,
  LEGACY_ROUND_TITLE,
  alcanceTemCaixa,
  conferirRodadaDaRecontagem,
  entradaDaConclusao,
  entradaDoInicio,
  numerosDaRodada,
  prateleiraNoAlcance,
  ruaDaPosicao,
  tituloDaRodada,
  type CaixaDaRodada,
  type LinhaDaRodada,
} from "./count-rounds.js";
import { LEGACY_CUSTOMER_CODE } from "./customer-scope.js";

/**
 * A regra pura da rodada da contagem (docs/superpowers/specs/2026-11-18-registro-da-rodada-design.md):
 * o título que o servidor dá, a entrada das callables, o alcance (geral, por
 * rua, por item) e os números do fechamento, a mesma conta da tela.
 */

const CHAVE = "k-00000001";

function recusa(acao: () => unknown): HttpsError {
  try {
    acao();
  } catch (error) {
    assert.ok(error instanceof HttpsError, String(error));
    return error;
  }
  assert.fail("a entrada passou");
}

describe("o título da rodada", () => {
  it("geral, por rua e por item, com o dia de São Paulo", () => {
    assert.equal(tituloDaRodada({ scope: "general" }, undefined, "2026-11-19T11:10:00.000Z"), "Contagem geral · 19/11/2026");
    assert.equal(tituloDaRodada({ scope: "aisle", aisle: "A" }, undefined, "2026-11-19T11:10:00.000Z"), "Contagem da rua A · 19/11/2026");
    assert.equal(
      tituloDaRodada({ scope: "item", sku_code: "BTG-000122" }, { product_name: "Polo Masculino Piquet Preto", client_item_code: "A.01.0806.005.P", size: "P" }, "2026-11-19T11:10:00.000Z"),
      "Contagem de Polo Masculino Piquet Preto · P · 19/11/2026",
    );
    // 23:30 em São Paulo ainda é 19/11; sem o nome, o SKU.
    assert.equal(tituloDaRodada({ scope: "item", sku_code: "BTG-000122" }, undefined, "2026-11-20T02:30:00.000Z"), "Contagem de BTG-000122 · 19/11/2026");
  });
});

describe("a entrada", () => {
  it("o alcance pede o alvo dele, em maiúsculas; o resto recusa com a frase", () => {
    assert.equal(entradaDoInicio({ customer_code: "BTG Pactual", scope: "aisle", aisle: "a", idempotency_key: CHAVE }).aisle, "A");
    assert.equal(entradaDoInicio({ customer_code: "BTG Pactual", scope: "item", sku_code: "btg-000122", idempotency_key: CHAVE }).sku_code, "BTG-000122");
    assert.equal(entradaDoInicio({ customer_code: "BTG Pactual", scope: "general", idempotency_key: CHAVE }).scope, "general");
    for (const raw of [
      { customer_code: "BTG Pactual", scope: "aisle", idempotency_key: CHAVE },
      { customer_code: "BTG Pactual", scope: "item", idempotency_key: CHAVE },
      { customer_code: "BTG Pactual", scope: "general", aisle: "A", idempotency_key: CHAVE },
      { customer_code: "BTG Pactual", scope: "aisle", aisle: "A-03", idempotency_key: CHAVE },
      { customer_code: "BTG Pactual", scope: "tudo", idempotency_key: CHAVE },
      { customer_code: "BTG Pactual", scope: "general", idempotency_key: "curta" },
    ]) {
      const erro = recusa(() => entradaDoInicio(raw));
      assert.equal(erro.code, "invalid-argument");
      assert.equal(erro.message, "Contagem inválida: confira o alcance e tente de novo.");
    }
    assert.equal(entradaDaConclusao({ customer_code: "BTG Pactual", round_id: " cr_1 ", idempotency_key: CHAVE }).round_id, "cr_1");
    assert.equal(recusa(() => entradaDaConclusao({ customer_code: "BTG Pactual", idempotency_key: CHAVE })).code, "invalid-argument");
  });
});

function caixa(code: string, location: string, skus: string[], status = "stored", rodada: string | null = null): CaixaDaRodada {
  return { code, status, location_id: location, sku_codes: skus, last_recount_round_id: rodada };
}

const P = "BTG-000122";
const M = "BTG-000123";
const GG = "BTG-000125";

const CAIXAS = [caixa("CX-1", "A-03", [P]), caixa("CX-2", "A-03", [M, GG]), caixa("CX-3", "AB-01", [P]), caixa("CX-4", "B-01", [P], "emptied", "r1"), caixa("CX-5", "B-02", [P], "emptied", "outra")];

describe("o alcance", () => {
  it("a rua é o que vem antes do hífen", () => {
    assert.equal(ruaDaPosicao("A-03"), "A");
    assert.equal(ruaDaPosicao("AB-01"), "AB");
    assert.equal(ruaDaPosicao("RECEBIMENTO"), "");
  });

  it("geral: toda prateleira com caixa; por rua: a rua inteira; por item: a caixa guardada (ou esvaziada nesta rodada) com o item", () => {
    assert.equal(prateleiraNoAlcance({ scope: "general" }, "A-03", CAIXAS, "r1"), true);
    assert.equal(prateleiraNoAlcance({ scope: "aisle", aisle: "A" }, "A-03", CAIXAS, "r1"), true);
    assert.equal(prateleiraNoAlcance({ scope: "aisle", aisle: "A" }, "AB-01", CAIXAS, "r1"), false);
    assert.equal(prateleiraNoAlcance({ scope: "item", sku_code: P }, "A-03", CAIXAS, "r1"), true);
    assert.equal(prateleiraNoAlcance({ scope: "item", sku_code: M }, "AB-01", CAIXAS, "r1"), false);
    assert.equal(prateleiraNoAlcance({ scope: "item", sku_code: P }, "B-01", CAIXAS, "r1"), true);
    assert.equal(prateleiraNoAlcance({ scope: "item", sku_code: P }, "B-02", CAIXAS, "r1"), false);
    assert.equal(prateleiraNoAlcance({ scope: "general" }, "B-02", CAIXAS, "r1"), false);
    assert.equal(prateleiraNoAlcance({ scope: "general" }, "C-01", CAIXAS, "r1"), false);
  });
});

function linha(recontagem: string, box: string, location: string, at: string, sku: string, delta: number, rodada = "r1"): LinhaDaRodada {
  return { box_recount_id: recontagem, box_code: box, location_id: location, occurred_at: at, adjustment_delta: delta, round_id: rodada, actor: { uid: "u1", name: "Guilherme Dantas" } };
}

// CX-1 recontada duas vezes (−3 e depois +3 de volta: a última vale); CX-2 com M −2 e GG +2 (zero no total, mas com
// diferença); CX-4 contada vazia sem diferença (a caixa que já tinha cedido a última peça); CX-3 sem recontagem.
const LINHAS = [
  linha("rec1", "CX-1", "A-03", "2026-11-19T11:00:00.000Z", P, -3),
  linha("rec2", "CX-1", "A-03", "2026-11-19T12:00:00.000Z", P, 3),
  linha("rec3", "CX-2", "A-03", "2026-11-19T12:30:00.000Z", M, -2),
  linha("rec3", "CX-2", "A-03", "2026-11-19T12:30:00.000Z", GG, 2),
  linha("rec4", "CX-4", "B-01", "2026-11-19T13:00:00.000Z", P, 0),
];

describe("os números do fechamento", () => {
  it("a última recontagem de cada caixa, a prateleira contada com todas as caixas, a caixa com diferença pelos itens, a diferença líquida e a primeira recontagem", () => {
    assert.deepEqual(numerosDaRodada(LINHAS, CAIXAS, { scope: "general" }, "r1"), {
      shelves_total: 3,
      shelves_counted: 2,
      boxes_total: 4,
      boxes_counted: 3,
      boxes_with_difference: 2,
      difference_units: 3,
      recount_count: 4,
      primeira: LINHAS[0],
    });
  });

  it("por rua, só as prateleiras da rua entram na conta; as recontagens gravadas contam todas", () => {
    const numeros = numerosDaRodada(LINHAS, CAIXAS, { scope: "aisle", aisle: "A" }, "r1");
    assert.deepEqual([numeros.shelves_total, numeros.shelves_counted, numeros.boxes_total, numeros.boxes_counted, numeros.recount_count], [1, 1, 2, 2, 4]);
  });

  it("a recontagem de outra rodada, e a caixa recontada em outra prateleira, não contam", () => {
    const outras = [...LINHAS, linha("rec5", "CX-3", "AB-01", "2026-11-19T14:00:00.000Z", P, -1, "outra"), linha("rec6", "CX-3", "A-04", "2026-11-19T15:00:00.000Z", P, -1)];
    const numeros = numerosDaRodada(outras, CAIXAS, { scope: "general" }, "r1");
    assert.deepEqual([numeros.boxes_counted, numeros.difference_units, numeros.recount_count], [3, 3, 5]);
  });

  it("sem recontagem: zeros e a primeira null", () => {
    assert.deepEqual(numerosDaRodada([], CAIXAS, { scope: "general" }, "r1"), {
      shelves_total: 3,
      shelves_counted: 0,
      boxes_total: 4,
      boxes_counted: 0,
      boxes_with_difference: 0,
      difference_units: 0,
      recount_count: 0,
      primeira: null,
    });
  });
});

describe("o alcance com caixa guardada (iniciar recusa o alcance vazio)", () => {
  it("geral, por rua e por item: só a caixa guardada conta; a esvaziada, não", () => {
    assert.equal(alcanceTemCaixa({ scope: "general" }, CAIXAS), true);
    assert.equal(alcanceTemCaixa({ scope: "general" }, []), false);
    assert.equal(alcanceTemCaixa({ scope: "aisle", aisle: "AB" }, CAIXAS), true);
    assert.equal(alcanceTemCaixa({ scope: "aisle", aisle: "C" }, CAIXAS), false);
    // Na rua B só há caixas esvaziadas.
    assert.equal(alcanceTemCaixa({ scope: "aisle", aisle: "B" }, CAIXAS), false);
    assert.equal(alcanceTemCaixa({ scope: "item", sku_code: GG }, CAIXAS), true);
    assert.equal(alcanceTemCaixa({ scope: "item", sku_code: "BTG-000200" }, CAIXAS), false);
  });
});

describe("a recontagem geral de 17/11 é do cliente legado", () => {
  function codigo(acao: () => unknown): unknown {
    try {
      acao();
    } catch (error) {
      assert.ok(error instanceof HttpsError, String(error));
      return (error.details as { code?: unknown } | undefined)?.code ?? error.code;
    }
    return "passou";
  }

  it("sem o documento, o id fixo vale só para o cliente legado; com o documento concluído, recusa como concluída", () => {
    assert.equal(codigo(() => conferirRodadaDaRecontagem(null, LEGACY_ROUND_ID, LEGACY_CUSTOMER_CODE, "A-03", [])), "passou");
    assert.equal(codigo(() => conferirRodadaDaRecontagem(null, LEGACY_ROUND_ID, "Outro Cliente", "A-03", [])), "BOX_RECOUNT_ROUND_NOT_FOUND");
    const concluida = { id: LEGACY_ROUND_ID, customer_code: LEGACY_CUSTOMER_CODE, title: LEGACY_ROUND_TITLE, status: "closed", alcance: { scope: "general" as const } };
    assert.equal(codigo(() => conferirRodadaDaRecontagem(concluida, LEGACY_ROUND_ID, LEGACY_CUSTOMER_CODE, "A-03", [caixa("CX-1", "A-03", [P])])), "BOX_RECOUNT_ROUND_CLOSED");
    assert.equal(codigo(() => conferirRodadaDaRecontagem(concluida, LEGACY_ROUND_ID, "Outro Cliente", "A-03", [caixa("CX-1", "A-03", [P])])), "permission-denied");
  });
});
