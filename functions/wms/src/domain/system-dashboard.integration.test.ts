import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

import { readSystemDashboard, saveCostSettings } from "./system-dashboard.js";

const PROJECT_ID = "demo-dute-operations";
let db: Firestore;
let app: ReturnType<typeof initializeApp>;
const now = new Date("2026-10-03T15:00:00Z");

before(() => {
  app = initializeApp({ projectId: PROJECT_ID }, "system-dashboard-test");
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

describe("painel do sistema", () => {
  it("só o owner lê o painel e salva preços", async () => {
    for (const role of ["admin", "suporte", "cliente", "financeiro"]) {
      await assert.rejects(readSystemDashboard(db, { role }, now), /só para o owner/);
      await assert.rejects(saveCostSettings(db, { uid: "u", role }, { input_per_million: 1, output_per_million: 1 }), /só para o owner/);
    }
  });

  it("junta uso com o preço salvo e lista as rotinas de todo mundo com as falhas de 24 h", async () => {
    await saveCostSettings(db, { uid: "owner", role: "owner" }, { input_per_million: 2, output_per_million: 10, monthly_budget: 100 });
    await db.collection("agent_usage").add({ created_at_iso: "2026-10-03T13:00:00Z", source: "rotina", role: "cliente", input_tokens: 1_000_000, output_tokens: 0 });
    await db.collection("agent_usage").add({ created_at_iso: "2026-08-01T13:00:00Z", source: "rotina", role: "cliente", input_tokens: 9_000_000, output_tokens: 0 });
    await db.collection("agent_routines").doc("rot_a").set({ name: "Abaixo do mínimo", user_name: "Cristiane", frequency: "weekdays", time: "07:30", active: true, last_status: "failed", last_attempt_at: "2026-10-03T10:45:00Z", last_error: "modelo indisponível" });
    await db.collection("agent_routines").doc("rot_b").set({ name: "Resumo do estoque", user_name: "Leonardo", frequency: "weekly", days: [1], time: "10:00", active: false });

    const dashboard = await readSystemDashboard(db, { role: "owner" }, now);
    assert.deepEqual(dashboard.settings, { input_per_million: 2, output_per_million: 10, monthly_budget: 100 });
    assert.equal(dashboard.usage.month.cost, 2);
    assert.equal(dashboard.usage.month.by_kind.rotinas, 2);
    assert.deepEqual(dashboard.routines.list.map((routine) => routine.name), ["Abaixo do mínimo", "Resumo do estoque"]);
    assert.equal(dashboard.routines.active, 1);
    assert.equal(dashboard.routines.failed, 1);
    assert.deepEqual(dashboard.routines.problems, [{ name: "Abaixo do mínimo", at: "2026-10-03T10:45:00Z", error: "modelo indisponível" }]);
  });

  it("orçamento zero vira sem orçamento", async () => {
    const saved = await saveCostSettings(db, { uid: "owner", role: "owner" }, { input_per_million: 1, output_per_million: 1, monthly_budget: 0 });
    assert.equal(saved.monthly_budget, null);
  });
});
