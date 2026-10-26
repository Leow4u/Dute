import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { Timestamp, getFirestore, type Firestore } from "firebase-admin/firestore";

import { CONVERSATIONS_COLLECTION, MESSAGES_COLLECTION, USAGE_COLLECTION } from "./agente-conversa.js";
import { EVENTS_COLLECTION } from "./cursor.js";
import { CORE_EVENT_SOURCE } from "./eventos.js";
import { runAgentRetentionFor } from "./retencao-do-agente-gravacao.js";

/**
 * A retenção do Agent Dute no emulador (LGPD, decisão 8): a mensagem e o uso
 * com mais de 12 meses saem; a conversa sai quando a última mensagem passou
 * de 12 meses; a recente fica, sem o título e o resumo das mensagens que
 * saíram; o evento de cada cliente guarda as contagens, sem o texto; rodar
 * de novo não apaga nem grava mais nada. Dados sintéticos.
 */

const PROJECT_ID = "demo-dute-core";
const AGORA = new Date("2026-10-26T06:40:00.000Z");
const DIA = 24 * 60 * 60 * 1000;

let db: Firestore;
let app: ReturnType<typeof initializeApp>;

before(() => {
  app = initializeApp({ projectId: PROJECT_ID }, "core-retencao-agente-test");
  db = getFirestore(app);
});

after(async () => {
  await deleteApp(app);
});

const diasAtras = (dias: number) => Timestamp.fromDate(new Date(AGORA.getTime() - dias * DIA));

const RESUMO = { summary: "- A pessoa quer saber quantas caixas há.", summary_upto_iso: "2025-09-01T12:00:00.000Z", summary_updated_at: Timestamp.fromDate(new Date("2025-09-01T12:00:00.000Z")) };

async function conversa(id: string, cliente: string, ultimaHaDias: number, extra: Record<string, unknown> = {}) {
  await db
    .collection(CONVERSATIONS_COLLECTION)
    .doc(id)
    .set({ id, customer_code: cliente, user_id: "u-ana", user_email: "ana@itau.com", title: "Quantas caixas?", status: "active", created_at: diasAtras(ultimaHaDias + 30), updated_at: diasAtras(ultimaHaDias), ...extra });
}

async function dadosDa(id: string) {
  return (await db.collection(CONVERSATIONS_COLLECTION).doc(id).get()).data();
}

async function mensagem(id: string, cliente: string, conversaId: string, dias: number) {
  await db.collection(MESSAGES_COLLECTION).doc(id).set({ id, conversation_id: conversaId, customer_code: cliente, role: "user", content: "Quantas caixas há no estoque?", created_at: diasAtras(dias) });
}

async function uso(id: string, cliente: string, dias: number) {
  await db.collection(USAGE_COLLECTION).doc(id).set({ id, customer_code: cliente, user_id: "u-ana", input_tokens: 10, created_at: diasAtras(dias) });
}

async function ids(colecao: string) {
  return (await db.collection(colecao).get()).docs.map((doc) => doc.id).sort();
}

async function eventos() {
  return (await db.collection(EVENTS_COLLECTION).where("type", "==", "agente.retencao_aplicada").get()).docs.map((doc) => doc.data()).sort((a, b) => String(a.customer_code).localeCompare(String(b.customer_code)));
}

beforeEach(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error("FIRESTORE_EMULATOR_HOST não definido.");
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
});

describe("a retenção do Agent Dute", () => {
  it("apaga o que passou de 12 meses e grava o evento de cada cliente com as contagens", async () => {
    await conversa("conv_parada", "ITAU", 400, RESUMO);
    await mensagem("msg_parada_1", "ITAU", "conv_parada", 410);
    await mensagem("msg_parada_2", "ITAU", "conv_parada", 400);
    // A conversa ainda em uso perde as mensagens de mais de 12 meses e o que guardava delas.
    await conversa("conv_viva", "ITAU", 2, RESUMO);
    await mensagem("msg_viva_velha", "ITAU", "conv_viva", 380);
    await mensagem("msg_viva_nova", "ITAU", "conv_viva", 2);
    await conversa("conv_safra", "SAFRA", 370);
    await mensagem("msg_safra", "SAFRA", "conv_safra", 370);
    await uso("uso_velho_itau", "ITAU", 400);
    await uso("uso_velho_safra", "SAFRA", 366);
    await uso("uso_novo", "ITAU", 300);

    const resultado = await runAgentRetentionFor(db, { agora: AGORA });

    assert.deepEqual(await ids(CONVERSATIONS_COLLECTION), ["conv_viva"]);
    assert.deepEqual(await ids(MESSAGES_COLLECTION), ["msg_viva_nova"]);
    assert.deepEqual(await ids(USAGE_COLLECTION), ["uso_novo"]);
    assert.deepEqual(resultado, { antes_de: "2025-10-26", mensagens: 4, conversas: 2, usos: 2, conversas_limpas: 1, eventos: 2, completo: true });
    const viva = await dadosDa("conv_viva");
    assert.deepEqual(
      ["title", "summary", "summary_upto_iso", "summary_updated_at"].filter((campo) => campo in viva!),
      [],
    );
    assert.deepEqual([viva!.customer_code, viva!.user_id, viva!.status, viva!.updated_at.toMillis()], ["ITAU", "u-ana", "active", diasAtras(2).toMillis()]);
    const [itau, safra, ...outros] = await eventos();
    assert.equal(outros.length, 0);
    assert.deepEqual([itau!.customer_code, itau!.source, itau!.entity_type, itau!.actor.role], ["ITAU", CORE_EVENT_SOURCE, "retencao_do_agente", "sistema"]);
    assert.deepEqual(itau!.payload, { id: "ret_20261026T064000", antes_de: "2025-10-26", mensagens: 3, conversas: 1, usos: 1, conversas_limpas: 1 });
    assert.deepEqual(safra!.payload, { id: "ret_20261026T064000", antes_de: "2025-10-26", mensagens: 1, conversas: 1, usos: 1, conversas_limpas: 0 });
    assert.equal(JSON.stringify([itau, safra]).includes("caixas"), false);
    assert.equal(JSON.stringify([itau, safra]).includes("ana@itau.com"), false);
  });

  it("a conversa da rotina fica com o título, que é o nome dela, e a conversa sem mensagem velha não muda", async () => {
    await conversa("conv_rotina", "ITAU", 1, { ...RESUMO, title: "Rotina: Resumo do dia", routine_id: "rot_resumo" });
    await mensagem("msg_rotina_velha", "ITAU", "conv_rotina", 370);
    await mensagem("msg_rotina_nova", "ITAU", "conv_rotina", 1);
    await conversa("conv_nova", "ITAU", 1, RESUMO);
    await mensagem("msg_nova", "ITAU", "conv_nova", 200);

    const resultado = await runAgentRetentionFor(db, { agora: AGORA });

    assert.deepEqual([resultado.mensagens, resultado.conversas_limpas], [1, 1]);
    const rotina = await dadosDa("conv_rotina");
    assert.deepEqual([rotina!.title, rotina!.routine_id, "summary" in rotina!, "summary_upto_iso" in rotina!], ["Rotina: Resumo do dia", "rot_resumo", false, false]);
    const nova = await dadosDa("conv_nova");
    assert.deepEqual([nova!.title, nova!.summary, nova!.summary_upto_iso], ["Quantas caixas?", RESUMO.summary, RESUMO.summary_upto_iso]);
  });

  it("rodar de novo não apaga mais nada nem grava outro evento", async () => {
    await conversa("conv_x", "ITAU", 5, RESUMO);
    await mensagem("msg_velha", "ITAU", "conv_x", 400);
    await runAgentRetentionFor(db, { agora: AGORA });
    const segunda = await runAgentRetentionFor(db, { agora: new Date(AGORA.getTime() + 60_000) });
    assert.deepEqual(segunda, { antes_de: "2025-10-26", mensagens: 0, conversas: 0, usos: 0, conversas_limpas: 0, eventos: 0, completo: true });
    assert.equal((await eventos()).length, 1);
  });

  it("o que não coube nas leituras da rodada fica para a próxima", async () => {
    for (const numero of [1, 2, 3, 4, 5]) await mensagem(`msg_${numero}`, "ITAU", "conv_x", 400 + numero);
    const primeira = await runAgentRetentionFor(db, { agora: AGORA, lote: 2, leituras: 2 });
    assert.deepEqual([primeira.mensagens, primeira.completo], [4, false]);
    const segunda = await runAgentRetentionFor(db, { agora: new Date(AGORA.getTime() + 1000), lote: 2, leituras: 2 });
    assert.deepEqual([segunda.mensagens, segunda.completo], [1, true]);
    assert.deepEqual(await ids(MESSAGES_COLLECTION), []);
  });
});
