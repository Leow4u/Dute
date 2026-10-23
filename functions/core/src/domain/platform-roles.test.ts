import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ALERTA_ROLES, alertaProblem, ORCAMENTO_ROLES, orcamentoProblem, PLANEJAMENTO_ROLES, planejamentoProblem, PLATFORM_ROLES } from "./platform-roles.js";

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

  it("a coordenação decide o alerta do item parado ao cliente; o resto, não", () => {
    assert.deepEqual([...ALERTA_ROLES], ["owner", "admin", "interno"]);
    for (const role of ALERTA_ROLES) assert.equal(alertaProblem(role), null, role);
    for (const role of PLATFORM_ROLES.filter((papel) => !(ALERTA_ROLES as readonly string[]).includes(papel))) {
      assert.equal(alertaProblem(role), "Seu perfil não decide o alerta ao cliente.", role);
    }
  });
});
