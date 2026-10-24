import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HttpsError } from "firebase-functions/https";

import { RH_AMBIENTES_LIBERADOS, assertLiberado, rhLiberado } from "./liberacao.js";

/** O RH só atende na homologação até o lançamento da fase. */

describe("liberação do RH", () => {
  it("só a homologação", () => {
    assert.deepEqual([...RH_AMBIENTES_LIBERADOS], ["dute-homolog"]);
    assert.deepEqual(["dute-homolog", " dute-homolog ", "dute-prod", "dute-btg", "", null, undefined].map(rhLiberado), [true, true, false, false, false, false, false]);
  });

  it("fora dela, a callable recusa antes de tudo, com o ambiente", () => {
    assert.throws(
      () => assertLiberado("dute-prod"),
      (error: unknown) => error instanceof HttpsError && error.code === "failed-precondition" && /dute-prod/.test(error.message),
    );
    assert.throws(() => assertLiberado(""), /projeto não identificado/);
    assert.doesNotThrow(() => assertLiberado("dute-homolog"));
  });
});
