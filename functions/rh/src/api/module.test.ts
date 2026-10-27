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

// Personal API adapters: the domain actor and the portal collection are observable boundaries.

it("pessoal owner lê sem papel sintético e usa projeção autorizada", async () => {
  const collections: string[] = [];
  const query = { orderBy() { return this; }, where() { return this; }, limit() { return this; }, async get() { return { docs: [], size: 0 }; } };
  const personal = { db: { collection(name: string) { collections.push(name); return query; } }, integration: { id: "personal", delegated_by: "human", kind: "personal", permission: "full", customers: [], scopes: ["rh:ler"], write_policy: "scoped", principal: { uid: "human", role: "owner", customer_code: "A", modules: ["wms", "financeiro"], portal_active: true } }, actor: { uid: "api:personal", role: "owner", name: "Pessoa" } } as unknown as ApiContext;
  const route = rhApi.routes.find(r => r.method === "GET" && r.path.endsWith("/colaboradores"))!;
  await route.run(personal, {}, { method: "GET", path: route.path, headers: {}, query: {} });
  assert.deepEqual(collections, ["collaborators"]);
});

it("matriz pessoal dos onze papéis aplica guardas do adaptador", async () => {
  const allowed: Record<string, string[]> = {"colaboradores": ["owner", "admin", "rh"]};
  for (const role of ["owner", "admin", "interno", "wms", "campo", "comercial", "financeiro", "rh", "suporte", "painel", "cliente"]) {
    for (const [path, roles] of Object.entries(allowed)) {
      const route = rhApi.routes.find(r => r.method === "GET" && r.path.endsWith("/" + path))!;
      const query = { orderBy() { return this; }, where() { return this; }, limit() { return this; }, async get() { return { docs: [], size: 0 }; } };
      const ctx = { db: { collection() { return query; } }, integration: { id: "matrix", kind: "personal", scopes: [route.scope], principal: { uid: "human", role, customer_code: "A", modules: ["wms", "financeiro", "operacao"], portal_active: true } }, actor: { uid: "api:matrix", role } } as unknown as ApiContext;
      const execute = () => route.run(ctx, {}, { method: "GET", path: route.path, headers: {}, query: {} });
      if (roles.includes(role)) assert.deepEqual(await execute(), { data: [], next_cursor: null }, `${role} ${path}`);
      else await assert.rejects(execute(), { code: "permission-denied" }, `${role} ${path}`);
    }
  }
});
it("owner/admin pessoais não gravam RH embora possam consultar", async () => {
  for (const role of ["owner", "admin"]) {
    const route = rhApi.routes.find(r => r.method === "POST" && r.path.endsWith("/registros"))!;
    const ctx = { db: {}, integration: { id: "p", kind: "personal", scopes: [route.scope], principal: { uid: "human", role, modules: [], portal_active: true } }, actor: { uid: "api:p", role } } as unknown as ApiContext;
    await assert.rejects(route.run(ctx, {}, { method: "POST", path: route.path, headers: {}, query: {}, body: {} }), { code: "permission-denied" });
  }
});
