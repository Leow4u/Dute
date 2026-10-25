import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { getFirestore } from "firebase-admin/firestore";

import { inviteEventReference } from "./domain/customer-invite.js";

/**
 * O convite de Pessoas e acessos: o id dele é o token do link, e quem tem o
 * token aceita o convite com o e-mail convidado. Os eventos são lidos pela
 * equipe do armazém (interno, wms e suporte, no firestore.rules), que não
 * administra acessos: o evento do convite leva a referência do token, nunca
 * o token. A callable de verdade, pelo `.run`, no emulador.
 */

const PROJECT_ID = "demo-dute-operations";
/** Como o users.tsx gera: 18 bytes em hexadecimal. */
const TOKEN = "3f9c2a7be1d04c58a6f1e2d3c4b5a69788aa";

type Callable = { run: (request: never) => Promise<unknown> };

let mutateManagedEntity: Callable;
let lookupInvite: Callable;

function comoOwner(data: Record<string, unknown>) {
  return mutateManagedEntity.run({
    auth: { uid: "owner-a", token: { email: "owner@dutelog.com.br" } },
    data,
    rawRequest: { headers: {} },
  } as never);
}

async function eventosDoTipo(type: string) {
  const snapshot = await getFirestore().collection("events").where("type", "==", type).get();
  return snapshot.docs.map((doc) => doc.data());
}

before(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("FIRESTORE_EMULATOR_HOST não definido.");
  }
  const index = await import("./index.js");
  mutateManagedEntity = index.mutateManagedEntity as unknown as Callable;
  lookupInvite = index.lookupInvite as unknown as Callable;
  await fetch(
    `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: "DELETE" },
  );
  await getFirestore().collection("users").doc("owner-a").set({ role: "owner", nome: "Owner", email: "owner@dutelog.com.br" });
});

describe("o evento do convite", () => {
  it("criar o convite grava a referência do token, e o convite continua abrindo pelo link", async () => {
    await comoOwner({
      resource: "invites",
      action: "create",
      data: { token: TOKEN, nome: "Pessoa", email: "pessoa@exemplo.com", role: "admin", customer_code: "Dutelog" },
      idempotency_key: "convite-criado",
    });

    const [evento, ...outros] = await eventosDoTipo("invites.create");
    assert.equal(outros.length, 0);
    assert.equal(evento.entity_type, "invites");
    assert.equal(evento.entity_id, inviteEventReference(TOKEN));
    assert.ok(!JSON.stringify(evento).includes(TOKEN), `o evento leva o token: ${JSON.stringify(evento)}`);

    const aberto = (await lookupInvite.run({ data: { token: TOKEN }, rawRequest: { headers: {} } } as never)) as {
      email: string;
      role: string;
    };
    assert.deepEqual([aberto.email, aberto.role], ["pessoa@exemplo.com", "admin"]);
  });

  it("cancelar o convite também grava só a referência", async () => {
    await comoOwner({ resource: "invites", action: "archive", id: TOKEN, data: {}, idempotency_key: "convite-cancelado" });

    const [evento, ...outros] = await eventosDoTipo("invites.archive");
    assert.equal(outros.length, 0);
    assert.equal(evento.entity_id, inviteEventReference(TOKEN));
    assert.ok(!JSON.stringify(evento).includes(TOKEN), `o evento leva o token: ${JSON.stringify(evento)}`);
  });

  it("a referência é a mesma do aceite no app e não se repete entre convites", () => {
    // A mesma conta do artifacts/app/src/lib/convite.ts (teste espelho em convite.test.ts).
    assert.equal(inviteEventReference(TOKEN), "convite_c626df7ef6491777");
    assert.notEqual(inviteEventReference(TOKEN), inviteEventReference(`${TOKEN.slice(0, -1)}b`));
  });
});
