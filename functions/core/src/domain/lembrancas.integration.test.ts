import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { Timestamp, getFirestore, type Firestore } from "firebase-admin/firestore";

import { AI_CURSORS_COLLECTION, EVENTS_COLLECTION } from "./cursor.js";
import { CURSOR_DAS_LEMBRANCAS, runCasesFor } from "./lembrancas-gravacao.js";
import { AI_CASE_MEMORY_COLLECTION } from "./lembrancas.js";

/**
 * A rotina das lembranças no emulador (parte 5.3a). Na primeira vez, cada
 * demanda fechada ganha a lembrança, com as OS dela e do mesmo cliente; a
 * aberta não. Depois, os eventos depois do cursor: a demanda reaberta perde a
 * lembrança, a que fecha ganha, e o evento do último minuto espera. Dados
 * sintéticos.
 */

const PROJECT_ID = "demo-dute-core";

let db: Firestore;
let app: ReturnType<typeof initializeApp>;

before(() => {
  app = initializeApp({ projectId: PROJECT_ID }, "core-lembrancas-test");
  db = getFirestore(app);
});

after(async () => {
  await deleteApp(app);
});

const ETAPAS = [
  { etapa: "chegada_origem", instante: "2026-10-15T12:00:00.000Z" },
  { etapa: "fim", instante: "2026-10-15T14:00:00.000Z" },
];

const linha = (lpu: string, item: string, quantidade: string) => ({ lpu_item_id: lpu, item, quantidade, unidade: "UN", servico: "Montagem", origem: "tabela" });

beforeEach(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error("FIRESTORE_EMULATOR_HOST não definido.");
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
  const batch = db.batch();
  const set = (path: string, data: Record<string, unknown>) => batch.set(db.doc(path), data);
  // A 10045 do Itaú fechou: o escopo na RV 1, validada a RV 2.
  set("demands/10045", {
    numero: "10045",
    customer_code: "ITAU",
    customer_name: "Itaú Unibanco",
    etapa: "a_faturar",
    escopo_rv: 1,
    validacao: { rv: 2, etapa: "a_faturar", em: "2026-10-20T15:00:00.000Z" },
    marcos: [{ etapa: "a_faturar", em: "2026-10-20T15:00:00.000Z" }],
  });
  set("quotes/10045/revisoes/1", { rv: 1, linhas: [linha("lpu_mesa", "Mesa", "12")], total_cents: 120000 });
  set("quotes/10045/revisoes/2", { rv: 2, linhas: [linha("lpu_mesa", "Mesa", "14")], total_cents: 140000 });
  set("service_orders/10045-01", { demanda: "10045", customer_code: "ITAU", status: "revisada", tipo: "servico", etapas: ETAPAS, revisao: { pessoas: 2 } });
  // Uma OS com o número da demanda mas de outro cliente nunca entra.
  set("service_orders/10045-09", { demanda: "10045", customer_code: "SAFRA", status: "revisada", tipo: "servico", etapas: ETAPAS, revisao: { pessoas: 5 } });
  // A 20001 do Safra já foi paga, validada a mesma RV do escopo.
  set("demands/20001", { numero: "20001", customer_code: "SAFRA", etapa: "paga", escopo_rv: 0, validacao: { rv: 0, etapa: "a_faturar" } });
  set("quotes/20001/revisoes/0", { rv: 0, linhas: [linha("lpu_cadeira", "Cadeira", "40")], total_cents: 80000 });
  // A 30001 do Itaú ainda está em planejamento.
  set("demands/30001", { numero: "30001", customer_code: "ITAU", etapa: "para_planejar", escopo_rv: 0 });
  set("quotes/30001/revisoes/0", { rv: 0, linhas: [linha("lpu_mesa", "Mesa", "3")], total_cents: 30000 });
  await batch.commit();
});

const agora = (iso: string) => () => new Date(iso);

async function evento(id: string, type: string, payload: Record<string, unknown>, criado: string) {
  await db.collection(EVENTS_COLLECTION).doc(id).set({ id, type, source: "functions_comercial", payload, created_at: Timestamp.fromDate(new Date(criado)) });
}

async function lembrancas() {
  return Object.fromEntries((await db.collection(AI_CASE_MEMORY_COLLECTION).get()).docs.map((doc) => [doc.id, doc.data()]));
}

describe("a rotina das lembranças", () => {
  it("na primeira vez, cada demanda fechada ganha a lembrança, só com as OS do mesmo cliente; a aberta não", async () => {
    const rodada = await runCasesFor(db, { agora: agora("2026-10-23T12:00:00.000Z") });
    assert.deepEqual([rodada.recalculou, rodada.demandas, rodada.gravadas, rodada.apagadas], [true, 2, 2, 0]);
    const casos = await lembrancas();
    assert.deepEqual(Object.keys(casos).sort(), ["10045", "20001"]);
    const itau = casos["10045"];
    assert.deepEqual(
      [itau.customer_code, itau.os, itau.minutos_de_trabalho, itau.homem_minutos, itau.orcado_cents, itau.realizado_cents, itau.itens, itau.vetor],
      ["ITAU", ["10045-01"], 120, 240, 120000, 140000, [{ lpu_item_id: "lpu_mesa", item: "Mesa", unidade: "UN", orcado: "12", realizado: "14" }], { lpu_mesa: 2.708 }],
    );
    assert.deepEqual([casos["20001"].customer_code, casos["20001"].rv_orcada, casos["20001"].rv_realizada, casos["20001"].os], ["SAFRA", 0, 0, []]);
    assert.equal(itau.calculada_em, "2026-10-23T12:00:00.000Z");
    assert.ok((await db.collection(AI_CURSORS_COLLECTION).doc(CURSOR_DAS_LEMBRANCAS).get()).exists);

    // Sem evento novo, não refaz nada.
    assert.equal((await runCasesFor(db, { agora: agora("2026-10-23T12:15:00.000Z") })).recalculou, false);
  });

  it("depois do cursor: a reaberta perde a lembrança, a que fecha ganha, a que não mudou não se grava, e o evento do último minuto espera", async () => {
    await runCasesFor(db, { agora: agora("2026-10-23T12:00:00.000Z") });

    await db.doc("demands/10045").update({ etapa: "execucao_a_orcar" });
    await evento("evt_1", "demand.stage_changed", { numero: "10045", etapa_antes: "a_faturar", etapa_depois: "execucao_a_orcar" }, "2026-10-23T12:05:00.000Z");
    await db.doc("demands/30001").update({ etapa: "a_faturar", validacao: { rv: 0, etapa: "a_faturar", em: "2026-10-23T12:06:00.000Z" } });
    await evento("evt_2", "demand.stage_changed", { numero: "30001", etapa_antes: "para_planejar", etapa_depois: "a_faturar" }, "2026-10-23T12:06:00.000Z");
    await evento("evt_3", "os.reviewed", { id: "20001-01", demanda: "20001" }, "2026-10-23T12:07:00.000Z");
    // A mudança fora das etapas fechadas não toca em lembrança.
    await evento("evt_4", "demand.stage_changed", { numero: "40001", etapa_antes: "para_aprovar", etapa_depois: "para_enviar" }, "2026-10-23T12:08:00.000Z");

    const rodada = await runCasesFor(db, { agora: agora("2026-10-23T12:10:00.000Z") });
    assert.deepEqual([rodada.eventos, rodada.demandas, rodada.gravadas, rodada.apagadas], [4, 3, 1, 1]);
    const casos = await lembrancas();
    assert.deepEqual(Object.keys(casos).sort(), ["20001", "30001"]);
    assert.deepEqual([casos["30001"].customer_code, casos["30001"].fechada_em, casos["30001"].realizado_cents], ["ITAU", "2026-10-23T12:06:00.000Z", 30000]);
    assert.equal(casos["20001"].calculada_em, "2026-10-23T12:00:00.000Z");

    // Validada de novo, a 10045 volta; o evento gravado há menos de um minuto fica para a próxima.
    await db.doc("demands/10045").update({ etapa: "a_faturar" });
    await evento("evt_5", "demand.stage_changed", { numero: "10045", etapa_antes: "execucao_a_orcar", etapa_depois: "a_faturar" }, "2026-10-23T12:19:30.000Z");
    assert.equal((await runCasesFor(db, { agora: agora("2026-10-23T12:20:00.000Z") })).recalculou, false);
    const depois = await runCasesFor(db, { agora: agora("2026-10-23T12:21:00.000Z") });
    assert.deepEqual([depois.eventos, depois.gravadas], [1, 1]);
    assert.deepEqual(Object.keys(await lembrancas()).sort(), ["10045", "20001", "30001"]);
  });
});
