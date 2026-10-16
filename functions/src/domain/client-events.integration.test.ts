import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

import {
  archiveClientEvent,
  CLIENT_EVENTS_COLLECTION,
  ClientEventInputSchema,
  listClientEvents,
  saveClientEvent,
} from "./client-events.js";

const PROJECT_ID = "demo-dute-operations";
let db: Firestore;
let app: ReturnType<typeof initializeApp>;

const cristiane = { uid: "cli-1", role: "cliente", customer_code: "BTG Pactual", name: "Cristiane" };
const outraCliente = { uid: "cli-2", role: "cliente", customer_code: "Outro", name: "Paula" };
const manoel = { uid: "manoel", role: "interno", name: "Manoel" };

function input(overrides: Record<string, unknown> = {}) {
  return ClientEventInputSchema.parse({
    name: "Feira de Investimentos",
    description: "Estande com balcão e totens",
    venue: "Expo Center Norte",
    address: "Rua José Bernardo Pinto, 333 · São Paulo/SP",
    next_date: "2026-11-20",
    schedule: "Montagem na véspera a partir das 7h",
    logistics: "1 caminhão baú e 4 montadores",
    items: [
      { sku_code: "SKU1", client_item_code: "K.0101.001.U", product_name: "BALCÃO", quantity: 2 },
      { sku_code: "SKU2", product_name: "TOTEM", quantity: 4 },
    ],
    ...overrides,
  });
}

async function eventsFor(id: string) {
  const snapshot = await db.collection("events").where("entity_id", "==", id).get();
  return snapshot.docs.map((document) => document.data());
}

before(() => {
  app = initializeApp({ projectId: PROJECT_ID }, "client-events-test");
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

describe("eventos do portal", () => {
  it("a cliente cria um evento: fica no contrato dela, com quem criou e registro em events", async () => {
    const result = await saveClientEvent(db, "BTG Pactual", input(), cristiane);
    assert.equal(result.created, true);
    const stored = (await db.collection(CLIENT_EVENTS_COLLECTION).doc(result.id).get()).data() ?? {};
    assert.equal(stored.customer_code, "BTG Pactual");
    assert.equal(stored.status, "active");
    assert.equal(stored.created_by.uid, "cli-1");
    assert.equal(stored.next_date, "2026-11-20");
    assert.deepEqual(stored.items[1], { sku_code: "SKU2", client_item_code: null, product_name: "TOTEM", quantity: 4 });

    const events = await eventsFor(result.id);
    assert.equal(events.length, 1);
    assert.equal(events[0].type, "client_event_template.created");
    assert.equal(events[0].customer_code, "BTG Pactual");
    assert.equal(events[0].actor.uid, "cli-1");
  });

  it("repetir a criação com a mesma chave não duplica", async () => {
    const first = await saveClientEvent(db, "BTG Pactual", input({ idempotency_key: "k-1" }), cristiane);
    const again = await saveClientEvent(db, "BTG Pactual", input({ idempotency_key: "k-1" }), cristiane);
    assert.equal(again.id, first.id);
    assert.equal(again.created, false);
    assert.equal((await listClientEvents(db, "BTG Pactual", cristiane)).length, 1);
    assert.equal((await eventsFor(first.id)).length, 1);
  });

  it("a lista traz só os ativos do próprio cliente", async () => {
    await saveClientEvent(db, "BTG Pactual", input({ name: "Zeta" }), cristiane);
    await saveClientEvent(db, "BTG Pactual", input({ name: "Alfa" }), cristiane);
    const outro = await saveClientEvent(db, "Outro", input({ name: "Do outro" }), outraCliente);
    const excluido = await saveClientEvent(db, "BTG Pactual", input({ name: "Excluído" }), cristiane);
    await archiveClientEvent(db, "BTG Pactual", { id: excluido.id }, cristiane);

    const list = await listClientEvents(db, "BTG Pactual", cristiane);
    assert.deepEqual(list.map((item) => item.name), ["Alfa", "Zeta"]);
    assert.ok(!list.some((item) => item.id === outro.id));
  });

  it("editar troca os dados e grava evento; evento de outro cliente não é encontrado", async () => {
    const created = await saveClientEvent(db, "BTG Pactual", input(), cristiane);
    const edited = await saveClientEvent(
      db,
      "BTG Pactual",
      input({ id: created.id, next_date: "2027-11-19", items: [{ sku_code: "SKU1", product_name: "BALCÃO", quantity: 3 }] }),
      cristiane,
    );
    assert.equal(edited.created, false);
    const stored = (await db.collection(CLIENT_EVENTS_COLLECTION).doc(created.id).get()).data() ?? {};
    assert.equal(stored.next_date, "2027-11-19");
    assert.equal(stored.items.length, 1);
    assert.equal(stored.created_by.uid, "cli-1");
    assert.deepEqual(
      (await eventsFor(created.id)).map((event) => event.type).sort(),
      ["client_event_template.created", "client_event_template.updated"],
    );

    await assert.rejects(
      saveClientEvent(db, "Outro", input({ id: created.id, name: "Invadido" }), outraCliente),
      { code: "not-found" },
    );
    await assert.rejects(archiveClientEvent(db, "Outro", { id: created.id }, outraCliente), { code: "not-found" });
    assert.equal((await db.collection(CLIENT_EVENTS_COLLECTION).doc(created.id).get()).data()?.name, "Feira de Investimentos");
  });

  it("excluir arquiva uma vez só; arquivado não volta a ser editado", async () => {
    const created = await saveClientEvent(db, "BTG Pactual", input(), cristiane);
    assert.deepEqual(await archiveClientEvent(db, "BTG Pactual", { id: created.id }, cristiane), { id: created.id, changed: true });
    assert.deepEqual(await archiveClientEvent(db, "BTG Pactual", { id: created.id }, cristiane), { id: created.id, changed: false });
    const stored = (await db.collection(CLIENT_EVENTS_COLLECTION).doc(created.id).get()).data() ?? {};
    assert.equal(stored.status, "archived");
    assert.equal(stored.archived_by.uid, "cli-1");
    assert.equal((await eventsFor(created.id)).filter((event) => event.type === "client_event_template.archived").length, 1);
    await assert.rejects(saveClientEvent(db, "BTG Pactual", input({ id: created.id }), cristiane), { code: "not-found" });
  });

  it("coordenação cuida a pedido do cliente; operação, financeiro e suporte não", async () => {
    const created = await saveClientEvent(db, "BTG Pactual", input(), manoel);
    assert.equal(created.created, true);
    assert.equal((await listClientEvents(db, "BTG Pactual", manoel)).length, 1);
    for (const role of ["wms", "financeiro", "suporte"]) {
      const actor = { uid: "x", role };
      await assert.rejects(listClientEvents(db, "BTG Pactual", actor), { code: "permission-denied" });
      await assert.rejects(saveClientEvent(db, "BTG Pactual", input(), actor), { code: "permission-denied" });
      await assert.rejects(archiveClientEvent(db, "BTG Pactual", { id: created.id }, actor), { code: "permission-denied" });
    }
    await assert.rejects(
      listClientEvents(db, "BTG Pactual", { uid: "sem-codigo", role: "cliente" }),
      { code: "permission-denied" },
    );
  });
});

describe("validação do evento", () => {
  it("exige nome, local e ao menos um item; data só no formato AAAA-MM-DD", () => {
    assert.equal(ClientEventInputSchema.safeParse({ ...input(), name: " " }).success, false);
    assert.equal(ClientEventInputSchema.safeParse({ ...input(), venue: "" }).success, false);
    assert.equal(ClientEventInputSchema.safeParse({ ...input(), items: [] }).success, false);
    assert.equal(ClientEventInputSchema.safeParse({ ...input(), next_date: "20/11/2026" }).success, false);
    assert.equal(
      ClientEventInputSchema.safeParse({ ...input(), items: [{ sku_code: "SKU1", product_name: "X", quantity: 0 }] }).success,
      false,
    );
    assert.equal(ClientEventInputSchema.parse({ ...input(), next_date: "" }).next_date, null);
    assert.equal(ClientEventInputSchema.parse({ ...input(), description: "  " }).description, null);
  });
});
