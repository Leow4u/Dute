import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PLATFORM_ROLES, RH_ROLES, RH_WRITE_ROLES, isPlatformRole, rhProblem, rhWriteProblem } from "./platform-roles.js";

/** Quem abre e quem grava o RH (pergunta 23): owner e admin leem; só o rh grava. */

describe("papéis do RH", () => {
  it("owner, admin e rh abrem; os outros, não", () => {
    for (const role of PLATFORM_ROLES) {
      assert.equal(rhProblem(role) === null, (RH_ROLES as readonly string[]).includes(role), role);
    }
    assert.deepEqual([...RH_ROLES], ["owner", "admin", "rh"]);
    assert.equal(rhProblem("financeiro"), "Seu perfil não abre o RH.");
  });

  it("só o rh grava: owner e admin leem", () => {
    assert.deepEqual([...RH_WRITE_ROLES], ["rh"]);
    assert.equal(rhWriteProblem("rh"), null);
    for (const role of ["owner", "admin"] as const) assert.equal(rhWriteProblem(role), "Só o RH grava no RH.");
  });

  it("papel fora da lista não vale", () => {
    assert.equal(isPlatformRole("rh"), true);
    assert.equal(isPlatformRole("gerente"), false);
    assert.equal(isPlatformRole(undefined), false);
  });
});
