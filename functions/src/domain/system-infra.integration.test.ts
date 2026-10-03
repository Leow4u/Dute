import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

import { readSystemInfra, saveInfraSettings, type GcpFetch } from "./system-infra.js";

const PROJECT_ID = "demo-dute-operations";
let db: Firestore;
let app: ReturnType<typeof initializeApp>;
const now = new Date("2026-10-03T15:00:00Z");
const TABLE = "dute-btg.billing_export.gcp_billing_export_v1_01AB";

before(() => {
  app = initializeApp({ projectId: PROJECT_ID }, "system-infra-test");
  db = getFirestore(app);
});

beforeEach(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error("FIRESTORE_EMULATOR_HOST não definido.");
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
});

after(async () => {
  await deleteApp(app);
});

/** Google Cloud de mentira: responde por URL e guarda o que foi pedido. */
function fakeGcp(overrides: Partial<Record<"logging" | "functions" | "run" | "bigquery", { status: number; json: unknown }>> = {}) {
  const calls: Array<{ url: string; body: unknown }> = [];
  const gcp: GcpFetch = async (url, init) => {
    calls.push({ url, body: init?.body ? JSON.parse(init.body) : null });
    if (url.startsWith("https://logging.googleapis.com/")) {
      return overrides.logging ?? {
        status: 200,
        json: { entries: [{ timestamp: "2026-10-03T12:00:00Z", severity: "ERROR", logName: "projects/dute-btg/logs/run.googleapis.com%2Fstderr", textPayload: "Error: falhou", resource: { labels: { service_name: "readshipmentinvoice" } } }] },
      };
    }
    if (url.startsWith("https://cloudfunctions.googleapis.com/")) {
      return overrides.functions ?? {
        status: 200,
        json: {
          functions: [
            { name: "projects/dute-btg/locations/southamerica-east1/functions/getSystemInfra", state: "ACTIVE", updateTime: "2026-10-03T02:00:00Z", serviceConfig: { service: "projects/dute-btg/locations/southamerica-east1/services/getsysteminfra" } },
            { name: "projects/dute-btg/locations/southamerica-east1/functions/saveSystemInfraSettings", state: "ACTIVE", updateTime: "2026-10-03T02:00:00Z", serviceConfig: { service: "projects/dute-btg/locations/southamerica-east1/services/savesysteminfrasettings" } },
          ],
        },
      };
    }
    if (url.startsWith("https://run.googleapis.com/")) {
      if (overrides.run) return overrides.run;
      const open = url.includes("/getsysteminfra:");
      return { status: 200, json: open ? { bindings: [{ role: "roles/run.invoker", members: ["allUsers"] }] } : { etag: "ACAB" } };
    }
    if (url.startsWith("https://bigquery.googleapis.com/")) {
      return overrides.bigquery ?? { status: 200, json: { jobComplete: true, rows: [{ f: [{ v: "Cloud Run" }, { v: "9.1" }, { v: "BRL" }, { v: null }] }] } };
    }
    return { status: 404, json: { error: { message: "não simulado" } } };
  };
  return { gcp, calls };
}

const code = [
  { name: "getSystemInfra", callable: true },
  { name: "saveSystemInfraSettings", callable: true },
  { name: "runAgentRoutines", callable: false },
];
const options = (gcp: GcpFetch) => ({ gcp, code, project: "dute-btg", region: "southamerica-east1", now });

describe("painel do sistema: infraestrutura", () => {
  it("só o owner lê a infraestrutura e salva a tabela do faturamento", async () => {
    const { gcp, calls } = fakeGcp();
    for (const role of ["admin", "suporte", "cliente", "financeiro"]) {
      await assert.rejects(readSystemInfra(db, { role }, options(gcp)), /só para o owner/);
      await assert.rejects(saveInfraSettings(db, { uid: "u", role }, { billing_table: TABLE }), /só para o owner/);
    }
    assert.equal(calls.length, 0, "não consulta o Google Cloud para quem não é owner");
  });

  it("junta erros, functions e faturamento; sem tabela, o faturamento fica por configurar", async () => {
    const { gcp, calls } = fakeGcp();
    const before = await readSystemInfra(db, { role: "owner" }, options(gcp));
    assert.equal(before.billing.status, "not_configured");
    assert.equal(calls.some((call) => call.url.includes("bigquery")), false);

    assert.equal(before.errors.status, "ok");
    if (before.errors.status === "ok") assert.equal(before.errors.total, 1);
    assert.equal(before.functions.status, "ok");
    if (before.functions.status === "ok") {
      assert.deepEqual(
        before.functions.list.map((row) => [row.name, row.status]),
        [
          ["runAgentRoutines", "nao_publicada"],
          ["saveSystemInfraSettings", "sem_acesso"],
          ["getSystemInfra", "ok"],
        ],
      );
    }

    await saveInfraSettings(db, { uid: "owner", role: "owner" }, { billing_table: TABLE });
    const after = await readSystemInfra(db, { role: "owner" }, options(gcp));
    assert.equal(after.settings.billing_table, TABLE);
    assert.equal(after.billing.status, "ok");
    if (after.billing.status === "ok") assert.equal(after.billing.total, 9.1);
    const query = calls.find((call) => call.url.includes("bigquery"))!.body as { query: string; queryParameters: Array<{ name: string; parameterValue: { value: string } }> };
    assert.match(query.query, new RegExp(`FROM \`${TABLE.replace(/\./g, "\\.")}\``));
    assert.deepEqual(
      query.queryParameters.map((param) => [param.name, param.parameterValue.value]),
      [["month", "202610"], ["project", "dute-btg"], ["since", "2026-09-26"]],
    );
  });

  it("uma API sem permissão não derruba as outras", async () => {
    await saveInfraSettings(db, { uid: "owner", role: "owner" }, { billing_table: TABLE });
    const { gcp } = fakeGcp({
      logging: { status: 403, json: { error: { message: "Permission 'logging.logEntries.list' denied" } } },
      bigquery: { status: 404, json: { error: { message: "Not found: Table" } } },
    });
    const infra = await readSystemInfra(db, { role: "owner" }, options(gcp));
    assert.equal(infra.errors.status, "error");
    if (infra.errors.status === "error") assert.match(infra.errors.message, /Sem permissão para ler os logs.*logging.logEntries.list/);
    assert.equal(infra.billing.status, "error");
    if (infra.billing.status === "error") assert.match(infra.billing.message, /\(404\).*Not found/);
    assert.equal(infra.functions.status, "ok");
  });

  it("sem permissão no Cloud Run, não acusa falta de invoker em todas", async () => {
    const { gcp } = fakeGcp({ run: { status: 403, json: { error: { message: "run.services.getIamPolicy denied" } } } });
    const infra = await readSystemInfra(db, { role: "owner" }, options(gcp));
    assert.equal(infra.functions.status, "error");
    if (infra.functions.status === "error") assert.match(infra.functions.message, /Sem permissão para ler o acesso do Cloud Run/);
  });

  it("limpar a tabela volta para por configurar", async () => {
    await saveInfraSettings(db, { uid: "owner", role: "owner" }, { billing_table: TABLE });
    await saveInfraSettings(db, { uid: "owner", role: "owner" }, { billing_table: null });
    const { gcp } = fakeGcp();
    const infra = await readSystemInfra(db, { role: "owner" }, options(gcp));
    assert.equal(infra.billing.status, "not_configured");
  });
});
