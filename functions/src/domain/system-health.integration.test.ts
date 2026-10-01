import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

import { readSystemHealth } from "./system-health.js";

const PROJECT_ID = "demo-dute-operations";
let db: Firestore;
let app: ReturnType<typeof initializeApp>;

const admin = { uid: "admin-1", role: "admin" };

before(() => {
  app = initializeApp({ projectId: PROJECT_ID }, "system-health-test");
  db = getFirestore(app);
});

beforeEach(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error("FIRESTORE_EMULATOR_HOST não definido.");
  await fetch(
    `http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: "DELETE" },
  );
});

after(async () => {
  await deleteApp(app);
});

describe("saúde do sistema", () => {
  it("responde mesmo sem nenhum evento", async () => {
    const health = await readSystemHealth(db, admin);
    assert.equal(health.ok, true);
    assert.equal(health.last_event, null);
    assert.deepEqual(health.incidents, []);
    assert.ok(health.firestore_ms >= 0);
  });

  it("traz o último evento do ledger e só os incidentes, do mais novo ao mais antigo", async () => {
    const events = db.collection("events");
    await events.doc("e1").set({
      type: "order.delivered",
      title: "Pedido entregue",
      occurred_at: "2026-09-30T17:57:00.000Z",
    });
    await events.doc("i1").set({
      type: "support.incident",
      title: "8 funções sem permissão",
      description: "Após deploy",
      severity: "critical",
      occurred_at: "2026-09-03T13:14:00.000Z",
      actor: { uid: "owner-1", name: "Leonardo" },
    });
    await events.doc("i2").set({
      type: "support.incident",
      title: "Prévia zerada",
      severity: "attention",
      occurred_at: "2026-09-30T01:02:00.000Z",
      actor: { uid: "owner-1", email: "leo@dutelog.com.br" },
    });

    const health = await readSystemHealth(db, { uid: "s-1", role: "suporte" });
    assert.deepEqual(health.last_event, {
      type: "order.delivered",
      title: "Pedido entregue",
      occurred_at: "2026-09-30T17:57:00.000Z",
    });
    assert.deepEqual(
      health.incidents.map((incident) => [incident.id, incident.severity, incident.reported_by]),
      [
        ["i2", "attention", "leo@dutelog.com.br"],
        ["i1", "critical", "Leonardo"],
      ],
    );
  });

  for (const role of ["interno", "wms", "financeiro", "cliente"]) {
    it(`recusa o perfil ${role}`, async () => {
      await assert.rejects(readSystemHealth(db, { uid: "x", role }), {
        code: "permission-denied",
      });
    });
  }
});
