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
  // O interno convidado leva "Dutelog" no perfil; a Bia foi cliente do Itaú.
  await db.collection("users").doc("carlos").set({ role: "interno", nome: "Carlos", email: "carlos@dutelog.com.br", customer_code: "Dutelog" });
  await db.collection("users").doc("bia").set({ role: "interno", nome: "Bia", email: "bia@itau.com.br", customer_code: "Itau" });
  await db.collection("users").doc("davi").set({ role: "wms", nome: "Davi", email: "davi@dutelog.com.br" });
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

describe("a troca de papel para cliente", () => {
  const papelDe = async (uid: string) => (await getFirestore().collection("users").doc(uid).get()).get("role");

  it("o interno convidado não vira cliente de Dutelog, que não é cliente", async () => {
    await assert.rejects(
      comoOwner({ resource: "users", action: "set_role", id: "carlos", data: { role: "cliente" }, idempotency_key: "carlos-cliente" }),
      /Dutelog não está cadastrado/,
    );
    assert.equal(await papelDe("carlos"), "interno");
  });

  it("quem não está ligado a um cliente não vira cliente", async () => {
    await assert.rejects(
      comoOwner({ resource: "users", action: "set_role", id: "davi", data: { role: "cliente" }, idempotency_key: "davi-cliente" }),
      /não está ligada a um cliente/,
    );
    assert.equal(await papelDe("davi"), "wms");
  });

  it("quem já é ligado a um cliente cadastrado vira cliente dele", async () => {
    await comoOwner({ resource: "users", action: "set_role", id: "bia", data: { role: "cliente" }, idempotency_key: "bia-cliente" });
    assert.equal(await papelDe("bia"), "cliente");
  });
});

describe("o token do convite", () => {
  const convite = (extra: Record<string, unknown>, chave: string) =>
    comoOwner({
      resource: "invites",
      action: "create",
      data: { nome: "Pessoa", email: `${chave}@exemplo.com`, role: "wms", customer_code: "Dutelog" },
      idempotency_key: chave,
      ...extra,
    });

  it("sem token, o convite não nasce com um id adivinhável", async () => {
    await assert.rejects(convite({}, "sem-token"), /token gerado pela tela de Usuários/);
    const convites = await getFirestore().collection("invites").get();
    assert.deepEqual(convites.docs.map((doc) => doc.id), []);
  });

  it("o token curto, pelo dado ou pelo id, também não serve", async () => {
    await assert.rejects(
      comoOwner({ resource: "invites", action: "create", data: { token: "1234567890123", nome: "P", email: "curto@exemplo.com", role: "wms", customer_code: "Dutelog" }, idempotency_key: "token-curto" }),
      /token gerado pela tela de Usuários/,
    );
    await assert.rejects(
      comoOwner({ resource: "invites", action: "create", id: "convite-1", data: { nome: "P", email: "id@exemplo.com", role: "wms", customer_code: "Dutelog" }, idempotency_key: "id-curto" }),
      /token gerado pela tela de Usuários/,
    );
  });

  it("o token da tela de Usuários vira o id do convite", async () => {
    const token = "0123456789abcdef0123456789abcdef0123";
    await comoOwner({ resource: "invites", action: "create", data: { token, nome: "P", email: "ok@exemplo.com", role: "wms", customer_code: "Dutelog" }, idempotency_key: "token-bom" });
    assert.equal((await getFirestore().collection("invites").doc(token).get()).get("email"), "ok@exemplo.com");
  });
});
