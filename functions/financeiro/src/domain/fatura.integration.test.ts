import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";

import { EVENTS_COLLECTION, FINANCEIRO_EVENT_SOURCE } from "./events.js";
import { registerNfFor } from "./fatura-gravacao.js";
import { FATURAS_COLLECTION, faturaIdDaNf } from "./fatura.js";
import type { FinanceiroProfile } from "./profile.js";

/**
 * Registrar a NF no emulador (parte 4.1a): a demanda A faturar com a
 * autorização registrada fatura pelo total da RV validada; a da medição
 * aprovada, pela soma das linhas dela; a fatura nasce emitida, as demandas
 * ficam Faturadas com o marco, as autorizações ganham a NF e o evento sai sem
 * valor; repetir não duplica. Sem autorização, fora de A faturar, de clientes
 * diferentes ou com a NF já registrada, nada se grava. Dados sintéticos.
 */

const PROJECT_ID = "demo-dute-financeiro";
const AGORA = () => new Date("2026-10-23T15:00:00.000Z");
const financeiro: FinanceiroProfile = { uid: "fin-1", role: "financeiro", name: "Carla" };

let db: Firestore;
let app: ReturnType<typeof initializeApp>;

before(() => {
  app = initializeApp({ projectId: PROJECT_ID }, "financeiro-fatura-test");
  db = getFirestore(app);
});

after(async () => {
  await deleteApp(app);
});

const demanda = (numero: string, extra: Record<string, unknown> = {}) => ({
  numero,
  customer_code: "ITAU",
  customer_name: "Itaú Unibanco",
  entrada: "comercial",
  cobranca: "por_demanda",
  etapa: "a_faturar",
  etapa_desde: "2026-10-20T12:00:00.000Z",
  marcos: [{ etapa: "a_faturar", em: "2026-10-20T12:00:00.000Z", por_uid: "com-1" }],
  validacao: { rv: 1, etapa: "aguardando_autorizacao", autorizacao: "pedido_aceite", em: "2026-10-19T12:00:00.000Z", por_uid: "com-1" },
  autorizacao_ids: ["aut_itau"],
  ...extra,
});

beforeEach(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error("FIRESTORE_EMULATOR_HOST não definido.");
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
  const batch = db.batch();
  const set = (path: string, data: Record<string, unknown>) => batch.set(db.doc(path), data);
  set("demands/10045", demanda("10045"));
  set("demands/10046", demanda("10046", { validacao: { rv: 0, etapa: "aguardando_autorizacao", autorizacao: "pedido_aceite" } }));
  set("quotes/10045/revisoes/1", { total_cents: 1_234_500, linhas: [{ id: "ln_1", preco: "88.50" }] });
  set("quotes/10046/revisoes/0", { total_cents: 250_000 });
  set("client_authorizations/aut_itau", {
    id: "aut_itau",
    customer_code: "ITAU",
    tipo: "pedido_aceite",
    status: "registrada",
    pedido: "4500000009",
    aceite: "ACE-1",
    valor_cents: 1_484_500,
    demandas: [
      { numero: "10045", rv: 1, rotulo: "RV 1", valor_cents: 1_234_500 },
      { numero: "10046", rv: 0, rotulo: "RV 0", valor_cents: 250_000 },
    ],
    demanda_numeros: ["10045", "10046"],
    nf_ids: [],
  });
  // A medição mensal do Safra: a demanda vem da medição aprovada, sem RV.
  set("demands/10050", demanda("10050", {
    customer_code: "SAFRA",
    customer_name: "Banco Safra",
    cobranca: "medicao_mensal",
    validacao: { etapa: "a_faturar", autorizacao: "medicao_aprovada", medicao_id: "ctr_safra_2026-10" },
    autorizacao_ids: ["aut_ctr_safra_2026-10"],
  }));
  set("medicoes/ctr_safra_2026-10", {
    status: "aprovada",
    linhas: [
      { id: "l1", demanda_numero: "10050", total_cents: 30_000 },
      { id: "l2", demanda_numero: "10051", total_cents: 99_000 },
      { id: "l3", demanda_numero: "10050", total_cents: 12_500 },
    ],
  });
  set("client_authorizations/aut_ctr_safra_2026-10", { id: "aut_ctr_safra_2026-10", customer_code: "SAFRA", tipo: "medicao_aprovada", status: "registrada", demandas: [], demanda_numeros: ["10050"], nf_ids: [] });
  await batch.commit();
});

const pedido = (extra: Record<string, unknown> = {}) => ({
  idempotency_key: "nf-1",
  demandas: ["10045", "10046"],
  nf: { numero: "1234", emitida_em: "2026-10-23" },
  vencimento: "2026-11-20",
  forma: "boleto",
  ...extra,
});

async function recusa(promessa: Promise<unknown>, codigo: string, mensagem: string) {
  await assert.rejects(promessa, (error: unknown) => {
    assert.ok(error instanceof HttpsError, String(error));
    assert.equal(error.code, codigo);
    assert.equal(error.message, mensagem);
    return true;
  });
}

async function nadaGravado() {
  assert.equal((await db.collection(FATURAS_COLLECTION).get()).size, 0);
  assert.equal((await db.collection(EVENTS_COLLECTION).get()).size, 0);
  assert.equal((await db.doc("demands/10045").get()).get("etapa"), "a_faturar");
}

describe("registrar a NF", () => {
  it("fatura as demandas pela RV validada e autorizada; Faturadas, autorização com a NF e o evento sem valor; repetir não duplica", async () => {
    const resultado = await registerNfFor(db, financeiro, pedido(), AGORA);
    const id = faturaIdDaNf("1", "1234");
    assert.deepEqual(resultado, { id, valor_cents: 1_484_500, demandas: ["10045", "10046"] });

    const fatura = (await db.collection(FATURAS_COLLECTION).doc(id).get()).data() ?? {};
    assert.equal(fatura.status, "emitida");
    assert.equal(fatura.valor_cents, 1_484_500);
    assert.deepEqual(fatura.demandas.map((item: Record<string, unknown>) => [item.numero, item.rv, item.valor_cents]), [["10045", 1, 1_234_500], ["10046", 0, 250_000]]);
    assert.deepEqual([fatura.nf, fatura.nf_chave, fatura.vencimento, fatura.forma, fatura.customer_code], [{ numero: "1234", serie: "1", emitida_em: "2026-10-23" }, "1:1234", "2026-11-20", "boleto", "ITAU"]);
    assert.deepEqual(fatura.autorizacao_ids, ["aut_itau"]);

    const faturada = (await db.doc("demands/10045").get()).data() ?? {};
    assert.equal(faturada.etapa, "faturada");
    assert.deepEqual(faturada.marcos.at(-1), { etapa: "faturada", em: "2026-10-23T15:00:00.000Z", por_uid: "fin-1" });
    assert.deepEqual(faturada.faturamento, { fatura_id: id, nf: { numero: "1234", serie: "1", emitida_em: "2026-10-23" }, vencimento: "2026-11-20", registrada_em: "2026-10-23T15:00:00.000Z" });
    assert.doesNotMatch(JSON.stringify(faturada.faturamento), /cents|valor/);
    assert.deepEqual((await db.doc("client_authorizations/aut_itau").get()).get("nf_ids"), [id]);

    const eventos = (await db.collection(EVENTS_COLLECTION).get()).docs.map((doc) => doc.data());
    assert.equal(eventos.length, 1);
    assert.deepEqual([eventos[0].type, eventos[0].source, eventos[0].entity_type, eventos[0].customer_code], ["nf.registered", FINANCEIRO_EVENT_SOURCE, "fatura", "ITAU"]);
    assert.deepEqual(eventos[0].payload, { id, demandas: ["10045", "10046"], autorizacoes: 1, emitida_em: "2026-10-23", vencimento: "2026-11-20", forma: "boleto" });
    // Sem o carimbo do servidor: os nanossegundos dele podem conter qualquer sequência de dígitos.
    const { created_at: _carimbo, ...semCarimbo } = eventos[0];
    assert.doesNotMatch(JSON.stringify(semCarimbo), /1234500|4500000009|1234"/);

    assert.equal((await registerNfFor(db, financeiro, pedido(), AGORA)).replayed, true);
    assert.equal((await db.collection(EVENTS_COLLECTION).get()).size, 1);
    // A mesma NF com outra chave não se registra de novo.
    await recusa(registerNfFor(db, financeiro, pedido({ idempotency_key: "nf-2", demandas: ["10050"] }), AGORA), "failed-precondition", "A NF 1234 da série 1 já está registrada.");
  });

  it("a demanda da medição aprovada fatura pela soma das linhas dela", async () => {
    const resultado = await registerNfFor(db, financeiro, pedido({ demandas: ["10050"], nf: { numero: "77", serie: "2", emitida_em: "2026-10-23" } }), AGORA);
    assert.equal(resultado.valor_cents, 42_500);
    const fatura = (await db.collection(FATURAS_COLLECTION).doc(resultado.id).get()).data() ?? {};
    assert.deepEqual(fatura.demandas, [{ numero: "10050", rv: null, medicao_id: "ctr_safra_2026-10", autorizacao_ids: ["aut_ctr_safra_2026-10"], valor_cents: 42_500 }]);
  });

  it("sem autorização registrada, fora de A faturar, de clientes diferentes ou com emissão no futuro, nada se grava", async () => {
    await db.doc("client_authorizations/aut_itau").update({ status: "cancelada" });
    await recusa(registerNfFor(db, financeiro, pedido(), AGORA), "failed-precondition", "A demanda 10045 não tem autorização de faturamento registrada.");
    await db.doc("client_authorizations/aut_itau").update({ status: "registrada" });
    await db.doc("demands/10046").update({ etapa: "aguardando_autorizacao" });
    await recusa(registerNfFor(db, financeiro, pedido({ idempotency_key: "nf-3" }), AGORA), "failed-precondition", "A demanda 10046 não está A faturar.");
    await recusa(
      registerNfFor(db, financeiro, pedido({ idempotency_key: "nf-4", demandas: ["10045", "10050"] }), AGORA),
      "invalid-argument",
      "As demandas são de clientes diferentes: uma NF é de um cliente só.",
    );
    await recusa(
      registerNfFor(db, financeiro, pedido({ idempotency_key: "nf-5", demandas: ["10045"], nf: { numero: "9", emitida_em: "2026-10-24" }, vencimento: "2026-11-24" }), AGORA),
      "invalid-argument",
      "A data de emissão da NF ainda não chegou.",
    );
    await recusa(registerNfFor(db, financeiro, pedido({ idempotency_key: "nf-6", demandas: ["10099"] }), AGORA), "not-found", "Demanda 10099 não encontrada.");
    await nadaGravado();
  });

  it("a operação, o comercial, o campo e o cliente não registram", async () => {
    for (const role of ["interno", "comercial", "campo", "suporte", "cliente"] as const) {
      await recusa(registerNfFor(db, { uid: `${role}-1`, role }, pedido(), AGORA), "permission-denied", "Seu perfil não grava no Financeiro.");
    }
    await nadaGravado();
  });
});
