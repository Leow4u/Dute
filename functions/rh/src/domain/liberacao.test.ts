import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HttpsError } from "firebase-functions/https";

import { RH_AMBIENTES_LIBERADOS, assertLiberado, rhLiberado } from "./liberacao.js";

/** O RH atende na homologação e, desde o lançamento da fase, na produção. */

describe("liberação do RH", () => {
  it("homologação e produção", () => {
    assert.deepEqual([...RH_AMBIENTES_LIBERADOS], ["dute-homolog", "dute-prod"]);
    assert.deepEqual(["dute-homolog", " dute-homolog ", "dute-prod", "dute-btg", "", null, undefined].map(rhLiberado), [true, true, true, false, false, false, false]);
  });

  it("fora dela, a callable recusa antes de tudo, com o ambiente", () => {
    assert.throws(
      () => assertLiberado("dute-btg"),
      (error: unknown) => error instanceof HttpsError && error.code === "failed-precondition" && /dute-btg/.test(error.message),
    );
    assert.throws(() => assertLiberado(""), /projeto não identificado/);
    assert.doesNotThrow(() => assertLiberado("dute-homolog"));
  });
});
