import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";

import { getFirestore, type Firestore } from "firebase-admin/firestore";

/**
 * O pedido do portal pela callable de verdade (`createCustomerRequest`, pelo
 * `.run` do `onCall`), no emulador: o limite de itens e de anexos responde com
 * a mensagem que o cliente lê, e não com a "Falha interna" de um erro de
 * validação solto.
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
});

async function pedir(data: Record<string, unknown>): Promise<unknown> {
  const callable = wms.createCustomerRequest as unknown as Callable;
  return await callable.run({ auth: { uid: "cli", token: { email: "cli@itau.com.br" } }, data, rawRequest: {} } as never);
}

const item = (indice: number) => ({ sku_code: `ITAU-${String(indice).padStart(6, "0")}`, product_name: `Item ${indice}`, quantity: 1 });

describe("limites do pedido do portal", () => {
  it("acima de 100 itens, recusa com a mensagem do limite", async () => {
    await assert.rejects(
      pedir({ type: "retirada", idempotency_key: "grande", destination: "Agência Faria Lima", items: Array.from({ length: 101 }, (_, indice) => item(indice + 1)) }),
      (error: unknown) => {
        const erro = error as { code?: string; message?: string };
        assert.equal(erro.code, "invalid-argument");
        assert.equal(erro.message, "Um pedido leva até 100 itens de separação. Divida em mais de um pedido.");
        return true;
      },
    );
    assert.equal((await db.collection("customer_requests").get()).size, 0);
  });

  it("acima de 8 anexos, recusa com a mensagem do limite", async () => {
    const anexo = (indice: number) => ({
      file_name: `nota-${indice}.pdf`,
      file_url: `https://example.com/nota-${indice}.pdf`,
      storage_path: `client-requests/ITAU/nota-${indice}.pdf`,
      content_type: "application/pdf",
      size_bytes: 1000,
    });
    await assert.rejects(
      pedir({ type: "recebimento", idempotency_key: "anexos", items: [item(1)], attachments: Array.from({ length: 9 }, (_, indice) => anexo(indice)) }),
      (error: unknown) => {
        const erro = error as { code?: string; message?: string };
        assert.equal(erro.code, "invalid-argument");
        assert.equal(erro.message, "Um pedido leva até 8 anexos.");
        return true;
      },
    );
  });
});
