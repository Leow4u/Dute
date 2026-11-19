import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { Timestamp, getFirestore, type Firestore } from "firebase-admin/firestore";
import { HttpsError, type CallableRequest } from "firebase-functions/https";

import { registrarAcessoZapFor } from "./acesso.js";
import { ZAP_ACCESS_COLLECTION, ZAP_CONVERSATIONS_COLLECTION, ZAP_MESSAGES_COLLECTION, USERS_COLLECTION } from "./colecoes.js";
import { gravarEntrada } from "./gravacao.js";
import { LINHA_PILOTO } from "./linhas.js";
import { idDaConversa, type Entrada } from "./modelo.js";
import { requireZapCaller } from "./profile.js";
import { runZapRetentionFor } from "./retencao.js";

/**
 * A ingestão no emulador: o mesmo id não duplica, o status encontra a
 * mensagem e a consulta do painel tem o índice composto. Dados sintéticos.
 */

const PROJECT_ID = "demo-dute-zap";
const CONTATO = "5511900000000";
const AGORA = new Date("2026-11-19T12:00:00.000Z");

let app: ReturnType<typeof initializeApp>;
let db: Firestore;

function entrada(parcial: Partial<Entrada> = {}): Entrada {
  return {
    wamid: "wamid.INTEGRACAO",
    phone_number_id: LINHA_PILOTO,
    contact_wa_id: CONTATO,
    contact_name: "Maria",
    direction: "in",
    type: "text",
    text: "Bom dia",
    occurred_at_ms: AGORA.getTime() - 60_000,
    origin: "relay",
    status_only: false,
    ...parcial,
  };
}

function pedido(uid: string): CallableRequest<unknown> {
  return { auth: { uid, token: {} } } as CallableRequest<unknown>;
}

before(() => {
  app = initializeApp({ projectId: PROJECT_ID }, "zap-gravacao-test");
  db = getFirestore(app);
});

after(async () => {
  await deleteApp(app);
});

beforeEach(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error("FIRESTORE_EMULATOR_HOST não definido.");
  const resposta = await fetch(`http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
  assert.equal(resposta.ok, true);
});

describe("gravação do Zap", () => {
  it("grava a mensagem uma vez e a consulta da linha e da conversa encontra", async () => {
    assert.equal(await gravarEntrada(db, entrada(), AGORA), "nova");
    assert.equal(await gravarEntrada(db, entrada(), AGORA), "repetida");
    const conversaId = idDaConversa(LINHA_PILOTO, CONTATO);
    const mensagem = await db.collection(ZAP_MESSAGES_COLLECTION).doc("wamid.INTEGRACAO").get();
    assert.equal(mensagem.data()?.text, "Bom dia");
    assert.equal(mensagem.data()?.agent, "jamil");
    const porLinha = await db.collection(ZAP_CONVERSATIONS_COLLECTION).where("phone_number_id", "==", LINHA_PILOTO).orderBy("last_message_at", "desc").limit(10).get();
    assert.equal(porLinha.size, 1);
    assert.equal(porLinha.docs[0]?.data().contact_name, "Maria");
    const daConversa = await db.collection(ZAP_MESSAGES_COLLECTION).where("conversation_id", "==", conversaId).orderBy("occurred_at", "asc").limit(10).get();
    assert.equal(daConversa.size, 1);
  });

  it("o status encontra a saída e a leitura não volta atrás", async () => {
    await gravarEntrada(db, entrada({ wamid: "wamid.SAIDA", direction: "out", origin: "agent", text: "Segue." }), AGORA);
    assert.equal(await gravarEntrada(db, entrada({ wamid: "wamid.SAIDA", direction: "out", origin: "status", status: "read", status_only: true, text: "", type: "unknown" }), new Date(AGORA.getTime() + 1000)), "atualizada");
    assert.equal(await gravarEntrada(db, entrada({ wamid: "wamid.SAIDA", direction: "out", origin: "status", status: "delivered", status_only: true, text: "", type: "unknown" }), new Date(AGORA.getTime() + 2000)), "repetida");
    const mensagem = await db.collection(ZAP_MESSAGES_COLLECTION).doc("wamid.SAIDA").get();
    assert.equal(mensagem.data()?.status, "read");
    assert.equal(mensagem.data()?.text, "Segue.");
  });

  it("id com barra grava num documento só", async () => {
    const wamid = "wamid.A/B";
    assert.equal(await gravarEntrada(db, entrada({ wamid }), AGORA), "nova");
    assert.equal(await gravarEntrada(db, entrada({ wamid }), AGORA), "repetida");
    const docs = await db.collection(ZAP_MESSAGES_COLLECTION).get();
    assert.equal(docs.size, 1);
    assert.equal(docs.docs[0]?.data().wamid, wamid);
  });

  it("owner e admin registram acesso; os outros papéis não", async () => {
    await db.collection(USERS_COLLECTION).doc("owner-1").set({ role: "owner", nome: "Leonardo" });
    await db.collection(USERS_COLLECTION).doc("admin-1").set({ role: "admin" });
    await db.collection(USERS_COLLECTION).doc("rh-1").set({ role: "rh" });
    await db.collection(USERS_COLLECTION).doc("interno-1").set({ role: "interno" });
    await db.collection(USERS_COLLECTION).doc("off-1").set({ role: "owner", access_disabled: true });
    const owner = await requireZapCaller(db, pedido("owner-1"), "dute-homolog");
    const admin = await requireZapCaller(db, pedido("admin-1"), "dute-homolog");
    const conversa = idDaConversa(LINHA_PILOTO, CONTATO);
    const aberto = await registrarAcessoZapFor(db, owner, { action: "opened", conversation_id: conversa }, AGORA);
    await registrarAcessoZapFor(db, admin, { action: "entered" }, AGORA);
    const acesso = await db.collection(ZAP_ACCESS_COLLECTION).doc(aberto.id).get();
    assert.equal(acesso.data()?.uid, "owner-1");
    assert.equal(acesso.data()?.conversation_id, conversa);
    assert.equal(acesso.data()?.text, undefined);
    await assert.rejects(() => requireZapCaller(db, pedido("rh-1"), "dute-homolog"), (erro: unknown) => erro instanceof HttpsError && erro.code === "permission-denied");
    await assert.rejects(() => requireZapCaller(db, pedido("interno-1"), "dute-homolog"), (erro: unknown) => erro instanceof HttpsError && erro.code === "permission-denied");
    await assert.rejects(() => requireZapCaller(db, pedido("off-1"), "dute-homolog"), (erro: unknown) => erro instanceof HttpsError && erro.code === "permission-denied");
    await assert.rejects(() => requireZapCaller(db, pedido("owner-1"), "dute-btg"), (erro: unknown) => erro instanceof HttpsError && erro.code === "failed-precondition");
  });

  it("a retenção apaga o que passou de 180 dias e fica com o recente", async () => {
    const velho = new Date("2026-01-01T12:00:00.000Z");
    await gravarEntrada(db, entrada({ wamid: "wamid.VELHA", contact_wa_id: "5511900000001", text: "Antiga", occurred_at_ms: velho.getTime() }), velho);
    await gravarEntrada(db, entrada({ wamid: "wamid.NOVA", text: "Nova", occurred_at_ms: AGORA.getTime() }), AGORA);
    await db.collection(ZAP_ACCESS_COLLECTION).doc("acesso-velho").set({ uid: "owner-1", role: "owner", action: "entered", at: Timestamp.fromDate(velho) });
    const resultado = await runZapRetentionFor(db, AGORA);
    assert.deepEqual(resultado, { messages: 1, conversations: 1, access: 1 });
    const restantes = await db.collection(ZAP_MESSAGES_COLLECTION).get();
    assert.deepEqual(restantes.docs.map((doc) => doc.id).sort(), ["wamid.NOVA"]);
    const conversas = await db.collection(ZAP_CONVERSATIONS_COLLECTION).get();
    assert.equal(conversas.size, 1);
    assert.equal(conversas.docs[0]?.data().last_preview, "Nova");
  });
});
