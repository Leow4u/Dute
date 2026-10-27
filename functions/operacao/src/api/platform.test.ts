import assert from "node:assert/strict";
import { test } from "node:test";
import { forwardPlatform, platformModule } from "./platform.js";
import { matchRoute, policyOf } from "./shared/handler.js";
import { openapi, openapiSchema } from "./openapi.js";
import { API_PERMISSIONS } from "./shared/permissions.js";
import { PLATFORM_ROUTES } from "./shared/manifests.js";

test("política legada não ganha gravação scoped e valor desconhecido é recusado", () => {
  assert.equal(policyOf(undefined), "approval_required"); assert.equal(policyOf("scoped"), "scoped");
  assert.throws(() => policyOf("admin"), /inválida/);
});
test("contrato converte null/required/exclusiveMinimum e documenta todos os escopos implementados", () => {
  assert.deepEqual(openapiSchema({ type: "object", required: [], properties: { x: { anyOf: [{ type: "string" }, { type: "null" }] }, n: { type: "number", exclusiveMinimum: 0 } } }), { type: "object", properties: { x: { type: "string", nullable: true }, n: { type: "number", minimum: 0, exclusiveMinimum: true } } });
  for (const permission of API_PERMISSIONS.filter((p) => p.module !== "operacao")) assert.ok(PLATFORM_ROUTES.some((route) => route.scope === permission.value), permission.value);
  assert.equal(openapi.paths["/api/v1/armazenagem/recebimentos/{id}/itens"].get.responses["200"].content["application/json"].schema.properties.data.type, "array");
  assert.equal(openapi.components.schemas.CreateIntegration.properties.scopes.minItems, 1);
  assert.equal(openapi.components.schemas.CreateIntegration.properties.customers.minItems, 0);
});
test("gateway roteia módulos e aprovações para destinos fixos sem encaminhar cookies", async () => {
  const request = { method: "PATCH", path: "/api/v1/rh/registros/reg_1", query: {}, body: { value: "ok" }, headers: { authorization: "Bearer test", cookie: "private", "idempotency-key": "key" } };
  assert.equal(platformModule(request), "rh");
  assert.equal(platformModule({ ...request, method: "POST", path: `/api/v1/integrations/${"a".repeat(32)}/approvals`, body: { path: "/api/v1/comercial/clientes" } }), "comercial");
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = (async (url: URL | string | Request, init?: RequestInit) => {
    calls++; assert.equal(String(url), "https://southamerica-east1-dute-prod.cloudfunctions.net/duteRhApi/api/v1/rh/registros/reg_1");
    assert.equal(new Headers(init?.headers).get("cookie"), null); assert.equal(init?.redirect, "error");
    return new Response(JSON.stringify({ data: { ok: true } }), { status: 200 });
  }) as typeof fetch;
  try { assert.equal((await forwardPlatform("dute-prod", "rh", request)).status, 200); assert.equal(calls, 1); }
  finally { globalThis.fetch = original; }
});
test("identificador codificado não vira caminho de outro recurso", () => {
  const definition = { module: "rh", released: () => true, routes: [{ method: "GET" as const, path: "/api/v1/rh/registros/{id}", scope: "rh:ler" as const, role: "rh" as const, summary: "x", run: async () => ({ data: [] }) }] };
  assert.throws(() => matchRoute(definition, "GET", "/api/v1/rh/registros/%2fusers"), /inválido/);
});

test("proxy recusa travessia literal, codificada e duplamente codificada sem encaminhar credencial", async () => {
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = (async () => { calls++; return new Response(JSON.stringify({ data: {} })); }) as typeof fetch;
  try {
    for (const attack of ["../../../../duteApi/api/v1/openapi.json", "%2e%2e/%2e%2e/%2e%2e/%2e%2e/duteApi/api/v1/openapi.json", "%252e%252e/other", "%2fother", "id?redirect=other"]) {
      await assert.rejects(forwardPlatform("dute-prod", "comercial", { method: "GET", path: `/api/v1/comercial/${attack}`, query: {}, headers: { authorization: "Bearer sentinel" } }), /Caminho inválido/);
    }
    assert.equal(calls, 0);
  } finally { globalThis.fetch = original; }
});
