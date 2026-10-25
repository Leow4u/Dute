import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { getFirestore } from "firebase-admin/firestore";

/**
 * O evento da mudança de acesso em Pessoas e acessos e no cadastro do
 * cliente: a linha do tempo reconstrói quem passou a ver o quê, com o antes
 * e o depois do papel da pessoa e do que o cliente libera (situação, portal,
 * modelo de operação e sigla). A callable de verdade, pelo `.run`, no
 * emulador.
 */

const PROJECT_ID = "demo-dute-operations";

type Callable = { run: (request: never) => Promise<unknown> };

let mutateManagedEntity: Callable;

function comoOwner(data: Record<string, unknown>) {
  return mutateManagedEntity.run({
    auth: { uid: "owner-a", token: { email: "owner@dutelog.com.br" } },
    data,
    rawRequest: { headers: {} },
  } as never);
}

async function eventoDoTipo(type: string) {
  const snapshot = await getFirestore().collection("events").where("type", "==", type).get();
  assert.equal(snapshot.size, 1, `eventos ${type}: ${snapshot.size}`);
  return snapshot.docs[0]!.data();
}

before(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("FIRESTORE_EMULATOR_HOST não definido.");
  }
  const index = await import("./index.js");
  mutateManagedEntity = index.mutateManagedEntity as unknown as Callable;
  await fetch(
    `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: "DELETE" },
  );
  const db = getFirestore();
  await db.collection("users").doc("owner-a").set({ role: "owner", nome: "Owner", email: "owner@dutelog.com.br" });
  await db.collection("users").doc("ana").set({ role: "interno", nome: "Ana", email: "ana@dutelog.com.br", customer_code: "Dutelog" });
  await db.collection("customers").doc("Itau").set({
    code: "Itau",
    customer_code: "Itau",
    name: "Itaú Unibanco",
    sku_prefix: "ITAU",
    status: "active",
    portal_status: "active",
    operation_template: "uniformes",
    modules: ["wms", "financeiro"],
    archived: false,
  });
});

describe("o evento da mudança de acesso", () => {
  it("a troca de papel grava o papel de antes e o de depois", async () => {
    await comoOwner({ resource: "users", action: "set_role", id: "ana", data: { role: "wms" }, idempotency_key: "papel-da-ana" });

    const evento = await eventoDoTipo("users.set_role");
    assert.equal(evento.entity_id, "ana");
    assert.equal(evento.payload.role_before, "interno");
    assert.equal(evento.payload.role_after, "wms");
  });

  it("o cliente sem portal grava o portal de antes e o de depois, e o que não mudou fica igual", async () => {
    await comoOwner({ resource: "customers", action: "update", id: "Itau", data: { portal_status: "inactive" }, idempotency_key: "portal-do-itau" });

    const evento = await eventoDoTipo("customers.update");
    assert.equal(evento.payload.portal_status_before, "active");
    assert.equal(evento.payload.portal_status_after, "inactive");
    assert.deepEqual(
      [evento.payload.status_before, evento.payload.status_after, evento.payload.operation_template_before, evento.payload.operation_template_after, evento.payload.sku_prefix_before, evento.payload.sku_prefix_after],
      ["active", "active", "uniformes", "uniformes", "ITAU", "ITAU"],
    );
  });
});
