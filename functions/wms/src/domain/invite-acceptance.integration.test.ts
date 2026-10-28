import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

import { inviteEventReference } from "./customer-invite.js";
import { LEGACY_CUSTOMER_CODE } from "./customer-scope.js";
import { acceptInviteFor, lookupInviteFor } from "./invite-acceptance.js";

const PROJECT_ID = "demo-dute-operations";
let db: Firestore;
let app: ReturnType<typeof initializeApp>;

const TOKEN = "0123456789abcdef0123456789abcdef";
const AGORA = () => new Date("2026-10-26T12:00:00.000Z");

/** A conta da Ana, com o e-mail do convite confirmado. */
const ANA = { uid: "u-ana", token: { email: "Ana@Cliente.com.br", email_verified: true } };

async function convite(dados: Record<string, unknown>, token = TOKEN) {
  await db.collection("invites").doc(token).set({
    email: "ana@cliente.com.br",
    nome: "Ana",
    role: "cliente",
    customer_code: "ITAU",
    status: "pending",
    ...dados,
  });
}

async function cliente(dados: Record<string, unknown> = {}) {
  await db.collection("customers").doc("itau").set({ code: "ITAU", name: "Itaú Unibanco", sku_prefix: "ITA", ...dados });
}

async function eventosDe(uid: string) {
  const snapshot = await db.collection("events").where("entity_id", "==", uid).get();
  return snapshot.docs.map((documento) => ({ id: documento.id, ...documento.data() }) as Record<string, unknown>);
}

/** Nada mudou: o convite segue pendente, sem perfil nem evento. */
async function nadaGravado(uid: string, token = TOKEN) {
  assert.equal((await db.collection("users").doc(uid).get()).exists, false);
  assert.equal((await db.collection("invites").doc(token).get()).data()?.status, "pending");
  assert.deepEqual(await eventosDe(uid), []);
}

before(() => {
  app = initializeApp({ projectId: PROJECT_ID }, "invite-acceptance-test");
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

describe("o aceite do convite pelo servidor (pergunta 68)", () => {
  it("com o e-mail confirmado: cria o perfil, usa o convite e grava o evento sem o token; repetir devolve o mesmo", async () => {
    await cliente();
    await convite({});

    const resultado = await acceptInviteFor(db, ANA, { token: TOKEN, nome: "  Ana Souza " }, AGORA);
    assert.deepEqual(resultado, { ok: true, role: "cliente", customer_code: "ITAU" });

    const perfil = (await db.collection("users").doc("u-ana").get()).data() ?? {};
    assert.equal(perfil.nome, "Ana Souza");
    assert.equal(perfil.email, "ana@cliente.com.br");
    assert.equal(perfil.role, "cliente");
    assert.equal(perfil.customer_code, "ITAU");
    assert.equal(perfil.invite_id, TOKEN);

    const usado = (await db.collection("invites").doc(TOKEN).get()).data() ?? {};
    assert.equal(usado.status, "used");
    assert.equal(usado.used_by, "u-ana");
    assert.ok(usado.used_at);

    const eventos = await eventosDe("u-ana");
    assert.equal(eventos.length, 1);
    const [evento] = eventos;
    assert.equal(evento.id, `evt_${inviteEventReference(TOKEN)}_aceito`);
    assert.equal(evento.type, "access.invite_accepted");
    assert.equal(evento.title, "Convite aceito");
    assert.equal(evento.description, "Ana Souza ativou acesso como cliente.");
    assert.equal(evento.customer_code, "ITAU");
    assert.equal(evento.entity_type, "usuario");
    assert.equal(evento.occurred_at, "2026-10-26T12:00:00.000Z");
    assert.equal(evento.source, "functions_access");
    assert.deepEqual(evento.payload, { role: "cliente", customer_code: "ITAU", invite_ref: inviteEventReference(TOKEN) });
    assert.deepEqual(evento.actor, { uid: "u-ana", email: "ana@cliente.com.br", name: "Ana Souza", role: "cliente", customer_code: "ITAU" });
    assert.equal(JSON.stringify(evento).includes(TOKEN), false);

    const repetido = await acceptInviteFor(db, ANA, { token: TOKEN, nome: "Ana Souza" }, AGORA);
    assert.deepEqual(repetido, { ok: true, role: "cliente", customer_code: "ITAU", replayed: true });
    assert.equal((await eventosDe("u-ana")).length, 1);
  });

  it("sem o e-mail confirmado, nada é gravado", async () => {
    await cliente();
    await convite({});
    await assert.rejects(
      acceptInviteFor(db, { uid: "u-ana", token: { email: "ana@cliente.com.br", email_verified: false } }, { token: TOKEN, nome: "Ana" }, AGORA),
      { code: "failed-precondition", message: "Confirme seu e-mail antes de aceitar o convite." },
    );
    await assert.rejects(acceptInviteFor(db, { uid: "u-ana", token: { email_verified: true } }, { token: TOKEN, nome: "Ana" }, AGORA), {
      code: "failed-precondition",
      message: "A conta não tem e-mail.",
    });
    await assert.rejects(acceptInviteFor(db, undefined, { token: TOKEN, nome: "Ana" }, AGORA), {
      code: "unauthenticated",
      message: "Faça login para continuar.",
    });
    await nadaGravado("u-ana");
  });

  it("o convite de outro e-mail é recusado, mesmo confirmado", async () => {
    await cliente();
    await convite({});
    await assert.rejects(
      acceptInviteFor(db, { uid: "u-bia", token: { email: "bia@cliente.com.br", email_verified: true } }, { token: TOKEN, nome: "Bia" }, AGORA),
      { code: "permission-denied", message: "Este convite é de outro e-mail." },
    );
    await nadaGravado("u-bia");
  });

  it("o convite usado por outra conta, o revogado e o que não existe não valem", async () => {
    await cliente();
    await convite({ status: "used", used_by: "u-outra" });
    await assert.rejects(acceptInviteFor(db, ANA, { token: TOKEN, nome: "Ana" }, AGORA), {
      code: "failed-precondition",
      message: "Este convite já foi usado.",
    });

    await convite({ status: "revoked" });
    await assert.rejects(acceptInviteFor(db, ANA, { token: TOKEN, nome: "Ana" }, AGORA), {
      code: "failed-precondition",
      message: "Este convite não vale mais.",
    });

    await assert.rejects(acceptInviteFor(db, ANA, { token: "fedcba9876543210fedcba9876543210", nome: "Ana" }, AGORA), {
      code: "not-found",
      message: "Convite inválido ou não encontrado.",
    });
    assert.equal((await db.collection("users").doc("u-ana").get()).exists, false);
    assert.deepEqual(await eventosDe("u-ana"), []);
  });

  it("a conta que já tem perfil não troca de perfil pelo convite", async () => {
    await cliente();
    await convite({});
    await db.collection("users").doc("u-ana").set({ nome: "Ana", email: "ana@cliente.com.br", role: "wms", customer_code: "Dutelog" });
    await assert.rejects(acceptInviteFor(db, ANA, { token: TOKEN, nome: "Ana" }, AGORA), {
      code: "failed-precondition",
      message: "Esta conta já tem acesso. Para mudar o perfil, fale com quem administra os acessos.",
    });
    assert.equal((await db.collection("users").doc("u-ana").get()).data()?.role, "wms");
    assert.equal((await db.collection("invites").doc(TOKEN).get()).data()?.status, "pending");
  });

  it("o cliente sem portal ou arquivado não recebe a pessoa (pergunta 69)", async () => {
    await convite({});
    await cliente({ portal_status: "inactive" });
    await assert.rejects(acceptInviteFor(db, ANA, { token: TOKEN, nome: "Ana" }, AGORA), {
      code: "failed-precondition",
      message: "O cliente ITAU está sem portal.",
    });
    await cliente({ status: "archived" });
    await assert.rejects(acceptInviteFor(db, ANA, { token: TOKEN, nome: "Ana" }, AGORA), {
      code: "failed-precondition",
      message: "O cliente ITAU está arquivado.",
    });
    await nadaGravado("u-ana");
  });

  it("sem o cliente no convite: a BTG para o cliente antigo e a Dutelog para a equipe", async () => {
    await convite({ customer_code: null });
    const doCliente = await acceptInviteFor(db, ANA, { token: TOKEN, nome: "Ana" }, AGORA);
    assert.equal(doCliente.customer_code, LEGACY_CUSTOMER_CODE);

    const outro = "abcdefabcdefabcdefabcdefabcdefab";
    await convite({ email: "rafa@dutelog.com.br", role: "wms", customer_code: "" }, outro);
    const daEquipe = await acceptInviteFor(db, { uid: "u-rafa", token: { email: "rafa@dutelog.com.br", email_verified: true } }, { token: outro, nome: "Rafael" }, AGORA);
    assert.deepEqual(daEquipe, { ok: true, role: "wms", customer_code: "Dutelog" });
    const [evento] = await eventosDe("u-rafa");
    assert.equal(evento.description, "Rafael ativou acesso como operação WMS.");
  });

  it("o pedido leva só o token e o nome", async () => {
    await cliente();
    await convite({});
    await assert.rejects(acceptInviteFor(db, ANA, { token: "curto", nome: "Ana" }, AGORA), {
      code: "invalid-argument",
      message: "Convite inválido ou não encontrado.",
    });
    await assert.rejects(acceptInviteFor(db, ANA, { token: TOKEN, nome: "   " }, AGORA), { code: "invalid-argument", message: "Informe seu nome." });
    // O perfil vem do convite, nunca do pedido.
    await assert.rejects(acceptInviteFor(db, ANA, { token: TOKEN, nome: "Ana", role: "owner" }, AGORA), { code: "invalid-argument" });
    await nadaGravado("u-ana");
  });
});

describe("a consulta do convite pelo link", () => {
  it("dá o e-mail, o perfil e o nome do cliente, e nada do convite usado", async () => {
    await cliente();
    await convite({ email: " Ana@Cliente.com.br " });
    assert.deepEqual(await lookupInviteFor(db, { token: TOKEN }), {
      email: "ana@cliente.com.br",
      nome: "Ana",
      role: "cliente",
      customer_code: "ITAU",
      customer_name: "Itaú Unibanco",
      status: "pending",
    });

    const daEquipe = "abcdefabcdefabcdefabcdefabcdefab";
    await convite({ email: "rafa@dutelog.com.br", nome: "", role: "wms", customer_code: "Dutelog" }, daEquipe);
    assert.deepEqual(await lookupInviteFor(db, { token: daEquipe }), {
      email: "rafa@dutelog.com.br",
      role: "wms",
      customer_code: "Dutelog",
      status: "pending",
    });

    await convite({ status: "used", used_by: "u-ana" });
    await assert.rejects(lookupInviteFor(db, { token: TOKEN }), { code: "not-found", message: "Convite inválido ou não encontrado." });
    await assert.rejects(lookupInviteFor(db, { token: "../users/u-ana" }), { code: "not-found", message: "Convite inválido ou não encontrado." });
  });
});

describe("aceitar novamente preservando identidade e histórico", () => {
  it("reativa só no aceite do convite atual, remove a ocultação e mantém o mesmo UID", async () => {
    await cliente();
    await convite({ reinvite_user_id: "u-ana" });
    await db.collection("users").doc("u-ana").set({
      nome: "Ana antiga", email: "ana@cliente.com.br", role: "wms", customer_code: "Dutelog",
      access_disabled: true, directory_hidden: true, pending_invite_id: TOKEN,
      created_at: "data-original", access_change_reason: "Saiu da empresa",
    });
    await acceptInviteFor(db, ANA, { token: TOKEN, nome: "Ana Souza" }, AGORA);
    const profile = (await db.collection("users").doc("u-ana").get()).data()!;
    assert.equal(profile.access_disabled, false);
    assert.equal(profile.directory_hidden, false);
    assert.equal(profile.pending_invite_id, undefined);
    assert.equal(profile.created_at, "data-original");
    assert.equal(profile.role, "cliente");
    assert.equal(profile.customer_code, "ITAU");
    assert.equal((await eventosDe("u-ana")).length, 1);
    const again = await acceptInviteFor(db, ANA, { token: TOKEN, nome: "Ana Souza" }, AGORA);
    assert.equal(again.replayed, true);
  });
  it("não restaura por convite antigo, sem vínculo, cancelado ou para outro e-mail", async () => {
    await cliente();
    await convite({ reinvite_user_id: "u-ana" });
    await db.collection("users").doc("u-ana").set({ email: "ana@cliente.com.br", role: "wms", access_disabled: true, pending_invite_id: "mais-recente" });
    await assert.rejects(acceptInviteFor(db, ANA, { token: TOKEN, nome: "Ana" }), /convite|acesso/);
    await db.collection("users").doc("u-ana").update({ pending_invite_id: TOKEN });
    await convite({});
    await assert.rejects(acceptInviteFor(db, ANA, { token: TOKEN, nome: "Ana" }), /convite|acesso/);
    await convite({ reinvite_user_id: "u-ana", status: "revoked" });
    await assert.rejects(acceptInviteFor(db, ANA, { token: TOKEN, nome: "Ana" }), /não vale mais/);
    await convite({ reinvite_user_id: "u-ana" });
    await assert.rejects(acceptInviteFor(db, { uid: "u-ana", token: { email: "outra@cliente.com.br", email_verified: true } }, { token: TOKEN, nome: "Ana" }), /outro e-mail/);
    assert.equal((await db.collection("users").doc("u-ana").get()).get("access_disabled"), true);
    assert.equal((await eventosDe("u-ana")).length, 0);
  });
});
