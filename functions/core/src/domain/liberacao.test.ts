import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HttpsError } from "firebase-functions/https";

import { MEMORIA_AMBIENTES_LIBERADOS, assertLiberado, memoriaLiberada } from "./liberacao.js";

describe("liberação da memória", () => {
  it("só a homologação, até o fim da Fase 5", () => {
    assert.deepEqual([...MEMORIA_AMBIENTES_LIBERADOS], ["dute-homolog"]);
    assert.equal(memoriaLiberada(" dute-homolog "), true);
    for (const projeto of ["dute-prod", "dute-btg", "", null, undefined]) assert.equal(memoriaLiberada(projeto), false, String(projeto));
  });

  it("fora da lista, a callable recusa antes de tudo", () => {
    assert.doesNotThrow(() => assertLiberado("dute-homolog"));
    assert.throws(() => assertLiberado("dute-prod"), (error: unknown) => error instanceof HttpsError && error.code === "failed-precondition" && /dute-prod/.test(error.message));
  });
});
