import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { Timestamp, getFirestore, type Firestore } from "firebase-admin/firestore";

import { CLIENT_NOTIFICATIONS_COLLECTION, EMAIL_OUTBOX_COLLECTION } from "./avisos-gravacao.js";
import { EVENTS_COLLECTION, OPERACAO_EVENT_SOURCE } from "./events.js";
import { RETENCAO_ACTOR, runRetentionFor } from "./retencao-gravacao.js";

/**
 * A retenção dos avisos no emulador (LGPD, decisão 8): o aviso do sino e o
 * e-mail que já saiu da fila com mais de 90 dias saem; o recente e o e-mail
 * pendente ficam; o evento guarda as contagens por cliente; rodar de novo
 * não apaga nem grava mais nada. Dados sintéticos.
 */

const PROJECT_ID = "demo-dute-operacao";
const AGORA = new Date("2026-10-26T06:20:00.000Z");
const DIA = 24 * 60 * 60 * 1000;

let db: Firestore;
let app: ReturnType<typeof initializeApp>;

before(() => {
  app = initializeApp({ projectId: PROJECT_ID }, "operacao-retencao-test");
  db = getFirestore(app);
});

after(async () => {
  await deleteApp(app);
});

const diasAtras = (dias: number) => Timestamp.fromDate(new Date(AGORA.getTime() - dias * DIA));

async function aviso(id: string, cliente: string, dias: number) {
  await db.collection(CLIENT_NOTIFICATIONS_COLLECTION).doc(id).set({ id, customer_code: cliente, titulo: "OS agendada", texto: "A OS foi agendada.", link: "/portal/os", created_at: diasAtras(dias) });
}

async function email(id: string, cliente: string, dias: number, status: string) {
  await db.collection(EMAIL_OUTBOX_COLLECTION).doc(id).set({ id, customer_code: cliente, to: ["gestora@itau.com"], subject: "OS agendada", text: "A OS foi agendada.", status, created_at: diasAtras(dias) });
}

async function ids(colecao: string) {
  return (await db.collection(colecao).get()).docs.map((doc) => doc.id).sort();
}

async function eventosDaRetencao() {
  return (await db.collection(EVENTS_COLLECTION).where("type", "==", "retention.applied").get()).docs.map((doc) => doc.data());
}

beforeEach(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error("FIRESTORE_EMULATOR_HOST não definido.");
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
});

describe("a retenção dos avisos", () => {
  it("apaga o que passou de 90 dias e grava o evento com as contagens por cliente", async () => {
    await aviso("ntf_velho_itau", "ITAU", 120);
    await aviso("ntf_velho_safra", "SAFRA", 91);
    await aviso("ntf_recente", "ITAU", 89);
    await email("mail_enviado", "ITAU", 120, "sent");
    await email("mail_auditado", "ITAU", 100, "audit");
    await email("mail_desistido", "SAFRA", 95, "failed");
    await email("mail_pendente", "ITAU", 100, "pending");
    await email("mail_recente", "ITAU", 10, "sent");

    const resultado = await runRetentionFor(db, { agora: AGORA });

    assert.deepEqual(await ids(CLIENT_NOTIFICATIONS_COLLECTION), ["ntf_recente"]);
    assert.deepEqual(await ids(EMAIL_OUTBOX_COLLECTION), ["mail_pendente", "mail_recente"]);
    assert.deepEqual({ ...resultado, evento: Boolean(resultado.evento) }, { antes_de: "2026-07-28", avisos: 2, emails: 3, evento: true, completo: true });
    const [evento, ...outros] = await eventosDaRetencao();
    assert.equal(outros.length, 0);
    assert.equal(evento!.id, resultado.evento);
    assert.equal(evento!.source, OPERACAO_EVENT_SOURCE);
    assert.equal(evento!.customer_code, null);
    assert.equal(evento!.entity_type, "retention");
    assert.deepEqual(evento!.actor, { uid: RETENCAO_ACTOR.uid, role: "sistema", name: RETENCAO_ACTOR.name });
    assert.deepEqual(evento!.payload, {
      id: "ret_20261026T062000",
      antes_de: "2026-07-28",
      avisos: 2,
      emails: 3,
      por_cliente: [
        { cliente: "ITAU", avisos: 1, emails: 2 },
        { cliente: "SAFRA", avisos: 1, emails: 1 },
      ],
    });
    assert.equal(JSON.stringify(evento).includes("gestora@itau.com"), false);
  });

  it("rodar de novo não apaga mais nada nem grava outro evento", async () => {
    await aviso("ntf_velho", "ITAU", 120);
    await runRetentionFor(db, { agora: AGORA });
    const segunda = await runRetentionFor(db, { agora: new Date(AGORA.getTime() + 60_000) });
    assert.deepEqual(segunda, { antes_de: "2026-07-28", avisos: 0, emails: 0, evento: null, completo: true });
    assert.equal((await eventosDaRetencao()).length, 1);
  });

  it("nada passou do prazo: nenhum evento", async () => {
    await aviso("ntf_recente", "ITAU", 30);
    await email("mail_recente", "ITAU", 30, "sent");
    const resultado = await runRetentionFor(db, { agora: AGORA });
    assert.equal(resultado.evento, null);
    assert.deepEqual(await ids(CLIENT_NOTIFICATIONS_COLLECTION), ["ntf_recente"]);
    assert.deepEqual(await eventosDaRetencao(), []);
  });

  it("o e-mail pendente no começo da fila não segura os outros: a leitura segue depois dele", async () => {
    await email("mail_a_pendente", "ITAU", 130, "pending");
    await email("mail_b_pendente", "ITAU", 125, "pending");
    await email("mail_c", "ITAU", 120, "sent");
    await email("mail_d", "ITAU", 110, "sent");
    await email("mail_e", "ITAU", 100, "failed");
    const resultado = await runRetentionFor(db, { agora: AGORA, lote: 2 });
    assert.deepEqual(await ids(EMAIL_OUTBOX_COLLECTION), ["mail_a_pendente", "mail_b_pendente"]);
    assert.equal(resultado.emails, 3);
    assert.equal(resultado.completo, true);
  });

  it("o que não coube nas leituras da rodada fica para a próxima", async () => {
    for (const numero of [1, 2, 3, 4, 5]) await aviso(`ntf_${numero}`, "ITAU", 100 + numero);
    const primeira = await runRetentionFor(db, { agora: AGORA, lote: 2, leituras: 2 });
    assert.equal(primeira.avisos, 4);
    assert.equal(primeira.completo, false);
    const segunda = await runRetentionFor(db, { agora: new Date(AGORA.getTime() + 1000), lote: 2, leituras: 2 });
    assert.equal(segunda.avisos, 1);
    assert.equal(segunda.completo, true);
    assert.deepEqual(await ids(CLIENT_NOTIFICATIONS_COLLECTION), []);
    assert.equal((await eventosDaRetencao()).length, 2);
  });
});
