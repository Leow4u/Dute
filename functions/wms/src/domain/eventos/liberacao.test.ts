import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { assertEventosLiberado, eventosLiberado } from "./liberacao.js";

/**
 * A liberação por ambiente dos Eventos (eventos, parte 1), sem o banco. A
 * lista é a cópia de EVENTOS_AMBIENTES_LIBERADOS do app, travada pelo
 * platform-lists.test.ts de lá.
 */

const FRASE = "Eventos ainda não liberados neste ambiente.";

describe("a liberação dos Eventos por ambiente", () => {
  it("só a homologação atende; a produção, o dute-btg e o projeto sem nome não", () => {
    assert.equal(eventosLiberado("dute-homolog"), true);
    assert.equal(eventosLiberado("dute-prod"), false);
    assert.equal(eventosLiberado("dute-btg"), false);
    assert.equal(eventosLiberado(undefined), false);
    assert.equal(eventosLiberado(""), false);
  });

  it("fora da liberação a callable recusa com failed-precondition e a frase; na homologação, segue", () => {
    assert.throws(() => assertEventosLiberado("dute-prod"), { code: "failed-precondition", message: FRASE });
    assert.throws(() => assertEventosLiberado(undefined), { code: "failed-precondition", message: FRASE });
    assert.doesNotThrow(() => assertEventosLiberado("dute-homolog"));
  });
});
