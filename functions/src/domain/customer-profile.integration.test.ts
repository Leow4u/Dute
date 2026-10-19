import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

import { assertSkuPrefixAvailable } from "./customer-profile.js";

const PROJECT_ID = "demo-dute-operations";

let db: Firestore;
let app: ReturnType<typeof initializeApp>;

before(() => {
  app = initializeApp({ projectId: PROJECT_ID }, "customer-profile-test");
  db = getFirestore(app);
});

beforeEach(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error("FIRESTORE_EMULATOR_HOST não definido.");
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
  await db.collection("customers").doc("BTG_Pactual").set({ code: "BTG Pactual", name: "BTG Pactual", sku_prefix: "BTG", status: "active", archived: false });
  await db.collection("customers").doc("Antigo").set({ code: "Antigo", name: "Cliente antigo", sku_prefix: "ANT", status: "archived", archived: true });
});

after(async () => {
  await deleteApp(app);
});

function check(prefix: string, documentId: string) {
  return db.runTransaction((transaction) => assertSkuPrefixAvailable(transaction, db, prefix, documentId));
}

describe("sigla do SKU única entre clientes ativos", () => {
  it("recusa a sigla de outro cliente ativo", async () => {
    await assert.rejects(check("BTG", "Itau"), /A sigla BTG já é do cliente BTG Pactual/);
  });

  it("aceita a própria sigla no update e uma sigla livre", async () => {
    await assert.doesNotReject(check("BTG", "BTG_Pactual"));
    await assert.doesNotReject(check("ITAU", "Itau"));
  });

  it("sigla de cliente arquivado fica livre", async () => {
    await assert.doesNotReject(check("ANT", "Novo"));
  });
});
