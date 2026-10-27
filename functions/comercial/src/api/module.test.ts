import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { comercialApi, projectComercial } from "./module.js";
import type { ApiContext } from "./shared/core.js";

const context = { integration: { scopes: ["comercial:clientes:gravar"], customers: ["ACME"] } } as ApiContext;
test("Comercial API recusa action injetada antes de acessar o banco", async () => {
  const route = comercialApi.routes.find(r => r.method === "POST" && r.path === "/api/v1/comercial/clientes")!;
  await assert.rejects(route.run(context, {}, { method: "POST", path: route.path, query: {}, headers: {}, body: { code: "ACME", name: "Acme", action: "archive" } }), /não aceito/);
});
test("Comercial API recusa código futuro fora dos clientes da chave", async () => {
  const route = comercialApi.routes.find(r => r.method === "POST" && r.path === "/api/v1/comercial/clientes")!;
  await assert.rejects(route.run(context, {}, { method: "POST", path: route.path, query: {}, headers: {}, body: { code: "OTHER", name: "Outro" } }), /Cliente fora/);
});
test("Comercial API declara somente escopos comerciais e papel mínimo", () => {
  assert.ok(comercialApi.routes.length >= 25);
  for (const route of comercialApi.routes) {
    assert.equal(route.role, "comercial");
    assert.ok(route.scope.startsWith("comercial:"));
    assert.ok(!/approve|archive|delete|cancel/.test(route.path));
  }
});

test("Comercial API manifesto corresponde exatamente às rotas e schemas fechados", () => {
  const manifest = JSON.parse(readFileSync(new URL("../../src/api/routes.json", import.meta.url), "utf8")) as Array<{ method: string; path: string; scope: string; summary: string; requestSchema?: { additionalProperties: boolean; properties: Record<string, unknown> } }>;
  assert.deepEqual(manifest.map(r => `${r.method} ${r.path}`).sort(), comercialApi.routes.map(r => `${r.method} ${r.path}`).sort());
  for (const route of comercialApi.routes) {
    const entry = manifest.find(r => r.method === route.method && r.path === route.path)!;
    assert.equal(entry.scope, route.scope);
    assert.equal(entry.summary, route.summary);
    if (route.method !== "GET") {
      assert.equal(entry.requestSchema?.additionalProperties, false);
      for (const key of ["action", "acao", "request_id", "idempotency_key"]) assert.ok(!(key in entry.requestSchema!.properties));
    }
  }
});
test("Comercial API projeta objetos e mapas aninhados sem campos extras", () => {
  assert.deepEqual(projectComercial({ name: "Acme", secret: "x", comercial: { cidade: "SP", omie_ids: ["secret"] }, avisos: ["os_agendada", { secret: "x" }], precos: { sku: { preco: "1.00", secret: "x" } } }, { name: true, comercial: { cidade: true }, avisos: true, precos: { "*": { preco: true } } }), { name: "Acme", comercial: { cidade: "SP" }, avisos: ["os_agendada"], precos: { sku: { preco: "1.00" } } });
});

// Personal API adapters: the domain actor and the portal collection are observable boundaries.

test("pessoal owner lê sem papel sintético e usa projeção autorizada", async () => {
  const collections: string[] = [];
  const query = { orderBy() { return this; }, where() { return this; }, limit() { return this; }, async get() { return { docs: [], size: 0 }; } };
  const personal = { db: { collection(name: string) { collections.push(name); return query; } }, integration: { id: "personal", delegated_by: "human", kind: "personal", permission: "full", customers: [], scopes: ["comercial:ler"], write_policy: "scoped", principal: { uid: "human", role: "owner", customer_code: "A", modules: ["wms", "financeiro"], portal_active: true } }, actor: { uid: "api:personal", role: "owner", name: "Pessoa" } } as unknown as ApiContext;
  const route = comercialApi.routes.find(r => r.method === "GET" && r.path.endsWith("/contratos"))!;
  await route.run(personal, {}, { method: "GET", path: route.path, headers: {}, query: {} });
  assert.deepEqual(collections, ["contracts"]);
});

test("matriz pessoal dos onze papéis aplica guardas do adaptador", async () => {
  const allowed: Record<string, string[]> = {"clientes": ["owner", "admin", "comercial"], "contratos": ["owner", "admin", "comercial", "financeiro"], "demandas": ["owner", "admin", "interno", "comercial", "financeiro"], "locais": ["owner", "admin", "interno", "comercial"]};
  for (const role of ["owner", "admin", "interno", "wms", "campo", "comercial", "financeiro", "rh", "suporte", "painel", "cliente"]) {
    for (const [path, roles] of Object.entries(allowed)) {
      const route = comercialApi.routes.find(r => r.method === "GET" && r.path.endsWith("/" + path))!;
      const query = { orderBy() { return this; }, where() { return this; }, limit() { return this; }, async get() { return { docs: [], size: 0 }; } };
      const ctx = { db: { collection() { return query; } }, integration: { id: "matrix", kind: "personal", scopes: [route.scope], principal: { uid: "human", role, customer_code: "A", modules: ["wms", "financeiro", "operacao"], portal_active: true } }, actor: { uid: "api:matrix", role } } as unknown as ApiContext;
      const execute = () => route.run(ctx, {}, { method: "GET", path: route.path, headers: {}, query: {} });
      if (roles.includes(role)) assert.deepEqual(await execute(), { data: [], next_cursor: null }, `${role} ${path}`);
      else await assert.rejects(execute(), { code: "permission-denied" }, `${role} ${path}`);
    }
  }
});
