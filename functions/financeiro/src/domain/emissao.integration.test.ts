import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";

import { BILLING_PERIODS_COLLECTION } from "./armazenagem.js";
import { actOnNfEmissionFor, emitNfOmieFor, listNfEmissionsFor } from "./emissao-gravacao.js";
import { EMISSOES_COLLECTION } from "./emissao-omie.js";
import { EVENTS_COLLECTION } from "./events.js";
import { registerNfFor } from "./fatura-gravacao.js";
import type { FinanceiroProfile } from "./profile.js";

/**
 * A emissão da NFS-e pela Omie no emulador (parte 7.4c): confere como o
 * registerNf, reserva as demandas e a competência, e repetir não duplica;
 * desistir solta as reservas na hora quando a OS ainda não existe; retomar
 * volta a parada à fila; fora da liberação, recusa. Nenhuma chamada à Omie:
 * quem chama é a rotina (parte 7.4d). Dados sintéticos.
 */

const PROJECT_ID = "demo-dute-financeiro";
const LIBERADO = "dute-homolog";
const AGORA = () => new Date("2026-10-23T15:00:00.000Z");
const financeiro: FinanceiroProfile = { uid: "fin-1", role: "financeiro", name: "Carla" };
const ID = "nfe_0123456789abcdef0123";

let db: Firestore;
let app: ReturnType<typeof initializeApp>;

before(() => {
  app = initializeApp({ projectId: PROJECT_ID }, "financeiro-emissao-test");
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
  validacao: { rv: 1, etapa: "aguardando_autorizacao", autorizacao: "pedido_aceite" },
  autorizacao_ids: ["aut_itau"],
  ...extra,
});

beforeEach(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error("FIRESTORE_EMULATOR_HOST não definido.");
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
  const batch = db.batch();
  const set = (path: string, data: Record<string, unknown>) => batch.set(db.doc(path), data);
  set("customers/itau", { customer_code: "ITAU", name: "Itaú", legal_name: "Itaú Unibanco S.A.", document: "60.701.190/0001-04" });
  set("customers/safra", { customer_code: "SAFRA", name: "Safra", document: null });
  set("demands/10045", demanda("10045"));
  set("demands/10046", demanda("10046", { validacao: { rv: 0, etapa: "aguardando_autorizacao", autorizacao: "pedido_aceite" } }));
  set("quotes/10045/revisoes/1", { total_cents: 1_234_500 });
  set("quotes/10046/revisoes/0", { total_cents: 250_000 });
  set("client_authorizations/aut_itau", {
    id: "aut_itau",
    customer_code: "ITAU",
    tipo: "pedido_aceite",
    status: "registrada",
    demandas: [
      { numero: "10045", rv: 1, valor_cents: 1_234_500 },
      { numero: "10046", rv: 0, valor_cents: 250_000 },
    ],
    demanda_numeros: ["10045", "10046"],
    nf_ids: [],
  });
  set("demands/10050", demanda("10050", { customer_code: "SAFRA", customer_name: "Banco Safra", validacao: { rv: 0, autorizacao: "nenhuma" }, autorizacao_ids: [] }));
  set("quotes/10050/revisoes/0", { total_cents: 10_000 });
  set(`${BILLING_PERIODS_COLLECTION}/ITAU__2026-09`, {
    customer_code: "ITAU",
    competencia: "2026-09",
    status: "emitido",
    invoice_snapshot: { competencia: "2026-09", status: "emitido", total_cents: 7_508 },
  });
  await batch.commit();
});

async function recusa(promessa: Promise<unknown>, codigo: string, mensagem: RegExp) {
  await assert.rejects(promessa, (error: unknown) => {
    assert.ok(error instanceof HttpsError, String(error));
    assert.equal(error.code, codigo);
    assert.match(error.message, mensagem);
    return true;
  });
}

const pedido = (extra: Record<string, unknown> = {}) => ({
  idempotency_key: "em-1",
  demandas: ["10045", "10046"],
  armazenagem: ["ITAU__2026-09"],
  vencimento: "2026-11-20",
  forma: "boleto",
  ...extra,
});

const emitir = (extra: Record<string, unknown> = {}) => emitNfOmieFor(db, financeiro, pedido(extra), { projectId: LIBERADO, agora: AGORA, novoId: () => ID });

async function reserva(caminho: string) {
  return ((await db.doc(caminho).get()).data() ?? {}).emissao_nf as Record<string, unknown> | undefined;
}

async function eventos() {
  const snapshot = await db.collection(EVENTS_COLLECTION).get();
  return snapshot.docs.map((doc) => doc.data()).sort((a, b) => String(a.occurred_at).localeCompare(String(b.occurred_at)) || String(a.type).localeCompare(String(b.type)));
}

describe("pedir a NFS-e à Omie", () => {
  it("põe na fila com os valores do servidor, reserva as demandas e a competência, e o evento não leva valor; repetir não duplica", async () => {
    const resultado = await emitir();
    assert.deepEqual(resultado, { id: ID, etapa: "na_fila" });
    const gravada = (await db.doc(`${EMISSOES_COLLECTION}/${ID}`).get()).data() ?? {};
    assert.deepEqual(
      [gravada.customer_code, gravada.cnpj, gravada.etapa, gravada.total_cents, gravada.proxima_em, gravada.edicao],
      ["ITAU", "60701190000104", "na_fila", 1_234_500 + 250_000 + 7_508, "2026-10-23T15:00:00.000Z", 1],
    );
    assert.deepEqual(
      (gravada.itens as Array<Record<string, unknown>>).map((item) => [item.origem, item.referencia, item.descricao, item.valor_cents]),
      [
        ["demanda", "10045", "Demanda 10045", 1_234_500],
        ["demanda", "10046", "Demanda 10046", 250_000],
        ["armazenagem", "ITAU__2026-09", "Armazenagem de 09/2026", 7_508],
      ],
    );
    for (const caminho of ["demands/10045", "demands/10046", `${BILLING_PERIODS_COLLECTION}/ITAU__2026-09`]) {
      assert.deepEqual(await reserva(caminho), { id: ID, desde: "2026-10-23T15:00:00.000Z" }, caminho);
    }
    assert.equal((await db.doc("demands/10045").get()).get("etapa"), "a_faturar");
    const [evento] = await eventos();
    assert.deepEqual([evento.type, evento.entity_type, evento.entity_id, evento.customer_code], ["nf.emission_requested", "nf_emissao", ID, "ITAU"]);
    assert.deepEqual(evento.payload, { id: ID, demandas: ["10045", "10046"], competencias: ["2026-09"], vencimento: "2026-11-20", forma: "boleto" });

    assert.deepEqual(await emitir(), { id: ID, etapa: "na_fila", replayed: true });
    assert.equal((await db.collection(EMISSOES_COLLECTION).get()).size, 1);
    assert.equal((await eventos()).length, 1);
  });

  it("a reservada não se emite de novo nem se registra à mão", async () => {
    await emitir();
    await recusa(emitNfOmieFor(db, financeiro, pedido({ idempotency_key: "em-2", armazenagem: [] }), { projectId: LIBERADO, agora: AGORA, novoId: () => "nfe_ffffffffffffffffffff" }), "failed-precondition", /está na emissão da NFS-e pela Omie/);
    await recusa(
      registerNfFor(db, financeiro, { idempotency_key: "nf-1", demandas: ["10045"], nf: { numero: "1", emitida_em: "2026-10-23" }, vencimento: "2026-11-20", forma: "boleto" }, AGORA),
      "failed-precondition",
      /está na emissão da NFS-e pela Omie/,
    );
  });

  it("confere como o registerNf; sem CNPJ, fora da liberação ou sem o papel, nada se grava", async () => {
    await recusa(emitNfOmieFor(db, financeiro, pedido({ demandas: ["10050"], armazenagem: [] }), { projectId: LIBERADO, agora: AGORA }), "failed-precondition", /não tem CNPJ no cadastro/);
    await db.doc("demands/10046").update({ etapa: "aguardando_autorizacao" });
    await recusa(emitir({ idempotency_key: "em-3" }), "failed-precondition", /A demanda 10046 não está A faturar/);
    await recusa(emitir({ idempotency_key: "em-4", vencimento: "2026-10-22" }), "invalid-argument", /de hoje em diante/);
    await recusa(emitNfOmieFor(db, financeiro, pedido(), { projectId: "dute-prod", agora: AGORA }), "failed-precondition", /não está liberada/);
    await recusa(emitNfOmieFor(db, { uid: "int-1", role: "interno" }, pedido(), { projectId: LIBERADO, agora: AGORA }), "permission-denied", /./);
    assert.equal((await db.collection(EMISSOES_COLLECTION).get()).size, 0);
    assert.equal(await reserva("demands/10045"), undefined);
    assert.equal((await eventos()).length, 0);
  });
});

describe("retomar e desistir", () => {
  it("desistir da parada sem a OS solta as reservas na hora; a demanda volta a se registrar à mão", async () => {
    await emitir();
    await db.doc(`${EMISSOES_COLLECTION}/${ID}`).update({ etapa: "parada", etapa_anterior: "na_fila", motivo_da_parada: "cliente_nao_achado", edicao: 2 });
    await recusa(actOnNfEmissionFor(db, financeiro, { idempotency_key: "a-0", id: ID, acao: "desistir", expected_edicao: 1 }, { projectId: LIBERADO, agora: AGORA }), "failed-precondition", /mudou/);
    const desistida = await actOnNfEmissionFor(db, financeiro, { idempotency_key: "a-1", id: ID, acao: "desistir", expected_edicao: 2 }, { projectId: LIBERADO, agora: AGORA });
    assert.deepEqual(desistida, { id: ID, etapa: "desistida", edicao: 3 });
    for (const caminho of ["demands/10045", "demands/10046", `${BILLING_PERIODS_COLLECTION}/ITAU__2026-09`]) assert.equal(await reserva(caminho), undefined, caminho);
    const evento = (await eventos()).find((item) => item.type === "nf.emission_abandoned");
    assert.deepEqual(evento?.payload, { id: ID, demandas: ["10045", "10046"], competencias: ["2026-09"], cancela_na_omie: false });
    await registerNfFor(db, financeiro, { idempotency_key: "nf-2", demandas: ["10045"], nf: { numero: "77", emitida_em: "2026-10-23" }, vencimento: "2026-11-20", forma: "boleto" }, AGORA);
    assert.equal((await db.doc("demands/10045").get()).get("etapa"), "faturada");
  });

  it("desistir da rejeitada com a OS na Omie espera o cancelamento lá, e a reserva continua", async () => {
    await emitir();
    await db.doc(`${EMISSOES_COLLECTION}/${ID}`).update({ etapa: "rejeitada", "omie.cliente": 5001, "omie.os": 9001, edicao: 4 });
    const cancelando = await actOnNfEmissionFor(db, financeiro, { idempotency_key: "a-2", id: ID, acao: "desistir", expected_edicao: 4 }, { projectId: LIBERADO, agora: AGORA });
    assert.equal(cancelando.etapa, "cancelando");
    assert.deepEqual(await reserva("demands/10045"), { id: ID, desde: "2026-10-23T15:00:00.000Z" });
    assert.equal((await eventos()).find((item) => item.type === "nf.emission_abandoned")?.payload.cancela_na_omie, true);
  });

  it("retomar a parada volta à etapa de onde parou, com o evento", async () => {
    await emitir();
    await db.doc(`${EMISSOES_COLLECTION}/${ID}`).update({ etapa: "parada", etapa_anterior: "os_incluida", motivo_da_parada: "falhas_seguidas", tentativas: 6, edicao: 7 });
    const retomada = await actOnNfEmissionFor(db, financeiro, { idempotency_key: "a-3", id: ID, acao: "retomar", expected_edicao: 7 }, { projectId: LIBERADO, agora: AGORA });
    assert.deepEqual(retomada, { id: ID, etapa: "os_incluida", edicao: 8 });
    const gravada = (await db.doc(`${EMISSOES_COLLECTION}/${ID}`).get()).data() ?? {};
    assert.deepEqual([gravada.tentativas, gravada.motivo_da_parada], [0, null]);
    assert.deepEqual((await eventos()).find((item) => item.type === "nf.emission_resumed")?.payload, { id: ID, etapa_antes: "parada", etapa_depois: "os_incluida" });
    await recusa(actOnNfEmissionFor(db, financeiro, { idempotency_key: "a-4", id: ID, acao: "retomar", expected_edicao: 8 }, { projectId: LIBERADO, agora: AGORA }), "failed-precondition", /Só a emissão parada ou rejeitada/);
  });
});

describe("a lista", () => {
  it("as emissões mais novas, com a reserva, sem o CNPJ", async () => {
    await emitir();
    const { emissoes } = await listNfEmissionsFor(db, financeiro);
    assert.equal(emissoes.length, 1);
    assert.deepEqual(
      [emissoes[0].id, emissoes[0].etapa, emissoes[0].demandas, emissoes[0].armazenagem, emissoes[0].total_cents, emissoes[0].reserva],
      [ID, "na_fila", ["10045", "10046"], ["ITAU__2026-09"], 1_492_008, true],
    );
    assert.equal("cnpj" in emissoes[0], false);
    await recusa(listNfEmissionsFor(db, { uid: "int-1", role: "interno" }), "permission-denied", /./);
  });
});
