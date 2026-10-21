import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HttpsError } from "firebase-functions/https";

import { COMERCIAL_AMBIENTES_LIBERADOS, assertLiberado, comercialLiberado } from "./liberacao.js";

function refusal(projectId: string | null | undefined): HttpsError {
  try {
    assertLiberado(projectId);
  } catch (error) {
    assert.ok(error instanceof HttpsError, "esperava HttpsError");
    return error;
  }
  assert.fail(`assertLiberado(${String(projectId)}) deveria recusar`);
}

describe("liberação do Comercial por ambiente", () => {
  it("homologação e produção estão na lista", () => {
    assert.deepEqual(COMERCIAL_AMBIENTES_LIBERADOS, ["dute-homolog", "dute-prod"]);
  });

  it("a homologação e a produção passam", () => {
    for (const projectId of ["dute-homolog", "dute-prod"]) {
      assert.equal(comercialLiberado(projectId), true, projectId);
      assert.doesNotThrow(() => assertLiberado(projectId));
    }
  });

  it("a produção antiga recusa com failed-precondition e o nome do projeto", () => {
    assert.equal(comercialLiberado("dute-btg"), false);
    const error = refusal("dute-btg");
    assert.equal(error.code, "failed-precondition");
    assert.match(error.message, /Comercial ainda não está liberado/);
    assert.match(error.message, /dute-btg/);
  });

  it("projeto desconhecido, de teste ou vazio também recusa", () => {
    for (const projectId of ["demo-dute-comercial", "outro-projeto", "", "   ", null, undefined]) {
      assert.equal(comercialLiberado(projectId), false, String(projectId));
      assert.equal(refusal(projectId).code, "failed-precondition");
    }
  });

  it("espaço em volta do nome não muda a resposta", () => {
    assert.equal(comercialLiberado(" dute-homolog "), true);
  });
});
