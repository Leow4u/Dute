import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HttpsError } from "firebase-functions/https";

import { OPERACAO_AMBIENTES_LIBERADOS, assertLiberado, operacaoLiberada } from "./liberacao.js";

function refusal(projectId: string | null | undefined): HttpsError {
  try {
    assertLiberado(projectId);
  } catch (error) {
    assert.ok(error instanceof HttpsError, "esperava HttpsError");
    return error;
  }
  assert.fail(`assertLiberado(${String(projectId)}) deveria recusar`);
}

describe("liberação da Operação por ambiente", () => {
  it("só a homologação está na lista", () => {
    assert.deepEqual(OPERACAO_AMBIENTES_LIBERADOS, ["dute-homolog"]);
    assert.equal(operacaoLiberada("dute-homolog"), true);
    assert.doesNotThrow(() => assertLiberado("dute-homolog"));
  });

  it("produção, produção antiga e projeto de teste recusam", () => {
    for (const projectId of ["dute-prod", "dute-btg", "demo-dute-operacao", "", null, undefined]) {
      assert.equal(operacaoLiberada(projectId), false, String(projectId));
      const error = refusal(projectId);
      assert.equal(error.code, "failed-precondition");
      assert.match(error.message, /Operação ainda não está liberada/);
    }
  });
});
