import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";

import {
  decideDuteNoteFor,
  decideDutePlaybookFor,
  idDaNota,
  listDuteNotesFor,
  listDutePlaybooksFor,
  saveDutePlaybookFor,
  seedDutePlaybooksFor,
  suggestDuteNoteFor,
} from "./agente-revisao.js";
import type { CoreProfile } from "./profile.js";

/**
 * As anotações e os playbooks do Agent Dute no emulador (parte 5.5f). A
 * anotação só nasce do cartão da conversa, de quem conversou, e fica
 * pendente; a coordenação decide, do cliente ativo; o playbook escrito por
 * ela vale direto, e os iniciais entram pendentes. Cada gravação leva o
 * evento `agente.*`, e repetir não grava de novo. Dados sintéticos.
 */

const PROJECT_ID = "demo-dute-core";

let db: Firestore;
let app: ReturnType<typeof initializeApp>;

before(() => {
  app = initializeApp({ projectId: PROJECT_ID }, "core-agente-revisao-test");
  db = getFirestore(app);
});

after(async () => {
  await deleteApp(app);
});

const cliente: CoreProfile = { uid: "cli-itau", role: "cliente", customerCode: "ITAU", name: "Renata" };
const interno: CoreProfile = { uid: "ops-1", role: "interno", name: "Ops" };

function mensagem(id: string, dados: Record<string, unknown>) {
  return db
    .collection("agent_messages")
    .doc(id)
    .set({ id, conversation_id: "conv_1", customer_code: "ITAU", user_id: "cli-itau", role: "assistant", content: "Montei o cartão.", draft: { tipo: "anotacao", texto: "Entregas na Paulista só pela manhã", visibilidade: "todos" }, ...dados });
}

beforeEach(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error("FIRESTORE_EMULATOR_HOST não definido.");
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
  await db.collection("customers").doc("cus_itau").set({ customer_code: "ITAU" });
  await db.collection("customers").doc("cus_safra").set({ customer_code: "SAFRA" });
  await mensagem("msg_agent_1", {});
});

const recusa = (codigo: string, padrao?: RegExp) => (erro: unknown) => erro instanceof HttpsError && erro.code === codigo && (!padrao || padrao.test(erro.message));

async function eventos(tipo?: string) {
  const lidos = (await db.collection("events").get()).docs.map((doc) => doc.data());
  return tipo ? lidos.filter((evento) => evento.type === tipo) : lidos;
}

describe("a anotação pelo cartão", () => {
  it("quem conversou envia; fica pendente, com o evento, e a mensagem guarda o envio; repetir não grava de novo", async () => {
    const enviada = await suggestDuteNoteFor(db, cliente, { agent_message_id: "msg_agent_1" });
    const id = idDaNota("ITAU", "Entregas na Paulista só pela manhã");
    assert.deepEqual(enviada, { id, status: "pending" });
    const nota = (await db.collection("ai_agent_notes").doc(id).get()).data();
    assert.deepEqual([nota?.customer_code, nota?.status, nota?.visibility, nota?.source_conversation_id, nota?.suggested_by?.uid], ["ITAU", "pending", "todos", "conv_1", "cli-itau"]);
    const [evento] = await eventos("agente.anotacao_sugerida");
    assert.deepEqual([evento.payload, evento.actor.role, evento.source], [{ id, conversa: "conv_1" }, "cliente", "functions_core"]);
    assert.equal((await db.collection("agent_messages").doc("msg_agent_1").get()).get("draft_sent.request_id"), id);
    assert.deepEqual(await suggestDuteNoteFor(db, cliente, { agent_message_id: "msg_agent_1" }), { id, status: "pending", replayed: true });
    assert.equal((await eventos()).length, 1);
  });

  it("a mensagem de outra pessoa, de outro cliente ou sem o cartão de anotação recusa", async () => {
    await assert.rejects(suggestDuteNoteFor(db, { ...cliente, uid: "outra" }, { agent_message_id: "msg_agent_1" }), recusa("permission-denied", /não é desta conversa/));
    await assert.rejects(suggestDuteNoteFor(db, { ...cliente, customerCode: "SAFRA" }, { agent_message_id: "msg_agent_1" }), recusa("permission-denied"));
    await mensagem("msg_agent_2", { draft: { tipo: "pedido", linhas: [] } });
    await assert.rejects(suggestDuteNoteFor(db, cliente, { agent_message_id: "msg_agent_2" }), recusa("failed-precondition", /não tem anotação/));
    await mensagem("msg_user_1", { role: "user" });
    await assert.rejects(suggestDuteNoteFor(db, cliente, { agent_message_id: "msg_user_1" }), recusa("permission-denied"));
    assert.equal((await db.collection("ai_agent_notes").get()).size, 0);
  });

  it("a mesma anotação, já pendente ou valendo, não vira outra", async () => {
    await suggestDuteNoteFor(db, cliente, { agent_message_id: "msg_agent_1" });
    await mensagem("msg_agent_3", {});
    const outra = await suggestDuteNoteFor(db, cliente, { agent_message_id: "msg_agent_3" });
    assert.equal(outra.status, "pending");
    assert.equal("ja_existia" in outra && outra.ja_existia, true);
    assert.equal((await db.collection("ai_agent_notes").get()).size, 1);
    assert.equal((await eventos("agente.anotacao_sugerida")).length, 1);
  });
});

describe("a coordenação decide", () => {
  it("aprova ajustando o texto e para quem vale; repetir não grava; o que já foi decidido recusa", async () => {
    const { id } = await suggestDuteNoteFor(db, cliente, { agent_message_id: "msg_agent_1" });
    const lista = await listDuteNotesFor(db, interno, { customer_code: "ITAU" });
    assert.deepEqual(lista.items.map((nota) => [nota.id, nota.status, nota.suggested_by_role]), [[id, "pending", "cliente"]]);
    assert.deepEqual(await decideDuteNoteFor(db, interno, { customer_code: "ITAU", id, action: "approve", text: "Entregas na Paulista só de manhã", visibility: "equipe" }), { id, status: "active" });
    const nota = (await db.collection("ai_agent_notes").doc(id).get()).data();
    assert.deepEqual([nota?.text, nota?.visibility, nota?.decided_by?.uid], ["Entregas na Paulista só de manhã", "equipe", "ops-1"]);
    assert.deepEqual(await decideDuteNoteFor(db, interno, { customer_code: "ITAU", id, action: "approve" }), { id, status: "active", replayed: true });
    await assert.rejects(decideDuteNoteFor(db, interno, { customer_code: "ITAU", id, action: "reject" }), recusa("failed-precondition", /valendo/));
    assert.deepEqual(await decideDuteNoteFor(db, interno, { customer_code: "ITAU", id, action: "archive" }), { id, status: "archived" });
    assert.deepEqual((await eventos()).map((evento) => evento.type).sort(), ["agente.anotacao_aprovada", "agente.anotacao_arquivada", "agente.anotacao_sugerida"]);
  });

  it("só a coordenação, e só do cliente ativo", async () => {
    const { id } = await suggestDuteNoteFor(db, cliente, { agent_message_id: "msg_agent_1" });
    for (const quem of [cliente, { uid: "com-1", role: "comercial" as const }, { uid: "wms-1", role: "wms" as const }]) {
      await assert.rejects(listDuteNotesFor(db, quem, { customer_code: "ITAU" }), recusa("permission-denied"), quem.role);
    }
    await assert.rejects(decideDuteNoteFor(db, interno, { customer_code: "SAFRA", id, action: "approve" }), recusa("not-found"));
    assert.deepEqual((await listDuteNotesFor(db, interno, { customer_code: "SAFRA" })).items, []);
    await assert.rejects(listDuteNotesFor(db, interno, { customer_code: "NADA" }), recusa("not-found"));
  });
});

describe("os playbooks", () => {
  const playbook = { customer_code: "ITAU", idempotency_key: "chave-0001", title: "Receber mercadoria", when: "Chegou um caminhão", steps: ["Conferir a NF", "", "Contar as caixas"], audience: "equipe" };

  it("o escrito pela coordenação vale direto; a mesma chave não cria dois; editar grava o evento da edição", async () => {
    const criado = await saveDutePlaybookFor(db, interno, playbook);
    assert.equal(criado.status, "active");
    const salvo = (await db.collection("ai_agent_playbooks").doc(criado.id).get()).data();
    assert.deepEqual([salvo?.customer_code, salvo?.steps, salvo?.source], ["ITAU", ["Conferir a NF", "Contar as caixas"], "coordenacao"]);
    assert.deepEqual(await saveDutePlaybookFor(db, interno, playbook), { id: criado.id, status: "active", replayed: true });
    await saveDutePlaybookFor(db, interno, { ...playbook, id: criado.id, idempotency_key: "chave-0002", audience: "todos" });
    assert.deepEqual((await eventos()).map((evento) => [evento.type, evento.payload.publico]).sort(), [
      ["agente.playbook_criado", "equipe"],
      ["agente.playbook_editado", "todos"],
    ]);
    await decideDutePlaybookFor(db, interno, { customer_code: "ITAU", id: criado.id, action: "archive" });
    await assert.rejects(saveDutePlaybookFor(db, interno, { ...playbook, id: criado.id, idempotency_key: "chave-0003" }), recusa("failed-precondition", /arquivado/));
    await assert.rejects(saveDutePlaybookFor(db, interno, { ...playbook, customer_code: "SAFRA", id: criado.id, idempotency_key: "chave-0004" }), recusa("not-found"));
    await assert.rejects(saveDutePlaybookFor(db, interno, { ...playbook, steps: [" "] }), recusa("invalid-argument", /ao menos um passo/));
  });

  it("os iniciais entram pendentes uma vez só; a coordenação aprova; o cliente não mexe", async () => {
    assert.deepEqual(await seedDutePlaybooksFor(db, interno, { customer_code: "ITAU" }), { created: 7 });
    assert.deepEqual(await seedDutePlaybooksFor(db, interno, { customer_code: "ITAU" }), { created: 0 });
    const lista = await listDutePlaybooksFor(db, interno, { customer_code: "ITAU" });
    assert.equal(lista.items.length, 7);
    assert.ok(lista.items.every((item) => item.status === "pending" && item.source === "inicial"));
    const [primeiro] = lista.items;
    assert.deepEqual(await decideDutePlaybookFor(db, interno, { customer_code: "ITAU", id: primeiro.id, action: "approve" }), { id: primeiro.id, status: "active" });
    const [carregados] = await eventos("agente.playbooks_carregados");
    assert.equal(carregados.payload.ids.length, 7);
    await assert.rejects(seedDutePlaybooksFor(db, cliente, { customer_code: "ITAU" }), recusa("permission-denied"));
    assert.deepEqual((await listDutePlaybooksFor(db, interno, { customer_code: "SAFRA" })).items, []);
  });
});
