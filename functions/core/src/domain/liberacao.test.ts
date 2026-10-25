import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HttpsError } from "firebase-functions/https";

import { MEMORIA_AMBIENTES_LIBERADOS, assertLiberado, memoriaLiberada } from "./liberacao.js";

describe("liberação da memória", () => {
  it("homologação e produção, desde o lançamento da Fase 5", () => {
    assert.deepEqual([...MEMORIA_AMBIENTES_LIBERADOS], ["dute-homolog", "dute-prod"]);
    assert.equal(memoriaLiberada(" dute-homolog "), true);
    assert.equal(memoriaLiberada("dute-prod"), true);
    for (const projeto of ["dute-btg", "", null, undefined]) assert.equal(memoriaLiberada(projeto), false, String(projeto));
  });

  it("fora da lista, a callable recusa antes de tudo", () => {
    assert.doesNotThrow(() => assertLiberado("dute-homolog"));
    assert.doesNotThrow(() => assertLiberado("dute-prod"));
    assert.throws(() => assertLiberado("dute-btg"), (error: unknown) => error instanceof HttpsError && error.code === "failed-precondition" && /dute-btg/.test(error.message));
  });
});
