import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

import { RH_DATABASE } from "./banco.js";
import { saveRhRecordFor } from "./ficha-gravacao.js";
import type { RhProfile } from "./profile.js";
import { runRhAlertsFor } from "./rotina-gravacao.js";

/**
 * A rotina diária do RH no emulador (parte 8.2a): o vencimento gera o
 * evento uma vez por registro e por marco (vencendo, vencido), no banco
 * `rh`. Rodar de novo, no mesmo dia ou no seguinte, não duplica; o
 * vencimento corrigido avisa de novo. O substituído e quem não está ativo
 * ficam de fora.
 */

const PROJECT_ID = "demo-dute-rh";
const ANA = "col_aaaaaaaaaaaaaaaa";
const CARLA = "col_cccccccccccccccc";
const RH: RhProfile = { uid: "rh-1", role: "rh", name: "Pessoa rh" };
const DIA_1 = new Date("2026-10-23T09:10:00Z");

let app: ReturnType<typeof initializeApp>;
let padrao: Firestore;
let rh: Firestore;

before(() => {
  app = initializeApp({ projectId: PROJECT_ID }, "rh-rotina-test");
  padrao = getFirestore(app);
  rh = getFirestore(app, RH_DATABASE);
});

after(async () => {
  await deleteApp(app);
});

beforeEach(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error("FIRESTORE_EMULATOR_HOST não definido.");
  for (const banco of ["(default)", RH_DATABASE]) {
    await fetch(`http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/${banco}/documents`, { method: "DELETE" });
  }
  await padrao.doc(`collaborators/${ANA}`).set({ nome: "Ana Souza", funcao: "Montadora", ativo: true, edicao: 1 });
  await padrao.doc(`collaborators/${CARLA}`).set({ nome: "Carla Dias", funcao: "Ajudante", ativo: false, edicao: 2 });
});

let chave = 0;
function treinamento(extra: Record<string, unknown> = {}) {
  chave += 1;
  return { idempotency_key: `t-${chave}`, colaborador_id: ANA, categoria: "treinamento", tipo: "nr35", emitido_em: "2024-11-01", vence_em: "2026-11-01", ...extra };
}

function dia(texto: string): Date {
  return new Date(`${texto}T09:10:00Z`);
}

async function alertas() {
  const snapshot = await rh.collection("events").where("source", "==", "functions_rh").get();
  return snapshot.docs
    .map((doc) => doc.data())
    .filter((evento) => evento.type === "rh.record_expiring" || evento.type === "rh.record_expired")
    .map((evento) => [evento.type, evento.entity_id, evento.payload.vence_em, evento.payload.dias, evento.actor.role])
    .sort((a, b) => String(a[2]).localeCompare(String(b[2])) || String(a[0]).localeCompare(String(b[0])));
}

describe("a rotina diária do RH", () => {
  it("o vencimento gera o alerta uma vez por marco, no banco rh", async () => {
    const nr35 = await saveRhRecordFor(padrao, rh, RH, treinamento(), DIA_1);

    assert.deepEqual(await runRhAlertsFor(padrao, rh, DIA_1), { dia: "2026-10-23", vencimentos: 1, criados: 1, falhas: 0 });
    assert.deepEqual(await runRhAlertsFor(padrao, rh, DIA_1), { dia: "2026-10-23", vencimentos: 1, criados: 0, falhas: 0 });
    assert.deepEqual(await runRhAlertsFor(padrao, rh, dia("2026-10-24")), { dia: "2026-10-24", vencimentos: 1, criados: 0, falhas: 0 });
    assert.deepEqual(await alertas(), [["rh.record_expiring", nr35.id, "2026-11-01", 9, "sistema"]]);

    assert.deepEqual(await runRhAlertsFor(padrao, rh, dia("2026-11-02")), { dia: "2026-11-02", vencimentos: 1, criados: 1, falhas: 0 });
    assert.deepEqual(await runRhAlertsFor(padrao, rh, dia("2026-11-20")), { dia: "2026-11-20", vencimentos: 1, criados: 0, falhas: 0 });
    assert.deepEqual(await alertas(), [
      ["rh.record_expired", nr35.id, "2026-11-01", -1, "sistema"],
      ["rh.record_expiring", nr35.id, "2026-11-01", 9, "sistema"],
    ]);
    assert.equal((await padrao.collection("events").get()).size, 0);
  });

  it("o vencimento corrigido avisa de novo; o renovado sai do alerta", async () => {
    const nr35 = await saveRhRecordFor(padrao, rh, RH, treinamento(), DIA_1);
    await runRhAlertsFor(padrao, rh, DIA_1);
    await saveRhRecordFor(padrao, rh, RH, treinamento({ id: nr35.id, expected_edicao: 1, vence_em: "2026-11-10" }), DIA_1);
    assert.equal((await runRhAlertsFor(padrao, rh, DIA_1)).criados, 1);
    assert.deepEqual((await alertas()).map((alerta) => alerta[2]), ["2026-11-01", "2026-11-10"]);

    await saveRhRecordFor(padrao, rh, RH, treinamento({ emitido_em: "2026-10-20", vence_em: "2028-10-20" }), DIA_1);
    assert.deepEqual(await runRhAlertsFor(padrao, rh, dia("2026-11-15")), { dia: "2026-11-15", vencimentos: 0, criados: 0, falhas: 0 });
  });

  it("um registro que não vira evento não para os outros: a rotina conta a falha e segue", async () => {
    const nr35 = await saveRhRecordFor(padrao, rh, RH, treinamento(), DIA_1);
    // Gravado antes do limite das datas: o vencimento de 0026 não cabe no evento.
    await rh.doc("registros/reg_0000000000000bad").set({
      colaborador_id: ANA,
      categoria: "treinamento",
      tipo: "nr11",
      descricao: null,
      emitido_em: "0025-01-10",
      vence_em: "0026-01-10",
      resultado: null,
      situacao: "vigente",
      substituido_por: null,
      arquivo: null,
      edicao: 1,
    });
    assert.deepEqual(await runRhAlertsFor(padrao, rh, DIA_1), { dia: "2026-10-23", vencimentos: 2, criados: 1, falhas: 1 });
    assert.deepEqual((await alertas()).map((alerta) => alerta[1]), [nr35.id]);
  });

  it("quem não está ativo e o registro sem vencimento ficam de fora", async () => {
    await saveRhRecordFor(padrao, rh, RH, treinamento({ colaborador_id: CARLA }), DIA_1);
    await saveRhRecordFor(padrao, rh, RH, treinamento({ categoria: "documento", tipo: "rg", vence_em: null }), DIA_1);
    assert.deepEqual(await runRhAlertsFor(padrao, rh, DIA_1), { dia: "2026-10-23", vencimentos: 0, criados: 0, falhas: 0 });
  });
});
