import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { OPERACAO_CADASTRO_ROLES, PLATFORM_ROLES, operacaoCadastroProblem } from "./platform-roles.js";

describe("papéis do cadastro da Operação", () => {
  it("a plataforma tem os 11 papéis e o cadastro é de owner, admin e interno", () => {
    assert.equal(PLATFORM_ROLES.length, 11);
    assert.deepEqual(OPERACAO_CADASTRO_ROLES, ["owner", "admin", "interno"]);
  });

  it("campo, suporte, comercial e cliente não gravam", () => {
    for (const role of OPERACAO_CADASTRO_ROLES) assert.equal(operacaoCadastroProblem(role), null, role);
    for (const role of ["campo", "suporte", "comercial", "wms", "financeiro", "rh", "painel", "cliente"] as const) {
      assert.match(operacaoCadastroProblem(role) ?? "", /não grava/, role);
    }
  });
});
