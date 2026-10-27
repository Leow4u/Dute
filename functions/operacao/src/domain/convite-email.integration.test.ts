import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

import { enviarSoAuditoria, runNotificationsFor, soParaADutelog, type EmailParaEnviar, type EnviarEmail } from "./avisos-gravacao.js";
import { ENDERECO_DO_APP, REMETENTE_DOS_AVISOS } from "./avisos.js";

const PROJECT_ID = "demo-dute-convite-email";
const TOKEN = "0123456789abcdef0123456789abcdef0123";
const MAIL_ID = "mail_convite_a1b2c3_operacao_1";
const ORIGEM = ENDERECO_DO_APP["dute-prod"]!;
let db: Firestore;
let app: ReturnType<typeof initializeApp>;

before(() => {
  app = initializeApp({ projectId: PROJECT_ID }, "convite-email-test");
  db = getFirestore(app);
});

after(async () => { await deleteApp(app); });

beforeEach(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error("FIRESTORE_EMULATOR_HOST não definido.");
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
  await db.collection("invites").doc(TOKEN).set({
    nome: "Maria", email: "maria@cliente.com.br", role: "cliente", customer_code: "BTG Pactual", status: "pending",
    email_delivery_id: MAIL_ID, email_status: "pending",
  });
  await db.collection("email_outbox").doc(MAIL_ID).set({
    id: MAIL_ID, kind: "access_invite", invite_id: TOKEN, customer_code: "BTG Pactual", status: "pending", tentativas: 0,
  });
});

const rodar = (enviar: EnviarEmail, origem = ORIGEM) => runNotificationsFor(db, { origem, remetente: REMETENTE_DOS_AVISOS, enviar });
const email = async () => (await db.collection("email_outbox").doc(MAIL_ID).get()).data()!;
const convite = async () => (await db.collection("invites").doc(TOKEN).get()).data()!;

describe("o e-mail do convite de acesso", () => {
  it("envia para o e-mail atual do convite e registra o aceite do provedor uma única vez", async () => {
    const enviados: EmailParaEnviar[] = [];
    await db.collection("email_outbox").doc(MAIL_ID).update({ to: ["outro@invasor.com"], text: "Texto adulterado" });
    const enviar: EnviarEmail = async (dados) => { enviados.push(dados); return { status: "sent", provider_id: "re_convite" }; };
    assert.equal((await rodar(enviar)).enviados, 1);
    assert.equal((await rodar(enviar)).enviados, 0);
    assert.equal(enviados.length, 1);
    assert.deepEqual(enviados[0]!.to, ["maria@cliente.com.br"]);
    assert.equal(enviados[0]!.id, MAIL_ID);
    assert.equal(enviados[0]!.from, REMETENTE_DOS_AVISOS);
    assert.match(enviados[0]!.text, new RegExp(`https://app\\.dutelog\\.com\\.br/convite\\?invite=${TOKEN}`));
    assert.match(enviados[0]!.text, /defin.*senha/i);
    assert.ok(!enviados[0]!.subject.includes(TOKEN));
    assert.equal((await email()).status, "sent");
    assert.equal((await email()).provider_id, "re_convite");
    assert.equal((await convite()).email_status, "sent");
    assert.equal((await convite()).status, "pending");
    assert.equal((await db.collection("events").get()).size, 0);
  });

  it("usa o endereço confiável da homologação e só audita destinatário externo", async () => {
    let chamadas = 0;
    const enviar: EnviarEmail = async () => { chamadas += 1; return { status: "sent" }; };
    assert.equal((await rodar(soParaADutelog(enviar), ENDERECO_DO_APP["dute-homolog"]!)).auditados, 1);
    assert.equal(chamadas, 0);
    assert.equal((await convite()).email_status, "audit");
    await db.collection("invites").doc(TOKEN).update({ email: "maria@dutelog.com.br", email_status: "pending" });
    await db.collection("email_outbox").doc(MAIL_ID).update({ status: "pending" });
    await rodar(async (dados) => {
      assert.ok(dados.text.includes(`${ENDERECO_DO_APP["dute-homolog"]}/convite?invite=${TOKEN}`));
      return { status: "sent" };
    }, ENDERECO_DO_APP["dute-homolog"]!);
    assert.equal((await convite()).email_status, "sent");
  });

  it("sem chave de envio, guarda auditoria sem marcar o convite como aceito", async () => {
    assert.equal((await rodar(enviarSoAuditoria)).auditados, 1);
    assert.equal((await email()).status, "audit");
    assert.equal((await convite()).email_status, "audit");
    assert.equal((await convite()).status, "pending");
  });

  it("o convite da equipe usa o mesmo fluxo, sem exigir cadastro de cliente", async () => {
    await db.collection("invites").doc(TOKEN).update({ role: "wms", customer_code: "Dutelog" });
    const resultado = await rodar(async (dados) => {
      assert.deepEqual(dados.to, ["maria@cliente.com.br"]);
      return { status: "sent" };
    });
    assert.equal(resultado.enviados, 1);
  });

  it("não cria link de convite a partir de uma origem desconhecida", async () => {
    let chamadas = 0;
    await rodar(async () => { chamadas += 1; return { status: "sent" }; }, "https://outro.exemplo.com");
    assert.equal(chamadas, 0);
    assert.equal((await email()).status, "cancelled");
  });

  it("confere o cadastro atual do cliente antes de enviar", async () => {
    await db.collection("invites").doc(TOKEN).update({ customer_code: "ITAU" });
    await db.collection("client_access").doc("ITAU").set({ portal_ativo: true });
    await db.collection("customers").doc("itau").set({ code: "ITAU", sku_prefix: "ITAU", portal_status: "inactive" });
    let chamadas = 0;
    const enviar: EnviarEmail = async () => { chamadas += 1; return { status: "sent" }; };
    await rodar(enviar);
    assert.equal(chamadas, 0);
    assert.equal((await email()).status, "cancelled");
    await db.collection("customers").doc("itau").update({ portal_status: "active" });
    await db.collection("email_outbox").doc(MAIL_ID).update({ status: "pending" });
    await rodar(enviar);
    assert.equal(chamadas, 1);
    assert.equal((await convite()).email_status, "sent");
  });

  for (const status of ["used", "revoked"]) {
    it(`cancela o e-mail do convite ${status} antes de chamar o provedor`, async () => {
      await db.collection("invites").doc(TOKEN).update({ status });
      let chamadas = 0;
      await rodar(async () => { chamadas += 1; return { status: "sent" }; });
      assert.equal(chamadas, 0);
      assert.equal((await email()).status, "cancelled");
      assert.equal((await convite()).email_status, "cancelled");
    });
  }

  it("cancela o convite ausente, inválido ou de portal desligado", async () => {
    let chamadas = 0;
    const enviar: EnviarEmail = async () => { chamadas += 1; return { status: "sent" }; };
    await db.collection("invites").doc(TOKEN).delete();
    await rodar(enviar);
    assert.equal((await email()).status, "cancelled");
    await db.collection("invites").doc(TOKEN).set({ email: "sem-arroba", role: "invalido", status: "pending", email_delivery_id: MAIL_ID });
    await db.collection("email_outbox").doc(MAIL_ID).update({ status: "pending" });
    await rodar(enviar);
    assert.equal((await email()).status, "cancelled");
    await db.collection("invites").doc(TOKEN).set({ email: "maria@cliente.com.br", role: "cliente", customer_code: "BTG Pactual", status: "pending", email_delivery_id: MAIL_ID });
    await db.collection("client_access").doc("BTG Pactual").set({ portal_ativo: false });
    await db.collection("email_outbox").doc(MAIL_ID).update({ status: "pending" });
    await rodar(enviar);
    assert.equal((await email()).status, "cancelled");
    assert.equal(chamadas, 0);
  });

  it("não envia nem sobrescreve o status de uma solicitação mais nova", async () => {
    await db.collection("invites").doc(TOKEN).update({ email_delivery_id: "mail_novo", email_status: "pending" });
    let chamadas = 0;
    await rodar(async () => { chamadas += 1; return { status: "sent" }; });
    assert.equal(chamadas, 0);
    assert.equal((await email()).status, "cancelled");
    assert.equal((await convite()).email_status, "pending");
  });

  it("o resultado de uma rodada em andamento também não sobrescreve o reenvio novo", async () => {
    await rodar(async () => {
      await db.collection("invites").doc(TOKEN).update({ email_delivery_id: "mail_novo", email_status: "pending" });
      return { status: "sent" };
    });
    assert.equal((await email()).status, "sent");
    assert.equal((await convite()).email_status, "pending");
  });

  it("a falha tenta novamente sem guardar token, endereço ou mensagem do provedor", async () => {
    await db.collection("email_outbox").doc(MAIL_ID).update({ tentativas: 3 });
    const falhar: EnviarEmail = async () => { throw new Error(`Erro para maria@cliente.com.br em ${ORIGEM}/convite?invite=${TOKEN}`); };
    const primeira = await rodar(falhar);
    assert.equal(primeira.falhas, 1);
    assert.equal((await email()).status, "pending");
    assert.equal((await convite()).email_status, "pending");
    const ultima = await rodar(falhar);
    assert.equal((await email()).status, "failed");
    assert.equal((await convite()).email_status, "failed");
    assert.equal((await email()).tentativas, 5);
    assert.ok(!JSON.stringify(ultima).includes(TOKEN));
    assert.ok(!JSON.stringify(ultima).includes("maria@"));
    assert.ok(!(await email()).erro.includes(TOKEN));
  });
});
