import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import type { ActionCodeSettings, Auth, UserRecord } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

import type { EmailParaEnviar, EnviarEmail } from "./avisos-gravacao.js";
import { ENDERECO_DO_APP, REMETENTE_DOS_AVISOS } from "./avisos.js";
import { sendInviteEmailVerificationFor } from "./confirmacao-email.js";

const PROJECT_ID = "demo-dute-confirmacao-email";
const TOKEN = "0123456789abcdef0123456789abcdef0123";
const UID = "confirmacao-maria";
const EMAIL = "maria@cliente.com.br";
const OOB = "private-confirmation-code";
const INSTANTE = Date.parse("2026-10-28T15:00:00.000Z");
const ERRO_DE_ENVIO = "Não foi possível enviar a confirmação. Aguarde um minuto e tente reenviar.";
let db: Firestore;
let app: ReturnType<typeof initializeApp>;
let usuario: { uid: string; email: string; displayName: string; disabled: boolean; emailVerified: boolean };
let enviados: EmailParaEnviar[];
let gerados: Array<{ email: string; settings: ActionCodeSettings | undefined }>;
let consultasAuth: number;
let instante: number;

before(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("FIRESTORE_EMULATOR_HOST não definido.");
  app = initializeApp({ projectId: PROJECT_ID }, "confirmacao-email-test");
  db = getFirestore(app);
});

after(async () => { if (app) await deleteApp(app); });

beforeEach(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
  usuario = { uid: UID, email: EMAIL, displayName: "Maria", disabled: false, emailVerified: false };
  enviados = [];
  gerados = [];
  consultasAuth = 0;
  instante = INSTANTE;
  await db.collection("invites").doc(TOKEN).set({
    nome: "Maria", email: EMAIL, role: "cliente", customer_code: "BTG Pactual", status: "pending",
  });
});

const login = (email = EMAIL) => ({ uid: UID, token: { email, email_verified: false } });
const lerConvite = async () => (await db.collection("invites").doc(TOKEN).get()).data()!;
const auth: Pick<Auth, "getUser" | "generateEmailVerificationLink"> = {
  getUser: async (uid) => {
    assert.equal(uid, UID);
    consultasAuth += 1;
    return { ...usuario } as UserRecord;
  },
  generateEmailVerificationLink: async (email, settings) => {
    gerados.push({ email, settings });
    const projeto = settings?.url.startsWith(ENDERECO_DO_APP["dute-homolog"]!) ? "dute-homolog" : "dute-prod";
    const link = new URL(`https://${projeto}.firebaseapp.com/__/auth/action`);
    link.searchParams.set("mode", "verifyEmail");
    link.searchParams.set("oobCode", OOB);
    link.searchParams.set("apiKey", "public-test-key");
    if (settings?.url) link.searchParams.set("continueUrl", settings.url);
    return link.toString();
  },
};
const enviar: EnviarEmail = async (email) => {
  enviados.push(email);
  return { status: "sent", provider_id: "re_confirmacao" };
};
const opcoes = () => ({ projectId: "dute-prod", auth, enviar, agora: () => new Date(instante) });
const rodar = () => sendInviteEmailVerificationFor(db, login(), { token: TOKEN }, opcoes());
const recusado = (code: string) => (error: unknown) => {
  assert.equal((error as { code?: unknown }).code, code);
  return true;
};
const acessoRecusado = (error: unknown) => {
  assert.ok(["permission-denied", "not-found", "failed-precondition"].includes(String((error as { code?: unknown }).code)));
  return true;
};

describe("confirmação de e-mail pelo convite", () => {
  it("envia imediatamente HTML e texto para a conta sem perfil, mantendo o link do Firebase e a volta confiável", async () => {
    assert.deepEqual(await rodar(), { ok: true, status: "sent" });
    assert.equal(consultasAuth, 1);
    assert.deepEqual(gerados, [{ email: EMAIL, settings: { url: `${ENDERECO_DO_APP["dute-prod"]}/convite?invite=${TOKEN}`, handleCodeInApp: false } }]);
    assert.equal(enviados.length, 1);
    const email = enviados[0]!;
    assert.deepEqual(email.to, [EMAIL]);
    assert.equal(email.from, REMETENTE_DOS_AVISOS);
    assert.equal(email.subject, "Confirme seu e-mail · Dutelog");
    assert.ok(email.html);
    assert.match(email.html, /Confirmar e-mail/);
    assert.match(email.html, /https:\/\/app\.dutelog\.com\.br\/dutelog-logo\.png/);
    const href = email.html.match(/href="([^"]+)"/)?.[1]?.replace(/&amp;/g, "&");
    assert.ok(href);
    const link = new URL(href);
    assert.equal(link.hostname, "dute-prod.firebaseapp.com");
    assert.equal(link.searchParams.get("mode"), "verifyEmail");
    assert.equal(link.searchParams.get("oobCode"), OOB);
    assert.equal(link.searchParams.get("lang"), "pt-BR");
    assert.equal(link.searchParams.get("continueUrl"), gerados[0]!.settings!.url);
    assert.ok(email.text.includes(href));
    assert.equal((await lerConvite()).status, "pending");
    assert.equal((await lerConvite()).email_verification_status, "sent");
    assert.equal((await db.collection("users").doc(UID).get()).exists, false);
    assert.equal((await db.collection("email_outbox").get()).size, 0);
    assert.equal(JSON.stringify(await lerConvite()).includes(OOB), false, "o código de confirmação não pode ficar acessível aos administradores");
    assert.equal(JSON.stringify(await lerConvite()).includes("firebaseapp.com"), false);
    assert.equal(JSON.stringify(await lerConvite()).includes("<html"), false);
  });

  it("não gera link nem envia sem login", async () => {
    await assert.rejects(sendInviteEmailVerificationFor(db, undefined, { token: TOKEN }, opcoes()), recusado("unauthenticated"));
    assert.equal(consultasAuth, 0);
    assert.equal(gerados.length, 0);
    assert.equal(enviados.length, 0);
  });

  it("mantém compatibilidade com tokens antigos aceitos pelo fluxo de convite", async () => {
    const tokenAntigo = "convite-antigo_2026.01";
    await db.collection("invites").doc(tokenAntigo).set(await lerConvite());
    assert.deepEqual(await sendInviteEmailVerificationFor(db, login(), { token: tokenAntigo }, opcoes()), { ok: true, status: "sent" });
    assert.equal(gerados[0]!.settings?.url, `${ENDERECO_DO_APP["dute-prod"]}/convite?invite=${tokenAntigo}`);
  });

  it("recusa destinatário, URL e campos adicionais controlados pelo navegador", async () => {
    for (const dados of [{ token: TOKEN, email: "outro@cliente.com.br" }, { token: TOKEN, url: "https://outro.exemplo.com" }, { token: TOKEN, nome: "Outro" }, { token: "../invites/outro" }]) {
      await assert.rejects(sendInviteEmailVerificationFor(db, login(), dados, opcoes()), recusado("invalid-argument"));
    }
    assert.equal(gerados.length, 0);
    assert.equal(enviados.length, 0);
  });

  it("confere o e-mail atual do Auth e recusa claim antigo ou convite de outra pessoa", async () => {
    usuario.email = "novo@cliente.com.br";
    await assert.rejects(rodar(), acessoRecusado);
    usuario.email = EMAIL;
    await assert.rejects(sendInviteEmailVerificationFor(db, login("outra@cliente.com.br"), { token: TOKEN }, opcoes()), acessoRecusado);
    await db.collection("invites").doc(TOKEN).update({ email: "outra@cliente.com.br" });
    await assert.rejects(rodar(), acessoRecusado);
    assert.equal(gerados.length, 0);
    assert.equal(enviados.length, 0);
  });

  it("recusa conta desativada no Auth", async () => {
    usuario.disabled = true;
    await assert.rejects(rodar(), acessoRecusado);
    assert.equal(gerados.length, 0);
    assert.equal(enviados.length, 0);
  });

  for (const patch of [{ status: "used" }, { status: "revoked" }, { archived: true }, { role: "invalido" }]) {
    it(`recusa convite indisponível: ${JSON.stringify(patch)}`, async () => {
      await db.collection("invites").doc(TOKEN).update(patch);
      await assert.rejects(rodar(), acessoRecusado);
      assert.equal(gerados.length, 0);
      assert.equal(enviados.length, 0);
    });
  }

  it("não envia para convite que já não existe", async () => {
    await db.collection("invites").doc(TOKEN).delete();
    await assert.rejects(rodar(), acessoRecusado);
    assert.equal(gerados.length, 0);
  });

  it("retorna confirmação já feita sem outro envio e sem aceitar o convite", async () => {
    usuario.emailVerified = true;
    assert.deepEqual(await rodar(), { ok: true, status: "already_verified" });
    assert.equal(gerados.length, 0);
    assert.equal(enviados.length, 0);
    assert.equal((await lerConvite()).status, "pending");
    assert.equal((await db.collection("users").doc(UID).get()).exists, false);
  });

  it("só atende perfil existente se ele estiver removido e vinculado ao reconvite atual", async () => {
    await db.collection("users").doc(UID).set({ email: EMAIL, role: "cliente", customer_code: "BTG Pactual" });
    await assert.rejects(rodar(), acessoRecusado);
    await db.collection("users").doc(UID).update({ access_disabled: true, pending_invite_id: TOKEN });
    await assert.rejects(rodar(), acessoRecusado);
    await db.collection("invites").doc(TOKEN).update({ reinvite_user_id: UID });
    assert.deepEqual(await rodar(), { ok: true, status: "sent" });
    assert.equal((await db.collection("users").doc(UID).get()).get("access_disabled"), true);
  });

  it("recusa o reconvite de outra conta e o reconvite substituído", async () => {
    await db.collection("invites").doc(TOKEN).update({ reinvite_user_id: "outro-uid" });
    await assert.rejects(rodar(), acessoRecusado);
    await db.collection("invites").doc(TOKEN).update({ reinvite_user_id: UID });
    await db.collection("users").doc(UID).set({ email: EMAIL, access_disabled: true, pending_invite_id: "outro-convite" });
    await assert.rejects(rodar(), acessoRecusado);
    assert.equal(enviados.length, 0);
  });

  it("confere portal e cadastro atual do cliente antes de enviar", async () => {
    await db.collection("client_access").doc("BTG Pactual").set({ portal_ativo: false });
    await assert.rejects(rodar(), acessoRecusado);
    await db.collection("invites").doc(TOKEN).update({ customer_code: "ITAU" });
    await db.collection("customers").doc("itau").set({ code: "ITAU", sku_prefix: "ITAU", portal_status: "inactive" });
    await assert.rejects(rodar(), acessoRecusado);
    await db.collection("customers").doc("itau").update({ portal_status: "active", archived: true });
    await assert.rejects(rodar(), acessoRecusado);
    await db.collection("customers").doc("itau").update({ archived: false });
    assert.deepEqual(await rodar(), { ok: true, status: "sent" });
  });

  it("recusa ambiente desligado, envio indisponível e destinatário externo em homologação", async () => {
    await assert.rejects(sendInviteEmailVerificationFor(db, login(), { token: TOKEN }, { ...opcoes(), projectId: "dute-btg" }), acessoRecusado);
    await assert.rejects(sendInviteEmailVerificationFor(db, login(), { token: TOKEN }, { ...opcoes(), enviar: null }), recusado("failed-precondition"));
    await assert.rejects(sendInviteEmailVerificationFor(db, login(), { token: TOKEN }, { ...opcoes(), projectId: "dute-homolog" }), acessoRecusado);
    assert.equal(gerados.length, 0);
    assert.equal(enviados.length, 0);
  });

  it("em homologação usa a volta do ambiente e envia apenas para endereço Dutelog", async () => {
    usuario.email = "maria@dutelog.com.br";
    await db.collection("invites").doc(TOKEN).update({ email: usuario.email });
    const result = await sendInviteEmailVerificationFor(db, login(usuario.email), { token: TOKEN }, { ...opcoes(), projectId: "dute-homolog" });
    assert.deepEqual(result, { ok: true, status: "sent" });
    assert.equal(gerados[0]!.settings!.url, `${ENDERECO_DO_APP["dute-homolog"]}/convite?invite=${TOKEN}`);
    assert.deepEqual(enviados[0]!.to, [usuario.email]);
  });

  it("envios concorrentes reservam uma única tentativa e não geram links extras", async () => {
    const results = await Promise.allSettled([rodar(), rodar(), rodar()]);
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    for (const result of results) if (result.status === "rejected") assert.equal(result.reason.code, "resource-exhausted");
    assert.equal(gerados.length, 1);
    assert.equal(enviados.length, 1);
  });

  it("impõe um minuto entre envios e cinco tentativas por hora, incluindo falhas", async () => {
    await rodar();
    instante += 59_999;
    await assert.rejects(rodar(), recusado("resource-exhausted"));
    instante += 1;
    await rodar();
    const falhar: EnviarEmail = async () => { throw new Error("Falha simulada"); };
    for (let i = 0; i < 3; i += 1) {
      instante += 60_000;
      await assert.rejects(sendInviteEmailVerificationFor(db, login(), { token: TOKEN }, { ...opcoes(), enviar: falhar }), recusado("unavailable"));
    }
    instante += 60_000;
    await assert.rejects(rodar(), recusado("resource-exhausted"));
    assert.equal(gerados.length, 5);
    instante = INSTANTE + 60 * 60_000;
    assert.deepEqual(await rodar(), { ok: true, status: "sent" });
    assert.equal(gerados.length, 6);
  });

  it("sanitiza falhas do provedor e mantém cooldown sem guardar link ou mensagem sensível", async () => {
    const falhar: EnviarEmail = async () => { throw new Error(`Falha para ${EMAIL}: ${OOB} e ${TOKEN}`); };
    await assert.rejects(sendInviteEmailVerificationFor(db, login(), { token: TOKEN }, { ...opcoes(), enviar: falhar }), (error: unknown) => {
      assert.equal((error as { code?: unknown }).code, "unavailable");
      assert.equal((error as Error).message, ERRO_DE_ENVIO);
      assert.equal(JSON.stringify(error).includes(OOB), false);
      return true;
    });
    assert.equal((await lerConvite()).email_verification_status, "failed");
    const persisted = JSON.stringify(await lerConvite());
    assert.equal(persisted.includes(OOB), false);
    assert.equal(persisted.includes("Falha para"), false);
    assert.equal((await db.collection("email_outbox").get()).size, 0);
    await assert.rejects(rodar(), recusado("resource-exhausted"));
  });

  it("falha ao gerar o link também preserva cooldown e oculta dados do Auth", async () => {
    const failingAuth = { ...auth, generateEmailVerificationLink: async () => { throw new Error(`Auth recusou ${EMAIL}, ${TOKEN}, ${OOB}`); } };
    await assert.rejects(sendInviteEmailVerificationFor(db, login(), { token: TOKEN }, { ...opcoes(), auth: failingAuth }), (error: unknown) => {
      assert.equal((error as { code?: unknown }).code, "unavailable");
      assert.equal((error as Error).message, ERRO_DE_ENVIO);
      return true;
    });
    assert.equal(enviados.length, 0);
    assert.equal(JSON.stringify(await lerConvite()).includes(OOB), false);
    await assert.rejects(rodar(), recusado("resource-exhausted"));
  });

  it("envio apenas auditado não é tratado como confirmação enviada", async () => {
    const auditar: EnviarEmail = async () => ({ status: "audit" });
    await assert.rejects(sendInviteEmailVerificationFor(db, login(), { token: TOKEN }, { ...opcoes(), enviar: auditar }), recusado("unavailable"));
    assert.equal((await lerConvite()).email_verification_status, "failed");
    assert.equal((await lerConvite()).status, "pending");
  });
});
