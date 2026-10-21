import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

import { assertInviteCustomerAllowed } from "./customer-invite.js";

const PROJECT_ID = "demo-dute-operations";

let db: Firestore;
let app: ReturnType<typeof initializeApp>;

before(() => {
  app = initializeApp({ projectId: PROJECT_ID }, "customer-invite-test");
  db = getFirestore(app);
});

beforeEach(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error("FIRESTORE_EMULATOR_HOST não definido.");
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
  const customers = db.collection("customers");
  // BTG como pode estar no dute-prod: sem sigla, sem client_profiles e sem client_access.
  await customers.doc("BTG_Pactual").set({ code: "BTG Pactual", name: "BTG Pactual", status: "active" });
  await customers.doc("Ita_").set({ code: "Itaú", customer_code: "Itaú", name: "Itaú Unibanco", sku_prefix: "ITAU", status: "active", archived: false });
  await customers.doc("Antigo").set({ code: "Antigo", customer_code: "Antigo", name: "Antigo", sku_prefix: "ANT", status: "archived", archived: true });
  await customers.doc("ACME").set({ code: "ACME", customer_code: "ACME", name: "Acme Ltda", stage: "prospect", status: "active" });
  await customers.doc("Mudancas").set({ code: "Mudancas", customer_code: "Mudancas", name: "Mudanças SP", stage: "cliente", status: "active" });
  // Cadastro antigo que só tem customer_code.
  await customers.doc("legado").set({ customer_code: "Legado", name: "Legado", sku_prefix: "LEG" });
});

after(async () => {
  await deleteApp(app);
});

function invite(customerCode: string, role = "cliente") {
  return db.runTransaction((transaction) =>
    assertInviteCustomerAllowed(transaction, db, { role, customer_code: customerCode, email: "pessoa@exemplo.com" }),
  );
}

describe("convite de cliente confere o cadastro pelo código", () => {
  it("cliente com sigla, achado por code ou por customer_code", async () => {
    await assert.doesNotReject(invite("Itaú"));
    await assert.doesNotReject(invite("Legado"));
  });

  it("recusa prospect, arquivado, código sem cadastro e cliente sem sigla", async () => {
    await assert.rejects(invite("ACME"), /prospect do Comercial/);
    await assert.rejects(invite("Antigo"), /arquivado/);
    await assert.rejects(invite("Inexistente"), /não está cadastrado/);
    await assert.rejects(invite("Mudancas"), /não tem sigla do SKU/);
  });

  it("trava: a BTG sem sigla e sem projeções continua recebendo convite", async () => {
    await assert.doesNotReject(invite("BTG Pactual"));
    await db.collection("customers").doc("BTG_Pactual").delete();
    await assert.doesNotReject(invite("BTG Pactual"));
  });

  it("convite da equipe não depende do cadastro", async () => {
    await assert.doesNotReject(invite("Dutelog", "interno"));
  });
});
