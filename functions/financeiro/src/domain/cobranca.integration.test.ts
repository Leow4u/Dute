import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";

import { advanceFaturaFor } from "./cobranca-gravacao.js";
import { PAGAMENTOS_COLLECTION } from "./cobranca.js";
import { EVENTS_COLLECTION } from "./events.js";
import { registerNfFor } from "./fatura-gravacao.js";
import { FATURAS_COLLECTION } from "./fatura.js";
import type { FinanceiroProfile } from "./profile.js";

/**
 * A cobrança no emulador (parte 4.2a): a NF registrada recebe um pagamento
 * parcial e depois o que quita; paga, as demandas ficam pagas. O estorno
 * reabre a fatura e as demandas voltam a faturadas. Com pagamento, não se
 * cancela; sem, cancelar devolve as demandas a A faturar, libera a
 * autorização, e a mesma NF se registra de novo. Nenhum evento leva valor.
 * Dados sintéticos.
 */

const PROJECT_ID = "demo-dute-financeiro";
const AGORA = () => new Date("2026-10-23T15:00:00.000Z");
const financeiro: FinanceiroProfile = { uid: "fin-1", role: "financeiro", name: "Carla" };

let db: Firestore;
let app: ReturnType<typeof initializeApp>;
let faturaId: string;

before(() => {
  app = initializeApp({ projectId: PROJECT_ID }, "financeiro-cobranca-test");
  db = getFirestore(app);
});

after(async () => {
  await deleteApp(app);
});

const demanda = (numero: string) => ({
  numero,
  customer_code: "ITAU",
  customer_name: "Itaú Unibanco",
  etapa: "a_faturar",
  etapa_desde: "2026-10-20T12:00:00.000Z",
  marcos: [],
  validacao: { rv: 1, autorizacao: "pedido_aceite" },
  autorizacao_ids: ["aut_itau"],
});

beforeEach(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error("FIRESTORE_EMULATOR_HOST não definido.");
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
  const batch = db.batch();
  batch.set(db.doc("demands/10045"), demanda("10045"));
  batch.set(db.doc("demands/10046"), demanda("10046"));
  batch.set(db.doc("quotes/10045/revisoes/1"), { total_cents: 1_000_000 });
  batch.set(db.doc("quotes/10046/revisoes/1"), { total_cents: 484_500 });
  batch.set(db.doc("client_authorizations/aut_itau"), {
    id: "aut_itau",
    customer_code: "ITAU",
    tipo: "pedido_aceite",
    status: "registrada",
    demandas: [
      { numero: "10045", rv: 1 },
      { numero: "10046", rv: 1 },
    ],
    nf_ids: [],
  });
  await batch.commit();
  const registro = await registerNfFor(
    db,
    financeiro,
    { idempotency_key: "nf-1", demandas: ["10045", "10046"], nf: { numero: "1234", emitida_em: "2026-10-20" }, vencimento: "2026-11-20", forma: "boleto" },
    AGORA,
  );
  faturaId = registro.id;
});

const pagar = (chave: string, valor: string, extra: Record<string, unknown> = {}) =>
  advanceFaturaFor(db, financeiro, { acao: "pay", idempotency_key: chave, fatura_id: faturaId, valor, recebido_em: "2026-10-22", forma: "pix", ...extra }, AGORA);

async function recusa(promessa: Promise<unknown>, codigo: string, mensagem: string | RegExp) {
  await assert.rejects(promessa, (error: unknown) => {
    assert.ok(error instanceof HttpsError, String(error));
    assert.equal(error.code, codigo);
    if (typeof mensagem === "string") assert.equal(error.message, mensagem);
    else assert.match(error.message, mensagem);
    return true;
  });
}

const faturaAgora = async () => (await db.collection(FATURAS_COLLECTION).doc(faturaId).get()).data() ?? {};
const etapas = async () => Promise.all(["10045", "10046"].map(async (numero) => (await db.doc(`demands/${numero}`).get()).get("etapa")));
// O relógio do teste é fixo: os eventos têm o mesmo instante, então a ordem não diz nada. Compara-se por tipo.
const eventos = async () => (await db.collection(EVENTS_COLLECTION).get()).docs.map((doc) => doc.data());
/** O evento como texto, sem o carimbo do servidor: os nanossegundos dele podem conter qualquer sequência de dígitos. */
const semCarimbo = (lista: Array<Record<string, unknown>>) => JSON.stringify(lista.map(({ created_at: _carimbo, ...resto }) => resto));
const doTipo = async (tipo: string) => (await eventos()).filter((evento) => evento.type === tipo);

describe("a cobrança da NF", () => {
  it("o pagamento parcial deixa o saldo; o que quita deixa a fatura e as demandas pagas; repetir não duplica", async () => {
    const parcial = await pagar("pag-1", "5000");
    assert.deepEqual([parcial.status, parcial.recebido_cents, parcial.saldo_cents], ["emitida", 500_000, 984_500]);
    assert.deepEqual(await etapas(), ["faturada", "faturada"]);
    assert.equal((await pagar("pag-1", "5000")).replayed, true);
    assert.equal((await db.collection(PAGAMENTOS_COLLECTION).get()).size, 1);

    await recusa(pagar("pag-2", "9845.01"), "invalid-argument", /^O pagamento passa do saldo da NF, de R\$\s9\.845,00\.$/);
    const quitou = await pagar("pag-3", "9845");
    assert.deepEqual([quitou.status, quitou.recebido_cents, quitou.saldo_cents], ["paga", 1_484_500, 0]);
    const fatura = await faturaAgora();
    assert.deepEqual([fatura.status, fatura.recebido_cents, fatura.paga_em, fatura.pagamento_ids.length], ["paga", 1_484_500, "2026-10-22", 2]);
    assert.deepEqual(await etapas(), ["paga", "paga"]);
    const paga = (await db.doc("demands/10045").get()).data() ?? {};
    assert.equal(paga.faturamento.paga_em, "2026-10-22");
    assert.deepEqual(paga.marcos.at(-1), { etapa: "paga", em: "2026-10-23T15:00:00.000Z", por_uid: "fin-1" });
    await recusa(pagar("pag-4", "1"), "failed-precondition", "A NF já está paga.");

    const tipos = (await eventos()).map((evento) => `${evento.type}:${evento.payload.quitada ?? "-"}`).sort();
    assert.deepEqual(tipos, ["cobranca.payment_registered:false", "cobranca.payment_registered:true", "nf.registered:-"]);
    assert.doesNotMatch(semCarimbo(await eventos()), /500000|984500|1484500|cents|valor/);
  });

  it("o estorno reabre a paga e devolve as demandas a faturadas; a enviada volta a enviada", async () => {
    await advanceFaturaFor(db, financeiro, { acao: "send", idempotency_key: "env-1", fatura_id: faturaId, enviada_em: "2026-10-21", meio: "email" }, AGORA);
    assert.deepEqual([(await faturaAgora()).status, (await faturaAgora()).enviada.meio], ["enviada", "email"]);
    const quitou = await pagar("pag-1", "14845");
    assert.equal(quitou.status, "paga");
    const estorno = await advanceFaturaFor(db, financeiro, { acao: "reverse_payment", idempotency_key: "est-1", fatura_id: faturaId, pagamento_id: quitou.pagamento_id, motivo: "Lançado na NF errada" }, AGORA);
    assert.deepEqual([estorno.status, estorno.recebido_cents, estorno.saldo_cents], ["enviada", 0, 1_484_500]);
    const fatura = await faturaAgora();
    assert.equal(fatura.paga_em, undefined);
    assert.deepEqual(await etapas(), ["faturada", "faturada"]);
    assert.equal((await db.doc("demands/10045").get()).get("faturamento.paga_em"), undefined);
    const pagamento = (await db.collection(PAGAMENTOS_COLLECTION).doc(quitou.pagamento_id!).get()).data() ?? {};
    assert.deepEqual([pagamento.status, pagamento.estornado.motivo], ["estornado", "Lançado na NF errada"]);
    await recusa(
      advanceFaturaFor(db, financeiro, { acao: "reverse_payment", idempotency_key: "est-2", fatura_id: faturaId, pagamento_id: quitou.pagamento_id, motivo: "De novo, por engano" }, AGORA),
      "failed-precondition",
      "O pagamento já foi estornado.",
    );
    const estornos = await doTipo("cobranca.payment_reversed");
    assert.deepEqual(estornos.map((evento) => evento.payload), [{ id: faturaId, pagamento_id: quitou.pagamento_id, reaberta: true }]);
    assert.doesNotMatch(semCarimbo(estornos), /errada/);
  });

  it("com pagamento não cancela; sem, cancelar devolve as demandas, libera a autorização e a mesma NF se registra de novo", async () => {
    const parcial = await pagar("pag-1", "100");
    await recusa(
      advanceFaturaFor(db, financeiro, { acao: "cancel", idempotency_key: "can-1", fatura_id: faturaId, motivo: "Registro com a demanda errada" }, AGORA),
      "failed-precondition",
      "A NF tem pagamento registrado: estorne os pagamentos antes de cancelar.",
    );
    await advanceFaturaFor(db, financeiro, { acao: "reverse_payment", idempotency_key: "est-1", fatura_id: faturaId, pagamento_id: parcial.pagamento_id, motivo: "Valor digitado errado" }, AGORA);
    const cancelada = await advanceFaturaFor(db, financeiro, { acao: "cancel", idempotency_key: "can-2", fatura_id: faturaId, motivo: "Registro com a demanda errada" }, AGORA);
    assert.equal(cancelada.status, "cancelada");
    assert.deepEqual(await etapas(), ["a_faturar", "a_faturar"]);
    assert.equal((await db.doc("demands/10045").get()).get("faturamento"), undefined);
    assert.deepEqual((await db.doc("client_authorizations/aut_itau").get()).get("nf_ids"), []);
    assert.deepEqual((await doTipo("nf.cancelled")).map((evento) => evento.payload), [{ id: faturaId, demandas: ["10045", "10046"] }]);

    await recusa(pagar("pag-2", "1"), "failed-precondition", "A NF está cancelada.");
    // A mesma NF, agora só com a 10045: o registro anterior fica guardado.
    const denovo = await registerNfFor(
      db,
      financeiro,
      { idempotency_key: "nf-2", demandas: ["10045"], nf: { numero: "1234", emitida_em: "2026-10-20" }, vencimento: "2026-11-20", forma: "boleto" },
      AGORA,
    );
    assert.equal(denovo.id, faturaId);
    const fatura = await faturaAgora();
    assert.deepEqual([fatura.status, fatura.valor_cents, fatura.demanda_numeros, fatura.recebido_cents], ["emitida", 1_000_000, ["10045"], undefined]);
    assert.equal(fatura.anteriores.length, 1);
    assert.deepEqual(fatura.anteriores[0].demanda_numeros, ["10045", "10046"]);
    assert.deepEqual(await etapas(), ["faturada", "a_faturar"]);
  });

  it("enviar uma vez; a NF que não existe, a operação e o comercial recusam", async () => {
    const enviar = (chave: string, extra: Record<string, unknown> = {}) =>
      advanceFaturaFor(db, financeiro, { acao: "send", idempotency_key: chave, fatura_id: faturaId, enviada_em: "2026-10-21", meio: "portal_do_cliente", ...extra }, AGORA);
    await enviar("env-1");
    await recusa(enviar("env-2"), "failed-precondition", "A NF já foi enviada ao cliente.");
    await recusa(enviar("env-3", { fatura_id: "fat_ffffffffffffffffffffffff" }), "not-found", "NF não encontrada.");
    for (const role of ["interno", "comercial", "campo", "cliente"] as const) {
      await recusa(advanceFaturaFor(db, { uid: `${role}-1`, role }, { acao: "pay", idempotency_key: "x", fatura_id: faturaId, valor: "1", recebido_em: "2026-10-22", forma: "pix" }, AGORA), "permission-denied", "Seu perfil não grava no Financeiro.");
    }
    assert.equal((await db.collection(PAGAMENTOS_COLLECTION).get()).size, 0);
  });
});
