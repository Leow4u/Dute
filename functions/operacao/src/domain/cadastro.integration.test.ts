import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";

import { COLLABORATORS_COLLECTION, VEHICLES_COLLECTION } from "./cadastro.js";
import { EVENTS_COLLECTION, OPERACAO_EVENT_SOURCE } from "./events.js";
import { saveCollaboratorFor, saveVehicleFor } from "./gravacao.js";
import { OPERACAO_OPERATIONS_COLLECTION } from "./operations.js";
import { SERVICE_ORDERS_COLLECTION } from "./os.js";
import type { OperacaoProfile } from "./profile.js";

const PROJECT_ID = "demo-dute-operacao";
const CPF = "52998224725";

let db: Firestore;
let app: ReturnType<typeof initializeApp>;

const interno: OperacaoProfile = { uid: "interno-1", role: "interno", name: "Marina", email: "marina@dutelog.com.br" };
const campo: OperacaoProfile = { uid: "campo-1", role: "campo", name: "Paulo" };

before(() => {
  app = initializeApp({ projectId: PROJECT_ID }, "operacao-cadastro-test");
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

async function rejection(promise: Promise<unknown>): Promise<HttpsError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof HttpsError, `esperava HttpsError, veio ${String(error)}`);
    return error;
  }
  assert.fail("deveria recusar");
}

const criar = {
  action: "create",
  idempotency_key: "criar-ana",
  nome: "Ana Souza",
  cpf: "529.982.247-25",
  funcao: "Motorista",
  telefone: "(11) 98765-4321",
  cnh_categoria: "C",
  cnh_validade: "2028-04-01",
};

describe("gravação do cadastro", () => {
  it("cria o colaborador, guarda o CPF no documento e o evento sem a pessoa", async () => {
    const resultado = await saveCollaboratorFor(db, interno, criar);
    assert.match(resultado.id, /^col_[a-f0-9]{16}$/);
    assert.equal(resultado.edicao, 1);

    const repetido = await saveCollaboratorFor(db, interno, criar);
    assert.equal(repetido.id, resultado.id);
    assert.equal(repetido.replayed, true);
    assert.equal((await db.collection(COLLABORATORS_COLLECTION).get()).size, 1);

    const doc = (await db.collection(COLLABORATORS_COLLECTION).doc(resultado.id).get()).data() ?? {};
    assert.equal(doc.cpf, CPF);
    assert.equal(doc.nome, "Ana Souza");
    assert.equal(doc.atualizado_por.role, "interno");
    assert.equal(doc.atualizado_por.uid, "interno-1");
    assert.equal(doc.atualizado_por.name, undefined);

    const eventos = await db.collection(EVENTS_COLLECTION).get();
    assert.equal(eventos.size, 1);
    const evento = eventos.docs[0].data();
    assert.equal(evento.type, "collaborator.created");
    assert.equal(evento.source, OPERACAO_EVENT_SOURCE);
    assert.equal(evento.customer_code, null);
    const texto = JSON.stringify(evento);
    assert.equal(texto.includes("Ana"), false);
    assert.equal(texto.includes(CPF), false);
    assert.equal(texto.includes("98765"), false);
    assert.equal((await db.collection(OPERACAO_OPERATIONS_COLLECTION).get()).size, 1);
  });

  it("o mesmo CPF em outra pessoa é already-exists, e campo não grava", async () => {
    await saveCollaboratorFor(db, interno, criar);
    const outro = await rejection(saveCollaboratorFor(db, interno, { ...criar, idempotency_key: "outra", nome: "Ana Lima" }));
    assert.equal(outro.code, "already-exists");
    assert.match(outro.message, /CPF/);
    const negado = await rejection(saveCollaboratorFor(db, campo, { ...criar, idempotency_key: "campo", cpf: "39053344705", nome: "Paulo Lima" }));
    assert.equal(negado.code, "permission-denied");
  });

  it("atualiza com a edição vista, recusa a edição velha e desativa", async () => {
    const criado = await saveCollaboratorFor(db, interno, criar);
    const atualizado = await saveCollaboratorFor(db, interno, {
      action: "update",
      idempotency_key: "ajusta-funcao",
      id: criado.id,
      expected_edicao: 1,
      funcao: "Coordenador",
    });
    assert.equal(atualizado.edicao, 2);
    const velha = await rejection(saveCollaboratorFor(db, interno, {
      action: "update",
      idempotency_key: "funcao-velha",
      id: criado.id,
      expected_edicao: 1,
      funcao: "Ajudante",
    }));
    assert.equal(velha.code, "failed-precondition");
    const desativado = await saveCollaboratorFor(db, interno, {
      action: "set_active",
      idempotency_key: "desativa",
      id: criado.id,
      expected_edicao: 2,
      ativo: false,
    });
    assert.equal(desativado.edicao, 3);
    const doc = (await db.collection(COLLABORATORS_COLLECTION).doc(criado.id).get()).data() ?? {};
    assert.equal(doc.ativo, false);
    assert.equal(doc.funcao, "Coordenador");
    const tipos = (await db.collection(EVENTS_COLLECTION).get()).docs.map((item) => item.data().type).sort();
    assert.deepEqual(tipos, ["collaborator.created", "collaborator.deactivated", "collaborator.updated"]);
  });

  it("a placa não se repete e o evento do veículo não leva a placa", async () => {
    const criado = await saveVehicleFor(db, interno, {
      action: "create",
      idempotency_key: "van",
      placa: "abc-1d23",
      tipo: "VUC",
      modelo: "Daily",
      capacidade_kg: 3500,
      capacidade_m3: 12.5,
    });
    assert.match(criado.id, /^vei_[a-f0-9]{16}$/);
    const doc = (await db.collection(VEHICLES_COLLECTION).doc(criado.id).get()).data() ?? {};
    assert.equal(doc.placa, "ABC1D23");
    const repetida = await rejection(saveVehicleFor(db, interno, {
      action: "create",
      idempotency_key: "outra-van",
      placa: "ABC1D23",
      tipo: "VUC",
      capacidade_kg: 2000,
      capacidade_m3: 8,
    }));
    assert.equal(repetida.code, "already-exists");
    assert.match(repetida.message, /placa/);
    const evento = (await db.collection(EVENTS_COLLECTION).get()).docs[0].data();
    assert.equal(evento.type, "vehicle.created");
    assert.equal(JSON.stringify(evento).includes("ABC1D23"), false);
  });
});

describe("login do app no colaborador (parte 3.4)", () => {
  async function usuario(uid: string, email: string, role: string, extra: Record<string, unknown> = {}) {
    await db.collection("users").doc(uid).set({ email, role, nome: uid, ...extra });
  }

  it("liga pelo e-mail a quem tem o papel campo; o mesmo login não liga a outra pessoa", async () => {
    await usuario("u-paulo", "paulo@dutelog.com.br", "campo");
    const ana = await saveCollaboratorFor(db, interno, { ...criar, usuario_email: "Paulo@Dutelog.com.br", papeis: ["lider", "motorista"] });
    const doc = (await db.collection(COLLABORATORS_COLLECTION).doc(ana.id).get()).data() ?? {};
    assert.equal(doc.usuario_uid, "u-paulo");
    assert.equal(doc.usuario_email, "paulo@dutelog.com.br");
    assert.deepEqual(doc.papeis, ["lider", "motorista"]);
    assert.equal(doc.vinculo, "proprio");

    const outra = await rejection(
      saveCollaboratorFor(db, interno, { ...criar, idempotency_key: "criar-bia", nome: "Bia Rocha", cpf: "39053344705", usuario_email: "paulo@dutelog.com.br" }),
    );
    assert.equal(outra.code, "already-exists");

    // Tirar o e-mail desliga o login.
    const desligado = await saveCollaboratorFor(db, interno, {
      action: "update",
      idempotency_key: "desligar",
      id: ana.id,
      expected_edicao: 1,
      usuario_email: null,
    });
    const depois = (await db.collection(COLLABORATORS_COLLECTION).doc(desligado.id).get()).data() ?? {};
    assert.equal(depois.usuario_uid, null);
    assert.equal(depois.usuario_email, null);
  });

  it("recusa e-mail sem usuário, papel sem app e acesso removido", async () => {
    await usuario("u-wms", "wms@dutelog.com.br", "wms");
    await usuario("u-off", "off@dutelog.com.br", "campo", { access_disabled: true });
    for (const [email, trecho] of [
      ["ninguem@dutelog.com.br", /Nenhum usuário/],
      ["wms@dutelog.com.br", /papel campo ou interno/],
      ["off@dutelog.com.br", /acesso deste usuário foi removido/],
    ] as const) {
      const erro = await rejection(saveCollaboratorFor(db, interno, { ...criar, idempotency_key: `k-${email}`, usuario_email: email }));
      assert.equal(erro.code, "failed-precondition", email);
      assert.match(erro.message, trecho);
    }
    assert.equal((await db.collection(COLLABORATORS_COLLECTION).get()).size, 0);
  });

  it("cadastro antigo, sem os campos novos, lê como próprio e sem papel; atualizar grava os padrões", async () => {
    await db.collection(COLLABORATORS_COLLECTION).doc("col_aaaaaaaaaaaaaaaa").set({
      nome: "Ana Souza",
      cpf: CPF,
      funcao: "Motorista",
      telefone: null,
      cnh: null,
      ativo: true,
      edicao: 1,
    });
    await saveCollaboratorFor(db, interno, {
      action: "update",
      idempotency_key: "papeis",
      id: "col_aaaaaaaaaaaaaaaa",
      expected_edicao: 1,
      papeis: ["motorista"],
    });
    const doc = (await db.collection(COLLABORATORS_COLLECTION).doc("col_aaaaaaaaaaaaaaaa").get()).data() ?? {};
    assert.deepEqual([doc.vinculo, doc.empresa, doc.papeis, doc.usuario_uid], ["proprio", null, ["motorista"], null]);
  });
});

describe("o login do app nas OS que ainda vão a campo (parte 3.4)", () => {
  const VALTER = { colaborador_id: "col_cccccccccccccccc", nome: "Valter Moreira", papel: "motorista", vinculo: "terceiro", empresa: "Rota Sul", no_app: true, usuario_uid: "u-valter" };

  async function usuario(uid: string, email: string) {
    await db.collection("users").doc(uid).set({ email, role: "campo", nome: uid });
  }

  async function os(numero: string, status: string, equipe: unknown[], equipe_uids: string[], edicao = 2) {
    await db.collection(SERVICE_ORDERS_COLLECTION).doc(numero).set({ numero, demanda: numero.slice(0, 5), customer_code: "ITAU", status, equipe, equipe_uids, edicao });
  }

  async function lida(numero: string) {
    return (await db.collection(SERVICE_ORDERS_COLLECTION).doc(numero).get()).data() ?? {};
  }

  async function trocar(id: string, edicao: number, chave: string, usuario_email: string | null) {
    return saveCollaboratorFor(db, interno, { action: "update", idempotency_key: chave, id, expected_edicao: edicao, usuario_email });
  }

  it("ligar dá o acesso às OS abertas da pessoa; trocar e tirar tiram o do login antigo; a concluída fica", async () => {
    await usuario("u-ana", "ana@dutelog.com.br");
    await usuario("u-ana2", "ana.souza@dutelog.com.br");
    const { id } = await saveCollaboratorFor(db, interno, criar);
    const ana = { colaborador_id: id, nome: "Ana Souza", papel: "lider", vinculo: "proprio", empresa: null, no_app: false, usuario_uid: null };
    await os("10045-01", "agendada", [ana, VALTER], ["u-valter"]);
    await os("10045-02", "em_execucao", [ana], [], 3);
    await os("10045-03", "aberta", [ana], []);
    await os("10045-04", "revisada", [ana], []);
    await os("10046-01", "agendada", [VALTER], ["u-valter"]);

    await trocar(id, 1, "ligar", "ana@dutelog.com.br");
    let agendada = await lida("10045-01");
    assert.deepEqual(agendada.equipe_uids, ["u-valter", "u-ana"]);
    assert.deepEqual(agendada.equipe, [{ ...ana, no_app: true, usuario_uid: "u-ana" }, VALTER]);
    assert.equal(agendada.edicao, 3);
    assert.deepEqual(agendada.atualizado_por, { uid: "interno-1", role: "interno" });
    assert.deepEqual((await lida("10045-02")).equipe_uids, ["u-ana"]);
    assert.equal((await lida("10045-02")).edicao, 4);
    assert.deepEqual((await lida("10045-03")).equipe_uids, ["u-ana"]);
    assert.deepEqual((await lida("10045-04")).equipe_uids, []);
    assert.equal((await lida("10045-04")).edicao, 2);
    assert.deepEqual((await lida("10046-01")).equipe_uids, ["u-valter"]);
    assert.equal((await lida("10046-01")).edicao, 2);

    // Repetir não grava de novo; o evento leva só os números das OS.
    await trocar(id, 1, "ligar", "ana@dutelog.com.br");
    assert.equal((await lida("10045-01")).edicao, 3);
    const eventos = (await db.collection(EVENTS_COLLECTION).where("type", "==", "collaborator.updated").get()).docs.map((doc) => doc.data());
    assert.equal(eventos.length, 1);
    assert.deepEqual(eventos[0].payload.os_com_acesso, ["10045-01", "10045-02", "10045-03"]);
    assert.equal(JSON.stringify(eventos[0]).includes("u-ana"), false);

    await trocar(id, 2, "trocar", "ana.souza@dutelog.com.br");
    agendada = await lida("10045-01");
    assert.deepEqual(agendada.equipe_uids, ["u-valter", "u-ana2"]);
    assert.equal(agendada.equipe[0].usuario_uid, "u-ana2");
    assert.deepEqual((await lida("10045-02")).equipe_uids, ["u-ana2"]);

    await trocar(id, 3, "tirar", null);
    agendada = await lida("10045-01");
    assert.deepEqual(agendada.equipe_uids, ["u-valter"]);
    assert.deepEqual(agendada.equipe, [ana, VALTER]);
    assert.deepEqual((await lida("10045-02")).equipe_uids, []);
    assert.deepEqual((await lida("10045-03")).equipe_uids, []);
    assert.deepEqual((await lida("10045-04")).equipe_uids, []);
  });

  it("mudar outro campo, desativar ou criar não mexe nas OS", async () => {
    await usuario("u-ana", "ana@dutelog.com.br");
    const { id } = await saveCollaboratorFor(db, interno, { ...criar, usuario_email: "ana@dutelog.com.br" });
    const ana = { colaborador_id: id, nome: "Ana Souza", papel: null, vinculo: "proprio", empresa: null, no_app: true, usuario_uid: "u-ana" };
    await os("10045-01", "agendada", [ana], ["u-ana"]);
    await saveCollaboratorFor(db, interno, { action: "update", idempotency_key: "fone", id, expected_edicao: 1, telefone: "(11) 91234-5678" });
    await saveCollaboratorFor(db, interno, { action: "update", idempotency_key: "mesmo", id, expected_edicao: 2, usuario_email: "ana@dutelog.com.br" });
    await saveCollaboratorFor(db, interno, { action: "set_active", idempotency_key: "desativar", id, expected_edicao: 3, ativo: false });
    const agendada = await lida("10045-01");
    assert.equal(agendada.edicao, 2);
    assert.deepEqual(agendada.equipe_uids, ["u-ana"]);
    const eventos = (await db.collection(EVENTS_COLLECTION).where("type", "==", "collaborator.updated").get()).docs.map((doc) => doc.data());
    assert.equal(eventos.some((evento) => "os_com_acesso" in evento.payload), false);
  });
});
