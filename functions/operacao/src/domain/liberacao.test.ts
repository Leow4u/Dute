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
  it("homologação e produção estão na lista", () => {
    assert.deepEqual(OPERACAO_AMBIENTES_LIBERADOS, ["dute-homolog", "dute-prod"]);
    for (const projectId of ["dute-homolog", "dute-prod"]) {
      assert.equal(operacaoLiberada(projectId), true, projectId);
      assert.doesNotThrow(() => assertLiberado(projectId));
    }
  });

  it("produção antiga e projeto de teste recusam", () => {
    for (const projectId of ["dute-btg", "demo-dute-operacao", "", null, undefined]) {
      assert.equal(operacaoLiberada(projectId), false, String(projectId));
      const error = refusal(projectId);
      assert.equal(error.code, "failed-precondition");
      assert.match(error.message, /Operação ainda não está liberada/);
    }
  });
});
