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
