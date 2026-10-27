import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { getFirestore } from "firebase-admin/firestore";

/**
 * O registro manual de evento (recordOperationalEvent, domain/manual-events.ts):
 * a equipe registra só os tipos que as telas mandam, com a hora da gravação,
 * e o cliente não registra nada à mão. As transições gravam o próprio evento,
 * no mesmo fluxo da alteração; um tipo delas registrado à mão seria um evento
 * forjado, que a timeline e os rascunhos de aviso ao cliente leriam como
 * verdadeiro. A callable de verdade, pelo `.run`, no emulador.
 */

const PROJECT_ID = "demo-dute-operations";

/** Os tipos que as telas da equipe registram à mão: um tipo novo entra aqui e na lista do domínio. */
const TIPOS_DAS_TELAS = ["knowledge.uploaded", "operator.note", "support.incident"];

type Callable = { run: (request: never) => Promise<unknown> };

let recordOperationalEvent: Callable;

function registrar(uid: string, data: Record<string, unknown>) {
  return recordOperationalEvent.run({
    auth: { uid, token: { email: `${uid}@dutelog.com.br` } },
    data,
    rawRequest: { headers: {} },
  } as never) as Promise<{ event: { id: string } }>;
}

async function totalDeEventos() {
  return (await getFirestore().collection("events").count().get()).data().count;
}

before(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("FIRESTORE_EMULATOR_HOST não definido.");
  }
  recordOperationalEvent = (await import("./index.js")).recordOperationalEvent as unknown as Callable;
  await fetch(
    `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: "DELETE" },
  );
  const users = getFirestore().collection("users");
  await users.doc("interno-a").set({ role: "interno", nome: "Interno" });
  await users.doc("owner-a").set({ role: "owner", nome: "Owner" });
  await users.doc("cliente-a").set({ role: "cliente", nome: "Cliente", customer_code: "BTG Pactual" });
});

describe("o registro manual de evento", () => {
  it("a equipe registra os tipos das telas, com a hora da gravação e não a que mandou", async () => {
    const antes = Date.now();
    for (const type of TIPOS_DAS_TELAS) {
      const { event } = await registrar("interno-a", { type, title: `Teste ${type}`, occurred_at: "2001-01-01T00:00:00.000Z" });
      const gravado = (await getFirestore().collection("events").doc(event.id).get()).data() ?? {};
      assert.equal(gravado.type, type);
      assert.equal(gravado.actor?.uid, "interno-a");
      assert.ok(Date.parse(String(gravado.occurred_at)) >= antes, `${type} gravado com ${String(gravado.occurred_at)}`);
    }
  });

  it("um tipo de transição não entra à mão, nem pelo owner", async () => {
    const total = await totalDeEventos();
    // O aceite do convite também: o acceptInvite grava o evento junto do perfil (pergunta 68).
    for (const type of ["inventory.adjusted", "order.status_changed", "billing.invoice_paid", "portal.request_created", "customer.message_sent", "access.invite_accepted"]) {
      await assert.rejects(registrar("owner-a", { type, title: "Forjado" }), {
        code: "permission-denied",
        message: "Esse evento é gravado pelo próprio fluxo, não à mão.",
      });
    }
    assert.equal(await totalDeEventos(), total);
  });

  it("o cliente não registra evento à mão", async () => {
    const total = await totalDeEventos();
    for (const type of ["customer.message_sent", "portal.request_created", "operator.note"]) {
      await assert.rejects(registrar("cliente-a", { type, title: "Do portal" }), {
        code: "permission-denied",
        message: "Ação permitida somente para a operação Dutelog.",
      });
    }
    assert.equal(await totalDeEventos(), total);
  });
});
