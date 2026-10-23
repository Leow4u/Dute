import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { FINANCEIRO_ROLES, PLATFORM_ROLES, financeiroProblem } from "./platform-roles.js";

describe("papéis do Financeiro", () => {
  it("a plataforma tem os 11 papéis e o Financeiro é de owner, admin e financeiro", () => {
    assert.equal(PLATFORM_ROLES.length, 11);
    assert.deepEqual(FINANCEIRO_ROLES, ["owner", "admin", "financeiro"]);
  });

  it("a operação, o campo, o comercial, o suporte, o painel e o cliente não gravam", () => {
    for (const role of FINANCEIRO_ROLES) assert.equal(financeiroProblem(role), null, role);
    for (const role of ["interno", "wms", "campo", "comercial", "rh", "suporte", "painel", "cliente"] as const) {
      assert.equal(financeiroProblem(role), "Seu perfil não grava no Financeiro.", role);
    }
  });
});
