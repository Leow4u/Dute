import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PLATFORM_ROLES, WMS_ROLES, isPlatformRole, wmsAccessProblem } from "./platform-roles.js";

describe("papéis da plataforma", () => {
  it("são os 11 do plano", () => {
    assert.deepEqual(PLATFORM_ROLES, [
      "owner",
      "admin",
      "interno",
      "wms",
      "campo",
      "comercial",
      "financeiro",
      "rh",
      "suporte",
      "painel",
      "cliente",
    ]);
    for (const role of PLATFORM_ROLES) assert.equal(isPlatformRole(role), true);
    assert.equal(isPlatformRole("viewer"), false);
    assert.equal(isPlatformRole(undefined), false);
  });
});

describe("acesso às callables do WMS", () => {
  it("a equipe do WMS continua entrando", () => {
    for (const role of ["owner", "admin", "interno", "wms", "financeiro", "suporte"] as const) {
      assert.equal(wmsAccessProblem(role, null), null, role);
    }
  });

  it("papel novo é negado por padrão", () => {
    for (const role of ["campo", "comercial", "rh", "painel"] as const) {
      assert.match(wmsAccessProblem(role, null) ?? "", /ainda não tem acesso/, role);
      assert.equal((WMS_ROLES as readonly string[]).includes(role), false);
    }
  });

  it("cliente precisa de armazenagem no contrato", () => {
    assert.equal(wmsAccessProblem("cliente", ["wms", "financeiro"]), null);
    assert.equal(wmsAccessProblem("cliente", ["wms"]), null);
    assert.match(wmsAccessProblem("cliente", ["operacao"]) ?? "", /não inclui armazenagem/);
    assert.match(wmsAccessProblem("cliente", ["financeiro"]) ?? "", /não inclui armazenagem/);
    assert.match(wmsAccessProblem("cliente", null) ?? "", /não inclui armazenagem/);
  });

  it("cliente com o portal desligado (arquivado ou \"Sem portal\") é recusado antes do contrato", () => {
    assert.equal(wmsAccessProblem("cliente", ["wms"], false), "O portal do seu cliente está desligado.");
    assert.equal(wmsAccessProblem("cliente", ["operacao"], false), "O portal do seu cliente está desligado.");
    assert.equal(wmsAccessProblem("cliente", ["wms"], true), null);
    // O portal é do cliente: a equipe não depende dele.
    assert.equal(wmsAccessProblem("interno", null, false), null);
  });
});
