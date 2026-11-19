import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc } from "firebase/firestore";

/**
 * Conversas de WhatsApp (docs/plataforma/zap.md): owner e admin leem; o
 * restante da equipe, o cliente e quem não entrou não leem. Ninguém grava
 * pelo navegador. O texto da mensagem mora nestas coleções.
 */

const PROJECT_ID = "demo-dute-operations";
const CONVERSA = "1415578004977589_5511900000000";
const MENSAGEM = "wamid.EXEMPLO";

let testEnvironment: RulesTestEnvironment;

function endereco(variavel: string) {
  const address = process.env[variavel];
  assert.ok(address, `Execute este teste pelo Firebase Emulator (${variavel}).`);
  const [host, rawPort] = address.split(":");
  return { host, port: Number(rawPort) };
}

function regras(arquivo: string) {
  const currentDirectory = dirname(fileURLToPath(import.meta.url));
  return readFileSync(resolve(currentDirectory, "../../../", arquivo), "utf8");
}

const PAPEIS: Record<string, { role: string; customer_code?: string }> = {
  "owner-a": { role: "owner" },
  "admin-a": { role: "admin" },
  "ops-a": { role: "interno" },
  "support-a": { role: "suporte" },
  "wms-a": { role: "wms" },
  "campo-a": { role: "campo" },
  "comercial-a": { role: "comercial" },
  "financeiro-a": { role: "financeiro" },
  "rh-a": { role: "rh" },
  "painel-a": { role: "painel" },
  "client-a": { role: "cliente", customer_code: "BTG" },
};

const SEM_LEITURA = ["ops-a", "support-a", "wms-a", "campo-a", "comercial-a", "financeiro-a", "rh-a", "painel-a", "client-a"];

beforeEach(async () => {
  await testEnvironment.clearFirestore();
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    const database = context.firestore();
    for (const [uid, perfil] of Object.entries(PAPEIS)) await setDoc(doc(database, "users", uid), { nome: uid, ...perfil });
    await setDoc(doc(database, "zap_conversations", CONVERSA), { phone_number_id: "1415578004977589", contact_wa_id: "5511900000000", last_preview: "Bom dia" });
    await setDoc(doc(database, "zap_messages", MENSAGEM), { conversation_id: CONVERSA, text: "Bom dia", direction: "in" });
    await setDoc(doc(database, "zap_access", "acesso-1"), { uid: "owner-a", role: "owner", action: "opened", conversation_id: CONVERSA });
  });
});

before(async () => {
  testEnvironment = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { ...endereco("FIRESTORE_EMULATOR_HOST"), rules: regras("firestore.rules") },
  });
});

after(async () => {
  await testEnvironment?.cleanup();
});

function firestore(uid: string) {
  return testEnvironment.authenticatedContext(uid).firestore();
}

describe("zap_conversations, zap_messages e zap_access", () => {
  it("owner e admin leem as três coleções", async () => {
    for (const uid of ["owner-a", "admin-a"]) {
      await assertSucceeds(getDoc(doc(firestore(uid), "zap_conversations", CONVERSA)));
      await assertSucceeds(getDocs(collection(firestore(uid), "zap_messages")));
      await assertSucceeds(getDoc(doc(firestore(uid), "zap_access", "acesso-1")));
    }
  });

  it("a equipe, o cliente e quem não entrou não leem", async () => {
    for (const uid of SEM_LEITURA) {
      await assertFails(getDoc(doc(firestore(uid), "zap_conversations", CONVERSA)));
      await assertFails(getDoc(doc(firestore(uid), "zap_messages", MENSAGEM)));
      await assertFails(getDoc(doc(firestore(uid), "zap_access", "acesso-1")));
    }
    const anonimo = testEnvironment.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(anonimo, "zap_messages", MENSAGEM)));
  });

  it("ninguém grava pelo navegador, nem owner", async () => {
    for (const uid of ["owner-a", "admin-a", "rh-a"]) {
      await assertFails(setDoc(doc(firestore(uid), "zap_messages", "wamid.NOVA"), { text: "x" }));
      await assertFails(updateDoc(doc(firestore(uid), "zap_messages", MENSAGEM), { text: "outro" }));
      await assertFails(deleteDoc(doc(firestore(uid), "zap_conversations", CONVERSA)));
      await assertFails(setDoc(doc(firestore(uid), "zap_access", "acesso-2"), { uid, action: "entered" }));
    }
  });
});
