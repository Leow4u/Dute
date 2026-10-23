import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { OPERACAO_CADASTRO_ROLES, PLATFORM_ROLES, contractedModulesFrom, operacaoCadastroProblem } from "./platform-roles.js";

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

describe("módulos contratados do cliente (parte 4.4a)", () => {
  it("sem a lista ou sem módulo conhecido vale o padrão, que não inclui a Operação", () => {
    assert.deepEqual(contractedModulesFrom(undefined), ["wms", "financeiro"]);
    assert.deepEqual(contractedModulesFrom(["rh"]), ["wms", "financeiro"]);
    assert.deepEqual(contractedModulesFrom(["operacao", "x"]), ["operacao"]);
    assert.deepEqual(contractedModulesFrom(["financeiro", "operacao", "wms"]), ["wms", "operacao", "financeiro"]);
  });
});
