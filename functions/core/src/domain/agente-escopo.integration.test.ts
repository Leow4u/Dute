import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { HttpsError, type CallableRequest } from "firebase-functions/https";

import { escopoDoAgente } from "./agente-escopo.js";
import { leitorDoAgente } from "./agente-leitor.js";
import { requireDuteCaller, type CoreProfile } from "./profile.js";

/**
 * O escopo e o leitor do Agent Dute no emulador (parte 5.5b). O cliente fala
 * do próprio cadastro; a equipe, do cliente ativo, conferido no cadastro; o
 * módulo do shell precisa ser da pessoa. O leitor de um cliente nunca devolve
 * o dado de outro. Dados sintéticos.
 */

const PROJECT_ID = "demo-dute-core";

let db: Firestore;
let app: ReturnType<typeof initializeApp>;

before(() => {
  app = initializeApp({ projectId: PROJECT_ID }, "core-agente-escopo-test");
  db = getFirestore(app);
});

after(async () => {
  await deleteApp(app);
});

beforeEach(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error("FIRESTORE_EMULATOR_HOST não definido.");
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
  const batch = db.batch();
  batch.set(db.collection("customers").doc("cus_itau"), { customer_code: "ITAU", name: "Itaú", stage: "cliente", operation_template: "uniformes" });
  batch.set(db.collection("customers").doc("cus_safra"), { customer_code: "SAFRA", name: "Safra" });
  batch.set(db.collection("customers").doc("cus_velho"), { customer_code: "VELHO", archived: true });
  batch.set(db.collection("customers").doc("cus_novo"), { customer_code: "NOVO", stage: "prospect" });
  batch.set(db.collection("client_access").doc("ITAU"), { customer_code: "ITAU", modules: ["wms", "operacao", "financeiro"] });
  // A Safra não tem a lista: vale o padrão, armazenagem e faturas.
  batch.set(db.collection("client_inventory").doc("itau_1"), { customer_code: "ITAU", sku_code: "ITAU-000001", saldo: 30 });
  batch.set(db.collection("client_inventory").doc("safra_1"), { customer_code: "SAFRA", sku_code: "SAFRA-000001", saldo: 9 });
  batch.set(db.collection("ai_measures").doc("m_geral"), { escopo: "geral", customer_code: null, tipo: "duracao_item" });
  batch.set(db.collection("ai_measures").doc("m_itau"), { escopo: "cliente", customer_code: "ITAU", tipo: "duracao_item" });
  batch.set(db.collection("users").doc("cli-itau"), { role: "cliente", customer_code: "ITAU", nome: "Renata" });
  batch.set(db.collection("users").doc("campo-1"), { role: "campo" });
  batch.set(db.collection("users").doc("ops-1"), { role: "interno", nome: "Ops" });
  await batch.commit();
});

const negado = (padrao: RegExp, codigo = "permission-denied") => (erro: unknown) => erro instanceof HttpsError && erro.code === codigo && padrao.test(erro.message);

const cliente: CoreProfile = { uid: "cli-itau", role: "cliente", customerCode: "ITAU", name: "Renata" };
const interno: CoreProfile = { uid: "ops-1", role: "interno", name: "Ops" };

describe("o escopo da conversa", () => {
  it("o cliente fala do próprio cadastro, nos módulos que contratou", async () => {
    assert.deepEqual(await escopoDoAgente(db, cliente, { modulo: "operacao" }), {
      uid: "cli-itau",
      role: "cliente",
      nome: "Renata",
      audiencia: "cliente",
      customerCode: "ITAU",
      modulo: "operacao",
      modulos: ["wms", "operacao", "financeiro"],
      leValor: true,
      modeloDeOperacao: "uniformes",
    });
    await assert.rejects(escopoDoAgente(db, cliente, { modulo: "wms", customer_code: "SAFRA" }), negado(/só do próprio cadastro/));
    await assert.rejects(escopoDoAgente(db, cliente, { modulo: "comercial" }), negado(/não atende esse módulo/));
    await assert.rejects(escopoDoAgente(db, { ...cliente, customerCode: undefined }, { modulo: "wms" }), negado(/sem cliente/));
  });

  it("a equipe fala do cliente ativo, que precisa estar no cadastro, ativo e não prospect", async () => {
    const escopo = await escopoDoAgente(db, interno, { modulo: "wms", customer_code: "SAFRA" });
    assert.deepEqual([escopo.audiencia, escopo.customerCode, escopo.modulos, escopo.leValor, escopo.modeloDeOperacao], ["equipe", "SAFRA", ["wms"], false, null]);
    await assert.rejects(escopoDoAgente(db, interno, { modulo: "wms" }), negado(/Escolha o cliente/, "invalid-argument"));
    await assert.rejects(escopoDoAgente(db, interno, { modulo: "wms", customer_code: "NADA" }), negado(/não está no cadastro/, "not-found"));
    await assert.rejects(escopoDoAgente(db, interno, { modulo: "wms", customer_code: "VELHO" }), negado(/arquivado/, "failed-precondition"));
    await assert.rejects(escopoDoAgente(db, interno, { modulo: "wms", customer_code: "NOVO" }), negado(/prospect/, "failed-precondition"));
  });

  it("o módulo do shell precisa ser da pessoa naquele cliente", async () => {
    // A Safra não contratou a Operação: o interno não fala dela por lá.
    await assert.rejects(escopoDoAgente(db, interno, { modulo: "operacao", customer_code: "SAFRA" }), negado(/não atende esse módulo/));
    const comercial = await escopoDoAgente(db, { uid: "com-1", role: "comercial" }, { modulo: "comercial", customer_code: "SAFRA" });
    assert.deepEqual([comercial.modulos, comercial.leValor], [["comercial"], true]);
    await assert.rejects(escopoDoAgente(db, { uid: "fin-1", role: "financeiro" }, { modulo: "financeiro", customer_code: "NOVO" }), negado(/prospect/, "failed-precondition"));
    await assert.rejects(escopoDoAgente(db, { uid: "wms-1", role: "wms" }, { modulo: "comercial", customer_code: "ITAU" }), negado(/não atende esse módulo/));
  });
});

describe("a entrada das callables do agente", () => {
  const pedido = (uid: string) => ({ auth: { uid, token: {} }, data: {} }) as unknown as CallableRequest<unknown>;

  it("a liberação própria antes de tudo, depois o login e o papel", async () => {
    await assert.rejects(requireDuteCaller(db, pedido("ops-1"), "dute-prod"), negado(/não está liberado/, "failed-precondition"));
    await assert.rejects(requireDuteCaller(db, { data: {} } as CallableRequest<unknown>, "dute-homolog"), negado(/Faça login/, "unauthenticated"));
    await assert.rejects(requireDuteCaller(db, pedido("campo-1"), "dute-homolog"), negado(/não usa o Agent Dute/));
    assert.deepEqual(await requireDuteCaller(db, pedido("cli-itau"), "dute-homolog"), { uid: "cli-itau", role: "cliente", name: "Renata", customerCode: "ITAU" });
    assert.deepEqual(await requireDuteCaller(db, pedido("ops-1"), "dute-homolog"), { uid: "ops-1", role: "interno", name: "Ops" });
  });
});

describe("o leitor no banco", () => {
  it("o de um cliente nunca devolve o dado de outro", async () => {
    const daItau = leitorDoAgente(db, { customerCode: "ITAU", audiencia: "cliente" });
    assert.deepEqual(
      (await daItau.doCliente("client_inventory", { limite: 50 })).map((item) => item.id),
      ["itau_1"],
    );
    assert.equal(await daItau.documento("client_inventory", "safra_1"), null);
    assert.equal((await daItau.documento("client_inventory", "itau_1"))?.sku_code, "ITAU-000001");
  });

  it("o geral é só a medida geral, nunca a de um cliente", async () => {
    const daEquipe = leitorDoAgente(db, { customerCode: "SAFRA", audiencia: "equipe" });
    assert.deepEqual((await daEquipe.geral("ai_measures", { limite: 50 })).map((medida) => medida.id), ["m_geral"]);
  });
});
