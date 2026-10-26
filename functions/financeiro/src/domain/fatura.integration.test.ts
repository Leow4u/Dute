import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";

import { BILLING_PERIODS_COLLECTION, CLIENT_INVOICES_COLLECTION } from "./armazenagem.js";
import { advanceFaturaFor } from "./cobranca-gravacao.js";
import { EVENTS_COLLECTION, FINANCEIRO_EVENT_SOURCE } from "./events.js";
import { registerNfFor } from "./fatura-gravacao.js";
import { FATURAS_COLLECTION, faturaIdDaNf } from "./fatura.js";
import { CLIENT_FATURAS_COLLECTION } from "./projecao.js";
import type { FinanceiroProfile } from "./profile.js";

/**
 * Registrar a NF no emulador (parte 4.1a): a demanda A faturar com a
 * autorização registrada fatura pelo total da RV validada; a fatura nasce
 * emitida, as demandas ficam Faturadas com o marco, as autorizações ganham a
 * NF e o evento sai sem valor; repetir não duplica. Sem autorização, fora de
 * A faturar, de clientes diferentes ou com a NF já registrada, nada se grava.
 * A competência que o WMS emitiu entra pelo total congelado (parte 7.2a). A
 * medição aprovada entra como um item próprio, pelo total aprovado, com as
 * demandas dela e as linhas sem demanda (pergunta 64). Dados sintéticos.
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
  // A medição mensal do Safra: as demandas vêm da medição aprovada, sem RV, e a equipe fixa entra sem demanda.
  const daMedicao = (numero: string) =>
    demanda(numero, {
      customer_code: "SAFRA",
      customer_name: "Banco Safra",
      cobranca: "medicao_mensal",
      medicao_id: "ctr_safra_2026-10",
      validacao: { etapa: "a_faturar", autorizacao: "medicao_aprovada", medicao_id: "ctr_safra_2026-10" },
      autorizacao_ids: ["aut_ctr_safra_2026-10"],
    });
  set("demands/10050", daMedicao("10050"));
  set("demands/10051", daMedicao("10051"));
  set("medicoes/ctr_safra_2026-10", MEDICAO);
  set("client_authorizations/aut_ctr_safra_2026-10", {
    id: "aut_ctr_safra_2026-10",
    customer_code: "SAFRA",
    tipo: "medicao_aprovada",
    origem: "medicao",
    status: "registrada",
    demandas: [],
    demanda_numeros: ["10050", "10051"],
    medicao_id: "ctr_safra_2026-10",
    valor_cents: 266_500,
    nf_ids: [],
  });
  // A armazenagem como o WMS emite: o total da NF é o da foto, não o do período.
  const periodo = (customer: string | null, competencia: string, status: string, centavos: number) => ({
    ...(customer ? { customer_code: customer } : {}),
    competencia,
    status,
    total_cents: centavos + 1,
    ...(status === "aberto" ? {} : { invoice_snapshot: { schema_version: 1, competencia, status: "emitido", total_cents: centavos, total: centavos / 100 } }),
  });
  set(`${BILLING_PERIODS_COLLECTION}/ITAU__2026-09`, periodo("ITAU", "2026-09", "emitido", 7_508));
  set(`${BILLING_PERIODS_COLLECTION}/ITAU__2026-08`, periodo("ITAU", "2026-08", "pago", 6_000));
  set(`${BILLING_PERIODS_COLLECTION}/ITAU__2026-10`, periodo("ITAU", "2026-10", "aberto", 0));
  set(`${BILLING_PERIODS_COLLECTION}/SAFRA__2026-09`, periodo("SAFRA", "2026-09", "emitido", 3_000));
  set(`${BILLING_PERIODS_COLLECTION}/2026-07`, periodo(null, "2026-07", "emitido", 1_234));
  // O portal do WMS: o id novo e, na BTG antiga, o id do mês.
  set(`${CLIENT_INVOICES_COLLECTION}/ITAU__2026-09`, { customer_code: "ITAU", competencia: "2026-09", status: "emitido", payment_status: "issued", total_cents: 7_508 });
  set(`${CLIENT_INVOICES_COLLECTION}/2026-07`, { competencia: "2026-07", status: "emitido", payment_status: "issued", total_cents: 1_234 });
  await batch.commit();
});

/** A medição aprovada de outubro do Safra: duas demandas, a equipe fixa e um item avulso sem serviço. Total R$ 2.665,00. */
const MEDICAO = {
  id: "ctr_safra_2026-10",
  customer_code: "SAFRA",
  contrato_id: "ctr_safra",
  competencia: "2026-10",
  status: "aprovada",
  autorizacao_id: "aut_ctr_safra_2026-10",
  total_cents: 266_500,
  linhas: [
    { id: "l1", demanda_numero: "10050", total_cents: 30_000, itens: [{ servico: "Transporte", total_cents: 30_000 }] },
    { id: "l2", demanda_numero: "10051", total_cents: 99_000, itens: [{ servico: "Montagem", total_cents: 99_000 }] },
    { id: "l3", demanda_numero: "10050", total_cents: 12_500, itens: [{ servico: "Transporte", total_cents: 12_500 }] },
    { id: "l4", demanda_numero: null, total_cents: 80_000, itens: [{ servico: "Equipe fixa", total_cents: 80_000 }] },
    { id: "l5", demanda_numero: null, total_cents: 45_000, itens: [{ servico: "Equipe fixa", total_cents: 40_000 }, { servico: null, total_cents: 5_000 }] },
  ],
};

/** A demanda 10051 da medição como o beforeEach a grava, para voltar depois de mexer nela. */
const MEDICAO_10051 = {
  numero: "10051",
  customer_code: "SAFRA",
  customer_name: "Banco Safra",
  entrada: "comercial",
  cobranca: "medicao_mensal",
  etapa: "a_faturar",
  etapa_desde: "2026-10-20T12:00:00.000Z",
  marcos: [{ etapa: "a_faturar", em: "2026-10-20T12:00:00.000Z", por_uid: "com-1" }],
  medicao_id: "ctr_safra_2026-10",
  validacao: { etapa: "a_faturar", autorizacao: "medicao_aprovada", medicao_id: "ctr_safra_2026-10" },
  autorizacao_ids: ["aut_ctr_safra_2026-10"],
};

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
    assert.deepEqual(resultado, { id, valor_cents: 1_484_500, demandas: ["10045", "10046"], armazenagem: [] });

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
    assert.deepEqual(eventos[0].payload, { id, demandas: ["10045", "10046"], competencias: [], autorizacoes: 1, emitida_em: "2026-10-23", vencimento: "2026-11-20", forma: "boleto" });
    // Sem o carimbo do servidor: os nanossegundos dele podem conter qualquer sequência de dígitos.
    const { created_at: _carimbo, ...semCarimbo } = eventos[0];
    assert.doesNotMatch(JSON.stringify(semCarimbo), /1234500|4500000009|1234"/);

    assert.equal((await registerNfFor(db, financeiro, pedido(), AGORA)).replayed, true);
    assert.equal((await db.collection(EVENTS_COLLECTION).get()).size, 1);
    // A mesma NF com outra chave não se registra de novo.
    await recusa(registerNfFor(db, financeiro, pedido({ idempotency_key: "nf-2", demandas: ["10050"] }), AGORA), "failed-precondition", "A NF 1234 da série 1 já está registrada.");
  });

  it("a NF que cita mais de 50 autorizações se registra, com a contagem no evento", async () => {
    // O pedido e os complementos: uma demanda pode ter várias autorizações.
    const ids = Array.from({ length: 51 }, (_, i) => `aut_${String(i).padStart(2, "0")}`);
    const batch = db.batch();
    for (const id of ids) {
      batch.set(db.doc(`client_authorizations/${id}`), { id, customer_code: "ITAU", tipo: "pedido_aceite", status: "registrada", demandas: [{ numero: "10045", rv: 1 }], demanda_numeros: ["10045"], nf_ids: [] });
    }
    batch.update(db.doc("demands/10045"), { autorizacao_ids: ids });
    await batch.commit();

    const resultado = await registerNfFor(db, financeiro, pedido({ demandas: ["10045"] }), AGORA);
    const [evento] = (await db.collection(EVENTS_COLLECTION).get()).docs.map((doc) => doc.data());
    assert.equal(evento.payload.autorizacoes, 51);
    assert.equal((await db.doc(`client_authorizations/${ids[50]}`).get()).get("nf_ids")[0], resultado.id);
  });

  it("a demanda da medição não fatura sozinha: ela vai na NF da medição (pergunta 64)", async () => {
    // Antes: a demanda 10050 faturava sozinha pela soma das linhas dela, e a equipe fixa nunca entrava numa NF.
    await recusa(
      registerNfFor(db, financeiro, pedido({ demandas: ["10050"], nf: { numero: "77", serie: "2", emitida_em: "2026-10-23" } }), AGORA),
      "failed-precondition",
      "A demanda 10050 é da medição de 10/2026: ela fatura com a medição.",
    );
    await nadaGravado();
  });

  it("a demanda por demanda num contrato que autoriza pela medição fatura pela RV, sem autorização: ela não entra em medição", async () => {
    // A validação (comercial, destinoDaValidacao) a levou direto a A faturar e guardou o tipo do contrato.
    await db.doc("demands/10047").set(demanda("10047", { validacao: { rv: 0, etapa: "a_faturar", autorizacao: "medicao_aprovada" }, autorizacao_ids: [] }));
    await db.doc("quotes/10047/revisoes/0").set({ total_cents: 90_000 });
    // Antes: "A demanda 10047 não tem autorização de faturamento registrada.", e nada no Comercial a destravava.
    const resultado = await registerNfFor(db, financeiro, pedido({ idempotency_key: "nf-medicao", demandas: ["10047"], nf: { numero: "88", emitida_em: "2026-10-23" } }), AGORA);
    assert.equal(resultado.valor_cents, 90_000);
    assert.equal((await db.doc("demands/10047").get()).get("etapa"), "faturada");
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

  it("a demanda e a competência reservadas por uma emissão da Omie não se registram à mão (parte 7.4b)", async () => {
    const reserva = { emissao_nf: { id: "nfe_0123456789abcdef0123", desde: "2026-10-23T14:00:00.000Z" } };
    await db.doc("demands/10046").update(reserva);
    await recusa(registerNfFor(db, financeiro, pedido({ idempotency_key: "r-1" }), AGORA), "failed-precondition", "A demanda 10046 está na emissão da NFS-e pela Omie.");
    await db.doc("demands/10046").update({ emissao_nf: null });
    await db.collection(BILLING_PERIODS_COLLECTION).doc("ITAU__2026-09").update(reserva);
    await recusa(
      registerNfFor(db, financeiro, pedido({ idempotency_key: "r-2", demandas: [], armazenagem: ["ITAU__2026-09"] }), AGORA),
      "failed-precondition",
      "A armazenagem de 09/2026 está na emissão da NFS-e pela Omie.",
    );
    await nadaGravado();
    // Sem a reserva, a mesma demanda registra.
    await registerNfFor(db, financeiro, pedido({ idempotency_key: "r-3" }), AGORA);
    assert.equal((await db.doc("demands/10046").get()).get("etapa"), "faturada");
  });

  it("a operação, o comercial, o campo e o cliente não registram", async () => {
    for (const role of ["interno", "comercial", "campo", "suporte", "cliente"] as const) {
      await recusa(registerNfFor(db, { uid: `${role}-1`, role }, pedido(), AGORA), "permission-denied", "Seu perfil não grava no Financeiro.");
    }
    await nadaGravado();
  });
});

describe("a armazenagem na NF (parte 7.2a)", () => {
  const periodoAgora = async (id: string) => (await db.collection(BILLING_PERIODS_COLLECTION).doc(id).get()).data() ?? {};

  it("a competência emitida entra pelo total da foto, com as demandas do mesmo cliente; o WMS segue emitido", async () => {
    const resultado = await registerNfFor(db, financeiro, pedido({ demandas: ["10045"], armazenagem: ["ITAU__2026-09"], nf: { numero: "500", emitida_em: "2026-10-23" } }), AGORA);
    const id = faturaIdDaNf("1", "500");
    assert.deepEqual(resultado, { id, valor_cents: 1_234_500 + 7_508, demandas: ["10045"], armazenagem: ["ITAU__2026-09"] });

    const fatura = (await db.collection(FATURAS_COLLECTION).doc(id).get()).data() ?? {};
    assert.deepEqual(fatura.armazenagem, [{ periodo_id: "ITAU__2026-09", competencia: "2026-09", valor_cents: 7_508 }]);
    assert.deepEqual(fatura.periodo_ids, ["ITAU__2026-09"]);
    assert.equal(fatura.valor_cents, 1_242_008);

    const periodo = await periodoAgora("ITAU__2026-09");
    assert.equal(periodo.status, "emitido");
    assert.deepEqual(periodo.faturamento, (await db.doc("demands/10045").get()).get("faturamento"));
    assert.equal(periodo.faturamento.fatura_id, id);

    const evento = (await db.collection(EVENTS_COLLECTION).get()).docs.map((doc) => doc.data());
    assert.deepEqual(evento.map((item) => [item.type, item.payload.demandas, item.payload.competencias]), [["nf.registered", ["10045"], ["2026-09"]]]);
    const portal = (await db.collection(CLIENT_FATURAS_COLLECTION).doc(id).get()).data() ?? {};
    assert.deepEqual(portal.armazenagem, [{ competencia: "2026-09", valor_cents: 7_508 }]);
    assert.equal(portal.valor_cents, 1_242_008);

    assert.equal((await registerNfFor(db, financeiro, pedido({ demandas: ["10045"], armazenagem: ["ITAU__2026-09"], nf: { numero: "500", emitida_em: "2026-10-23" } }), AGORA)).replayed, true);
    await recusa(
      registerNfFor(db, financeiro, pedido({ idempotency_key: "nf-7", demandas: [], armazenagem: ["ITAU__2026-09"], nf: { numero: "501", emitida_em: "2026-10-23" } }), AGORA),
      "failed-precondition",
      "A armazenagem de 09/2026 já está numa NF.",
    );
  });

  it("a competência antiga da BTG fatura sozinha, pelo cliente do id antigo", async () => {
    const resultado = await registerNfFor(db, financeiro, pedido({ demandas: [], armazenagem: ["2026-07"], nf: { numero: "600", emitida_em: "2026-10-23" } }), AGORA);
    assert.deepEqual([resultado.valor_cents, resultado.demandas], [1_234, []]);
    const fatura = (await db.collection(FATURAS_COLLECTION).doc(resultado.id).get()).data() ?? {};
    assert.deepEqual([fatura.customer_code, fatura.customer_name, fatura.demandas, fatura.autorizacao_ids], ["BTG Pactual", null, [], []]);
    assert.equal((await periodoAgora("2026-07")).faturamento.fatura_id, resultado.id);
  });

  it("a aberta, a paga, a de outro cliente e a que não existe não entram, e nada se grava", async () => {
    const nf = (armazenagem: string[], chave: string, demandas: string[] = []) => registerNfFor(db, financeiro, pedido({ idempotency_key: chave, demandas, armazenagem }), AGORA);
    await recusa(nf(["ITAU__2026-10"], "a-1"), "failed-precondition", "A armazenagem de 10/2026 ainda não foi emitida no WMS.");
    await recusa(nf(["ITAU__2026-08"], "a-2"), "failed-precondition", "A armazenagem de 08/2026 já está paga no WMS.");
    await recusa(nf(["SAFRA__2026-09"], "a-3", ["10045"]), "invalid-argument", "A armazenagem de 09/2026 é de outro cliente: uma NF é de um cliente só.");
    await recusa(nf(["ITAU__2026-09", "SAFRA__2026-09"], "a-4"), "invalid-argument", "A armazenagem de 09/2026 é de outro cliente: uma NF é de um cliente só.");
    await recusa(nf(["ITAU__2026-11"], "a-5"), "not-found", "Competência de armazenagem ITAU__2026-11 não encontrada.");
    await nadaGravado();
    for (const id of ["ITAU__2026-09", "SAFRA__2026-09", "2026-07"]) assert.equal((await periodoAgora(id)).faturamento, undefined, id);
  });

  it("cancelar o registro devolve a competência à fila, e ela entra em outra NF", async () => {
    const registro = await registerNfFor(db, financeiro, pedido({ demandas: ["10045"], armazenagem: ["ITAU__2026-09"], nf: { numero: "700", emitida_em: "2026-10-23" } }), AGORA);
    await advanceFaturaFor(db, financeiro, { acao: "cancel", idempotency_key: "c-1", fatura_id: registro.id, motivo: "NF errada" }, AGORA);
    assert.equal((await periodoAgora("ITAU__2026-09")).faturamento, undefined);
    assert.equal((await periodoAgora("ITAU__2026-09")).status, "emitido");
    const cancelada = (await db.collection(EVENTS_COLLECTION).where("type", "==", "nf.cancelled").get()).docs[0]?.data();
    assert.deepEqual(cancelada?.payload, { id: registro.id, demandas: ["10045"], competencias: ["2026-09"] });

    const outra = await registerNfFor(db, financeiro, pedido({ idempotency_key: "nf-8", demandas: [], armazenagem: ["ITAU__2026-09"], nf: { numero: "701", emitida_em: "2026-10-23" } }), AGORA);
    assert.equal(outra.valor_cents, 7_508);
    assert.equal((await periodoAgora("ITAU__2026-09")).faturamento.fatura_id, outra.id);
  });

  it("o cancelamento recusa a competência que saiu desta NF, e nada muda", async () => {
    const registro = await registerNfFor(db, financeiro, pedido({ demandas: [], armazenagem: ["ITAU__2026-09"], nf: { numero: "800", emitida_em: "2026-10-23" } }), AGORA);
    await db.collection(BILLING_PERIODS_COLLECTION).doc("ITAU__2026-09").update({ "faturamento.fatura_id": "fat_outra" });
    await recusa(
      advanceFaturaFor(db, financeiro, { acao: "cancel", idempotency_key: "c-2", fatura_id: registro.id, motivo: "NF errada" }, AGORA),
      "failed-precondition",
      "A armazenagem de 09/2026 não está nesta NF.",
    );
    assert.equal((await db.collection(FATURAS_COLLECTION).doc(registro.id).get()).get("status"), "emitida");
  });

  it("o pagamento que quita marca a competência paga no WMS e no portal; o estorno a devolve a emitida (parte 7.2c)", async () => {
    const registro = await registerNfFor(db, financeiro, pedido({ demandas: ["10045"], armazenagem: ["ITAU__2026-09"], nf: { numero: "900", emitida_em: "2026-10-20" } }), AGORA);
    const pagar = (chave: string, valor: string) =>
      advanceFaturaFor(db, financeiro, { acao: "pay", idempotency_key: chave, fatura_id: registro.id, valor, recebido_em: "2026-10-22", forma: "pix" }, AGORA);
    const portal = async () => (await db.collection(CLIENT_INVOICES_COLLECTION).doc("ITAU__2026-09").get()).data() ?? {};
    const pagamentos = async () => (await db.collection(EVENTS_COLLECTION).where("type", "==", "cobranca.payment_registered").get()).docs.map((doc) => doc.data().payload);

    await pagar("p-1", "100");
    assert.equal((await periodoAgora("ITAU__2026-09")).status, "emitido");
    const quitou = await pagar("p-2", "12320.08");
    assert.equal(quitou.status, "paga");

    const paga = await periodoAgora("ITAU__2026-09");
    assert.deepEqual([paga.status, paga.pago_em, paga.paid_by, paga.faturamento.paga_em, paga.faturamento.fatura_id], ["pago", "2026-10-23T15:00:00.000Z", "fin-1", "2026-10-22", registro.id]);
    assert.deepEqual([(await portal()).status, (await portal()).payment_status, (await portal()).pago_em, (await portal()).total_cents], ["pago", "paid", "2026-10-23T15:00:00.000Z", 7_508]);
    assert.deepEqual((await pagamentos()).map((payload) => [payload.quitada, payload.competencias]).sort(), [[false, []], [true, ["2026-09"]]]);

    await advanceFaturaFor(db, financeiro, { acao: "reverse_payment", idempotency_key: "e-1", fatura_id: registro.id, pagamento_id: quitou.pagamento_id, motivo: "Pix devolvido" }, AGORA);
    const reaberta = await periodoAgora("ITAU__2026-09");
    assert.deepEqual([reaberta.status, reaberta.pago_em, reaberta.paid_by, reaberta.faturamento.paga_em, reaberta.faturamento.fatura_id], ["emitido", undefined, undefined, undefined, registro.id]);
    assert.deepEqual([(await portal()).status, (await portal()).payment_status, (await portal()).pago_em], ["emitido", "issued", undefined]);
    const estorno = (await db.collection(EVENTS_COLLECTION).where("type", "==", "cobranca.payment_reversed").get()).docs[0]?.data().payload;
    assert.deepEqual([estorno?.reaberta, estorno?.competencias], [true, ["2026-09"]]);
  });

  it("na BTG antiga, o portal pago é o do id do mês, sem criar o novo", async () => {
    const registro = await registerNfFor(db, financeiro, pedido({ demandas: [], armazenagem: ["2026-07"], nf: { numero: "901", emitida_em: "2026-10-20" } }), AGORA);
    await advanceFaturaFor(db, financeiro, { acao: "pay", idempotency_key: "p-3", fatura_id: registro.id, valor: "12.34", recebido_em: "2026-10-22", forma: "boleto" }, AGORA);
    assert.equal((await periodoAgora("2026-07")).status, "pago");
    const antigo = (await db.collection(CLIENT_INVOICES_COLLECTION).doc("2026-07").get()).data() ?? {};
    assert.deepEqual([antigo.status, antigo.payment_status, antigo.customer_code], ["pago", "paid", "BTG Pactual"]);
    assert.equal((await db.collection(CLIENT_INVOICES_COLLECTION).doc("BTG_Pactual__2026-07").get()).exists, false);
  });

  it("a competência que saiu de emitida no WMS não deixa quitar, e nada se grava", async () => {
    const registro = await registerNfFor(db, financeiro, pedido({ demandas: [], armazenagem: ["ITAU__2026-09"], nf: { numero: "902", emitida_em: "2026-10-20" } }), AGORA);
    await db.collection(BILLING_PERIODS_COLLECTION).doc("ITAU__2026-09").update({ status: "pago" });
    await recusa(
      advanceFaturaFor(db, financeiro, { acao: "pay", idempotency_key: "p-4", fatura_id: registro.id, valor: "75.08", recebido_em: "2026-10-22", forma: "pix" }, AGORA),
      "failed-precondition",
      "A armazenagem de 09/2026 não está emitida no WMS.",
    );
    const fatura = (await db.collection(FATURAS_COLLECTION).doc(registro.id).get()).data() ?? {};
    assert.deepEqual([fatura.status, fatura.recebido_cents], ["emitida", undefined]);
    assert.equal((await db.collection("pagamentos").get()).size, 0);
  });
});

describe("a medição aprovada na NF (pergunta 64)", () => {
  const medicaoAgora = async () => (await db.doc("medicoes/ctr_safra_2026-10").get()).data() ?? {};
  const daMedicao = (extra: Record<string, unknown> = {}) => pedido({ idempotency_key: "nf-medicao-1", demandas: [], medicoes: ["ctr_safra_2026-10"], nf: { numero: "2318", emitida_em: "2026-10-23" }, ...extra });

  it("fatura pelo total aprovado: as demandas pela soma das linhas delas e as linhas sem demanda pelo serviço; repetir não duplica", async () => {
    const resultado = await registerNfFor(db, financeiro, daMedicao(), AGORA);
    const id = faturaIdDaNf("1", "2318");
    assert.deepEqual(resultado, { id, valor_cents: 266_500, demandas: [], armazenagem: [], medicoes: ["ctr_safra_2026-10"] });

    const fatura = (await db.collection(FATURAS_COLLECTION).doc(id).get()).data() ?? {};
    assert.equal(fatura.valor_cents, 266_500);
    assert.deepEqual([fatura.customer_code, fatura.customer_name], ["SAFRA", "Banco Safra"]);
    assert.deepEqual(fatura.demandas, [
      { numero: "10050", rv: null, medicao_id: "ctr_safra_2026-10", autorizacao_ids: ["aut_ctr_safra_2026-10"], valor_cents: 42_500 },
      { numero: "10051", rv: null, medicao_id: "ctr_safra_2026-10", autorizacao_ids: ["aut_ctr_safra_2026-10"], valor_cents: 99_000 },
    ]);
    assert.deepEqual(fatura.medicoes, [
      {
        medicao_id: "ctr_safra_2026-10",
        contrato_id: "ctr_safra",
        competencia: "2026-10",
        autorizacao_id: "aut_ctr_safra_2026-10",
        valor_cents: 266_500,
        demandas: ["10050", "10051"],
        sem_demanda: [
          { servico: "Equipe fixa", valor_cents: 120_000 },
          { servico: "Sem serviço", valor_cents: 5_000 },
        ],
      },
    ]);
    assert.deepEqual([fatura.medicao_ids, fatura.demanda_numeros, fatura.autorizacao_ids], [["ctr_safra_2026-10"], ["10050", "10051"], ["aut_ctr_safra_2026-10"]]);

    // As demandas ficam Faturadas; a medição ganha o mesmo resumo; a autorização, a NF.
    for (const numero of ["10050", "10051"]) assert.equal((await db.doc(`demands/${numero}`).get()).get("etapa"), "faturada", numero);
    const medicao = await medicaoAgora();
    assert.deepEqual(medicao.faturamento, (await db.doc("demands/10050").get()).get("faturamento"));
    assert.equal(medicao.faturamento.fatura_id, id);
    assert.equal(medicao.status, "aprovada");
    assert.deepEqual((await db.doc("client_authorizations/aut_ctr_safra_2026-10").get()).get("nf_ids"), [id]);

    const [evento] = (await db.collection(EVENTS_COLLECTION).get()).docs.map((doc) => doc.data());
    assert.deepEqual(evento.payload, { id, demandas: ["10050", "10051"], competencias: [], medicoes: ["ctr_safra_2026-10"], autorizacoes: 1, emitida_em: "2026-10-23", vencimento: "2026-11-20", forma: "boleto" });
    const portal = (await db.collection(CLIENT_FATURAS_COLLECTION).doc(id).get()).data() ?? {};
    assert.equal(portal.valor_cents, 266_500);
    assert.deepEqual(portal.medicoes, [
      {
        competencia: "2026-10",
        valor_cents: 266_500,
        demandas: ["10050", "10051"],
        sem_demanda: [
          { servico: "Equipe fixa", valor_cents: 120_000 },
          { servico: "Sem serviço", valor_cents: 5_000 },
        ],
      },
    ]);

    assert.equal((await registerNfFor(db, financeiro, daMedicao(), AGORA)).replayed, true);
    assert.equal((await db.collection(EVENTS_COLLECTION).get()).size, 1);
    await recusa(registerNfFor(db, financeiro, daMedicao({ idempotency_key: "nf-medicao-2", nf: { numero: "2319", emitida_em: "2026-10-23" } }), AGORA), "failed-precondition", "A medição de 10/2026 já está numa NF.");
  });

  it("a medição só com as linhas sem demanda (a equipe fixa) fatura sozinha", async () => {
    await db.doc("medicoes/ctr_safra_2026-09").set({
      ...MEDICAO,
      id: "ctr_safra_2026-09",
      competencia: "2026-09",
      autorizacao_id: "aut_ctr_safra_2026-09",
      total_cents: 80_000,
      linhas: [MEDICAO.linhas[3]],
    });
    await db.doc("client_authorizations/aut_ctr_safra_2026-09").set({ id: "aut_ctr_safra_2026-09", customer_code: "SAFRA", tipo: "medicao_aprovada", status: "registrada", demandas: [], demanda_numeros: [], nf_ids: [] });
    const resultado = await registerNfFor(db, financeiro, daMedicao({ medicoes: ["ctr_safra_2026-09"] }), AGORA);
    assert.equal(resultado.valor_cents, 80_000);
    const fatura = (await db.collection(FATURAS_COLLECTION).doc(resultado.id).get()).data() ?? {};
    assert.deepEqual([fatura.demandas, fatura.demanda_numeros, fatura.customer_code, fatura.autorizacao_ids], [[], [], "SAFRA", ["aut_ctr_safra_2026-09"]]);
    assert.deepEqual(fatura.medicoes[0].sem_demanda, [{ servico: "Equipe fixa", valor_cents: 80_000 }]);
    assert.deepEqual((await db.doc("client_authorizations/aut_ctr_safra_2026-09").get()).get("nf_ids"), [resultado.id]);
  });

  it("a demanda da medição fora de A faturar, a autorização cancelada, a medição sem aprovação, reservada ou de outro cliente não faturam, e nada se grava", async () => {
    await db.doc("demands/10051").update({ etapa: "para_planejar" });
    await recusa(registerNfFor(db, financeiro, daMedicao(), AGORA), "failed-precondition", "A demanda 10051 não está A faturar. Ela é da medição de 10/2026.");
    await db.doc("demands/10051").update({ etapa: "a_faturar", medicao_id: "ctr_safra_2026-11", "validacao.medicao_id": "ctr_safra_2026-11" });
    await recusa(registerNfFor(db, financeiro, daMedicao({ idempotency_key: "m-2" }), AGORA), "failed-precondition", "A demanda 10051 não está presa a esta medição. Ela é da medição de 10/2026.");
    await db.doc("demands/10051").set(MEDICAO_10051);

    await db.doc("client_authorizations/aut_ctr_safra_2026-10").update({ status: "cancelada" });
    await recusa(registerNfFor(db, financeiro, daMedicao({ idempotency_key: "m-3" }), AGORA), "failed-precondition", "A medição de 10/2026 não tem a autorização de faturamento registrada.");
    await db.doc("client_authorizations/aut_ctr_safra_2026-10").update({ status: "registrada" });

    await db.doc("medicoes/ctr_safra_2026-10").update({ status: "enviada" });
    await recusa(registerNfFor(db, financeiro, daMedicao({ idempotency_key: "m-4" }), AGORA), "failed-precondition", "A medição de 10/2026 não está aprovada.");
    await db.doc("medicoes/ctr_safra_2026-10").update({ status: "aprovada", total_cents: 266_501 });
    await recusa(registerNfFor(db, financeiro, daMedicao({ idempotency_key: "m-5" }), AGORA), "failed-precondition", "A medição de 10/2026 tem linha sem valor ou fora do total.");
    await db.doc("medicoes/ctr_safra_2026-10").update({ total_cents: 266_500, emissao_nf: { id: "nfe_0123456789abcdef0123", desde: "2026-10-23T14:00:00.000Z" } });
    await recusa(registerNfFor(db, financeiro, daMedicao({ idempotency_key: "m-6" }), AGORA), "failed-precondition", "A medição de 10/2026 está na emissão da NFS-e pela Omie.");
    await db.doc("medicoes/ctr_safra_2026-10").update({ emissao_nf: null });

    await recusa(
      registerNfFor(db, financeiro, daMedicao({ idempotency_key: "m-7", demandas: ["10045"] }), AGORA),
      "invalid-argument",
      "A medição de 10/2026 é de outro cliente: uma NF é de um cliente só.",
    );
    await recusa(registerNfFor(db, financeiro, daMedicao({ idempotency_key: "m-8", medicoes: ["ctr_safra_2026-12"] }), AGORA), "not-found", "Medição ctr_safra_2026-12 não encontrada.");
    await nadaGravado();
    for (const numero of ["10050", "10051"]) assert.equal((await db.doc(`demands/${numero}`).get()).get("etapa"), "a_faturar", numero);
    assert.equal((await medicaoAgora()).faturamento, undefined);
  });

  it("cancelar o registro devolve a medição e as demandas dela a A faturar, e a medição entra em outra NF", async () => {
    const registro = await registerNfFor(db, financeiro, daMedicao(), AGORA);
    await advanceFaturaFor(db, financeiro, { acao: "cancel", idempotency_key: "c-m-1", fatura_id: registro.id, motivo: "NF errada" }, AGORA);
    assert.equal((await medicaoAgora()).faturamento, undefined);
    for (const numero of ["10050", "10051"]) assert.equal((await db.doc(`demands/${numero}`).get()).get("etapa"), "a_faturar", numero);
    assert.deepEqual((await db.doc("client_authorizations/aut_ctr_safra_2026-10").get()).get("nf_ids"), []);
    const cancelada = (await db.collection(EVENTS_COLLECTION).where("type", "==", "nf.cancelled").get()).docs[0]?.data();
    assert.deepEqual(cancelada?.payload, { id: registro.id, demandas: ["10050", "10051"], competencias: [], medicoes: ["ctr_safra_2026-10"] });

    const outra = await registerNfFor(db, financeiro, daMedicao({ idempotency_key: "nf-medicao-3", nf: { numero: "2320", emitida_em: "2026-10-23" } }), AGORA);
    assert.equal(outra.valor_cents, 266_500);
    assert.equal((await medicaoAgora()).faturamento.fatura_id, outra.id);
  });

  it("o cancelamento recusa a medição que saiu desta NF, e nada muda", async () => {
    const registro = await registerNfFor(db, financeiro, daMedicao(), AGORA);
    await db.doc("medicoes/ctr_safra_2026-10").update({ "faturamento.fatura_id": "fat_outra" });
    await recusa(
      advanceFaturaFor(db, financeiro, { acao: "cancel", idempotency_key: "c-m-2", fatura_id: registro.id, motivo: "NF errada" }, AGORA),
      "failed-precondition",
      "A medição de 10/2026 não está nesta NF.",
    );
    assert.equal((await db.collection(FATURAS_COLLECTION).doc(registro.id).get()).get("status"), "emitida");
  });

  it("o pagamento que quita marca o dia na medição e as demandas pagas; o estorno tira", async () => {
    const registro = await registerNfFor(db, financeiro, daMedicao({ nf: { numero: "2321", emitida_em: "2026-10-20" } }), AGORA);
    const quitou = await advanceFaturaFor(db, financeiro, { acao: "pay", idempotency_key: "p-m-1", fatura_id: registro.id, valor: "2665.00", recebido_em: "2026-10-22", forma: "pix" }, AGORA);
    assert.equal(quitou.status, "paga");
    assert.deepEqual([(await medicaoAgora()).faturamento.paga_em, (await medicaoAgora()).faturamento.fatura_id], ["2026-10-22", registro.id]);
    for (const numero of ["10050", "10051"]) assert.equal((await db.doc(`demands/${numero}`).get()).get("etapa"), "paga", numero);

    await advanceFaturaFor(db, financeiro, { acao: "reverse_payment", idempotency_key: "e-m-1", fatura_id: registro.id, pagamento_id: quitou.pagamento_id, motivo: "Pix devolvido" }, AGORA);
    assert.deepEqual([(await medicaoAgora()).faturamento.paga_em, (await medicaoAgora()).faturamento.fatura_id], [undefined, registro.id]);
    for (const numero of ["10050", "10051"]) assert.equal((await db.doc(`demands/${numero}`).get()).get("etapa"), "faturada", numero);
  });
});
