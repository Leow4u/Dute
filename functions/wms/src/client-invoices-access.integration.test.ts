import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";

import { getFirestore, type Firestore } from "firebase-admin/firestore";

/**
 * As faturas mensais pelo portal seguem o contrato (o módulo `financeiro`),
 * como a regra de `client_invoices` (isOwnProjectionWith('financeiro')): a
 * planilha do relatório pela callable de verdade, pelo `.run`, no emulador.
 */

const PROJECT_ID = "demo-dute-operations";

type Wms = typeof import("./index.js");
type Callable = { run: (request: never) => unknown };

let wms: Wms;
let db: Firestore;

before(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("FIRESTORE_EMULATOR_HOST não definido.");
  wms = await import("./index.js");
  db = getFirestore();
});

beforeEach(async () => {
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
  await db.collection("users").doc("cli").set({ role: "cliente", customer_code: "ITAU", nome: "Renata" });
  await db.collection("client_invoices").doc("ITAU__2026-09").set({ customer_code: "ITAU", competencia: "2026-09", status: "emitido", total_cents: 320_000 });
});

async function planilha(): Promise<unknown> {
  const callable = wms.exportBillingReport as unknown as Callable;
  return await callable.run({ auth: { uid: "cli", token: { email: "cli@itau.com.br" } }, data: { from: "2026-08", to: "2026-10" }, rawRequest: {} } as never);
}

describe("as faturas mensais pelo portal seguem o contrato", () => {
  it("sem as faturas no contrato, a planilha do relatório é recusada", async () => {
    await db.collection("client_access").doc("ITAU").set({ modules: ["wms"] });
    await assert.rejects(planilha(), (error: unknown) => {
      const erro = error as { code?: string; message?: string };
      assert.equal(erro.code, "permission-denied");
      assert.equal(erro.message, "As faturas não estão no contrato deste cliente.");
      return true;
    });
  });

  it("com as faturas no contrato, a planilha sai", async () => {
    await db.collection("client_access").doc("ITAU").set({ modules: ["wms", "financeiro"] });
    const resultado = (await planilha()) as Record<string, unknown>;
    assert.ok(resultado && typeof resultado === "object");
  });
});
