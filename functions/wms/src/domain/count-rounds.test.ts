import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HttpsError } from "firebase-functions/https";

import {
  LEGACY_ROUND_ID,
  LEGACY_ROUND_TITLE,
  alcanceTemCaixa,
  caixaDaRodada,
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
// diferença); CX-4 contada vazia nesta rodada, com a linha do item; CX-3 sem recontagem.
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

  // A caixa guardada sem nada na lista (a que cede a última peça ao fora da lista de outra, decisão de 17/11/2026, ou a
  // da abertura que perdeu as linhas) se reconta com a lista vazia, e a recontagem não grava linha em `cycle_counts`
  // (não há item): o registro fica na própria caixa (box-recount.ts). Antes, ela entrava no total da prateleira e nunca
  // como confirmada: a A-01 e a A-02 da recontagem geral de 17/11 ficaram "em contagem" com todas as caixas contadas.
  it("a caixa que a rodada esvaziou com a lista vazia, sem linha, conta como confirmada e sem diferença, pelo registro dela", () => {
    const vazia = caixaDaRodada("CX-6", {
      code: "CX-6",
      status: "emptied",
      location_id: "C-01",
      sku_codes: [P],
      last_recount_id: "rec6",
      last_recounted_at: "2026-11-19T14:00:00.000Z",
      last_recounted_by: { uid: "u2", role: "wms", name: "Rafael" },
      last_recount_round_id: "r1",
      emptied_recount_id: "rec6",
    });
    const linhas = [linha("rec7", "CX-7", "C-01", "2026-11-19T13:30:00.000Z", P, -1)];
    assert.deepEqual(numerosDaRodada(linhas, [vazia, caixa("CX-7", "C-01", [P])], { scope: "general" }, "r1"), {
      shelves_total: 1,
      shelves_counted: 1,
      boxes_total: 2,
      boxes_counted: 2,
      boxes_with_difference: 1,
      difference_units: -1,
      recount_count: 2,
      primeira: linhas[0],
    });
  });

  it("o registro da caixa não conta duas vezes nem confirma o que não foi contado vazio nesta rodada", () => {
    const registro = (code: string, status: string, rodada: string, extra: Record<string, unknown> = {}) =>
      caixaDaRodada(code, { code, status, location_id: "C-01", sku_codes: [P], last_recount_id: `rec-${code}`, last_recounted_at: "2026-11-19T14:00:00.000Z", last_recount_round_id: rodada, ...extra });
    // Esvaziada pela recontagem com a linha do item: a linha já diz tudo, e a recontagem conta uma vez.
    const comLinha = registro("CX-8", "emptied", "r1", { emptied_recount_id: "rec-CX-8" });
    // Esvaziada pela separação depois da recontagem desta rodada: vale a linha daquela recontagem, com a diferença dela.
    const separada = registro("CX-9", "emptied", "r1");
    // A que o desfazer da separação devolveu à prateleira depois de a recontagem a dar por vazia: guardada, por contar.
    const devolvida = registro("CX-10", "stored", "r1");
    // A que outra rodada esvaziou não é desta.
    const deOutra = registro("CX-11", "emptied", "outra", { emptied_recount_id: "rec-CX-11" });
    const linhas = [linha("rec-CX-8", "CX-8", "C-01", "2026-11-19T14:00:00.000Z", P, -2), linha("rec-CX-9", "CX-9", "C-01", "2026-11-19T13:00:00.000Z", P, -1)];
    const numeros = numerosDaRodada(linhas, [comLinha, separada, devolvida, deOutra], { scope: "general" }, "r1");
    assert.deepEqual(
      [numeros.shelves_total, numeros.shelves_counted, numeros.boxes_total, numeros.boxes_counted, numeros.boxes_with_difference, numeros.difference_units, numeros.recount_count],
      [1, 0, 3, 2, 2, -3, 2],
    );
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
