import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";

import { openDirectDemandFor } from "./demanda-direta-gravacao.js";
import { EVENTS_COLLECTION } from "./events.js";
import { saveServiceOrderFor } from "./os-gravacao.js";
import type { OperacaoProfile } from "./profile.js";

/** Parte 3.4d: a demanda direta nasce no `demands` do Comercial, sem orçamento, e vira OS. */

const PROJECT_ID = "demo-dute-operacao";
const AGORA = () => new Date("2026-10-20T16:06:00.000Z");

let db: Firestore;
let app: ReturnType<typeof initializeApp>;

const interno: OperacaoProfile = { uid: "interno-1", role: "interno", name: "Paula" };
const campo: OperacaoProfile = { uid: "campo-1", role: "campo", name: "Carlos" };

const PEDIDO = {
  idempotency_key: "direta-1",
  customer_code: "ITAU",
  titulo: "Troca de cadeiras do 5º andar",
  canal: "telefone",
  pedido_por: { nome: "Renata Campos", telefone: "11987654321" },
  recebida_em: "2026-10-20T13:05-03:00",
  executar_ate: "2026-10-20T19:00-03:00",
  origem: { local_id: "loc_faria", complemento: "5º andar" },
  itens: [
    { lpu_item_id: "lpu_cadeira", quantidade: "40" },
    { item: "Retirada de entulho", unidade: "VB", quantidade: "1" },
  ],
};

before(() => {
  app = initializeApp({ projectId: PROJECT_ID }, "operacao-direta-test");
  db = getFirestore(app);
});

beforeEach(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error("FIRESTORE_EMULATOR_HOST não definido.");
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
  await db.doc("customers/ITAU").set({ code: "ITAU", customer_code: "ITAU", name: "Itaú Unibanco", status: "active" });
  await db.doc("customers/VELHO").set({ code: "VELHO", customer_code: "VELHO", name: "Cliente Antigo", status: "archived", archived: true });
  await db.doc("customer_locations/loc_faria").set({ customer_code: "ITAU", nome: "Faria Lima", endereco: { logradouro: "Av. Brig. Faria Lima", numero: "3500" } });
  await db.doc("customer_locations/loc_safra").set({ customer_code: "SAFRA", nome: "Paulista" });
  await db.doc("lpu_items/lpu_cadeira").set({ item: "Cadeira Flexform", descricao: "Transporte de cadeira Flexform", servico: "Transporte", unidade: "UN", ativo: true, orcavel: true });
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

describe("abrir a demanda direta", () => {
  it("nasce com o número do contador do Comercial, em Para planejar, sem orçamento, e repetir devolve a mesma", async () => {
    await db.doc("demand_counters/geral").set({ ultimo: 10052 });
    const aberta = await openDirectDemandFor(db, interno, PEDIDO, AGORA);
    assert.deepEqual(aberta, { numero: "10053", tipo: "paraquedas", linhas: 2 });
    const deNovo = await openDirectDemandFor(db, interno, PEDIDO, AGORA);
    assert.equal(deNovo.numero, "10053");
    assert.equal(deNovo.replayed, true);

    assert.equal((await db.doc("demand_counters/geral").get()).data()?.ultimo, 10053);
    assert.equal((await db.doc("quotes/10053").get()).exists, false);
    const demanda = (await db.doc("demands/10053").get()).data() ?? {};
    assert.equal(demanda.entrada, "direta");
    assert.equal(demanda.etapa, "para_planejar");
    assert.equal(demanda.tipo, "paraquedas");
    assert.equal(demanda.customer_name, "Itaú Unibanco");
    assert.equal(demanda.escopo_rv, null);
    assert.equal(demanda.executar_ate, "2026-10-20T22:00:00.000Z");
    assert.deepEqual(demanda.pedido_por, { nome: "Renata Campos", telefone: "11987654321" });
    assert.deepEqual(demanda.itens_pedidos.map((item: { item: string; quantidade: string }) => [item.item, item.quantidade]), [
      ["Cadeira Flexform", "40"],
      ["Retirada de entulho", "1"],
    ]);
    assert.equal(demanda.created_by, "interno-1");

    const eventos = (await db.collection(EVENTS_COLLECTION).get()).docs.map((doc) => doc.data());
    assert.equal(eventos.length, 1);
    assert.equal(eventos[0].type, "demand.direct_opened");
    assert.equal(eventos[0].entity_type, "demand");
    assert.equal(eventos[0].customer_code, "ITAU");
    assert.deepEqual(eventos[0].payload, { id: "10053", tipo: "paraquedas", tipo_calculado: "paraquedas", linhas: 2 });
    for (const proibido of ["Renata", "987654321", "Cadeira", "Faria", "Troca"]) assert.equal(JSON.stringify(eventos[0]).includes(proibido), false, proibido);
  });

  it("sem contador começa em 10001; o tipo corrigido fica com quem corrigiu", async () => {
    const aberta = await openDirectDemandFor(db, interno, { ...PEDIDO, idempotency_key: "d2", tipo: "emergencial" }, AGORA);
    assert.equal(aberta.numero, "10001");
    const demanda = (await db.doc("demands/10001").get()).data() ?? {};
    assert.equal(demanda.tipo, "emergencial");
    assert.equal(demanda.tipo_calculado, "paraquedas");
    assert.equal(demanda.tipo_corrigido_por, "interno-1");
  });

  it("número ocupado, local de outro cliente, cadastro arquivado, item de fora do catálogo e o papel campo são recusados sem gravar", async () => {
    await db.doc("demand_counters/geral").set({ ultimo: 10052 });
    await db.doc("demands/10053").set({ numero: "10053" });
    const ocupado = await rejection(openDirectDemandFor(db, interno, PEDIDO, AGORA));
    assert.match(ocupado.message, /já existe/);
    await db.doc("demands/10053").delete();
    const local = await rejection(openDirectDemandFor(db, interno, { ...PEDIDO, idempotency_key: "l", origem: { local_id: "loc_safra" } }, AGORA));
    assert.match(local.message, /outro cliente/);
    const arquivado = await rejection(openDirectDemandFor(db, interno, { ...PEDIDO, idempotency_key: "a", customer_code: "VELHO", origem: null }, AGORA));
    assert.match(arquivado.message, /arquivado/);
    const item = await rejection(openDirectDemandFor(db, interno, { ...PEDIDO, idempotency_key: "i", itens: [{ lpu_item_id: "lpu_sumiu", quantidade: "1" }] }, AGORA));
    assert.match(item.message, /catálogo/);
    const negado = await rejection(openDirectDemandFor(db, campo, PEDIDO, AGORA));
    assert.equal(negado.code, "permission-denied");
    const futuro = await rejection(openDirectDemandFor(db, interno, { ...PEDIDO, idempotency_key: "f", recebida_em: "2026-10-20T15:00-03:00" }, AGORA));
    assert.match(futuro.message, /depois de agora/);
    assert.equal((await db.collection("demands").get()).size, 0);
    assert.equal((await db.doc("demand_counters/geral").get()).data()?.ultimo, 10052);
    assert.equal((await db.collection(EVENTS_COLLECTION).get()).size, 0);
  });
});

describe("OS da demanda direta", () => {
  it("abre com os itens pedidos, sem RV, divide em fatias e, executada, não abre outra", async () => {
    const { numero } = await openDirectDemandFor(db, interno, PEDIDO, AGORA);
    const demanda = (await db.doc(`demands/${numero}`).get()).data() ?? {};
    const [cadeira, entulho] = demanda.itens_pedidos as Array<{ id: string }>;

    const plano = await saveServiceOrderFor(db, interno, {
      action: "plan",
      idempotency_key: "plano",
      demanda: numero,
      ordens: [{ itens: [{ id: cadeira.id, planejado: "25" }, { id: entulho.id, planejado: "1" }] }, { itens: [{ id: cadeira.id, planejado: "15" }] }],
    });
    assert.deepEqual(plano.numeros, ["10001-01", "10001-02"]);
    const os = (await db.doc("service_orders/10001-01").get()).data() ?? {};
    assert.equal(os.escopo_rv, null);
    assert.deepEqual(os.servicos, ["transporte"]);
    assert.equal(os.locais.origem.nome, "Faria Lima");
    const demais = await rejection(saveServiceOrderFor(db, interno, { action: "create", idempotency_key: "resto", demanda: numero }));
    assert.equal(demais.message, "Todo o saldo da demanda já está em OS.");

    await db.doc(`demands/${numero}`).update({ executado_de: "2026-10-20" });
    await saveServiceOrderFor(db, interno, { action: "cancel", idempotency_key: "c", numero: "10001-02", expected_edicao: 1, motivo: "Ficou para amanhã" });
    const executada = await rejection(saveServiceOrderFor(db, interno, { action: "create", idempotency_key: "depois", demanda: numero }));
    assert.match(executada.message, /Para planejar/);
  });
});
