import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { RH_DATABASE } from "./banco.js";

/**
 * O id do banco segue a regra do Firestore, que só se vê ao criar: o
 * emulador aceita qualquer nome. Em 24/10/2026 o `rh` foi recusado.
 */

describe("o banco do RH", () => {
  it("tem um id que o Firestore aceita: de 4 a 63 caracteres, minúsculas, números e hífen, começando por letra", () => {
    assert.match(RH_DATABASE, /^[a-z][a-z0-9-]{2,61}[a-z0-9]$/);
  });
});
