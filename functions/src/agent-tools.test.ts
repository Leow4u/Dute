import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AGENT_TOOL_NAMES, agentToolsForRole } from "./domain/agent-dute.js";

describe("consultas do Agent Dute por papel", () => {
  it("WMS não consulta faturas", () => {
    assert.equal(agentToolsForRole("wms").includes("faturas"), false);
    assert.equal(agentToolsForRole("wms").length, AGENT_TOOL_NAMES.length - 1);
  });

  it("cliente, financeiro e coordenação consultam tudo", () => {
    for (const role of ["cliente", "financeiro", "owner", "admin", "interno", "suporte"]) {
      assert.deepEqual(agentToolsForRole(role), [...AGENT_TOOL_NAMES]);
    }
  });
});
