import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

import { billingDocumentId, readBillingPeriod, resolveBillingDocument } from "./billing-scope.js";

const PROJECT_ID = "demo-dute-operations";

let db: Firestore;
let app: ReturnType<typeof initializeApp>;

before(() => {
  app = initializeApp({ projectId: PROJECT_ID }, "billing-scope-test");
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

describe("documento da fatura por cliente", () => {
  it("a BTG lê a competência antiga e o outro cliente grava em outro id", async () => {
    await db.collection("billing_periods").doc("2026-10").set({
      customer_code: "BTG Pactual",
      competencia: "2026-10",
      status: "emitido",
      total: 10,
    });

    const btg = await resolveBillingDocument(
      db,
      "billing_periods",
      "BTG Pactual",
      "2026-10",
    );
    assert.equal(btg.legacy, true);
    assert.equal(btg.ref.id, "2026-10");

    const acme = await resolveBillingDocument(db, "billing_periods", "Acme", "2026-10");
    assert.equal(acme.legacy, false);
    assert.equal(acme.ref.id, billingDocumentId("Acme", "2026-10"));
    await acme.ref.set({
      customer_code: "Acme",
      competencia: "2026-10",
      status: "aberto",
      total: 99,
    });

    const btgAfter = await db.collection("billing_periods").doc("2026-10").get();
    assert.equal(btgAfter.data()?.total, 10);
    assert.equal(btgAfter.data()?.customer_code, "BTG Pactual");
    assert.equal(
      (await db.collection("billing_periods").doc(acme.ref.id).get()).data()?.total,
      99,
    );
  });

  it("a prévia do agente lê o período do próprio cliente: o id do mês é só da BTG", async () => {
    await db.collection("billing_periods").doc("2026-08").set({
      customer_code: "BTG Pactual",
      competencia: "2026-08",
      status: "emitido",
      invoice_snapshot: { total: 12.34 },
    });
    await db.collection("billing_periods").doc(billingDocumentId("Banco Safra", "2026-07")).set({
      customer_code: "Banco Safra",
      competencia: "2026-07",
      status: "pago",
    });

    assert.equal((await readBillingPeriod(db, "billing_periods", "BTG Pactual", "2026-08")).status, "emitido");
    assert.deepEqual(await readBillingPeriod(db, "billing_periods", "Banco Safra", "2026-08"), {});
    assert.equal((await readBillingPeriod(db, "billing_periods", "Banco Safra", "2026-07")).status, "pago");
    assert.deepEqual(await readBillingPeriod(db, "billing_periods", "BTG Pactual", "2026-07"), {});
  });
});
