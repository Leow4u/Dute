import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

import { conversationSummary, refreshConversationSummary, summaryPrompt, type SummaryMessage } from "./agent-summary.js";

const PROJECT_ID = "demo-dute-operations";
const BTG = "BTG Pactual";
const scope = { conversationId: "c1", customerCode: BTG, userId: "ana" };
let db: Firestore;
let app: ReturnType<typeof initializeApp>;

async function addMessages(from: number, to: number) {
  for (let index = from; index < to; index += 1) {
    await db.collection("agent_messages").doc(`m${String(index).padStart(3, "0")}`).set({
      conversation_id: "c1",
      customer_code: BTG,
      user_id: "ana",
      role: index % 2 === 0 ? "user" : "assistant",
      content: `mensagem ${index}`,
      created_at_iso: new Date(Date.UTC(2026, 9, 2, 10, 0, index)).toISOString(),
    });
  }
}

before(() => {
  app = initializeApp({ projectId: PROJECT_ID }, "agent-summary-test");
  db = getFirestore(app);
});

beforeEach(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error("FIRESTORE_EMULATOR_HOST não definido.");
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
  await db.collection("agent_conversations").doc("c1").set({ id: "c1", customer_code: BTG, user_id: "ana", title: "Conversa" });
});

after(async () => {
  await deleteApp(app);
});

describe("resumo de conversa longa", () => {
  it("só resume quando há 10 mensagens antigas fora da janela de 20, e só as que faltam", async () => {
    const calls: Array<{ previous: string; contents: string[] }> = [];
    const summarize = async (previous: string, messages: SummaryMessage[]) => {
      calls.push({ previous, contents: messages.map((message) => message.content) });
      return `resumo ${calls.length}`;
    };

    await addMessages(0, 25);
    assert.equal(await refreshConversationSummary(db, scope, summarize), false);

    await addMessages(25, 32);
    assert.equal(await refreshConversationSummary(db, scope, summarize), true);
    assert.deepEqual(calls[0]?.contents, Array.from({ length: 12 }, (_, index) => `mensagem ${index}`));
    assert.equal(await conversationSummary(db, scope), "resumo 1");

    await addMessages(32, 36);
    assert.equal(await refreshConversationSummary(db, scope, summarize), false);

    await addMessages(36, 42);
    assert.equal(await refreshConversationSummary(db, scope, summarize), true);
    assert.equal(calls[1]?.previous, "resumo 1");
    assert.deepEqual(calls[1]?.contents, Array.from({ length: 10 }, (_, index) => `mensagem ${index + 12}`));
    assert.equal(await conversationSummary(db, scope), "resumo 2");
  });

  it("não lê nem grava resumo de conversa de outra pessoa", async () => {
    await addMessages(0, 40);
    const other = { ...scope, userId: "bruno" };
    assert.equal(await refreshConversationSummary(db, other, async () => "x"), false);
    await db.collection("agent_conversations").doc("c1").update({ summary: "segredo" });
    assert.equal(await conversationSummary(db, other), "");
    assert.equal(await conversationSummary(db, scope), "segredo");
  });

  it("resumidor sem texto não grava nada", async () => {
    await addMessages(0, 40);
    assert.equal(await refreshConversationSummary(db, scope, async () => "  "), false);
    assert.equal(await conversationSummary(db, scope), "");
  });

  it("o pedido ao modelo leva o resumo anterior e as mensagens novas", () => {
    const prompt = summaryPrompt("- pediu PED-0040", [{ role: "user", content: "e as canecas?", created_at: "x" }]);
    assert.match(prompt, /- pediu PED-0040/);
    assert.match(prompt, /Pessoa: e as canecas\?/);
  });
});
