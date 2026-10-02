import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

import { searchPastConversations } from "./agent-history.js";

const PROJECT_ID = "demo-dute-operations";
const BTG = "BTG Pactual";
let db: Firestore;
let app: ReturnType<typeof initializeApp>;

async function conversation(id: string, userId: string, customerCode: string, title: string, lastAt: string, messages: Array<[string, string, string]>) {
  await db.collection("agent_conversations").doc(id).set({ id, user_id: userId, customer_code: customerCode, title, last_message_at: lastAt });
  for (const [index, [role, content, at]] of messages.entries()) {
    await db.collection("agent_messages").doc(`${id}-${index}`).set({
      conversation_id: id, user_id: userId, customer_code: customerCode, role, content, created_at_iso: at,
    });
  }
}

async function seed() {
  await conversation("c-antiga", "ana", BTG, "Entrega do PED-0040", "2026-09-20T10:01:00Z", [
    ["user", "Quando sai o PED-0040 para a loja Faria Lima?", "2026-09-20T10:00:00Z"],
    ["assistant", "O PED-0040 está em separação e a previsão é sair amanhã.", "2026-09-20T10:00:01Z"],
    ["user", "E as canecas?", "2026-09-20T10:01:00Z"],
    ["assistant", "Há 120 canecas disponíveis.", "2026-09-20T10:01:01Z"],
  ]);
  await conversation("c-atual", "ana", BTG, "Hoje", "2026-10-02T10:00:00Z", [
    ["user", "Como ficou o PED-0040?", "2026-10-02T10:00:00Z"],
  ]);
  await conversation("c-outra-pessoa", "bruno", BTG, "Pedido do Bruno", "2026-09-25T10:00:00Z", [
    ["user", "PED-0040 é meu também?", "2026-09-25T10:00:00Z"],
    ["assistant", "Sim.", "2026-09-25T10:00:01Z"],
  ]);
  await conversation("c-outro-cliente", "ana", "Outro", "Outro cliente", "2026-09-26T10:00:00Z", [
    ["user", "PED-0040 do outro cliente", "2026-09-26T10:00:00Z"],
    ["assistant", "Resposta de outro cliente.", "2026-09-26T10:00:01Z"],
  ]);
}

before(() => {
  app = initializeApp({ projectId: PROJECT_ID }, "agent-history-test");
  db = getFirestore(app);
});

beforeEach(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error("FIRESTORE_EMULATOR_HOST não definido.");
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
  await seed();
});

after(async () => {
  await deleteApp(app);
});

describe("conversas anteriores", () => {
  it("acha a pergunta e a resposta só nas conversas da própria pessoa, fora a atual", async () => {
    const found = await searchPastConversations(db, { customerCode: BTG, userId: "ana", currentConversationId: "c-atual", query: "ped-0040" });
    assert.equal(found.encontrados, 1);
    assert.deepEqual(found.trechos[0], {
      conversa: "Entrega do PED-0040",
      quando: "2026-09-20T10:00:00Z",
      pergunta: "Quando sai o PED-0040 para a loja Faria Lima?",
      resposta: "O PED-0040 está em separação e a previsão é sair amanhã.",
    });
  });

  it("procura também na resposta e ignora acento", async () => {
    const found = await searchPastConversations(db, { customerCode: BTG, userId: "ana", query: "canecas disponiveis" });
    assert.equal(found.trechos[0]?.pergunta, "E as canecas?");
  });

  it("sem termo útil não consulta nada", async () => {
    const found = await searchPastConversations(db, { customerCode: BTG, userId: "ana", query: "o e" });
    assert.equal(found.encontrados, 0);
  });
});
