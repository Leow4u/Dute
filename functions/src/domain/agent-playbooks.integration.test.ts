import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

import {
  activePlaybooksForPrompt,
  decidePlaybook,
  initialPlaybookId,
  listPlaybooks,
  readPlaybookForAgent,
  savePlaybook,
  seedInitialPlaybooks,
} from "./agent-playbooks.js";

const PROJECT_ID = "demo-dute-operations";
const BTG = "BTG Pactual";
const coordenacao = { uid: "ops-1", name: "Leonardo", role: "interno" };
let db: Firestore;
let app: ReturnType<typeof initializeApp>;

before(() => {
  app = initializeApp({ projectId: PROJECT_ID }, "agent-playbooks-test");
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

async function events(type: string) {
  return (await db.collection("events").where("type", "==", type).get()).size;
}

const receber = initialPlaybookId(BTG, "receber");
const pedidoPortal = initialPlaybookId(BTG, "pedido-portal");

describe("playbooks do Agent Dute", () => {
  it("só a coordenação lista, carrega, edita e decide", async () => {
    for (const role of ["cliente", "wms", "financeiro"]) {
      const actor = { uid: "x", role };
      await assert.rejects(listPlaybooks(db, BTG, actor), /coordenação/);
      await assert.rejects(seedInitialPlaybooks(db, BTG, actor), /coordenação/);
      await assert.rejects(savePlaybook(db, BTG, { title: "a", when: "b", steps: ["c"], open_points: [], audience: "equipe" }, actor), /coordenação/);
      await assert.rejects(decidePlaybook(db, BTG, { id: receber, action: "approve" }, actor), /coordenação/);
    }
  });

  it("os iniciais entram pendentes, fora do agente; carregar de novo não duplica nem volta um recusado", async () => {
    assert.deepEqual(await seedInitialPlaybooks(db, BTG, coordenacao), { created: 7 });
    const list = await listPlaybooks(db, BTG, coordenacao);
    assert.equal(list.length, 7);
    assert.ok(list.every((item) => item.status === "pending" && item.source === "inicial"));
    assert.deepEqual(await activePlaybooksForPrompt(db, BTG, "internal"), []);
    assert.equal(await events("agent.playbooks_seeded"), 1);

    await decidePlaybook(db, BTG, { id: receber, action: "reject" }, coordenacao);
    assert.deepEqual(await seedInitialPlaybooks(db, BTG, coordenacao), { created: 0 });
    assert.equal((await listPlaybooks(db, BTG, coordenacao)).length, 6);
    assert.equal(await events("agent.playbooks_seeded"), 1);
  });

  it("aprovado entra no agente; o cliente só recebe os do portal; arquivado sai", async () => {
    await seedInitialPlaybooks(db, BTG, coordenacao);
    await decidePlaybook(db, BTG, { id: receber, action: "approve" }, coordenacao);
    await decidePlaybook(db, BTG, { id: pedidoPortal, action: "approve" }, coordenacao);
    await assert.rejects(decidePlaybook(db, BTG, { id: receber, action: "approve" }, coordenacao), /já está valendo/);
    assert.equal(await events("agent.playbook_approved"), 2);

    assert.deepEqual((await activePlaybooksForPrompt(db, BTG, "internal")).map((item) => item.id).sort(), [pedidoPortal, receber].sort());
    assert.deepEqual((await activePlaybooksForPrompt(db, BTG, "customer")).map((item) => item.id), [pedidoPortal]);
    assert.deepEqual(await activePlaybooksForPrompt(db, "Outro cliente", "internal"), []);

    const forTeam = await readPlaybookForAgent(db, BTG, receber, "internal");
    assert.equal(forTeam.encontrado, true);
    assert.ok((forTeam.passos?.length ?? 0) >= 3);
    assert.equal((await readPlaybookForAgent(db, BTG, receber, "customer")).encontrado, false);
    assert.equal((await readPlaybookForAgent(db, "Outro cliente", receber, "internal")).encontrado, false);
    assert.equal((await db.collection("ai_agent_playbooks").doc(receber).get()).data()?.use_count, 1);

    await decidePlaybook(db, BTG, { id: receber, action: "archive" }, coordenacao);
    assert.deepEqual((await activePlaybooksForPrompt(db, BTG, "internal")).map((item) => item.id), [pedidoPortal]);
    assert.equal((await readPlaybookForAgent(db, BTG, receber, "internal")).encontrado, false);
  });

  it("escrito pela coordenação vale direto; editar pendente mantém pendente; recusado não edita", async () => {
    const created = await savePlaybook(db, BTG, { title: "Inventário mensal", when: "Último dia útil", steps: ["Conte", "Lance"], open_points: [], audience: "equipe" }, coordenacao);
    assert.equal(created.status, "active");
    assert.deepEqual((await activePlaybooksForPrompt(db, BTG, "internal")).map((item) => item.title), ["Inventário mensal"]);
    assert.equal(await events("agent.playbook_created"), 1);

    await seedInitialPlaybooks(db, BTG, coordenacao);
    const edited = await savePlaybook(db, BTG, { id: receber, title: "Receber mercadoria", when: "Chegou", steps: ["Conte tudo"], open_points: ["Horário"], audience: "equipe" }, coordenacao);
    assert.equal(edited.status, "pending");
    const after = (await listPlaybooks(db, BTG, coordenacao)).find((item) => item.id === receber)!;
    assert.deepEqual([after.steps, after.open_points, after.updated_by_name], [["Conte tudo"], ["Horário"], "Leonardo"]);
    assert.equal(await events("agent.playbook_edited"), 1);

    await assert.rejects(savePlaybook(db, "Outro cliente", { id: receber, title: "x", when: "y", steps: ["z"], open_points: [], audience: "equipe" }, coordenacao), /não encontrado/);
    await decidePlaybook(db, BTG, { id: receber, action: "reject" }, coordenacao);
    await assert.rejects(savePlaybook(db, BTG, { id: receber, title: "x", when: "y", steps: ["z"], open_points: [], audience: "equipe" }, coordenacao), /recusado ou arquivado/);
  });
});
