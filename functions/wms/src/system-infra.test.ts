import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  billingQuery,
  codeFunctions,
  deployedFunction,
  errorsFilter,
  functionsStatus,
  groupErrors,
  hasPublicInvoker,
  InfraSettingsSchema,
  invoiceMonth,
  parseBillingResponse,
  summarizeBilling,
  type LogEntry,
} from "./domain/system-infra.js";

const REQUESTS = "projects/dute-btg/logs/run.googleapis.com%2Frequests";
const STDERR = "projects/dute-btg/logs/run.googleapis.com%2Fstderr";

function entry(service: string, at: string, patch: Partial<LogEntry> = {}): LogEntry {
  return { timestamp: at, severity: "ERROR", logName: STDERR, resource: { labels: { service_name: service } }, ...patch };
}

describe("painel do sistema: erros do servidor", () => {
  it("agrupa por function e primeira linha da mensagem; 403 na borda conta como bloqueada", () => {
    const summary = groupErrors([
      entry("readshipmentinvoice", "2026-10-03T12:12:00Z", { textPayload: "Error: PDF sem texto legível\n    at parse (/workspace/lib/x.js:10:3)" }),
      entry("readshipmentinvoice", "2026-10-02T21:40:00Z", { textPayload: "Error: PDF sem texto legível\n    at parse (/workspace/lib/x.js:12:9)" }),
      entry("runagentroutines", "2026-10-03T10:30:00Z", { jsonPayload: { message: "RESOURCE_EXHAUSTED: quota" } }),
      entry("saveagentcostsettings", "2026-10-03T01:31:00Z", { logName: REQUESTS, severity: "WARNING", httpRequest: { status: 403 } }),
      entry("saveagentcostsettings", "2026-10-03T01:32:00Z", { logName: REQUESTS, severity: "WARNING", httpRequest: { status: 403 } }),
    ]);
    assert.equal(summary.total, 3);
    assert.equal(summary.blocked, 2);
    assert.equal(summary.services, 2);
    assert.deepEqual(
      summary.groups.map((group) => [group.service, group.count, group.blocked]),
      [
        ["readshipmentinvoice", 2, false],
        ["runagentroutines", 1, false],
        ["saveagentcostsettings", 2, true],
      ],
    );
    const pdf = summary.groups[0]!;
    assert.equal(pdf.message, "Error: PDF sem texto legível");
    assert.equal(pdf.first_at, "2026-10-02T21:40:00Z");
    assert.equal(pdf.last_at, "2026-10-03T12:12:00Z");
    assert.match(summary.groups[2]!.message, /403 antes do código rodar/);
  });

  it("auditoria do Google Cloud: lê a function e o status (02/10, add-iam-policy-binding em function que não existia)", () => {
    const audit = (resource: string): LogEntry => ({
      timestamp: "2026-10-02T22:20:00Z",
      severity: "ERROR",
      logName: "projects/dute-btg/logs/cloudaudit.googleapis.com%2Factivity",
      resource: { labels: { service_name: "" } },
      protoPayload: {
        methodName: "google.cloud.run.v1.Services.SetIamPolicy",
        resourceName: `namespaces/dute-btg/services/${resource}`,
        status: { message: `Resource '${resource}' of kind 'SERVICE' in region 'southamerica-east1' in project 'dute-btg' does not exist.` },
      },
    });
    const noResource = audit("getsystemdashboard");
    delete noResource.protoPayload!.resourceName;
    const summary = groupErrors([audit("saveagentcostsettings"), audit("saveagentcostsettings"), noResource]);
    assert.deepEqual(
      summary.groups.map((group) => [group.service, group.count, group.admin]),
      [
        ["saveagentcostsettings", 2, true],
        ["getsystemdashboard", 1, true],
      ],
    );
    // Mensagem longa do Google Cloud vira uma frase curta; a desconhecida passa como veio.
    assert.equal(summary.groups[0]!.message, "SetIamPolicy: o serviço não existia (function não publicada)");
    const other = groupErrors([{ ...audit("x"), protoPayload: { methodName: "google.cloud.run.v1.Services.ReplaceService", status: { message: "Revision failed to become ready." } } }]);
    assert.equal(other.groups[0]!.message, "ReplaceService: Revision failed to become ready.");
    assert.equal(summary.total, 3);
  });

  it("mensagem de várias linhas (ZodError) junta as linhas sem a pilha", () => {
    const zod = entry("decideagentnote", "2026-10-02T13:09:00Z", {
      textPayload: 'Unhandled error ZodError: [\n  {\n    "code": "invalid_type",\n    "path": ["note_id"],\n    "message": "Required"\n  }\n]\n    at Object.parse (/workspace/node_modules/zod/lib/types.js:1:1)',
    });
    const summary = groupErrors([zod]);
    assert.equal(summary.groups[0]!.message, 'Unhandled error ZodError: [ { "code": "invalid_type", "path": ["note_id"], "message": "Required" } ]');
    const long = entry("x", "2026-10-02T13:09:00Z", { textPayload: "a".repeat(500) });
    assert.equal(groupErrors([long]).groups[0]!.message.length, 240);
  });

  it("o filtro pega ERROR das functions e 403 de requisição, sem repetir o 5xx", () => {
    const filter = errorsFilter(new Date("2026-10-02T15:00:00Z"));
    assert.match(filter, /timestamp>="2026-10-02T15:00:00.000Z"/);
    assert.match(filter, /severity>=ERROR AND NOT log_id\("run.googleapis.com\/requests"\)/);
    assert.match(filter, /httpRequest.status=403/);
  });
});

describe("painel do sistema: functions publicadas", () => {
  const code = [
    { name: "getSystemDashboard", callable: true },
    { name: "saveAgentCostSettings", callable: true },
    { name: "listAgentRoutines", callable: true },
    { name: "runAgentRoutines", callable: false },
    { name: "saveAgentRoutine", callable: true },
  ];
  const deployed = [
    { name: "saveAgentCostSettings", state: "ACTIVE", updated_at: "2026-10-03T01:37:00Z", service: "saveagentcostsettings", codebase: "default", callable: true },
    { name: "listAgentRoutines", state: "ACTIVE", updated_at: "2026-10-02T12:00:00Z", service: "listagentroutines", codebase: "default", callable: true },
    { name: "runAgentRoutines", state: "ACTIVE", updated_at: "2026-10-02T12:00:00Z", service: "runagentroutines", codebase: "default", callable: false },
    { name: "saveAgentRoutine", state: "FAILED", updated_at: "2026-10-02T12:00:00Z", service: "saveagentroutine", codebase: "default", callable: true },
  ];
  const invoker = new Map([
    ["saveagentcostsettings", false],
    ["listagentroutines", true],
  ]);

  it("mesmo critério do check_functions_invoker: não publicada, sem acesso, ok", () => {
    const status = functionsStatus(code, deployed, invoker, "dute-btg", "southamerica-east1");
    assert.deepEqual(
      status.list.map((row) => [row.name, row.status]),
      [
        ["getSystemDashboard", "nao_publicada"],
        ["saveAgentRoutine", "nao_publicada"],
        ["saveAgentCostSettings", "sem_acesso"],
        ["listAgentRoutines", "ok"],
        // agendada não precisa de invoker público
        ["runAgentRoutines", "ok"],
      ],
    );
    assert.deepEqual([status.total, status.ok, status.sem_acesso, status.nao_publicada], [5, 2, 1, 2]);
    assert.equal(status.list[0]!.fix, "firebase deploy --only functions:getSystemDashboard --project dute-btg");
    assert.equal(status.list[1]!.state, "FAILED");
    assert.equal(
      status.list[2]!.fix,
      "gcloud run services add-iam-policy-binding saveagentcostsettings --project dute-btg --region southamerica-east1 --member=allUsers --role=roles/run.invoker",
    );
    assert.equal(status.last_deploy_at, "2026-10-03T01:37:00Z");
  });

  it("as outras codebases entram pelo que está publicado: o estado, o acesso da callable e o deploy da codebase", () => {
    // Antes, o painel só conhecia o index.ts do WMS: as callables das outras
    // codebases (a maior parte das publicadas) ficavam sem conferência.
    const publicadas = [
      ...deployed,
      { name: "advanceQuote", state: "ACTIVE", updated_at: "2026-10-24T20:00:00Z", service: "advancequote", codebase: "comercial", callable: true },
      { name: "runNotifications", state: "ACTIVE", updated_at: "2026-10-24T20:00:00Z", service: "runnotifications", codebase: "operacao", callable: false },
      { name: "saveRhRecord", state: "FAILED", updated_at: "2026-10-24T20:00:00Z", service: "saverhrecord", codebase: "rh", callable: true },
      { name: "suggestDuration", state: "ACTIVE", updated_at: "2026-10-24T21:00:00Z", service: "suggestduration", codebase: "core", callable: true },
      // Do WMS, mas fora do index.ts: o código é a lista do WMS.
      { name: "removedFunction", state: "ACTIVE", updated_at: "2026-10-01T00:00:00Z", service: "removedfunction", codebase: "default", callable: true },
    ];
    const acesso = new Map([...invoker, ["advancequote", false], ["suggestduration", true]]);
    const status = functionsStatus(code, publicadas, acesso, "dute-prod", "southamerica-east1");
    assert.deepEqual(
      status.list.map((row) => [row.codebase, row.name, row.status]),
      [
        ["default", "getSystemDashboard", "nao_publicada"],
        ["default", "saveAgentRoutine", "nao_publicada"],
        ["rh", "saveRhRecord", "nao_publicada"],
        ["default", "saveAgentCostSettings", "sem_acesso"],
        ["comercial", "advanceQuote", "sem_acesso"],
        ["default", "listAgentRoutines", "ok"],
        ["default", "runAgentRoutines", "ok"],
        ["core", "suggestDuration", "ok"],
        // agendada não precisa de invoker público, em qualquer codebase
        ["operacao", "runNotifications", "ok"],
      ],
    );
    assert.deepEqual(status.codebases, ["default", "comercial", "core", "operacao", "rh"]);
    assert.deepEqual([status.total, status.ok, status.sem_acesso, status.nao_publicada], [9, 4, 2, 3]);
    assert.equal(status.list.find((row) => row.name === "saveRhRecord")!.fix, "firebase deploy --only functions:rh:saveRhRecord --project dute-prod");
    assert.equal(status.list.find((row) => row.name === "getSystemDashboard")!.fix, "firebase deploy --only functions:getSystemDashboard --project dute-prod");
    assert.equal(
      status.list.find((row) => row.name === "advanceQuote")!.fix,
      "gcloud run services add-iam-policy-binding advancequote --project dute-prod --region southamerica-east1 --member=allUsers --role=roles/run.invoker",
    );
    assert.equal(status.last_deploy_at, "2026-10-24T21:00:00Z");
  });

  it("lê a codebase e a callable dos rótulos que o firebase deploy põe na function", () => {
    assert.deepEqual(
      deployedFunction({
        name: "projects/p/locations/r/functions/advanceQuote",
        state: "ACTIVE",
        updateTime: "2026-10-24T20:00:00Z",
        serviceConfig: { service: "projects/p/locations/r/services/advancequote" },
        labels: { "firebase-functions-codebase": "comercial", "deployment-callable": "true", "deployment-tool": "cli-firebase" },
      }),
      { name: "advanceQuote", state: "ACTIVE", updated_at: "2026-10-24T20:00:00Z", service: "advancequote", codebase: "comercial", callable: true },
    );
    // Na codebase default o firebase deploy não põe o rótulo da codebase.
    assert.deepEqual(
      deployedFunction({ name: "projects/p/locations/r/functions/runAgentRoutines", labels: { "deployment-scheduled": "true" } }),
      { name: "runAgentRoutines", state: "STATE_UNSPECIFIED", updated_at: null, service: "", codebase: "default", callable: false },
    );
  });

  it("acha as functions do código pelo marcador do SDK e lê a política do Cloud Run", () => {
    const callable = Object.assign(() => null, { __endpoint: { callableTrigger: {} } });
    const scheduled = Object.assign(() => null, { __endpoint: { scheduleTrigger: {} } });
    assert.deepEqual(codeFunctions({ b: callable, a: scheduled, helper: () => null, CONST: 3 }), [
      { name: "a", callable: false },
      { name: "b", callable: true },
    ]);
    assert.equal(hasPublicInvoker({ bindings: [{ role: "roles/run.invoker", members: ["allUsers"] }], etag: "x" }), true);
    assert.equal(hasPublicInvoker({ bindings: [{ role: "roles/run.invoker", members: ["serviceAccount:a@b"] }] }), false);
    assert.equal(hasPublicInvoker({ etag: "ACAB" }), false);
  });
});

describe("painel do sistema: custo real do Google Cloud", () => {
  const now = new Date("2026-10-03T15:00:00Z");

  it("valida a tabela e monta a consulta do mês da fatura", () => {
    assert.equal(InfraSettingsSchema.parse({ billing_table: " dute-btg.billing_export.gcp_billing_export_v1_01AB_CD " }).billing_table, "dute-btg.billing_export.gcp_billing_export_v1_01AB_CD");
    assert.equal(InfraSettingsSchema.parse({ billing_table: "" }).billing_table, null);
    assert.equal(InfraSettingsSchema.parse({ billing_table: null }).billing_table, null);
    for (const bad of ["billing_export.tabela", "dute-btg.x.y`; DROP TABLE z", "dute-btg.a.b c"]) {
      assert.equal(InfraSettingsSchema.safeParse({ billing_table: bad }).success, false, bad);
    }
    assert.equal(invoiceMonth(now), "202610");
    // 00:30 UTC de 1º/11 ainda é outubro em São Paulo
    assert.equal(invoiceMonth(new Date("2026-11-01T00:30:00Z")), "202610");
    const { query, params } = billingQuery("dute-btg.billing_export.gcp_billing_export_v1_01AB", now);
    assert.match(query, /FROM `dute-btg\.billing_export\.gcp_billing_export_v1_01AB`/);
    assert.match(query, /SUM\(cost\) AS gross/);
    assert.match(query, /UNNEST\(credits\).*AS credits/s);
    assert.deepEqual(params, { month: "202610", since: "2026-09-26" });
    assert.throws(() => billingQuery("x`y", now));
  });

  it("lê a resposta do BigQuery e separa o Vertex AI para comparar com a estimativa", () => {
    // Formato real (03/10/2026): créditos do período de teste anulando o custo.
    const rows = parseBillingResponse({
      rows: [
        { f: [{ v: "Networking" }, { v: "4.471" }, { v: "-4.471" }, { v: "BRL" }, { v: "1.7914752E9" }] },
        { f: [{ v: "Vertex AI" }, { v: "1.49" }, { v: "-1.49" }, { v: "BRL" }, { v: "1.79146E9" }] },
        { f: [{ v: "Cloud Run Functions" }, { v: "0.21" }, { v: "-0.11" }, { v: "BRL" }, { v: null }] },
        { f: [{ v: "Cloud Build" }, { v: "0" }, { v: "0" }, { v: "BRL" }, { v: null }] },
      ],
    });
    const summary = summarizeBilling(rows);
    assert.equal(summary.has_data, true);
    assert.equal(summary.gross, 6.17);
    assert.equal(summary.credits, -6.07);
    assert.equal(summary.net, 0.1);
    assert.equal(summary.currency, "BRL");
    // Comparação com a estimativa usa o custo de uso, sem créditos.
    assert.equal(summary.vertex_ai, 1.49);
    assert.equal(summary.data_until, new Date(1.7914752e12).toISOString());
    assert.deepEqual(
      summary.services.map((row) => [row.service, row.gross, row.net]),
      [
        ["Networking", 4.47, 0],
        ["Vertex AI", 1.49, 0],
        ["Cloud Run Functions", 0.21, 0.1],
      ],
    );
    assert.deepEqual(summarizeBilling([]), { has_data: false, gross: 0, credits: 0, net: 0, currency: "BRL", vertex_ai: 0, data_until: null, services: [] });
  });
});
