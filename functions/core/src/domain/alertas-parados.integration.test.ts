import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";

import { answerStockAlertFor, runStockAlertsFor } from "./alertas-parados-gravacao.js";
import { AI_STOCK_ALERTS_COLLECTION } from "./alertas-parados.js";
import { AI_CURSORS_COLLECTION, EVENTS_COLLECTION } from "./cursor.js";
import { AI_STOCK_AGE_COLLECTION, idDoItemParado } from "./parados-gravacao.js";
import type { CoreProfile } from "./profile.js";

/**
 * O alerta do item parado no emulador (parte 5.4d). Uma vez por dia, a
 * proposta de cada cliente com portal, com os itens parados pela regra; o
 * cliente sem portal, o pausado e o prospect não recebem. A coordenação
 * aprova com os itens ou descarta, com o evento; a decisão não se refaz, e o
 * item decidido só volta depois de se mexer. Dados sintéticos.
 */

const PROJECT_ID = "demo-dute-core";

const interno: CoreProfile = { uid: "ops-1", role: "interno", name: "Ops" };

let db: Firestore;
let app: ReturnType<typeof initializeApp>;

before(() => {
  app = initializeApp({ projectId: PROJECT_ID }, "core-alertas-test");
  db = getFirestore(app);
});

after(async () => {
  await deleteApp(app);
});

const agora = (iso: string) => () => new Date(iso);
const DIA_1 = "2026-10-20T12:00:00.000Z";
const DIA_2 = "2026-10-21T12:00:00.000Z";
const DIA_3 = "2026-10-22T12:00:00.000Z";

function item(customer: string, sku: string, ultima: string, saldo = 10) {
  return {
    tipo: "item",
    customer_code: customer,
    sku_code: sku,
    client_item_code: `${sku}-CLI`,
    product_name: `Produto ${sku}`,
    saldo,
    relogio: { primeira_entrada: ultima, ultima_entrada: ultima, ultima_saida: null },
    saidas_por_posicao: {},
    calculada_em: DIA_1,
  };
}

beforeEach(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error("FIRESTORE_EMULATOR_HOST não definido.");
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
  const batch = db.batch();
  const set = (path: string, data: Record<string, unknown>) => batch.set(db.doc(path), data);
  set("customers/c_itau", { customer_code: "ITAU", status: "active", portal_status: "active", operation_template: "uniformes", stage: "cliente" });
  set("customers/c_safra", { customer_code: "SAFRA", status: "active", operation_template: "mobiliario" });
  set("customers/c_dutelog", { customer_code: "Dutelog", status: "active", portal_status: "inactive", operation_template: "insumos" });
  set("customers/c_prospect", { customer_code: "NOVO", status: "active", stage: "prospect" });
  const itens = [
    item("ITAU", "SKU-A", "2026-04-03T15:00:00.000Z"),
    item("ITAU", "SKU-B", "2026-07-12T15:00:00.000Z"),
    item("ITAU", "SKU-C", "2026-10-10T15:00:00.000Z"),
    item("ITAU", "SKU-Z", "2026-04-03T15:00:00.000Z", 0),
    item("SAFRA", "SKU-S", "2026-05-01T15:00:00.000Z"),
    item("Dutelog", "SKU-D", "2026-04-03T15:00:00.000Z"),
    item("NOVO", "SKU-N", "2026-04-03T15:00:00.000Z"),
  ];
  for (const dados of itens) set(`${AI_STOCK_AGE_COLLECTION}/${idDoItemParado(dados.customer_code, dados.sku_code)}`, dados);
  await batch.commit();
});

async function alertas(): Promise<Record<string, Record<string, any>>> {
  return Object.fromEntries((await db.collection(AI_STOCK_ALERTS_COLLECTION).get()).docs.map((doc) => [String(doc.get("customer_code")), { ...doc.data(), id: doc.id }]));
}

async function recusa(promessa: Promise<unknown>, codigo: string, mensagem?: string) {
  await assert.rejects(promessa, (error: unknown) => {
    assert.ok(error instanceof HttpsError, String(error));
    assert.equal(error.code, codigo);
    if (mensagem) assert.equal(error.message, mensagem);
    return true;
  });
}

describe("o alerta do item parado", () => {
  it("uma vez por dia, a proposta de cada cliente com portal, com os parados pela regra, os mais parados primeiro", async () => {
    assert.deepEqual(await runStockAlertsFor(db, { agora: agora(DIA_1) }), { dia: "2026-10-20", rodou: true, clientes: 4, propostas: 2, removidas: 0 });
    const propostas = await alertas();
    assert.deepEqual(Object.keys(propostas).sort(), ["ITAU", "SAFRA"]);
    assert.equal(propostas.ITAU?.status, "proposta");
    assert.deepEqual(
      propostas.ITAU?.itens.map((alertado: { sku_code: string; dias_parado: number }) => [alertado.sku_code, alertado.dias_parado]),
      [
        ["SKU-A", 200],
        ["SKU-B", 100],
      ],
    );
    assert.deepEqual(propostas.SAFRA?.regra, { parado_dias: 90, sem_giro_dias: 180 });
    assert.equal((await db.collection(AI_CURSORS_COLLECTION).doc("alertas_parados").get()).get("dia"), "2026-10-20");

    // No mesmo dia, não refaz.
    assert.deepEqual(await runStockAlertsFor(db, { agora: agora("2026-10-20T20:00:00.000Z") }), { dia: "2026-10-20", rodou: false, clientes: 0, propostas: 0, removidas: 0 });
    assert.equal((await db.collection(EVENTS_COLLECTION).get()).size, 0);
  });

  it("a coordenação aprova com os itens escolhidos e o evento; a decisão não se refaz", async () => {
    await runStockAlertsFor(db, { agora: agora(DIA_1) });
    const alerta = (await alertas()).ITAU?.id as string;

    const aprovado = await answerStockAlertFor(db, interno, { alerta_id: alerta, decisao: "aprovar", itens: ["SKU-B"] }, agora(DIA_1));
    assert.deepEqual(aprovado, { alerta_id: alerta, status: "aprovada", itens: 1 });
    const gravado = (await alertas()).ITAU;
    assert.equal(gravado?.status, "aprovada");
    assert.deepEqual(gravado?.itens_enviados.map((enviado: { sku_code: string }) => enviado.sku_code), ["SKU-B"]);
    assert.deepEqual(gravado?.decidida_por, { uid: "ops-1", role: "interno", name: "Ops" });

    const eventos = (await db.collection(EVENTS_COLLECTION).get()).docs.map((doc) => doc.data());
    assert.equal(eventos.length, 1);
    assert.deepEqual([eventos[0]?.type, eventos[0]?.source, eventos[0]?.customer_code, eventos[0]?.payload], ["estoque_parado.aprovado", "functions_core", "ITAU", { id: alerta, itens: 1 }]);

    assert.deepEqual(await answerStockAlertFor(db, interno, { alerta_id: alerta, decisao: "aprovar", itens: ["SKU-B"] }, agora(DIA_1)), { alerta_id: alerta, status: "aprovada", itens: 1, replayed: true });
    await recusa(answerStockAlertFor(db, interno, { alerta_id: alerta, decisao: "aprovar", itens: ["SKU-A", "SKU-B"] }, agora(DIA_1)), "failed-precondition", "O alerta já foi decidido.");
    await recusa(answerStockAlertFor(db, interno, { alerta_id: alerta, decisao: "descartar" }, agora(DIA_1)), "failed-precondition");
    assert.equal((await db.collection(EVENTS_COLLECTION).get()).size, 1);
  });

  it("o item decidido não volta; o que se mexeu e parou de novo volta; o cliente que pausou perde a proposta aberta", async () => {
    await runStockAlertsFor(db, { agora: agora(DIA_1) });
    const propostas = await alertas();
    await answerStockAlertFor(db, interno, { alerta_id: propostas.ITAU?.id, decisao: "aprovar", itens: ["SKU-A"] }, agora(DIA_1));
    await answerStockAlertFor(db, interno, { alerta_id: propostas.SAFRA?.id, decisao: "descartar" }, agora(DIA_1));
    const descartado = (await db.collection(EVENTS_COLLECTION).where("type", "==", "estoque_parado.descartado").get()).docs[0]?.data();
    assert.deepEqual(descartado?.payload, { id: propostas.SAFRA?.id, itens: 1 });

    // No dia seguinte, os itens das duas decisões, o enviado e o que ficou de fora, não voltam.
    assert.deepEqual(await runStockAlertsFor(db, { agora: agora(DIA_2) }), { dia: "2026-10-21", rodou: true, clientes: 4, propostas: 0, removidas: 0 });

    // O SKU-A se mexeu em julho e passou do limite de novo: volta numa proposta nova.
    await db.doc(`${AI_STOCK_AGE_COLLECTION}/${idDoItemParado("ITAU", "SKU-A")}`).update({ "relogio.ultima_saida": "2026-07-20T15:00:00.000Z" });
    assert.deepEqual((await runStockAlertsFor(db, { agora: agora(DIA_3) })).propostas, 1);
    const nova = (await db.collection(AI_STOCK_ALERTS_COLLECTION).where("status", "==", "proposta").get()).docs.map((doc) => doc.data());
    assert.deepEqual(nova.map((alerta) => [alerta.customer_code, alerta.itens.map((alertado: { sku_code: string }) => alertado.sku_code)]), [["ITAU", ["SKU-A"]]]);

    await db.doc("customers/c_itau").update({ status: "paused" });
    assert.deepEqual((await runStockAlertsFor(db, { agora: agora("2026-10-23T12:00:00.000Z") })).removidas, 1);
    assert.equal((await db.collection(AI_STOCK_ALERTS_COLLECTION).where("status", "==", "proposta").get()).size, 0);
  });

  it("só a coordenação decide; o alerta que não existe e o item fora dele recusam", async () => {
    await runStockAlertsFor(db, { agora: agora(DIA_1) });
    const alerta = (await alertas()).ITAU?.id as string;
    for (const role of ["wms", "comercial", "cliente"] as const) {
      await recusa(answerStockAlertFor(db, { uid: `u-${role}`, role }, { alerta_id: alerta, decisao: "aprovar", itens: ["SKU-A"] }), "permission-denied", "Seu perfil não decide o alerta ao cliente.");
    }
    await recusa(answerStockAlertFor(db, interno, { alerta_id: "alerta_000000000000000000000000", decisao: "descartar" }), "not-found", "O alerta não existe.");
    await recusa(answerStockAlertFor(db, interno, { alerta_id: alerta, decisao: "aprovar", itens: ["SKU-C"] }), "invalid-argument", "O item SKU-C não está no alerta.");
    assert.equal((await alertas()).ITAU?.status, "proposta");
  });
});
