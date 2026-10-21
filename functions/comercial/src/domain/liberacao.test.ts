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
  it("só a homologação está na lista", () => {
    assert.deepEqual(COMERCIAL_AMBIENTES_LIBERADOS, ["dute-homolog"]);
  });

  it("a homologação passa", () => {
    assert.equal(comercialLiberado("dute-homolog"), true);
    assert.doesNotThrow(() => assertLiberado("dute-homolog"));
  });

  it("a produção e a produção antiga recusam com failed-precondition e o nome do projeto", () => {
    for (const projectId of ["dute-prod", "dute-btg"]) {
      assert.equal(comercialLiberado(projectId), false, projectId);
      const error = refusal(projectId);
      assert.equal(error.code, "failed-precondition");
      assert.match(error.message, /Comercial ainda não está liberado/);
      assert.ok(error.message.includes(projectId), error.message);
    }
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
