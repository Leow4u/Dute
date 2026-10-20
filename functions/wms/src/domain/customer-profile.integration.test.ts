import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

import { assertCustomerCodeAvailable, assertSkuPrefixAvailable, readContractedModules } from "./customer-profile.js";

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

function checkCode(code: string, documentId: string) {
  return db.runTransaction((transaction) => assertCustomerCodeAvailable(transaction, db, code, documentId));
}

describe("código operacional único entre cadastros", () => {
  it("recusa o código de outro cadastro, mesmo com outro id", async () => {
    await assert.rejects(checkCode("BTG Pactual", "btg-pactual"), /O código BTG Pactual já é do cliente BTG Pactual/);
  });

  it("recusa também o código de cadastro arquivado", async () => {
    await assert.rejects(checkCode("Antigo", "Antigo_2"), /já é do cliente Cliente antigo/);
  });

  it("acha cadastro antigo que só tem customer_code", async () => {
    await db.collection("customers").doc("legado").set({ customer_code: "Legado", name: "Legado" });
    await assert.rejects(checkCode("Legado", "Legado"), /já é do cliente Legado/);
  });

  it("aceita código livre", async () => {
    await assert.doesNotReject(checkCode("Itaú", "Ita_"));
  });
});

describe("módulos contratados pelo código (client_access)", () => {
  it("sem o documento vale armazenagem e faturas, o que a BTG tem hoje", async () => {
    assert.deepEqual(await readContractedModules(db, "BTG Pactual"), ["wms", "financeiro"]);
  });

  it("lê o documento pelo código cru, com espaço", async () => {
    await db.collection("client_access").doc("BTG Pactual").set({ customer_code: "BTG Pactual", modules: ["operacao"] });
    assert.deepEqual(await readContractedModules(db, "BTG Pactual"), ["operacao"]);
  });

  it("código que não serve de id não quebra a leitura", async () => {
    assert.deepEqual(await readContractedModules(db, "BTG/SP"), ["wms", "financeiro"]);
    assert.deepEqual(await readContractedModules(db, ""), ["wms", "financeiro"]);
  });
});
