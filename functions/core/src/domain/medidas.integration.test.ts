import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { Timestamp, getFirestore, type Firestore } from "firebase-admin/firestore";

import { AI_CURSORS_COLLECTION, CURSOR_DAS_MEDIDAS, EVENTS_COLLECTION, SERVICE_ORDERS_COLLECTION, runMeasuresFor } from "./medidas-gravacao.js";
import { AI_MEASURES_COLLECTION, idDaMedida } from "./medidas.js";

/**
 * A rotina das medidas no emulador (parte 5.1a): na primeira vez, recalcula
 * com as OS revisadas que já existem e marca o cursor; sem evento novo, não
 * faz nada; com a OS reaberta, recalcula e apaga a medida do item que ficou
 * sem OS. A medida do cliente só usa as OS dele. Dados sintéticos, o mesmo
 * caso resolvido à mão de medidas.test.ts.
 */

const PROJECT_ID = "demo-dute-core";
const T0 = new Date("2026-10-23T12:00:00.000Z");
const depois = (minutos: number) => new Date(T0.getTime() + minutos * 60_000);

let db: Firestore;
let app: ReturnType<typeof initializeApp>;

before(() => {
  app = initializeApp({ projectId: PROJECT_ID }, "core-medidas-test");
  db = getFirestore(app);
});

after(async () => {
  await deleteApp(app);
});

const as = (hora: string) => `2026-10-20T${hora}:00.000Z`;
const etapas = (chegada: string, fim: string) => [
  { etapa: "chegada_origem", instante: as(chegada) },
  { etapa: "fim", instante: as(fim) },
];
const linha = (id: string, lpu: string, executado: string) => ({ linha: id, lpu_item_id: lpu, item: `Item ${lpu}`, unidade: "UN", planejado: executado, executado, corrigido: null });

function os(customer: string, chegada: string, fim: string, pessoas: number, linhas: Array<Record<string, unknown>>, revisadaEm: string, status = "revisada") {
  return { status, tipo: "servico", customer_code: customer, etapas: etapas(chegada, fim), revisao: { instante: revisadaEm, pessoas, linhas } };
}

async function evento(id: string, type: string, numero: string, criadoEm: Date) {
  await db.collection(EVENTS_COLLECTION).doc(id).set({ id, type, source: "functions_operacao", customer_code: "ITAU", payload: { id: numero }, created_at: Timestamp.fromDate(criadoEm) });
}

async function medidas() {
  return (await db.collection(AI_MEASURES_COLLECTION).get()).docs
    .map((doc) => doc.data())
    .map((medida) => [medida.escopo, medida.customer_code, medida.lpu_item_id, medida.homem_minuto_por_unidade, medida.execucoes])
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

beforeEach(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error("FIRESTORE_EMULATOR_HOST não definido.");
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
  const batch = db.batch();
  const set = (numero: string, dados: Record<string, unknown>) => batch.set(db.collection(SERVICE_ORDERS_COLLECTION).doc(numero), dados);
  // 10 de A com 2 pessoas em 100 minutos; 5 de A e 10 de B com 2 pessoas em 150; no Safra, 10 de A com 1 pessoa em 300.
  set("10045-01", os("ITAU", "09:00", "10:40", 2, [linha("ln_1", "lpu_a", "10")], "2026-10-20T20:00:00.000Z"));
  set("10046-01", os("ITAU", "09:00", "11:30", 2, [linha("ln_1", "lpu_a", "5"), linha("ln_2", "lpu_b", "10")], "2026-10-21T20:00:00.000Z"));
  set("20001-01", os("SAFRA", "08:00", "13:00", 1, [linha("ln_1", "lpu_a", "10")], "2026-10-22T20:00:00.000Z"));
  // Em revisão ainda não é amostra.
  set("10047-01", os("ITAU", "09:00", "17:00", 1, [linha("ln_1", "lpu_a", "1")], "", "em_revisao"));
  await batch.commit();
});

describe("a rotina das medidas", () => {
  it("a primeira vez recalcula com o histórico e marca o cursor; sem evento novo, nada muda", async () => {
    const primeira = await runMeasuresFor(db, { agora: () => T0 });
    assert.deepEqual([primeira.recalculou, primeira.amostras, primeira.medidas, primeira.gravadas, primeira.apagadas], [true, 3, 5, 5, 0]);
    assert.deepEqual(await medidas(), [
      ["cliente", "ITAU", "lpu_a", 20, 2],
      ["cliente", "ITAU", "lpu_b", 20, 1],
      ["cliente", "SAFRA", "lpu_a", 30, 1],
      ["geral", null, "lpu_a", 25, 3],
      ["geral", null, "lpu_b", 17.5, 1],
    ]);
    const cursor = (await db.collection(AI_CURSORS_COLLECTION).doc(CURSOR_DAS_MEDIDAS).get()).data() ?? {};
    assert.equal((cursor.created_at as Timestamp).toMillis(), T0.getTime() - 60_000);

    // Um evento que não muda medida, ou o de antes do cursor, não recalcula.
    await evento("evt_velho", "os.reviewed", "10045-01", depois(-5));
    await evento("evt_outro", "os.started", "10047-01", depois(1));
    const segunda = await runMeasuresFor(db, { agora: () => depois(10) });
    assert.deepEqual([segunda.recalculou, segunda.eventos], [false, 0]);
  });

  it("a OS reaberta sai: o item que ficou sem OS perde a medida; a nova revisada entra", async () => {
    await runMeasuresFor(db, { agora: () => T0 });
    await db.collection(SERVICE_ORDERS_COLLECTION).doc("10046-01").update({ status: "em_execucao" });
    await evento("evt_reaberta", "os.reopened", "10046-01", depois(1));
    // O evento do último minuto espera a próxima rodada.
    assert.equal((await runMeasuresFor(db, { agora: () => depois(1.5) })).recalculou, false);

    const rodada = await runMeasuresFor(db, { agora: () => depois(5) });
    assert.deepEqual([rodada.recalculou, rodada.eventos, rodada.amostras, rodada.apagadas], [true, 1, 2, 2]);
    assert.deepEqual(await medidas(), [
      ["cliente", "ITAU", "lpu_a", 20, 1],
      ["cliente", "SAFRA", "lpu_a", 30, 1],
      ["geral", null, "lpu_a", 25, 2],
    ]);
    assert.equal((await db.collection(AI_MEASURES_COLLECTION).doc(idDaMedida("duracao_item", "ITAU", "lpu_b")).get()).exists, false);
    const cursor = (await db.collection(AI_CURSORS_COLLECTION).doc(CURSOR_DAS_MEDIDAS).get()).data() ?? {};
    assert.equal(cursor.evento_id, "evt_reaberta");

    // Rodar de novo sem evento não grava nada.
    assert.equal((await runMeasuresFor(db, { agora: () => depois(30) })).recalculou, false);
  });

  it("recalcular sem mudança nas OS não regrava a medida", async () => {
    await runMeasuresFor(db, { agora: () => T0 });
    await evento("evt_revisada", "os.reviewed", "10045-01", depois(1));
    const rodada = await runMeasuresFor(db, { agora: () => depois(5) });
    assert.deepEqual([rodada.recalculou, rodada.medidas, rodada.gravadas, rodada.apagadas], [true, 5, 0, 0]);
  });
});
