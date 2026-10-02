import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

import { activeNotesForPrompt, decideNote, listNotes, suggestNote } from "./agent-notes.js";

const PROJECT_ID = "demo-dute-operations";
const BTG = "BTG Pactual";
const cliente = { uid: "cli-1", name: "Cristiane", role: "cliente", customer_code: BTG };
const coordenacao = { uid: "ops-1", name: "Leonardo", role: "interno" };
let db: Firestore;
let app: ReturnType<typeof initializeApp>;

before(() => {
  app = initializeApp({ projectId: PROJECT_ID }, "agent-notes-test");
  db = getFirestore(app);
});

beforeEach(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error("FIRESTORE_EMULATOR_HOST não definido.");
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
});

after(async () => {
  await deleteApp(app);
});

async function suggest(text: string, audience: "customer" | "internal" = "customer") {
  return suggestNote(db, { customerCode: BTG, text, conversationId: "c1", audience, actor: audience === "customer" ? cliente : coordenacao });
}

async function events(type: string) {
  return (await db.collection("events").where("type", "==", type).get()).size;
}

describe("memória sugerida", () => {
  it("sugestão fica pendente, não entra no prompt e grava evento; repetida não duplica", async () => {
    assert.equal((await suggest("Entregas na Faria Lima só pela manhã")).sugerida, true);
    const again = await suggest("  entregas na faria lima só pela MANHÃ ");
    assert.equal(again.sugerida, false);
    const notes = await listNotes(db, BTG);
    assert.equal(notes.length, 1);
    assert.equal(notes[0]?.status, "pending");
    assert.equal(notes[0]?.visibility, "todos");
    assert.deepEqual(await activeNotesForPrompt(db, BTG, "customer"), []);
    assert.equal(await events("agent.note_suggested"), 1);
  });

  it("coordenação aprova (com edição) e a anotação passa a valer; evento gravado", async () => {
    await suggest("Entregas na Faria Lima só pela manhã");
    const [note] = await listNotes(db, BTG);
    await decideNote(db, { id: note!.id, action: "approve", text: "Entregas na Faria Lima: só de manhã, até 11h" }, coordenacao);
    assert.deepEqual(await activeNotesForPrompt(db, BTG, "customer"), ["Entregas na Faria Lima: só de manhã, até 11h"]);
    assert.equal(await events("agent.note_approved"), 1);
    await assert.rejects(decideNote(db, { id: note!.id, action: "approve" }, coordenacao), /já está valendo/);
    await decideNote(db, { id: note!.id, action: "archive" }, coordenacao);
    assert.deepEqual(await activeNotesForPrompt(db, BTG, "customer"), []);
  });

  it("anotação da equipe não chega ao cliente", async () => {
    await suggest("Cliente costuma atrasar a NF de uniformes", "internal");
    const [note] = await listNotes(db, BTG);
    assert.equal(note?.visibility, "equipe");
    await decideNote(db, { id: note!.id, action: "approve" }, coordenacao);
    assert.deepEqual(await activeNotesForPrompt(db, BTG, "customer"), []);
    assert.equal((await activeNotesForPrompt(db, BTG, "internal")).length, 1);
  });

  it("só a coordenação decide; recusada sai da lista", async () => {
    await suggest("Contato do almoxarifado é a Cristiane");
    const [note] = await listNotes(db, BTG);
    await assert.rejects(decideNote(db, { id: note!.id, action: "approve" }, { uid: "w", role: "wms" }), /coordenação/);
    await assert.rejects(decideNote(db, { id: note!.id, action: "approve" }, { uid: "c", role: "cliente" }), /coordenação/);
    await decideNote(db, { id: note!.id, action: "reject" }, coordenacao);
    assert.deepEqual(await listNotes(db, BTG), []);
    assert.equal((await suggest("ok")).sugerida, false);
  });
});
