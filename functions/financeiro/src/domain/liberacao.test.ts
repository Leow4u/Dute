import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HttpsError } from "firebase-functions/https";

import { FINANCEIRO_AMBIENTES_LIBERADOS, assertLiberado, financeiroLiberado } from "./liberacao.js";

function refusal(projectId: string | null | undefined): HttpsError {
  try {
    assertLiberado(projectId);
  } catch (error) {
    assert.ok(error instanceof HttpsError, "esperava HttpsError");
    return error;
  }
  assert.fail(`assertLiberado(${String(projectId)}) deveria recusar`);
}

describe("liberação do Financeiro por ambiente", () => {
  it("só a homologação, até o lançamento da Fase 4", () => {
    assert.deepEqual(FINANCEIRO_AMBIENTES_LIBERADOS, ["dute-homolog"]);
    assert.equal(financeiroLiberado("dute-homolog"), true);
    assert.doesNotThrow(() => assertLiberado("dute-homolog"));
  });

  it("produção, produção antiga e projeto de teste recusam", () => {
    for (const projectId of ["dute-prod", "dute-btg", "demo-dute-financeiro", "", null, undefined]) {
      assert.equal(financeiroLiberado(projectId), false, String(projectId));
      const error = refusal(projectId);
      assert.equal(error.code, "failed-precondition");
      assert.match(error.message, /Financeiro ainda não está liberado/);
    }
  });
});
