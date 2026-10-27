import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { rhApi } from "./module.js";
import type { ApiContext } from "./shared/core.js";

describe("contrato REST RH", () => {
  it("documenta exatamente as rotas, escopos e recursos globais implementados", () => {
    const manifest = JSON.parse(readFileSync(new URL("../../src/api/routes.json", import.meta.url), "utf8"));
    assert.deepEqual(manifest.map((r: {method: string;path: string;scope: string}) => `${r.method} ${r.path} ${r.scope}`).sort(), rhApi.routes.map((r) => `${r.method} ${r.path} ${r.scope}`).sort());
    assert.ok(manifest.every((r: {customerRequired: boolean}) => r.customerRequired === false));
    assert.ok(rhApi.routes.every((r) => r.role === "rh"));
    assert.equal(rhApi.released("dute-btg"), false);
    assert.equal(rhApi.released("dute-prod"), true);
  });

  for (const route of rhApi.routes) {
    it(`${route.method} ${route.path} recusa escopo antes de acessar os bancos`, async () => {
      const ctx = { integration: { id: "i", scopes: [] }, actor: { uid: "api:i", role: "rh" } } as unknown as ApiContext;
      await assert.rejects(route.run(ctx, { id: "qualquer" }, { method: route.method, path: route.path, headers: {}, query: {} }), { code: "permission-denied" });
    });
  }

  it("não aceita identidade humana ou papel elevado no adaptador", async () => {
    const route = rhApi.routes[0];
    for (const actor of [{ uid: "owner", role: "rh" }, { uid: "api:i", role: "owner" }]) {
      const ctx = { integration: { id: "i", scopes: [route.scope] }, actor } as unknown as ApiContext;
      await assert.rejects(route.run(ctx, {}, { method: "GET", path: route.path, headers: {}, query: {} }), { code: "permission-denied" });
    }
  });
});
