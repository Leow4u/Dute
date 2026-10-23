import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PLANEJAMENTO_ROLES, PLATFORM_ROLES, planejamentoProblem } from "./platform-roles.js";

describe("papéis do núcleo", () => {
  it("quem planeja a OS recebe a sugestão; o resto, não", () => {
    assert.deepEqual([...PLANEJAMENTO_ROLES], ["owner", "admin", "interno"]);
    for (const role of PLANEJAMENTO_ROLES) assert.equal(planejamentoProblem(role), null, role);
    for (const role of PLATFORM_ROLES.filter((papel) => !(PLANEJAMENTO_ROLES as readonly string[]).includes(papel))) {
      assert.equal(planejamentoProblem(role), "Seu perfil não planeja OS.", role);
    }
  });
});
