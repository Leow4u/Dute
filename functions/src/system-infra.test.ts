import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  billingQuery,
  codeFunctions,
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
    { name: "saveAgentCostSettings", state: "ACTIVE", updated_at: "2026-10-03T01:37:00Z", service: "saveagentcostsettings" },
    { name: "listAgentRoutines", state: "ACTIVE", updated_at: "2026-10-02T12:00:00Z", service: "listagentroutines" },
    { name: "runAgentRoutines", state: "ACTIVE", updated_at: "2026-10-02T12:00:00Z", service: "runagentroutines" },
    { name: "saveAgentRoutine", state: "FAILED", updated_at: "2026-10-02T12:00:00Z", service: "saveagentroutine" },
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
    assert.match(query, /UNNEST\(credits\)/);
    assert.deepEqual(params, { month: "202610", since: "2026-09-26" });
    assert.throws(() => billingQuery("x`y", now));
  });

  it("lê a resposta do BigQuery e separa o Vertex AI para comparar com a estimativa", () => {
    const rows = parseBillingResponse({
      rows: [
        { f: [{ v: "Cloud Run" }, { v: "9.104" }, { v: "BRL" }, { v: "1.7914752E9" }] },
        { f: [{ v: "Cloud Firestore" }, { v: "5.3" }, { v: "BRL" }, { v: "1.79146E9" }] },
        { f: [{ v: "Vertex AI" }, { v: "0.744" }, { v: "BRL" }, { v: null }] },
        { f: [{ v: "Cloud Scheduler" }, { v: "0" }, { v: "BRL" }, { v: null }] },
      ],
    });
    const summary = summarizeBilling(rows);
    assert.equal(summary.total, 15.15);
    assert.equal(summary.currency, "BRL");
    assert.equal(summary.vertex_ai, 0.74);
    assert.equal(summary.data_until, new Date(1.7914752e12).toISOString());
    assert.deepEqual(summary.services.map((row) => row.service), ["Cloud Run", "Cloud Firestore", "Vertex AI"]);
    assert.deepEqual(summarizeBilling([]), { total: 0, currency: "BRL", vertex_ai: 0, data_until: null, services: [] });
  });
});
