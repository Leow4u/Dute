import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

import { claimDueRoutines, deleteRoutine, listRoutines, recordRoutineRun, saveRoutine } from "./agent-routines.js";

const PROJECT_ID = "demo-dute-operations";
const ana = { uid: "u-ana", customerCode: "BTG Pactual", role: "cliente", name: "Ana" };
const bruno = { uid: "u-bruno", customerCode: "BTG Pactual", role: "cliente", name: "Bruno" };
const weekly = { name: "Resumo da semana", prompt: "Resumo da semana passada", frequency: "weekly" as const, days: [1], time: "08:00" };
const friday = new Date("2026-10-02T10:00:00Z");
let db: Firestore;
let app: ReturnType<typeof initializeApp>;

before(() => {
  app = initializeApp({ projectId: PROJECT_ID }, "agent-routines-test");
  db = getFirestore(app);
});

beforeEach(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error("FIRESTORE_EMULATOR_HOST não definido.");
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
});

after(async () => {
  await deleteApp(app);
});

describe("rotinas do Agent Dute", () => {
  it("cria com a próxima execução, lista só as da pessoa e pausa sem agenda", async () => {
    const saved = await saveRoutine(db, ana, weekly, friday);
    await saveRoutine(db, bruno, { ...weekly, name: "Do Bruno" }, friday);
    const mine = await listRoutines(db, ana);
    assert.deepEqual(mine.map((routine) => [routine.name, routine.next_run_at, routine.conversation_id]), [
      ["Resumo da semana", "2026-10-05T11:00:00.000Z", `routine_${saved.id}`],
    ]);
    await saveRoutine(db, ana, { ...weekly, id: saved.id, active: false }, friday);
    assert.equal((await listRoutines(db, ana))[0]!.next_run_at, null);
  });

  it("no máximo 5 por pessoa; outra pessoa não altera nem apaga", async () => {
    const first = await saveRoutine(db, ana, weekly, friday);
    for (let index = 1; index < 5; index += 1) await saveRoutine(db, ana, { ...weekly, name: `R${index}` }, friday);
    await assert.rejects(saveRoutine(db, ana, weekly, friday), /já tem 5 rotinas/);
    await assert.rejects(saveRoutine(db, bruno, { ...weekly, id: first.id }, friday), /de outra pessoa/);
    await assert.rejects(deleteRoutine(db, bruno, first.id), /de outra pessoa/);
    await deleteRoutine(db, ana, first.id);
    assert.equal((await listRoutines(db, ana)).length, 4);
  });

  it("a mesma semente (cartão do chat) não cria duas", async () => {
    const one = await saveRoutine(db, ana, weekly, friday, "agent_draft_msg_1");
    const two = await saveRoutine(db, ana, weekly, friday, "agent_draft_msg_1");
    assert.equal(one.id, two.id);
    assert.equal(two.created, false);
    assert.equal((await listRoutines(db, ana)).length, 1);
  });

  it("pega as vencidas uma vez só, já com a próxima agenda; pausada não entra", async () => {
    const due = await saveRoutine(db, ana, weekly, friday);
    await saveRoutine(db, bruno, { ...weekly, active: false }, friday);
    const monday = new Date("2026-10-05T11:05:00Z");
    const claimed = await claimDueRoutines(db, monday);
    assert.deepEqual(claimed.map((routine) => routine.id), [due.id]);
    assert.deepEqual(await claimDueRoutines(db, monday), []);
    assert.equal((await listRoutines(db, ana))[0]!.next_run_at, "2026-10-12T11:00:00.000Z");
  });

  it("falha tenta de novo em 15 min; segunda falha fica registrada; sem acesso pausa", async () => {
    const saved = await saveRoutine(db, ana, weekly, friday);
    const monday = new Date("2026-10-05T11:05:00Z");
    const [routine] = await claimDueRoutines(db, monday);
    await recordRoutineRun(db, routine!, { status: "failed", error: "modelo fora" }, monday);
    let view = (await listRoutines(db, ana))[0]!;
    assert.equal(view.next_run_at, "2026-10-05T11:20:00.000Z");
    const [retry] = await claimDueRoutines(db, new Date("2026-10-05T11:20:00Z"));
    assert.equal(retry!.retry_pending, true);
    await recordRoutineRun(db, retry!, { status: "failed", error: "de novo" });
    view = (await listRoutines(db, ana))[0]!;
    assert.equal(view.last_status, "failed");
    assert.equal(view.next_run_at, "2026-10-12T11:00:00.000Z");
    await recordRoutineRun(db, { ...retry!, id: saved.id }, { status: "no_access" });
    view = (await listRoutines(db, ana))[0]!;
    assert.deepEqual([view.active, view.next_run_at, view.last_status], [false, null, "no_access"]);
  });
});
