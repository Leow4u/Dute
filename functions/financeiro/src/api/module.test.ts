import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Firestore } from "firebase-admin/firestore";
import { financeiroApi } from "./module.js";
import type { ApiContext, ApiRequest } from "./shared/core.js";

const context = (scopes: string[]): ApiContext => ({ db: {} as Firestore, project: "dute-homolog", integration: { id: "fin", delegated_by: "human", customers: ["ITAU"], scopes, write_policy: "scoped" }, actor: { uid: "api:fin", role: "financeiro", name: "Integração" }, idempotencyKey: "isolated" });
const run = async (method: string, suffix: string, body?: unknown, scopes: string[] = [], query = {}) => {
  const route = financeiroApi.routes.find(route => route.method === method && route.path === `/api/v1/financeiro${suffix}`)!;
  const request: ApiRequest = { method, path: route.path, headers: {}, query, body };
  return route.run(context(scopes), { id: `fat_${"a".repeat(24)}` }, request);
};
const error = (code: string) => (e: unknown) => (e as { code: string }).code === code;

describe("Financeiro REST: contrato e fronteiras antes de acesso ao banco", () => {
  it("expõe apenas consultas, registro externo, envio e recebimento", () => {
    assert.equal(financeiroApi.routes.length, 8);
    assert.ok(financeiroApi.routes.every(route => route.role === "financeiro"));
    assert.ok(financeiroApi.routes.every(route => !/omie|estorno|cancel|reverse/.test(route.path)));
    assert.equal(financeiroApi.released("dute-btg"), false);
    assert.equal(financeiroApi.released("dute-homolog"), true);
  });
  it("nega leitura e todas as mutações sem seus escopos", async () => {
    for (const route of financeiroApi.routes) await assert.rejects(run(route.method, route.path.replace("/api/v1/financeiro", ""), {}), error("permission-denied"));
  });
  it("exige tenant explícito em todas as listagens", async () => {
    for (const route of financeiroApi.routes.filter(route => route.method === "GET")) await assert.rejects(run("GET", route.path.replace("/api/v1/financeiro", ""), undefined, ["financeiro:ler"]), error("permission-denied"));
  });
  it("recusa tenant não autorizado, paginação ilimitada e filtros arbitrários", async () => {
    await assert.rejects(run("GET", "/a-faturar", undefined, ["financeiro:ler"], { customer_code: "SAFRA" }), error("permission-denied"));
    await assert.rejects(run("GET", "/a-faturar", undefined, ["financeiro:ler"], { customer_code: "ITAU", limit: 101 }), error("invalid-argument"));
    await assert.rejects(run("GET", "/a-faturar", undefined, ["financeiro:ler"], { customer_code: "ITAU", status: "paga" }), error("invalid-argument"));
  });
  it("recusa customer_code/status injetados no registro", async () => {
    const body = { demandas: ["10045"], nf: { numero: "1", emitida_em: "2026-10-01" }, vencimento: "2026-10-31", forma: "pix" };
    for (const extra of [{ customer_code: "ITAU" }, { status: "paga" }, { idempotency_key: "injected" }]) await assert.rejects(run("POST", "/faturas", { ...body, ...extra }, ["financeiro:faturas:gravar"]), error("invalid-argument"));
  });
  it("rotas fixam ação e fatura e não admitem estorno, cancelamento ou edição de saldo", async () => {
    for (const [method, path, scope] of [["PATCH", "/faturas/{id}/cobranca", "financeiro:cobrancas:gravar"], ["POST", "/faturas/{id}/pagamentos", "financeiro:pagamentos:registrar"]]) {
      for (const body of [{ acao: "cancel" }, { acao: "reverse_payment" }, { fatura_id: "other" }, { status: "paga" }, { recebido_cents: 1 }]) await assert.rejects(run(method, path, body, [scope]), error("invalid-argument"));
    }
  });
});
