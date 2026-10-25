import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

import { EVENTS_COLLECTION, OPERACAO_EVENT_SOURCE } from "./events.js";
import { runDailyAlertsFor } from "./rotina-gravacao.js";

/**
 * A rotina diária no emulador (parte 3.13a): a CNH vencendo e a revisão do
 * veículo viram um evento cada, uma vez por dia por item; rodar de novo no
 * mesmo dia não duplica; no dia seguinte, sai de novo. O evento não leva
 * nome, CPF, categoria, validade nem placa. Dados sintéticos.
 */

const PROJECT_ID = "demo-dute-operacao";
const ANA = "col_aaaaaaaaaaaaaaaa";
const BRUNO = "col_bbbbbbbbbbbbbbbb";
const CARLA = "col_cccccccccccccccc";
const VAN = "vei_aaaaaaaaaaaaaaaa";
const TRUCK = "vei_bbbbbbbbbbbbbbbb";
const HOJE_06H = new Date("2026-10-23T09:00:00.000Z"); // 06:00 em São Paulo
const AMANHA_06H = new Date("2026-10-24T09:00:00.000Z");

let db: Firestore;
let app: ReturnType<typeof initializeApp>;

before(() => {
  app = initializeApp({ projectId: PROJECT_ID }, "operacao-rotina-test");
  db = getFirestore(app);
});

after(async () => {
  await deleteApp(app);
});

const pessoa = (id: string, nome: string, validade: string, ativo = true) => ({
  id,
  nome,
  cpf: "52998224725",
  funcao: "Motorista",
  telefone: "11987654321",
  cnh: { categoria: "D", validade },
  ativo,
  edicao: 1,
});

const veiculo = (id: string, placa: string, revisao: string | null, ativo = true) => ({
  id,
  placa,
  tipo: "VUC",
  modelo: null,
  capacidade_kg: 3500,
  capacidade_m3: 12,
  revisao_em: revisao,
  ativo,
  edicao: 1,
});

beforeEach(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error("FIRESTORE_EMULATOR_HOST não definido.");
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
  const batch = db.batch();
  batch.set(db.collection("collaborators").doc(ANA), pessoa(ANA, "Ana Lima", "2026-11-02"));
  batch.set(db.collection("collaborators").doc(BRUNO), pessoa(BRUNO, "Bruno Teixeira", "2027-05-01"));
  batch.set(db.collection("collaborators").doc(CARLA), pessoa(CARLA, "Carla Souza", "2026-10-20", false));
  batch.set(db.collection("collaborators").doc("col_dddddddddddddddd"), { nome: "Ilegível", ativo: true });
  batch.set(db.collection("vehicles").doc(VAN), veiculo(VAN, "DEF4G56", "2026-10-21"));
  batch.set(db.collection("vehicles").doc(TRUCK), veiculo(TRUCK, "FGH2B34", "2026-12-01"));
  await batch.commit();
});

async function eventos() {
  return (await db.collection(EVENTS_COLLECTION).get()).docs.map((doc) => doc.data());
}

describe("a rotina diária da Operação", () => {
  it("grava um evento por alerta: a CNH de quem está ativo e a revisão do veículo", async () => {
    const resultado = await runDailyAlertsFor(db, HOJE_06H);
    assert.deepEqual(resultado, { dia: "2026-10-23", alertas: 2, criados: 2 });
    const gravados = await eventos();
    const porTipo = Object.fromEntries(gravados.map((evento) => [evento.type, evento]));
    assert.deepEqual(Object.keys(porTipo).sort(), ["collaborator.cnh_expiring", "vehicle.maintenance_due"]);
    assert.deepEqual(porTipo["collaborator.cnh_expiring"].payload, { id: ANA, dia: "2026-10-23", dias: 10 });
    assert.deepEqual(porTipo["vehicle.maintenance_due"].payload, { id: VAN, dia: "2026-10-23", dias: -2 });
    for (const evento of gravados) {
      assert.equal(evento.source, OPERACAO_EVENT_SOURCE);
      assert.equal(evento.customer_code, null);
      assert.equal(evento.actor.uid, "rotina-diaria");
      assert.equal(evento.occurred_at, HOJE_06H.toISOString());
      const texto = JSON.stringify(evento);
      for (const proibido of ["Ana", "529982", "11987654321", "DEF4G56", "2026-11-02", "\"D\""]) assert.ok(!texto.includes(proibido), proibido);
    }
  });

  it("rodar de novo no mesmo dia não duplica; no dia seguinte, sai de novo", async () => {
    await runDailyAlertsFor(db, HOJE_06H);
    const repetida = await runDailyAlertsFor(db, new Date("2026-10-23T20:00:00.000Z"));
    assert.deepEqual(repetida, { dia: "2026-10-23", alertas: 2, criados: 0 });
    assert.equal((await eventos()).length, 2);
    const amanha = await runDailyAlertsFor(db, AMANHA_06H);
    assert.deepEqual(amanha, { dia: "2026-10-24", alertas: 2, criados: 2 });
    const cnh = (await eventos()).filter((evento) => evento.type === "collaborator.cnh_expiring").map((evento) => evento.payload.dias).sort();
    assert.deepEqual(cnh, [10, 9]);
  });

  it("a CNH vencida há mais de 10 anos vira alerta, e os outros saem junto", async () => {
    // O cadastro aceita a validade desde 1980; o alerta mais vencido vem primeiro.
    await db.collection("collaborators").doc(BRUNO).update({ cnh: { categoria: "D", validade: "2015-06-01" } });
    assert.deepEqual(await runDailyAlertsFor(db, HOJE_06H), { dia: "2026-10-23", alertas: 3, criados: 3 });
    const doBruno = (await eventos()).find((evento) => evento.payload.id === BRUNO);
    assert.equal(doBruno?.payload.dias, -4162);
  });

  it("o cadastro que não vira evento não segura os outros alertas, e a rotina avisa no fim", async () => {
    // Um cadastro gravado fora da callable, com o id fora do formato.
    await db.collection("collaborators").doc("legado-1").set({ ...pessoa("legado-1", "Legado", "2026-10-25") });
    await assert.rejects(runDailyAlertsFor(db, HOJE_06H), /1 alerta não gravado: collaborator\.cnh_expiring:legado-1/);
    assert.deepEqual((await eventos()).map((evento) => evento.payload.id).sort(), [ANA, VAN]);
  });

  it("sem nada na janela, não grava nada", async () => {
    await db.collection("collaborators").doc(ANA).update({ cnh: { categoria: "D", validade: "2027-01-01" } });
    await db.collection("vehicles").doc(VAN).update({ revisao_em: null });
    assert.deepEqual(await runDailyAlertsFor(db, HOJE_06H), { dia: "2026-10-23", alertas: 0, criados: 0 });
    assert.equal((await eventos()).length, 0);
  });
});
