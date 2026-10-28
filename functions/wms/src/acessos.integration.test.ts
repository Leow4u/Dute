import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { getFirestore } from "firebase-admin/firestore";

/**
 * O evento da mudança de acesso em Pessoas e acessos e no cadastro do
 * cliente: a linha do tempo reconstrói quem passou a ver o quê, com o antes
 * e o depois do papel da pessoa e do que o cliente libera (situação, portal,
 * modelo de operação e sigla). A callable de verdade, pelo `.run`, no
 * emulador.
 */

const PROJECT_ID = "demo-dute-operations";

type Callable = { run: (request: never) => Promise<unknown> };

let mutateManagedEntity: Callable;

function comoOwner(data: Record<string, unknown>) {
  return mutateManagedEntity.run({
    auth: { uid: "owner-a", token: { email: "owner@dutelog.com.br" } },
    data,
    rawRequest: { headers: {} },
  } as never);
}

async function eventoDoTipo(type: string) {
  const snapshot = await getFirestore().collection("events").where("type", "==", type).get();
  assert.equal(snapshot.size, 1, `eventos ${type}: ${snapshot.size}`);
  return snapshot.docs[0]!.data();
}

before(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    throw new Error("Os emuladores Firestore e Auth precisam estar definidos para testar acessos.");
  }
  const index = await import("./index.js");
  mutateManagedEntity = index.mutateManagedEntity as unknown as Callable;
  await fetch(
    `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: "DELETE" },
  );
  const db = getFirestore();
  await db.collection("users").doc("owner-a").set({ role: "owner", nome: "Owner", email: "owner@dutelog.com.br" });
  await db.collection("users").doc("ana").set({ role: "interno", nome: "Ana", email: "ana@dutelog.com.br", customer_code: "Dutelog" });
  // O interno convidado leva "Dutelog" no perfil; a Bia foi cliente do Itaú.
  await db.collection("users").doc("carlos").set({ role: "interno", nome: "Carlos", email: "carlos@dutelog.com.br", customer_code: "Dutelog" });
  await db.collection("users").doc("bia").set({ role: "interno", nome: "Bia", email: "bia@itau.com.br", customer_code: "Itau" });
  await db.collection("users").doc("davi").set({ role: "wms", nome: "Davi", email: "davi@dutelog.com.br" });
  await db.collection("customers").doc("Itau").set({
    code: "Itau",
    customer_code: "Itau",
    name: "Itaú Unibanco",
    sku_prefix: "ITAU",
    status: "active",
    portal_status: "active",
    operation_template: "uniformes",
    modules: ["wms", "financeiro"],
    archived: false,
  });
});

describe("o evento da mudança de acesso", () => {
  it("a troca de papel grava o papel de antes e o de depois", async () => {
    await comoOwner({ resource: "users", action: "set_role", id: "ana", data: { role: "wms" }, idempotency_key: "papel-da-ana" });

    const evento = await eventoDoTipo("users.set_role");
    assert.equal(evento.entity_id, "ana");
    assert.equal(evento.payload.role_before, "interno");
    assert.equal(evento.payload.role_after, "wms");
  });

  it("o cliente sem portal grava o portal de antes e o de depois, e o que não mudou fica igual", async () => {
    await comoOwner({ resource: "customers", action: "update", id: "Itau", data: { portal_status: "inactive" }, idempotency_key: "portal-do-itau" });

    const evento = await eventoDoTipo("customers.update");
    assert.equal(evento.payload.portal_status_before, "active");
    assert.equal(evento.payload.portal_status_after, "inactive");
    assert.deepEqual(
      [evento.payload.status_before, evento.payload.status_after, evento.payload.operation_template_before, evento.payload.operation_template_after, evento.payload.sku_prefix_before, evento.payload.sku_prefix_after],
      ["active", "active", "uniformes", "uniformes", "ITAU", "ITAU"],
    );
  });
});

describe("o e-mail do convite", () => {
  const token = "a".repeat(36);
  const pedido = { resource: "invites", action: "create", data: { token, nome: "Cliente", email: "cliente@exemplo.test", role: "cliente", customer_code: "BTG Pactual" }, idempotency_key: "convite-com-email" };

  it("cria convite e fila atomicamente, sem duplicar ao repetir", async () => {
    await comoOwner(pedido);
    await comoOwner(pedido);
    const db = getFirestore();
    const convite = await db.collection("invites").doc(token).get();
    const fila = await db.collection("email_outbox").where("invite_id", "==", token).get();
    assert.equal(fila.size, 1);
    assert.equal(fila.docs[0]!.get("kind"), "access_invite");
    assert.equal(fila.docs[0]!.get("status"), "pending");
    assert.equal(convite.get("email_status"), "pending");
    assert.equal(convite.get("email_delivery_id"), fila.docs[0]!.id);
    assert.equal(fila.docs[0]!.id.includes(token), false);
    const events = await db.collection("events").where("type", "==", "invites.create").get();
    assert.equal(JSON.stringify(events.docs.map((row) => row.data())).includes(token), false);
  });

  it("não duplica envio já pendente nem permite trocar destinatário no reenvio", async () => {
    await assert.rejects(comoOwner({ resource: "invites", action: "update", id: token, data: {}, idempotency_key: "reenvio-pendente" }), /agendado/);
    await assert.rejects(comoOwner({ resource: "invites", action: "update", id: token, data: { email: "outra@exemplo.test" }, idempotency_key: "reenvio-malicioso" }), /campos|alterar/i);
  });

  it("reenvia após falha com outra chave, preserva o convite e repete sem duplicar", async () => {
    const db = getFirestore();
    await db.collection("invites").doc(token).update({ email_status: "failed", email_requested_at: new Date(0) });
    const reenvio = { resource: "invites", action: "update", id: token, data: {}, idempotency_key: "reenvio-apos-falha" };
    await comoOwner(reenvio);
    await comoOwner(reenvio);
    const convite = await db.collection("invites").doc(token).get();
    const fila = await db.collection("email_outbox").where("invite_id", "==", token).get();
    assert.equal(fila.size, 2);
    assert.equal(convite.get("email_status"), "pending");
    assert.equal(convite.get("email"), "cliente@exemplo.test");
    assert.equal(convite.get("role"), "cliente");
    assert.equal(convite.get("customer_code"), "BTG Pactual");
    assert.equal(convite.get("status"), "pending");
  });

  it("recusa reenvio revogado, sem permissão e criação inválida sem agendar e-mail", async () => {
    const db = getFirestore();
    await db.collection("invites").doc(token).update({ status: "revoked" });
    await assert.rejects(comoOwner({ resource: "invites", action: "update", id: token, data: {}, idempotency_key: "revogado" }), /pendentes/);
    await assert.rejects(mutateManagedEntity.run({ auth: { uid: "davi", token: { email: "davi@dutelog.com.br" } }, data: { resource: "invites", action: "update", id: token, data: {}, idempotency_key: "sem-permissao" }, rawRequest: { headers: {} } } as never), /permiss|acesso/i);
    const antes = (await db.collection("email_outbox").get()).size;
    await assert.rejects(comoOwner({ ...pedido, data: { ...pedido.data, token: "b".repeat(36), email: "inválido@" }, idempotency_key: "email-invalido" }), /inválido/);
    assert.equal((await db.collection("email_outbox").get()).size, antes);
  });

  it("reenvio respeita intervalo mínimo e o portal atual do cliente", async () => {
    const db = getFirestore();
    const outro = "c".repeat(36);
    await comoOwner({ ...pedido, data: { ...pedido.data, token: outro }, idempotency_key: "convite-intervalo" });
    await db.collection("invites").doc(outro).update({ email_status: "sent" });
    await assert.rejects(comoOwner({ resource: "invites", action: "update", id: outro, data: {}, idempotency_key: "muito-cedo" }), /minuto/);
    // O cadastro Itau teve o portal desligado no teste anterior.
    await db.collection("invites").doc(outro).update({ email_requested_at: new Date(0), customer_code: "Itau" });
    await assert.rejects(comoOwner({ resource: "invites", action: "update", id: outro, data: {}, idempotency_key: "portal-desligado" }), /sem portal/);
  });

  it("admin não reenvia convite de administrador e convite usado não reenvia", async () => {
    const db = getFirestore();
    const outro = "d".repeat(36);
    await db.collection("users").doc("admin-email").set({ role: "admin", email: "admin@dutelog.com.br" });
    await comoOwner({ ...pedido, data: { ...pedido.data, token: outro, email: "convite-admin@dutelog.com.br", role: "admin", customer_code: "Dutelog" }, idempotency_key: "convite-admin-email" });
    await db.collection("invites").doc(outro).update({ email_status: "failed", email_requested_at: new Date(0) });
    await assert.rejects(mutateManagedEntity.run({ auth: { uid: "admin-email", token: { email: "admin@dutelog.com.br" } }, data: { resource: "invites", action: "update", id: outro, data: {}, idempotency_key: "admin-reenvia-admin" }, rawRequest: { headers: {} } } as never), /Somente o owner/);
    await db.collection("invites").doc(outro).update({ status: "used" });
    await assert.rejects(comoOwner({ resource: "invites", action: "update", id: outro, data: {}, idempotency_key: "reenvio-usado" }), /pendentes/);
  });
});

describe("a troca de papel para cliente", () => {
  const papelDe = async (uid: string) => (await getFirestore().collection("users").doc(uid).get()).get("role");

  it("o interno convidado não vira cliente de Dutelog, que não é cliente", async () => {
    await assert.rejects(
      comoOwner({ resource: "users", action: "set_role", id: "carlos", data: { role: "cliente" }, idempotency_key: "carlos-cliente" }),
      /Dutelog não está cadastrado/,
    );
    assert.equal(await papelDe("carlos"), "interno");
  });

  it("quem não está ligado a um cliente não vira cliente", async () => {
    await assert.rejects(
      comoOwner({ resource: "users", action: "set_role", id: "davi", data: { role: "cliente" }, idempotency_key: "davi-cliente" }),
      /não está ligada a um cliente/,
    );
    assert.equal(await papelDe("davi"), "wms");
  });

  it("quem já é ligado a um cliente \"Sem portal\" não vira cliente dele (pergunta 69)", async () => {
    await comoOwner({ resource: "customers", action: "update", id: "Itau", data: { portal_status: "inactive" }, idempotency_key: "itau-sem-portal" });
    await assert.rejects(
      comoOwner({ resource: "users", action: "set_role", id: "bia", data: { role: "cliente" }, idempotency_key: "bia-cliente-sem-portal" }),
      /O cliente Itau está sem portal/,
    );
    assert.equal(await papelDe("bia"), "interno");
  });

  it("quem já é ligado a um cliente cadastrado, com o portal ligado, vira cliente dele", async () => {
    await comoOwner({ resource: "customers", action: "update", id: "Itau", data: { portal_status: "active" }, idempotency_key: "itau-com-portal" });
    await comoOwner({ resource: "users", action: "set_role", id: "bia", data: { role: "cliente" }, idempotency_key: "bia-cliente" });
    assert.equal(await papelDe("bia"), "cliente");
  });
});

describe("o token do convite", () => {
  const convite = (extra: Record<string, unknown>, chave: string) =>
    comoOwner({
      resource: "invites",
      action: "create",
      data: { nome: "Pessoa", email: `${chave}@exemplo.com`, role: "wms", customer_code: "Dutelog" },
      idempotency_key: chave,
      ...extra,
    });

  it("sem token, o convite não nasce com um id adivinhável", async () => {
    const antes = (await getFirestore().collection("invites").get()).docs.map((doc) => doc.id);
    await assert.rejects(convite({}, "sem-token"), /token gerado pela tela de Usuários/);
    const convites = await getFirestore().collection("invites").get();
    assert.deepEqual(convites.docs.map((doc) => doc.id), antes);
  });

  it("o token curto, pelo dado ou pelo id, também não serve", async () => {
    await assert.rejects(
      comoOwner({ resource: "invites", action: "create", data: { token: "1234567890123", nome: "P", email: "curto@exemplo.com", role: "wms", customer_code: "Dutelog" }, idempotency_key: "token-curto" }),
      /token gerado pela tela de Usuários/,
    );
    await assert.rejects(
      comoOwner({ resource: "invites", action: "create", id: "convite-1", data: { nome: "P", email: "id@exemplo.com", role: "wms", customer_code: "Dutelog" }, idempotency_key: "id-curto" }),
      /token gerado pela tela de Usuários/,
    );
  });

  it("o token da tela de Usuários vira o id do convite", async () => {
    const token = "0123456789abcdef0123456789abcdef0123";
    await comoOwner({ resource: "invites", action: "create", data: { token, nome: "P", email: "ok@exemplo.com", role: "wms", customer_code: "Dutelog" }, idempotency_key: "token-bom" });
    assert.equal((await getFirestore().collection("invites").doc(token).get()).get("email"), "ok@exemplo.com");
  });
});

describe("remover pessoas da lista", () => {
  it("recusa ativos; oculta o perfil removido sem apagar identidade nem eventos", async () => {
    await assert.rejects(comoOwner({ resource: "users", action: "archive", id: "ana", data: {}, idempotency_key: "arquivar-ana-ativa" }), /Revogue/);
    const db = getFirestore();
    await db.collection("users").doc("removida").set({ nome: "Removida", email: "removida@dutelog.com.br", role: "wms", access_disabled: true });
    const input = { resource: "users", action: "archive", id: "removida", data: {}, idempotency_key: "arquivar-removida" };
    await comoOwner(input);
    await comoOwner(input);
    const profile = (await db.collection("users").doc("removida").get()).data()!;
    assert.equal(profile.directory_hidden, true);
    assert.equal(profile.email, "removida@dutelog.com.br");
    assert.equal(profile.access_disabled, true);
    const events = await db.collection("events").where("type", "==", "users.archive").get();
    assert.equal(events.size, 1);
  });
  it("não deixa admin remover outro administrador nem convidá-lo com papel menor", async () => {
    const db = getFirestore();
    await db.collection("users").doc("admin-diretorio").set({ role: "admin", email: "admin-diretorio@dutelog.com.br" });
    await db.collection("users").doc("owner-removido").set({ role: "owner", email: "owner-removido@dutelog.com.br", access_disabled: true });
    const run = (data: Record<string, unknown>) => mutateManagedEntity.run({ auth: { uid: "admin-diretorio", token: { email: "admin-diretorio@dutelog.com.br" } }, data, rawRequest: { headers: {} } } as never);
    await assert.rejects(run({ resource: "users", action: "archive", id: "owner-removido", data: {}, idempotency_key: "admin-arquiva-owner" }), /Somente o owner/);
    await assert.rejects(run({ resource: "invites", action: "create", data: { token: "da".repeat(18), email: "owner-removido@dutelog.com.br", role: "wms" }, idempotency_key: "admin-reconvida-owner" }), /Somente o owner/);
  });
});

describe("reconvite completo pelo servidor", () => {
  it("cria o convite depois de remover da lista e só restaura o perfil no aceite", async () => {
    const { getAuth } = await import("firebase-admin/auth");
    const { acceptInviteFor } = await import("./domain/invite-acceptance.js");
    const auth = getAuth();
    const uid = "reconvidada";
    const email = "reconvidada@dutelog.com.br";
    await auth.deleteUser(uid).catch((error: { code?: string }) => { if (error.code !== "auth/user-not-found") throw error; });
    await auth.createUser({ uid, email, disabled: true, emailVerified: true });
    const ref = getFirestore().collection("users").doc(uid);
    await ref.set({ nome: "Reconvidada", email, role: "wms", customer_code: "Dutelog", access_disabled: true, created_at: "original" });
    await comoOwner({ resource: "users", action: "archive", id: uid, data: {}, idempotency_key: "remove-antes-do-reconvite" });
    const token = "ef".repeat(18);
    const input = { resource: "invites", action: "create", data: { token, nome: "Reconvidada", email, role: "wms", customer_code: "Dutelog" }, idempotency_key: "reconvite-completo" };
    await comoOwner(input);
    await comoOwner(input);
    assert.equal((await auth.getUser(uid)).disabled, false);
    assert.equal((await ref.get()).get("access_disabled"), true);
    assert.equal((await ref.get()).get("directory_hidden"), true);
    assert.equal((await getFirestore().collection("invites").doc(token).get()).get("reinvite_user_id"), uid);
    await acceptInviteFor(getFirestore(), { uid, token: { email, email_verified: true } }, { token, nome: "Reconvidada" });
    const profile = (await ref.get()).data()!;
    assert.equal(profile.access_disabled, false);
    assert.equal(profile.directory_hidden, false);
    assert.equal(profile.created_at, "original");
    assert.equal(profile.pending_invite_id, undefined);
    await auth.deleteUser(uid);
  });
});

describe("proteção do reconvite após a criação", () => {
  it("admin não reenvia nem cancela reconvite de owner com papel proposto menor", async () => {
    const db = getFirestore();
    await db.collection("users").doc("admin-diretorio").set({ role: "admin", email: "admin-diretorio@dutelog.com.br" });
    await db.collection("users").doc("owner-protegido").set({ role: "owner", email: "owner-protegido@dutelog.com.br", access_disabled: true });
    const token = "ad".repeat(18);
    await comoOwner({ resource: "invites", action: "create", data: { token, email: "owner-protegido@dutelog.com.br", role: "wms" }, idempotency_key: "owner-convida-papel-menor" });
    await db.collection("invites").doc(token).update({ email_status: "failed", email_requested_at: new Date(0) });
    for (const action of ["update", "archive"]) {
      await assert.rejects(mutateManagedEntity.run({ auth: { uid: "admin-diretorio", token: { email: "admin-diretorio@dutelog.com.br" } }, data: { resource: "invites", action, id: token, data: {}, idempotency_key: `admin-nao-${action}-owner` }, rawRequest: { headers: {} } } as never), /Somente o owner/);
    }
  });
  it("uma falha no Auth é recuperável imediatamente sem outro convite nem outro e-mail", async (t) => {
    const { getAuth } = await import("firebase-admin/auth");
    const db = getFirestore();
    await db.collection("users").doc("falha-login").set({ role: "wms", email: "falha-login@dutelog.com.br", access_disabled: true });
    const auth = getAuth();
    let failing = true;
    t.mock.method(auth, "updateUser", async () => { if (failing) throw new Error("Auth indisponível"); return {}; });
    const token = "fa".repeat(18);
    await assert.rejects(comoOwner({ resource: "invites", action: "create", data: { token, email: "falha-login@dutelog.com.br", role: "wms" }, idempotency_key: "cria-com-falha-login" }), /login não ficou pronto/);
    const mailsBefore = await db.collection("email_outbox").where("invite_id", "==", token).get();
    failing = false;
    await comoOwner({ resource: "invites", action: "update", id: token, data: {}, idempotency_key: "recupera-login-sem-email-duplicado" });
    const mailsAfter = await db.collection("email_outbox").where("invite_id", "==", token).get();
    assert.equal(mailsAfter.size, mailsBefore.size);
    assert.equal((await db.collection("invites").doc(token).get()).get("login_preparation_pending"), false);
    assert.equal((await db.collection("users").doc("falha-login").get()).get("access_disabled"), true);
  });
});
