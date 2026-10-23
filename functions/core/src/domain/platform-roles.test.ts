import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ORCAMENTO_ROLES, PLANEJAMENTO_ROLES, PLATFORM_ROLES, orcamentoProblem, planejamentoProblem } from "./platform-roles.js";

describe("papéis do núcleo", () => {
  it("quem planeja a OS recebe a sugestão; o resto, não", () => {
    assert.deepEqual([...PLANEJAMENTO_ROLES], ["owner", "admin", "interno"]);
    for (const role of PLANEJAMENTO_ROLES) assert.equal(planejamentoProblem(role), null, role);
    for (const role of PLATFORM_ROLES.filter((papel) => !(PLANEJAMENTO_ROLES as readonly string[]).includes(papel))) {
      assert.equal(planejamentoProblem(role), "Seu perfil não planeja OS.", role);
    }
  });

  it("quem orça vê os orçamentos parecidos, com o preço; o resto, não", () => {
    assert.deepEqual([...ORCAMENTO_ROLES], ["owner", "admin", "comercial"]);
    for (const role of ORCAMENTO_ROLES) assert.equal(orcamentoProblem(role), null, role);
    for (const role of PLATFORM_ROLES.filter((papel) => !(ORCAMENTO_ROLES as readonly string[]).includes(papel))) {
      assert.equal(orcamentoProblem(role), "Seu perfil não orça.", role);
    }
  });
});
